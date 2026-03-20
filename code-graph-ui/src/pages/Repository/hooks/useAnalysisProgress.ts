import { useEffect, useRef } from "react";
import { useRepoStore } from "../../../store/repoStore";
import { useAnalysisStream } from "../../../core/hooks/useAnalysisStream";
import type { RepoInfo } from "../../../types/api";

/**
 * 监听指定仓库的 SSE 分析进度，自动将事件写入 repoStore。
 */
export function useAnalysisProgress(repo: RepoInfo | null) {
  const updateRepo = useRepoStore((s) => s.updateRepo);
  const taskId =
    repo?.status === "analyzing" ? (repo.taskId ?? null) : null;
  const { currentStep, finalResult } = useAnalysisStream(taskId);
  const lastAppliedEventRef = useRef<string>("");

  // 切换任务后清空去重标记
  useEffect(() => {
    lastAppliedEventRef.current = "";
  }, [taskId]);

  useEffect(() => {
    if (!repo || repo.status !== "analyzing") return;

    const event = finalResult ?? currentStep;
    if (!event) return;

    const eventKey = JSON.stringify({
      taskId,
      status: event.status,
      step: event.step,
      total: event.total,
      stage: event.stage,
      message: event.message,
      elapsed: event.elapsed_seconds,
      graphId: event.graph_id,
      nodeCount: event.node_count,
      edgeCount: event.edge_count,
      error: event.error,
    });

    if (lastAppliedEventRef.current === eventKey) return;
    lastAppliedEventRef.current = eventKey;

    const patch: Partial<RepoInfo> = {
      analysisStep: event.step,
      analysisTotal: event.total,
      analysisStage: event.stage,
      analysisMessage: event.message,
      analysisElapsedSeconds: event.elapsed_seconds,
    };

    if (event.status === "completed" || event.status === "completed_partial") {
      updateRepo(repo.repoId, {
        ...patch,
        status: event.status,
        graphId: event.graph_id || repo.graphId,
        nodeCount: event.node_count ?? repo.nodeCount,
        edgeCount: event.edge_count ?? repo.edgeCount,
        taskId: undefined,
        error: undefined,
        lastAnalyzedAt: new Date().toISOString(),
      });
      return;
    }

    if (event.status === "failed" || event.status === "error") {
      updateRepo(repo.repoId, {
        ...patch,
        status: "failed",
        taskId: undefined,
        error: event.error || event.message || "分析失败",
        lastAnalyzedAt: new Date().toISOString(),
      });
      return;
    }

    if (event.status === "canceled") {
      updateRepo(repo.repoId, {
        ...patch,
        status: "canceled",
        taskId: undefined,
        lastAnalyzedAt: new Date().toISOString(),
      });
      return;
    }

    updateRepo(repo.repoId, { ...patch, status: "analyzing" });
  }, [repo, taskId, currentStep, finalResult, updateRepo]);
}
