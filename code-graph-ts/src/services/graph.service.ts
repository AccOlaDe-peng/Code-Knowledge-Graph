import { GraphStore } from '../stores/graph-store.js'
import type { GraphNode, GraphEdge, GraphData } from '../types/graph.js'

export class GraphService {
  private graphStore: GraphStore

  constructor(graphStore: GraphStore) {
    this.graphStore = graphStore
  }

  getFramework(repoId: string, nodeTypes?: string[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const graph = this.graphStore.getGraph(repoId)
    if (!nodeTypes || nodeTypes.includes('all')) {
      return graph
    }
    const filteredNodeIds = new Set(
      graph.nodes.filter(n => nodeTypes.includes(n.type)).map(n => n.id)
    )
    const nodes = graph.nodes.filter(n => filteredNodeIds.has(n.id))
    const edges = graph.edges.filter(e => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target))
    return { nodes, edges }
  }

  getLineage(repoId: string, _options?: { edgeTypes?: string[]; nodeId?: string; depth?: number; direction?: string; moduleId?: string; includeCalls?: boolean }): GraphData {
    return this.graphStore.getGraph(repoId)
  }

  getLineageModules(repoId: string): { modules: unknown[]; edges: unknown[]; moduleCount: number; edgeCount: number } {
    return { modules: [], edges: [], moduleCount: 0, edgeCount: 0 }
  }

  getFunctionCallGraph(repoId: string): Record<string, unknown> {
    return {
      repo_id: repoId,
      project_name: '',
      total_modules: 0,
      total_functions: 0,
      total_call_chains: 0,
      modules: [],
      call_chains: [],
      module_calls: [],
    }
  }

  getArchitecture(repoId: string): Record<string, unknown> {
    return {
      name: '',
      layers: [],
    }
  }

  getServicesGraph(graphId: string): { graphId: string; nodes: GraphNode[]; edges: GraphEdge[] } {
    return { graphId, nodes: [], edges: [] }
  }

  getEventsGraph(graphId: string): { graphId: string; nodes: GraphNode[]; edges: GraphEdge[] } {
    return { graphId, nodes: [], edges: [] }
  }
}
