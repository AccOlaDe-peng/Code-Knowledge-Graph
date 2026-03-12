// ─── Node / Edge Input (Wire format sent to Worker) ──────────────────────────

/**
 * Minimal representation of a node for layout purposes.
 * Only topology and dimensions matter — no labels or properties.
 */
export type LayoutNodeInput = {
  id:     string
  /** Pixel width of the rendered node (used for dagre spacing). */
  width:  number
  /** Pixel height of the rendered node. */
  height: number
  /**
   * When true, this node already has a position and should NOT be
   * repositioned by the layout. Used for incremental layout where
   * only newly-added nodes need placement.
   */
  fixed:  boolean
  /** Existing x coordinate (only meaningful when fixed = true). */
  x?:     number
  /** Existing y coordinate (only meaningful when fixed = true). */
  y?:     number
}

export type LayoutEdgeInput = {
  /** Stable edge ID from EngineGraphEdge (source::type::target). */
  id:      string
  source:  string
  target:  string
  /** Higher weight → dagre tries to keep the edge shorter. Default 1. */
  weight?: number
}

// ─── Dagre Configuration ─────────────────────────────────────────────────────

export type RankDir = 'TB' | 'LR' | 'BT' | 'RL'
export type Align   = 'UL' | 'UR' | 'DL' | 'DR'

export type DagreConfig = {
  /** Graph direction. TB = top-to-bottom (default for code hierarchies). */
  rankdir: RankDir
  /** Pixels between rank layers (vertical spacing for TB). */
  ranksep: number
  /** Pixels between nodes within the same rank. */
  nodesep: number
  /** Minimum pixels between edges within the same rank. */
  edgesep: number
  /** Graph margin on the x-axis. */
  marginx: number
  /** Graph margin on the y-axis. */
  marginy: number
  /**
   * Alignment of nodes within their rank.
   * UL = upper-left, UR = upper-right, DL = down-left, DR = down-right.
   */
  align?: Align
}

export const DEFAULT_DAGRE_CONFIG: DagreConfig = {
  rankdir: 'TB',
  ranksep: 120,
  nodesep: 80,
  edgesep: 20,
  marginx: 60,
  marginy: 60,
}

export const DEFAULT_NODE_SIZE = {
  width:  140,
  height:  52,
} as const

// ─── Layout Output ────────────────────────────────────────────────────────────

/** Computed center-point position for a single node. */
export type NodePosition = {
  id:     string
  x:      number
  y:      number
  /** Echoed back from input (useful for Cytoscape element updates). */
  width:  number
  height: number
}

/**
 * Computed path for a single edge.
 * `points` are the dagre waypoints (first = source port, last = target port,
 * middle = bend points). `svgPath` is ready for `<path d="..." />`.
 */
export type EdgePath = {
  /** Matches LayoutEdgeInput.id. */
  id:      string
  source:  string
  target:  string
  /** Ordered waypoints including source and target port coordinates. */
  points:  ReadonlyArray<{ x: number; y: number }>
  /** Pre-computed SVG cubic bezier path string. */
  svgPath: string
}

export type LayoutMetrics = {
  /** Total pixel width of the laid-out graph bounding box. */
  graphWidth:  number
  /** Total pixel height of the laid-out graph bounding box. */
  graphHeight: number
  /** Wall-clock time (ms) spent inside the dagre layout call. */
  duration:    number
  nodeCount:   number
  edgeCount:   number
}

/** Combined result returned by GraphLayoutWorker.computeLayout(). */
export type LayoutResult = {
  positions:   NodePosition[]
  edgePaths:   EdgePath[]
  metrics:     LayoutMetrics
}

// ─── Worker Message Protocol ──────────────────────────────────────────────────

/** Message sent from the main thread to the layout worker. */
export type LayoutRequest = {
  type:      'COMPUTE_LAYOUT'
  requestId: string
  nodes:     LayoutNodeInput[]
  edges:     LayoutEdgeInput[]
  config:    DagreConfig
}

/** Messages sent from the worker back to the main thread. */
export type LayoutResponse =
  | {
      type:       'LAYOUT_RESULT'
      requestId:  string
      positions:  NodePosition[]
      edgePaths:  EdgePath[]
      metrics:    LayoutMetrics
    }
  | {
      type:      'LAYOUT_ERROR'
      requestId: string
      error:     string
    }

// ─── GraphLayoutWorker Options ────────────────────────────────────────────────

export type LayoutWorkerOptions = {
  /**
   * Ms to wait before aborting a worker computation.
   * On timeout the returned Promise rejects with a TimeoutError.
   * Default: 8000.
   */
  timeoutMs?: number
}
