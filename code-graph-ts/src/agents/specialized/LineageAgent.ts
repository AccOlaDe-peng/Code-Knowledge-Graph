// LineageAgent — two-pass data lineage extraction
// Pass 1: Static extraction via Tree-sitter (zero LLM cost)
// Pass 2: LLM inference for ambiguous edges only

import { BaseAgent } from '../BaseAgent.ts';
import { createLLMTool, type LLMResponse } from '../tools/LLMTool.ts';
import { extractDataFlow } from '../tools/TreeSitterTool.ts';
import type { AgentConfig, AgentResult, Task } from '../../coordinator/types.ts';
import type { AgentContext } from '../AgentContext.ts';
import {
  Confidence,
  EdgeType,
  CIRCUIT_BREAKER_THRESHOLD,
  DataFlowType,
} from '../../graph/schema.ts';
import type { GraphNode, GraphEdge, DataFlowEdge } from '../../graph/schema.ts';
import * as crypto from 'node:crypto';

const LINEAGE_CONFIG: AgentConfig = {
  name: 'LineageAgent',
  description: 'Two-pass data lineage: static extraction + LLM inference for ambiguous edges',
  tools: ['LLMTool'],
  model: 'sonnet',
};

interface StaticExtractOptions {
  filePaths: string[];
  progressCallback?: (processed: number, total: number) => void;
}

interface StaticExtractResult {
  dataFlowEdges: DataFlowEdge[];
  filesProcessed: string[];
  filesSkipped: { path: string; reason: string }[];
  ambiguousRatio: number;
  circuitBreakerTriggered: boolean;
}

class LineageAgent extends BaseAgent {
  private graphNodes: GraphNode[];
  private fileContents: Map<string, string>;

  constructor(
    id: string,
    context: AgentContext,
    existingNodes: GraphNode[],
    fileContents?: Map<string, string>
  ) {
    super(id, LINEAGE_CONFIG, context, [createLLMTool()]);
    this.graphNodes = existingNodes;
    this.fileContents = fileContents ?? new Map();
  }

  /**
   * Pass 1: Static extraction via Tree-sitter
   * Zero LLM cost, extracts data flow edges from AST
   */
  async staticExtract(options: StaticExtractOptions): Promise<StaticExtractResult> {
    const dataFlowEdges: DataFlowEdge[] = [];
    const filesProcessed: string[] = [];
    const filesSkipped: { path: string; reason: string }[] = [];

    const total = options.filePaths.length;
    let processed = 0;

    for (const filePath of options.filePaths) {
      try {
        // Get file content
        const content = this.fileContents.get(filePath) ?? await this.readFile(filePath);
        if (!content) {
          filesSkipped.push({ path: filePath, reason: 'File not found or empty' });
          continue;
        }

        // Detect language from extension
        const language = this.detectLanguage(filePath);
        if (!language) {
          filesSkipped.push({ path: filePath, reason: 'Unsupported language' });
          continue;
        }

        // Extract data flow
        const result = await extractDataFlow(filePath, content, language);

        if (result.success && result.data) {
          dataFlowEdges.push(...result.data.dataFlowEdges);
          filesProcessed.push(filePath);
        }

        if (result.warning) {
          filesSkipped.push({ path: filePath, reason: result.warning });
        }

        processed++;
        if (options.progressCallback && processed % 10 === 0) {
          options.progressCallback(processed, total);
        }

        // Send progress to coordinator
        await this.sendMessage('coordinator', {
          type: 'progress',
          processed,
          total,
          currentFile: filePath,
        });
      } catch (error) {
        filesSkipped.push({
          path: filePath,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Calculate ambiguous ratio
    const ambiguousCount = dataFlowEdges.filter(
      e => e.confidence === Confidence.AMBIGUOUS
    ).length;
    const ambiguousRatio = dataFlowEdges.length > 0
      ? ambiguousCount / dataFlowEdges.length
      : 0;

    // Circuit breaker check
    const circuitBreakerTriggered = ambiguousRatio > CIRCUIT_BREAKER_THRESHOLD;

    if (circuitBreakerTriggered) {
      // Mark all edges as ambiguous
      for (const edge of dataFlowEdges) {
        edge.confidence = Confidence.AMBIGUOUS;
      }
    }

    return {
      dataFlowEdges,
      filesProcessed,
      filesSkipped,
      ambiguousRatio,
      circuitBreakerTriggered,
    };
  }

  /**
   * Pass 2: LLM inference for ambiguous edges
   * Only processes edges marked as AMBIGUOUS in Pass 1
   */
  async inferAmbiguousEdges(ambiguousEdges: DataFlowEdge[]): Promise<GraphEdge[]> {
    const resolvedEdges: GraphEdge[] = [];

    if (ambiguousEdges.length === 0) {
      return resolvedEdges;
    }

    // Build prompt for LLM
    const prompt = this.buildInferencePrompt(ambiguousEdges);

    try {
      const response = await this.useTool('LLMTool', {
        prompt,
        config: { model: 'haiku', maxTokens: 2048 },
      }) as LLMResponse;

      // Parse resolved edges
      const parsed = this.parseInferenceResponse(response.content, ambiguousEdges);
      resolvedEdges.push(...parsed);
    } catch {
      // If LLM fails, keep edges as AMBIGUOUS
      for (const edge of ambiguousEdges) {
        resolvedEdges.push(this.dataFlowToGraphEdge(edge));
      }
    }

    return resolvedEdges;
  }

  /**
   * Full execute: static extract + optional LLM inference
   */
  async execute(task: Task): Promise<AgentResult> {
    await this.onTaskStart(task);

    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    let tokensUsed = 0;

    try {
      // Get files to process from task metadata
      const filePaths = task.metadata?.filePaths as string[] | undefined;
      if (!filePaths || filePaths.length === 0) {
        return this.createResult(nodes, edges, {
          confidence: Confidence.INFERRED,
          source: 'lineage',
          filesProcessed: [],
          tokensUsed: 0,
          warnings: ['No files to process'],
        });
      }

      // Pass 1: Static extraction
      const staticResult = await this.staticExtract({
        filePaths,
        progressCallback: (processed, total) => {
          console.log(`LineageAgent: ${processed}/${total} files processed`);
        },
      });

      // Convert data flow edges to graph edges
      const staticEdges = staticResult.dataFlowEdges.map(e => this.dataFlowToGraphEdge(e));
      edges.push(...staticEdges);

      // Pass 2: LLM inference for ambiguous edges (if circuit breaker not triggered)
      if (!staticResult.circuitBreakerTriggered) {
        const ambiguousEdges = staticResult.dataFlowEdges.filter(
          e => e.confidence === Confidence.AMBIGUOUS
        );

        if (ambiguousEdges.length > 0) {
          const resolvedEdges = await this.inferAmbiguousEdges(ambiguousEdges);
          // Replace ambiguous edges with resolved ones
          const ambiguousIds = new Set(ambiguousEdges.map(e => `${e.source.file}:${e.source.line}`));
          const filteredEdges = edges.filter(e => !ambiguousIds.has(`${e.file}:${e.location?.startLine}`));
          edges.length = 0;
          edges.push(...filteredEdges, ...resolvedEdges);
        }
      }

      const result = this.createResult(nodes, edges, {
        confidence: Confidence.INFERRED,
        source: 'lineage',
        filesProcessed: staticResult.filesProcessed,
        tokensUsed,
        warnings: [
          ...staticResult.filesSkipped.map(f => `Skipped ${f.path}: ${f.reason}`),
          ...(staticResult.circuitBreakerTriggered
            ? [`Circuit breaker triggered: ${Math.round(staticResult.ambiguousRatio * 100)}% ambiguous edges`]
            : []),
        ],
      });

      await this.onTaskComplete(result);
      return result;
    } catch (error) {
      await this.onError(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────

  private async readFile(filePath: string): Promise<string | null> {
    try {
      return await Bun.file(filePath).text();
    } catch {
      return null;
    }
  }

  private detectLanguage(filePath: string): string | null {
    const ext = filePath.split('.').pop()?.toLowerCase();
    const map: Record<string, string> = {
      java: 'java',
      ts: 'typescript',
      tsx: 'tsx',
      js: 'javascript',
      py: 'python',
      go: 'go',
      rs: 'rust',
      rb: 'ruby',
      php: 'php',
    };
    return ext ? (map[ext] ?? null) : null;
  }

  private dataFlowToGraphEdge(dfe: DataFlowEdge): GraphEdge {
    // Map DataFlowType to EdgeType
    const typeMap: Record<string, EdgeType> = {
      [DataFlowType.assignment]: EdgeType.flow_to,
      [DataFlowType.call_arg]: EdgeType.calls,
      [DataFlowType.return]: EdgeType.flow_to,
      [DataFlowType.db_read]: EdgeType.reads,
      [DataFlowType.db_write]: EdgeType.writes,
    };

    return {
      id: crypto.randomUUID(),
      source: `${dfe.source.file}:${dfe.source.entity}`,
      target: `${dfe.target.file}:${dfe.target.entity}`,
      type: typeMap[dfe.type] ?? EdgeType.flow_to,
      confidence: dfe.confidence,
      weight: 1.0,
      file: dfe.source.file,
      location: {
        file: dfe.source.file,
        startLine: dfe.source.line,
      },
      metadata: {
        flowType: dfe.type,
        sourceField: dfe.source.field,
        targetField: dfe.target.field,
      },
    };
  }

  private buildInferencePrompt(edges: DataFlowEdge[]): string {
    const edgeList = edges.map((e, i) =>
      `${i + 1}. ${e.type}: ${e.source.entity} -> ${e.target.entity} (line ${e.source.line})`
    ).join('\n');

    return `Resolve these ambiguous data flow edges. For each edge, determine:
1. The actual source and target entities (resolve dynamic references)
2. Field-level mappings if applicable
3. Whether the edge is valid or should be removed

Ambiguous edges:
${edgeList}

Respond in JSON:
{
  "resolved": [
    {
      "index": 1,
      "sourceEntity": "UserService",
      "targetEntity": "UserRepository",
      "sourceField": null,
      "targetField": null,
      "valid": true,
      "confidence": "INFERRED"
    }
  ]
}`;
  }

  private parseInferenceResponse(
    content: string,
    originalEdges: DataFlowEdge[]
  ): GraphEdge[] {
    const edges: GraphEdge[] = [];

    try {
      const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) ??
        content.match(/(\{[\s\S]*\})/);
      if (!jsonMatch) return edges;

      const data = JSON.parse(jsonMatch[1]!) as {
        resolved?: Array<{
          index: number;
          sourceEntity?: string;
          targetEntity?: string;
          valid?: boolean;
          confidence?: string;
        }>;
      };

      if (data.resolved) {
        for (const resolved of data.resolved) {
          const original = originalEdges[resolved.index - 1];
          if (!original) continue;

          if (resolved.valid === false) {
            // Edge is invalid, skip it
            continue;
          }

          const edge: GraphEdge = {
            id: crypto.randomUUID(),
            source: resolved.sourceEntity ?? `${original.source.file}:${original.source.entity}`,
            target: resolved.targetEntity ?? `${original.target.file}:${original.target.entity}`,
            type: EdgeType.flow_to,
            confidence: resolved.confidence === 'AMBIGUOUS'
              ? Confidence.AMBIGUOUS
              : Confidence.INFERRED,
            weight: 1.0,
          };
          edges.push(edge);
        }
      }
    } catch {
      // Invalid JSON, return original edges
      return originalEdges.map(e => this.dataFlowToGraphEdge(e));
    }

    return edges;
  }

  // Legacy method for backward compatibility
  private buildPrompt(entities: GraphNode[]): string {
    const entityList = entities.map(e => `- ${e.label} (${e.type}) in ${e.file}`).join('\n');
    return `Analyze data lineage between these entities:
${entityList}

Identify:
1. Entity-level lineage: which entity's data flows to which other entity
2. Field-level lineage: specific field mappings between entities
3. Transformation logic: how data is transformed along the flow

Respond in JSON:
{
  "lineage": [
    {
      "source": "entity-id",
      "target": "entity-id",
      "type": "flow_to" | "one_to_one" | "one_to_many",
      "fields": [{ "source_field": "id", "target_field": "user_id", "transformation": "direct" }],
      "confidence": "INFERRED"
    }
  ]
}`;
  }

  private parseResponse(content: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const edges: GraphEdge[] = [];

    try {
      const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) ?? content.match(/(\{[\s\S]*\})/);
      if (!jsonMatch) return { nodes: [], edges };

      const data = JSON.parse(jsonMatch[1]!) as {
        lineage?: Array<{
          source: string;
          target: string;
          type: string;
          fields?: Array<{ source_field: string; target_field: string; transformation: string }>;
          confidence?: string;
        }>;
      };

      if (data.lineage) {
        for (const lin of data.lineage) {
          edges.push({
            id: crypto.randomUUID(),
            source: lin.source,
            target: lin.target,
            type: this.mapLineageType(lin.type),
            confidence: lin.confidence === 'AMBIGUOUS' ? Confidence.AMBIGUOUS : Confidence.INFERRED,
            weight: 1.0,
            metadata: { fields: lin.fields ?? [] },
          });
        }
      }
    } catch {
      // Invalid JSON
    }

    return { nodes: [], edges };
  }

  private mapLineageType(type: string): EdgeType {
    const map: Record<string, EdgeType> = {
      flow_to: EdgeType.flow_to,
      one_to_one: EdgeType.one_to_one,
      one_to_many: EdgeType.one_to_many,
      many_to_one: EdgeType.many_to_one,
      many_to_many: EdgeType.many_to_many,
    };
    return map[type] ?? EdgeType.flow_to;
  }

  onTaskStart(_task: Task): Promise<void> { return Promise.resolve(); }
  onTaskComplete(_result: AgentResult): Promise<void> { return Promise.resolve(); }
  onError(_error: Error): Promise<void> { return Promise.resolve(); }
}

export { LineageAgent, LINEAGE_CONFIG };
export type { StaticExtractOptions, StaticExtractResult };
