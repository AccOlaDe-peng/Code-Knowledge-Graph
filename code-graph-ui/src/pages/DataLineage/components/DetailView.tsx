/**
 * DetailView - 单 Service 详细血缘视图。
 *
 * 展示 Function 级完整调用链：
 * APIEndpoint → Controller 方法 → Service 方法 → Repository 方法 → Database
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
import { Spin, Tooltip, Button, Tag } from "antd";
import {
  ArrowLeftOutlined,
  CodeOutlined,
  DatabaseOutlined,
  ApiOutlined,
  FileTextOutlined,
  ShareAltOutlined,
  ApartmentOutlined,
} from "@ant-design/icons";
import { graphApi } from "../../../api/graphApi";
import type { GraphNode } from "../../../types/graph";
import NodeDetailPanel from "../../../components/NodeDetailPanel";

// ─── 类型定义 ────────────────────────────────────────────────────────────────

interface DetailViewProps {
  repoId: string;
  serviceId: string;
  serviceName: string;
  onBack: () => void;
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
  function: { bg: "rgba(255,107,107,0.07)", border: "#ff6b6b33", text: "#ff6b6b" },
  apiendpoint: { bg: "rgba(0,212,255,0.12)", border: "#00d4ff88", text: "#00d4ff" },
  database: { bg: "rgba(176,142,255,0.1)", border: "#b08eff55", text: "#b08eff" },
  datasource: { bg: "rgba(176,142,255,0.12)", border: "#b08eff88", text: "#b08eff" },
  _default: { bg: "rgba(30,45,61,0.5)", border: "#1e2d3d", text: "#6b8aaa" },
};

const EDGE_COLORS: Record<string, string> = {
  calls: "#00f08466",
  reads: "#00d4ff66",
  writes: "#ffc14566",
  handles: "#00d4ff77",
};

function getNodeStyle(type: string) {
  const t = type.toLowerCase();
  return NODE_COLORS[t] ?? NODE_COLORS._default;
}

// ─── 辅助函数 ────────────────────────────────────────────────────────────────

/**
 * 从 Function ID 中提取信息。
 * function:adms-api/src/.../UserController.java:UserController.getUser
 * -> { className: "UserController", methodName: "getUser", filePath: "adms-api/src/.../UserController.java" }
 */
function parseFunctionId(functionId: string): {
  className: string;
  methodName: string;
  filePath: string;
} | null {
  if (!functionId.startsWith("function:")) return null;

  const body = functionid.slice(9); // 移除 "function:"
  const lastDot = body.lastIndexOf(".");

  if (lastDot === -1) return null;

  const classPart = body.slice(0, lastDot);
  const methodPart = body.slice(lastDot + 1);

  // classPart 格式: adms-api/src/.../UserController.java:UserController
  const colonIdx = classPart.lastIndexOf(":");
  const className = colonIdx !== -1 ? classPart.slice(colonIdx + 1) : classPart.split("/").pop() || "";
  const filePath = colonIdx !== -1 ? classPart.slice(0, colonIdx) : classPart;

  return { className, methodName: methodPart, filePath };
}

/**
 * 推断方法的类型（Controller/Service/Repository）。
 */
function inferMethodType(functionId: string): "controller" | "service" | "repository" | "unknown" {
  const parsed = parseFunctionId(functionId);
  if (!parsed) return "unknown";

  const { className, filePath } = parsed;

  // 从文件路径推断
  if (filePath.toLowerCase().includes("controller")) return "controller";
  if (filePath.toLowerCase().includes("repository") || filePath.toLowerCase().includes("mapper")) return "repository";
  if (filePath.toLowerCase().includes("service")) return "service";

  // 从类名推断
  if (className.toLowerCase().includes("controller")) return "controller";
  if (className.toLowerCase().includes("repository") || className.toLowerCase().includes("mapper")) return "repository";
  if (className.toLowerCase().includes("service")) return "service";

  return "unknown";
}

/**
 * 推断方法类型颜色。
 */
function getMethodTypeColor(methodType: string): string {
  switch (methodType) {
    case "controller":
      return "#00d4ff";
    case "service":
      return "#00f084";
    case "repository":
      return "#ffc145";
    default:
      return "#ff6b6b";
  }
}

// ─── 布局函数 ────────────────────────────────────────────────────────────────

function applyDagreLayout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: "TB",
    nodesep: 30,
    ranksep: 60,
    marginx: 20,
    marginy: 20,
  });

  nodes.forEach((n) => {
    g.setNode(n.id, { width: 180, height: 50 });
  });

  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);

  return nodes.map((n) => {
    const pos = g.node(n.id);
    return { ...n, position: { x: pos.x - 90, y: pos.y - 25 } };
  });
}

// ─── 节点数据类型 ────────────────────────────────────────────────────────────

type DetailNodeData = {
  label: string;
  nodeType: string;
  methodType: "controller" | "service" | "repository" | "unknown";
  className: string;
  methodName: string;
  filePath: string;
  lineNumber?: number;
  isEntryPoint: boolean;
  originalNode: RawNode;
};

// ─── 自定义节点组件 ──────────────────────────────────────────────────────────

const DetailNode: React.FC<{ data: DetailNodeData }> = ({ data }) => {
  const style = getNodeStyle(data.nodeType);
  const methodColor = getMethodTypeColor(data.methodType);

  return (
    <div
      style={{
        width: 180,
        minHeight: 50,
        background: data.isEntryPoint ? "rgba(0,212,255,0.1)" : "rgba(10,15,22,0.88)",
        border: `1px solid ${data.isEntryPoint ? "#00d4ff66" : "#1a2535"}`,
        borderRadius: 4,
        display: "flex",
        flexDirection: "column",
        padding: "6px 10px",
        boxShadow: data.isEntryPoint ? "0 0 12px rgba(0,212,255,0.3)" : "0 1px 4px rgba(0,0,0,0.4)",
        transition: "all 0.18s ease",
        cursor: "pointer",
        position: "relative",
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
          background: methodColor,
          borderRadius: "3px 0 0 3px",
          opacity: 0.7,
        }}
      />

      {/* 方法名 */}
      <div
        style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 10,
          color: methodColor,
          fontWeight: 600,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          paddingLeft: 6,
        }}
      >
        {data.methodName}()
      </div>

      {/* 类名 */}
      <div
        style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 8,
          color: "#6b8aaa",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          paddingLeft: 6,
          marginTop: 2,
        }}
      >
        {data.className}
      </div>

      {/* 类型标签 */}
      <div style={{ display: "flex", gap: 4, marginTop: 4, paddingLeft: 6 }}>
        <Tag
          style={{
            fontSize: 7,
            padding: "0 4px",
            margin: 0,
            background: `${methodColor}22`,
            border: "none",
            color: methodColor,
          }}
        >
          {data.methodType}
        </Tag>
        {data.isEntryPoint && (
          <Tag
            style={{
              fontSize: 7,
              padding: "0 4px",
              margin: 0,
              background: "#00d4ff22",
              border: "none",
              color: "#00d4ff",
            }}
          >
            entry
          </Tag>
        )}
      </div>

      <Handle type="target" position={Position.Top} style={{ background: methodColor, width: 5, height: 5, border: "none", top: -3 }} />
      <Handle type="source" position={Position.Bottom} style={{ background: methodColor, width: 5, height: 5, border: "none", bottom: -3 }} />
    </div>
  );
};

const DatabaseNode: React.FC<{ data: { label: string; id: string } }> = ({ data }) => (
  <div
    style={{
      width: 140,
      height: 44,
      background: "rgba(176,142,255,0.1)",
      border: "1px solid #b08eff55",
      borderRadius: 8,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
    }}
  >
    <DatabaseOutlined style={{ color: "#b08eff", fontSize: 14 }} />
    <span style={{ fontFamily: "'IBM Plex Mono'", fontSize: 10, color: "#b08eff" }}>
      {data.label}
    </span>
  </div>
);

const nodeTypes: NodeTypes = { detail: DetailNode, database: DatabaseNode };

// ─── 主组件 ──────────────────────────────────────────────────────────────────

const DetailView: React.FC<DetailViewProps> = ({
  repoId,
  serviceId,
  serviceName,
  onBack,
}) => {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rawNodes, setRawNodes] = useState<RawNode[]>([]);
  const [rawEdges, setRawEdges] = useState<RawEdge[]>([]);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const { fitView } = useReactFlow();

  // 加载 Service 的详细血缘
  useEffect(() => {
    setLoading(true);
    setError(null);

    // 使用 serviceId 作为起点，获取其调用链
    graphApi
      .getLineageView(repoId, {
        nodeId: serviceId,
        depth: 3,
        direction: "downstream",
        includeCalls: true,
      })
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
  }, [repoId, serviceId]);

  // 构建 ReactFlow 节点和边
  useEffect(() => {
    if (!rawNodes.length) return;

    // 构建节点
    const rfNodes: Node[] = [];

    rawNodes.forEach((n) => {
      if (n.type.toLowerCase() === "function") {
        const parsed = parseFunctionId(n.id);
        const methodType = inferMethodType(n.id);
        const isEntryPoint = n.id === serviceId || n.id.includes(serviceName);

        rfNodes.push({
          id: n.id,
          type: "detail",
          position: { x: 0, y: 0 },
          data: {
            label: n.name || parsed?.methodName || n.id.split(":").pop() || n.id,
            nodeType: n.type,
            methodType,
            className: parsed?.className || "",
            methodName: parsed?.methodName || n.name || "",
            filePath: parsed?.filePath || "",
            lineNumber: n.properties?.line as number | undefined,
            isEntryPoint,
            originalNode: n,
          },
        });
      } else if (["database", "datasource"].includes(n.type.toLowerCase())) {
        rfNodes.push({
          id: n.id,
          type: "database",
          position: { x: 0, y: 0 },
          data: {
            label: n.name || n.id.split(":").pop() || n.id,
            id: n.id,
          },
        });
      }
    });

    // 构建边
    const rfEdges: Edge[] = rawEdges
      .filter((e) => ["calls", "reads", "writes"].includes(e.type))
      .map((e) => {
        const color = EDGE_COLORS[e.type] || "#1e3a4a";
        return {
          id: `${e.from}--${e.type}--${e.to}`,
          source: e.from,
          target: e.to,
          type: "smoothstep",
          animated: true,
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
    const laidNodes = applyDagreLayout(rfNodes, rfEdges);
    setNodes(laidNodes);
    setEdges(rfEdges);

    setTimeout(() => fitView({ padding: 0.15, duration: 300 }), 60);
  }, [rawNodes, rawEdges, serviceId, serviceName, setNodes, setEdges, fitView]);

  // 节点点击
  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (node.type === "database") return;

      const orig = (node.data as DetailNodeData).originalNode;
      setSelectedNode({
        id: orig.id,
        type: orig.type,
        label: orig.name || orig.id.split(":").pop() || orig.id,
        properties: orig.properties || {},
      });
    },
    []
  );

  // 双击返回
  const handleDoubleClick = useCallback(() => {
    onBack();
  }, [onBack]);

  // 计算路径深度
  const maxDepth = useMemo(() => {
    const depths = new Set<number>();
    edges.forEach((e) => {
      const sourceNode = nodes.find((n) => n.id === e.source);
      if (sourceNode && (sourceNode.data as DetailNodeData).isEntryPoint) {
        depths.add(0);
      }
    });
    return Math.max(depths.size, 1);
  }, [nodes, edges]);

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
          加载 {serviceName} 调用链...
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
        <Tooltip title="返回模块视图">
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
            background: "rgba(0,240,132,0.1)",
            border: "1px solid #00f08433",
            borderRadius: 4,
            padding: "6px 12px",
            color: "#00f084",
            fontFamily: "'Syne'",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {serviceName}
        </div>

        {/* 图例 */}
        <div style={{ display: "flex", gap: 8, marginLeft: 8 }}>
          <Tag color="#00d4ff">Controller</Tag>
          <Tag color="#00f084">Service</Tag>
          <Tag color="#ffc145">Repository</Tag>
        </div>

        {/* 统计 */}
        <div
          style={{
            marginLeft: "auto",
            fontFamily: "'IBM Plex Mono'",
            fontSize: 10,
            color: "#3a5a6a",
          }}
        >
          {rawNodes.filter((n) => n.type.toLowerCase() === "function").length} 方法 ·{" "}
          {rawEdges.filter((e) => e.type === "calls").length} 调用
        </div>
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
          nodeColor={(n) => {
            if (n.type === "database") return "#b08eff";
            const methodType = (n.data as DetailNodeData).methodType;
            return getMethodTypeColor(methodType);
          }}
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
    </div>
  );
};

export default DetailView;
