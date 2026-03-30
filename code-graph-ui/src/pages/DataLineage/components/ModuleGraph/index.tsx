/**
 * ModuleGraph - 模块依赖图组件。
 *
 * 使用 ReactFlow 渲染模块依赖图：
 * - 节点 = 模块
 * - 边 = 模块间依赖关系
 * - 支持点击选中模块
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

// ─── 节点类型注册 ────────────────────────────────────────────────────────────

const nodeTypes: NodeTypes = {
  module: ModuleNode,
};

// ─── 边样式配置 ──────────────────────────────────────────────────────────────

const EDGE_STYLES: Record<string, { color: string; dash: string | undefined }> = {
  data: { color: "#00d4ff", dash: undefined },
  config: { color: "#b08eff", dash: "5,5" },
  service: { color: "#00f084", dash: undefined },
  auth: { color: "#ffc145", dash: "2,2" },
  aggregate: { color: "#7888a8", dash: undefined },
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
    nodesep: 80,
    ranksep: 120,
    marginx: 40,
    marginy: 40,
  });

  nodes.forEach((n) => {
    g.setNode(n.id, { width: 200, height: 70 });
  });

  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);

  return nodes.map((n) => {
    const pos = g.node(n.id);
    return { ...n, position: { x: pos.x - 100, y: pos.y - 35 } };
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
    if (!modules.length) return;

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
    const flowEdges: Edge[] = dependencies.map((dep) => {
      const style = EDGE_STYLES[dep.type] || EDGE_STYLES.data;

      return {
        id: `${dep.from}--${dep.type}--${dep.to}`,
        source: dep.from,
        target: dep.to,
        type: "smoothstep",
        animated: dep.type === "data" || dep.type === "service",
        label: dep.type,
        labelStyle: {
          fontFamily: "'IBM Plex Mono'",
          fontSize: 9,
          fill: style.color,
        },
        labelBgStyle: { fill: "#07090d", fillOpacity: 0.9 },
        style: {
          stroke: style.color,
          strokeWidth: 2,
          strokeDasharray: style.dash,
          opacity: 0.85,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: style.color,
          width: 12,
          height: 12,
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
              fontFamily: "'IBM Plex Mono'",
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
    <div style={{ height: "100%", width: "100%" }}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.2}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={30}
          size={0.7}
          color="#0d1520"
        />
        <Controls
          style={{ background: "#080e16", border: "1px solid #1a2535" }}
        />
        <MiniMap
          style={{ background: "#07090d", border: "1px solid #1a2535" }}
          nodeColor="#b08eff"
          maskColor="rgba(7,9,13,0.75)"
        />
      </ReactFlow>
    </div>
  );
};

export default ModuleGraph;
