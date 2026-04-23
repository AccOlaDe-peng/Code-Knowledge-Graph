// StaticAgent — AST parsing and structural extraction

import { BaseAgent } from '../BaseAgent.ts';
import { createTreeSitterTool, type ParseResult, type ExtractedSymbol } from '../tools/TreeSitterTool.ts';
import { createCacheSetTool, createCacheGetTool } from '../tools/CacheTool.ts';
import type { AgentConfig, AgentResult, Task } from '../../coordinator/types.ts';
import type { AgentContext } from '../AgentContext.ts';
import { CacheManager } from '../../cache/CacheManager.ts';
import { Confidence, NodeType, EdgeType } from '../../graph/schema.ts';
import type { GraphNode, GraphEdge } from '../../graph/schema.ts';
import * as crypto from 'node:crypto';

const STATIC_CONFIG: AgentConfig = {
  name: 'StaticAgent',
  description: 'Parses AST, extracts classes/functions/imports/calls with EXTRACTED confidence',
  tools: ['TreeSitterTool', 'CacheSetTool', 'CacheGetTool'],
  // No model — no LLM needed for static analysis
};

class StaticAgent extends BaseAgent {
  private filesToProcess: string[];
  private cacheManager: CacheManager;

  constructor(id: string, context: AgentContext, filesToProcess: string[], cacheManager: CacheManager) {
    super(id, STATIC_CONFIG, context, [
      createTreeSitterTool(),
      createCacheSetTool(cacheManager),
      createCacheGetTool(cacheManager),
    ]);
    this.filesToProcess = filesToProcess;
    this.cacheManager = cacheManager;
  }

  async execute(task: Task): Promise<AgentResult> {
    await this.onTaskStart(task);

    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    let tokensUsed = 0;
    const processedFiles: string[] = [];

    try {
      for (const filePath of this.filesToProcess) {
        // Check cache first
        const cacheKey = this.cacheManager.makeKey(filePath);
        const cached = this.cacheManager.get(cacheKey);
        if (cached?.result) {
          const cachedResult = cached.result as { nodes: GraphNode[]; edges: GraphEdge[] };
          nodes.push(...cachedResult.nodes);
          edges.push(...cachedResult.edges);
          processedFiles.push(filePath);
          continue;
        }

        // Parse the file
        try {
          const content = await Bun.file(filePath).text();
          const ext = filePath.split('.').pop() ?? '';
          const language = this.extToLanguage(ext);

          const parseResult = await this.useTool('TreeSitterTool', {
            filePath,
            content,
            language,
          }) as ParseResult;

          // Convert symbols to graph nodes
          for (const symbol of parseResult.symbols) {
            const node = this.symbolToNode(symbol, filePath);
            if (node) nodes.push(node);
          }

          // Convert imports to edges
          for (const imp of parseResult.imports) {
            edges.push({
              id: crypto.randomUUID(),
              source: imp.source,
              target: imp.target,
              type: EdgeType.imports,
              confidence: Confidence.EXTRACTED,
              weight: 1.0,
              file: filePath,
              location: imp.location,
            });
          }

          // Cache the result
          this.cacheManager.set(cacheKey, { nodes: this.filterNodesForFile(nodes, filePath), edges: this.filterEdgesForFile(edges, filePath) }, 'ast');
          processedFiles.push(filePath);
        } catch {
          // Skip files that fail to parse
          processedFiles.push(filePath);
        }
      }

      const result = this.createResult(nodes, edges, {
        confidence: Confidence.EXTRACTED,
        source: 'ast',
        filesProcessed: processedFiles,
        tokensUsed,
      });

      await this.onTaskComplete(result);
      return result;
    } catch (error) {
      await this.onError(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  private symbolToNode(symbol: ExtractedSymbol, filePath: string): GraphNode | null {
    const typeMap: Record<string, NodeType> = {
      class: NodeType.Class,
      interface: NodeType.Interface,
      function: NodeType.Function,
      method: NodeType.Method,
    };

    const nodeType = typeMap[symbol.type];
    if (!nodeType) return null;

    return {
      id: `${filePath}:${symbol.type}:${symbol.name}`,
      label: symbol.name,
      type: nodeType,
      file: filePath,
      location: symbol.location,
      confidence: Confidence.EXTRACTED,
      metadata: symbol.metadata,
    };
  }

  private filterNodesForFile(nodes: GraphNode[], filePath: string): GraphNode[] {
    return nodes.filter(n => n.file === filePath);
  }

  private filterEdgesForFile(edges: GraphEdge[], filePath: string): GraphEdge[] {
    return edges.filter(e => e.file === filePath);
  }

  private extToLanguage(ext: string): string {
    const map: Record<string, string> = {
      ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'javascript',
      py: 'python', java: 'java', go: 'go', rs: 'rust', rb: 'ruby',
    };
    return map[ext] ?? 'unknown';
  }

  onTaskStart(_task: Task): Promise<void> { return Promise.resolve(); }
  onTaskComplete(_result: AgentResult): Promise<void> { return Promise.resolve(); }
  onError(_error: Error): Promise<void> { return Promise.resolve(); }
}

export { StaticAgent, STATIC_CONFIG };
