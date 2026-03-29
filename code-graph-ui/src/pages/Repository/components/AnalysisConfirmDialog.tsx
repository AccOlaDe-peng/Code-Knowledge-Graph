import React from "react";
import { Button, Modal, Tag } from "antd";
import {
  ThunderboltOutlined,
  ClockCircleOutlined,
  DashboardOutlined,
  PlayCircleOutlined,
  CodeOutlined,
  BranchesOutlined as GitBranchOutlined,
} from "@ant-design/icons";
import { DEPTH_OPTIONS } from "../constants";
import type { AnalysisDepth, RepoInfo } from "../../../types/api";

interface AnalysisConfirmDialogProps {
  repo: RepoInfo | null;
  depth: AnalysisDepth;
  onDepthChange: (depth: AnalysisDepth) => void;
  onStart: (repo: RepoInfo, depth: AnalysisDepth) => void;
  onClose: () => void;
}

const getDepthConfig = (value: AnalysisDepth) => {
  switch (value) {
    case "quick":
      return {
        icon: <ThunderboltOutlined />,
        color: "#00d4ff",
        time: "~30秒",
        description: "快速扫描，识别基本结构",
      };
    case "standard":
      return {
        icon: <DashboardOutlined />,
        color: "#00f084",
        time: "~2分钟",
        description: "标准分析，包含模块边界",
      };
    case "deep":
      return {
        icon: <ClockCircleOutlined />,
        color: "#ffc145",
        time: "~5分钟",
        description: "深度分析，完整语义增强",
      };
    default:
      return {
        icon: <DashboardOutlined />,
        color: "#00f084",
        time: "~2分钟",
        description: "标准分析，包含模块边界",
      };
  }
};

export const AnalysisConfirmDialog: React.FC<AnalysisConfirmDialogProps> = ({
  repo,
  depth,
  onDepthChange,
  onStart,
  onClose,
}) => {
  const handleStart = () => {
    if (repo) {
      onStart(repo, depth);
      onClose();
    }
  };

  return (
    <Modal
      open={!!repo}
      onCancel={onClose}
      footer={null}
      title={null}
      closable={false}
      width={480}
    >
      {/* Header */}
      <div
        style={{
          padding: "24px 28px 20px",
          borderBottom: "1px solid var(--b-faint)",
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            margin: "0 auto 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "linear-gradient(135deg, rgba(0,212,255,0.15) 0%, rgba(0,212,255,0.05) 100%)",
            borderRadius: "50%",
            border: "1px solid rgba(0,212,255,0.2)",
          }}
        >
          <PlayCircleOutlined
            style={{
              fontSize: 24,
              color: "var(--t-cyan)",
            }}
          />
        </div>
        <h2
          style={{
            margin: 0,
            fontFamily: "var(--font-ui)",
            fontSize: 18,
            fontWeight: 600,
            color: "var(--t-primary)",
            marginBottom: 6,
          }}
        >
          开始分析
        </h2>
        <p
          style={{
            margin: 0,
            fontFamily: "var(--font-ui)",
            fontSize: 13,
            color: "var(--t-muted)",
          }}
        >
          {repo?.repoName}
        </p>
      </div>

      {/* Repo Info */}
      {repo && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            padding: "16px 28px",
            background: "var(--s-float)",
            borderBottom: "1px solid var(--b-faint)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--t-secondary)",
            }}
          >
            <CodeOutlined style={{ fontSize: 11, opacity: 0.7 }} />
            {(repo.language ?? []).slice(0, 2).map((lang) => (
              <Tag
                key={lang}
                style={{
                  margin: 0,
                  fontSize: 10,
                  background: "rgba(176,142,255,0.1)",
                  border: "1px solid rgba(176,142,255,0.2)",
                  color: "var(--t-purple)",
                  padding: "1px 6px",
                  borderRadius: 3,
                }}
              >
                {lang}
              </Tag>
            ))}
          </div>
          {repo.branch && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--t-muted)",
              }}
            >
              <GitBranchOutlined style={{ fontSize: 10 }} />
              {repo.branch}
            </div>
          )}
        </div>
      )}

      {/* Depth Options */}
      <div style={{ padding: "20px 28px" }}>
        <div
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 12,
            fontWeight: 500,
            color: "var(--t-secondary)",
            marginBottom: 12,
          }}
        >
          选择分析深度
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {DEPTH_OPTIONS.map((opt) => {
            const config = getDepthConfig(opt.value);
            const isSelected = depth === opt.value;

            return (
              <button
                key={opt.value}
                onClick={() => onDepthChange(opt.value)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "14px 16px",
                  background: isSelected
                    ? `linear-gradient(135deg, ${config.color}12 0%, ${config.color}06 100%)`
                    : "var(--s-float)",
                  border: isSelected
                    ? `1px solid ${config.color}40`
                    : "1px solid var(--b-faint)",
                  borderRadius: 8,
                  cursor: "pointer",
                  transition: "all 0.15s var(--ease-out)",
                  textAlign: "left",
                  width: "100%",
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: isSelected
                      ? `${config.color}18`
                      : "var(--s-overlay)",
                    borderRadius: 8,
                    color: isSelected ? config.color : "var(--t-muted)",
                  }}
                >
                  {React.cloneElement(config.icon as React.ReactElement<React.SVGProps<SVGSVGElement>>, {
                    style: { fontSize: 18 },
                  })}
                </div>
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 2,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-ui)",
                        fontSize: 14,
                        fontWeight: 500,
                        color: isSelected ? config.color : "var(--t-primary)",
                      }}
                    >
                      {opt.label}
                    </span>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 10,
                        color: "var(--t-muted)",
                        background: "var(--s-overlay)",
                        padding: "2px 6px",
                        borderRadius: 3,
                      }}
                    >
                      {config.time}
                    </span>
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-ui)",
                      fontSize: 12,
                      color: "var(--t-muted)",
                    }}
                  >
                    {opt.description}
                  </div>
                </div>
                <div
                  style={{
                    width: 18,
                    height: 18,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: "50%",
                    border: isSelected
                      ? `5px solid ${config.color}`
                      : "2px solid var(--b-subtle)",
                    transition: "all 0.15s var(--ease-out)",
                  }}
                />
              </button>
            );
          })}
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 12,
          padding: "16px 28px 24px",
          borderTop: "1px solid var(--b-faint)",
        }}
      >
        <Button
          onClick={onClose}
          style={{
            height: 40,
            borderRadius: 6,
            fontFamily: "var(--font-ui)",
            fontSize: 13,
          }}
        >
          取消
        </Button>
        <Button
          type="primary"
          onClick={handleStart}
          style={{
            height: 40,
            borderRadius: 6,
            fontFamily: "var(--font-ui)",
            fontSize: 13,
            minWidth: 120,
            boxShadow: "0 0 20px rgba(0,212,255,0.25)",
          }}
        >
          开始分析
        </Button>
      </div>
    </Modal>
  );
};
