import React, { useEffect, useState } from "react";
import { Alert, Button, Divider, Tooltip } from "antd";
import {
  ClockCircleOutlined,
  BranchesOutlined as GitBranchOutlined,
  NodeIndexOutlined,
  ShareAltOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  CloseCircleOutlined,
  EyeOutlined,
} from "@ant-design/icons";
import { StatusBadge } from "./StatusBadge";
import { AnalysisProgressPanel } from "./AnalysisProgressPanel";
import { repoEndpoints } from "../../../core/api/endpoints/graph";
import type { RepoInfo } from "../../../types/api";

interface RepoDetailDrawerProps {
  repo: RepoInfo | null;
  onClose: () => void;
  onViewGraph: (repo: RepoInfo) => void;
}

const formatTime = (value?: string): string => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatDuration = (started?: string, finished?: string): string => {
  if (!started || !finished) return "-";
  const start = new Date(started).getTime();
  const end = new Date(finished).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return "-";
  const seconds = Math.round((end - start) / 1000);
  if (seconds < 60) return `${seconds}秒`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}分${remainingSeconds}秒`;
};

export const RepoDetailDrawer: React.FC<RepoDetailDrawerProps> = ({
  repo,
  onClose,
  onViewGraph,
}) => {
  const [analyses, setAnalyses] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!repo) return;

    let cancelled = false;
    const fetchAnalyses = async () => {
      try {
        const res = await repoEndpoints.listAnalyses(repo.repoId, repo.taskId);
        if (!cancelled) {
          setAnalyses(res.analyses ?? []);
        }
      } catch {
        if (!cancelled) {
          setAnalyses([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    setLoading(true);
    void fetchAnalyses();

    return () => {
      cancelled = true;
    };
  }, [repo]);

  if (!repo) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        right: repo ? 0 : -420,
        width: 420,
        height: "100vh",
        background: "var(--s-raised)",
        borderLeft: "1px solid var(--b-faint)",
        boxShadow: "-16px 0 48px rgba(0,0,0,0.4)",
        zIndex: 1000,
        transition: "right 0.3s var(--ease-out)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "20px 24px",
          borderBottom: "1px solid var(--b-faint)",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 6,
            }}
          >
            <h2
              style={{
                margin: 0,
                fontFamily: "var(--font-ui)",
                fontSize: 18,
                fontWeight: 600,
                color: "var(--t-primary)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {repo.repoName}
            </h2>
            <StatusBadge status={repo.status} />
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--t-muted)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {repo.repoPath || "无路径"}
          </div>
        </div>
        <Button
          type="text"
          onClick={onClose}
          style={{
            color: "var(--t-muted)",
            padding: "4px 8px",
          }}
        >
          ✕
        </Button>
      </div>

      {/* Content */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 24,
        }}
      >
        {/* Quick Stats */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: 12,
            marginBottom: 24,
          }}
        >
          <StatBox
            icon={<NodeIndexOutlined />}
            label="节点数"
            value={repo.nodeCount ?? "-"}
          />
          <StatBox
            icon={<ShareAltOutlined />}
            label="边数"
            value={repo.edgeCount ?? "-"}
          />
          <StatBox
            icon={<GitBranchOutlined />}
            label="分支"
            value={repo.branch || "默认"}
          />
          <StatBox
            icon={<CalendarOutlined />}
            label="创建时间"
            value={formatTime(repo.createdAt)}
            small
          />
        </div>

        {/* Status Alerts */}
        {repo.status === "analyzing" && <AnalysisProgressPanel repo={repo} />}

        {repo.status === "failed" && repo.error && (
          <Alert
            type="error"
            message="分析失败"
            description={repo.error}
            showIcon
            style={{ marginBottom: 16, borderRadius: 6 }}
          />
        )}

        {repo.status === "canceled" && (
          <Alert
            type="warning"
            message="分析已取消"
            description={repo.analysisMessage || "任务已取消，可重新发起分析"}
            showIcon
            style={{ marginBottom: 16, borderRadius: 6 }}
          />
        )}

        {(repo.status === "completed" ||
          repo.status === "completed_partial") && (
          <Alert
            type="success"
            message={
              repo.status === "completed_partial" ? "部分完成" : "分析完成"
            }
            description={
              repo.graphId
                ? "图谱已生成，可以查看图谱详情"
                : "图谱正在生成中..."
            }
            showIcon
            style={{ marginBottom: 16, borderRadius: 6 }}
          />
        )}

        {/* Analysis History */}
        {analyses.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <Divider
              style={{
                margin: "16px 0",
                borderColor: "var(--b-faint)",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  color: "var(--t-muted)",
                  letterSpacing: "0.1em",
                }}
              >
                分析历史
              </span>
            </Divider>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {analyses.map((a, index) => (
                <AnalysisHistoryItem
                  key={(a.id as string) ?? index}
                  analysis={a}
                  onViewGraph={() => {
                    const graphId = a.graph_id as string;
                    if (graphId) {
                      onViewGraph({ ...repo, graphId });
                      onClose();
                    }
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {loading && (
          <div
            style={{
              textAlign: "center",
              padding: 24,
              color: "var(--t-muted)",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
            }}
          >
            加载分析历史...
          </div>
        )}
      </div>

      {/* Footer */}
      {repo.graphId && (
        <div
          style={{
            padding: "16px 24px",
            borderTop: "1px solid var(--b-faint)",
            background: "var(--s-base)",
          }}
        >
          <Button
            type="primary"
            block
            icon={<EyeOutlined />}
            onClick={() => {
              onViewGraph(repo);
              onClose();
            }}
            style={{
              height: 40,
              borderRadius: 6,
              fontFamily: "var(--font-ui)",
              fontSize: 13,
            }}
          >
            查看图谱
          </Button>
        </div>
      )}
    </div>
  );
};

// Stat Box Component
const StatBox: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string | number;
  small?: boolean;
}> = ({ icon, label, value, small }) => (
  <div
    style={{
      background: "var(--s-float)",
      border: "1px solid var(--b-faint)",
      borderRadius: 6,
      padding: "12px 14px",
    }}
  >
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        marginBottom: 4,
        color: "var(--t-muted)",
        fontSize: 10,
        fontFamily: "var(--font-mono)",
      }}
    >
      {React.cloneElement(icon as React.ReactElement<React.SVGProps<SVGSVGElement>>, {
        style: { fontSize: 11 },
      })}
      {label}
    </div>
    <div
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: small ? 12 : 16,
        fontWeight: 600,
        color: "var(--t-primary)",
      }}
    >
      {value}
    </div>
  </div>
);

// Analysis History Item Component
const AnalysisHistoryItem: React.FC<{
  analysis: Record<string, unknown>;
  onViewGraph: () => void;
}> = ({ analysis, onViewGraph }) => {
  const status = analysis.status as RepoInfo["status"];
  const graphId = analysis.graph_id as string;

  const getStatusIcon = () => {
    switch (status) {
      case "completed":
        return <CheckCircleOutlined style={{ color: "var(--t-green)" }} />;
      case "completed_partial":
        return <ExclamationCircleOutlined style={{ color: "var(--t-amber)" }} />;
      case "failed":
        return <CloseCircleOutlined style={{ color: "var(--t-red)" }} />;
      default:
        return <ClockCircleOutlined style={{ color: "var(--t-muted)" }} />;
    }
  };

  return (
    <div
      onClick={graphId ? onViewGraph : undefined}
      style={{
        background: "var(--s-float)",
        border: "1px solid var(--b-faint)",
        borderRadius: 6,
        padding: "12px 14px",
        cursor: graphId ? "pointer" : "default",
        transition: "all 0.15s var(--ease-out)",
      }}
      onMouseEnter={(e) => {
        if (graphId) {
          e.currentTarget.style.borderColor = "var(--b-subtle)";
          e.currentTarget.style.background = "rgba(0,212,255,0.03)";
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--b-faint)";
        e.currentTarget.style.background = "var(--s-float)";
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 6,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          {getStatusIcon()}
          <StatusBadge status={status} />
        </div>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--t-muted)",
          }}
        >
          {(analysis.depth as string) || "标准"}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--t-secondary)",
        }}
      >
        <Tooltip title="分析时间">
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <ClockCircleOutlined style={{ fontSize: 10, opacity: 0.6 }} />
            {formatTime(analysis.started_at as string)}
          </span>
        </Tooltip>
        <span>
          {(analysis.node_count as number) ?? "-"} 节点
        </span>
        <span>
          {formatDuration(
            analysis.started_at as string,
            analysis.finished_at as string,
          )}
        </span>
      </div>
    </div>
  );
};
