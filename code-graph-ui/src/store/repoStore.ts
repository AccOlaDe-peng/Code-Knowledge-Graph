import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
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

const mergeRemoteRepos = (
  current: RepoInfo[],
  incoming: RepoInfo[],
): RepoInfo[] => {
  const byGraphId = new Map<string, RepoInfo>();
  for (const repo of current) {
    if (repo.graphId) byGraphId.set(repo.graphId, repo);
  }

  const normalizedIncoming = incoming.map((repo) => {
    const existing = repo.graphId ? byGraphId.get(repo.graphId) : undefined;
    const status: RepoInfo["status"] =
      existing?.status === "analyzing" ? "analyzing" : "completed";

    return {
      ...repo,
      repoId: existing?.repoId ?? repo.repoId ?? repo.graphId,
      status,
      taskId: existing?.status === "analyzing" ? existing.taskId : undefined,
      analysisStep:
        existing?.status === "analyzing" ? existing.analysisStep : undefined,
      analysisTotal:
        existing?.status === "analyzing" ? existing.analysisTotal : undefined,
      analysisStage:
        existing?.status === "analyzing" ? existing.analysisStage : undefined,
      analysisMessage:
        existing?.status === "analyzing" ? existing.analysisMessage : undefined,
      analysisElapsedSeconds:
        existing?.status === "analyzing"
          ? existing.analysisElapsedSeconds
          : undefined,
      error: existing?.status === "failed" ? existing.error : undefined,
      lastAnalyzedAt: repo.createdAt,
    };
  });

  const incomingKeys = new Set(normalizedIncoming.map((r) => r.repoId));
  const localOnly = current.filter((repo) => {
    if (incomingKeys.has(repo.repoId)) return false;
    if (!repo.graphId) return true;
    return (
      repo.status === "analyzing" ||
      repo.status === "failed" ||
      repo.status === "canceled"
    );
  });

  return [...localOnly, ...normalizedIncoming];
};

export const useRepoStore = create<RepoState>()(
  persist(
    (set) => ({
      repos: [],
      activeRepo: null,
      loading: false,
      error: null,

      setRepos: (repos) =>
        set((state) => ({ repos: mergeRemoteRepos(state.repos, repos) })),

      setActiveRepo: (repo) => set({ activeRepo: repo }),

      addRepo: (repo) =>
        set((state) => ({
          repos: [repo, ...state.repos.filter((r) => r.repoId !== repo.repoId)],
        })),

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
    }),
    {
      name: "repo-store-v2",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        repos: state.repos,
        activeRepo: state.activeRepo,
      }),
    },
  ),
);
