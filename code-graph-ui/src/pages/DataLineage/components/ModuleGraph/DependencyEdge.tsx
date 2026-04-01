/**
 * DependencyEdge - 带描述提示的依赖边组件。
 *
 * 使用 Tooltip 在 hover 时展示依赖描述。
 */
import React, { useState } from "react";
import { createPortal } from "react-dom";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "reactflow";

// ─── 依赖边样式配置 ───────────────────────────────────────────────────────────

const EDGE_STYLES: Record<string, { color: string; dash: string | undefined; width: number }> = {
  data:    { color: "#00d4ff", dash: undefined,  width: 3 },
  config:  { color: "#ff66cc", dash: "6,4",       width: 2.5 },
  service: { color: "#00f084", dash: undefined,  width: 3 },
  auth:    { color: "#ffc145", dash: "3,3",       width: 2.5 },
  aggregate: { color: "#88aacc", dash: undefined, width: 2 },
};

// ─── Tooltip 组件 ──────────────────────────────────────────────────────────────

interface TooltipProps {
  dep: {
    from: string;
    to: string;
    type: string;
    description: string;
    detail?: string;
  };
  x: number;
  y: number;
  moduleMap: Map<string, { name: string }>;
}

const EdgeTooltip: React.FC<TooltipProps> = ({ dep, x, y, moduleMap }) => {
  const fromModule = moduleMap.get(dep.from);
  const toModule = moduleMap.get(dep.to);
  const style = EDGE_STYLES[dep.type] || EDGE_STYLES.data;

  return (
    <div
      style={{
        position: "fixed",
        left: x,
        top: y,
        transform: "translate(-50%, -120%)",
        background: "rgba(10, 15, 24, 0.98)",
        border: `1px solid ${style.color}40`,
        borderRadius: 8,
        padding: "10px 14px",
        minWidth: 200,
        maxWidth: 320,
        boxShadow: `0 4px 20px rgba(0,0,0,0.5), 0 0 20px ${style.color}20`,
        zIndex: 9999,
        pointerEvents: "none",
      }}
    >
      {/* 标题：类型标签 */}
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "3px 8px",
          background: `${style.color}15`,
          border: `1px solid ${style.color}40`,
          borderRadius: 4,
          marginBottom: 8,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: style.color,
          }}
        />
        <span
          style={{
            fontFamily: "'JetBrains Mono', 'IBM Plex Mono'",
            fontSize: 10,
            fontWeight: 600,
            color: style.color,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
          }}
        >
          {dep.type}
        </span>
      </div>

      {/* 流向描述 */}
      <div
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: 13,
          color: "#e0e8f8",
          marginBottom: 8,
          lineHeight: 1.5,
        }}
      >
        <span style={{ color: style.color, fontWeight: 600 }}>
          {toModule?.name || dep.to}
        </span>
        <span style={{ color: "#6a7a9a", margin: "0 6px" }}>→</span>
        <span style={{ color: "#c8d4e8" }}>
          {fromModule?.name || dep.from}
        </span>
      </div>

      {/* 依赖描述 */}
      <div
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: 12,
          color: "#a8b8d8",
          lineHeight: 1.6,
          marginBottom: dep.detail ? 8 : 0,
        }}
      >
        {dep.description}
      </div>

      {/* 详细说明 */}
      {dep.detail && (
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "#6a7a9a",
            lineHeight: 1.6,
            borderTop: "1px solid #1a2840",
            paddingTop: 8,
            marginTop: 4,
          }}
        >
          {dep.detail}
        </div>
      )}
    </div>
  );
};

// ─── 主边组件 ──────────────────────────────────────────────────────────────────

interface DependencyEdgeProps extends EdgeProps {
  data?: {
    dependency: {
      from: string;
      to: string;
      type: string;
      description: string;
      detail?: string;
    };
    moduleMap?: Map<string, { name: string }>;
  };
}

const DependencyEdge: React.FC<DependencyEdgeProps> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  data,
  markerEnd,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const dep = data?.dependency;
  const moduleMap = data?.moduleMap || new Map();
  const edgeStyle = dep ? (EDGE_STYLES[dep.type] || EDGE_STYLES.data) : EDGE_STYLES.data;

  // 计算路径
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  // 鼠标移动时更新 tooltip 位置
  const handleMouseMove = (e: React.MouseEvent) => {
    setTooltipPos({ x: e.clientX, y: e.clientY });
  };

  return (
    <>
      {/* 不可见的宽边，用于更容易触发 hover */}
      <path
        d={edgePath}
        fill="none"
        strokeWidth={20}
        stroke="transparent"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onMouseMove={handleMouseMove}
        style={{ cursor: "pointer" }}
      />

      {/* 可见的边 */}
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          ...style,
          stroke: edgeStyle.color,
          strokeWidth: isHovered ? edgeStyle.width + 1 : edgeStyle.width,
          strokeDasharray: edgeStyle.dash,
          opacity: isHovered ? 1 : 0.95,
        }}
        markerEnd={markerEnd}
      />

      {/* 标签 */}
      {dep && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                fontFamily: "'JetBrains Mono', 'IBM Plex Mono'",
                fontSize: 10,
                fontWeight: 600,
                color: edgeStyle.color,
                background: "#0a0f18",
                padding: "3px 8px",
                borderRadius: 4,
                border: `1px solid ${edgeStyle.color}30`,
              }}
            >
              {dep.type}
            </div>
          </div>
        </EdgeLabelRenderer>
      )}

      {/* Tooltip - 使用 Portal 渲染到 body */}
      {isHovered && dep && createPortal(
        <EdgeTooltip
          dep={dep}
          x={tooltipPos.x}
          y={tooltipPos.y}
          moduleMap={moduleMap}
        />,
        document.body
      )}
    </>
  );
};

export default DependencyEdge;
