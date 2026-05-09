import React from "react";
import {
  PlayCircleOutlined,
  CloseOutlined,
  FileSearchOutlined,
  CodeOutlined,
  RobotOutlined,
  ApartmentOutlined,
  CheckCircleOutlined,
  FileTextOutlined,
} from "@ant-design/icons";
import type { RepoInfo } from "../../../types/api";

interface AnalysisConfirmDialogProps {
  repo: RepoInfo | null;
  onStart: (repo: RepoInfo) => void;
  onClose: () => void;
}

const ANALYSIS_STEPS = [
  { icon: FileSearchOutlined, label: "文件扫描", desc: "扫描并索引仓库中的源文件" },
  { icon: CodeOutlined, label: "静态分析", desc: "基于 AST 的深度静态结构提取" },
  { icon: RobotOutlined, label: "AI 语义增强", desc: "LLM 驱动的模块边界与语义关系识别" },
  { icon: ApartmentOutlined, label: "数据血缘", desc: "追踪数据在函数与模块间的流动路径" },
  { icon: ApartmentOutlined, label: "图谱构建", desc: "合并多源分析结果为统一知识图谱" },
  { icon: FileTextOutlined, label: "报告生成", desc: "生成架构概览与优化建议" },
];

const styles = {
  overlay: {
    position: "fixed" as const,
    inset: 0,
    background: "rgba(0, 0, 0, 0.7)",
    backdropFilter: "blur(8px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    animation: "fadeIn 0.2s ease-out",
  },
  container: {
    width: 420,
    maxWidth: "90vw",
    background: "linear-gradient(180deg, var(--s-raised) 0%, var(--s-float) 100%)",
    borderRadius: 16,
    border: "1px solid var(--b-faint)",
    boxShadow: "0 24px 80px rgba(0, 0, 0, 0.5), 0 0 1px rgba(0, 212, 255, 0.3)",
  },
  header: {
    padding: "28px 28px 20px",
    textAlign: "center" as const,
    position: "relative" as const,
  },
  iconWrap: {
    width: 64,
    height: 64,
    margin: "0 auto 16px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "linear-gradient(135deg, rgba(0,212,255,0.15) 0%, rgba(0,212,255,0.05) 100%)",
    borderRadius: "50%",
    border: "1px solid rgba(0,212,255,0.2)",
  },
  title: {
    margin: 0,
    fontFamily: "var(--font-ui)",
    fontSize: 22,
    fontWeight: 600,
    color: "var(--t-primary)",
    marginBottom: 6,
  },
  subtitle: {
    margin: 0,
    fontFamily: "var(--font-mono)",
    fontSize: 13,
    color: "var(--t-muted)",
  },
  content: {
    padding: "0 28px 24px",
  },
  stepsTitle: {
    fontFamily: "var(--font-ui)",
    fontSize: 12,
    fontWeight: 600,
    color: "var(--t-secondary)",
    marginBottom: 16,
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
  },
  step: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "14px 16px",
    background: "var(--s-float)",
    border: "1px solid var(--b-faint)",
    borderRadius: 10,
    marginBottom: 10,
  },
  stepIcon: {
    width: 40,
    height: 40,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0, 212, 255, 0.1)",
    borderRadius: 8,
    color: "var(--t-cyan)",
  },
  stepContent: {
    flex: 1,
  },
  stepLabel: {
    fontFamily: "var(--font-ui)",
    fontSize: 14,
    fontWeight: 500,
    color: "var(--t-primary)",
    marginBottom: 2,
  },
  stepDesc: {
    fontFamily: "var(--font-ui)",
    fontSize: 12,
    color: "var(--t-muted)",
  },
  checkIcon: {
    color: "var(--t-green)",
    fontSize: 18,
  },
  footer: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 12,
    padding: "16px 28px 24px",
    borderTop: "1px solid var(--b-faint)",
  },
  buttonCancel: {
    height: 44,
    minWidth: 100,
    borderRadius: 8,
    fontFamily: "var(--font-ui)",
    fontSize: 14,
    fontWeight: 500,
    border: "1px solid var(--b-subtle)",
    background: "transparent",
    color: "var(--t-secondary)",
    cursor: "pointer",
  },
  buttonStart: {
    height: 44,
    minWidth: 140,
    borderRadius: 8,
    fontFamily: "var(--font-ui)",
    fontSize: 14,
    fontWeight: 600,
    border: "none",
    background: "linear-gradient(135deg, #00d4ff 0%, #00a8cc 100%)",
    color: "#000",
    cursor: "pointer",
    boxShadow: "0 4px 20px rgba(0, 212, 255, 0.4)",
  },
  closeButton: {
    position: "absolute" as const,
    top: 16,
    right: 16,
    width: 32,
    height: 32,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    border: "1px solid var(--b-faint)",
    background: "transparent",
    color: "var(--t-muted)",
    cursor: "pointer",
  },
};

export const AnalysisConfirmDialog: React.FC<AnalysisConfirmDialogProps> = ({
  repo,
  onStart,
  onClose,
}) => {
  if (!repo) return null;

  const handleStart = () => {
    onStart(repo);
    onClose();
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.container} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={styles.header}>
          <button style={styles.closeButton} onClick={onClose}>
            <CloseOutlined style={{ fontSize: 14 }} />
          </button>

          <div style={styles.iconWrap}>
            <PlayCircleOutlined style={{ fontSize: 28, color: "var(--t-cyan)" }} />
          </div>

          <h2 style={styles.title}>启动分析</h2>
          <p style={styles.subtitle}>{repo.repoName}</p>
        </div>

        {/* Analysis Steps */}
        <div style={styles.content}>
          <div style={styles.stepsTitle}>分析步骤</div>

          {ANALYSIS_STEPS.map((step, index) => {
            const Icon = step.icon;
            return (
              <div key={index} style={styles.step}>
                <div style={styles.stepIcon}>
                  <Icon style={{ fontSize: 18 }} />
                </div>
                <div style={styles.stepContent}>
                  <div style={styles.stepLabel}>{step.label}</div>
                  <div style={styles.stepDesc}>{step.desc}</div>
                </div>
                <CheckCircleOutlined style={styles.checkIcon} />
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={styles.footer}>
          <button style={styles.buttonCancel} onClick={onClose}>
            取消
          </button>
          <button style={styles.buttonStart} onClick={handleStart}>
            开始分析
          </button>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
  );
};
