import type { NodePosition } from './node'

// ─── Cluster Strategy ─────────────────────────────────────────────────────────
// Determines how the ClusterManager forms clusters.

export const ClusterStrategy = {
  /** Group nodes by NodeType (e.g., all Function nodes in one module) */
  ByType:   'by_type',
  /** Group nodes by their parent module's ID */
  ByModule: 'by_module',
  /** Group nodes by AI-detected domain boundary (requires enable_ai=true) */
  ByDomain: 'by_domain',
} as const

export type ClusterStrategyValue = (typeof ClusterStrategy)[keyof typeof ClusterStrategy]

// ─── Bounding Box ─────────────────────────────────────────────────────────────
// Axis-aligned bounding box in graph coordinates.

export type BoundingBox = {
  x1: number   // left
  y1: number   // top
  x2: number   // right
  y2: number   // bottom
}

// ─── Graph Cluster ────────────────────────────────────────────────────────────
// Represents a group of nodes that can be collapsed into a single proxy node
// in the Cytoscape canvas. Cytoscape compound nodes are used under the hood.

export type GraphCluster = {
  // ── Identity ─────────────────────────────────────────────────────────────
  /** Synthetic ID: `cluster::${strategy}::${groupKey}` */
  id:       string
  /** Display label shown on the proxy node: "auth/services (12 nodes)" */
  label:    string
  strategy: ClusterStrategyValue

  // ── Membership ───────────────────────────────────────────────────────────
  /**
   * IDs of all EngineGraphNodes that belong to this cluster.
   * Each member has its `clusterId` set to this cluster's id.
   */
  memberIds: Set<string>

  /**
   * Cached count of memberIds.size — avoids calling Set.size on every render
   * path when membership is large.
   */
  memberCount: number

  // ── Cytoscape compound node ───────────────────────────────────────────────
  /**
   * The ID of the synthetic proxy node rendered in Cytoscape when collapsed.
   * When expanded, this compound node acts as the parent container.
   * Equals `cluster-proxy::${id}`.
   */
  proxyNodeId: string

  // ── Visual state ─────────────────────────────────────────────────────────
  /** true = all member nodes are hidden; proxy node is shown instead. */
  collapsed: boolean

  /**
   * Position of the proxy node when collapsed (centroid of member positions).
   * null until LayoutManager has run at least once.
   */
  position: NodePosition | null

  /**
   * Bounding box containing all member nodes when cluster is expanded.
   * null until layout has positioned all members.
   */
  boundingBox: BoundingBox | null

  // ── Metadata ─────────────────────────────────────────────────────────────
  /** The NodeType that appears most frequently among members. */
  dominantType: string

  /**
   * The key used to group nodes into this cluster.
   * For ByType: the NodeType string.
   * For ByModule: the module node id.
   * For ByDomain: the domain label from AI analysis.
   */
  groupKey: string
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createCluster(params: {
  groupKey:    string
  strategy:    ClusterStrategyValue
  label:       string
  memberIds:   Set<string>
  dominantType: string
}): GraphCluster {
  const id = `cluster::${params.strategy}::${params.groupKey}`
  return {
    id,
    label:        params.label,
    strategy:     params.strategy,
    memberIds:    new Set(params.memberIds),
    memberCount:  params.memberIds.size,
    proxyNodeId:  `cluster-proxy::${id}`,
    collapsed:    false,
    position:     null,
    boundingBox:  null,
    dominantType: params.dominantType,
    groupKey:     params.groupKey,
  }
}

// ─── Auto-collapse Threshold ─────────────────────────────────────────────────
// When a cluster's member count exceeds this value, it is collapsed by default.

export const CLUSTER_AUTO_COLLAPSE_THRESHOLD = 50
