import { create } from "zustand";
import type { RepoInfo } from "../types/api";

interface RepoState {
  repos: RepoInfo[];
  activeRepo: RepoInfo | null;
  loading: boolean;
  error: string | null;

  setRepos: (repos: RepoInfo[]) => void;
  setActiveRepo: (repo: RepoInfo | null) => void;
  addRepo: (repo: RepoInfo) => void;
  updateRepo: (repoId: string, patch: Partial<RepoInfo>) => void;
  removeRepo: (repoId: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

const dedupeRepos = (incoming: RepoInfo[]): RepoInfo[] => {
  const byKey = new Map<string, RepoInfo>();
  for (const repo of incoming) {
    // 优先用 repoId 去重，repoId 是稳定 ID；graphId 仅作展示用
    const key = repo.repoId || repo.graphId;
    if (!key) continue;
    byKey.set(key, {
      ...repo,
      repoId: repo.repoId || repo.graphId,
    });
  }
  return Array.from(byKey.values());
};

export const useRepoStore = create<RepoState>()((set) => ({
  repos: [],
  activeRepo: null,
  loading: false,
  error: null,

  setRepos: (repos) =>
    set((state) => {
      const nextRepos = dedupeRepos(repos);
      // 保留正在分析中的仓库的实时 SSE 进度，避免被后端快照覆盖
      const analyzingMap = new Map<string, RepoInfo>();
      for (const r of state.repos) {
        if (r.status === "analyzing") {
          analyzingMap.set(r.repoId, r);
        }
      }
      const merged = nextRepos.map((r) => {
        const live = analyzingMap.get(r.repoId);
        if (live && r.status !== "analyzing") {
          // 后端快照状态滞后，保留前端的实时状态
          return { ...r, ...live };
        }
        return r;
      });
      const nextActiveRepo = state.activeRepo
        ? (merged.find((r) => r.repoId === state.activeRepo?.repoId) ??
          null)
        : null;
      return {
        repos: merged,
        activeRepo: nextActiveRepo,
      };
    }),

  setActiveRepo: (repo) => set({ activeRepo: repo }),

  addRepo: (repo) =>
    set((state) => {
      // 按 repoPath 或 repoId 去重，避免同一个仓库被添加多次
      const existingIndex = state.repos.findIndex(
        (r) =>
          (repo.repoPath && r.repoPath === repo.repoPath) ||
          r.repoId === repo.repoId,
      );

      if (existingIndex >= 0) {
        // 更新现有仓库
        const updated = [...state.repos];
        updated[existingIndex] = { ...updated[existingIndex], ...repo };
        return { repos: updated };
      }

      // 添加新仓库
      return { repos: [repo, ...state.repos] };
    }),

  updateRepo: (repoId, patch) =>
    set((state) => ({
      repos: state.repos.map((repo) =>
        repo.repoId === repoId ? { ...repo, ...patch } : repo,
      ),
      activeRepo:
        state.activeRepo?.repoId === repoId
          ? { ...state.activeRepo, ...patch }
          : state.activeRepo,
    })),

  removeRepo: (repoId) =>
    set((state) => ({
      repos: state.repos.filter((r) => r.repoId !== repoId),
      activeRepo:
        state.activeRepo?.repoId === repoId ? null : state.activeRepo,
    })),

  setLoading: (loading) => set({ loading }),

  setError: (error) => set({ error }),
}));
