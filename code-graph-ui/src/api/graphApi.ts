import axios, { type AxiosInstance } from 'axios'
import type {
  GraphListResponse,
  GraphDetailResponse,
  CallGraphResponse,
  LineageGraphResponse,
  EventsGraphResponse,
  ServicesGraphResponse,
} from '../types/api'

// ─── HTTP Client ──────────────────────────────────────────────────────────────

const httpClient: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000',
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
})

httpClient.interceptors.request.use(
  (config) => config,
  (err) => Promise.reject(err),
)

httpClient.interceptors.response.use(
  (res) => res.data,
  (err) => {
    const message: string =
      err.response?.data?.detail ?? err.message ?? 'Request failed'
    return Promise.reject(new Error(message))
  },
)

export default httpClient

// ─── Graph API ────────────────────────────────────────────────────────────────

export const graphApi = {
  /**
   * GET /graph
   * No graphId → returns list of analyzed repos.
   * With graphId → returns full graph (nodes + edges + metrics).
   */
  async listGraphs(): Promise<GraphListResponse> {
    const raw: { graphs: Record<string, unknown>[] } = await httpClient.get('/graph')
    return {
      graphs: (raw.graphs ?? []).map((g) => ({
        graphId:   g.graph_id   as string,
        repoName:  g.repo_name  as string,
        language:  (g.languages ?? g.language ?? []) as string[],
        createdAt: g.created_at as string,
        nodeCount: g.node_count as number,
        edgeCount: g.edge_count as number,
        gitCommit: g.git_commit as string | undefined,
      })),
    }
  },

  getGraph(graphId: string): Promise<GraphDetailResponse> {
    return httpClient.get('/graph', { params: { graph_id: graphId } })
  },

  /**
   * GET /callgraph
   * Returns Function/API nodes and their calls edges.
   */
  getCallGraph(graphId: string): Promise<CallGraphResponse> {
    return httpClient.get('/callgraph', { params: { graph_id: graphId } })
  },

  /**
   * GET /lineage
   * Returns nodes connected by depends_on / reads / writes / produces / consumes.
   */
  getLineageGraph(graphId: string): Promise<LineageGraphResponse> {
    return httpClient.get('/lineage', { params: { graph_id: graphId } })
  },

  /**
   * GET /events
   * Returns Event nodes and their publishes / subscribes edges.
   */
  getEventsGraph(graphId: string): Promise<EventsGraphResponse> {
    return httpClient.get('/events', { params: { graph_id: graphId } })
  },

  /**
   * GET /services
   * Returns Service / Cluster / Database nodes.
   */
  getServicesGraph(graphId: string): Promise<ServicesGraphResponse> {
    return httpClient.get('/services', { params: { graph_id: graphId } })
  },

  // ─── New GraphPipeline endpoints ──────────────────────────────────────────

  /**
   * GET /graph/data
   * Full JSON Graph from GraphStorage (new pipeline format).
   * Nodes have lowercase types: function, class, module, file, api, database, table
   */
  getGraphData(repoId: string): Promise<{ repo_id: string; node_count: number; edge_count: number; nodes: RawNode[]; edges: RawEdge[] }> {
    return httpClient.get('/graph/data', { params: { repo_id: repoId } })
  },

  /**
   * GET /graph/call
   * Call subgraph (calls edges + related nodes).
   */
  getCallSubgraph(repoId: string): Promise<{ repo_id: string; node_count: number; edge_count: number; nodes: RawNode[]; edges: RawEdge[] }> {
    return httpClient.get('/graph/call', { params: { repo_id: repoId } })
  },

  /**
   * GET /graph/module
   * Module structure subgraph (contains/imports edges + related nodes).
   * edge_type: "contains" | "imports" | "all"
   */
  getModuleSubgraph(repoId: string, edgeType: 'contains' | 'imports' | 'all' = 'all'): Promise<{ repo_id: string; node_count: number; edge_count: number; nodes: RawNode[]; edges: RawEdge[] }> {
    return httpClient.get('/graph/module', { params: { repo_id: repoId, edge_type: edgeType } })
  },
}

// ─── Raw node/edge types from new pipeline ────────────────────────────────────

export type RawNode = {
  id:       string
  type:     string   // lowercase: function, class, module, file, api, database, table, repository
  name?:    string
  file?:    string
  line?:    number
  module?:  string
  language?: string
}

export type RawEdge = {
  from: string
  to:   string
  type: string   // contains, calls, imports, reads, writes
}

/** Normalize raw node to GraphNode (label = name or id-derived) */
export function rawNodeToGraphNode(n: RawNode): import('../types/graph').GraphNode {
  const label = n.name || n.id.split(':').pop()?.split('.').pop() || n.id
  return {
    id:         n.id,
    type:       n.type,
    label,
    properties: { file: n.file, line: n.line, module: n.module, language: n.language },
  }
}

/** Normalize raw edge to GraphEdge (from/to → source/target) */
export function rawEdgeToGraphEdge(e: RawEdge): import('../types/graph').GraphEdge {
  return { source: e.from, target: e.to, type: e.type }
}
