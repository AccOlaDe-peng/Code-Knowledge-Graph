// ─── GraphLoader ──────────────────────────────────────────────────────────────
export { GraphLoader, createGraphLoader }     from './GraphLoader'

// ─── BatchQueue ───────────────────────────────────────────────────────────────
export { BatchQueue, buildWorkQueue, NODE_CHUNK_SIZE, EDGE_CHUNK_SIZE } from './BatchQueue'

// ─── Types ────────────────────────────────────────────────────────────────────
export type {
  // Wire format
  RawNode,
  RawEdge,
  // Request params
  SummaryParams,
  ExpandParams,
  BatchParams,
  // API responses
  SummaryResponse,
  ExpandResponse,
  BatchResponse,
  // Loader results
  LoadInitialResult,
  ExpandResult,
  LoadBatchResult,
  // BatchQueue internals
  WorkItem,
  WorkItemKind,
  BatchProgress,
} from './types'
