/**
 * BusinessDomainNode - 业务领域节点组件。
 *
 * 用于在血缘图业务视图中展示业务领域节点。
 */
import React, { useState, useMemo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import {
  AppstoreOutlined,
  CodeOutlined,
  ApiOutlined,
  DatabaseOutlined,
  RightOutlined,
  DownOutlined,
} from "@ant-design/icons";
import type { BusinessDomainNode } from "../utils/domainAggregation";

// ─── 类型定义 ────────────────────────────────────────────────────────────────

interface BusinessDomainNodeData {
  domain: BusinessDomainNode;
  isHighlighted?: boolean;
  isSelected?: boolean;
}

// ─── 样式常量 ────────────────────────────────────────────────────────────────

const COLORS = {
  domain: {
    text: "#00f084",
    textDim: "#2a6a4a",
  },
  service: { text: "#00f084" },
  controller: { text: "#00d4ff" },
  repository: { text: "#ffc145" },
  database: { text: "#b08eff" },
  crossCall: { text: "#ff6b6b" },
  module: { text: "#6b8aaa" },
};

// ─── 组件 ────────────────────────────────────────────────────────────────────

const BusinessDomainNodeComponent: React.FC<NodeProps<BusinessDomainNodeData>> = ({
  data,
  selected,
}) => {
  const { domain, isHighlighted } = data;
  const [isExpanded, setIsExpanded] = useState(false);

  // 显示的服务列表（最多 5 个）
  const displayedServices = useMemo(() => {
    return domain.services.slice(0, 5);
  }, [domain.services]);

  const hasMoreServices = domain.services.length > 5;

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  };

  return (
    <div
      style={{
        width: 240,
        background: selected
          ? `rgba(0,240,132,0.08)`
          : "rgba(10,15,22,0.88)",
        border: `1px solid ${
          selected
            ? `${domain.color}aa`
            : isHighlighted
              ? `${domain.color}66`
              : "#1a2535"
        }`,
        borderRadius: 8,
        boxShadow: selected
          ? `0 0 16px ${domain.color}44, 0 2px 8px rgba(0,0,0,0.5)`
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
          width: 4,
          background: domain.color,
          opacity: selected ? 0.9 : 0.7,
        }}
      />

      {/* 标题栏 */}
      <div
        onClick={handleToggle}
        style={{
          display: "flex",
          alignItems: "center",
          padding: "10px 12px 10px 14px",
          borderBottom: isExpanded ? `1px solid ${domain.color}22` : "none",
          gap: 8,
        }}
      >
        {/* 展开/折叠图标 */}
        {isExpanded ? (
          <DownOutlined style={{ fontSize: 10, color: COLORS.domain.textDim }} />
        ) : (
          <RightOutlined style={{ fontSize: 10, color: COLORS.domain.textDim }} />
        )}

        {/* 领域图标和名称 */}
        <AppstoreOutlined style={{ fontSize: 14, color: domain.color }} />
        <span
          style={{
            fontFamily: "'Syne', sans-serif",
            fontSize: 12,
            fontWeight: 600,
            color: domain.color,
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {domain.name}
        </span>

        {/* 节点数量标记 */}
        <span
          style={{
            fontFamily: "'IBM Plex Mono'",
            fontSize: 10,
            color: COLORS.domain.textDim,
            background: `${domain.color}15`,
            padding: "1px 6px",
            borderRadius: 4,
          }}
        >
          {domain.nodeCount}
        </span>
      </div>

      {/* 统计信息（始终显示） */}
      <div
        style={{
          display: "flex",
          gap: 10,
          padding: "6px 12px 6px 28px",
          fontSize: 9,
          fontFamily: "'IBM Plex Mono'",
          flexWrap: "wrap",
        }}
      >
        {domain.controllers.length > 0 && (
          <span style={{ color: COLORS.controller.text }}>
            <ApiOutlined /> {domain.controllers.length} Controller
          </span>
        )}
        {domain.services.length > 0 && (
          <span style={{ color: COLORS.service.text }}>
            <CodeOutlined /> {domain.services.length} Service
          </span>
        )}
        {domain.repositories.length > 0 && (
          <span style={{ color: COLORS.repository.text }}>
            <DatabaseOutlined /> {domain.repositories.length} Repo
          </span>
        )}
      </div>

      {/* 跨模块标识 */}
      {domain.inModules.length > 1 && (
        <div
          style={{
            padding: "0 12px 6px 28px",
            fontSize: 8,
            color: COLORS.module.text,
            fontFamily: "'IBM Plex Mono'",
          }}
        >
          跨模块: {domain.inModules.slice(0, 3).join(", ")}
          {domain.inModules.length > 3 && ` +${domain.inModules.length - 3}`}
        </div>
      )}

      {/* 数据库访问 */}
      {domain.databases.length > 0 && (
        <div
          style={{
            padding: "0 12px 6px 28px",
            fontSize: 8,
            color: COLORS.database.text,
            fontFamily: "'IBM Plex Mono'",
          }}
        >
          <DatabaseOutlined /> {domain.databases.join(", ")}
        </div>
      )}

      {/* 展开的 Service 列表 */}
      {isExpanded && (
        <div
          style={{
            padding: "4px 12px 8px 28px",
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
                color: COLORS.domain.textDim,
                marginTop: 4,
              }}
            >
              +{domain.services.length - 5} more
            </div>
          )}
        </div>
      )}

      {/* Handles */}
      <Handle
        type="target"
        position={Position.Top}
        style={{
          background: domain.color,
          width: 6,
          height: 6,
          border: "none",
          top: -3,
        }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        style={{
          background: domain.color,
          width: 6,
          height: 6,
          border: "none",
          bottom: -3,
        }}
      />
      <Handle
        type="target"
        position={Position.Left}
        style={{
          background: domain.color,
          width: 6,
          height: 6,
          border: "none",
          left: -3,
        }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{
          background: domain.color,
          width: 6,
          height: 6,
          border: "none",
          right: -3,
        }}
      />
    </div>
  );
};

export default BusinessDomainNodeComponent;
