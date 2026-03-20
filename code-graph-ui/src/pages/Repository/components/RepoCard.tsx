import React from "react";
import { Button, Popconfirm, Space, Tag } from "antd";
import {
  DeleteOutlined,
  EyeOutlined,
  InfoCircleOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
} from "@ant-design/icons";
import { StatusBadge } from "./StatusBadge";
import { usePipelineStore } from "../../../store/pipelineStore";
import type { RepoInfo } from "../../../types/api";

interface RepoCardProps {
  repo: RepoInfo;
  isActive: boolean;
  onSelect: (repo: RepoInfo) => void;
  onAnalyze: (repo: RepoInfo) => void;
  onCancel: (repo: RepoInfo) => void;
  onViewGraph: (repo: RepoInfo) => void;
  onDelete: (repo: RepoInfo) => void;
}

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

export const RepoCard: React.FC<RepoCardProps> = ({
  repo,
  isActive,
  onSelect,
  onAnalyze,
  onCancel,
  onViewGraph,
  onDelete,
}) => {
  const stages = usePipelineStore((s) => s.stages);
  const isAnalyzing = repo.status === "analyzing";
  const canAnalyze = !!repo.repoPath && !isAnalyzing;
  const canView = !!repo.graphId;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "2fr 1fr 1fr 1.2fr 1.8fr",
        gap: 16,
        padding: "16px 20px",
        background: isActive ? "rgba(0,212,255,0.03)" : "transparent",
        borderBottom: "1px solid var(--b-faint)",
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
            {repo.analysisStep ?? 0}/{repo.analysisTotal ?? stages.length}
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
          onClick={() => onAnalyze(repo)}
          disabled={!canAnalyze}
          style={{ fontFamily: "'IBM Plex Mono'", fontSize: 10 }}
        >
          {repo.status === "completed" || repo.status === "completed_partial"
            ? "重新分析"
            : "分析"}
        </Button>

        {isAnalyzing && (
          <Button
            size="small"
            danger
            icon={<PauseCircleOutlined />}
            onClick={() => onCancel(repo)}
            style={{ fontFamily: "'IBM Plex Mono'", fontSize: 10 }}
          >
            取消
          </Button>
        )}

        <Button
          size="small"
          icon={<InfoCircleOutlined />}
          onClick={() => onSelect(repo)}
          style={{ fontFamily: "'IBM Plex Mono'", fontSize: 10 }}
        >
          详情
        </Button>

        <Button
          size="small"
          type="primary"
          icon={<EyeOutlined />}
          onClick={() => onViewGraph(repo)}
          disabled={!canView}
          style={{ fontFamily: "'IBM Plex Mono'", fontSize: 10 }}
        >
          查看
        </Button>

        <Popconfirm
          title="删除仓库"
          description="确定要删除此仓库吗？"
          onConfirm={() => onDelete(repo)}
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
};
