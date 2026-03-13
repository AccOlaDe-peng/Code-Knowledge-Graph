import * as fs from 'fs/promises';
import * as path from 'path';
import { Graph, Node, Edge } from '../types/graph';

export interface StorageMetadata {
  graphId: string;
  repoName: string;
  graphType: string;
  createdAt: string;
  nodeCount: number;
  edgeCount: number;
}

export class JSONStorage {
  private basePath: string;
  private indexPath: string;

  constructor(basePath: string = './graph-storage') {
    this.basePath = basePath;
    this.indexPath = path.join(basePath, 'index.json');
  }

  /**
   * Initialize storage directory
   */
  async initialize(): Promise<void> {
    await fs.mkdir(this.basePath, { recursive: true });

    // Create index file if it doesn't exist
    try {
      await fs.access(this.indexPath);
    } catch {
      await fs.writeFile(this.indexPath, JSON.stringify([], null, 2));
    }
  }

  /**
   * Save a graph to storage
   */
  async saveGraph(
    repoId: string,
    graphType: string,
    graph: Graph
  ): Promise<string> {
    await this.initialize();

    // Create repository directory
    const repoDir = path.join(this.basePath, repoId);
    await fs.mkdir(repoDir, { recursive: true });

    // Save graph file
    const graphPath = path.join(repoDir, `${graphType}.json`);
    await fs.writeFile(graphPath, JSON.stringify(graph, null, 2));

    // Update index
    const graphId = `${repoId}/${graphType}`;
    await this.updateIndex({
      graphId,
      repoName: graph.repo.name,
      graphType,
      createdAt: graph.metadata.createdAt,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
    });

    console.log(`✓ Saved graph: ${graphId} (${graph.nodes.length} nodes, ${graph.edges.length} edges)`);

    return graphId;
  }

  /**
   * Load a graph from storage
   */
  async loadGraph(repoId: string, graphType: string): Promise<Graph> {
    const graphPath = path.join(this.basePath, repoId, `${graphType}.json`);

    try {
      const content = await fs.readFile(graphPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      throw new Error(`Graph not found: ${repoId}/${graphType}`);
    }
  }

  /**
   * Get a subgraph containing specific nodes and their neighbors
   */
  async getSubGraph(
    repoId: string,
    graphType: string,
    nodeIds: string[],
    depth: number = 1
  ): Promise<{ nodes: Node[]; edges: Edge[] }> {
    const graph = await this.loadGraph(repoId, graphType);

    const nodeIdSet = new Set(nodeIds);
    const visitedNodes = new Set<string>();
    const resultNodes: Node[] = [];
    const resultEdges: Edge[] = [];

    // Build adjacency map
    const adjacencyMap = new Map<string, Set<string>>();
    for (const edge of graph.edges) {
      if (!adjacencyMap.has(edge.from)) {
        adjacencyMap.set(edge.from, new Set());
      }
      adjacencyMap.get(edge.from)!.add(edge.to);

      if (!adjacencyMap.has(edge.to)) {
        adjacencyMap.set(edge.to, new Set());
      }
      adjacencyMap.get(edge.to)!.add(edge.from);
    }

    // BFS to find nodes within depth
    const queue: Array<{ id: string; currentDepth: number }> = [];
    for (const id of nodeIds) {
      queue.push({ id, currentDepth: 0 });
      visitedNodes.add(id);
    }

    while (queue.length > 0) {
      const { id, currentDepth } = queue.shift()!;

      if (currentDepth < depth) {
        const neighbors = adjacencyMap.get(id) || new Set();
        for (const neighborId of neighbors) {
          if (!visitedNodes.has(neighborId)) {
            visitedNodes.add(neighborId);
            queue.push({ id: neighborId, currentDepth: currentDepth + 1 });
          }
        }
      }
    }

    // Collect nodes
    const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));
    for (const id of visitedNodes) {
      const node = nodeMap.get(id);
      if (node) {
        resultNodes.push(node);
      }
    }

    // Collect edges between selected nodes
    for (const edge of graph.edges) {
      if (visitedNodes.has(edge.from) && visitedNodes.has(edge.to)) {
        resultEdges.push(edge);
      }
    }

    return { nodes: resultNodes, edges: resultEdges };
  }

  /**
   * List all graphs in storage
   */
  async listGraphs(): Promise<StorageMetadata[]> {
    try {
      const content = await fs.readFile(this.indexPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return [];
    }
  }

  /**
   * Delete a graph
   */
  async deleteGraph(repoId: string, graphType?: string): Promise<void> {
    if (graphType) {
      // Delete specific graph type
      const graphPath = path.join(this.basePath, repoId, `${graphType}.json`);
      await fs.unlink(graphPath);

      // Update index
      const index = await this.listGraphs();
      const filtered = index.filter(m => m.graphId !== `${repoId}/${graphType}`);
      await fs.writeFile(this.indexPath, JSON.stringify(filtered, null, 2));
    } else {
      // Delete entire repository
      const repoDir = path.join(this.basePath, repoId);
      await fs.rm(repoDir, { recursive: true, force: true });

      // Update index
      const index = await this.listGraphs();
      const filtered = index.filter(m => !m.graphId.startsWith(`${repoId}/`));
      await fs.writeFile(this.indexPath, JSON.stringify(filtered, null, 2));
    }

    console.log(`✓ Deleted graph: ${repoId}${graphType ? '/' + graphType : ''}`);
  }

  /**
   * Update the index file
   */
  private async updateIndex(metadata: StorageMetadata): Promise<void> {
    const index = await this.listGraphs();

    // Remove existing entry if present
    const filtered = index.filter(m => m.graphId !== metadata.graphId);

    // Add new entry
    filtered.push(metadata);

    // Sort by creation date (newest first)
    filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    await fs.writeFile(this.indexPath, JSON.stringify(filtered, null, 2));
  }
}
