import { create } from 'zustand'
import type { Graph, GraphNode } from '../types/graph'
import { graphApi } from '../api/graphApi'

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

  // Actions — context
  setActiveGraphId: (id: string | null) => void
  setSelectedNode:  (node: GraphNode | null) => void

  // Actions — async loaders
  loadGraph:     (graphId: string) => Promise<void>
  loadCallGraph: (graphId: string) => Promise<void>
  loadLineage:   (graphId: string) => Promise<void>
  loadEvents:    (graphId: string) => Promise<void>

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

  loadCallGraph: async (graphId) => {
    set({ callGraph: { data: null, loading: true, error: null } })
    try {
      const res = await graphApi.getCallGraph(graphId)
      set({ callGraph: { data: res, loading: false, error: null } })
    } catch (e) {
      set({ callGraph: { data: null, loading: false, error: String(e) } })
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

  // ── Reset ────────────────────────────────────────────────────────────────────

  clearGraphs: () =>
    set({
      graph:        idle(),
      callGraph:    idle(),
      lineageGraph: idle(),
      eventGraph:   idle(),
    }),
}))
