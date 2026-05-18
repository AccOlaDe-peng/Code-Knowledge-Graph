import { useCallback, useEffect, useRef } from "react";
import { graphEndpoints } from "../../../core/api/endpoints/graph";
import { repoEndpoints } from "../../../core/api/endpoints/graph";
import { useRepoStore } from "../../../store/repoStore";
import { usePipelineStore } from "../../../store/pipelineStore";
import type { RepoInfo } from "../../../types/api";

const CACHE_WINDOW_MS = 1200;

function mapBackendStatus(raw: string | undefined): string {
  if (!raw || raw === "idle") return "saved";
  if (raw === "running") return "analyzing";
  return raw;
}

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
      language: (r.languages ?? r.language ?? []) as string[],
      createdAt: (r.created_at ?? r.createdAt ?? new Date().toISOString()) as string,
      updatedAt: (r.updated_at ?? r.updatedAt ?? new Date().toISOString()) as string,
      nodeCount: (latest?.node_count ?? r.node_count ?? r.nodeCount ?? 0) as number,
      edgeCount: (latest?.edge_count ?? r.edge_count ?? r.edgeCount ?? 0) as number,
      status: mapBackendStatus(
	        (latest?.status ?? r.status) as string | undefined,
	      ) as RepoInfo["status"],
      taskId: (latest?.task_id ?? latest?.id ?? r.task_id) as string | undefined,
      analysisStage: (latest?.stage ?? r.stage) as string | undefined,
      analysisStep: (latest?.step ?? r.step) as number | undefined,
      analysisTotal: (latest?.total ?? r.total) as number | undefined,
      analysisMessage: (latest?.message ?? r.message) as string | undefined,
      error: (latest?.error ?? r.error) as string | undefined,
      gitCommit: (latest?.git_commit ?? r.git_commit) as string | undefined,
      lastAnalyzedAt: (latest?.finished_at ?? r.updated_at) as string | undefined,
    };
  };

  const fetchRepos = useCallback(async (force = false): Promise<RepoInfo[]> => {
    const now = Date.now();
    // Skip cache if any repo is currently analyzing
    const hasAnalyzing = cacheRef.current?.repos.some((r) => r.status === "analyzing");
    if (!force && !hasAnalyzing && cacheRef.current && now - cacheRef.current.at < CACHE_WINDOW_MS) {
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
        // 降级：使用与后端一致的默认 stages
        setStages(
          [
            { key: "file_index", label: "文件扫描", description: "扫描并索引仓库中的源文件" },
            { key: "deep_static_analysis", label: "静态分析", description: "基于 AST 的深度静态结构提取" },
            { key: "ai_semantic_enhance", label: "AI 语义增强", description: "LLM 驱动的模块边界与语义关系识别" },
            { key: "data_lineage", label: "数据血缘", description: "追踪数据在函数与模块间的流动路径" },
            { key: "graph_build", label: "图谱构建", description: "合并多源分析结果为统一知识图谱" },
            { key: "report", label: "报告生成", description: "生成架构概览与优化建议" },
          ],
          6,
        );
      });
  }, [stagesLoaded, setStages]);

  return { syncRepos, fetchRepos };
}
