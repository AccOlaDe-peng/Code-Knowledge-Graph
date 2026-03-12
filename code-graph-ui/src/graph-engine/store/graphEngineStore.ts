import { create } from 'zustand'
import {
  type EngineGraphNode,
  type EngineGraphEdge,
  type GraphCluster,
  type GraphViewport,
  type GraphLODState,
  type LODLevelValue,
  type ViewportPan,
  type LODAutoRule,
  LOD_VISIBLE_TYPES,
  DEFAULT_LOD_AUTO_RULES,
  createDefaultViewport,
  createDefaultLODState,
  computeBufferedBBox,
  resolveLODForZoom,
} from '../types'

// ─── Filter State ─────────────────────────────────────────────────────────────

export type FilterState = {
  /** Per NodeType visibility toggle. true = visible. */
  nodeTypeFilters: Record<string, boolean>
  /** Per EdgeType visibility toggle. true = visible. */
  edgeTypeFilters: Record<string, boolean>
  /**
   * Hide nodes whose degree (in + out) is below this threshold.
   * 0 = no degree filtering.
   */
  minDegree: number
  /**
   * Text query for search-based highlighting.
   * Empty string = no active search.
   */
  searchQuery: string
  /** Set of node IDs currently highlighted (search hits). */
  highlightedIds: Set<string>
}

function createDefaultFilterState(): FilterState {
  return {
    nodeTypeFilters: {},
    edgeTypeFilters: {},
    minDegree:       0,
    searchQuery:     '',
    highlightedIds:  new Set(),
  }
}

// ─── Loading State ────────────────────────────────────────────────────────────

export type StreamProgress = {
  /** Number of nodes/edges already added to the store. */
  loaded: number
  /** Total nodes/edges expected (may be 0 if unknown). */
  total:  number
}

export type LoadingStatus = 'idle' | 'streaming' | 'layout' | 'done' | 'error'

export type LoadingState = {
  status:      LoadingStatus
  progress:    StreamProgress
  /** ID of the node currently being lazy-expanded, or null. */
  expandingId: string | null
  /** Error message when status === 'error'. */
  error:       string | null
}

function createDefaultLoadingState(): LoadingState {
  return {
    status:      'idle',
    progress:    { loaded: 0, total: 0 },
    expandingId: null,
    error:       null,
  }
}

// ─── Store Shape ─────────────────────────────────────────────────────────────

export type GraphEngineState = {
  // ── Graph identity ────────────────────────────────────────────────────────
  /** The graph_id received from the backend. null = no graph loaded. */
  graphId: string | null

  // ── Core data (Map for O(1) access with 100k+ nodes) ─────────────────────
  nodes: Map<string, EngineGraphNode>
  edges: Map<string, EngineGraphEdge>

  // ── Visibility sets (maintained by ViewportCuller + FilterEngine) ─────────
  /**
   * IDs of nodes currently rendered (visible: true).
   * Subset of nodes keys, excluding LOD-hidden, viewport-culled, filtered.
   */
  visibleNodes: Set<string>
  /**
   * IDs of edges currently rendered (visible: true).
   * An edge is visible only when both endpoints are in visibleNodes.
   */
  visibleEdges: Set<string>

  // ── Expansion tracking ────────────────────────────────────────────────────
  /** IDs of nodes that have been lazy-expanded at least once. */
  expandedNodes: Set<string>

  // ── Clusters ──────────────────────────────────────────────────────────────
  clusters: Map<string, GraphCluster>

  // ── Sub-states ────────────────────────────────────────────────────────────
  filters:  FilterState
  viewport: GraphViewport
  lod:      GraphLODState
  loading:  LoadingState

  // ── Selection ─────────────────────────────────────────────────────────────
  selectedNodeId: string | null

  // ══════════════════════════════════════════════════════════════════════════
  // ACTIONS
  // ══════════════════════════════════════════════════════════════════════════

  // ── Graph lifecycle ───────────────────────────────────────────────────────
  /** Initialize or reset the engine for a new graphId. */
  initGraph:    (graphId: string) => void
  /** Tear down everything (called on unmount or before loading a new graph). */
  destroyGraph: () => void

  // ── Node actions ──────────────────────────────────────────────────────────
  /** Replace the entire node map (initial load or full refresh). */
  setNodes:    (nodes: EngineGraphNode[]) => void
  /**
   * Add or update nodes without removing existing ones.
   * Used by StreamingLoader and LazyExpander.
   */
  mergeNodes:  (nodes: EngineGraphNode[]) => void
  /** Remove a node and all edges that reference it. */
  removeNode:  (id: string) => void
  /** Apply layout positions from LayoutWorker result. */
  applyPositions: (positions: ReadonlyMap<string, { x: number; y: number }>) => void
  /** Update a single node's inViewport + renderPriority flags. */
  updateNodeViewportState: (id: string, inViewport: boolean) => void

  // ── Edge actions ──────────────────────────────────────────────────────────
  /** Replace the entire edge map. */
  setEdges:   (edges: EngineGraphEdge[]) => void
  /** Add or update edges without removing existing ones. */
  mergeEdges: (edges: EngineGraphEdge[]) => void
  /** Remove a specific edge by id. */
  removeEdge: (id: string) => void

  // ── Visibility actions ────────────────────────────────────────────────────
  /**
   * Bulk-replace the visible node set.
   * Called by ViewportCuller after each viewport change.
   */
  setVisibleNodes: (ids: ReadonlySet<string>) => void
  /**
   * Bulk-replace the visible edge set.
   * Edges are only visible when both endpoints are visible.
   */
  setVisibleEdges: (ids: ReadonlySet<string>) => void
  /**
   * Recompute visibleEdges based on current visibleNodes.
   * Called after any batch node visibility change.
   */
  recomputeVisibleEdges: () => void

  // ── Expansion actions ─────────────────────────────────────────────────────
  /** Mark a node as expanded (LazyExpander calls this after fetching children). */
  markExpanded:       (nodeId: string) => void
  /** Set the "currently expanding" indicator (shows a spinner on the node). */
  setExpandingNode:   (nodeId: string | null) => void

  // ── Cluster actions ───────────────────────────────────────────────────────
  addCluster:      (cluster: GraphCluster) => void
  removeCluster:   (clusterId: string) => void
  /** Collapse a cluster: hide members, show proxy node. */
  collapseCluster: (clusterId: string) => void
  /** Expand a cluster: show members, hide proxy node. */
  expandCluster:   (clusterId: string) => void
  clearClusters:   () => void

  // ── Filter actions ────────────────────────────────────────────────────────
  setNodeTypeFilter: (nodeType: string, visible: boolean) => void
  setEdgeTypeFilter: (edgeType: string, visible: boolean) => void
  setMinDegree:      (minDegree: number) => void
  resetFilters:      () => void

  // ── Search actions ────────────────────────────────────────────────────────
  setSearchQuery:  (query: string) => void
  setHighlighted:  (ids: ReadonlyArray<string>) => void
  clearSearch:     () => void

  // ── Viewport actions ──────────────────────────────────────────────────────
  /**
   * Update viewport from Cytoscape pan/zoom event.
   * Automatically recomputes the buffered BBox.
   */
  updateViewport: (pan: ViewportPan, zoom: number) => void
  setCanvasSize:  (width: number, height: number) => void

  // ── LOD actions ───────────────────────────────────────────────────────────
  /**
   * Manually set a specific LOD level.
   * Sets manualOverride = true so auto-LOD does not override it.
   */
  setLODLevel:        (level: LODLevelValue) => void
  /** Toggle automatic LOD switching based on zoom. */
  setLODAutoEnabled:  (enabled: boolean) => void
  /**
   * Called by LodController when zoom changes and autoEnabled is true.
   * Has no effect when manualOverride is true.
   */
  onZoomChangedLOD:   (zoom: number, rules?: readonly LODAutoRule[]) => void

  // ── Loading state ─────────────────────────────────────────────────────────
  setLoadingStatus:   (status: LoadingStatus) => void
  setStreamProgress:  (loaded: number, total: number) => void
  setLoadingError:    (message: string) => void

  // ── Selection ─────────────────────────────────────────────────────────────
  setSelectedNode: (id: string | null) => void
}

// ─── Store Implementation ────────────────────────────────────────────────────

export const useGraphEngineStore = create<GraphEngineState>((set, get) => ({
  // ── Initial state ─────────────────────────────────────────────────────────

  graphId:       null,
  nodes:         new Map(),
  edges:         new Map(),
  visibleNodes:  new Set(),
  visibleEdges:  new Set(),
  expandedNodes: new Set(),
  clusters:      new Map(),
  filters:       createDefaultFilterState(),
  viewport:      createDefaultViewport(),
  lod:           createDefaultLODState(),
  loading:       createDefaultLoadingState(),
  selectedNodeId: null,

  // ── Graph lifecycle ───────────────────────────────────────────────────────

  initGraph: (graphId) => set({
    graphId,
    nodes:          new Map(),
    edges:          new Map(),
    visibleNodes:   new Set(),
    visibleEdges:   new Set(),
    expandedNodes:  new Set(),
    clusters:       new Map(),
    filters:        createDefaultFilterState(),
    lod:            createDefaultLODState(),
    loading:        createDefaultLoadingState(),
    selectedNodeId: null,
  }),

  destroyGraph: () => set({
    graphId:        null,
    nodes:          new Map(),
    edges:          new Map(),
    visibleNodes:   new Set(),
    visibleEdges:   new Set(),
    expandedNodes:  new Set(),
    clusters:       new Map(),
    filters:        createDefaultFilterState(),
    lod:            createDefaultLODState(),
    loading:        createDefaultLoadingState(),
    selectedNodeId: null,
  }),

  // ── Node actions ──────────────────────────────────────────────────────────

  setNodes: (nodes) => {
    const map = new Map<string, EngineGraphNode>()
    for (const n of nodes) map.set(n.id, n)
    set({ nodes: map })
  },

  mergeNodes: (nodes) => {
    // Create a new Map to ensure React detects the reference change
    const next = new Map(get().nodes)
    for (const n of nodes) next.set(n.id, n)
    set({ nodes: next })
  },

  removeNode: (id) => {
    const nodes = new Map(get().nodes)
    nodes.delete(id)

    // Also remove all edges that reference this node
    const edges = new Map(get().edges)
    for (const [eid, edge] of edges) {
      if (edge.source === id || edge.target === id) edges.delete(eid)
    }

    const visibleNodes = new Set(get().visibleNodes)
    visibleNodes.delete(id)

    set({ nodes, edges, visibleNodes })
    get().recomputeVisibleEdges()
  },

  applyPositions: (positions) => {
    const nodes = new Map(get().nodes)
    let changed = false
    for (const [id, pos] of positions) {
      const node = nodes.get(id)
      if (node) {
        nodes.set(id, { ...node, position: pos })
        changed = true
      }
    }
    if (changed) set({ nodes })
  },

  updateNodeViewportState: (id, inViewport) => {
    const node = get().nodes.get(id)
    if (!node || node.inViewport === inViewport) return
    const nodes = new Map(get().nodes)
    nodes.set(id, { ...node, inViewport })
    set({ nodes })
  },

  // ── Edge actions ──────────────────────────────────────────────────────────

  setEdges: (edges) => {
    const map = new Map<string, EngineGraphEdge>()
    for (const e of edges) map.set(e.id, e)
    set({ edges: map })
  },

  mergeEdges: (edges) => {
    const next = new Map(get().edges)
    for (const e of edges) next.set(e.id, e)
    set({ edges: next })
  },

  removeEdge: (id) => {
    const edges = new Map(get().edges)
    edges.delete(id)
    const visibleEdges = new Set(get().visibleEdges)
    visibleEdges.delete(id)
    set({ edges, visibleEdges })
  },

  // ── Visibility actions ────────────────────────────────────────────────────

  setVisibleNodes: (ids) => {
    // Sync the `visible` flag on each EngineGraphNode so Cytoscape
    // adapters and selectors can read it directly from the node object.
    const nodes = new Map(get().nodes)
    const prevVisible = get().visibleNodes
    let mutated = false

    for (const [id, node] of nodes) {
      const shouldBeVisible = ids.has(id)
      if (node.visible !== shouldBeVisible) {
        nodes.set(id, { ...node, visible: shouldBeVisible })
        mutated = true
      }
    }

    const visibleNodes = new Set(ids)
    set(mutated ? { visibleNodes, nodes } : { visibleNodes })

    // Cascade to edges if the visible set actually changed
    if (prevVisible.size !== visibleNodes.size) {
      get().recomputeVisibleEdges()
    }
  },

  setVisibleEdges: (ids) => {
    const edges = new Map(get().edges)
    let mutated = false
    for (const [id, edge] of edges) {
      const shouldBeVisible = ids.has(id)
      if (edge.visible !== shouldBeVisible) {
        edges.set(id, { ...edge, visible: shouldBeVisible })
        mutated = true
      }
    }
    const visibleEdges = new Set(ids)
    set(mutated ? { visibleEdges, edges } : { visibleEdges })
  },

  recomputeVisibleEdges: () => {
    const { edges, visibleNodes } = get()
    const visibleEdges = new Set<string>()
    const updatedEdges = new Map(edges)
    let mutated = false

    for (const [id, edge] of updatedEdges) {
      const shouldBeVisible =
        visibleNodes.has(edge.source) && visibleNodes.has(edge.target)
      if (edge.visible !== shouldBeVisible) {
        updatedEdges.set(id, { ...edge, visible: shouldBeVisible })
        mutated = true
      }
      if (shouldBeVisible) visibleEdges.add(id)
    }

    set(mutated ? { visibleEdges, edges: updatedEdges } : { visibleEdges })
  },

  // ── Expansion actions ─────────────────────────────────────────────────────

  markExpanded: (nodeId) => {
    const expandedNodes = new Set(get().expandedNodes)
    expandedNodes.add(nodeId)

    // Mark the node itself
    const nodes = new Map(get().nodes)
    const node = nodes.get(nodeId)
    if (node) nodes.set(nodeId, { ...node, expanded: true, childrenLoaded: true })

    set({ expandedNodes, nodes })
  },

  setExpandingNode: (nodeId) =>
    set((s) => ({ loading: { ...s.loading, expandingId: nodeId } })),

  // ── Cluster actions ───────────────────────────────────────────────────────

  addCluster: (cluster) => {
    const clusters = new Map(get().clusters)
    clusters.set(cluster.id, cluster)

    // Update clusterId on all member nodes
    const nodes = new Map(get().nodes)
    for (const memberId of cluster.memberIds) {
      const node = nodes.get(memberId)
      if (node) nodes.set(memberId, { ...node, clusterId: cluster.id })
    }

    set({ clusters, nodes })
  },

  removeCluster: (clusterId) => {
    const clusters = new Map(get().clusters)
    const cluster = clusters.get(clusterId)
    clusters.delete(clusterId)

    if (cluster) {
      // Clear clusterId from member nodes
      const nodes = new Map(get().nodes)
      for (const memberId of cluster.memberIds) {
        const node = nodes.get(memberId)
        if (node) nodes.set(memberId, { ...node, clusterId: null })
      }
      set({ clusters, nodes })
    } else {
      set({ clusters })
    }
  },

  collapseCluster: (clusterId) => {
    const clusters = new Map(get().clusters)
    const cluster = clusters.get(clusterId)
    if (!cluster || cluster.collapsed) return

    clusters.set(clusterId, { ...cluster, collapsed: true })

    // Hide all member nodes
    const nodes = new Map(get().nodes)
    for (const memberId of cluster.memberIds) {
      const node = nodes.get(memberId)
      if (node) nodes.set(memberId, { ...node, visible: false })
    }

    const visibleNodes = new Set(get().visibleNodes)
    for (const memberId of cluster.memberIds) visibleNodes.delete(memberId)

    set({ clusters, nodes, visibleNodes })
    get().recomputeVisibleEdges()
  },

  expandCluster: (clusterId) => {
    const clusters = new Map(get().clusters)
    const cluster = clusters.get(clusterId)
    if (!cluster || !cluster.collapsed) return

    clusters.set(clusterId, { ...cluster, collapsed: false })

    // Show all member nodes
    const nodes = new Map(get().nodes)
    const visibleNodes = new Set(get().visibleNodes)
    for (const memberId of cluster.memberIds) {
      const node = nodes.get(memberId)
      if (node) {
        nodes.set(memberId, { ...node, visible: true })
        visibleNodes.add(memberId)
      }
    }

    set({ clusters, nodes, visibleNodes })
    get().recomputeVisibleEdges()
  },

  clearClusters: () => {
    const nodes = new Map(get().nodes)
    for (const [id, node] of nodes) {
      if (node.clusterId !== null) {
        nodes.set(id, { ...node, clusterId: null, visible: true })
      }
    }
    set({ clusters: new Map(), nodes })
  },

  // ── Filter actions ────────────────────────────────────────────────────────

  setNodeTypeFilter: (nodeType, visible) =>
    set((s) => ({
      filters: {
        ...s.filters,
        nodeTypeFilters: { ...s.filters.nodeTypeFilters, [nodeType]: visible },
      },
    })),

  setEdgeTypeFilter: (edgeType, visible) =>
    set((s) => ({
      filters: {
        ...s.filters,
        edgeTypeFilters: { ...s.filters.edgeTypeFilters, [edgeType]: visible },
      },
    })),

  setMinDegree: (minDegree) =>
    set((s) => ({ filters: { ...s.filters, minDegree } })),

  resetFilters: () =>
    set({ filters: createDefaultFilterState() }),

  // ── Search actions ────────────────────────────────────────────────────────

  setSearchQuery: (query) =>
    set((s) => ({ filters: { ...s.filters, searchQuery: query } })),

  setHighlighted: (ids) =>
    set((s) => ({
      filters: { ...s.filters, highlightedIds: new Set(ids) },
    })),

  clearSearch: () =>
    set((s) => ({
      filters: { ...s.filters, searchQuery: '', highlightedIds: new Set() },
    })),

  // ── Viewport actions ──────────────────────────────────────────────────────

  updateViewport: (pan, zoom) => {
    const { width, height } = get().viewport
    const bbox = computeBufferedBBox({ pan, zoom, width, height })
    set({ viewport: { pan, zoom, bbox, width, height } })
  },

  setCanvasSize: (width, height) => {
    const { pan, zoom } = get().viewport
    const bbox = computeBufferedBBox({ pan, zoom, width, height })
    set((s) => ({ viewport: { ...s.viewport, width, height, bbox } }))
  },

  // ── LOD actions ───────────────────────────────────────────────────────────

  setLODLevel: (level) =>
    set((s) => ({
      lod: {
        ...s.lod,
        currentLevel:   level,
        visibleTypes:   LOD_VISIBLE_TYPES[level],
        manualOverride: true,
      },
    })),

  setLODAutoEnabled: (enabled) =>
    set((s) => ({
      lod: {
        ...s.lod,
        autoEnabled:    enabled,
        manualOverride: enabled ? false : s.lod.manualOverride,
      },
    })),

  onZoomChangedLOD: (zoom, rules = DEFAULT_LOD_AUTO_RULES) => {
    const { lod } = get()
    if (!lod.autoEnabled || lod.manualOverride) return

    const newLevel = resolveLODForZoom(zoom, rules)
    if (newLevel === lod.currentLevel) return

    set({
      lod: {
        ...lod,
        currentLevel: newLevel,
        visibleTypes: LOD_VISIBLE_TYPES[newLevel],
      },
    })
  },

  // ── Loading state ─────────────────────────────────────────────────────────

  setLoadingStatus: (status) =>
    set((s) => ({ loading: { ...s.loading, status, error: null } })),

  setStreamProgress: (loaded, total) =>
    set((s) => ({ loading: { ...s.loading, progress: { loaded, total } } })),

  setLoadingError: (message) =>
    set((s) => ({ loading: { ...s.loading, status: 'error', error: message } })),

  // ── Selection ─────────────────────────────────────────────────────────────

  setSelectedNode: (id) => set({ selectedNodeId: id }),
}))

// ─── Selectors ────────────────────────────────────────────────────────────────
// Memoization-friendly selector factory functions.
// Usage: const count = useGraphEngineStore(selectNodeCount)

export const selectNodeCount  = (s: GraphEngineState) => s.nodes.size
export const selectEdgeCount  = (s: GraphEngineState) => s.edges.size
export const selectVisibleNodeCount = (s: GraphEngineState) => s.visibleNodes.size
export const selectVisibleEdgeCount = (s: GraphEngineState) => s.visibleEdges.size
export const selectClusterCount = (s: GraphEngineState) => s.clusters.size
export const selectIsLoading  = (s: GraphEngineState) => s.loading.status === 'streaming' || s.loading.status === 'layout'
export const selectCurrentLOD = (s: GraphEngineState) => s.lod.currentLevel
export const selectZoom       = (s: GraphEngineState) => s.viewport.zoom
export const selectSelectedNode = (s: GraphEngineState) =>
  s.selectedNodeId ? s.nodes.get(s.selectedNodeId) ?? null : null
export const selectNode = (id: string) => (s: GraphEngineState) =>
  s.nodes.get(id) ?? null
export const selectIsNodeHighlighted = (id: string) => (s: GraphEngineState) =>
  s.filters.highlightedIds.has(id)
export const selectIsNodeExpanded = (id: string) => (s: GraphEngineState) =>
  s.expandedNodes.has(id)
