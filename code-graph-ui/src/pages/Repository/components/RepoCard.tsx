import React from "react";
import { Button, Popconfirm, Tag, Progress, Tooltip } from "antd";
import {
  PlayCircleOutlined,
  EyeOutlined,
  InfoCircleOutlined,
  PauseCircleOutlined,
  DeleteOutlined,
  ClockCircleOutlined,
  BranchesOutlined,
  CodeOutlined,
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
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) {
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours === 0) {
      const minutes = Math.floor(diff / (1000 * 60));
      return minutes <= 1 ? "刚刚" : `${minutes} 分钟前`;
    }
    return `${hours} 小时前`;
  } else if (days === 1) {
    return "昨天";
  } else if (days < 7) {
    return `${days} 天前`;
  }
  return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
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
  const progress = isAnalyzing && repo.analysisTotal
    ? Math.round(((repo.analysisStep ?? 0) / repo.analysisTotal) * 100)
    : 0;

  return (
    <div
      style={{
        position: "relative",
        background: isActive
          ? "linear-gradient(135deg, rgba(0,212,255,0.06) 0%, rgba(0,212,255,0.02) 100%)"
          : "var(--s-raised)",
        border: isActive
          ? "1px solid rgba(0,212,255,0.25)"
          : "1px solid var(--b-faint)",
        borderRadius: "var(--radius-m)",
        padding: 20,
        transition: "all 0.2s var(--ease-out)",
        cursor: "pointer",
      }}
      onClick={() => onSelect(repo)}
      onMouseEnter={(e) => {
        if (!isActive) {
          e.currentTarget.style.borderColor = "var(--b-subtle)";
          e.currentTarget.style.transform = "translateY(-2px)";
          e.currentTarget.style.boxShadow = "0 8px 24px rgba(0,0,0,0.3)";
        }
      }}
      onMouseLeave={(e) => {
        if (!isActive) {
          e.currentTarget.style.borderColor = "var(--b-faint)";
          e.currentTarget.style.transform = "translateY(0)";
          e.currentTarget.style.boxShadow = "none";
        }
      }}
    >
      {/* Top accent line for analyzing status */}
      {isAnalyzing && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 2,
            background: "linear-gradient(90deg, var(--a-cyan) 0%, transparent 100%)",
            borderRadius: "var(--radius-m) var(--radius-m) 0 0",
          }}
        />
      )}

      {/* Header: Name + Status */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: 16,
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
            <h3
              style={{
                margin: 0,
                fontFamily: "var(--font-ui)",
                fontSize: 16,
                fontWeight: 600,
                color: "var(--t-primary)",
                letterSpacing: "-0.01em",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {repo.repoName}
            </h3>
          </div>

          {/* Language tags */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(repo.language ?? []).slice(0, 3).map((lang) => (
              <Tag
                key={lang}
                style={{
                  margin: 0,
                  fontSize: 10,
                  fontFamily: "var(--font-mono)",
                  background: "rgba(176,142,255,0.1)",
                  border: "1px solid rgba(176,142,255,0.2)",
                  color: "var(--t-purple)",
                  padding: "2px 8px",
                  borderRadius: 3,
                }}
              >
                <CodeOutlined style={{ marginRight: 4, fontSize: 9 }} />
                {lang}
              </Tag>
            ))}
          </div>
        </div>

        <StatusBadge status={repo.status} />
      </div>

      {/* Progress bar for analyzing */}
      {isAnalyzing && (
        <div style={{ marginBottom: 16 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 6,
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--t-muted)",
              }}
            >
              {repo.analysisStage || "处理中..."}
            </span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--t-cyan)",
              }}
            >
              {repo.analysisStep ?? 0}/{repo.analysisTotal ?? stages.length}
            </span>
          </div>
          <Progress
            percent={progress}
            showInfo={false}
            strokeColor="var(--a-cyan)"
            trailColor="var(--s-float)"
            size="small"
          />
        </div>
      )}

      {/* Meta info */}
      <div
        style={{
          display: "flex",
          gap: 20,
          marginBottom: 16,
          color: "var(--t-muted)",
          fontFamily: "var(--font-mono)",
          fontSize: 12,
        }}
      >
        <Tooltip title="分支">
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            <BranchesOutlined style={{ fontSize: 11, opacity: 0.7 }} />
            {repo.branch || "默认"}
          </span>
        </Tooltip>
        <Tooltip title="最近分析">
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            <ClockCircleOutlined style={{ fontSize: 11, opacity: 0.7 }} />
            {formatTime(repo.lastAnalyzedAt || repo.createdAt)}
          </span>
        </Tooltip>
      </div>

      {/* Actions */}
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <Button
          size="small"
          type={canView ? "default" : "primary"}
          icon={<PlayCircleOutlined />}
          onClick={() => onAnalyze(repo)}
          disabled={!canAnalyze}
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 12,
            height: 32,
            borderRadius: 4,
          }}
        >
          {repo.status === "completed" || repo.status === "completed_partial"
            ? "重新分析"
            : "开始分析"}
        </Button>

        {isAnalyzing && (
          <Button
            size="small"
            danger
            icon={<PauseCircleOutlined />}
            onClick={() => onCancel(repo)}
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: 12,
              height: 32,
              borderRadius: 4,
            }}
          >
            取消
          </Button>
        )}

        <Button
          size="small"
          icon={<EyeOutlined />}
          onClick={() => onViewGraph(repo)}
          disabled={!canView}
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 12,
            height: 32,
            borderRadius: 4,
          }}
        >
          查看图谱
        </Button>

        <Button
          size="small"
          icon={<InfoCircleOutlined />}
          onClick={() => onSelect(repo)}
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 12,
            height: 32,
            borderRadius: 4,
          }}
        >
          详情
        </Button>

        <Popconfirm
          title="删除仓库"
          description="确定要删除此仓库吗？相关的图谱数据也将被删除。"
          onConfirm={() => onDelete(repo)}
          okText="删除"
          cancelText="取消"
          okButtonProps={{ danger: true }}
        >
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: 12,
              height: 32,
              borderRadius: 4,
            }}
          />
        </Popconfirm>
      </div>

      {/* Glow effect on hover */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          borderRadius: "var(--radius-m)",
          pointerEvents: "none",
          transition: "box-shadow 0.2s var(--ease-out)",
        }}
      />
    </div>
  );
};
