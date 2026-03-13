import { create } from 'zustand'
import type { Graph, GraphNode } from '../types/graph'
import { graphApi, rawNodeToGraphNode, rawEdgeToGraphEdge } from '../api/graphApi'

// ─── Async Slice Helper ───────────────────────────────────────────────────────

type AsyncSlice<T> = {
  data: T | null
  loading: boolean
  error: string | null
}

const idle = <T>(): AsyncSlice<T> => ({ data: null, loading: false, error: null })

// ─── State Shape ──────────────────────────────────────────────────────────────

type GraphStore = {
  // Active repo context
  activeGraphId: string | null
  selectedNode:  GraphNode | null

  // Graph views
  graph:        AsyncSlice<Graph>
  callGraph:    AsyncSlice<Graph>
  lineageGraph: AsyncSlice<Graph>
  eventGraph:   AsyncSlice<Graph>
  moduleGraph:  AsyncSlice<Graph>   // NEW: /graph/module (contains + imports)
  fullGraph:    AsyncSlice<Graph>   // NEW: /graph/data   (all nodes + edges)

  // Actions — context
  setActiveGraphId: (id: string | null) => void
  setSelectedNode:  (node: GraphNode | null) => void

  // Actions — async loaders
  loadGraph:       (graphId: string) => Promise<void>
  loadCallGraph:   (graphId: string) => Promise<void>
  loadLineage:     (graphId: string) => Promise<void>
  loadEvents:      (graphId: string) => Promise<void>
  loadModuleGraph: (graphId: string) => Promise<void>  // NEW
  loadFullGraph:   (graphId: string) => Promise<void>  // NEW

  // Actions — reset
  clearGraphs: () => void
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useGraphStore = create<GraphStore>((set) => ({
  activeGraphId: null,
  selectedNode:  null,

  graph:        idle(),
  callGraph:    idle(),
  lineageGraph: idle(),
  eventGraph:   idle(),
  moduleGraph:  idle(),
  fullGraph:    idle(),

  // ── Context ─────────────────────────────────────────────────────────────────

  setActiveGraphId: (id) => set({ activeGraphId: id }),

  setSelectedNode: (node) => set({ selectedNode: node }),

  // ── Loaders ─────────────────────────────────────────────────────────────────

  loadGraph: async (graphId) => {
    set({ graph: { data: null, loading: true, error: null } })
    try {
      const res = await graphApi.getGraph(graphId)
      set({ graph: { data: res, loading: false, error: null } })
    } catch (e) {
      set({ graph: { data: null, loading: false, error: String(e) } })
    }
  },

  // Uses new /graph/call endpoint (GraphStorage-backed, lowercase node types)
  loadCallGraph: async (graphId) => {
    set({ callGraph: { data: null, loading: true, error: null } })
    try {
      const res = await graphApi.getCallSubgraph(graphId)
      const graph: Graph = {
        nodes: res.nodes.map(rawNodeToGraphNode),
        edges: res.edges.map(rawEdgeToGraphEdge),
      }
      set({ callGraph: { data: graph, loading: false, error: null } })
    } catch {
      // Fallback to old /callgraph endpoint
      try {
        const res = await graphApi.getCallGraph(graphId)
        set({ callGraph: { data: res, loading: false, error: null } })
      } catch (e2) {
        set({ callGraph: { data: null, loading: false, error: String(e2) } })
      }
    }
  },

  loadLineage: async (graphId) => {
    set({ lineageGraph: { data: null, loading: true, error: null } })
    try {
      const res = await graphApi.getLineageGraph(graphId)
      set({ lineageGraph: { data: res, loading: false, error: null } })
    } catch (e) {
      set({ lineageGraph: { data: null, loading: false, error: String(e) } })
    }
  },

  loadEvents: async (graphId) => {
    set({ eventGraph: { data: null, loading: true, error: null } })
    try {
      const res = await graphApi.getEventsGraph(graphId)
      set({ eventGraph: { data: res, loading: false, error: null } })
    } catch (e) {
      set({ eventGraph: { data: null, loading: false, error: String(e) } })
    }
  },

  // NEW: Uses /graph/module (contains + imports edges)
  loadModuleGraph: async (graphId) => {
    set({ moduleGraph: { data: null, loading: true, error: null } })
    try {
      const res = await graphApi.getModuleSubgraph(graphId, 'all')
      const graph: Graph = {
        nodes: res.nodes.map(rawNodeToGraphNode),
        edges: res.edges.map(rawEdgeToGraphEdge),
      }
      set({ moduleGraph: { data: graph, loading: false, error: null } })
    } catch (e) {
      set({ moduleGraph: { data: null, loading: false, error: String(e) } })
    }
  },

  // NEW: Uses /graph/data (full graph, all node/edge types)
  loadFullGraph: async (graphId) => {
    set({ fullGraph: { data: null, loading: true, error: null } })
    try {
      const res = await graphApi.getGraphData(graphId)
      const graph: Graph = {
        nodes: res.nodes.map(rawNodeToGraphNode),
        edges: res.edges.map(rawEdgeToGraphEdge),
      }
      set({ fullGraph: { data: graph, loading: false, error: null } })
    } catch (e) {
      set({ fullGraph: { data: null, loading: false, error: String(e) } })
    }
  },

  // ── Reset ────────────────────────────────────────────────────────────────────

  clearGraphs: () =>
    set({
      graph:        idle(),
      callGraph:    idle(),
      lineageGraph: idle(),
      eventGraph:   idle(),
      moduleGraph:  idle(),
      fullGraph:    idle(),
    }),
}))
