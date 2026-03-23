/**
 * ModuleNode - 模块分组节点组件。
 *
 * 用于在血缘图主视图中展示模块级节点，支持：
 * - 显示模块名称和统计信息
 * - 展开/折叠内部 Service 列表
 * - 悬停显示详细信息
 */
import React, { useState, useMemo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import {
  FolderOutlined,
  CodeOutlined,
  ApiOutlined,
  DatabaseOutlined,
  RightOutlined,
  DownOutlined,
} from "@ant-design/icons";
import type { ModuleNode as ModuleNodeType } from "../utils/moduleAggregation";

// ─── 类型定义 ────────────────────────────────────────────────────────────────

interface ModuleNodeData {
  module: ModuleNodeType;
  isHighlighted?: boolean;
  isSelected?: boolean;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

// ─── 样式常量 ────────────────────────────────────────────────────────────────

const COLORS = {
  module: {
    bg: "rgba(176,142,255,0.06)",
    border: "#b08eff33",
    borderHover: "#b08eff66",
    borderSelected: "#b08effaa",
    text: "#b08eff",
    textDim: "#6b5a9a",
  },
  service: { text: "#00f084" },
  controller: { text: "#00d4ff" },
  repository: { text: "#ffc145" },
  database: { text: "#b08eff" },
  crossCall: { text: "#ff6b6b" },
};

// ─── 组件 ────────────────────────────────────────────────────────────────────

const ModuleNode: React.FC<NodeProps<ModuleNodeData>> = ({
  data,
  selected,
}) => {
  const { module, isHighlighted, isExpanded: externalExpanded, onToggleExpand } = data;
  const [internalExpanded, setInternalExpanded] = useState(false);

  const isExpanded = externalExpanded ?? internalExpanded;

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onToggleExpand) {
      onToggleExpand();
    } else {
      setInternalExpanded(!isExpanded);
    }
  };

  // 显示的服务列表（最多 5 个）
  const displayedServices = useMemo(() => {
    return module.services.slice(0, 5);
  }, [module.services]);

  const hasMoreServices = module.services.length > 5;

  return (
    <div
      style={{
        width: 220,
        background: selected
          ? COLORS.module.bg
          : "rgba(10,15,22,0.88)",
        border: `1px solid ${
          selected
            ? COLORS.module.borderSelected
            : isHighlighted
              ? COLORS.module.borderHover
              : COLORS.module.border
        }`,
        borderRadius: 6,
        boxShadow: selected
          ? `0 0 16px ${COLORS.module.border}88, 0 2px 8px rgba(0,0,0,0.5)`
          : "0 1px 4px rgba(0,0,0,0.4)",
        transition: "all 0.18s ease",
        cursor: "pointer",
        overflow: "hidden",
      }}
    >
      {/* 左侧色条 */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          background: COLORS.module.text,
          opacity: selected ? 0.9 : 0.6,
        }}
      />

      {/* 标题栏 */}
      <div
        onClick={handleToggle}
        style={{
          display: "flex",
          alignItems: "center",
          padding: "8px 10px 8px 12px",
          borderBottom: isExpanded ? `1px solid ${COLORS.module.border}` : "none",
          gap: 8,
        }}
      >
        {/* 展开/折叠图标 */}
        {isExpanded ? (
          <DownOutlined style={{ fontSize: 10, color: COLORS.module.textDim }} />
        ) : (
          <RightOutlined style={{ fontSize: 10, color: COLORS.module.textDim }} />
        )}

        {/* 模块图标和名称 */}
        <FolderOutlined style={{ fontSize: 14, color: COLORS.module.text }} />
        <span
          style={{
            fontFamily: "'Syne', sans-serif",
            fontSize: 12,
            fontWeight: 600,
            color: COLORS.module.text,
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {module.name}
        </span>

        {/* Service 数量标记 */}
        <span
          style={{
            fontFamily: "'IBM Plex Mono'",
            fontSize: 10,
            color: COLORS.module.textDim,
            background: "rgba(176,142,255,0.1)",
            padding: "1px 5px",
            borderRadius: 3,
          }}
        >
          {module.serviceCount}
        </span>
      </div>

      {/* 统计信息（始终显示） */}
      <div
        style={{
          display: "flex",
          gap: 8,
          padding: "6px 10px 6px 26px",
          fontSize: 9,
          fontFamily: "'IBM Plex Mono'",
        }}
      >
        {module.controllers.length > 0 && (
          <span style={{ color: COLORS.controller.text }}>
            <ApiOutlined /> {module.controllers.length}
          </span>
        )}
        {module.repositories.length > 0 && (
          <span style={{ color: COLORS.repository.text }}>
            <DatabaseOutlined /> {module.repositories.length}
          </span>
        )}
        {module.crossModuleCalls > 0 && (
          <span style={{ color: COLORS.crossCall.text }}>
            → {module.crossModuleCalls}
          </span>
        )}
      </div>

      {/* 展开的 Service 列表 */}
      {isExpanded && (
        <div
          style={{
            padding: "4px 10px 8px 26px",
            maxHeight: 150,
            overflowY: "auto",
          }}
        >
          {displayedServices.map((svc) => (
            <div
              key={svc.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "2px 0",
              }}
            >
              <CodeOutlined style={{ fontSize: 10, color: COLORS.service.text }} />
              <span
                style={{
                  fontFamily: "'IBM Plex Mono'",
                  fontSize: 10,
                  color: "#8ab4c8",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {svc.name}
              </span>
            </div>
          ))}
          {hasMoreServices && (
            <div
              style={{
                fontFamily: "'IBM Plex Mono'",
                fontSize: 9,
                color: COLORS.module.textDim,
                marginTop: 4,
              }}
            >
              +{module.services.length - 5} more
            </div>
          )}
        </div>
      )}

      {/* Handles */}
      <Handle
        type="target"
        position={Position.Top}
        style={{
          background: COLORS.module.text,
          width: 5,
          height: 5,
          border: "none",
          top: -3,
        }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        style={{
          background: COLORS.module.text,
          width: 5,
          height: 5,
          border: "none",
          bottom: -3,
        }}
      />
      <Handle
        type="target"
        position={Position.Left}
        style={{
          background: COLORS.module.text,
          width: 5,
          height: 5,
          border: "none",
          left: -3,
        }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{
          background: COLORS.module.text,
          width: 5,
          height: 5,
          border: "none",
          right: -3,
        }}
      />
    </div>
  );
};

export default ModuleNode;
