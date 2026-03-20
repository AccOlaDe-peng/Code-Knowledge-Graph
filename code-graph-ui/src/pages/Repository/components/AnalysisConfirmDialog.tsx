import React from "react";
import { Alert, Modal, Radio, Space } from "antd";
import { DEPTH_OPTIONS } from "../constants";
import type { AnalysisDepth, RepoInfo } from "../../../types/api";

interface AnalysisConfirmDialogProps {
  repo: RepoInfo | null;
  depth: AnalysisDepth;
  onDepthChange: (depth: AnalysisDepth) => void;
  onStart: (repo: RepoInfo, depth: AnalysisDepth) => void;
  onClose: () => void;
}

export const AnalysisConfirmDialog: React.FC<AnalysisConfirmDialogProps> = ({
  repo,
  depth,
  onDepthChange,
  onStart,
  onClose,
}) => {
  const handleOk = () => {
    if (repo) {
      onStart(repo, depth);
      onClose();
    }
  };

  return (
    <Modal
      open={!!repo}
      onCancel={onClose}
      onOk={handleOk}
      okText="开始分析"
      cancelText="取消"
      title={`分析仓库: ${repo?.repoName ?? ""}`}
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
          value={depth}
          onChange={(e) => onDepthChange(e.target.value)}
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
                    depth === opt.value
                      ? "rgba(0,212,255,0.06)"
                      : "var(--s-float)",
                  border: `1px solid ${
                    depth === opt.value
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

      {repo && (
        <Alert
          type="info"
          showIcon
          message={
            <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 11 }}>
              仓库路径: {repo.repoPath}
            </span>
          }
          style={{ marginBottom: 12 }}
        />
      )}
    </Modal>
  );
};
