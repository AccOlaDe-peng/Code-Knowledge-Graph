// ─── Node ─────────────────────────────────────────────────────────────────────
export type { EngineGraphNode, NodePosition, RenderPriorityValue } from './node'
export { RenderPriority, createEngineNode }                        from './node'

// ─── Edge ─────────────────────────────────────────────────────────────────────
export type { EngineGraphEdge }                                         from './edge'
export { makeEdgeId, createEngineEdge, normalizeBackendEdge }           from './edge'

// ─── Cluster ──────────────────────────────────────────────────────────────────
export type { GraphCluster, BoundingBox, ClusterStrategyValue } from './cluster'
export { ClusterStrategy, createCluster, CLUSTER_AUTO_COLLAPSE_THRESHOLD } from './cluster'

// ─── Viewport ─────────────────────────────────────────────────────────────────
export type { GraphViewport, ViewportPan, ViewportBBox } from './viewport'
export {
  VIEWPORT_BUFFER_RATIO,
  VIEWPORT_DEBOUNCE_MS,
  ZOOM_HIDE_FUNCTIONS_BELOW,
  ZOOM_HIDE_CLASSES_BELOW,
  computeBufferedBBox,
  isInBBox,
  createDefaultViewport,
} from './viewport'

// ─── LOD ──────────────────────────────────────────────────────────────────────
export type { LODLevelValue, LODAutoRule, GraphLODState } from './lod'
export {
  LODLevel,
  LOD_RANK,
  LOD_VISIBLE_TYPES,
  DEFAULT_LOD_AUTO_RULES,
  resolveLODForZoom,
  isCoarserThan,
  isFineThan,
  createDefaultLODState,
} from './lod'
