import { Node, Edge, Graph, createEdgeKey } from '../types/graph';

export class GraphMerger {
  private nodeMap: Map<string, Node> = new Map();
  private edgeMap: Map<string, Edge> = new Map();

  /**
   * Add nodes to the merger
   */
  addNodes(nodes: Node[]): void {
    for (const node of nodes) {
      // Later nodes with same ID override earlier ones
      this.nodeMap.set(node.id, node);
    }
  }

  /**
   * Add edges to the merger
   */
  addEdges(edges: Edge[]): void {
    for (const edge of edges) {
      const key = createEdgeKey(edge);
      // Deduplicate by edge key
      if (!this.edgeMap.has(key)) {
        this.edgeMap.set(key, edge);
      }
    }
  }

  /**
   * Merge a graph into this merger
   */
  mergeGraph(graph: { nodes: Node[]; edges: Edge[] }): void {
    this.addNodes(graph.nodes);
    this.addEdges(graph.edges);
  }

  /**
   * Get merged nodes
   */
  getNodes(): Node[] {
    return Array.from(this.nodeMap.values());
  }

  /**
   * Get merged edges
   */
  getEdges(): Edge[] {
    return Array.from(this.edgeMap.values());
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.nodeMap.clear();
    this.edgeMap.clear();
  }
}
