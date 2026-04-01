/**
 * ModuleGraph - 模块依赖图组件。
 *
 * 使用 ReactFlow 渲染模块依赖图：
 * - 节点 = 模块
 * - 边 = 模块间依赖关系
 * - 支持点击选中模块
 *
 * v2.0 - 高对比度设计优化：
 * - 边宽度从 2 提升到 2.5-3
 * - 边透明度从 0.85 提升到 0.95
 * - 背景点阵颜色提亮
 * - 标签背景优化
 */
import React, { useEffect, useMemo, useCallback } from "react";
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
  type EdgeTypes,
} from "reactflow";
import "reactflow/dist/style.css";
import dagre from "dagre";
import ModuleNode from "./ModuleNode";
import DependencyEdge from "./DependencyEdge";
import type { Module, ModuleDependency } from "../../types/dataLineage";

// ─── 类型定义 ────────────────────────────────────────────────────────────────

interface ModuleGraphProps {
  modules: Module[];
  dependencies: ModuleDependency[];
  selectedModuleId?: string;
  onModuleClick?: (module: Module) => void;
}

// ─── 节点/边类型注册 ──────────────────────────────────────────────────────────

const nodeTypes: NodeTypes = {
  module: ModuleNode,
};

const edgeTypes: EdgeTypes = {
  dependency: DependencyEdge,
};

// ─── 边样式配置 - 高对比度版本 ──────────────────────────────────────────────

const EDGE_STYLES: Record<string, { color: string; dash: string | undefined; width: number }> = {
  data:    { color: "#00d4ff", dash: undefined,  width: 3 },     // 青色 - 加粗
  config:  { color: "#ff66cc", dash: "6,4",       width: 2.5 },   // Magenta 虚线
  service: { color: "#00f084", dash: undefined,  width: 3 },     // 绿色 - 加粗
  auth:    { color: "#ffc145", dash: "3,3",       width: 2.5 },   // 琥珀色虚线
  aggregate: { color: "#88aacc", dash: undefined, width: 2 },  // Silver
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
    nodesep: 90,   // 从 80 提升
    ranksep: 140,  // 从 120 提升
    marginx: 50,
    marginy: 50,
  });

  nodes.forEach((n) => {
    g.setNode(n.id, { width: 220, height: 80 });  // 稍微增大节点尺寸
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

  // 构建模块 ID 到模块的映射
  const moduleMap = useMemo(() => {
    const map = new Map<string, Module>();
    modules.forEach((m) => map.set(m.id, m));
    return map;
  }, [modules]);

  // 构建 ReactFlow 节点和边
  useEffect(() => {
    if (!modules.length) {
      return;
    }

    // 构建模块映射（用于边组件显示名称）
    const modMap = new Map<string, Module>();
    modules.forEach((m) => modMap.set(m.id, m));

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

    // 创建边 - 高对比度版本
    // 注意：JSON 中 from/to 表示依赖关系（from 依赖 to）
    // 但可视化时我们需要展示数据流向（to → from，即被依赖方 → 依赖方）
    const flowEdges: Edge[] = dependencies.map((dep) => {
      const style = EDGE_STYLES[dep.type] || EDGE_STYLES.data;

      return {
        id: `${dep.from}--${dep.type}--${dep.to}`,
        source: dep.to,    // 数据来源（被依赖方）
        target: dep.from,  // 数据去向（依赖方）
        type: "dependency",  // 使用自定义边类型
        animated: dep.type === "data" || dep.type === "service",
        style: {
          stroke: style.color,
          strokeWidth: style.width,
          strokeDasharray: style.dash,
          opacity: 0.95,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: style.color,
          width: 14,
          height: 14,
        },
        data: { dependency: dep, moduleMap: modMap },
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
      background: "linear-gradient(180deg, #080c14 0%, #0a0f18 100%)"  // 渐变背景
    }}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        minZoom={0.2}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={32}
          size={1}
          color="#152030"  // 从 #0d1520 提亮
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
    </div>
  );
};

export default ModuleGraph;
