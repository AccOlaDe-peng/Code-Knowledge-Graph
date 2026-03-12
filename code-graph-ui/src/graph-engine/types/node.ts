// ─── Render Priority ─────────────────────────────────────────────────────────
// Controls BatchQueue ordering: lower value = higher priority

export const RenderPriority = {
  /** Viewport-visible AND selected/highlighted */
  Critical: 0,
  /** Viewport-visible */
  High:     1,
  /** Inside viewport buffer zone (20% margin beyond visible area) */
  Normal:   2,
  /** Outside viewport entirely */
  Low:      3,
} as const

export type RenderPriorityValue = (typeof RenderPriority)[keyof typeof RenderPriority]

// ─── Node Position ────────────────────────────────────────────────────────────

export type NodePosition = {
  x: number
  y: number
}

// ─── Engine Graph Node ────────────────────────────────────────────────────────
// Extends the raw API GraphNode with engine-managed runtime state.
// The API shape { id, type, label, properties } lives in src/types/graph.ts;
// EngineGraphNode wraps it and adds layout, visibility, cluster, and LOD data.

export type EngineGraphNode = {
  // ── Identity (mirrors API response) ──────────────────────────────────────
  id:         string
  type:       string                      // NodeType value or arbitrary string
  label:      string                      // display name
  properties: Record<string, unknown>

  // ── Layout ───────────────────────────────────────────────────────────────
  /** Graph-space coordinate. null until LayoutManager assigns a position. */
  position: NodePosition | null

  // ── Visibility ───────────────────────────────────────────────────────────
  /**
   * Master visibility flag.
   * false when: viewport-culled OR LOD-hidden OR filter-hidden.
   * Maps to Cytoscape `display: none` — element stays in cy, not removed.
   */
  visible:    boolean
  /** True when the node's position falls within the current viewport BBox. */
  inViewport: boolean

  // ── Cluster membership ───────────────────────────────────────────────────
  /** ID of the GraphCluster this node belongs to. null = unclustered. */
  clusterId:      string | null
  /**
   * True when this node is the synthetic proxy/compound node representing
   * a collapsed cluster in Cytoscape (not a real graph node).
   */
  isClusterProxy: boolean

  // ── Lazy expansion ───────────────────────────────────────────────────────
  /** True after LazyExpander has fetched and merged this node's children. */
  expanded:       boolean
  /** Backend signals that child nodes exist for this node. */
  hasChildren:    boolean
  /** Child nodes have been fetched at least once (may be re-collapsed). */
  childrenLoaded: boolean

  // ── Render hints ─────────────────────────────────────────────────────────
  /** Drives BatchQueue ordering and viewport-buffer decisions. */
  renderPriority: RenderPriorityValue
  /** In-degree + out-degree. Used by DensityReducer for cluster thresholds. */
  degree:    number
  /** PageRank score 0–1 from backend metrics. Used for importance-based LOD. */
  pageRank:  number
}

// ─── Factory ──────────────────────────────────────────────────────────────────
// Creates an EngineGraphNode with safe defaults from a raw API node.

export function createEngineNode(raw: {
  id:          string
  type:        string
  label:       string
  properties?: Record<string, unknown>
  hasChildren?: boolean
  degree?:      number
  pageRank?:    number
}): EngineGraphNode {
  return {
    id:             raw.id,
    type:           raw.type,
    label:          raw.label,
    properties:     raw.properties ?? {},
    position:       null,
    visible:        true,
    inViewport:     false,
    clusterId:      null,
    isClusterProxy: false,
    expanded:       false,
    hasChildren:    raw.hasChildren ?? false,
    childrenLoaded: false,
    renderPriority: RenderPriority.Low,
    degree:         raw.degree ?? 0,
    pageRank:       raw.pageRank ?? 0,
  }
}
