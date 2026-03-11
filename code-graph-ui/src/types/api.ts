import type { Graph, GraphMetrics, GraphNode, GraphEdge } from './graph'

// ─── Repo / Graph Metadata ────────────────────────────────────────────────────

export type RepoInfo = {
  graphId: string
  repoName: string
  language: string[]
  createdAt: string
  nodeCount: number
  edgeCount: number
  gitCommit?: string
}

// ─── GET /graph ───────────────────────────────────────────────────────────────

/** No graph_id → list of repos */
export type GraphListResponse = {
  graphs: RepoInfo[]
}

/** With graph_id → full graph + metadata */
export type GraphDetailResponse = Graph & {
  graphId: string
  repoName: string
  metrics: GraphMetrics
}

// ─── Graph View Responses (all extend Graph) ──────────────────────────────────

/** GET /callgraph — Function/API nodes + calls edges */
export type CallGraphResponse = Graph & { graphId: string }

/** GET /lineage — depends_on / reads / writes / produces / consumes */
export type LineageGraphResponse = Graph & { graphId: string }

/** GET /events — publishes / subscribes / produces / consumes */
export type EventsGraphResponse = Graph & { graphId: string }

/** GET /services — Service / Cluster / Database nodes */
export type ServicesGraphResponse = Graph & { graphId: string }

// ─── POST /analyze/repository ─────────────────────────────────────────────────

export type AnalyzeRepoRequest = {
  repoPath: string
  repoName?: string
  languages?: string[]
  enableAi?: boolean
  enableRag?: boolean
}

export type AnalyzeRepoResponse = {
  graphId: string
  repoName: string
  nodeCount: number
  edgeCount: number
  duration: number
  stepStats: Record<string, number>
}

// ─── POST /query ──────────────────────────────────────────────────────────────

export type RagQueryRequest = {
  graphId: string
  question: string
}

export type RagQueryResponse = {
  question: string
  answer: string
  nodes: GraphNode[]
  edges: GraphEdge[]
  sources: string[]
  confidence: number
}

// ─── Error ────────────────────────────────────────────────────────────────────

export type ApiError = {
  detail: string
  status?: number
}
