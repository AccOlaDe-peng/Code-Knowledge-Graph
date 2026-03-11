import { create } from 'zustand';
import type { GraphData, GraphNode } from '../types/graph';

interface GraphState {
  // 当前选中的图谱 ID
  activeGraphId: string | null;
  // 图谱数据缓存 graphId -> GraphData
  graphCache: Record<string, GraphData>;
  // 当前选中节点
  selectedNode: GraphNode | null;
  // 加载状态
  loading: boolean;
  // 错误信息
  error: string | null;

  // Actions
  setActiveGraphId: (id: string | null) => void;
  setGraphCache: (graphId: string, data: GraphData) => void;
  setSelectedNode: (node: GraphNode | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
}

export const useGraphStore = create<GraphState>((set) => ({
  activeGraphId: null,
  graphCache: {},
  selectedNode: null,
  loading: false,
  error: null,

  setActiveGraphId: (id) => set({ activeGraphId: id }),

  setGraphCache: (graphId, data) =>
    set((state) => ({
      graphCache: { ...state.graphCache, [graphId]: data },
    })),

  setSelectedNode: (node) => set({ selectedNode: node }),

  setLoading: (loading) => set({ loading }),

  setError: (error) => set({ error }),

  clearError: () => set({ error: null }),
}));
