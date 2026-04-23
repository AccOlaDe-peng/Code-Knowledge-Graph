// SemanticAgent — LLM-powered semantic enhancement

import { BaseAgent } from '../BaseAgent.ts';
import { createLLMTool, createReadFileTool, type LLMResponse } from '../tools/LLMTool.ts';
import { createCacheSetTool, createCacheGetTool } from '../tools/CacheTool.ts';
import type { AgentConfig, AgentResult, Task } from '../../coordinator/types.ts';
import type { AgentContext } from '../AgentContext.ts';
import { CacheManager } from '../../cache/CacheManager.ts';
import { Confidence, NodeType, EdgeType } from '../../graph/schema.ts';
import type { GraphNode, GraphEdge } from '../../graph/schema.ts';
import * as crypto from 'node:crypto';

const CHUNK_SIZE = 20; // files per chunk

const SEMANTIC_CONFIG: AgentConfig = {
  name: 'SemanticAgent',
  description: 'LLM semantic analysis: module boundaries, design rationale, semantic relationships',
  tools: ['LLMTool', 'ReadFileTool', 'CacheSetTool', 'CacheGetTool'],
  model: 'sonnet',
};

class SemanticAgent extends BaseAgent {
  private filesToProcess: string[];
  private cacheManager: CacheManager;

  constructor(id: string, context: AgentContext, filesToProcess: string[], cacheManager: CacheManager) {
    super(id, SEMANTIC_CONFIG, context, [
      createLLMTool(),
      createReadFileTool(),
      createCacheSetTool(cacheManager),
      createCacheGetTool(cacheManager),
    ]);
    this.filesToProcess = filesToProcess;
    this.cacheManager = cacheManager;
  }

  async execute(task: Task): Promise<AgentResult> {
    await this.onTaskStart(task);

    const allNodes: GraphNode[] = [];
    const allEdges: GraphEdge[] = [];
    let totalTokens = 0;
    const processedFiles: string[] = [];

    try {
      // Split files into chunks for parallel processing
      const chunks = this.chunkFiles(this.filesToProcess, CHUNK_SIZE);

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]!;

        // Check cache for this chunk
        const cacheKey = this.cacheManager.makeKey(`semantic-chunk-${i}`, chunk.join(','));
        const cached = this.cacheManager.get(cacheKey);
        if (cached?.result) {
          const cachedResult = cached.result as { nodes: GraphNode[]; edges: GraphEdge[] };
          allNodes.push(...cachedResult.nodes);
          allEdges.push(...cachedResult.edges);
          processedFiles.push(...chunk);
          continue;
        }

        // Build prompt for this chunk
        const prompt = this.buildPrompt(chunk);

        // Call LLM
        const response = await this.useTool('LLMTool', {
          prompt,
          config: { model: 'sonnet', maxTokens: 4096 },
        }) as LLMResponse;

        totalTokens += response.tokensUsed;

        // Parse LLM response into graph elements
        const { nodes, edges } = this.parseResponse(response.content);
        allNodes.push(...nodes);
        allEdges.push(...edges);
        processedFiles.push(...chunk);

        // Cache chunk result
        this.cacheManager.set(cacheKey, { nodes, edges }, 'semantic');
      }

      const result = this.createResult(allNodes, allEdges, {
        confidence: Confidence.INFERRED,
        source: 'semantic',
        filesProcessed: processedFiles,
        tokensUsed: totalTokens,
      });

      await this.onTaskComplete(result);
      return result;
    } catch (error) {
      await this.onError(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  private buildPrompt(filePaths: string[]): string {
    return `Analyze the following source files and extract:
1. Module boundaries (which files group together and why)
2. Semantic relationships between modules (depends_on, shares_data_with, conceptually_related_to)
3. Design rationale for key architectural decisions

Files to analyze:
${filePaths.map(p => `- ${p}`).join('\n')}

Respond in JSON format:
{
  "modules": [{ "id": "module-name", "files": ["file1.ts"], "description": "what this module does" }],
  "relationships": [{ "source": "module-a", "target": "module-b", "type": "depends_on", "reason": "why" }],
  "confidence": "INFERRED" | "AMBIGUOUS"
}`;
  }

  private parseResponse(content: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    try {
      // Extract JSON from response (may have markdown fences)
      const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) ?? content.match(/(\{[\s\S]*\})/);
      if (!jsonMatch) return { nodes, edges };

      const data = JSON.parse(jsonMatch[1]!) as {
        modules?: Array<{ id: string; files: string[]; description: string }>;
        relationships?: Array<{ source: string; target: string; type: string; reason: string; confidence?: string }>;
        confidence?: string;
      };

      // Convert modules to nodes
      if (data.modules) {
        for (const mod of data.modules) {
          nodes.push({
            id: `module:${mod.id}`,
            label: mod.id,
            type: NodeType.Module,
            file: mod.files[0] ?? '',
            confidence: Confidence.INFERRED,
            metadata: { description: mod.description, files: mod.files },
          });
        }
      }

      // Convert relationships to edges
      if (data.relationships) {
        for (const rel of data.relationships) {
          const edgeType = this.mapEdgeType(rel.type);
          edges.push({
            id: crypto.randomUUID(),
            source: `module:${rel.source}`,
            target: `module:${rel.target}`,
            type: edgeType,
            confidence: rel.confidence === 'AMBIGUOUS' ? Confidence.AMBIGUOUS : Confidence.INFERRED,
            weight: 1.0,
            metadata: { reason: rel.reason },
          });
        }
      }
    } catch {
      // LLM output not valid JSON — return empty
    }

    return { nodes, edges };
  }

  private mapEdgeType(type: string): EdgeType {
    const map: Record<string, EdgeType> = {
      depends_on: EdgeType.depends_on,
      shares_data_with: EdgeType.shares_data_with,
      conceptually_related_to: EdgeType.conceptually_related_to,
      imports: EdgeType.imports,
      uses: EdgeType.uses,
    };
    return map[type] ?? EdgeType.depends_on;
  }

  private chunkFiles(files: string[], size: number): string[][] {
    const chunks: string[][] = [];
    for (let i = 0; i < files.length; i += size) {
      chunks.push(files.slice(i, i + size));
    }
    return chunks;
  }

  onTaskStart(_task: Task): Promise<void> { return Promise.resolve(); }
  onTaskComplete(_result: AgentResult): Promise<void> { return Promise.resolve(); }
  onError(_error: Error): Promise<void> { return Promise.resolve(); }
}

export { SemanticAgent, SEMANTIC_CONFIG };
