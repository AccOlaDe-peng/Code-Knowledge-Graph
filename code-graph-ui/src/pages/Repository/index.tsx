import React, { useCallback, useEffect, useMemo, useState } from "react";
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
import { repoApi } from "../../api/repoApi";
import { useRepoStore } from "../../store/repoStore";
import { useGraphStore } from "../../store/graphStore";
import type { RepoInfo } from "../../types/api";

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

const PIPELINE_STAGES = [
  "扫描仓库",
  "解析代码 AST",
  "模块检测",
  "组件检测",
  "依赖分析",
  "构建调用图",
  "事件分析",
  "基础设施分析",
  "生成仓库摘要",
  "AI 深度分析",
  "图谱构建",
  "图谱持久化",
  "向量化索引",
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
  const step = repo.analysisStep ?? 0;
  const percent =
    total > 0 ? Math.min(100, Math.round((step / total) * 100)) : 0;

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
          {repo.analysisStage || "等待调度"}
        </div>
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
          items={PIPELINE_STAGES.map((name, index) => {
            const stageIndex = index + 1;
            const color =
              stageIndex < step
                ? "#00f084"
                : stageIndex === step
                  ? "#00d4ff"
                  : "#3d4a5d";
            return {
              color,
              children: (
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
                  {stageIndex}. {name}
                </span>
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

const Repository: React.FC = () => {
  const navigate = useNavigate();
  const [form] = Form.useForm<RepoFormValues>();

  const repos = useRepoStore((s) => s.repos ?? []);
  const loading = useRepoStore((s) => s.loading);
  const setRepos = useRepoStore((s) => s.setRepos);
  const setLoading = useRepoStore((s) => s.setLoading);
  const setError = useRepoStore((s) => s.setError);
  const addRepo = useRepoStore((s) => s.addRepo);
  const updateRepo = useRepoStore((s) => s.updateRepo);
  const removeRepo = useRepoStore((s) => s.removeRepo);
  const { setActiveGraphId } = useGraphStore();

  const [modalOpen, setModalOpen] = useState(false);
  const [sourceMode, setSourceMode] = useState<SourceMode>("git");
  const [detailRepoId, setDetailRepoId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const detailRepo = useMemo(
    () => repos.find((repo) => repo.repoId === detailRepoId) ?? null,
    [repos, detailRepoId],
  );

  const refreshRemoteRepos = useCallback(async () => {
    setLoading(true);
    try {
      const data = await graphEndpoints.listGraphs();
      setRepos(data.graphs ?? []);
    } catch (error) {
      const text = error instanceof Error ? error.message : "获取仓库列表失败";
      setError(text);
      message.error(text);
    } finally {
      setLoading(false);
    }
  }, [setLoading, setRepos, setError]);

  useEffect(() => {
    void refreshRemoteRepos();
  }, [refreshRemoteRepos]);

  useEffect(() => {
    const analyzingRepos = repos.filter(
      (repo) => repo.status === "analyzing" && !!repo.taskId,
    );
    if (analyzingRepos.length === 0) return;

    const timer = window.setInterval(async () => {
      const statusList = await Promise.all(
        analyzingRepos.map(async (repo) => {
          try {
            const status = await graphEndpoints.getAnalysisStatus(repo.taskId!);
            return { repo, status };
          } catch {
            return null;
          }
        }),
      );

      let hasCompleted = false;

      for (const item of statusList) {
        if (!item) continue;

        const { repo, status } = item;
        const patch: Partial<RepoInfo> = {
          analysisStep: status.step,
          analysisTotal: status.total,
          analysisStage: status.stage,
          analysisMessage: status.message,
          analysisElapsedSeconds: status.elapsed_seconds,
        };

        if (status.status === "completed") {
          hasCompleted = true;
          updateRepo(repo.repoId, {
            ...patch,
            status: "completed",
            graphId: status.graph_id || repo.graphId,
            nodeCount: status.node_count ?? repo.nodeCount,
            edgeCount: status.edge_count ?? repo.edgeCount,
            taskId: undefined,
            error: undefined,
            lastAnalyzedAt: new Date().toISOString(),
          });
          message.success(`${repo.repoName} 分析完成`);
          continue;
        }

        if (status.status === "failed") {
          updateRepo(repo.repoId, {
            ...patch,
            status: "failed",
            taskId: undefined,
            error: status.error || status.message || "分析失败",
            lastAnalyzedAt: new Date().toISOString(),
          });
          message.error(`${repo.repoName} 分析失败`);
          continue;
        }

        if (status.status === "canceled") {
          updateRepo(repo.repoId, {
            ...patch,
            status: "canceled",
            taskId: undefined,
            lastAnalyzedAt: new Date().toISOString(),
          });
          message.warning(`${repo.repoName} 已取消分析`);
          continue;
        }

        updateRepo(repo.repoId, {
          ...patch,
          status: "analyzing",
        });
      }

      if (hasCompleted) {
        void refreshRemoteRepos();
      }
    }, 3000);

    return () => {
      window.clearInterval(timer);
    };
  }, [repos, updateRepo, refreshRemoteRepos]);

  const handleSaveRepo = async (values: RepoFormValues) => {
    setSubmitError(null);

    const repoPath = sourceMode === "git" ? values.gitUrl : values.repoPath;
    if (!repoPath) {
      setSubmitError("仓库地址不能为空");
      return;
    }

    const repoName = inferRepoName(repoPath, values.repoName);
    const repoId = `repo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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

  const startAnalysis = async (repo: RepoInfo) => {
    if (!repo.repoPath) {
      message.error("缺少仓库路径，无法分析");
      return;
    }

    try {
      const response = await graphEndpoints.analyzeRepository({
        repo_path: repo.repoPath,
        repo_name: repo.repoName,
        languages: repo.language.length > 0 ? repo.language : undefined,
      });

      updateRepo(repo.repoId, {
        status: "analyzing",
        taskId: response.task_id,
        error: undefined,
        analysisStep: 0,
        analysisTotal: PIPELINE_STAGES.length,
        analysisStage: "任务已创建",
        analysisMessage: "等待调度执行",
      });
      message.success(`已开始分析: ${repo.repoName}`);
    } catch (error) {
      const text = error instanceof Error ? error.message : "分析任务提交失败";
      updateRepo(repo.repoId, { status: "failed", error: text });
      message.error(text);
    }
  };

  const handleCancel = async (repo: RepoInfo) => {
    if (!repo.taskId) {
      message.warning("当前任务不存在或已结束");
      return;
    }

    try {
      await graphEndpoints.cancelAnalysis(repo.taskId);
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

    setActiveGraphId(repo.graphId);
    navigate(`/architecture?graph_id=${repo.graphId}`);
  };

  const handleDelete = async (repo: RepoInfo) => {
    try {
      if (repo.graphId) {
        await repoApi.deleteRepository(repo.graphId);
      }
      removeRepo(repo.repoId);
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
            onClick={() => void refreshRemoteRepos()}
            loading={loading}
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

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="流程已拆分：先保存仓库，再在列表中点击“分析”执行任务；分析中可取消并查看实时进度。"
      />

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
                      onClick={() => void startAnalysis(repo)}
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
    </div>
  );
};

export default Repository;
