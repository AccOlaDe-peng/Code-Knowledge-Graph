// GraphBuildAgent — graph construction and advanced analysis

import { BaseAgent } from '../BaseAgent.ts';
import { createGraphStoreTool, type GraphStoreResult } from '../tools/GraphStoreTool.ts';
import type { AgentConfig, AgentResult, Task } from '../../coordinator/types.ts';
import type { AgentContext } from '../AgentContext.ts';
import { Confidence, NodeType, EdgeType } from '../../graph/schema.ts';
import type { GraphNode, GraphEdge } from '../../graph/schema.ts';
import * as crypto from 'node:crypto';

const GRAPH_BUILD_CONFIG: AgentConfig = {
  name: 'GraphBuildAgent',
  description: 'Builds knowledge graph with community detection, god nodes, and surprising connections',
  tools: ['GraphStoreTool'],
  // No model — pure graph algorithms, no LLM
};

interface Community {
  id: string;
  nodes: string[];
  label: string;
}

interface GodNode {
  id: string;
  label: string;
  type: NodeType;
  connections: number;
  categories: string[];
}

interface SurprisingConnection {
  source: string;
  target: string;
  reason: string;
  confidence: Confidence;
}

class GraphBuildAgent extends BaseAgent {
  private nodes: GraphNode[];
  private edges: GraphEdge[];

  constructor(id: string, context: AgentContext, nodes: GraphNode[], edges: GraphEdge[]) {
    super(id, GRAPH_BUILD_CONFIG, context, [createGraphStoreTool()]);
    this.nodes = nodes;
    this.edges = edges;
  }

  async execute(task: Task): Promise<AgentResult> {
    await this.onTaskStart(task);

    const newNodes: GraphNode[] = [];
    const newEdges: GraphEdge[] = [];

    try {
      // 1. Build adjacency map for analysis
      const adjacency = this.buildAdjacency();

      // 2. Detect communities using simple connected components
      const communities = this.detectCommunities(adjacency);
      for (const community of communities) {
        newNodes.push({
          id: `community:${community.id}`,
          label: community.label,
          type: NodeType.Module,
          file: '',
          confidence: Confidence.INFERRED,
          metadata: { nodes: community.nodes, algorithm: 'connected-components' },
        });

        // Create edges from community to member nodes
        for (const nodeId of community.nodes) {
          newEdges.push({
            id: crypto.randomUUID(),
            source: `community:${community.id}`,
            target: nodeId,
            type: EdgeType.contains,
            confidence: Confidence.INFERRED,
            weight: 1.0,
          });
        }
      }

      // 3. Identify God Nodes (highly connected nodes)
      const godNodes = this.identifyGodNodes(adjacency);
      for (const gn of godNodes) {
        newNodes.push({
          id: `godnode:${gn.id}`,
          label: gn.label,
          type: gn.type,
          file: '',
          confidence: Confidence.INFERRED,
          metadata: {
            connections: gn.connections,
            categories: gn.categories,
            warning: 'High coupling detected',
          },
        });

        // Create reference edge to original node
        newEdges.push({
          id: crypto.randomUUID(),
          source: `godnode:${gn.id}`,
          target: gn.id,
          type: EdgeType.references,
          confidence: Confidence.INFERRED,
          weight: 1.0,
        });
      }

      // 4. Find surprising connections (cross-module links)
      const surprising = this.findSurprisingConnections(adjacency, communities);
      for (const conn of surprising) {
        newEdges.push({
          id: crypto.randomUUID(),
          source: conn.source,
          target: conn.target,
          type: EdgeType.conceptually_related_to,
          confidence: conn.confidence,
          weight: 0.5,
          metadata: { reason: conn.reason, surprising: true },
        });
      }

      // 5. Save the built graph
      await this.useTool('GraphStoreTool', {
        operation: 'save',
        graph: { nodes: [...this.nodes, ...newNodes], edges: [...this.edges, ...newEdges] },
      }) as GraphStoreResult;

      const result = this.createResult(newNodes, newEdges, {
        confidence: Confidence.INFERRED,
        source: 'graph-build',
        filesProcessed: [],
        tokensUsed: 0,
      });

      await this.onTaskComplete(result);
      return result;
    } catch (error) {
      await this.onError(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  private buildAdjacency(): Map<string, Set<string>> {
    const adjacency = new Map<string, Set<string>>();

    for (const node of this.nodes) {
      adjacency.set(node.id, new Set());
    }

    for (const edge of this.edges) {
      const sourceSet = adjacency.get(edge.source);
      if (sourceSet) {
        sourceSet.add(edge.target);
      }
      // Bidirectional for undirected analysis
      const targetSet = adjacency.get(edge.target);
      if (targetSet) {
        targetSet.add(edge.source);
      }
    }

    return adjacency;
  }

  private detectCommunities(adjacency: Map<string, Set<string>>): Community[] {
    const visited = new Set<string>();
    const communities: Community[] = [];
    let communityId = 0;

    for (const [nodeId] of adjacency) {
      if (visited.has(nodeId)) continue;

      // BFS to find connected component
      const component: string[] = [];
      const queue = [nodeId];

      while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;

        visited.add(current);
        component.push(current);

        const neighbors = adjacency.get(current);
        if (neighbors) {
          for (const neighbor of neighbors) {
            if (!visited.has(neighbor)) {
              queue.push(neighbor);
            }
          }
        }
      }

      if (component.length >= 2) {
        communities.push({
          id: `c${communityId++}`,
          nodes: component,
          label: `Community-${communityId}`,
        });
      }
    }

    return communities;
  }

  private identifyGodNodes(adjacency: Map<string, Set<string>>): GodNode[] {
    const THRESHOLD = 5; // 5+ connections = god node
    const godNodes: GodNode[] = [];

    for (const [nodeId, neighbors] of adjacency) {
      if (neighbors.size >= THRESHOLD) {
        const node = this.nodes.find(n => n.id === nodeId);
        if (node) {
          // Categorize by type
          const categories: string[] = [node.type];
          if (node.metadata?.category) {
            categories.push(String(node.metadata.category));
          }

          godNodes.push({
            id: nodeId,
            label: node.label,
            type: node.type,
            connections: neighbors.size,
            categories,
          });
        }
      }
    }

    return godNodes;
  }

  private findSurprisingConnections(
    adjacency: Map<string, Set<string>>,
    communities: Community[],
  ): SurprisingConnection[] {
    const surprising: SurprisingConnection[] = [];

    // Build node -> community map
    const nodeToCommunity = new Map<string, string>();
    for (const community of communities) {
      for (const nodeId of community.nodes) {
        nodeToCommunity.set(nodeId, community.id);
      }
    }

    // Find edges crossing community boundaries
    for (const edge of this.edges) {
      const sourceCommunity = nodeToCommunity.get(edge.source);
      const targetCommunity = nodeToCommunity.get(edge.target);

      if (sourceCommunity && targetCommunity && sourceCommunity !== targetCommunity) {
        const sourceNode = this.nodes.find(n => n.id === edge.source);
        const targetNode = this.nodes.find(n => n.id === edge.target);

        if (sourceNode && targetNode) {
          surprising.push({
            source: edge.source,
            target: edge.target,
            reason: `Cross-module connection: ${sourceNode.label} → ${targetNode.label}`,
            confidence: Confidence.AMBIGUOUS,
          });
        }
      }
    }

    return surprising;
  }

  onTaskStart(_task: Task): Promise<void> { return Promise.resolve(); }
  onTaskComplete(_result: AgentResult): Promise<void> { return Promise.resolve(); }
  onError(_error: Error): Promise<void> { return Promise.resolve(); }
}

export { GraphBuildAgent, GRAPH_BUILD_CONFIG };
