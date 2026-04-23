// Merger — deterministic merge with explicit priority ordering

import type { GraphNode, GraphEdge, GraphData } from '../graph/schema.ts';
import { CONFIDENCE_PRIORITY, SOURCE_PRIORITY } from '../graph/schema.ts';
import type { AgentResult } from './types.ts';

/**
 * Merger combines multiple AgentResults with deterministic priority.
 *
 * Key rules:
 * 1. Nodes: higher confidence wins (EXTRACTED > INFERRED > AMBIGUOUS)
 * 2. Edges: higher confidence wins for same source+target+type
 * 3. Sort by SOURCE_PRIORITY before merge (explicit, not alphabetic)
 */
class Merger {
  /**
   * Merge multiple AgentResults into a single GraphData
   */
  merge(results: AgentResult[]): GraphData {
    const mergedNodes = new Map<string, GraphNode>();
    const mergedEdges = new Map<string, GraphEdge>();

    // Sort by source priority (explicit, not alphabetic)
    const sortedResults = results.sort((a, b) => {
      const priorityA = SOURCE_PRIORITY[a.metadata.source] ?? 0;
      const priorityB = SOURCE_PRIORITY[b.metadata.source] ?? 0;
      return priorityB - priorityA; // Higher priority first
    });

    for (const result of sortedResults) {
      // Merge nodes
      for (const node of result.nodes) {
        const existing = mergedNodes.get(node.id);
        if (!existing || this.shouldOverrideNode(existing, node)) {
          mergedNodes.set(node.id, node);
        }
      }

      // Merge edges
      for (const edge of result.edges) {
        const key = this.edgeKey(edge);
        const existing = mergedEdges.get(key);
        if (!existing || this.shouldOverrideEdge(existing, edge)) {
          mergedEdges.set(key, edge);
        }
      }
    }

    return {
      nodes: [...mergedNodes.values()],
      edges: [...mergedEdges.values()],
    };
  }

  /**
   * Create edge deduplication key
   */
  private edgeKey(edge: GraphEdge): string {
    return `${edge.source}:${edge.target}:${edge.type}`;
  }

  /**
   * Determine if incoming node should override existing
   * Uses same priority logic as edges
   */
  private shouldOverrideNode(existing: GraphNode, incoming: GraphNode): boolean {
    const existingPriority = CONFIDENCE_PRIORITY[existing.confidence ?? 'AMBIGUOUS'] ?? 0;
    const incomingPriority = CONFIDENCE_PRIORITY[incoming.confidence ?? 'AMBIGUOUS'] ?? 0;
    return incomingPriority > existingPriority;
  }

  /**
   * Determine if incoming edge should override existing
   */
  private shouldOverrideEdge(existing: GraphEdge, incoming: GraphEdge): boolean {
    const existingPriority = CONFIDENCE_PRIORITY[existing.confidence] ?? 0;
    const incomingPriority = CONFIDENCE_PRIORITY[incoming.confidence] ?? 0;
    return incomingPriority > existingPriority;
  }

  /**
   * Merge two GraphData objects (useful for incremental updates)
   */
  mergeGraphData(existing: GraphData, incoming: GraphData): GraphData {
    // Convert to AgentResult-like format
    const existingResult: AgentResult = {
      agentId: 'existing',
      nodes: existing.nodes,
      edges: existing.edges,
      metadata: { confidence: 'AMBIGUOUS', source: 'semantic', filesProcessed: [] },
    };
    const incomingResult: AgentResult = {
      agentId: 'incoming',
      nodes: incoming.nodes,
      edges: incoming.edges,
      metadata: { confidence: 'AMBIGUOUS', source: 'semantic', filesProcessed: [] },
    };
    return this.merge([existingResult, incomingResult]);
  }
}

export { Merger };
