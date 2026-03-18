import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Button,
  Descriptions,
  Form,
  Input,
  Modal,
  Popconfirm,
  Progress,
  Radio,
  Select,
  Space,
  Tag,
  Timeline,
  message,
} from "antd";
import {
  DeleteOutlined,
  EyeOutlined,
  FolderOutlined,
  GithubOutlined,
  InfoCircleOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { graphEndpoints } from "../../core/api/endpoints/graph";
import { useAnalysisStream } from "../../core/hooks/useAnalysisStream";
import { repoApi } from "../../api/repoApi";
import { useRepoStore } from "../../store/repoStore";
import { useGraphStore } from "../../store/graphStore";
import type { AnalysisDepth, RepoInfo } from "../../types/api";

type SourceMode = "local" | "git";

type RepoFormValues = {
  repoPath?: string;
  gitUrl?: string;
  repoName?: string;
  branch?: string;
  languages?: string[];
};

const LANGS = [
  "python",
  "typescript",
  "javascript",
  "java",
  "go",
  "rust",
  "cpp",
  "csharp",
];

/** 分析深度选项 */
const DEPTH_OPTIONS: {
  value: AnalysisDepth;
  label: string;
  description: string;
}[] = [
  {
    value: "quick",
    label: "快速分析",
    description: "仅扫描核心文件，快速识别模块边界",
  },
  {
    value: "standard",
    label: "标准分析",
    description: "完整扫描，AI 深度分析代码结构",
  },
  {
    value: "deep",
    label: "深度分析",
    description: "全量分析，包含数据血缘与跨模块依赖",
  },
];

const REPO_LIST_CACHE_WINDOW_MS = 1200;
let repoListInFlight: Promise<RepoInfo[]> | null = null;
let repoListCache: { at: number; repos: RepoInfo[] } | null = null;

/**
 * AI 分析流水线阶段定义（与后端 AIPipeline 同步）
 */
const PIPELINE_STAGES = [
  { key: "scanner", label: "扫描文件", desc: "扫描代码仓库文件" },
  { key: "module_scanner", label: "模块识别", desc: "AI 识别模块边界" },
  { key: "code_analyzer", label: "代码分析", desc: "AI 深度分析代码结构" },
  { key: "graph_builder", label: "构建图谱", desc: "合并节点与边" },
  { key: "repository", label: "持久化存储", desc: "保存图谱到存储" },
  { key: "rag", label: "向量化索引", desc: "构建向量索引（可选）" },
];

const getStatusConfig = (status?: RepoInfo["status"]) => {
  const value = status ?? "saved";
  switch (value) {
    case "analyzing":
      return {
        label: "分析中",
        color: "#00d4ff",
        bg: "rgba(0,212,255,0.08)",
        border: "rgba(0,212,255,0.2)",
      };
    case "completed":
      return {
        label: "已完成",
        color: "#00f084",
        bg: "rgba(0,240,132,0.08)",
        border: "rgba(0,240,132,0.2)",
      };
    case "failed":
      return {
        label: "失败",
        color: "#ff6b6b",
        bg: "rgba(255,107,107,0.08)",
        border: "rgba(255,107,107,0.2)",
      };
    case "canceled":
      return {
        label: "已取消",
        color: "#ffc145",
        bg: "rgba(255,193,69,0.08)",
        border: "rgba(255,193,69,0.2)",
      };
    default:
      return {
        label: "已保存",
        color: "#9bb0c8",
        bg: "rgba(155,176,200,0.08)",
        border: "rgba(155,176,200,0.2)",
      };
  }
};

const StatusBadge: React.FC<{ status?: RepoInfo["status"] }> = ({ status }) => {
  const cfg = getStatusConfig(status);

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px",
        borderRadius: 2,
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
      }}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: cfg.color,
          boxShadow: status === "analyzing" ? `0 0 8px ${cfg.color}` : "none",
        }}
      />
      <span
        style={{
          fontFamily: "'IBM Plex Mono'",
          fontSize: 10,
          color: cfg.color,
          letterSpacing: "0.08em",
        }}
      >
        {cfg.label}
      </span>
    </div>
  );
};

const AnalysisProgressPanel: React.FC<{ repo: RepoInfo }> = ({ repo }) => {
  const total = repo.analysisTotal ?? PIPELINE_STAGES.length;
  const currentStage = repo.analysisStage ?? "";

  // 根据当前阶段 key 找到索引
  const currentStageIndex = PIPELINE_STAGES.findIndex(
    (s) => s.key === currentStage,
  );
  const step = currentStageIndex >= 0 ? currentStageIndex + 1 : 0;
  const percent =
    total > 0 ? Math.min(100, Math.round((step / total) * 100)) : 0;

  // 当前阶段信息
  const currentStageInfo = PIPELINE_STAGES.find((s) => s.key === currentStage);

  return (
    <div>
      <Progress
        percent={percent}
        strokeColor={{ "0%": "#00d4ff", "100%": "#00f084" }}
        trailColor="var(--s-float)"
      />

      <div
        style={{
          marginTop: 10,
          marginBottom: 12,
          padding: "10px 12px",
          background: "rgba(0,212,255,0.06)",
          border: "1px solid rgba(0,212,255,0.2)",
          borderRadius: 4,
          fontFamily: "'IBM Plex Mono'",
        }}
      >
        <div style={{ fontSize: 11, color: "#00d4ff", marginBottom: 4 }}>
          当前进度: {step}/{total}
        </div>
        <div style={{ fontSize: 12, color: "var(--t-secondary)" }}>
          {currentStageInfo
            ? `${currentStageInfo.label}`
            : repo.analysisStage || "等待调度"}
        </div>
        {currentStageInfo && (
          <div style={{ marginTop: 2, fontSize: 10, color: "var(--t-muted)" }}>
            {currentStageInfo.desc}
          </div>
        )}
        {repo.analysisMessage && (
          <div style={{ marginTop: 4, fontSize: 11, color: "var(--t-muted)" }}>
            {repo.analysisMessage}
          </div>
        )}
      </div>

      <div
        style={{
          maxHeight: 280,
          overflowY: "auto",
          padding: "10px 12px",
          background: "var(--s-float)",
          border: "1px solid var(--b-faint)",
          borderRadius: 4,
        }}
      >
        <Timeline
          items={PIPELINE_STAGES.map((stage, index) => {
            const stageIndex = index + 1;
            const isCompleted = stageIndex < step;
            const isCurrent = stageIndex === step;
            const color = isCompleted
              ? "#00f084"
              : isCurrent
                ? "#00d4ff"
                : "#3d4a5d";
            return {
              color,
              children: (
                <div>
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono'",
                      fontSize: 11,
                      color:
                        stageIndex <= step
                          ? "var(--t-secondary)"
                          : "var(--t-muted)",
                    }}
                  >
                    {stageIndex}. {stage.label}
                  </span>
                  {(isCompleted || isCurrent) && (
                    <div
                      style={{
                        fontSize: 10,
                        color: "var(--t-muted)",
                        marginTop: 2,
                      }}
                    >
                      {stage.desc}
                    </div>
                  )}
                </div>
              ),
            };
          })}
        />
      </div>
    </div>
  );
};

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

const formatTime = (value?: string): string => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const normalizeRepoInfo = (repo: RepoInfo): RepoInfo => ({
  ...repo,
  repoId: repo.repoId || repo.graphId,
  graphId: repo.graphId || repo.repoId,
  repoName: repo.repoName || repo.graphId || repo.repoId,
  language: repo.language || [],
  createdAt: repo.createdAt || new Date().toISOString(),
  nodeCount: repo.nodeCount || 0,
  edgeCount: repo.edgeCount || 0,
  status: repo.status || "completed",
  lastAnalyzedAt: repo.lastAnalyzedAt || repo.createdAt,
});

const fetchReposWithDedup = async (force = false): Promise<RepoInfo[]> => {
  const now = Date.now();
  if (
    !force &&
    repoListCache &&
    now - repoListCache.at < REPO_LIST_CACHE_WINDOW_MS
  ) {
    return repoListCache.repos;
  }

  if (!force && repoListInFlight) {
    return repoListInFlight;
  }

  repoListInFlight = (async () => {
    const response = await graphEndpoints.listGraphs();
    const repos = response.graphs.map(normalizeRepoInfo);
    repoListCache = { at: Date.now(), repos };
    return repos;
  })();

  try {
    return await repoListInFlight;
  } finally {
    repoListInFlight = null;
  }
};

const Repository: React.FC = () => {
  const navigate = useNavigate();
  const [form] = Form.useForm<RepoFormValues>();

  const repos = useRepoStore((s) => s.repos ?? []);
  const addRepo = useRepoStore((s) => s.addRepo);
  const updateRepo = useRepoStore((s) => s.updateRepo);
  const setRepos = useRepoStore((s) => s.setRepos);
  const { setActiveGraphId } = useGraphStore();
  const setActiveRepo = useRepoStore((s) => s.setActiveRepo);

  const [modalOpen, setModalOpen] = useState(false);
  const [sourceMode, setSourceMode] = useState<SourceMode>("git");
  const [detailRepoId, setDetailRepoId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // 分析确认对话框状态
  const [analysisConfirmRepo, setAnalysisConfirmRepo] = useState<RepoInfo | null>(null);
  const [analysisDepth, setAnalysisDepth] = useState<AnalysisDepth>("standard");

  const detailRepo = useMemo(
    () => repos.find((repo) => repo.repoId === detailRepoId) ?? null,
    [repos, detailRepoId],
  );
  const detailTaskId =
    detailRepo?.status === "analyzing" ? (detailRepo.taskId ?? null) : null;
  const { currentStep, finalResult } = useAnalysisStream(detailTaskId);
  const lastAppliedStreamEventRef = useRef<string>("");

  // 从后端同步仓库列表
  const syncReposFromBackend = useCallback(
    async (options?: { force?: boolean; notify?: boolean }) => {
      try {
        const backendRepos = await fetchReposWithDedup(Boolean(options?.force));
        setRepos(backendRepos);
        if (options?.notify) {
          message.success(`已同步 ${backendRepos.length} 个仓库`);
        }
      } catch (error) {
        message.error(
          "同步失败: " + (error instanceof Error ? error.message : "未知错误"),
        );
      }
    },
    [setRepos],
  );

  const refreshLocalRepos = useCallback(() => {
    void syncReposFromBackend({ force: true, notify: true });
  }, [syncReposFromBackend]);

  // 页面加载时同步后端状态，修复刷新页面后状态不同步的问题
  useEffect(() => {
    void syncReposFromBackend({ force: true });
  }, [syncReposFromBackend]);

  useEffect(() => {
    // 切换任务后清空去重标记，允许新任务事件正常落库。
    lastAppliedStreamEventRef.current = "";
  }, [detailTaskId]);

  useEffect(() => {
    if (!detailRepo || detailRepo.status !== "analyzing") return;

    const event = finalResult ?? currentStep;
    if (!event) return;

    const eventKey = JSON.stringify({
      taskId: detailTaskId,
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

    if (lastAppliedStreamEventRef.current === eventKey) return;
    lastAppliedStreamEventRef.current = eventKey;

    const patch: Partial<RepoInfo> = {
      analysisStep: event.step,
      analysisTotal: event.total,
      analysisStage: event.stage,
      analysisMessage: event.message,
      analysisElapsedSeconds: event.elapsed_seconds,
    };

    if (event.status === "completed") {
      updateRepo(detailRepo.repoId, {
        ...patch,
        status: "completed",
        graphId: event.graph_id || detailRepo.graphId,
        nodeCount: event.node_count ?? detailRepo.nodeCount,
        edgeCount: event.edge_count ?? detailRepo.edgeCount,
        taskId: undefined,
        error: undefined,
        lastAnalyzedAt: new Date().toISOString(),
      });
      message.success(`${detailRepo.repoName} 分析完成`);
      return;
    }

    if (event.status === "failed" || event.status === "error") {
      updateRepo(detailRepo.repoId, {
        ...patch,
        status: "failed",
        taskId: undefined,
        error: event.error || event.message || "分析失败",
        lastAnalyzedAt: new Date().toISOString(),
      });
      message.error(`${detailRepo.repoName} 分析失败`);
      return;
    }

    if (event.status === "canceled") {
      updateRepo(detailRepo.repoId, {
        ...patch,
        status: "canceled",
        taskId: undefined,
        lastAnalyzedAt: new Date().toISOString(),
      });
      message.warning(`${detailRepo.repoName} 已取消分析`);
      return;
    }

    updateRepo(detailRepo.repoId, {
      ...patch,
      status: "analyzing",
    });
  }, [detailRepo, detailTaskId, currentStep, finalResult, updateRepo]);

  const handleSaveRepo = async (values: RepoFormValues) => {
    setSubmitError(null);

    const repoPath = sourceMode === "git" ? values.gitUrl : values.repoPath;
    if (!repoPath) {
      setSubmitError("仓库地址不能为空");
      return;
    }

    // 检查是否已存在相同路径的仓库
    const existing = repos.find((r) => r.repoPath === repoPath);
    if (existing) {
      setSubmitError(`仓库已存在: ${existing.repoName}`);
      return;
    }

    const repoName = inferRepoName(repoPath, values.repoName);
    const repoId = `repo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // 持久化到后端
    try {
      await graphEndpoints.saveRepo({
        repo_id: repoId,
        repo_name: repoName,
        repo_path: repoPath,
        branch: values.branch,
        source_mode: sourceMode,
        language: values.languages ?? [],
      });
    } catch {
      setSubmitError("保存失败，请检查后端服务是否正常");
      return;
    }

    addRepo({
      repoId,
      graphId: "",
      repoName,
      language: values.languages ?? [],
      createdAt: new Date().toISOString(),
      nodeCount: 0,
      edgeCount: 0,
      repoPath,
      branch: values.branch,
      sourceMode,
      status: "saved",
    });

    message.success("仓库已保存，可在列表中发起分析");
    setModalOpen(false);
    form.resetFields();
  };

  const startAnalysis = async (repo: RepoInfo, depth: AnalysisDepth = "standard") => {
    if (!repo.repoPath) {
      message.error("缺少仓库路径，无法分析");
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
        analysisTotal: PIPELINE_STAGES.length,
        analysisStage: "pending",
        analysisMessage: "等待调度执行",
      });
      message.success(`已开始分析: ${repo.repoName} (${DEPTH_OPTIONS.find(o => o.value === depth)?.label})`);
    } catch (error) {
      const text = error instanceof Error ? error.message : "分析任务提交失败";
      updateRepo(repo.repoId, { status: "failed", error: text });
      message.error(text);
    }
  };

  const handleCancel = async (repo: RepoInfo) => {
    let taskId = repo.taskId;
    if (!taskId && repo.status === "analyzing") {
      const latestRepos = await fetchReposWithDedup(true);
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
  };

  const handleViewGraph = (repo: RepoInfo) => {
    if (!repo.graphId) {
      message.warning("该仓库尚未生成图谱");
      return;
    }

    setActiveRepo(repo);
    setActiveGraphId(repo.graphId);
    navigate(`/architecture?graph_id=${repo.graphId}`);
  };

  const handleDelete = async (repo: RepoInfo) => {
    try {
      await repoApi.deleteRepository(repo.repoId);
      // 删除后重新从后端同步，确保数据一致
      await syncReposFromBackend({ force: true });
      message.success("仓库已删除");
      if (detailRepoId === repo.repoId) {
        setDetailRepoId(null);
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : "删除失败");
    }
  };

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
            onClick={() => setModalOpen(true)}
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

            {repos.map((repo, index) => {
              const isAnalyzing = repo.status === "analyzing";
              const canAnalyze = !!repo.repoPath && !isAnalyzing;
              const canView = !!repo.graphId;

              return (
                <div
                  key={repo.repoId || `repo-${index}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "2fr 1fr 1fr 1.2fr 1.8fr",
                    gap: 16,
                    padding: "16px 20px",
                    borderBottom:
                      index < repos.length - 1
                        ? "1px solid var(--b-faint)"
                        : "none",
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontFamily: "'IBM Plex Mono'",
                        fontSize: 13,
                        color: "var(--t-cyan)",
                        marginBottom: 4,
                      }}
                    >
                      {repo.repoName}
                    </div>
                    <Space size={4} wrap>
                      {(repo.language ?? []).slice(0, 3).map((lang) => (
                        <Tag
                          key={lang}
                          style={{
                            margin: 0,
                            fontSize: 9,
                            fontFamily: "'IBM Plex Mono'",
                            background: "rgba(176,142,255,0.08)",
                            border: "1px solid rgba(176,142,255,0.2)",
                            color: "#b08eff",
                          }}
                        >
                          {lang}
                        </Tag>
                      ))}
                    </Space>
                  </div>

                  <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: 12 }}>
                    {repo.branch || "-"}
                  </div>

                  <div>
                    <StatusBadge status={repo.status} />
                    {isAnalyzing && (
                      <div
                        style={{
                          marginTop: 4,
                          fontFamily: "'IBM Plex Mono'",
                          fontSize: 10,
                          color: "var(--t-muted)",
                        }}
                      >
                        {repo.analysisStep ?? 0}/
                        {repo.analysisTotal ?? PIPELINE_STAGES.length}
                      </div>
                    )}
                  </div>

                  <div
                    style={{
                      fontFamily: "'IBM Plex Mono'",
                      fontSize: 11,
                      color: "var(--t-secondary)",
                    }}
                  >
                    {formatTime(repo.lastAnalyzedAt || repo.createdAt)}
                  </div>

                  <Space wrap size={6}>
                    <Button
                      size="small"
                      icon={<PlayCircleOutlined />}
                      onClick={() => {
                        setAnalysisConfirmRepo(repo);
                        setAnalysisDepth("standard");
                      }}
                      disabled={!canAnalyze}
                      style={{ fontFamily: "'IBM Plex Mono'", fontSize: 10 }}
                    >
                      {repo.status === "completed" ? "重新分析" : "分析"}
                    </Button>

                    {isAnalyzing && (
                      <Button
                        size="small"
                        danger
                        icon={<PauseCircleOutlined />}
                        onClick={() => void handleCancel(repo)}
                        style={{ fontFamily: "'IBM Plex Mono'", fontSize: 10 }}
                      >
                        取消
                      </Button>
                    )}

                    <Button
                      size="small"
                      icon={<InfoCircleOutlined />}
                      onClick={() => setDetailRepoId(repo.repoId)}
                      style={{ fontFamily: "'IBM Plex Mono'", fontSize: 10 }}
                    >
                      详情
                    </Button>

                    <Button
                      size="small"
                      type="primary"
                      icon={<EyeOutlined />}
                      onClick={() => handleViewGraph(repo)}
                      disabled={!canView}
                      style={{ fontFamily: "'IBM Plex Mono'", fontSize: 10 }}
                    >
                      查看
                    </Button>

                    <Popconfirm
                      title="删除仓库"
                      description="确定要删除此仓库吗？"
                      onConfirm={() => void handleDelete(repo)}
                      okText="删除"
                      cancelText="取消"
                      okButtonProps={{ danger: true }}
                    >
                      <Button
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        style={{ fontFamily: "'IBM Plex Mono'", fontSize: 10 }}
                      />
                    </Popconfirm>
                  </Space>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Modal
        open={modalOpen}
        onCancel={() => {
          setModalOpen(false);
          form.resetFields();
          setSubmitError(null);
        }}
        onOk={() => void form.submit()}
        okText="保存仓库"
        cancelText="取消"
        title="添加仓库"
      >
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <Button
            type={sourceMode === "git" ? "primary" : "default"}
            icon={<GithubOutlined />}
            onClick={() => {
              setSourceMode("git");
              form.resetFields();
            }}
          >
            Git 仓库
          </Button>
          <Button
            type={sourceMode === "local" ? "primary" : "default"}
            icon={<FolderOutlined />}
            onClick={() => {
              setSourceMode("local");
              form.resetFields();
            }}
          >
            本地路径
          </Button>
        </div>

        <Form
          form={form}
          layout="vertical"
          onFinish={handleSaveRepo}
          requiredMark={false}
        >
          {sourceMode === "git" && (
            <>
              <Form.Item
                name="gitUrl"
                label="Git 仓库地址"
                rules={[{ required: true, message: "Git URL 不能为空" }]}
              >
                <Input placeholder="git@github.com:org/repo.git 或 https://github.com/org/repo.git" />
              </Form.Item>
              <Form.Item name="branch" label="分支（可选）">
                <Input placeholder="main / master / feature/xxx" />
              </Form.Item>
            </>
          )}

          {sourceMode === "local" && (
            <Form.Item
              name="repoPath"
              label="本地仓库路径"
              rules={[{ required: true, message: "路径不能为空" }]}
            >
              <Input placeholder="C:/path/to/repo" />
            </Form.Item>
          )}

          <Form.Item name="repoName" label="仓库名称（可选）">
            <Input placeholder="默认自动推断" />
          </Form.Item>

          <Form.Item name="languages" label="编程语言（可选）">
            <Select
              mode="multiple"
              placeholder="不选则分析时自动检测"
              options={LANGS.map((lang) => ({ value: lang, label: lang }))}
            />
          </Form.Item>

          {submitError && (
            <Alert
              type="error"
              message="保存失败"
              description={submitError}
              showIcon
            />
          )}
        </Form>
      </Modal>

      <Modal
        open={!!detailRepo}
        onCancel={() => setDetailRepoId(null)}
        footer={null}
        width={760}
        title={detailRepo ? `仓库详情: ${detailRepo.repoName}` : "仓库详情"}
      >
        {detailRepo && (
          <div>
            <Descriptions
              bordered
              size="small"
              column={2}
              style={{ marginBottom: 16 }}
            >
              <Descriptions.Item label="状态">
                <StatusBadge status={detailRepo.status} />
              </Descriptions.Item>
              <Descriptions.Item label="仓库名称">
                {detailRepo.repoName}
              </Descriptions.Item>
              <Descriptions.Item label="仓库路径" span={2}>
                {detailRepo.repoPath || "-"}
              </Descriptions.Item>
              <Descriptions.Item label="来源">
                {detailRepo.sourceMode || "-"}
              </Descriptions.Item>
              <Descriptions.Item label="分支">
                {detailRepo.branch || "-"}
              </Descriptions.Item>
              <Descriptions.Item label="图谱 ID" span={2}>
                {detailRepo.graphId || "未生成"}
              </Descriptions.Item>
              <Descriptions.Item label="节点数">
                {detailRepo.nodeCount}
              </Descriptions.Item>
              <Descriptions.Item label="边数">
                {detailRepo.edgeCount}
              </Descriptions.Item>
              <Descriptions.Item label="创建时间">
                {formatTime(detailRepo.createdAt)}
              </Descriptions.Item>
              <Descriptions.Item label="最近分析">
                {formatTime(detailRepo.lastAnalyzedAt)}
              </Descriptions.Item>
            </Descriptions>

            {detailRepo.status === "analyzing" && (
              <AnalysisProgressPanel repo={detailRepo} />
            )}

            {detailRepo.status === "failed" && detailRepo.error && (
              <Alert
                type="error"
                message="分析失败"
                description={detailRepo.error}
                showIcon
              />
            )}

            {detailRepo.status === "canceled" && (
              <Alert
                type="warning"
                message="分析已取消"
                description={
                  detailRepo.analysisMessage || "任务已取消，可重新发起分析"
                }
                showIcon
              />
            )}
          </div>
        )}
      </Modal>

      {/* 分析确认对话框 */}
      <Modal
        open={!!analysisConfirmRepo}
        onCancel={() => setAnalysisConfirmRepo(null)}
        onOk={() => {
          if (analysisConfirmRepo) {
            void startAnalysis(analysisConfirmRepo, analysisDepth);
            setAnalysisConfirmRepo(null);
          }
        }}
        okText="开始分析"
        cancelText="取消"
        title={`分析仓库: ${analysisConfirmRepo?.repoName ?? ""}`}
        width={520}
      >
        <div style={{ marginBottom: 20 }}>
          <div
            style={{
              fontFamily: "'IBM Plex Mono'",
              fontSize: 11,
              color: "var(--t-muted)",
              marginBottom: 12,
            }}
          >
            选择分析深度：
          </div>
          <Radio.Group
            value={analysisDepth}
            onChange={(e) => setAnalysisDepth(e.target.value)}
            style={{ width: "100%" }}
          >
            <Space direction="vertical" style={{ width: "100%" }} size={12}>
              {DEPTH_OPTIONS.map((opt) => (
                <Radio
                  key={opt.value}
                  value={opt.value}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    padding: "10px 14px",
                    background:
                      analysisDepth === opt.value
                        ? "rgba(0,212,255,0.06)"
                        : "var(--s-float)",
                    border: `1px solid ${
                      analysisDepth === opt.value
                        ? "rgba(0,212,255,0.3)"
                        : "var(--b-faint)"
                    }`,
                    borderRadius: 4,
                    cursor: "pointer",
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontFamily: "'IBM Plex Mono'",
                        fontSize: 12,
                        color: "var(--t-primary)",
                        marginBottom: 2,
                      }}
                    >
                      {opt.label}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--t-muted)",
                      }}
                    >
                      {opt.description}
                    </div>
                  </div>
                </Radio>
              ))}
            </Space>
          </Radio.Group>
        </div>

        {analysisConfirmRepo && (
          <Alert
            type="info"
            showIcon
            message={
              <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 11 }}>
                仓库路径: {analysisConfirmRepo.repoPath}
              </span>
            }
            style={{ marginBottom: 12 }}
          />
        )}
      </Modal>
    </div>
  );
};

export default Repository;
