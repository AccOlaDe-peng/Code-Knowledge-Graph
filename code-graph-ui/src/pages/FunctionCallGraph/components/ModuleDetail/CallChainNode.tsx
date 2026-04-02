/**
 * CallChainNode - 调用链自定义节点组件
 *
 * 样式：
 * - 普通节点：复用现有样式，颜色区分类型
 * - 根节点（选中函数）：加粗边框 + 发光效果
 * - 折叠节点：灰色虚线边框 + 展开图标
 */
import React from "react";
import { FireOutlined, ExpandOutlined } from "@ant-design/icons";
import { Handle, Position } from "reactflow";
import { FUNCTION_TYPE_COLORS } from "../../types";

// ─── 节点数据类型 ──────────────────────────────────────────────────────────────

interface CallChainNodeData {
  id: string;
  name: string;
  className: string;
  type: keyof typeof FUNCTION_TYPE_COLORS;
  distance: number;
  direction: "caller" | "callee" | "root";
  isCollapsed?: boolean;
  collapsedCount?: number;
  isRoot?: boolean;
  callerCount: number;
  calleeCount: number;
}

// ─── 节点组件 ──────────────────────────────────────────────────────────────────

const CallChainNode: React.FC<{ data: CallChainNodeData }> = ({ data }) => {
  const colors =
    FUNCTION_TYPE_COLORS[data.type] || FUNCTION_TYPE_COLORS.service;

  const renderHandles = () => (
    <>
      <Handle
        type="target"
        position={Position.Left}
        style={{ opacity: 0, width: 8, height: 8, border: "none" }}
        isConnectable={false}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{ opacity: 0, width: 8, height: 8, border: "none" }}
        isConnectable={false}
      />
    </>
  );

  // 计算热度
  const heat = data.callerCount + data.calleeCount;
  const isHot = heat > 10;

  // 根节点样式
  if (data.isRoot) {
    return (
      <div
        style={{
          padding: "10px 14px",
          background: `linear-gradient(135deg, ${colors.border}25 0%, ${colors.border}10 100%)`,
          border: `2px solid ${colors.border}`,
          borderRadius: 8,
          minWidth: 160,
          maxWidth: 200,
          boxShadow: `0 0 20px ${colors.border}60, 0 0 40px ${colors.border}30`,
          transition: "all 0.15s ease",
        }}
      >
        {renderHandles()}
        {/* 根节点标签 */}
        <div
          style={{
            position: "absolute",
            top: -8,
            left: 10,
            background: colors.border,
            padding: "1px 6px",
            borderRadius: 3,
            fontSize: 9,
            color: "#07090d",
            fontWeight: 600,
          }}
        >
          选中
        </div>

        {/* 函数名 */}
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: colors.text,
            fontFamily: "var(--font-mono)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            marginBottom: 4,
          }}
        >
          {data.name}
        </div>

        {/* 类名 */}
        <div
          style={{
            fontSize: 10,
            color: "#7888a8",
            fontFamily: "var(--font-mono)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {data.className}
        </div>
      </div>
    );
  }

  // 折叠节点样式
  if (data.isCollapsed) {
    return (
      <div
        style={{
          padding: "8px 12px",
          background: "rgba(30,35,45,0.8)",
          border: "1.5px dashed #5a6a8a",
          borderRadius: 6,
          minWidth: 120,
          cursor: "pointer",
          transition: "all 0.15s ease",
        }}
      >
        {renderHandles()}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <ExpandOutlined style={{ color: "#7888a8", fontSize: 12 }} />
          <span style={{ fontSize: 11, color: "#7888a8" }}>
            {data.collapsedCount || 0} 个节点
          </span>
        </div>
        <div
          style={{
            fontSize: 9,
            color: "#5a6a8a",
            marginTop: 4,
            textAlign: "center",
          }}
        >
          点击展开
        </div>
      </div>
    );
  }

  // 普通节点样式
  return (
    <div
      style={{
        padding: "8px 12px",
        background: isHot
          ? `linear-gradient(135deg, ${colors.border}15 0%, ${colors.border}05 100%)`
          : colors.bg,
        border: `1.5px solid ${isHot ? colors.border : `${colors.border}66`}`,
        borderRadius: 6,
        minWidth: 140,
        maxWidth: 180,
        cursor: "pointer",
        boxShadow: isHot
          ? `0 0 12px ${colors.border}30`
          : "0 2px 6px rgba(0,0,0,0.2)",
        transition: "all 0.15s ease",
      }}
    >
      {renderHandles()}
      {/* 函数名 */}
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: colors.text,
          fontFamily: "var(--font-mono)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          marginBottom: 3,
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        {isHot && <FireOutlined style={{ fontSize: 9, color: "#ffc145" }} />}
        {data.name}
      </div>

      {/* 类名 */}
      <div
        style={{
          fontSize: 9,
          color: "#5a6a8a",
          fontFamily: "var(--font-mono)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          marginBottom: 4,
        }}
      >
        {data.className}
      </div>

      {/* 方向和距离标签 */}
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <div
          style={{
            fontSize: 8,
            color: data.direction === "caller" ? "#00d4ff" : "#00f084",
            background: `${data.direction === "caller" ? "#00d4ff" : "#00f084"}15`,
            padding: "1px 4px",
            borderRadius: 2,
          }}
        >
          {data.direction === "caller" ? "← 调用者" : "被调用 →"}
        </div>
        <span style={{ fontSize: 8, color: "#5a6a8a" }}>L{data.distance}</span>
      </div>
    </div>
  );
};

export default CallChainNode;
