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
import { Input, Button, Tooltip, Spin, Radio } from "antd";
import { SearchOutlined, ReloadOutlined } from "@ant-design/icons";
import { useGraphStore } from "../../store/graphStore";
import { useRepoStore } from "../../store/repoStore";
import NodeDetailPanel from "../../components/NodeDetailPanel";
import type { GraphNode } from "../../types/graph";

// ─── View modes ───────────────────────────────────────────────────────────────

type ViewMode = "module" | "lineage";

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
  database: {
    bg: "rgba(176,142,255,0.1)",
    border: "#b08eff55",
    text: "#b08eff",
  },
  table: { bg: "rgba(176,142,255,0.07)", border: "#b08eff33", text: "#b08eff" },
  service: { bg: "rgba(0,240,132,0.08)", border: "#00f08444", text: "#00f084" },
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
  if (t === "database") return { w: 150, h: 48 };
  return { w: 160, h: 40 };
}

// ─── Dagre layout ─────────────────────────────────────────────────────────────

function applyDagreLayout(
  nodes: Node[],
  edges: Edge[],
  direction: "TB" | "LR" = "TB",
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
            ? style.border.replace("44", "aa").replace("33", "88")
            : data.isHighlighted
              ? style.border
              : data.isDimmed
                ? "#0d1520"
                : "#1a2535"
        }`,
        borderRadius: isRepo ? 6 : isModule ? 4 : 3,
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

// ─── Edge type legend ─────────────────────────────────────────────────────────

const LEGEND_ITEMS: { type: string; label: string }[] = [
  { type: "contains", label: "包含" },
  { type: "imports", label: "导入" },
  { type: "reads", label: "读取" },
  { type: "writes", label: "写入" },
  { type: "calls", label: "调用" },
];

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
  const [viewMode, setViewMode] = useState<ViewMode>("module");
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [panelNode, setPanelNode] = useState<GraphNode | null>(null);

  useEffect(() => {
    if (!activeRepo?.graphId) return;
    loadModuleGraph(activeRepo.graphId);
    loadLineage(activeRepo.graphId);
  }, [activeRepo?.graphId]);

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
          animated: e.type === "imports" && !!isFocused,
          label: e.type !== "contains" ? e.type : undefined,
          labelStyle: {
            fontFamily: "'IBM Plex Mono'",
            fontSize: 8,
            fill: color
              .replace("66", "cc")
              .replace("55", "cc")
              .replace("44", "cc"),
          },
          labelBgStyle: { fill: "#07090d", fillOpacity: 0.85 },
          style: {
            stroke: isFocused
              ? color
                  .replace("66", "cc")
                  .replace("55", "cc")
                  .replace("44", "cc")
              : color,
            strokeWidth: isFocused ? 2 : e.type === "contains" ? 1 : 1.5,
            strokeDasharray: e.type === "imports" ? "4 3" : undefined,
            opacity: matchIds && matchIds.size > 0 && !isFocused ? 0.15 : 0.8,
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: color
              .replace("66", "cc")
              .replace("55", "cc")
              .replace("44", "cc"),
            width: 8,
            height: 8,
          },
        };
      });

    const direction = viewMode === "module" ? "TB" : "LR";
    const laid = applyDagreLayout(rfNodes, rfEdges, direction);
    setNodes(laid);
    setEdges(rfEdges);
    setTimeout(() => fitView({ padding: 0.1, duration: 450 }), 60);
  }, [rawData, searchQuery, focusNodeId, viewMode]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node<LineageNodeData>) => {
      const orig = node.data.originalNode;
      if (focusNodeId === orig.id) {
        setFocusNodeId(null);
        setPanelNode(null);
        setSelectedNode(null);
      } else {
        setFocusNodeId(orig.id);
        setPanelNode(orig);
        setSelectedNode(orig);
      }
    },
    [focusNodeId],
  );

  const handleReset = () => {
    setFocusNodeId(null);
    setPanelNode(null);
    setSelectedNode(null);
    setSearchQuery("");
    setTimeout(() => fitView({ padding: 0.1, duration: 450 }), 60);
  };

  // Edge type counts for legend
  const edgeCounts = useMemo(() => {
    if (!rawData) return {};
    const counts: Record<string, number> = {};
    rawData.edges.forEach((e) => {
      counts[e.type] = (counts[e.type] ?? 0) + 1;
    });
    return counts;
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

        {/* Edge type legend */}
        <div style={{ display: "flex", gap: 10 }}>
          {LEGEND_ITEMS.filter(({ type }) => edgeCounts[type] > 0).map(
            ({ type, label }) => (
              <div
                key={type}
                style={{ display: "flex", alignItems: "center", gap: 4 }}
              >
                <div
                  style={{
                    width: 16,
                    height: 1.5,
                    background:
                      EDGE_COLORS[type]
                        ?.replace("66", "cc")
                        .replace("55", "cc")
                        .replace("44", "cc") ?? "#3a5a6a",
                    borderRadius: 1,
                  }}
                />
                <span
                  style={{
                    fontFamily: "'IBM Plex Mono'",
                    fontSize: 9,
                    color: "#3a5a6a",
                  }}
                >
                  {label} ({edgeCounts[type] ?? 0})
                </span>
              </div>
            ),
          )}
        </div>

        {/* Search */}
        <Input
          prefix={<SearchOutlined style={{ color: "#2a4a5a", fontSize: 11 }} />}
          placeholder="搜索节点..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            width: 180,
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
                color: "#2a4a5a",
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
                  color: "#2a4a5a",
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
              setFocusNodeId(null);
              setSelectedNode(null);
            }}
          />
        )}
      </div>
    </div>
  );
};

const DataLineage: React.FC = () => (
  <ReactFlowProvider>
    <DataLineageInner />
  </ReactFlowProvider>
);

export default DataLineage;
