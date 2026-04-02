/**
 * CallChainEdge - 调用链自定义边组件
 *
 * 显示：
 * - 调用行号
 * - 调用类型
 * - 区分同模块/跨模块/接口调用
 */
import React from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
} from "reactflow";
import type { EdgeProps } from "reactflow";
import { EDGE_COLORS } from "../../types";

// ─── 边数据类型 ────────────────────────────────────────────────────────────────

interface CallChainEdgeData {
  sourceLine: number;
  callType: "direct" | "interface";
  isCrossModule: boolean;
  isCycle?: boolean;
}

// ─── 边组件 ────────────────────────────────────────────────────────────────────

const CallChainEdge: React.FC<EdgeProps<CallChainEdgeData>> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  style = {},
}) => {
  // 计算边颜色
  const getEdgeColor = () => {
    if (data?.isCycle) return "#ff6b6b";  // 循环调用
    if (data?.callType === "interface") return EDGE_COLORS.interface_call;
    if (data?.isCrossModule) return EDGE_COLORS.cross_module;
    return EDGE_COLORS.same_module;
  };

  const edgeColor = getEdgeColor();

  // 是否使用虚线
  const isDashed = data?.isCrossModule || data?.callType === "interface" || data?.isCycle;

  // 计算贝塞尔曲线路径
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  // 标签内容
  const labelText = data ? `L:${data.sourceLine}` : "";
  const typeText = data?.callType === "interface" ? "interface" : "";

  // Marker 端点 ID
  const markerId = `marker-${id}`;
  const markerUrl = `url(#${markerId})`;

  return (
    <>
      {/* 定义 marker */}
      <svg style={{ position: "absolute", width: 0, height: 0 }}>
        <defs>
          <marker
            id={markerId}
            markerWidth="8"
            markerHeight="8"
            refX="8"
            refY="4"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M0,0 L8,4 L0,8 Z" fill={edgeColor} />
          </marker>
        </defs>
      </svg>

      {/* 边线 */}
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          ...style,
          stroke: edgeColor,
          strokeWidth: 1.5,
          strokeDasharray: isDashed ? "5,5" : undefined,
          opacity: 0.8,
        }}
        markerEnd={markerUrl}
      />

      {/* 边标签 */}
      {data && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 2,
                background: "rgba(7,9,13,0.9)",
                padding: "2px 6px",
                borderRadius: 3,
                border: `1px solid ${edgeColor}40`,
              }}
            >
              {/* 行号 */}
              <span
                style={{
                  fontSize: 9,
                  fontFamily: "var(--font-mono)",
                  color: edgeColor,
                  fontWeight: 500,
                }}
              >
                {labelText}
              </span>
              {/* 类型标签 */}
              {typeText && (
                <span
                  style={{
                    fontSize: 8,
                    color: EDGE_COLORS.interface_call,
                    opacity: 0.8,
                  }}
                >
                  {typeText}
                </span>
              )}
            </div>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
};

export default CallChainEdge;
