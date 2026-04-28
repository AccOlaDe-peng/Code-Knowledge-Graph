import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, message, Space, Input, Dropdown, Empty } from "antd";
import type { MenuProps } from "antd";
import {
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  AppstoreOutlined,
  UnorderedListOutlined,
  FilterOutlined,
  SortAscendingOutlined,
} from "@ant-design/icons";
import { graphEndpoints, repoEndpoints } from "../../core/api/endpoints/graph";
import { useRepoStore } from "../../store/repoStore";
import { useGraphStore } from "../../store/graphStore";
import { usePipelineStore } from "../../store/pipelineStore";
import type { RepoInfo } from "../../types/api";
import { useRepoList } from "./hooks/useRepoList";
import { useAnalysisProgress } from "./hooks/useAnalysisProgress";
import {
  AddRepoModal,
  AnalysisConfirmDialog,
  RepoCard,
  RepoDetailDrawer,
} from "./components";
import type { RepoFormValues } from "./components/AddRepoModal";
import { SkeletonList } from "../../components/ui/Skeleton";
import { EmptyRepository } from "../../components/ui/EmptyState";

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

type ViewMode = "grid" | "list";
type SortBy = "name" | "createdAt" | "lastAnalyzedAt" | "status";

const Repository: React.FC = () => {
  const navigate = useNavigate();

  const repos = useRepoStore((s) => s.repos ?? []);
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

  // UI state
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("lastAnalyzedAt");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

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
      const sourceMode = values.sourceMode ?? editRepo?.sourceMode ?? "git";
      const repoPath =
        sourceMode === "git" ? values.gitUrl : values.repoPath;

      if (!repoPath && mode === "create") {
        throw new Error("仓库地址不能为空");
      }

      const repoName = inferRepoName(repoPath, values.repoName);

      if (mode === "create") {
        await repoEndpoints.createRepo({
          repo_name: repoName,
          repo_path: repoPath!,
          branch: values.branch,
          source_mode: sourceMode,
          language: values.languages ?? [],
        });

        await syncRepos({ force: true });
        message.success("仓库已保存，可在列表中发起分析");
      } else if (mode === "edit" && editRepo) {
        updateRepo(editRepo.repoId, {
          repoName,
          branch: values.branch,
          language: values.languages ?? [],
        });
        message.success("仓库已更新");
      }
    },
    [updateRepo, editRepo, syncRepos],
  );

  const startAnalysis = useCallback(
    async (repo: RepoInfo) => {
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
          repo_id: repo.repoId,
          branch: repo.branch,
          languages: repo.language.length > 0 ? repo.language : undefined,
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
        message.success(`已开始分析: ${repo.repoName}`);
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
        await repoEndpoints.deleteRepo(repo.repoId);
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

  // Filter and sort repos
  const filteredRepos = useMemo(() => {
    let result = [...repos];

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (repo) =>
          repo.repoName.toLowerCase().includes(query) ||
          repo.language.some((lang) => lang.toLowerCase().includes(query)),
      );
    }

    // Status filter
    if (statusFilter) {
      result = result.filter((repo) => repo.status === statusFilter);
    }

    // Sort
    result.sort((a, b) => {
      switch (sortBy) {
        case "name":
          return a.repoName.localeCompare(b.repoName);
        case "createdAt":
          return (
            new Date(b.createdAt || 0).getTime() -
            new Date(a.createdAt || 0).getTime()
          );
        case "lastAnalyzedAt":
          return (
            new Date(b.lastAnalyzedAt || 0).getTime() -
            new Date(a.lastAnalyzedAt || 0).getTime()
          );
        case "status":
          const statusOrder: Record<string, number> = {
            analyzing: 0,
            pending: 1,
            failed: 2,
            completed: 3,
            completed_partial: 4,
            canceled: 5,
            saved: 6,
          };
          return (
            (statusOrder[a.status || "saved"] || 99) -
            (statusOrder[b.status || "saved"] || 99)
          );
        default:
          return 0;
      }
    });

    return result;
  }, [repos, searchQuery, statusFilter, sortBy]);

  const existingPaths = useMemo(
    () => repos.map((r) => r.repoPath).filter(Boolean) as string[],
    [repos],
  );

  const isLoading = useRepoStore((s) => s.loading);

  // Stats
  const stats = useMemo(() => {
    const total = repos.length;
    const analyzing = repos.filter((r) => r.status === "analyzing").length;
    const completed = repos.filter(
      (r) => r.status === "completed" || r.status === "completed_partial",
    ).length;
    const failed = repos.filter((r) => r.status === "failed").length;
    return { total, analyzing, completed, failed };
  }, [repos]);

  // Dropdown menus
  const sortMenuItems: MenuProps["items"] = [
    {
      key: "lastAnalyzedAt",
      label: "最近分析",
      onClick: () => setSortBy("lastAnalyzedAt"),
    },
    {
      key: "name",
      label: "名称",
      onClick: () => setSortBy("name"),
    },
    {
      key: "createdAt",
      label: "创建时间",
      onClick: () => setSortBy("createdAt"),
    },
    {
      key: "status",
      label: "状态",
      onClick: () => setSortBy("status"),
    },
  ];

  const filterMenuItems: MenuProps["items"] = [
    {
      key: "all",
      label: "全部",
      onClick: () => setStatusFilter(null),
    },
    { type: "divider" },
    {
      key: "analyzing",
      label: "分析中",
      onClick: () => setStatusFilter("analyzing"),
    },
    {
      key: "completed",
      label: "已完成",
      onClick: () => setStatusFilter("completed"),
    },
    {
      key: "failed",
      label: "失败",
      onClick: () => setStatusFilter("failed"),
    },
    {
      key: "saved",
      label: "未分析",
      onClick: () => setStatusFilter("saved"),
    },
  ];

  return (
    <div style={{ minHeight: "100%" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          marginBottom: 28,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              color: "var(--t-muted)",
              letterSpacing: "0.12em",
              marginBottom: 8,
              textTransform: "uppercase",
            }}
          >
            系统 / 仓库
          </div>
          <h1
            style={{
              margin: 0,
              fontSize: 32,
              fontWeight: 700,
              color: "var(--t-primary)",
              fontFamily: "var(--font-ui)",
              letterSpacing: "-0.02em",
            }}
          >
            仓库管理
          </h1>
        </div>

        <Space size={12}>
          <Button
            icon={<ReloadOutlined />}
            onClick={refreshLocalRepos}
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: 13,
              height: 36,
              borderRadius: 6,
            }}
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
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: 13,
              height: 36,
              borderRadius: 6,
              boxShadow: "0 0 20px rgba(0,212,255,0.25)",
            }}
          >
            添加仓库
          </Button>
        </Space>
      </div>

      {/* Stats Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 16,
          marginBottom: 28,
        }}
      >
        <StatCard
          label="全部仓库"
          value={stats.total}
          color="var(--t-cyan)"
        />
        <StatCard
          label="分析中"
          value={stats.analyzing}
          color="var(--t-cyan)"
          highlight={stats.analyzing > 0}
        />
        <StatCard
          label="已完成"
          value={stats.completed}
          color="var(--t-green)"
        />
        <StatCard
          label="失败"
          value={stats.failed}
          color="var(--t-red)"
        />
      </div>

      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        {/* Search */}
        <Input
          placeholder="搜索仓库名称或语言..."
          prefix={<SearchOutlined style={{ color: "var(--t-muted)" }} />}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            maxWidth: 320,
            flex: 1,
            height: 36,
            borderRadius: 6,
            fontFamily: "var(--font-ui)",
          }}
          allowClear
        />

        {/* View controls */}
        <Space size={8}>
          <Dropdown menu={{ items: filterMenuItems }} trigger={["click"]}>
            <Button
              icon={<FilterOutlined />}
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: 12,
                height: 36,
                borderRadius: 6,
              }}
            >
              {statusFilter
                ? (() => {
                    const labels: Record<string, string> = {
                      analyzing: "分析中",
                      completed: "已完成",
                      failed: "失败",
                      saved: "未分析",
                    };
                    return labels[statusFilter] || "筛选";
                  })()
                : "筛选"}
            </Button>
          </Dropdown>

          <Dropdown menu={{ items: sortMenuItems }} trigger={["click"]}>
            <Button
              icon={<SortAscendingOutlined />}
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: 12,
                height: 36,
                borderRadius: 6,
              }}
            >
              {(() => {
                const labels: Record<SortBy, string> = {
                  name: "名称",
                  createdAt: "创建时间",
                  lastAnalyzedAt: "最近分析",
                  status: "状态",
                };
                return labels[sortBy];
              })()}
            </Button>
          </Dropdown>

          <div
            style={{
              display: "flex",
              background: "var(--s-float)",
              borderRadius: 6,
              padding: 2,
              border: "1px solid var(--b-faint)",
            }}
          >
            <Button
              type={viewMode === "grid" ? "primary" : "text"}
              icon={<AppstoreOutlined />}
              onClick={() => setViewMode("grid")}
              style={{
                height: 32,
                width: 36,
                borderRadius: 4,
                padding: 0,
              }}
            />
            <Button
              type={viewMode === "list" ? "primary" : "text"}
              icon={<UnorderedListOutlined />}
              onClick={() => setViewMode("list")}
              style={{
                height: 32,
                width: 36,
                borderRadius: 4,
                padding: 0,
              }}
            />
          </div>
        </Space>
      </div>

      {/* Content */}
      {isLoading && <SkeletonList count={4} />}

      {!isLoading && repos.length === 0 && (
        <div
          style={{
            background: "var(--s-raised)",
            border: "1px solid var(--b-faint)",
            borderRadius: "var(--radius-m)",
            padding: "48px 24px",
          }}
        >
          <EmptyRepository onAdd={() => setModalOpen(true)} />
        </div>
      )}

      {!isLoading && repos.length > 0 && filteredRepos.length === 0 && (
        <div
          style={{
            background: "var(--s-raised)",
            border: "1px solid var(--b-faint)",
            borderRadius: "var(--radius-m)",
            padding: "48px 24px",
          }}
        >
          <Empty
            description={
              <span style={{ color: "var(--t-muted)" }}>
                未找到匹配的仓库
              </span>
            }
          />
        </div>
      )}

      {!isLoading && filteredRepos.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              viewMode === "grid"
                ? "repeat(auto-fill, minmax(340px, 1fr))"
                : "1fr",
            gap: 16,
          }}
        >
          {filteredRepos.map((repo) => (
            <RepoCard
              key={repo.repoId}
              repo={repo}
              isActive={detailRepoId === repo.repoId}
              onSelect={() => setDetailRepoId(repo.repoId)}
              onAnalyze={() => {
                setAnalysisConfirmRepo(repo);
              }}
              onCancel={handleCancel}
              onViewGraph={handleViewGraph}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {/* Add/Edit Modal */}
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

      {/* Detail Drawer */}
      <RepoDetailDrawer
        repo={detailRepo}
        onClose={() => setDetailRepoId(null)}
        onViewGraph={handleViewGraph}
      />

      {/* Analysis Confirm Dialog */}
      <AnalysisConfirmDialog
        repo={analysisConfirmRepo}
        onStart={startAnalysis}
        onClose={() => setAnalysisConfirmRepo(null)}
      />
    </div>
  );
};

// Stat Card Component
const StatCard: React.FC<{
  label: string;
  value: number;
  color: string;
  highlight?: boolean;
}> = ({ label, value, color, highlight }) => (
  <div
    style={{
      background: highlight
        ? `linear-gradient(135deg, ${color}15 0%, ${color}08 100%)`
        : "var(--s-raised)",
      border: highlight ? `1px solid ${color}30` : "1px solid var(--b-faint)",
      borderRadius: "var(--radius-m)",
      padding: "16px 20px",
      position: "relative",
      overflow: "hidden",
      transition: "all 0.2s var(--ease-out)",
    }}
  >
    {highlight && (
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          background: color,
        }}
      />
    )}
    <div
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 28,
        fontWeight: 600,
        color: highlight ? color : "var(--t-primary)",
        lineHeight: 1,
        marginBottom: 6,
      }}
    >
      {value}
    </div>
    <div
      style={{
        fontFamily: "var(--font-ui)",
        fontSize: 12,
        color: "var(--t-secondary)",
        letterSpacing: "0.01em",
      }}
    >
      {label}
    </div>
  </div>
);

export default Repository;
