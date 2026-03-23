import React, { useCallback, useEffect, useMemo, useState } from "react";
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
  ReactFlowProvider,
} from "reactflow";
import "reactflow/dist/style.css";
import dagre from "dagre";
import { Input, Button, Tooltip, Spin, Radio, Select, Drawer, Tag, Alert } from "antd";
import {
  SearchOutlined,
  ReloadOutlined,
  ArrowDownOutlined,
  ArrowUpOutlined,
  WarningOutlined,
  CheckCircleOutlined,
  ApartmentOutlined,
  ShareAltOutlined,
  AimOutlined,
} from "@ant-design/icons";
import { useGraphStore } from "../../store/graphStore";
import { useRepoStore } from "../../store/repoStore";
import NodeDetailPanel from "../../components/NodeDetailPanel";
import EdgeDetailPanel from "../../components/EdgeDetailPanel";
import RepoSelector from "../../components/ui/RepoSelector";
import { graphApi } from "../../api/graphApi";
import type { GraphNode, GraphEdge } from "../../types/graph";
import type { ImpactAnalysisResponse } from "../../types/api";
import { forceLayout, radialLayout } from "../../utils/graphLayout";

// ─── View modes & Direction ───────────────────────────────────────────────────

type ViewMode = "module" | "lineage";
type LineageDirection = "downstream" | "upstream" | "both";
type LayoutType = "dagre" | "force" | "radial";

// ─── Node / edge styling ──────────────────────────────────────────────────────

const NODE_COLORS: Record<
  string,
  { bg: string; border: string; text: string }
> = {
  repository: {
    bg: "rgba(0,212,255,0.08)",
    border: "#00d4ff44",
    text: "#00d4ff",
  },
  module: {
    bg: "rgba(176,142,255,0.08)",
    border: "#b08eff44",
    text: "#b08eff",
  },
  file: { bg: "rgba(0,240,132,0.06)", border: "#00f08433", text: "#00f084" },
  class: { bg: "rgba(255,193,69,0.07)", border: "#ffc14533", text: "#ffc145" },
  function: {
    bg: "rgba(255,107,107,0.07)",
    border: "#ff6b6b33",
    text: "#ff6b6b",
  },
  api: { bg: "rgba(0,212,255,0.08)", border: "#00d4ff44", text: "#00d4ff" },
  apiendpoint: { bg: "rgba(0,212,255,0.12)", border: "#00d4ff88", text: "#00d4ff" },
  database: {
    bg: "rgba(176,142,255,0.1)",
    border: "#b08eff55",
    text: "#b08eff",
  },
  datasource: { bg: "rgba(176,142,255,0.12)", border: "#b08eff88", text: "#b08eff" },
  table: { bg: "rgba(176,142,255,0.07)", border: "#b08eff33", text: "#b08eff" },
  service: { bg: "rgba(0,240,132,0.08)", border: "#00f08444", text: "#00f084" },
  topic: { bg: "rgba(255,107,107,0.1)", border: "#ff6b6b55", text: "#ff6b6b" },
  _default: { bg: "rgba(30,45,61,0.5)", border: "#1e2d3d", text: "#6b8aaa" },
};

const EDGE_COLORS: Record<string, string> = {
  contains: "#1e3a4a",
  imports: "#b08eff66",
  calls: "#00f08466",
  reads: "#00d4ff66",
  writes: "#ffc14566",
  depends_on: "#b08eff55",
  produces: "#00f08455",
  consumes: "#ff6b6b55",
  flow_to: "#00d4ff77",
  queries: "#b08eff77",
  transforms: "#ffc14577",
};

function getNodeStyle(type: string) {
  const t = type.toLowerCase();
  return NODE_COLORS[t] ?? NODE_COLORS._default;
}

// ─── Node dimensions by type ──────────────────────────────────────────────────

function getNodeDims(type: string): { w: number; h: number } {
  const t = type.toLowerCase();
  if (t === "repository") return { w: 180, h: 52 };
  if (t === "module") return { w: 160, h: 44 };
  if (t === "file") return { w: 170, h: 40 };
  if (t === "class") return { w: 155, h: 40 };
  if (t === "database" || t === "datasource") return { w: 150, h: 48 };
  if (t === "apiendpoint") return { w: 180, h: 44 };
  if (t === "topic") return { w: 140, h: 40 };
  return { w: 160, h: 40 };
}

// ─── Layout functions ─────────────────────────────────────────────────────────

function applyDagreLayout(
  nodes: Node[],
  edges: Edge[],
  direction: "TB" | "LR" | "BT" = "TB",
): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    nodesep: 36,
    ranksep: 70,
    marginx: 20,
    marginy: 20,
  });
  nodes.forEach((n) => {
    const dims = getNodeDims((n.data as LineageNodeData).nodeType);
    g.setNode(n.id, { width: dims.w, height: dims.h });
  });
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);
  return nodes.map((n) => {
    const dims = getNodeDims((n.data as LineageNodeData).nodeType);
    const pos = g.node(n.id);
    return { ...n, position: { x: pos.x - dims.w / 2, y: pos.y - dims.h / 2 } };
  });
}

function applyForceLayout(
  nodes: Node[],
  edges: Edge[],
  width: number = 1200,
  height: number = 800,
): Node[] {
  const graphNodes = nodes.map((n) => ({
    id: n.id,
    type: (n.data as LineageNodeData).nodeType,
    label: (n.data as LineageNodeData).label,
    properties: (n.data as LineageNodeData).originalNode.properties,
  }));
  const graphEdges = edges.map((e) => ({
    source: e.source,
    target: e.target,
    type: e.label as string ?? "unknown",
  }));

  const result = forceLayout(graphNodes, graphEdges, { width, height, iterations: 200 });

  return nodes.map((n) => {
    const pos = result.nodes.get(n.id) ?? { x: width / 2, y: height / 2 };
    return { ...n, position: pos };
  });
}

function applyRadialLayout(
  nodes: Node[],
  edges: Edge[],
  centerId: string | null,
  width: number = 1200,
  height: number = 800,
): Node[] {
  const graphNodes = nodes.map((n) => ({
    id: n.id,
    type: (n.data as LineageNodeData).nodeType,
    label: (n.data as LineageNodeData).label,
    properties: (n.data as LineageNodeData).originalNode.properties,
  }));
  const graphEdges = edges.map((e) => ({
    source: e.source,
    target: e.target,
    type: e.label as string ?? "unknown",
  }));

  const result = radialLayout(graphNodes, graphEdges, {
    width,
    height,
    centerId: centerId ?? undefined,
  });

  return nodes.map((n) => {
    const pos = result.nodes.get(n.id) ?? { x: width / 2, y: height / 2 };
    return { ...n, position: pos };
  });
}

function applyLayout(
  nodes: Node[],
  edges: Edge[],
  layoutType: LayoutType,
  direction: "TB" | "LR" | "BT" = "TB",
  centerId: string | null = null,
): Node[] {
  switch (layoutType) {
    case "force":
      return applyForceLayout(nodes, edges);
    case "radial":
      return applyRadialLayout(nodes, edges, centerId);
    case "dagre":
    default:
      return applyDagreLayout(nodes, edges, direction);
  }
}

// ─── Node data type ───────────────────────────────────────────────────────────

type LineageNodeData = {
  label: string;
  nodeType: string;
  isHighlighted: boolean;
  isDimmed: boolean;
  isSelected: boolean;
  originalNode: GraphNode;
};

// ─── Custom node component ────────────────────────────────────────────────────

const LineageNode: React.FC<{ data: LineageNodeData }> = ({ data }) => {
  const style = getNodeStyle(data.nodeType);
  const dims = getNodeDims(data.nodeType);
  const isRepo = data.nodeType.toLowerCase() === "repository";
  const isModule = data.nodeType.toLowerCase() === "module";
  const isDataSource = ["database", "datasource", "topic"].includes(data.nodeType.toLowerCase());

  return (
    <div
      style={{
        width: dims.w,
        height: dims.h,
        background: data.isDimmed
          ? "rgba(7,9,13,0.3)"
          : data.isSelected
            ? style.bg
            : "rgba(10,15,22,0.88)",
        border: `1px solid ${
          data.isSelected
            ? style.border.replace("44", "aa").replace("33", "88").replace("55", "aa")
            : data.isHighlighted
              ? style.border
              : data.isDimmed
                ? "#0d1520"
                : "#1a2535"
        }`,
        borderRadius: isRepo ? 6 : isModule ? 4 : isDataSource ? 8 : 3,
        display: "flex",
        alignItems: "center",
        padding: "0 10px",
        gap: 8,
        boxShadow: data.isSelected
          ? `0 0 16px ${style.border}88, 0 2px 8px rgba(0,0,0,0.5)`
          : "0 1px 4px rgba(0,0,0,0.4)",
        opacity: data.isDimmed ? 0.2 : 1,
        transition: "all 0.18s ease",
        cursor: "pointer",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Type indicator strip */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          background: data.isDimmed ? "#0d1520" : style.text,
          borderRadius: "3px 0 0 3px",
          opacity: data.isDimmed ? 0.3 : 0.7,
        }}
      />

      <div style={{ paddingLeft: 4, flex: 1, overflow: "hidden" }}>
        <div
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 10,
            color: data.isDimmed ? "#1e2d3d" : style.text,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontWeight: isRepo || isModule ? 600 : 400,
          }}
        >
          {data.label}
        </div>
        <div
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 8,
            color: data.isDimmed ? "#111820" : "#3a5a6a",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            marginTop: 1,
          }}
        >
          {data.nodeType.toLowerCase()}
        </div>
      </div>

      <Handle
        type="target"
        position={Position.Top}
        style={{
          background: style.text,
          width: 5,
          height: 5,
          border: "none",
          top: -3,
        }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        style={{
          background: style.text,
          width: 5,
          height: 5,
          border: "none",
          bottom: -3,
        }}
      />
      <Handle
        type="target"
        position={Position.Left}
        style={{
          background: style.text,
          width: 5,
          height: 5,
          border: "none",
          left: -3,
        }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{
          background: style.text,
          width: 5,
          height: 5,
          border: "none",
          right: -3,
        }}
      />
    </div>
  );
};

const nodeTypes: NodeTypes = { lineage: LineageNode };

// ─── Impact Panel Component ──────────────────────────────────────────────────

type ImpactPanelProps = {
  impactData: ImpactAnalysisResponse | null;
  onClose: () => void;
  onNodeClick: (nodeId: string) => void;
};

const ImpactPanel: React.FC<ImpactPanelProps> = ({ impactData, onClose, onNodeClick }) => {
  if (!impactData) return null;

  const riskConfig = {
    low: { color: "#00f084", bg: "rgba(0,240,132,0.1)", icon: <CheckCircleOutlined /> },
    medium: { color: "#ffc145", bg: "rgba(255,193,69,0.1)", icon: <WarningOutlined /> },
    high: { color: "#ff6b6b", bg: "rgba(255,107,107,0.1)", icon: <WarningOutlined /> },
  };

  const config = riskConfig[impactData.risk_level];

  return (
    <Drawer
      title={
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: config.color }}>{config.icon}</span>
          <span>变更影响评估</span>
        </div>
      }
      placement="right"
      width={420}
      onClose={onClose}
      open={!!impactData}
      styles={{
        header: { background: "#0d1520", borderBottom: "1px solid #1a2535" },
        body: { background: "#07090d", padding: 16 },
      }}
    >
      {/* Risk Level */}
      <div
        style={{
          background: config.bg,
          border: `1px solid ${config.color}44`,
          borderRadius: 6,
          padding: 12,
          marginBottom: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ color: "#8ab4c8", fontFamily: "'IBM Plex Mono'", fontSize: 11 }}>
            风险等级
          </span>
          <Tag
            color={impactData.risk_level === "high" ? "error" : impactData.risk_level === "medium" ? "warning" : "success"}
            style={{ fontFamily: "'IBM Plex Mono'", fontWeight: 600 }}
          >
            {impactData.risk_level.toUpperCase()}
          </Tag>
        </div>
        <div style={{ color: config.color, fontFamily: "'Syne'", fontSize: 18, fontWeight: 700, marginTop: 4 }}>
          {impactData.changed_node_id.split(":").pop()}
        </div>
        <div style={{ color: "#6b8aaa", fontFamily: "'IBM Plex Mono'", fontSize: 10, marginTop: 2 }}>
          变更类型: {impactData.change_type}
        </div>
      </div>

      {/* Impact Summary */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ color: "#8ab4c8", fontFamily: "'IBM Plex Mono'", fontSize: 10, marginBottom: 8, letterSpacing: "0.1em" }}>
          影响统计
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {[
            { label: "受影响节点", value: impactData.impact_summary.total_affected, color: "#b08eff" },
            { label: "服务", value: impactData.impact_summary.services, color: "#00f084" },
            { label: "API 端点", value: impactData.impact_summary.api_endpoints, color: "#00d4ff" },
            { label: "数据库", value: impactData.impact_summary.databases, color: "#ffc145" },
          ].map((item) => (
            <div
              key={item.label}
              style={{
                background: "rgba(10,15,22,0.6)",
                border: "1px solid #1a2535",
                borderRadius: 4,
                padding: 8,
              }}
            >
              <div style={{ color: item.color, fontFamily: "'IBM Plex Mono'", fontSize: 18, fontWeight: 700 }}>
                {item.value}
              </div>
              <div style={{ color: "#6b8aaa", fontFamily: "'IBM Plex Mono'", fontSize: 9 }}>{item.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Affected APIs */}
      {impactData.affected_apis.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ color: "#8ab4c8", fontFamily: "'IBM Plex Mono'", fontSize: 10, marginBottom: 8, letterSpacing: "0.1em" }}>
            受影响的 API
          </div>
          {impactData.affected_apis.slice(0, 5).map((api) => (
            <div
              key={api.id}
              onClick={() => onNodeClick(api.id)}
              style={{
                background: "rgba(0,212,255,0.05)",
                border: "1px solid #00d4ff33",
                borderRadius: 4,
                padding: "6px 10px",
                marginBottom: 6,
                cursor: "pointer",
              }}
            >
              <div style={{ color: "#00d4ff", fontFamily: "'IBM Plex Mono'", fontSize: 10 }}>
                {api.name}
              </div>
              <div style={{ color: "#6b8aaa", fontFamily: "'IBM Plex Mono'", fontSize: 9 }}>
                {api.path}
              </div>
            </div>
          ))}
          {impactData.affected_apis.length > 5 && (
            <div style={{ color: "#6b8aaa", fontFamily: "'IBM Plex Mono'", fontSize: 9, textAlign: "center" }}>
              还有 {impactData.affected_apis.length - 5} 个...
            </div>
          )}
        </div>
      )}

      {/* Recommendations */}
      <div>
        <div style={{ color: "#8ab4c8", fontFamily: "'IBM Plex Mono'", fontSize: 10, marginBottom: 8, letterSpacing: "0.1em" }}>
          建议
        </div>
        {impactData.recommendations.map((rec, i) => (
          <Alert
            key={i}
            message={rec}
            type={rec.startsWith("⚠️") ? "warning" : rec.startsWith("✅") ? "success" : "info"}
            showIcon
            style={{
              marginBottom: 8,
              background: "rgba(10,15,22,0.6)",
              border: "1px solid #1a2535",
            }}
          />
        ))}
      </div>
    </Drawer>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

const DataLineageInner: React.FC = () => {
  const {
    moduleGraph,
    lineageGraph,
    loadModuleGraph,
    loadLineage,
    setSelectedNode,
  } = useGraphStore();
  const { activeRepo } = useRepoStore();
  const { fitView } = useReactFlow();

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("lineage");
  const [direction, setDirection] = useState<LineageDirection>("downstream");
  const [layoutType, setLayoutType] = useState<LayoutType>("dagre");
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [panelNode, setPanelNode] = useState<GraphNode | null>(null);
  const [panelEdge, setPanelEdge] = useState<GraphEdge | null>(null);
  const [impactData, setImpactData] = useState<ImpactAnalysisResponse | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  // Future feature: trace lineage
  // const [traceData, setTraceData] = useState<TraceLineageResponse | null>(null);

  // Load module graph once when repo changes
  useEffect(() => {
    if (!activeRepo?.repoId) return;
    loadModuleGraph(activeRepo.repoId);
  }, [activeRepo?.repoId]);

  // Load lineage data based on focusNodeId
  useEffect(() => {
    if (!activeRepo?.repoId || viewMode !== "lineage") return;

    // Set loading state
    useGraphStore.setState({
      lineageGraph: { data: null, loading: true, error: null },
    });

    if (focusNodeId) {
      // Load subgraph for specific node
      graphApi.getLineageView(activeRepo.repoId, {
        nodeId: focusNodeId,
        depth: 3,
        direction: direction,
      }).then((res) => {
        const graph = {
          nodes: res.nodes.map((n) => ({
            id: n.id,
            type: n.type,
            label: n.name || n.id.split(":").pop() || n.id,
            properties: n.properties || {},
          })),
          edges: res.edges.map((e) => ({
            source: e.from,
            target: e.to,
            type: e.type,
            properties: e.properties || {},
          })),
        };
        console.log('[DataLineage] Loaded subgraph for node:', focusNodeId, 'nodes:', graph.nodes.length, 'edges:', graph.edges.length);
        useGraphStore.setState({
          lineageGraph: { data: graph, loading: false, error: null },
        });
      }).catch((err) => {
        useGraphStore.setState({
          lineageGraph: { data: null, loading: false, error: String(err) },
        });
      });
    } else {
      // Load full lineage graph
      loadLineage(activeRepo.repoId);
    }
  }, [activeRepo?.repoId, viewMode, focusNodeId, direction]);

  // Pick data source based on view mode
  const activeSlice = viewMode === "module" ? moduleGraph : lineageGraph;
  const rawData = activeSlice.data;

  // Build ReactFlow graph
  useEffect(() => {
    if (!rawData) return;

    const searchLower = searchQuery.toLowerCase();
    const matchIds = searchQuery
      ? new Set(
          rawData.nodes
            .filter((n) => (n.label ?? "").toLowerCase().includes(searchLower))
            .map((n) => n.id),
        )
      : null;

    const rfNodes: Node<LineageNodeData>[] = rawData.nodes.map((n) => ({
      id: n.id,
      type: "lineage",
      position: { x: 0, y: 0 },
      data: {
        label: n.label,
        nodeType: n.type,
        isHighlighted: matchIds ? matchIds.has(n.id) : false,
        isDimmed: matchIds ? matchIds.size > 0 && !matchIds.has(n.id) : false,
        isSelected: n.id === focusNodeId,
        originalNode: n,
      },
    }));

    const visibleNodeIds = new Set(rfNodes.map((n) => n.id));
    const rfEdges: Edge[] = rawData.edges
      .filter(
        (e) => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target),
      )
      .map((e) => {
        const color = EDGE_COLORS[e.type] ?? "#1a2535";
        const isFocused =
          focusNodeId && (e.source === focusNodeId || e.target === focusNodeId);
        return {
          id: `${e.source}--${e.type}--${e.target}`,
          source: e.source,
          target: e.target,
          type: "smoothstep",
          animated: e.type === "flow_to" && !!isFocused,
          label: !["contains", "depends_on"].includes(e.type) ? e.type : undefined,
          labelStyle: {
            fontFamily: "'IBM Plex Mono'",
            fontSize: 8,
            fill: color
              .replace("66", "cc")
              .replace("55", "cc")
              .replace("44", "cc")
              .replace("77", "cc"),
          },
          labelBgStyle: { fill: "#07090d", fillOpacity: 0.85 },
          style: {
            stroke: isFocused
              ? color
                  .replace("66", "cc")
                  .replace("55", "cc")
                  .replace("44", "cc")
                  .replace("77", "cc")
              : color,
            strokeWidth: isFocused ? 2 : e.type === "contains" ? 1 : 1.5,
            strokeDasharray: e.type === "imports" ? "4 3" : undefined,
            opacity: matchIds && matchIds.size > 0 && !isFocused ? 0.15 : 0.8,
            cursor: "pointer",
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: color
              .replace("66", "cc")
              .replace("55", "cc")
              .replace("44", "cc")
              .replace("77", "cc"),
            width: 8,
            height: 8,
          },
          // Store original edge data for edge click handling
          data: { originalEdge: e },
        };
      });

    const layoutDirection = viewMode === "lineage" && direction === "upstream" ? "BT" : "LR";
    const dagreDirection = viewMode === "module" ? "TB" : layoutDirection;
    const laid = applyLayout(rfNodes, rfEdges, layoutType, dagreDirection, focusNodeId);
    setNodes(laid);
    setEdges(rfEdges);
    setTimeout(() => fitView({ padding: 0.1, duration: 450 }), 60);
  }, [rawData, searchQuery, focusNodeId, viewMode, direction, layoutType]);

  // Run impact analysis
  const runImpactAnalysis = useCallback(async (nodeId: string) => {
    if (!activeRepo?.repoId) return;
    setImpactLoading(true);
    try {
      const result = await graphApi.analyzeImpact({
        repo_id: activeRepo.repoId,
        node_id: nodeId,
        change_type: "modify",
      });
      setImpactData(result);
    } catch (err) {
      console.error("Impact analysis failed:", err);
    } finally {
      setImpactLoading(false);
    }
  }, [activeRepo?.repoId]);

  // Future feature: Run trace
  // const runTrace = useCallback(async (nodeId: string) => {
  //   if (!activeRepo?.repoId) return;
  //   try {
  //     const result = await graphApi.traceLineage({
  //       repo_id: activeRepo.repoId,
  //       node_id: nodeId,
  //       trace_type: "source",
  //     });
  //     setTraceData(result);
  //   } catch (err) {
  //     console.error("Trace failed:", err);
  //   }
  // }, [activeRepo?.repoId]);

  const onNodeClick = useCallback(
    (evt: React.MouseEvent, node: Node<LineageNodeData>) => {
      // 忽略双击时的单击事件（detail > 1 表示双击或多击）
      if (evt.detail > 1) return;

      const orig = node.data.originalNode;

      // 在子图模式下点击不同节点，切换到新节点的子图
      setFocusNodeId(orig.id);
      setPanelNode(orig);
      setSelectedNode(orig);
      setPanelEdge(null); // Close edge panel if open

      // Auto-run impact analysis for Service nodes
      if (viewMode === "lineage" && ["Service", "service"].includes(orig.type)) {
        runImpactAnalysis(orig.id);
      }
    },
    [viewMode, runImpactAnalysis],
  );

  // Edge click handler
  const onEdgeClick = useCallback(
    (evt: React.MouseEvent, edge: Edge) => {
      evt.stopPropagation();
      const origEdge = rawData?.edges.find(
        (e) => `${e.source}--${e.type}--${e.target}` === edge.id
      );
      if (origEdge) {
        setPanelEdge(origEdge);
        setPanelNode(null); // Close node panel if open
      }
    },
    [rawData],
  );

  // 双击节点回到主图
  const onNodeDoubleClick = useCallback(
    () => {
      setFocusNodeId(null);
      setPanelNode(null);
      setSelectedNode(null);
      setImpactData(null);
      setPanelEdge(null);
    },
    [],
  );

  const handleReset = () => {
    setFocusNodeId(null);
    setPanelNode(null);
    setSelectedNode(null);
    setSearchQuery("");
    setImpactData(null);
    // setTraceData(null); // Future feature
    setTimeout(() => fitView({ padding: 0.1, duration: 450 }), 60);
  };

  // Node select options
  const nodeOptions = useMemo(() => {
    if (!rawData) return [];
    return rawData.nodes
      .filter((n) => ["Service", "service", "Repository", "repository", "Component", "component"].includes(n.type))
      .map((n) => ({
        value: n.id,
        label: `${n.label} (${n.type})`,
      }));
  }, [rawData]);

  const nodeCount = rawData?.nodes.length ?? 0;
  const edgeCount = rawData?.edges.length ?? 0;
  const isLoading = activeSlice.loading;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "#07090d",
      }}
    >
      {/* ── Toolbar ──────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "10px 16px",
          borderBottom: "1px solid #0d1a24",
          background: "rgba(7,9,13,0.97)",
          backdropFilter: "blur(12px)",
          flexShrink: 0,
          flexWrap: "wrap",
        }}
      >
        {/* Title */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 7,
              height: 7,
              borderRadius: 1,
              background: "#b08eff",
              boxShadow: "0 0 10px #b08effaa",
            }}
          />
          <span
            style={{
              fontFamily: "'Syne', sans-serif",
              fontSize: 12,
              fontWeight: 700,
              color: "#b08eff",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }}
          >
            {viewMode === "module" ? "模块结构" : "数据血缘"}
          </span>
        </div>

        {/* View mode toggle */}
        <Radio.Group
          value={viewMode}
          onChange={(e) => {
            setViewMode(e.target.value);
            setFocusNodeId(null);
            setImpactData(null);
          }}
          size="small"
          style={{ fontFamily: "'IBM Plex Mono'" }}
        >
          <Radio.Button
            value="module"
            style={{ fontFamily: "'IBM Plex Mono'", fontSize: 10 }}
          >
            模块图
          </Radio.Button>
          <Radio.Button
            value="lineage"
            style={{ fontFamily: "'IBM Plex Mono'", fontSize: 10 }}
          >
            血缘图
          </Radio.Button>
        </Radio.Group>

        {/* Direction toggle (only for lineage mode) */}
        {viewMode === "lineage" && (
          <Radio.Group
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
            size="small"
            style={{ fontFamily: "'IBM Plex Mono'" }}
          >
            <Radio.Button
              value="downstream"
              style={{ fontFamily: "'IBM Plex Mono'", fontSize: 10 }}
            >
              <ArrowDownOutlined /> 下游
            </Radio.Button>
            <Radio.Button
              value="upstream"
              style={{ fontFamily: "'IBM Plex Mono'", fontSize: 10 }}
            >
              <ArrowUpOutlined /> 上游
            </Radio.Button>
            <Radio.Button
              value="both"
              style={{ fontFamily: "'IBM Plex Mono'", fontSize: 10 }}
            >
              双向
            </Radio.Button>
          </Radio.Group>
        )}

        {/* Layout selector */}
        <Select
          value={layoutType}
          onChange={(val) => setLayoutType(val)}
          size="small"
          style={{ width: 110 }}
          options={[
            { value: "dagre", label: <span><ApartmentOutlined style={{ marginRight: 4 }} />分层</span> },
            { value: "force", label: <span><ShareAltOutlined style={{ marginRight: 4 }} />力导向</span> },
            { value: "radial", label: <span><AimOutlined style={{ marginRight: 4 }} />径向</span> },
          ]}
        />

        {/* Repository selector */}
        <RepoSelector showStats={false} width={200} />

        {/* Node selector for lineage trace */}
        {viewMode === "lineage" && (
          <Tooltip title={focusNodeId ? "双击节点返回全图" : "选择节点查看血缘子图"}>
            <Select
              placeholder="选择起点节点..."
              value={focusNodeId}
              onChange={(val) => setFocusNodeId(val)}
              options={nodeOptions}
              showSearch
              allowClear
              style={{ width: 220 }}
              size="small"
              filterOption={(input, option) =>
                (option?.label ?? "").toLowerCase().includes(input.toLowerCase())
              }
            />
          </Tooltip>
        )}

        {/* Stats */}
        <div style={{ display: "flex", gap: 16, marginRight: "auto" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
            <span
              style={{
                fontFamily: "'IBM Plex Mono'",
                fontSize: 15,
                fontWeight: 700,
                color: "#b08eff",
              }}
            >
              {nodeCount.toLocaleString()}
            </span>
            <span
              style={{
                fontFamily: "'IBM Plex Mono'",
                fontSize: 9,
                color: "#3a5a6a",
                letterSpacing: "0.1em",
              }}
            >
              节点
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
            <span
              style={{
                fontFamily: "'IBM Plex Mono'",
                fontSize: 15,
                fontWeight: 700,
                color: "#00d4ff",
              }}
            >
              {edgeCount.toLocaleString()}
            </span>
            <span
              style={{
                fontFamily: "'IBM Plex Mono'",
                fontSize: 9,
                color: "#3a5a6a",
                letterSpacing: "0.1em",
              }}
            >
              关系
            </span>
          </div>
        </div>

        {/* Search */}
        <Input
          prefix={<SearchOutlined style={{ color: "#2a4a5a", fontSize: 11 }} />}
          placeholder="搜索节点..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            width: 160,
            background: "#080e16",
            border: "1px solid #1a2535",
            borderRadius: 3,
            color: "#8ab4c8",
            fontFamily: "'IBM Plex Mono'",
            fontSize: 11,
          }}
          allowClear
        />

        <Tooltip title="重置视图">
          <Button
            icon={<ReloadOutlined />}
            onClick={handleReset}
            size="small"
            style={{
              background: "#080e16",
              border: "1px solid #1a2535",
              color: "#2a4a5a",
            }}
          />
        </Tooltip>
      </div>

      {/* ── Graph canvas ─────────────────────────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          display: "flex",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {isLoading && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(7,9,13,0.85)",
              zIndex: 10,
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
              {viewMode === "module" ? "加载模块结构..." : "加载数据血缘..."}
            </span>
          </div>
        )}

        {!activeRepo && !isLoading && (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 40, opacity: 0.06, marginBottom: 12 }}>
                ◈
              </div>
              <div
                style={{
                  fontFamily: "'IBM Plex Mono'",
                  fontSize: 11,
                  color: "#2a4a6a",
                  letterSpacing: "0.1em",
                }}
              >
                请从顶栏选择一个仓库
              </div>
            </div>
          </div>
        )}

        {activeRepo && !isLoading && (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            onNodeDoubleClick={onNodeDoubleClick}
            onEdgeClick={onEdgeClick}
            nodeTypes={nodeTypes}
            fitView
            minZoom={0.06}
            maxZoom={3}
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
              nodeColor={(n) =>
                getNodeStyle((n.data as LineageNodeData).nodeType).text
              }
              maskColor="rgba(7,9,13,0.75)"
            />
          </ReactFlow>
        )}

        {panelNode && (
          <NodeDetailPanel
            node={panelNode}
            edges={rawData?.edges}
            allNodes={rawData?.nodes}
            onClose={() => {
              setPanelNode(null);
              setSelectedNode(null);
              // 不要清除 focusNodeId，保持在当前子图
            }}
          />
        )}

        {panelEdge && (
          <EdgeDetailPanel
            edge={panelEdge}
            allNodes={rawData?.nodes}
            onClose={() => setPanelEdge(null)}
          />
        )}
      </div>

      {/* Impact Analysis Panel */}
      <ImpactPanel
        impactData={impactData}
        onClose={() => setImpactData(null)}
        onNodeClick={(nodeId) => {
          setFocusNodeId(nodeId);
          const node = rawData?.nodes.find((n) => n.id === nodeId);
          if (node) {
            setPanelNode(node);
            setSelectedNode(node);
          }
        }}
      />

      {/* Loading overlay for impact analysis */}
      {impactLoading && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(7,9,13,0.6)",
            zIndex: 100,
          }}
        >
          <Spin size="large" />
        </div>
      )}
    </div>
  );
};

const DataLineage: React.FC = () => (
  <ReactFlowProvider>
    <DataLineageInner />
  </ReactFlowProvider>
);

export default DataLineage;
