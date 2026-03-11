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

  setLoading: (loading) => set({ loading }),

  setError: (error) => set({ error }),
}));
