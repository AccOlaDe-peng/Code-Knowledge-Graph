import type { WorkItem, BatchProgress } from './types'

// ─── Configuration ────────────────────────────────────────────────────────────

/** Max nodes delivered to the store per animation frame. */
export const NODE_CHUNK_SIZE = 500

/** Max edges delivered to the store per animation frame. */
export const EDGE_CHUNK_SIZE = 1000

// ─── Helpers ──────────────────────────────────────────────────────────────────

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}

/**
 * Build an interleaved work queue from node and edge arrays.
 *
 * Strategy: node batches and edge batches alternate so that edges follow their
 * nodes as closely as possible. Any extra edge batches are appended at the end.
 *
 * Example with 1200 nodes (3 chunks) and 2500 edges (3 chunks):
 *   [nodeChunk0, edgeChunk0, nodeChunk1, edgeChunk1, nodeChunk2, edgeChunk2]
 */
export function buildWorkQueue(
  nodes: import('../types').EngineGraphNode[],
  edges: import('../types').EngineGraphEdge[],
): WorkItem[] {
  const nodeChunks = chunkArray(nodes, NODE_CHUNK_SIZE)
  const edgeChunks = chunkArray(edges, EDGE_CHUNK_SIZE)

  const items: WorkItem[] = []
  const maxLen = Math.max(nodeChunks.length, edgeChunks.length)

  for (let i = 0; i < maxLen; i++) {
    if (i < nodeChunks.length) items.push({ kind: 'nodes', batch: nodeChunks[i] })
    if (i < edgeChunks.length) items.push({ kind: 'edges', batch: edgeChunks[i] })
  }

  return items
}

// ─── BatchQueue ───────────────────────────────────────────────────────────────

export type BatchQueueCallbacks = {
  /** Called once per animation frame with the current work item. */
  onBatch:    (item: WorkItem, progress: BatchProgress) => void
  /** Called after all items have been delivered. */
  onComplete: () => void
  /** Called if an error is thrown inside onBatch. */
  onError:    (err: unknown) => void
}

/**
 * RAF-based delivery queue for streaming graph data into the store.
 *
 * One WorkItem is delivered per `requestAnimationFrame` call, keeping the
 * main thread responsive even when loading 100k nodes.
 *
 * Usage:
 *   const queue = new BatchQueue(items, callbacks)
 *   queue.start()
 *   // later, if needed:
 *   queue.cancel()
 */
export class BatchQueue {
  private readonly items:     WorkItem[]
  private readonly callbacks: BatchQueueCallbacks

  private currentIndex = 0
  private rafHandle:    number | null = null
  private cancelled = false

  constructor(items: WorkItem[], callbacks: BatchQueueCallbacks) {
    this.items     = items
    this.callbacks = callbacks
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  start(): void {
    if (this.cancelled) return
    if (this.items.length === 0) {
      this.callbacks.onComplete()
      return
    }
    this.scheduleNext()
  }

  /** Stop processing. Any in-flight RAF callback will no-op after cancel. */
  cancel(): void {
    this.cancelled = true
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle)
      this.rafHandle = null
    }
  }

  get isRunning(): boolean {
    return this.rafHandle !== null && !this.cancelled
  }

  get progress(): BatchProgress {
    return {
      processed: this.currentIndex,
      total:     this.items.length,
      ratio:     this.items.length === 0 ? 1 : this.currentIndex / this.items.length,
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private scheduleNext(): void {
    this.rafHandle = requestAnimationFrame(() => {
      this.rafHandle = null
      if (this.cancelled) return
      this.processNext()
    })
  }

  private processNext(): void {
    if (this.currentIndex >= this.items.length) {
      this.callbacks.onComplete()
      return
    }

    const item = this.items[this.currentIndex]
    this.currentIndex++

    try {
      this.callbacks.onBatch(item, this.progress)
    } catch (err) {
      this.callbacks.onError(err)
      return
    }

    if (this.currentIndex < this.items.length) {
      this.scheduleNext()
    } else {
      this.callbacks.onComplete()
    }
  }
}
