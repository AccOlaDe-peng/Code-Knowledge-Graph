import React, { useEffect, useState } from "react";
import { Alert, Descriptions, Modal } from "antd";
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
    <Modal
      open={!!repo}
      onCancel={onClose}
      footer={null}
      width={760}
      title={`仓库详情: ${repo.repoName}`}
    >
      <Descriptions
        bordered
        size="small"
        column={2}
        style={{ marginBottom: 16 }}
      >
        <Descriptions.Item label="状态">
          <StatusBadge status={repo.status} />
        </Descriptions.Item>
        <Descriptions.Item label="仓库名称">
          {repo.repoName}
        </Descriptions.Item>
        <Descriptions.Item label="仓库路径" span={2}>
          {repo.repoPath || "-"}
        </Descriptions.Item>
        <Descriptions.Item label="来源">
          {repo.sourceMode || "-"}
        </Descriptions.Item>
        <Descriptions.Item label="分支">
          {repo.branch || "-"}
        </Descriptions.Item>
        <Descriptions.Item label="图谱 ID" span={2}>
          {repo.graphId || "未生成"}
        </Descriptions.Item>
        <Descriptions.Item label="节点数">
          {repo.nodeCount}
        </Descriptions.Item>
        <Descriptions.Item label="边数">
          {repo.edgeCount}
        </Descriptions.Item>
        <Descriptions.Item label="创建时间">
          {formatTime(repo.createdAt)}
        </Descriptions.Item>
        <Descriptions.Item label="最近分析">
          {formatTime(repo.lastAnalyzedAt)}
        </Descriptions.Item>
      </Descriptions>

      {repo.status === "analyzing" && <AnalysisProgressPanel repo={repo} />}

      {repo.status === "failed" && repo.error && (
        <Alert
          type="error"
          message="分析失败"
          description={repo.error}
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}

      {repo.status === "canceled" && (
        <Alert
          type="warning"
          message="分析已取消"
          description={
            repo.analysisMessage || "任务已取消，可重新发起分析"
          }
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}

      {/* 分析历史 */}
      {analyses.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div
            style={{
              fontFamily: "'IBM Plex Mono'",
              fontSize: 10,
              color: "var(--t-muted)",
              letterSpacing: "0.1em",
              marginBottom: 8,
            }}
          >
            分析历史
          </div>
          <div
            style={{
              maxHeight: 200,
              overflowY: "auto",
              border: "1px solid var(--b-faint)",
              borderRadius: 4,
            }}
          >
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontFamily: "'IBM Plex Mono'",
                fontSize: 11,
              }}
            >
              <thead>
                <tr style={{ background: "var(--s-float)" }}>
                  <th style={{ padding: "8px 12px", textAlign: "left" }}>时间</th>
                  <th style={{ padding: "8px 12px", textAlign: "left" }}>深度</th>
                  <th style={{ padding: "8px 12px", textAlign: "left" }}>节点数</th>
                  <th style={{ padding: "8px 12px", textAlign: "left" }}>耗时</th>
                  <th style={{ padding: "8px 12px", textAlign: "left" }}>状态</th>
                </tr>
              </thead>
              <tbody>
                {analyses.map((a, index) => (
                  <tr
                    key={(a.id as string) ?? index}
                    style={{ borderTop: "1px solid var(--b-faint)" }}
                    onClick={() => {
                      const graphId = a.graph_id as string;
                      if (graphId) {
                        onViewGraph({ ...repo, graphId });
                        onClose();
                      }
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "rgba(0,212,255,0.03)";
                      e.currentTarget.style.cursor = "pointer";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <td style={{ padding: "8px 12px" }}>
                      {formatTime(a.started_at as string)}
                    </td>
                    <td style={{ padding: "8px 12px" }}>
                      {(a.depth as string) || "-"}
                    </td>
                    <td style={{ padding: "8px 12px" }}>
                      {(a.node_count as number) ?? "-"}
                    </td>
                    <td style={{ padding: "8px 12px" }}>
                      {formatDuration(
                        a.started_at as string,
                        a.finished_at as string,
                      )}
                    </td>
                    <td style={{ padding: "8px 12px" }}>
                      <StatusBadge status={a.status as RepoInfo["status"]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {loading && (
        <div
          style={{
            textAlign: "center",
            padding: 20,
            color: "var(--t-muted)",
            fontFamily: "'IBM Plex Mono'",
            fontSize: 11,
          }}
        >
          加载分析历史...
        </div>
      )}
    </Modal>
  );
};
