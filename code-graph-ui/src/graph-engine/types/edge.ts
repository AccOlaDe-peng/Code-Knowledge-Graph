// ─── Engine Graph Edge ────────────────────────────────────────────────────────
// Extends the raw API edge { from, to, type } with engine-managed runtime state.
//
// Note on IDs:
//   The backend returns edges without explicit IDs. The engine generates a
//   synthetic, stable ID: `${source}::${type}::${target}`.
//   This is deterministic so merging duplicate edges is safe.

export type EngineGraphEdge = {
  // ── Identity ─────────────────────────────────────────────────────────────
  /** Synthetic stable ID: `${source}::${type}::${target}` */
  id:     string
  source: string                    // EngineGraphNode.id
  target: string                    // EngineGraphNode.id
  type:   string                    // EdgeType value or arbitrary string

  // ── Visibility ───────────────────────────────────────────────────────────
  /**
   * false when:
   *   - either endpoint node is not visible (culled, LOD-hidden, or filtered)
   *   - this edge type is disabled by the active FilterState
   * Maps to Cytoscape `display: none` — not removed from cy.
   */
  visible: boolean

  // ── Cluster context ───────────────────────────────────────────────────────
  /**
   * True when source and target belong to different clusters.
   * Cross-cluster edges are rendered at the cluster level (between proxy nodes)
   * rather than between individual member nodes.
   */
  crossCluster: boolean

  // ── Optional metadata ────────────────────────────────────────────────────
  properties: Record<string, unknown>
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function makeEdgeId(source: string, type: string, target: string): string {
  return `${source}::${type}::${target}`
}

export function createEngineEdge(raw: {
  /** Backend field name is "from" — caller normalizes before passing here. */
  source:      string
  target:      string
  type:        string
  properties?: Record<string, unknown>
}): EngineGraphEdge {
  return {
    id:          makeEdgeId(raw.source, raw.type, raw.target),
    source:      raw.source,
    target:      raw.target,
    type:        raw.type,
    visible:     true,
    crossCluster: false,
    properties:  raw.properties ?? {},
  }
}

// ─── Backend Response Normalizer ──────────────────────────────────────────────
// The backend returns { from, to, type }; this converts to engine shape.

export function normalizeBackendEdge(raw: {
  from:        string
  to:          string
  type:        string
  properties?: Record<string, unknown>
}): EngineGraphEdge {
  return createEngineEdge({
    source:     raw.from,
    target:     raw.to,
    type:       raw.type,
    properties: raw.properties,
  })
}
