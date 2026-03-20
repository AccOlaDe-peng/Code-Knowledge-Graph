import React from "react";
import type { RepoInfo } from "../../../types/api";

interface StatusBadgeProps {
  status?: RepoInfo["status"];
}

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
    case "completed_partial":
      return {
        label: value === "completed_partial" ? "部分完成" : "已完成",
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
    case "pending":
      return {
        label: "等待中",
        color: "#9bb0c8",
        bg: "rgba(155,176,200,0.08)",
        border: "rgba(155,176,200,0.2)",
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

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
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
