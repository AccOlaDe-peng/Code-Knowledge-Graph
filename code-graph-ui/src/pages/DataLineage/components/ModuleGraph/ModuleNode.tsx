/**
 * ModuleNode - 模块节点组件。
 *
 * 自定义 ReactFlow 节点，显示模块信息：
 * - 模块名称和描述
 * - 使用模块 color 字段设置颜色
 * - 支持选中状态高亮
 */
import React, { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import type { Module } from "../../types/dataLineage";

// ─── 类型定义 ────────────────────────────────────────────────────────────────

interface ModuleNodeData {
  module: Module;
  isSelected: boolean;
}

// ─── 模块图标映射 ────────────────────────────────────────────────────────────

const MODULE_ICONS: Record<string, string> = {
  database: "🗄️",
  file: "📁",
  shield: "🛡️",
  server: "🖥️",
  setting: "⚙️",
  dashboard: "📊",
  default: "📦",
};

// ─── 主组件 ──────────────────────────────────────────────────────────────────

const ModuleNode: React.FC<NodeProps<ModuleNodeData>> = ({ data }) => {
  const { module, isSelected } = data;
  const icon = MODULE_ICONS[module.icon] || MODULE_ICONS.default;

  return (
    <div
      style={{
        background: isSelected
          ? `linear-gradient(135deg, ${module.color}22, ${module.color}11)`
          : "rgba(10, 15, 22, 0.95)",
        border: isSelected
          ? `2px solid ${module.color}`
          : `1px solid ${module.color}44`,
        borderRadius: 8,
        padding: "12px 16px",
        minWidth: 180,
        maxWidth: 220,
        cursor: "pointer",
        boxShadow: isSelected
          ? `0 0 20px ${module.color}33`
          : "0 2px 8px rgba(0,0,0,0.3)",
        transition: "all 0.2s ease",
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: module.color, width: 8, height: 8 }}
      />

      {/* 头部：图标 + 名称 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 6,
        }}
      >
        <span style={{ fontSize: 16 }}>{icon}</span>
        <span
          style={{
            fontFamily: "'Syne', sans-serif",
            fontSize: 13,
            fontWeight: 600,
            color: module.color,
            letterSpacing: "0.02em",
          }}
        >
          {module.name}
        </span>
      </div>

      {/* 描述 */}
      <div
        style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 10,
          color: "#7888a8",
          lineHeight: 1.4,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={module.description}
      >
        {module.description}
      </div>

      {/* 统计 */}
      <div
        style={{
          display: "flex",
          gap: 12,
          marginTop: 8,
          paddingTop: 8,
          borderTop: `1px solid ${module.color}22`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 11, color: module.color }}>
            {module.entities.length}
          </span>
          <span style={{ fontSize: 9, color: "#5a6a8a" }}>实体</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 11, color: module.color }}>
            {module.businessFlows.length}
          </span>
          <span style={{ fontSize: 9, color: "#5a6a8a" }}>流程</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 11, color: module.color }}>
            {module.subFunctions.length}
          </span>
          <span style={{ fontSize: 9, color: "#5a6a8a" }}>功能</span>
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        style={{ background: module.color, width: 8, height: 8 }}
      />
    </div>
  );
};

export default memo(ModuleNode);
