/**
 * ModuleView - 模块级主视图组件。
 *
 * 展示所有模块及其之间的数据流向，支持：
 * - 点击模块进入层级 2（模块内视图）
 * - 悬停显示模块统计信息
 * - 跨模块边高亮显示
 */
import React, { useEffect, useMemo, useCallback, useState } from "react";
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
import { Spin, Tooltip } from "antd";
import { ApartmentOutlined, ShareAltOutlined } from "@ant-design/icons";
import ModuleNode from "./ModuleNode";
import type { ModuleData, ModuleNode as ModuleNodeType } from "../utils/moduleAggregation";
import { aggregateToModuleLevel } from "../utils/moduleAggregation";
import type { RawNode, RawEdge } from "../../../api/graphApi";

// ─── 类型定义 ────────────────────────────────────────────────────────────────

interface ModuleViewProps {
  repoId: string;
  nodes: RawNode[];
  edges: RawEdge[];
  loading?: boolean;
  onModuleClick?: (moduleId: string, module: ModuleNodeType) => void;
}

// ─── 节点类型注册 ────────────────────────────────────────────────────────────

const nodeTypes: NodeTypes = {
  module: ModuleNode,
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
    nodesep: 60,
    ranksep: 100,
    marginx: 30,
    marginy: 30,
  });

  nodes.forEach((n) => {
    g.setNode(n.id, { width: 220, height: n.data?.isExpanded ? 180 : 80 });
  });

  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);

  return nodes.map((n) => {
    const pos = g.node(n.id);
    return { ...n, position: { x: pos.x - 110, y: pos.y - 40 } };
  });
}

// ─── 边样式 ──────────────────────────────────────────────────────────────────

const EDGE_COLORS = {
  flow_to: "#b08eff66",
  reads: "#00d4ff66",
  writes: "#ffc14566",
};

// ─── 主组件 ──────────────────────────────────────────────────────────────────

const ModuleView: React.FC<ModuleViewProps> = ({
  nodes,
  edges,
  loading,
  onModuleClick,
}) => {
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState([]);
  const [layoutType, setLayoutType] = useState<"TB" | "LR">("LR");

  // 聚合数据为模块级
  const moduleData = useMemo<ModuleData>(() => {
    if (!nodes.length || !edges.length) {
      return { modules: [], edges: [] };
    }
    return aggregateToModuleLevel(nodes, edges);
  }, [nodes, edges]);

  // 构建 ReactFlow 节点和边
  useEffect(() => {
    if (!moduleData.modules.length) return;

    // 创建节点
    const flowNodes: Node[] = moduleData.modules.map((module) => ({
      id: module.id,
      type: "module",
      position: { x: 0, y: 0 },
      data: {
        module,
        isSelected: false,
      },
    }));

    // 添加 Database 节点（如果有的话）
    const dbIds = new Set<string>();
    moduleData.modules.forEach((m) => {
      m.databases.forEach((db) => dbIds.add(db.id));
    });

    dbIds.forEach((dbId) => {
      const dbNode = {
        id: dbId,
        type: "default" as const,
        position: { x: 0, y: 0 },
        data: {
          label: dbId.split(":").pop() || dbId,
          nodeType: "Database",
        },
        style: {
          background: "rgba(176,142,255,0.08)",
          border: "1px solid #b08eff44",
          borderRadius: 4,
          padding: "8px 12px",
          fontFamily: "'IBM Plex Mono'",
          fontSize: 11,
          color: "#b08eff",
        },
      };
      flowNodes.push(dbNode);
    });

    // 创建边
    const flowEdges: Edge[] = moduleData.edges.map((edge) => {
      const color = EDGE_COLORS[edge.type as keyof typeof EDGE_COLORS] || "#1e3a4a";
      const isCrossModule = edge.type === "flow_to";

      return {
        id: `${edge.from}--${edge.type}--${edge.to}`,
        source: edge.from,
        target: edge.to,
        type: "smoothstep",
        animated: isCrossModule,
        label: isCrossModule ? undefined : edge.type,
        labelStyle: {
          fontFamily: "'IBM Plex Mono'",
          fontSize: 8,
          fill: color.replace("66", "cc").replace("33", "cc"),
        },
        labelBgStyle: { fill: "#07090d", fillOpacity: 0.85 },
        style: {
          stroke: isCrossModule ? color.replace("66", "99") : color,
          strokeWidth: isCrossModule ? 2 : 1.5,
          strokeDasharray: isCrossModule ? "5,5" : undefined,
          opacity: 0.8,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: color.replace("66", "cc").replace("33", "cc"),
          width: 8,
          height: 8,
        },
        data: { edge },
      };
    });

    // 应用布局
    const laidNodes = applyDagreLayout(flowNodes, flowEdges, layoutType);
    setRfNodes(laidNodes);
    setRfEdges(flowEdges);
  }, [moduleData, layoutType, setRfNodes, setRfEdges]);

  // 处理节点点击
  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (node.type === "module" && onModuleClick) {
        const module = moduleData.modules.find((m) => m.id === node.id);
        if (module) {
          onModuleClick(node.id, module);
        }
      }
    },
    [moduleData.modules, onModuleClick]
  );

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          gap: 12,
        }}
      >
        <Spin size="large" />
        <span
          style={{
            fontFamily: "'IBM Plex Mono'",
            fontSize: 10,
            color: "#2a4a6a",
            letterSpacing: "0.12em",
          }}
        >
          加载模块视图...
        </span>
      </div>
    );
  }

  if (!moduleData.modules.length) {
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
      {/* 工具栏 */}
      <div
        style={{
          position: "absolute",
          top: 10,
          left: 10,
          zIndex: 10,
          display: "flex",
          gap: 8,
        }}
      >
        <Tooltip title="切换布局方向">
          <button
            onClick={() => setLayoutType(layoutType === "LR" ? "TB" : "LR")}
            style={{
              background: "rgba(10,15,22,0.9)",
              border: "1px solid #1a2535",
              borderRadius: 4,
              padding: "6px 10px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
              color: "#8ab4c8",
              fontFamily: "'IBM Plex Mono'",
              fontSize: 10,
            }}
          >
            {layoutType === "LR" ? (
              <ShareAltOutlined />
            ) : (
              <ApartmentOutlined />
            )}
            {layoutType === "LR" ? "水平" : "垂直"}
          </button>
        </Tooltip>
      </div>

      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.1}
        maxZoom={2}
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
          nodeColor={(n) => {
            if (n.type === "module") return "#b08eff";
            return "#b08eff";
          }}
          maskColor="rgba(7,9,13,0.75)"
        />
      </ReactFlow>
    </div>
  );
};

export default ModuleView;
