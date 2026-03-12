import { apiClient } from '../../core/api/client'
import { useGraphEngineStore } from '../store'
import { createEngineNode, normalizeBackendEdge } from '../types'
import type { EngineGraphNode, EngineGraphEdge } from '../types'
import { BatchQueue, buildWorkQueue } from './BatchQueue'
import type {
  RawNode,
  RawEdge,
  SummaryResponse,
  ExpandResponse,
  BatchResponse,
  LoadInitialResult,
  ExpandResult,
  LoadBatchResult,
  WorkItem,
  BatchProgress,
} from './types'

// ─── Normalization ────────────────────────────────────────────────────────────

function normalizeNode(raw: RawNode): EngineGraphNode {
  return createEngineNode({
    id:         raw.id,
    type:       raw.type,
    // Backend sends `name`; engine uses `label`
    label:      raw.name,
    properties: raw.properties,
    degree:     (raw.metrics?.in_degree ?? 0) + (raw.metrics?.out_degree ?? 0),
    pageRank:   raw.metrics?.pagerank ?? 0,
  })
}

function normalizeEdge(raw: RawEdge): EngineGraphEdge {
  return normalizeBackendEdge({
    from:       raw.from,
    to:         raw.to,
    type:       raw.type,
    properties: raw.properties,
  })
}

function normalizeNodes(raws: RawNode[]): EngineGraphNode[] {
  return raws.map(normalizeNode)
}

function normalizeEdges(raws: RawEdge[]): EngineGraphEdge[] {
  return raws.map(normalizeEdge)
}

// ─── GraphLoader ──────────────────────────────────────────────────────────────

/**
 * GraphLoader manages all data-fetching operations for the GraphEngine.
 *
 * It is a plain class (not a React hook) that:
 *  - Calls backend API endpoints via `apiClient`
 *  - Normalizes raw backend responses into engine types
 *  - Streams results into GraphEngineStore via RAF-based BatchQueue
 *  - Supports AbortController-based cancellation
 *
 * One GraphLoader instance should be created per loaded graph.
 * Call `abort()` before creating a new instance for a different graph.
 */
export class GraphLoader {
  private readonly graphId: string

  private abortController: AbortController | null = null
  private activeQueue:     BatchQueue | null = null

  constructor(graphId: string) {
    this.graphId = graphId
  }

  // ── Abort ──────────────────────────────────────────────────────────────────

  /**
   * Cancel any in-progress load or streaming operation.
   * Safe to call multiple times.
   */
  abort(): void {
    this.abortController?.abort()
    this.abortController = null
    this.activeQueue?.cancel()
    this.activeQueue = null

    const store = useGraphEngineStore.getState()
    if (store.loading.status === 'streaming' || store.loading.status === 'layout') {
      store.setLoadingStatus('idle')
    }
  }

  // ── 1. Load Initial Graph (LOD: Repository + Module) ──────────────────────

  /**
   * Fetch and stream the initial graph summary (Repository + Module nodes).
   *
   * Sequence:
   *  1. GET /graph/summary?graph_id=  (preferred, backend may not have it yet)
   *  2. Falls back to GET /graph?graph_id= filtered to ['Repository','Module']
   *  3. Streams results into store via RAF BatchQueue
   *
   * Resolves after ALL batches have been delivered to the store.
   */
  async loadInitialGraph(): Promise<LoadInitialResult> {
    this.abort()
    this.abortController = new AbortController()

    const store = useGraphEngineStore.getState()
    store.setLoadingStatus('streaming')
    store.setStreamProgress(0, 0)

    try {
      const data = await this.fetchSummary()
      const nodes = normalizeNodes(data.nodes)
      const edges = normalizeEdges(data.edges)

      // Report full-graph totals immediately for progress-bar planning
      store.setStreamProgress(0, data.total_node_count)

      await this.streamIntoStore(nodes, edges, data.total_node_count)

      store.setLoadingStatus('done')

      return {
        nodeCount:      nodes.length,
        edgeCount:      edges.length,
        totalNodeCount: data.total_node_count,
        totalEdgeCount: data.total_edge_count,
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        // Silently swallow — caller triggered abort()
        return { nodeCount: 0, edgeCount: 0, totalNodeCount: 0, totalEdgeCount: 0 }
      }
      store.setLoadingError((err as Error).message)
      throw err
    }
  }

  // ── 2. Expand Node (Lazy Load Children) ───────────────────────────────────

  /**
   * Fetch and merge the direct children of `nodeId`.
   *
   * Sequence:
   *  1. GET /graph/expand?graph_id=&node_id=
   *  2. Normalize + mergeNodes / mergeEdges into store
   *  3. Mark node as expanded
   *
   * No BatchQueue is used here — child sets are typically small (< 200 nodes).
   * If `has_more` is true, the caller should call `expandNode` again or
   * use `loadNextBatch` to page through further descendants.
   */
  async expandNode(nodeId: string): Promise<ExpandResult> {
    const store = useGraphEngineStore.getState()
    store.setExpandingNode(nodeId)

    try {
      const data = await this.fetchExpand(nodeId)
      const nodes = normalizeNodes(data.nodes)
      const edges = normalizeEdges(data.edges)

      store.mergeNodes(nodes)
      store.mergeEdges(edges)
      store.markExpanded(nodeId)
      store.recomputeVisibleEdges()

      return {
        nodeId,
        nodeCount: nodes.length,
        edgeCount: edges.length,
        hasMore:   data.has_more,
      }
    } finally {
      // Always clear the spinner, even on error
      useGraphEngineStore.getState().setExpandingNode(null)
    }
  }

  // ── 3. Load Next Batch (Pagination) ───────────────────────────────────────

  /**
   * Fetch the next page of the full graph and stream it into the store.
   *
   * Designed for progressive loading beyond the initial LOD snapshot.
   * Call repeatedly until `hasMore === false`.
   *
   * @param offset  Zero-based starting position in the full node list.
   * @param limit   Number of nodes to fetch per batch (default 500).
   * @param types   Optional array of NodeType strings to filter (e.g. ['Function']).
   *
   * Resolves with the next offset and a `hasMore` flag.
   */
  async loadNextBatch(
    offset: number,
    limit = 500,
    types?: string[],
  ): Promise<LoadBatchResult> {
    this.abortController = new AbortController()

    const store = useGraphEngineStore.getState()
    if (store.loading.status !== 'streaming') {
      store.setLoadingStatus('streaming')
    }

    try {
      const data = await this.fetchBatch(offset, limit, types)
      const nodes = normalizeNodes(data.nodes)
      const edges = normalizeEdges(data.edges)

      await this.streamIntoStore(nodes, edges, data.total_node_count)

      if (!data.has_more) {
        store.setLoadingStatus('done')
      }

      return {
        nodeCount:      nodes.length,
        edgeCount:      edges.length,
        totalNodeCount: data.total_node_count,
        totalEdgeCount: data.total_edge_count,
        nextOffset:     offset + data.nodes.length,
        hasMore:        data.has_more,
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        return {
          nodeCount: 0, edgeCount: 0,
          totalNodeCount: 0, totalEdgeCount: 0,
          nextOffset: offset, hasMore: false,
        }
      }
      useGraphEngineStore.getState().setLoadingError((err as Error).message)
      throw err
    }
  }

  // ── Private: API Calls ─────────────────────────────────────────────────────

  /**
   * Attempt to fetch the LOD-0 summary.
   * Falls back to the full /graph endpoint filtered to Repository+Module types
   * if the /graph/summary endpoint returns 404 (not yet implemented on backend).
   */
  private async fetchSummary(): Promise<SummaryResponse> {
    const signal = this.abortController?.signal

    try {
      return await apiClient.get<SummaryResponse>('/graph/summary', {
        params: { graph_id: this.graphId },
        signal,
      })
    } catch (err) {
      // Graceful fallback: if the dedicated summary endpoint doesn't exist yet,
      // fetch the full graph and filter client-side.
      if (isNotFound(err)) {
        return this.fetchSummaryFallback(signal)
      }
      throw err
    }
  }

  /**
   * Fallback: GET /graph?graph_id= and filter to Repository+Module nodes.
   * Used while the backend /graph/summary endpoint is not yet deployed.
   */
  private async fetchSummaryFallback(
    signal?: AbortSignal,
  ): Promise<SummaryResponse> {
    type FullGraphRaw = {
      nodes: RawNode[]
      edges: RawEdge[]
    }

    const full = await apiClient.get<FullGraphRaw>('/graph', {
      params: { graph_id: this.graphId },
      signal,
    })

    const summaryTypes = new Set(['Repository', 'Module'])
    const summaryNodes = full.nodes.filter(n => summaryTypes.has(n.type))
    const summaryNodeIds = new Set(summaryNodes.map(n => n.id))
    const summaryEdges = full.edges.filter(
      e => summaryNodeIds.has(e.from) && summaryNodeIds.has(e.to),
    )

    return {
      graph_id:         this.graphId,
      nodes:            summaryNodes,
      edges:            summaryEdges,
      total_node_count: full.nodes.length,
      total_edge_count: full.edges.length,
    }
  }

  private async fetchExpand(nodeId: string): Promise<ExpandResponse> {
    return apiClient.get<ExpandResponse>('/graph/expand', {
      params: { graph_id: this.graphId, node_id: nodeId },
      signal: this.abortController?.signal,
    })
  }

  private async fetchBatch(
    offset: number,
    limit:  number,
    types?: string[],
  ): Promise<BatchResponse> {
    return apiClient.get<BatchResponse>('/graph', {
      params: {
        graph_id: this.graphId,
        limit,
        offset,
        ...(types?.length ? { types: types.join(',') } : {}),
      },
      signal: this.abortController?.signal,
    })
  }

  // ── Private: Streaming ─────────────────────────────────────────────────────

  /**
   * Split `nodes` and `edges` into RAF-sized chunks and deliver them to
   * GraphEngineStore one chunk per animation frame.
   *
   * Progress is reported after each batch via `store.setStreamProgress`.
   *
   * @param totalNodeHint  Full-graph node count (for accurate progress fraction).
   *                       Pass 0 if unknown.
   */
  private streamIntoStore(
    nodes:         EngineGraphNode[],
    edges:         EngineGraphEdge[],
    totalNodeHint: number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const store    = useGraphEngineStore.getState()
      const workItems = buildWorkQueue(nodes, edges)

      // Running tally of nodes delivered so far (edges don't count in progress)
      let deliveredNodes = 0

      const queue = new BatchQueue(workItems, {
        onBatch: (item: WorkItem, _progress: BatchProgress) => {
          if (item.kind === 'nodes') {
            store.mergeNodes(item.batch)
            deliveredNodes += item.batch.length
            store.setStreamProgress(
              deliveredNodes,
              Math.max(totalNodeHint, deliveredNodes),
            )
          } else {
            store.mergeEdges(item.batch)
          }
        },

        onComplete: () => {
          // Final edge visibility pass after all nodes + edges are in store
          store.recomputeVisibleEdges()
          resolve()
        },

        onError: (err) => {
          reject(err instanceof Error ? err : new Error(String(err)))
        },
      })

      this.activeQueue = queue
      queue.start()
    })
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isNotFound(err: unknown): boolean {
  if (err instanceof Error) {
    // Axios wraps HTTP errors — check common patterns
    const msg = err.message.toLowerCase()
    return (
      msg.includes('404') ||
      msg.includes('not found') ||
      // axios error shape
      (err as { response?: { status?: number } }).response?.status === 404
    )
  }
  return false
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a GraphLoader bound to a specific graph.
 *
 * @example
 * ```ts
 * const loader = createGraphLoader('my-graph-id')
 * const result = await loader.loadInitialGraph()
 * // → { nodeCount: 42, edgeCount: 67, totalNodeCount: 95000, ... }
 *
 * await loader.expandNode('module::auth')
 *
 * let offset = result.nodeCount
 * let hasMore = true
 * while (hasMore) {
 *   const batch = await loader.loadNextBatch(offset)
 *   hasMore  = batch.hasMore
 *   offset   = batch.nextOffset
 * }
 * ```
 */
export function createGraphLoader(graphId: string): GraphLoader {
  return new GraphLoader(graphId)
}
