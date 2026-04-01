/**
 * ModuleGraph - 模块依赖图组件。
 *
 * 使用 ReactFlow 渲染模块依赖图：
 * - 节点 = 模块
 * - 边 = 模块间依赖关系
 * - 支持点击选中模块
 * - 支持悬停边显示描述
 *
 * v2.1 - 添加边悬停提示：
 * - 悬停边时显示依赖描述 Tooltip
 */
import React, { useEffect, useMemo, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
  type Node,
  type Edge,
  type NodeTypes,
  type EdgeMouseHandler,
} from "reactflow";
import "reactflow/dist/style.css";
import dagre from "dagre";
import ModuleNode from "./ModuleNode";
import type { Module, ModuleDependency } from "../../types/dataLineage";

// ─── 类型定义 ────────────────────────────────────────────────────────────────

interface ModuleGraphProps {
  modules: Module[];
  dependencies: ModuleDependency[];
  selectedModuleId?: string;
  onModuleClick?: (module: Module) => void;
}

// ─── 节点类型注册 ──────────────────────────────────────────────────────────

const nodeTypes: NodeTypes = {
  module: ModuleNode,
};

// ─── 边样式配置 - 高对比度版本 ──────────────────────────────────────────────

const EDGE_STYLES: Record<string, { color: string; dash: string | undefined; width: number }> = {
  data:    { color: "#00d4ff", dash: undefined,  width: 3 },
  config:  { color: "#ff66cc", dash: "6,4",       width: 2.5 },
  service: { color: "#00f084", dash: undefined,  width: 3 },
  auth:    { color: "#ffc145", dash: "3,3",       width: 2.5 },
  aggregate: { color: "#88aacc", dash: undefined, width: 2 },
};

// ─── Tooltip 组件 ────────────────────────────────────────────────────────────

interface EdgeTooltipProps {
  dep: ModuleDependency;
  x: number;
  y: number;
  moduleMap: Map<string, Module>;
}

const EdgeTooltip: React.FC<EdgeTooltipProps> = ({ dep, x, y, moduleMap }) => {
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
      {/* 类型标签 */}
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

// ─── 布局函数 ────────────────────────────────────────────────────────────────

function applyDagreLayout(
  nodes: Node[],
  edges: Edge[],
  direction: "TB" | "LR" = "LR"
): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    nodesep: 90,
    ranksep: 140,
    marginx: 50,
    marginy: 50,
  });

  nodes.forEach((n) => {
    g.setNode(n.id, { width: 220, height: 80 });
  });

  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);

  return nodes.map((n) => {
    const pos = g.node(n.id);
    return { ...n, position: { x: pos.x - 110, y: pos.y - 40 } };
  });
}

// ─── 主组件 ──────────────────────────────────────────────────────────────────

const ModuleGraph: React.FC<ModuleGraphProps> = ({
  modules,
  dependencies,
  selectedModuleId,
  onModuleClick,
}) => {
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState([]);

  // Tooltip 状态
  const [hoveredEdge, setHoveredEdge] = useState<{
    dep: ModuleDependency;
    x: number;
    y: number;
  } | null>(null);

  // 构建模块 ID 到模块的映射
  const moduleMap = useMemo(() => {
    const map = new Map<string, Module>();
    modules.forEach((m) => map.set(m.id, m));
    return map;
  }, [modules]);

  // 构建依赖 ID 到依赖的映射
  const depMap = useMemo(() => {
    const map = new Map<string, ModuleDependency>();
    dependencies.forEach((dep) => {
      const edgeId = `${dep.from}--${dep.type}--${dep.to}`;
      map.set(edgeId, dep);
    });
    return map;
  }, [dependencies]);

  // 构建 ReactFlow 节点和边
  useEffect(() => {
    if (!modules.length) {
      return;
    }

    // 创建节点
    const flowNodes: Node[] = modules.map((module) => ({
      id: module.id,
      type: "module",
      position: { x: module.position?.x ?? 0, y: module.position?.y ?? 0 },
      data: {
        module,
        isSelected: selectedModuleId === module.id,
      },
    }));

    // 创建边
    // 注意：JSON 中 from/to 表示依赖关系（from 依赖 to）
    // 但可视化时我们需要展示数据流向（to → from，即被依赖方 → 依赖方）
    const flowEdges: Edge[] = dependencies.map((dep) => {
      const style = EDGE_STYLES[dep.type] || EDGE_STYLES.data;

      return {
        id: `${dep.from}--${dep.type}--${dep.to}`,
        source: dep.to,    // 数据来源（被依赖方）
        target: dep.from,  // 数据去向（依赖方）
        type: "smoothstep",
        animated: dep.type === "data" || dep.type === "service",
        label: dep.type,
        labelStyle: {
          fontFamily: "'JetBrains Mono', 'IBM Plex Mono'",
          fontSize: 10,
          fill: style.color,
          fontWeight: 600,
        },
        labelBgStyle: {
          fill: "#0a0f18",
          fillOpacity: 0.95,
          stroke: style.color,
          strokeWidth: 0.5,
          strokeOpacity: 0.5,
        },
        labelBgPadding: [6, 4] as [number, number],
        labelBgBorderRadius: 4,
        style: {
          stroke: style.color,
          strokeWidth: style.width,
          strokeDasharray: style.dash,
          opacity: 0.95,
          cursor: "pointer",
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: style.color,
          width: 14,
          height: 14,
        },
        data: { dependency: dep },
      };
    });

    // 应用布局
    const laidNodes = applyDagreLayout(flowNodes, flowEdges);

    setRfNodes(laidNodes);
    setRfEdges(flowEdges);
  }, [modules, dependencies, selectedModuleId, setRfNodes, setRfEdges]);

  // 处理节点点击
  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (node.type === "module" && onModuleClick) {
        const module = moduleMap.get(node.id);
        if (module) {
          onModuleClick(module);
        }
      }
    },
    [moduleMap, onModuleClick]
  );

  // 处理边鼠标进入
  const handleEdgeMouseEnter: EdgeMouseHandler = useCallback(
    (event, edge) => {
      const dep = depMap.get(edge.id);
      if (dep) {
        setHoveredEdge({
          dep,
          x: event.clientX,
          y: event.clientY,
        });
      }
    },
    [depMap]
  );

  // 处理边鼠标移动
  const handleEdgeMouseMove: EdgeMouseHandler = useCallback(
    (event, _edge) => {
      if (hoveredEdge) {
        setHoveredEdge((prev) =>
          prev ? { ...prev, x: event.clientX, y: event.clientY } : null
        );
      }
    },
    [hoveredEdge]
  );

  // 处理边鼠标离开
  const handleEdgeMouseLeave: EdgeMouseHandler = useCallback(() => {
    setHoveredEdge(null);
  }, []);

  if (!modules.length) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 40, opacity: 0.06, marginBottom: 12 }}>◈</div>
          <div
            style={{
              fontFamily: "'JetBrains Mono', 'IBM Plex Mono'",
              fontSize: 11,
              color: "#2a4a6a",
              letterSpacing: "0.1em",
            }}
          >
            暂无模块数据
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      width: "100%",
      height: "100%",
      background: "linear-gradient(180deg, #080c14 0%, #0a0f18 100%)"
    }}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onEdgeMouseEnter={handleEdgeMouseEnter}
        onEdgeMouseMove={handleEdgeMouseMove}
        onEdgeMouseLeave={handleEdgeMouseLeave}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.2}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={32}
          size={1}
          color="#152030"
        />
        <Controls
          style={{
            background: "rgba(10, 15, 24, 0.95)",
            border: "1px solid #1a2840",
            borderRadius: 8,
          }}
        />
        <MiniMap
          style={{
            background: "rgba(7, 9, 13, 0.95)",
            border: "1px solid #1a2840",
            borderRadius: 8,
          }}
          nodeColor="#b08eff"
          maskColor="rgba(7, 9, 13, 0.8)"
        />
      </ReactFlow>

      {/* Tooltip - 渲染到 body */}
      {hoveredEdge && createPortal(
        <EdgeTooltip
          dep={hoveredEdge.dep}
          x={hoveredEdge.x}
          y={hoveredEdge.y}
          moduleMap={moduleMap}
        />,
        document.body
      )}
    </div>
  );
};

export default ModuleGraph;
