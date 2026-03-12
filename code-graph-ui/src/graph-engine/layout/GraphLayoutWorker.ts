import { useGraphEngineStore } from '../store'
import type { EngineGraphNode, EngineGraphEdge } from '../types'
import { LayoutCache }  from './LayoutCache'
import type {
  LayoutNodeInput,
  LayoutEdgeInput,
  DagreConfig,
  LayoutResult,
  LayoutResponse,
  LayoutRequest,
  LayoutWorkerOptions,
} from './types'
import { DEFAULT_DAGRE_CONFIG, DEFAULT_NODE_SIZE } from './types'

// ─── Vite Worker Import ───────────────────────────────────────────────────────
// Vite resolves `?worker` at build time, bundling layoutWorker.ts separately.
// The result is a Worker constructor — no URL string management needed.
import LayoutWorkerConstructor from './layoutWorker?worker'

// ─── Pending Request Tracker ─────────────────────────────────────────────────

type PendingRequest = {
  resolve: (result: LayoutResult) => void
  reject:  (err: Error) => void
  timer:   ReturnType<typeof setTimeout>
}

// ─── ID Generator ─────────────────────────────────────────────────────────────

let _requestCounter = 0
function nextRequestId(): string {
  return `layout-${++_requestCounter}-${Date.now()}`
}

// ─── Node → LayoutNodeInput Converter ────────────────────────────────────────

function toLayoutNode(node: EngineGraphNode): LayoutNodeInput {
  return {
    id:     node.id,
    width:  DEFAULT_NODE_SIZE.width,
    height: DEFAULT_NODE_SIZE.height,
    fixed:  node.position !== null,
    x:      node.position?.x,
    y:      node.position?.y,
  }
}

function toLayoutEdge(edge: EngineGraphEdge): LayoutEdgeInput {
  return {
    id:     edge.id,
    source: edge.source,
    target: edge.target,
  }
}

// ─── GraphLayoutWorker ────────────────────────────────────────────────────────

/**
 * Main-thread manager for the layout Web Worker.
 *
 * Responsibilities:
 *  - Owns the Worker lifecycle (create once, terminate on destroy)
 *  - Multiplexes concurrent requests via a requestId → Promise map
 *  - Checks LayoutCache before dispatching work to the Worker
 *  - Enforces per-request timeouts
 *  - Writes computed positions back to GraphEngineStore
 *
 * One instance should be created per graph session and kept alive
 * for the duration of that session.
 *
 * @example
 * ```ts
 * const layoutWorker = new GraphLayoutWorker()
 *
 * // Compute layout from store nodes/edges
 * const result = await layoutWorker.computeLayoutFromStore()
 *
 * // Compute layout from explicit data
 * const result = await layoutWorker.computeLayout(nodes, edges)
 *
 * // Clean up when the graph is unmounted
 * layoutWorker.terminate()
 * ```
 */
export class GraphLayoutWorker {
  private readonly worker:   Worker
  private readonly cache:    LayoutCache
  private readonly options:  Required<LayoutWorkerOptions>
  private readonly pending:  Map<string, PendingRequest> = new Map()

  private terminated = false

  constructor(options: LayoutWorkerOptions = {}) {
    this.worker  = new LayoutWorkerConstructor()
    this.cache   = new LayoutCache()
    this.options = {
      timeoutMs: options.timeoutMs ?? 8_000,
    }

    this.worker.addEventListener('message', this.handleMessage)
    this.worker.addEventListener('error',   this.handleWorkerError)
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Compute layout for an explicit list of nodes and edges.
   *
   * Returns a LayoutResult with node positions and edge SVG paths.
   * Does NOT write to the store — call `applyToStore(result)` for that.
   *
   * @param config  Partial overrides for DagreConfig (merged with defaults).
   */
  computeLayout(
    nodes:  EngineGraphNode[],
    edges:  EngineGraphEdge[],
    config: Partial<DagreConfig> = {},
  ): Promise<LayoutResult> {
    if (this.terminated) {
      return Promise.reject(new Error('GraphLayoutWorker has been terminated'))
    }

    const merged  = { ...DEFAULT_DAGRE_CONFIG, ...config }
    const inputs  = nodes.map(toLayoutNode)
    const eInputs = edges.map(toLayoutEdge)

    // Cache hit: return immediately without touching the Worker
    const cacheKey = this.cache.buildKey(inputs, eInputs, merged)
    const cached   = this.cache.get(cacheKey)
    if (cached) return Promise.resolve(cached)

    return this.dispatch(inputs, eInputs, merged, cacheKey)
  }

  /**
   * Convenience method: reads nodes and edges directly from GraphEngineStore
   * and computes layout for visible nodes only.
   *
   * Visible-only ensures we don't waste time laying out viewport-culled nodes.
   * After layout, positions are written to the store automatically.
   */
  async computeLayoutFromStore(
    config: Partial<DagreConfig> = {},
  ): Promise<LayoutResult> {
    const state = useGraphEngineStore.getState()

    // Only lay out visible nodes; fetch their connected visible edges
    const visibleNodes = [...state.nodes.values()].filter(n => n.visible)
    const visibleEdgeIds = state.visibleEdges
    const visibleEdges  = [...state.edges.values()].filter(
      e => visibleEdgeIds.has(e.id),
    )

    const result = await this.computeLayout(visibleNodes, visibleEdges, config)
    this.applyToStore(result)
    return result
  }

  /**
   * Write computed positions from a LayoutResult into GraphEngineStore.
   * Sets loading status to 'layout' before writing, resets to 'done' after.
   */
  applyToStore(result: LayoutResult): void {
    const store = useGraphEngineStore.getState()
    store.setLoadingStatus('layout')

    // Build the positions map required by store.applyPositions()
    const posMap = new Map(result.positions.map(p => [p.id, { x: p.x, y: p.y }]))
    store.applyPositions(posMap)

    store.setLoadingStatus('done')
  }

  /**
   * Terminate the underlying Worker.
   * Any pending requests will reject with a TerminatedError.
   * The instance cannot be used after this call.
   */
  terminate(): void {
    if (this.terminated) return

    this.terminated = true

    // Reject all in-flight requests
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(new Error(`Layout worker terminated (requestId: ${id})`))
    }
    this.pending.clear()

    this.worker.removeEventListener('message', this.handleMessage)
    this.worker.removeEventListener('error',   this.handleWorkerError)
    this.worker.terminate()
  }

  /** Invalidate all cached layout results (e.g., after a full graph reload). */
  clearCache(): void {
    this.cache.clear()
  }

  get isTerminated(): boolean {
    return this.terminated
  }

  // ── Private: Worker Dispatch ───────────────────────────────────────────────

  private dispatch(
    nodes:    LayoutNodeInput[],
    edges:    LayoutEdgeInput[],
    config:   DagreConfig,
    cacheKey: string,
  ): Promise<LayoutResult> {
    const requestId = nextRequestId()

    return new Promise<LayoutResult>((resolve, reject) => {
      // Timeout guard: reject if worker takes too long
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error(
          `Layout computation timed out after ${this.options.timeoutMs}ms ` +
          `(requestId: ${requestId}, nodes: ${nodes.length})`,
        ))
      }, this.options.timeoutMs)

      this.pending.set(requestId, { resolve, reject, timer })

      const request: LayoutRequest = {
        type: 'COMPUTE_LAYOUT',
        requestId,
        nodes,
        edges,
        config,
      }

      this.worker.postMessage(request)
      this.cacheKeyForRequest.set(requestId, cacheKey)
    })
  }

  // ── Private: Cache key tracking ───────────────────────────────────────────
  // We need to cache the result after the worker returns it.
  // Store the key alongside the pending request.

  private readonly cacheKeyForRequest = new Map<string, string>()

  // ── Private: Message Handlers ──────────────────────────────────────────────

  private readonly handleMessage = (event: MessageEvent<LayoutResponse>): void => {
    const response = event.data
    const pending  = this.pending.get(response.requestId)
    if (!pending) return  // stale (timed-out) response, ignore

    clearTimeout(pending.timer)
    this.pending.delete(response.requestId)

    if (response.type === 'LAYOUT_RESULT') {
      const result: LayoutResult = {
        positions: response.positions,
        edgePaths: response.edgePaths,
        metrics:   response.metrics,
      }

      // Write to cache for future identical topology requests
      const cacheKey = this.cacheKeyForRequest.get(response.requestId)
      if (cacheKey) {
        this.cache.set(cacheKey, result)
        this.cacheKeyForRequest.delete(response.requestId)
      }

      pending.resolve(result)
    } else {
      this.cacheKeyForRequest.delete(response.requestId)
      pending.reject(new Error(response.error))
    }
  }

  private readonly handleWorkerError = (event: ErrorEvent): void => {
    const errorMessage = event.message ?? 'Unknown layout worker error'

    // Reject all pending requests — we don't know which request caused the error
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(new Error(`Layout worker error: ${errorMessage} (requestId: ${id})`))
    }
    this.pending.clear()
    this.cacheKeyForRequest.clear()
  }
}

// ─── Singleton Factory ────────────────────────────────────────────────────────

/**
 * Module-level singleton instance.
 * Created lazily on first access; terminated when `terminateLayoutWorker` is called.
 *
 * Using a singleton avoids creating multiple Workers for the same graph session.
 */
let _instance: GraphLayoutWorker | null = null

export function getLayoutWorker(options?: LayoutWorkerOptions): GraphLayoutWorker {
  if (!_instance || _instance.isTerminated) {
    _instance = new GraphLayoutWorker(options)
  }
  return _instance
}

export function terminateLayoutWorker(): void {
  _instance?.terminate()
  _instance = null
}
