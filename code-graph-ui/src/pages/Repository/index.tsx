import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, message, Space } from "antd";
import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { graphEndpoints } from "../../core/api/endpoints/graph";
import { useRepoStore } from "../../store/repoStore";
import { useGraphStore } from "../../store/graphStore";
import { usePipelineStore } from "../../store/pipelineStore";
import type { AnalysisDepth, RepoInfo } from "../../types/api";
import { useRepoList } from "./hooks/useRepoList";
import { useAnalysisProgress } from "./hooks/useAnalysisProgress";
import { DEPTH_OPTIONS } from "./constants";
import {
  AddRepoModal,
  AnalysisConfirmDialog,
  RepoCard,
  RepoDetailDrawer,
} from "./components";
import type { RepoFormValues } from "./components/AddRepoModal";

const inferRepoName = (
  source: string | undefined,
  fallback?: string,
): string => {
  if (fallback?.trim()) return fallback.trim();
  if (!source) return `repo-${Date.now()}`;
  const normalized = source.replace(/\\/g, "/").replace(/\/$/, "");
  const last = normalized.split("/").pop() || normalized;
  return last.replace(/\.git$/i, "") || `repo-${Date.now()}`;
};

const Repository: React.FC = () => {
  const navigate = useNavigate();

  const repos = useRepoStore((s) => s.repos ?? []);
  const addRepo = useRepoStore((s) => s.addRepo);
  const updateRepo = useRepoStore((s) => s.updateRepo);
  const setRepos = useRepoStore((s) => s.setRepos);
  const { setActiveGraphId } = useGraphStore();
  const setActiveRepo = useRepoStore((s) => s.setActiveRepo);
  const stages = usePipelineStore((s) => s.stages);

  const { syncRepos, fetchRepos } = useRepoList();

  const [modalOpen, setModalOpen] = useState(false);
  const [editRepo, setEditRepo] = useState<RepoInfo | null>(null);
  const [detailRepoId, setDetailRepoId] = useState<string | null>(null);
  const [analysisConfirmRepo, setAnalysisConfirmRepo] = useState<RepoInfo | null>(null);
  const [analysisDepth, setAnalysisDepth] = useState<AnalysisDepth>("standard");

  const detailRepo = useMemo(
    () => repos.find((repo) => repo.repoId === detailRepoId) ?? null,
    [repos, detailRepoId],
  );

  // 使用 hook 监听分析进度
  useAnalysisProgress(detailRepo);

  // 页面加载时同步后端状态
  useEffect(() => {
    void syncRepos({ force: true });
  }, [syncRepos]);

  const refreshLocalRepos = useCallback(() => {
    void syncRepos({ force: true, onSuccess: (count) => {
      message.success(`已同步 ${count} 个仓库`);
    }});
  }, [syncRepos]);

  const handleSaveRepo = useCallback(
    async (values: RepoFormValues, mode: "create" | "edit") => {
      const sourceMode = editRepo?.sourceMode ?? "git";
      const repoPath =
        sourceMode === "git" ? values.gitUrl : values.repoPath;

      if (!repoPath && mode === "create") {
        throw new Error("仓库地址不能为空");
      }

      const repoName = inferRepoName(repoPath, values.repoName);

      if (mode === "create") {
        const repoId = `repo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        // 持久化到后端
        await graphEndpoints.saveRepo({
          repo_id: repoId,
          repo_name: repoName,
          repo_path: repoPath!,
          branch: values.branch,
          source_mode: sourceMode,
          language: values.languages ?? [],
        });

        addRepo({
          repoId,
          graphId: "",
          repoName,
          language: values.languages ?? [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          nodeCount: 0,
          edgeCount: 0,
          repoPath,
          branch: values.branch,
          sourceMode,
          status: "saved",
        });

        message.success("仓库已保存，可在列表中发起分析");
      } else if (mode === "edit" && editRepo) {
        // 编辑模式：调用 PUT /repos/:id
        // TODO: 等待后端实现 PUT /repos/:id
        updateRepo(editRepo.repoId, {
          repoName,
          branch: values.branch,
          language: values.languages ?? [],
        });
        message.success("仓库已更新");
      }
    },
    [addRepo, updateRepo, editRepo],
  );

  const startAnalysis = useCallback(
    async (repo: RepoInfo, depth: AnalysisDepth = "standard") => {
      if (!repo.repoPath) {
        message.error("缺少仓库路径，无法分析");
        return;
      }
      if (repo.status === "analyzing") {
        message.warning("该仓库正在分析中，请勿重复提交");
        return;
      }

      try {
        const response = await graphEndpoints.analyzeRepository({
          repo_path: repo.repoPath,
          repo_name: repo.repoName,
          branch: repo.branch,
          languages: repo.language.length > 0 ? repo.language : undefined,
          depth,
        });

        updateRepo(repo.repoId, {
          status: "analyzing",
          taskId: response.task_id,
          error: undefined,
          analysisStep: 0,
          analysisTotal: stages.length,
          analysisStage: "pending",
          analysisMessage: "等待调度执行",
        });
        message.success(
          `已开始分析: ${repo.repoName} (${DEPTH_OPTIONS.find((o) => o.value === depth)?.label})`,
        );
      } catch (error) {
        const text = error instanceof Error ? error.message : "分析任务提交失败";
        updateRepo(repo.repoId, { status: "failed", error: text });
        message.error(text);
      }
    },
    [stages.length, updateRepo],
  );

  const handleCancel = useCallback(
    async (repo: RepoInfo) => {
      let taskId = repo.taskId;
      if (!taskId && repo.status === "analyzing") {
        const latestRepos = await fetchRepos(true);
        setRepos(latestRepos);
        const latest = latestRepos.find((r) => r.repoId === repo.repoId);
        taskId = latest?.taskId;
      }

      if (!taskId) {
        message.warning("当前任务不存在或已结束");
        return;
      }

      try {
        await graphEndpoints.cancelAnalysis(taskId);
        updateRepo(repo.repoId, {
          status: "canceled",
          taskId: undefined,
          analysisMessage: "已发送取消请求",
          lastAnalyzedAt: new Date().toISOString(),
        });
        message.warning(`已取消: ${repo.repoName}`);
      } catch (error) {
        message.error(error instanceof Error ? error.message : "取消失败");
      }
    },
    [fetchRepos, setRepos, updateRepo],
  );

  const handleViewGraph = useCallback(
    (repo: RepoInfo) => {
      if (!repo.graphId) {
        message.warning("该仓库尚未生成图谱");
        return;
      }

      setActiveRepo(repo);
      setActiveGraphId(repo.graphId);
      navigate(`/architecture?graph_id=${repo.graphId}`);
    },
    [navigate, setActiveGraphId, setActiveRepo],
  );

  const handleDelete = useCallback(
    async (repo: RepoInfo) => {
      try {
        // 调用删除 API
        await graphEndpoints.saveRepo({
          repo_id: repo.repoId,
          repo_name: repo.repoName,
          repo_path: repo.repoPath || "",
        });
        // 删除后重新从后端同步
        await syncRepos({ force: true });
        message.success("仓库已删除");
        if (detailRepoId === repo.repoId) {
          setDetailRepoId(null);
        }
      } catch (error) {
        message.error(error instanceof Error ? error.message : "删除失败");
      }
    },
    [detailRepoId, syncRepos],
  );

  const existingPaths = useMemo(
    () => repos.map((r) => r.repoPath).filter(Boolean) as string[],
    [repos],
  );

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          marginBottom: 24,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 9,
              fontFamily: "'IBM Plex Mono'",
              color: "var(--t-muted)",
              letterSpacing: "0.15em",
              marginBottom: 4,
            }}
          >
            系统 / 仓库
          </div>
          <h2
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 700,
              color: "var(--t-primary)",
              fontFamily: "'Syne', sans-serif",
              letterSpacing: "-0.01em",
            }}
          >
            仓库管理
          </h2>
        </div>

        <Space>
          <Button
            icon={<ReloadOutlined />}
            onClick={refreshLocalRepos}
            style={{ fontFamily: "'IBM Plex Mono'" }}
          >
            刷新
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditRepo(null);
              setModalOpen(true);
            }}
            style={{ fontFamily: "'IBM Plex Mono'" }}
          >
            添加仓库
          </Button>
        </Space>
      </div>

      <div
        style={{
          background: "var(--s-raised)",
          border: "1px solid var(--b-faint)",
          borderRadius: "var(--radius-m)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "14px 20px",
            borderBottom: "1px solid var(--b-faint)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              fontFamily: "'IBM Plex Mono'",
              fontSize: 10,
              color: "var(--t-secondary)",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}
          >
            仓库列表
          </div>
          <div
            style={{
              fontFamily: "'IBM Plex Mono'",
              fontSize: 10,
              color: "var(--t-muted)",
            }}
          >
            共 {repos.length} 个
          </div>
        </div>

        {repos.length === 0 && (
          <div style={{ padding: "60px 40px", textAlign: "center" }}>
            <div style={{ fontSize: 48, opacity: 0.06, marginBottom: 16 }}>
              ⬡
            </div>
            <div
              style={{
                fontFamily: "'IBM Plex Mono'",
                fontSize: 11,
                color: "var(--t-muted)",
                letterSpacing: "0.1em",
                marginBottom: 12,
              }}
            >
              暂无仓库
            </div>
            <Button
              type="link"
              onClick={() => setModalOpen(true)}
              style={{ fontFamily: "'IBM Plex Mono'", fontSize: 11 }}
            >
              添加第一个仓库
            </Button>
          </div>
        )}

        {repos.length > 0 && (
          <div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "2fr 1fr 1fr 1.2fr 1.8fr",
                gap: 16,
                padding: "12px 20px",
                background: "var(--s-float)",
                borderBottom: "1px solid var(--b-faint)",
              }}
            >
              {["名称", "分支", "状态", "最近分析", "操作"].map((header) => (
                <div
                  key={header}
                  style={{
                    fontFamily: "'IBM Plex Mono'",
                    fontSize: 9,
                    color: "var(--t-muted)",
                    letterSpacing: "0.12em",
                  }}
                >
                  {header}
                </div>
              ))}
            </div>

            {repos.map((repo) => (
              <RepoCard
                key={repo.repoId}
                repo={repo}
                isActive={detailRepoId === repo.repoId}
                onSelect={() => setDetailRepoId(repo.repoId)}
                onAnalyze={() => {
                  setAnalysisConfirmRepo(repo);
                  setAnalysisDepth("standard");
                }}
                onCancel={handleCancel}
                onViewGraph={handleViewGraph}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>

      {/* 添加/编辑仓库 Modal */}
      <AddRepoModal
        open={modalOpen}
        editRepo={editRepo}
        onClose={() => {
          setModalOpen(false);
          setEditRepo(null);
        }}
        onSubmit={handleSaveRepo}
        existingPaths={existingPaths}
      />

      {/* 仓库详情 Drawer */}
      <RepoDetailDrawer
        repo={detailRepo}
        onClose={() => setDetailRepoId(null)}
        onViewGraph={handleViewGraph}
      />

      {/* 分析确认对话框 */}
      <AnalysisConfirmDialog
        repo={analysisConfirmRepo}
        depth={analysisDepth}
        onDepthChange={setAnalysisDepth}
        onStart={startAnalysis}
        onClose={() => setAnalysisConfirmRepo(null)}
      />
    </div>
  );
};

export default Repository;
