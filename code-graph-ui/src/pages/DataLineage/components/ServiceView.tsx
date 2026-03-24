/**
 * ServiceView - 模块内视图组件。
 *
 * 展示指定模块内的 Controller → Service → Repository 链路。
 * 支持点击 Service 进入层级 3（详细血缘）。
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
  Handle,
  Position,
  useReactFlow,
} from "reactflow";
import "reactflow/dist/style.css";
import dagre from "dagre";
import { Spin, Tooltip, Drawer, Tag, Button } from "antd";
import {
  ArrowLeftOutlined,
  DatabaseOutlined,
  CodeOutlined,
  ApiOutlined,
  ShareAltOutlined,
  ApartmentOutlined,
} from "@ant-design/icons";
import { graphApi } from "../../../api/graphApi";
import type { GraphNode, GraphEdge } from "../../../types/graph";
import NodeDetailPanel from "../../../components/NodeDetailPanel";
import CrossModulePanel from "./CrossModulePanel";
import type { ModuleNode } from "../utils/moduleAggregation";
import { getModuleId } from "../utils/moduleAggregation";

// ─── 类型定义 ────────────────────────────────────────────────────────────────

interface ServiceViewProps {
  repoId: string;
  moduleId: string;
  module: ModuleNode;
  onBack: () => void;
  onServiceClick?: (serviceId: string, service: GraphNode) => void;
}

interface RawNode {
  id: string;
  type: string;
  name?: string;
  properties?: Record<string, unknown>;
}

interface RawEdge {
  from: string;
  to: string;
  type: string;
  properties?: Record<string, unknown>;
}

// ─── 节点颜色 ────────────────────────────────────────────────────────────────

const NODE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  service: { bg: "rgba(0,240,132,0.08)", border: "#00f08444", text: "#00f084" },
  component: { bg: "rgba(0,212,255,0.08)", border: "#00d4ff44", text: "#00d4ff" },
  class: { bg: "rgba(255,193,69,0.07)", border: "#ffc14533", text: "#ffc145" },
  database: { bg: "rgba(176,142,255,0.1)", border: "#b08eff55", text: "#b08eff" },
  datasource: { bg: "rgba(176,142,255,0.12)", border: "#b08eff88", text: "#b08eff" },
  _default: { bg: "rgba(30,45,61,0.5)", border: "#1e2d3d", text: "#6b8aaa" },
};

const EDGE_COLORS: Record<string, string> = {
  calls: "#00f08466",
  reads: "#00d4ff66",
  writes: "#ffc14566",
};

function getNodeStyle(type: string) {
  const t = type.toLowerCase();
  return NODE_COLORS[t] ?? NODE_COLORS._default;
}

function getNodeDims(type: string): { w: number; h: number } {
  const t = type.toLowerCase();
  if (t === "database" || t === "datasource") return { w: 140, h: 44 };
  if (t === "service") return { w: 170, h: 44 };
  if (t === "component") return { w: 180, h: 44 };
  return { w: 160, h: 40 };
}

// ─── 布局函数 ────────────────────────────────────────────────────────────────

function applyDagreLayout(nodes: Node[], edges: Edge[], direction: "TB" | "LR" = "TB"): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    nodesep: 40,
    ranksep: 80,
    marginx: 20,
    marginy: 20,
  });

  nodes.forEach((n) => {
    const dims = getNodeDims((n.data as ServiceNodeData).nodeType);
    g.setNode(n.id, { width: dims.w, height: dims.h });
  });

  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);

  return nodes.map((n) => {
    const dims = getNodeDims((n.data as ServiceNodeData).nodeType);
    const pos = g.node(n.id);
    return { ...n, position: { x: pos.x - dims.w / 2, y: pos.y - dims.h / 2 } };
  });
}

// ─── 节点数据类型 ────────────────────────────────────────────────────────────

type ServiceNodeData = {
  label: string;
  nodeType: string;
  isHighlighted: boolean;
  isCrossModule: boolean;
  originalNode: RawNode;
  crossModuleTarget?: string; // 跨模块调用的目标模块名
};

// ─── 自定义节点组件 ──────────────────────────────────────────────────────────

const ServiceNode: React.FC<{ data: ServiceNodeData }> = ({ data }) => {
  const style = getNodeStyle(data.nodeType);
  const dims = getNodeDims(data.nodeType);
  const isDb = ["database", "datasource"].includes(data.nodeType.toLowerCase());

  return (
    <div
      style={{
        width: dims.w,
        height: dims.h,
        background: data.isCrossModule ? "rgba(255,107,107,0.06)" : "rgba(10,15,22,0.88)",
        border: `1px solid ${
          data.isCrossModule ? "#ff6b6b44" : data.isHighlighted ? style.border : "#1a2535"
        }`,
        borderRadius: isDb ? 8 : 4,
        display: "flex",
        alignItems: "center",
        padding: "0 10px",
        gap: 6,
        boxShadow: data.isHighlighted ? `0 0 12px ${style.border}` : "0 1px 4px rgba(0,0,0,0.4)",
        transition: "all 0.18s ease",
        cursor: "pointer",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* 类型指示条 */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          background: data.isCrossModule ? "#ff6b6b" : style.text,
          borderRadius: "3px 0 0 3px",
          opacity: 0.7,
        }}
      />

      {/* 图标 */}
      {data.nodeType.toLowerCase() === "service" && <CodeOutlined style={{ color: style.text, fontSize: 12 }} />}
      {data.nodeType.toLowerCase() === "component" && <ApiOutlined style={{ color: style.text, fontSize: 12 }} />}
      {isDb && <DatabaseOutlined style={{ color: style.text, fontSize: 12 }} />}

      <div style={{ flex: 1, overflow: "hidden" }}>
        <div
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 10,
            color: data.isCrossModule ? "#ff6b6b" : style.text,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {data.label}
        </div>
        <div
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 8,
            color: "#3a5a6a",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            marginTop: 1,
          }}
        >
          {data.crossModuleTarget ? `→ ${data.crossModuleTarget}` : data.nodeType.toLowerCase()}
        </div>
      </div>

      <Handle type="target" position={Position.Top} style={{ background: style.text, width: 5, height: 5, border: "none", top: -3 }} />
      <Handle type="source" position={Position.Bottom} style={{ background: style.text, width: 5, height: 5, border: "none", bottom: -3 }} />
      <Handle type="target" position={Position.Left} style={{ background: style.text, width: 5, height: 5, border: "none", left: -3 }} />
      <Handle type="source" position={Position.Right} style={{ background: style.text, width: 5, height: 5, border: "none", right: -3 }} />
    </div>
  );
};

const nodeTypes: NodeTypes = { service: ServiceNode };

// ─── 主组件 ──────────────────────────────────────────────────────────────────

const ServiceView: React.FC<ServiceViewProps> = ({
  repoId,
  moduleId,
  module,
  onBack,
  onServiceClick,
}) => {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rawNodes, setRawNodes] = useState<RawNode[]>([]);
  const [rawEdges, setRawEdges] = useState<RawEdge[]>([]);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [showCrossModulePanel, setShowCrossModulePanel] = useState(false);
  const [layoutType, setLayoutType] = useState<"TB" | "LR">("TB");
  const { fitView } = useReactFlow();

  const moduleName = moduleId.replace("module:", "");

  // 加载模块内数据
  useEffect(() => {
    setLoading(true);
    setError(null);

    graphApi
      .getLineageView(repoId, { moduleId })
      .then((res) => {
        const nodes = res.nodes.map((n) => ({
          id: n.id,
          type: n.type,
          name: n.name || n.id.split(":").pop() || n.id,
          properties: n.properties || {},
        }));
        const edges = res.edges.map((e) => ({
          from: e.from,
          to: e.to,
          type: e.type,
          properties: e.properties || {},
        }));
        setRawNodes(nodes);
        setRawEdges(edges);
        setLoading(false);
      })
      .catch((err) => {
        setError(String(err));
        setLoading(false);
      });
  }, [repoId, moduleId]);

  // 构建 ReactFlow 节点和边
  useEffect(() => {
    if (!rawNodes.length) return;

    // 构建节点
    const rfNodes: Node<ServiceNodeData>[] = rawNodes.map((n) => {
      // 检查是否是跨模块调用
      const nodeModule = getModuleId(n.id);
      const isCrossModule = nodeModule && nodeModule !== moduleName;
      const crossModuleTarget = isCrossModule ? nodeModule : undefined;

      return {
        id: n.id,
        type: "service",
        position: { x: 0, y: 0 },
        data: {
          label: n.name || n.id.split(":").pop() || n.id,
          nodeType: n.type,
          isHighlighted: false,
          isCrossModule: isCrossModule || false,
          originalNode: n,
          crossModuleTarget,
        },
      };
    });

    // 构建边
    const rfEdges: Edge[] = rawEdges
      .filter((e) => e.type === "calls" || e.type === "reads" || e.type === "writes")
      .map((e) => {
        const color = EDGE_COLORS[e.type] || "#1e3a4a";
        return {
          id: `${e.from}--${e.type}--${e.to}`,
          source: e.from,
          target: e.to,
          type: "smoothstep",
          animated: e.type !== "calls",
          label: e.type,
          labelStyle: {
            fontFamily: "'IBM Plex Mono'",
            fontSize: 8,
            fill: color.replace("66", "cc"),
          },
          labelBgStyle: { fill: "#07090d", fillOpacity: 0.85 },
          style: {
            stroke: color,
            strokeWidth: 1.5,
            opacity: 0.8,
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: color.replace("66", "cc"),
            width: 8,
            height: 8,
          },
          data: { originalEdge: e },
        };
      });

    // 应用布局
    const laidNodes = applyDagreLayout(rfNodes, rfEdges, layoutType);
    setNodes(laidNodes);
    setEdges(rfEdges);

    setTimeout(() => fitView({ padding: 0.1, duration: 300 }), 60);
  }, [rawNodes, rawEdges, layoutType, moduleName, setNodes, setEdges, fitView]);

  // 节点点击
  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node<ServiceNodeData>) => {
      const orig = node.data.originalNode;

      if (node.data.isCrossModule) {
        // 跨模块节点：显示在面板中
        setShowCrossModulePanel(true);
        return;
      }

      setSelectedNode({
        id: orig.id,
        type: orig.type,
        label: orig.name || orig.id.split(":").pop() || orig.id,
        properties: orig.properties || {},
      });

      if (onServiceClick && orig.type.toLowerCase() === "service") {
        onServiceClick(orig.id, {
          id: orig.id,
          type: orig.type,
          label: orig.name || orig.id.split(":").pop() || orig.id,
          properties: orig.properties || {},
        });
      }
    },
    [onServiceClick]
  );

  // 双击返回
  const handleDoubleClick = useCallback(() => {
    onBack();
  }, [onBack]);

  // 计算跨模块调用
  const crossModuleCalls = useMemo(() => {
    const calls: Array<{ from: string; to: string; fromModule: string; toModule: string }> = [];

    rawEdges.forEach((e) => {
      if (e.type !== "calls") return;

      const fromModule = getModuleId(e.from);
      const toModule = getModuleId(e.to);

      if (fromModule === moduleName && toModule && toModule !== moduleName) {
        calls.push({
          from: e.from.split(":").pop() || e.from,
          to: e.to.split(":").pop() || e.to,
          fromModule: moduleName,
          toModule,
        });
      } else if (toModule === moduleName && fromModule && fromModule !== moduleName) {
        calls.push({
          from: e.from.split(":").pop() || e.from,
          to: e.to.split(":").pop() || e.to,
          fromModule: fromModule || "unknown",
          toModule: moduleName,
        });
      }
    });

    return calls;
  }, [rawEdges, moduleName]);

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
          加载模块 {moduleName}...
        </span>
      </div>
    );
  }

  if (error) {
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
        <div style={{ color: "#ff6b6b", fontSize: 24 }}>⚠️</div>
        <div style={{ color: "#ff6b6b", fontFamily: "'IBM Plex Mono'", fontSize: 11 }}>
          加载失败: {error}
        </div>
        <Button onClick={onBack} size="small">
          返回
        </Button>
      </div>
    );
  }

  return (
    <div style={{ height: "100%", width: "100%", position: "relative" }}>
      {/* 工具栏 */}
      <div
        style={{
          position: "absolute",
          top: 10,
          left: 10,
          zIndex: 10,
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        <Tooltip title="返回模块主图">
          <button
            onClick={onBack}
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
            <ArrowLeftOutlined /> 返回
          </button>
        </Tooltip>

        <div
          style={{
            background: "rgba(176,142,255,0.1)",
            border: "1px solid #b08eff33",
            borderRadius: 4,
            padding: "6px 12px",
            color: "#b08eff",
            fontFamily: "'Syne'",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {moduleName}
        </div>

        <Tooltip title="切换布局方向">
          <button
            onClick={() => setLayoutType(layoutType === "TB" ? "LR" : "TB")}
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
            {layoutType === "TB" ? <ApartmentOutlined /> : <ShareAltOutlined />}
            {layoutType === "TB" ? "垂直" : "水平"}
          </button>
        </Tooltip>

        {/* 统计 */}
        <div style={{ display: "flex", gap: 12, marginLeft: 8 }}>
          <Tag color="#00f084">{module.serviceCount} Service</Tag>
          {module.controllers.length > 0 && (
            <Tag color="#00d4ff">{module.controllers.length} Controller</Tag>
          )}
          {module.repositories.length > 0 && (
            <Tag color="#ffc145">{module.repositories.length} Repository</Tag>
          )}
        </div>

        {/* 跨模块调用按钮 */}
        {crossModuleCalls.length > 0 && (
          <Tooltip title="查看跨模块依赖">
            <button
              onClick={() => setShowCrossModulePanel(true)}
              style={{
                background: "rgba(255,107,107,0.1)",
                border: "1px solid #ff6b6b33",
                borderRadius: 4,
                padding: "6px 10px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
                color: "#ff6b6b",
                fontFamily: "'IBM Plex Mono'",
                fontSize: 10,
              }}
            >
              → {crossModuleCalls.length} 跨模块
            </button>
          </Tooltip>
        )}
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onDoubleClick={handleDoubleClick}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={30} size={0.7} color="#0d1520" />
        <Controls style={{ background: "#080e16", border: "1px solid #1a2535" }} />
        <MiniMap
          style={{ background: "#07090d", border: "1px solid #1a2535" }}
          nodeColor={(n) => getNodeStyle((n.data as ServiceNodeData).nodeType).text}
          maskColor="rgba(7,9,13,0.75)"
        />
      </ReactFlow>

      {/* 节点详情面板 */}
      {selectedNode && (
        <NodeDetailPanel
          node={selectedNode}
          edges={rawEdges.map((e) => ({ source: e.from, target: e.to, type: e.type, properties: e.properties || {} }))}
          allNodes={rawNodes.map((n) => ({ id: n.id, type: n.type, label: n.name || n.id, properties: n.properties || {} }))}
          onClose={() => setSelectedNode(null)}
        />
      )}

      {/* 跨模块依赖面板 */}
      <CrossModulePanel
        visible={showCrossModulePanel}
        calls={crossModuleCalls}
        currentModule={moduleName}
        onClose={() => setShowCrossModulePanel(false)}
      />
    </div>
  );
};

export default ServiceView;
