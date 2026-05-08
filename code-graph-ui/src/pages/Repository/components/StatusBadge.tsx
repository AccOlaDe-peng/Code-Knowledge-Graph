import React from "react";
import type { RepoInfo } from "../../../types/api";

interface StatusBadgeProps {
  status?: RepoInfo["status"];
}

const getStatusConfig = (status?: RepoInfo["status"]) => {
  const value = status ?? "saved";
  switch (value) {
    case "running":
	    case "analyzing":
      return {
        label: "分析中",
        color: "#00d4ff",
        bg: "rgba(0,212,255,0.1)",
        border: "rgba(0,212,255,0.3)",
        animate: true,
      };
    case "completed":
      return {
        label: "已完成",
        color: "#00f084",
        bg: "rgba(0,240,132,0.1)",
        border: "rgba(0,240,132,0.3)",
        animate: false,
      };
    case "completed_partial":
      return {
        label: "部分完成",
        color: "#ffc145",
        bg: "rgba(255,193,69,0.1)",
        border: "rgba(255,193,69,0.3)",
        animate: false,
      };
    case "failed":
      return {
        label: "失败",
        color: "#ff4568",
        bg: "rgba(255,69,104,0.1)",
        border: "rgba(255,69,104,0.3)",
        animate: false,
      };
    case "canceled":
      return {
        label: "已取消",
        color: "#ff9955",
        bg: "rgba(255,153,85,0.1)",
        border: "rgba(255,153,85,0.3)",
        animate: false,
      };
    case "pending":
      return {
        label: "等待中",
        color: "#9bb0c8",
        bg: "rgba(155,176,200,0.1)",
        border: "rgba(155,176,200,0.25)",
        animate: false,
      };
    default:
      return {
        label: "未分析",
        color: "#7888a8",
        bg: "rgba(120,136,168,0.08)",
        border: "rgba(120,136,168,0.2)",
        animate: false,
      };
  }
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  const cfg = getStatusConfig(status);

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 12px",
        borderRadius: 4,
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: cfg.color,
          boxShadow: cfg.animate ? `0 0 8px ${cfg.color}` : "none",
          animation: cfg.animate ? "statusPulse 2s ease-in-out infinite" : "none",
        }}
      />
      <span
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: 11,
          fontWeight: 500,
          color: cfg.color,
          letterSpacing: "0.02em",
        }}
      >
        {cfg.label}
      </span>
    </div>
  );
};
