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
  callGraph:    AsyncSlice<Graph>
  lineageGraph: AsyncSlice<Graph>
  eventGraph:   AsyncSlice<Graph>
  moduleGraph:  AsyncSlice<Graph>   // NEW: /graph/module (contains + imports)
  fullGraph:    AsyncSlice<Graph>   // NEW: /graph/data   (all nodes + edges)

  // Actions — context
  setActiveGraphId: (id: string | null) => void
  setSelectedNode:  (node: GraphNode | null) => void

  // Actions — async loaders
  loadCallGraph:   (repoId: string) => Promise<void>
  loadLineage:     (repoId: string) => Promise<void>
  loadEvents:      (repoId: string) => Promise<void>
  loadModuleGraph: (repoId: string) => Promise<void>  // NEW
  loadFullGraph:   (repoId: string) => Promise<void>  // NEW

  // Actions — reset
  clearGraphs: () => void
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useGraphStore = create<GraphStore>((set) => ({
  activeGraphId: null,
  selectedNode:  null,

  callGraph:    idle(),
  lineageGraph: idle(),
  eventGraph:   idle(),
  moduleGraph:  idle(),
  fullGraph:    idle(),

  // ── Context ─────────────────────────────────────────────────────────────────

  setActiveGraphId: (id) => set({ activeGraphId: id }),

  setSelectedNode: (node) => set({ selectedNode: node }),

  // ── Loaders ─────────────────────────────────────────────────────────────────

  // Uses new /graph/call endpoint (GraphStorage-backed, lowercase node types)
  loadCallGraph: async (repoId) => {
    set({ callGraph: { data: null, loading: true, error: null } })
    try {
      const res = await graphApi.getCallView(repoId)
      const graph = {
        nodes: res.nodes.map(rawNodeToGraphNode),
        edges: res.edges.map(rawEdgeToGraphEdge),
      }
      set({ callGraph: { data: graph, loading: false, error: null } })
    } catch (e) {
      set({ callGraph: { data: null, loading: false, error: String(e) } })
    }
  },

  loadLineage: async (repoId) => {
    set({ lineageGraph: { data: null, loading: true, error: null } })
    try {
      const res = await graphApi.getLineageView(repoId)
      const graph = {
        nodes: res.nodes.map(rawNodeToGraphNode),
        edges: res.edges.map(rawEdgeToGraphEdge),
      }
      set({ lineageGraph: { data: graph, loading: false, error: null } })
    } catch (e) {
      set({ lineageGraph: { data: null, loading: false, error: String(e) } })
    }
  },

  loadEvents: async (repoId) => {
    set({ eventGraph: { data: null, loading: true, error: null } })
    try {
      const res = await graphApi.getEventsGraph(repoId)
      set({ eventGraph: { data: res, loading: false, error: null } })
    } catch (e) {
      set({ eventGraph: { data: null, loading: false, error: String(e) } })
    }
  },

  // NEW: Uses /graph/framework?node_types=Module,File (contains + imports edges)
  loadModuleGraph: async (repoId) => {
    set({ moduleGraph: { data: null, loading: true, error: null } })
    try {
      const res = await graphApi.getFramework(repoId, 'Module,File')
      const graph = {
        nodes: res.nodes.map(rawNodeToGraphNode),
        edges: res.edges.map(rawEdgeToGraphEdge),
      }
      set({ moduleGraph: { data: graph, loading: false, error: null } })
    } catch (e) {
      set({ moduleGraph: { data: null, loading: false, error: String(e) } })
    }
  },

  // NEW: Uses /graph/framework?node_types=all (full graph, all node/edge types)
  loadFullGraph: async (repoId) => {
    set({ fullGraph: { data: null, loading: true, error: null } })
    try {
      const res = await graphApi.getFramework(repoId, 'all')
      const graph = {
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
      callGraph:    idle(),
      lineageGraph: idle(),
      eventGraph:   idle(),
      moduleGraph:  idle(),
      fullGraph:    idle(),
    }),
}))
