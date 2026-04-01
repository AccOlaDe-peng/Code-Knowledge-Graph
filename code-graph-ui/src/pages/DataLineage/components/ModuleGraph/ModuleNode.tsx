/**
 * ModuleNode - 模块节点组件。
 *
 * 自定义 ReactFlow 节点，显示模块信息：
 * - 模块名称和描述
 * - 使用模块 color 字段设置颜色
 * - 支持选中状态高亮
 *
 * v2.0 - 高对比度设计优化：
 * - 背景亮度提升，从 rgba(10,15,22) 到 rgba(18,25,35)
 * - 边框宽度从 1px 提升到 2.5px
 * - 添加发光效果
 * - 文字对比度提升
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
          ? `linear-gradient(135deg, ${module.color}30, ${module.color}15)`
          : "rgba(18, 25, 35, 0.98)",  // 从 rgba(10,15,22) 提升
        border: isSelected
          ? `3px solid ${module.color}`
          : `2.5px solid ${module.color}99`,  // 从 1px 提升到 2.5px
        borderRadius: 10,
        padding: "14px 18px",
        minWidth: 190,
        maxWidth: 240,
        cursor: "pointer",
        boxShadow: isSelected
          ? `0 0 24px ${module.color}40, 0 4px 12px rgba(0,0,0,0.4)`  // 发光 + 阴影
          : `0 2px 10px rgba(0,0,0,0.35), inset 0 1px 0 ${module.color}15`,  // 内发光边框
        transition: "all 0.2s ease",
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{
          background: module.color,
          width: 10,
          height: 10,
          border: `2px solid ${module.color}`,
          boxShadow: `0 0 6px ${module.color}60`,
        }}
      />

      {/* 头部：图标 + 名称 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 8,
        }}
      >
        <span style={{ fontSize: 18 }}>{icon}</span>
        <span
          style={{
            fontFamily: "'Space Grotesk', 'Syne', sans-serif",
            fontSize: 14,
            fontWeight: 700,
            color: module.color,
            letterSpacing: "0.02em",
            textShadow: `0 0 8px ${module.color}50`,  // 文字发光
          }}
        >
          {module.name}
        </span>
      </div>

      {/* 描述 */}
      <div
        style={{
          fontFamily: "'JetBrains Mono', 'IBM Plex Mono', monospace",
          fontSize: 11,
          color: "#9aa8c8",  // 从 #7888a8 提升亮度
          lineHeight: 1.5,
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
          gap: 14,
          marginTop: 10,
          paddingTop: 10,
          borderTop: `1px solid ${module.color}35`,  // 从 22 提升透明度
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{
            fontSize: 12,
            fontWeight: 600,
            color: module.color,
          }}>
            {module.entities.length}
          </span>
          <span style={{ fontSize: 10, color: "#6a7a9a" }}>实体</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{
            fontSize: 12,
            fontWeight: 600,
            color: module.color,
          }}>
            {module.businessFlows.length}
          </span>
          <span style={{ fontSize: 10, color: "#6a7a9a" }}>流程</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{
            fontSize: 12,
            fontWeight: 600,
            color: module.color,
          }}>
            {module.subFunctions.length}
          </span>
          <span style={{ fontSize: 10, color: "#6a7a9a" }}>功能</span>
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        style={{
          background: module.color,
          width: 10,
          height: 10,
          border: `2px solid ${module.color}`,
          boxShadow: `0 0 6px ${module.color}60`,
        }}
      />
    </div>
  );
};

export default memo(ModuleNode);
