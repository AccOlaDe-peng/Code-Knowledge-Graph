// ─── Raw Backend Wire Format ──────────────────────────────────────────────────
// The backend sends snake_case with `name` instead of `label`.
// These types represent what actually arrives over the wire before normalization.

export type RawNode = {
  id:          string
  type:        string
  /** Backend uses `name`; the engine normalizes this to `label`. */
  name:        string
  properties?: Record<string, unknown>
  /** Optional backend-computed metrics attached to nodes. */
  metrics?: {
    in_degree?:  number
    out_degree?: number
    pagerank?:   number
  }
}

export type RawEdge = {
  /** Backend field name: `from` (not `source`). */
  from:        string
  to:          string
  type:        string
  properties?: Record<string, unknown>
}

// ─── API Request Parameters ───────────────────────────────────────────────────

export type SummaryParams = {
  graph_id: string
}

export type ExpandParams = {
  graph_id: string
  node_id:  string
  /** Max depth of children to return. Default 1. */
  depth?:   number
}

export type BatchParams = {
  graph_id: string
  limit:    number
  offset:   number
  /** Optional comma-separated NodeType filter (e.g. "Function,Class"). */
  types?:   string
}

// ─── API Responses ────────────────────────────────────────────────────────────

/**
 * GET /graph/summary?graph_id=
 * Returns only Repository + Module nodes (LOD-0 and LOD-1).
 * Also reports the full-graph counts for progress planning.
 */
export type SummaryResponse = {
  graph_id:          string
  nodes:             RawNode[]
  edges:             RawEdge[]
  /** Total node count across ALL LOD levels (used for progress bar). */
  total_node_count:  number
  /** Total edge count across ALL LOD levels. */
  total_edge_count:  number
}

/**
 * GET /graph/expand?graph_id=&node_id=
 * Returns direct children of the given node plus their connecting edges.
 */
export type ExpandResponse = {
  node_id:  string
  graph_id: string
  nodes:    RawNode[]
  edges:    RawEdge[]
  /** True when the expanded node has grandchildren not yet returned. */
  has_more: boolean
}

/**
 * GET /graph?graph_id=&limit=&offset=
 * Paginated access to the full graph.
 * Re-uses the existing /graph endpoint with new optional params.
 */
export type BatchResponse = {
  graph_id:         string
  nodes:            RawNode[]
  edges:            RawEdge[]
  total_node_count: number
  total_edge_count: number
  offset:           number
  limit:            number
  has_more:         boolean
}

// ─── Normalized Loader Results ────────────────────────────────────────────────
// Returned by GraphLoader methods after the store has been updated.

export type LoadInitialResult = {
  nodeCount:      number
  edgeCount:      number
  /** Full-graph totals (for streaming-progress UX). */
  totalNodeCount: number
  totalEdgeCount: number
}

export type ExpandResult = {
  nodeId:    string
  nodeCount: number
  edgeCount: number
  hasMore:   boolean
}

export type LoadBatchResult = {
  nodeCount:      number
  edgeCount:      number
  totalNodeCount: number
  totalEdgeCount: number
  nextOffset:     number
  hasMore:        boolean
}

// ─── Internal BatchQueue Work Item ───────────────────────────────────────────
// The BatchQueue processes one WorkItem per animation frame.

export type WorkItemKind = 'nodes' | 'edges'

export type WorkItem =
  | { kind: 'nodes'; batch: import('../types').EngineGraphNode[] }
  | { kind: 'edges'; batch: import('../types').EngineGraphEdge[] }

export type BatchProgress = {
  processed: number
  total:     number
  /** Fraction 0–1. */
  ratio:     number
}
