import { JSONStorage } from './json-storage';
import { Graph, Node, Edge } from '../types/graph';

export class GraphLoader {
  constructor(private storage: JSONStorage) {}

  /**
   * Load graph by ID (format: repoId/graphType)
   */
  async loadById(graphId: string): Promise<Graph> {
    const [repoId, graphType] = graphId.split('/');
    if (!repoId || !graphType) {
      throw new Error(`Invalid graph ID format: ${graphId}. Expected: repoId/graphType`);
    }

    return this.storage.loadGraph(repoId, graphType);
  }

  /**
   * Load multiple graphs and merge them
   */
  async loadAndMerge(graphIds: string[]): Promise<{ nodes: Node[]; edges: Edge[] }> {
    const allNodes: Node[] = [];
    const allEdges: Edge[] = [];

    for (const graphId of graphIds) {
      const graph = await this.loadById(graphId);
      allNodes.push(...graph.nodes);
      allEdges.push(...graph.edges);
    }

    // Deduplicate
    const nodeMap = new Map<string, Node>();
    for (const node of allNodes) {
      nodeMap.set(node.id, node);
    }

    const edgeMap = new Map<string, Edge>();
    for (const edge of allEdges) {
      const key = `${edge.from}|${edge.to}|${edge.type}`;
      edgeMap.set(key, edge);
    }

    return {
      nodes: Array.from(nodeMap.values()),
      edges: Array.from(edgeMap.values()),
    };
  }

  /**
   * Search graphs by repository name
   */
  async searchByRepo(repoName: string): Promise<Graph[]> {
    const metadata = await this.storage.listGraphs();
    const matching = metadata.filter(m =>
      m.repoName.toLowerCase().includes(repoName.toLowerCase())
    );

    const graphs: Graph[] = [];
    for (const meta of matching) {
      try {
        const graph = await this.loadById(meta.graphId);
        graphs.push(graph);
      } catch (error) {
        console.error(`Failed to load graph ${meta.graphId}:`, error);
      }
    }

    return graphs;
  }

  /**
   * Get graph statistics
   */
  async getStatistics(graphId: string): Promise<{
    nodeCount: number;
    edgeCount: number;
    nodeTypeDistribution: Record<string, number>;
    edgeTypeDistribution: Record<string, number>;
  }> {
    const graph = await this.loadById(graphId);

    const nodeTypeDistribution: Record<string, number> = {};
    for (const node of graph.nodes) {
      nodeTypeDistribution[node.type] = (nodeTypeDistribution[node.type] || 0) + 1;
    }

    const edgeTypeDistribution: Record<string, number> = {};
    for (const edge of graph.edges) {
      edgeTypeDistribution[edge.type] = (edgeTypeDistribution[edge.type] || 0) + 1;
    }

    return {
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      nodeTypeDistribution,
      edgeTypeDistribution,
    };
  }
}
