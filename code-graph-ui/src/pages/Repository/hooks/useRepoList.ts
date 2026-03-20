import { useCallback, useEffect, useRef } from "react";
import { graphEndpoints } from "../../../core/api/endpoints/graph";
import { repoEndpoints } from "../../../core/api/endpoints/graph";
import { useRepoStore } from "../../../store/repoStore";
import { usePipelineStore } from "../../../store/pipelineStore";
import type { RepoInfo } from "../../../types/api";

const CACHE_WINDOW_MS = 1200;

export function useRepoList() {
  const setRepos = useRepoStore((s) => s.setRepos);
  const setStages = usePipelineStore((s) => s.setStages);
  const stagesLoaded = usePipelineStore((s) => s.loaded);

  const cacheRef = useRef<{ at: number; repos: RepoInfo[] } | null>(null);
  const inFlightRef = useRef<Promise<RepoInfo[]> | null>(null);

  const normalizeRepo = (r: Record<string, unknown>): RepoInfo => {
    const latest = r.latest_analysis as Record<string, unknown> | undefined;
    return {
      repoId: (r.id ?? r.repo_id ?? r.repoId) as string,
      // graphId 优先从 latest_analysis 取，否则从顶层取
      graphId: (latest?.graph_id ?? r.graph_id ?? r.graphId ?? "") as string,
      repoName: (r.name ?? r.repo_name ?? r.repoName) as string,
      repoPath: (r.path ?? r.repo_path ?? r.repoPath ?? "") as string,
      branch: r.branch as string | undefined,
      sourceMode: ((r.source_mode ?? r.sourceMode) ?? "local") as
        | "local"
        | "git"
        | "zip",
      language: (r.language ?? []) as string[],
      createdAt: (r.created_at ?? r.createdAt ?? new Date().toISOString()) as string,
      updatedAt: (r.updated_at ?? r.updatedAt ?? new Date().toISOString()) as string,
      nodeCount: (latest?.node_count ?? r.node_count ?? r.nodeCount ?? 0) as number,
      edgeCount: (latest?.edge_count ?? r.edge_count ?? r.edgeCount ?? 0) as number,
      status: (latest?.status ?? r.status ?? "saved") as RepoInfo["status"],
      taskId: (latest?.task_id ?? r.task_id) as string | undefined,
      lastAnalyzedAt: (latest?.finished_at ?? r.updated_at) as string | undefined,
    };
  };

  const fetchRepos = useCallback(async (force = false): Promise<RepoInfo[]> => {
    const now = Date.now();
    if (!force && cacheRef.current && now - cacheRef.current.at < CACHE_WINDOW_MS) {
      return cacheRef.current.repos;
    }
    if (!force && inFlightRef.current) {
      return inFlightRef.current;
    }

    inFlightRef.current = (async () => {
      try {
        // 优先用新 /repos 端点，回退到旧 /graph 端点
        let repos: RepoInfo[];
        try {
          const res = await repoEndpoints.listRepos();
          repos = (res.repos ?? []).map(normalizeRepo);
        } catch {
          const res = await graphEndpoints.listGraphs();
          repos = res.graphs;
        }
        cacheRef.current = { at: Date.now(), repos };
        return repos;
      } finally {
        inFlightRef.current = null;
      }
    })();

    return inFlightRef.current;
  }, []);

  const syncRepos = useCallback(
    async (options?: { force?: boolean; onSuccess?: (count: number) => void }) => {
      const repos = await fetchRepos(Boolean(options?.force));
      setRepos(repos);
      options?.onSuccess?.(repos.length);
    },
    [fetchRepos, setRepos],
  );

  // 初始加载 Pipeline Stages
  useEffect(() => {
    if (stagesLoaded) return;
    repoEndpoints
      .getPipelineStages()
      .then(({ stages, total }) => setStages(stages, total))
      .catch(() => {
        // 降级：使用硬编码的默认 stages
        setStages(
          [
            { key: "file_index", label: "扫描文件", description: "" },
            { key: "deep_static_analysis", label: "静态分析", description: "" },
            { key: "parallel_stage", label: "模块聚类", description: "" },
            { key: "ai_semantic_enhance", label: "AI 语义增强", description: "" },
            { key: "spring_di_event_ai", label: "AI 歧义解析", description: "" },
            { key: "repository", label: "持久化存储", description: "" },
          ],
          6,
        );
      });
  }, [stagesLoaded, setStages]);

  return { syncRepos, fetchRepos };
}
