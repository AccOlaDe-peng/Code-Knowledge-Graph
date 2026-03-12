import { create } from 'zustand';
import type { RepoInfo } from '../types/api';

interface RepoState {
  // 仓库列表
  repos: RepoInfo[];
  // 当前选中仓库
  activeRepo: RepoInfo | null;
  // 加载状态
  loading: boolean;
  // 错误信息
  error: string | null;

  // Actions
  setRepos: (repos: RepoInfo[]) => void;
  setActiveRepo: (repo: RepoInfo | null) => void;
  addRepo: (repo: RepoInfo) => void;
  removeRepo: (graphId: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useRepoStore = create<RepoState>((set) => ({
  repos: [],
  activeRepo: null,
  loading: false,
  error: null,

  setRepos: (repos) => set({ repos }),

  setActiveRepo: (repo) => set({ activeRepo: repo }),

  addRepo: (repo) =>
    set((state) => ({
      repos: [repo, ...state.repos],
    })),

  removeRepo: (graphId) =>
    set((state) => ({
      repos: state.repos.filter(r => r.graphId !== graphId),
      activeRepo: state.activeRepo?.graphId === graphId ? null : state.activeRepo,
    })),

  setLoading: (loading) => set({ loading }),

  setError: (error) => set({ error }),
}));
