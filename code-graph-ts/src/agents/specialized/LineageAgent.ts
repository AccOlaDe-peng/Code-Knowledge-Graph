// LineageAgent — data lineage inference

import { BaseAgent } from '../BaseAgent.ts';
import { createLLMTool, type LLMResponse } from '../tools/LLMTool.ts';
import type { AgentConfig, AgentResult, Task } from '../../coordinator/types.ts';
import type { AgentContext } from '../AgentContext.ts';
import { Confidence, EdgeType } from '../../graph/schema.ts';
import type { GraphNode, GraphEdge } from '../../graph/schema.ts';
import * as crypto from 'node:crypto';

const LINEAGE_CONFIG: AgentConfig = {
  name: 'LineageAgent',
  description: 'Infers entity-level and field-level data lineage relationships',
  tools: ['LLMTool'],
  model: 'sonnet',
};

class LineageAgent extends BaseAgent {
  private graphNodes: GraphNode[];

  constructor(id: string, context: AgentContext, existingNodes: GraphNode[]) {
    super(id, LINEAGE_CONFIG, context, [createLLMTool()]);
    this.graphNodes = existingNodes;
  }

  async execute(task: Task): Promise<AgentResult> {
    await this.onTaskStart(task);

    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    let tokensUsed = 0;

    try {
      // Build prompt for lineage analysis
      const entityNodes = this.graphNodes.filter(
        n => n.type === 'Entity' || n.type === 'Table' || n.type === 'Service',
      );

      if (entityNodes.length === 0) {
        return this.createResult(nodes, edges, {
          confidence: Confidence.INFERRED,
          source: 'lineage',
          filesProcessed: [],
          tokensUsed: 0,
        });
      }

      const prompt = this.buildPrompt(entityNodes);
      const response = await this.useTool('LLMTool', {
        prompt,
        config: { model: 'sonnet', maxTokens: 4096 },
      }) as LLMResponse;

      tokensUsed = response.tokensUsed;

      // Parse lineage relationships
      const { nodes: parsedNodes, edges: parsedEdges } = this.parseResponse(response.content);
      nodes.push(...parsedNodes);
      edges.push(...parsedEdges);

      const result = this.createResult(nodes, edges, {
        confidence: Confidence.INFERRED,
        source: 'lineage',
        filesProcessed: [],
        tokensUsed,
      });

      await this.onTaskComplete(result);
      return result;
    } catch (error) {
      await this.onError(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

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
