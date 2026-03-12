// ─── Main Thread ──────────────────────────────────────────────────────────────
export { GraphLayoutWorker, getLayoutWorker, terminateLayoutWorker } from './GraphLayoutWorker'

// ─── Cache ────────────────────────────────────────────────────────────────────
export { LayoutCache } from './LayoutCache'

// ─── Types ────────────────────────────────────────────────────────────────────
export type {
  LayoutNodeInput,
  LayoutEdgeInput,
  DagreConfig,
  RankDir,
  Align,
  NodePosition,
  EdgePath,
  LayoutMetrics,
  LayoutResult,
  LayoutRequest,
  LayoutResponse,
  LayoutWorkerOptions,
} from './types'

export { DEFAULT_DAGRE_CONFIG, DEFAULT_NODE_SIZE } from './types'

// ─── Note: layoutWorker.ts is NOT re-exported ─────────────────────────────────
// It runs inside a Web Worker context and is only referenced via
// `import LayoutWorkerConstructor from './layoutWorker?worker'`
// inside GraphLayoutWorker.ts. Importing it directly from user code
// would execute it on the main thread, which is incorrect.
