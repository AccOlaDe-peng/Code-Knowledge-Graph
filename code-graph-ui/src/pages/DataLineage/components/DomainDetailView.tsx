/**
 * DomainDetailView - 领域子图视图组件。
 *
 * 展示领域内的节点和数据流向，支持：
 * - 详细度滑块（简洁/标准/详细）
 * - 核心路径过滤
 * - 节点点击查看信息
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
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeTypes,
  useReactFlow,
} from "reactflow";
import "reactflow/dist/style.css";
import dagre from "dagre";
import { Tag, Button, Tooltip } from "antd";
import {
  ApartmentOutlined,
  ShareAltOutlined,
  ArrowLeftOutlined,
  AppstoreOutlined,
} from "@ant-design/icons";
import DomainInfoPanel from "./DomainInfoPanel";
import {
  filterCorePathNodes,
  calculateNodeStats,
  type DetailLevel,
  type FilteredGraphData,
} from "../utils/domainFilter";
import type { RawNode, RawEdge } from "../../../api/graphApi";
import type {
  DomainInfo,
  NodeDetail,
} from "../../../store/lineageStore";
import { domainApi } from "../../../api/domainApi";

// ─── 类型定义 ────────────────────────────────────────────────────────────────

interface DomainDetailViewProps {
  repoId: string;
  domain: DomainInfo;
  allNodes: RawNode[];
  allEdges: RawEdge[];
  onBack: () => void;
  onNodeClick?: (nodeId: string) => void;
}

// ─── 节点类型注册 ────────────────────────────────────────────────────────────

// 简单节点组件
const SimpleNode: React.FC<{
  data: {
    node: RawNode;
    callCount: number;
    calledByCount: number;
    isSelected?: boolean;
  };
}> = ({ data }) => {
  const { node, callCount, calledByCount, isSelected } = data;
  const nodeType = node.type.toLowerCase(); // 统一转换为小写比较

  // 节点颜色
  const getNodeColor = () => {
    switch (nodeType) {
      case "controller":
      case "apiendpoint":
        return "#00d4ff";
      case "service":
        return "#00f084";
      case "repository":
      case "dao":
        return "#ffc145";
      case "function":
        return "#b08eff";
      default:
        return "#8ab4c8";
    }
  };

  const color = getNodeColor();

  return (
    <div
      style={{
        padding: "10px 14px",
        background: isSelected
          ? `rgba(${hexToRgb(color)}, 0.15)`
          : "rgba(10,15,22,0.95)",
        border: `1px solid ${isSelected ? color : "#1a2535"}`,
        borderRadius: 6,
        minWidth: 140,
        maxWidth: 200,
        boxShadow: isSelected ? `0 0 12px ${color}44` : "none",
      }}
    >
      {/* 节点类型标签 */}
      <div
        style={{
          fontFamily: "'IBM Plex Mono'",
          fontSize: 8,
          color: color,
          letterSpacing: "0.1em",
          marginBottom: 4,
          textTransform: "uppercase",
        }}
      >
        {/* 首字母大写显示 */}
        {nodeType.charAt(0).toUpperCase() + nodeType.slice(1)}
      </div>

      {/* 节点名称 */}
      <div
        style={{
          fontFamily: "'IBM Plex Mono'",
          fontSize: 11,
          fontWeight: 600,
          color: "#b0c4d8",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={node.name || node.id}
      >
        {node.name || node.id.split(":").pop()}
      </div>

      {/* 统计 */}
      {(callCount > 0 || calledByCount > 0) && (
        <div
          style={{
            display: "flex",
            gap: 8,
            marginTop: 6,
          }}
        >
          {callCount > 0 && (
            <span
              style={{
                fontFamily: "'IBM Plex Mono'",
                fontSize: 9,
                color: "#00d4ff",
              }}
            >
              →{callCount}
            </span>
          )}
          {calledByCount > 0 && (
            <span
              style={{
                fontFamily: "'IBM Plex Mono'",
                fontSize: 9,
                color: "#ffc145",
              }}
            >
              ←{calledByCount}
            </span>
          )}
        </div>
      )}

      <Handle
        type="target"
        position={Position.Top}
        style={{ background: color, width: 5, height: 5, border: "none", top: -3 }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: color, width: 5, height: 5, border: "none", bottom: -3 }}
      />
    </div>
  );
};

// 辅助函数：hex 转 rgb
function hexToRgb(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`
    : "0, 0, 0";
}

const nodeTypes: NodeTypes = {
  simple: SimpleNode,
};

// ─── 边颜色 ──────────────────────────────────────────────────────────────────

const EDGE_COLORS: Record<string, string> = {
  calls: "#b08eff66",
  reads: "#00d4ff66",
  writes: "#ffc14566",
  depends_on: "#00f08466",
};

// ─── 布局函数 ────────────────────────────────────────────────────────────────

// 超过此节点数使用网格布局，避免 Dagre 主线程卡顿
const DAGRE_NODE_LIMIT = 100;

function applyDagreLayout(
  nodes: Node[],
  edges: Edge[],
  direction: "TB" | "LR" = "TB"
): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    nodesep: 50,
    ranksep: 80,
    marginx: 30,
    marginy: 30,
  });

  nodes.forEach((n) => {
    g.setNode(n.id, { width: 160, height: 60 });
  });

  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);

  return nodes.map((n) => {
    const pos = g.node(n.id);
    return { ...n, position: { x: pos.x - 80, y: pos.y - 30 } };
  });
}

function applyGridLayout(nodes: Node[]): Node[] {
  const cols = Math.ceil(Math.sqrt(nodes.length * 1.5));
  const hGap = 200;
  const vGap = 100;
  return nodes.map((n, i) => ({
    ...n,
    position: { x: (i % cols) * hGap, y: Math.floor(i / cols) * vGap },
  }));
}

// ─── 主组件 ──────────────────────────────────────────────────────────────────

const DomainDetailView: React.FC<DomainDetailViewProps> = ({
  repoId,
  domain,
  allNodes,
  allEdges,
  onBack,
  onNodeClick,
}) => {
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState([]);
  const [layoutType, setLayoutType] = useState<"TB" | "LR">("TB");
  const [detailLevel, setDetailLevel] = useState<DetailLevel>("standard");
  const { fitView } = useReactFlow();
  // 已获取的节点 AI 描述缓存（nodeId -> aiDescription）
  const [aiDescCache, setAiDescCache] = useState<Map<string, string>>(new Map());

  // 交互状态
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // 用聚合阶段确定的 nodeIds 集合过滤，与主图逻辑完全一致
  const domainNodeSet = useMemo(
    () => new Set(domain.nodeIds),
    [domain.nodeIds]
  );

  const domainNodes = useMemo(
    () => allNodes.filter((n) => domainNodeSet.has(n.id)),
    [allNodes, domainNodeSet]
  );

  // 过滤领域内的边（两端都在领域内即保留，不限 edge type）
  const domainEdges = useMemo(
    () => allEdges.filter((e) => domainNodeSet.has(e.from) && domainNodeSet.has(e.to)),
    [allEdges, domainNodeSet]
  );

  // 应用核心路径过滤
  const filteredData: FilteredGraphData = useMemo(() => {
    return filterCorePathNodes(domainNodes, domainEdges, detailLevel);
  }, [domainNodes, domainEdges, detailLevel]);

  // 计算节点统计
  const nodeStats = useMemo(() => {
    return calculateNodeStats(filteredData.nodes, filteredData.edges);
  }, [filteredData.nodes, filteredData.edges]);

  // 选中节点的信息
  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return null;
    return filteredData.nodes.find((n) => n.id === selectedNodeId) || null;
  }, [selectedNodeId, filteredData.nodes]);

  // 转换为 NodeDetail 格式
  const nodeDetail: NodeDetail | null = useMemo(() => {
    if (!selectedNode) return null;
    const stats = nodeStats.get(selectedNode.id) || {
      callCount: 0,
      calledByCount: 0,
    };
    const props = selectedNode.properties || {};
    // 优先取 properties 里内联的描述，其次取 API 缓存
    const aiDescription =
      (props.ai_description as string | undefined) ||
      (props.description as string | undefined) ||
      aiDescCache.get(selectedNode.id);

    return {
      nodeId: selectedNode.id,
      name: selectedNode.name || selectedNode.id.split(":").pop() || "",
      type: selectedNode.type,
      file: (props.file as string) || "",
      signature: props.signature as string | undefined,
      line: props.line as number | undefined,
      endLine: props.endLine as number | undefined,
      aiDescription,
      callCount: stats.callCount,
      calledByCount: stats.calledByCount,
      dependencies: [],
      generatedAt: undefined,
    };
  }, [selectedNode, nodeStats, aiDescCache]);

  // 选中节点时：若本地 properties 无描述则从 API 获取
  useEffect(() => {
    if (!selectedNodeId || !repoId) return;
    const node = filteredData.nodes.find((n) => n.id === selectedNodeId);
    if (!node) return;
    const props = node.properties || {};
    if (props.ai_description || props.description) return; // 已有内联描述
    if (aiDescCache.has(selectedNodeId)) return; // 已缓存

    domainApi
      .getBatchNodeInfo(repoId, domain.id, [selectedNodeId])
      .then(({ nodes }) => {
        const fetched = nodes[0];
        if (fetched?.aiDescription) {
          setAiDescCache((prev) => {
            const next = new Map(prev);
            next.set(selectedNodeId, fetched.aiDescription!);
            return next;
          });
        }
      })
      .catch(() => { /* 静默失败，不影响主流程 */ });
  }, [selectedNodeId, repoId, domain.id, filteredData.nodes, aiDescCache]);

  // 面板默认展示的领域描述（未选中节点时使用）
  const defaultDomainDescription = useMemo(() => ({
    domainId: domain.id,
    summary: `${domain.name} 包含 ${domain.nodeCount} 个节点，涵盖 ${domain.serviceCount} 个服务。`,
    coreServices: [],
    dataFlowPattern: "Controller → Service → Repository",
    generatedAt: new Date().toISOString(),
    confidence: 0.85,
  }), [domain]);

  const domainInfoForPanel = useMemo(() => ({
    id: domain.id,
    key: domain.key,
    name: domain.name,
    color: domain.color,
    nodeCount: domain.nodeCount,
    serviceCount: domain.serviceCount,
    controllerCount: domain.controllerCount,
    repositoryCount: domain.repositoryCount,
    crossDomainCalls: domain.crossDomainCalls,
    nodeIds: domain.nodeIds,
  }), [domain]);

  // 构建 ReactFlow 节点和边（仅在数据/布局变化时重算，不响应选中状态）
  useEffect(() => {
    if (!filteredData.nodes.length) return;

    const flowNodes: Node[] = filteredData.nodes.map((node) => {
      const stats = nodeStats.get(node.id) || { callCount: 0, calledByCount: 0 };
      return {
        id: node.id,
        type: "simple",
        position: { x: 0, y: 0 },
        data: {
          node,
          callCount: stats.callCount,
          calledByCount: stats.calledByCount,
          isSelected: false,
        },
      };
    });

    const flowEdges: Edge[] = filteredData.edges.map((edge, i) => {
      const color = EDGE_COLORS[edge.type] || "#1e3a4a";
      return {
        id: `${edge.from}--${edge.type}--${edge.to}--${i}`,
        source: edge.from,
        target: edge.to,
        type: "smoothstep",
        animated: true,
        style: { stroke: color.replace("66", "99"), strokeWidth: 1.5, opacity: 0.7 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: color.replace("66", "cc"),
          width: 8,
          height: 8,
        },
        data: { edge },
      };
    });

    const laidNodes =
      flowNodes.length > DAGRE_NODE_LIMIT
        ? applyGridLayout(flowNodes)
        : applyDagreLayout(flowNodes, flowEdges, layoutType);
    setRfNodes(laidNodes);
    setRfEdges(flowEdges);

    setTimeout(() => fitView({ padding: 0.1, duration: 300 }), 60);
  }, [filteredData, layoutType, nodeStats, setRfNodes, setRfEdges, fitView]);

  // 单独更新选中高亮，不触发重排布局和 fitView
  useEffect(() => {
    setRfNodes((nodes) =>
      nodes.map((n) => ({
        ...n,
        data: { ...n.data, isSelected: n.id === selectedNodeId },
      }))
    );
  }, [selectedNodeId, setRfNodes]);

  // 处理节点点击
  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      setSelectedNodeId(node.id);
    },
    []
  );

  // 处理节点双击
  const handleNodeDoubleClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (onNodeClick) {
        onNodeClick(node.id);
      }
    },
    [onNodeClick]
  );



  if (!domainNodes.length || !filteredData.nodes.length) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
        }}
      >
        <AppstoreOutlined style={{ fontSize: 48, color: "#2a4a5a", marginBottom: 16 }} />
        <div
          style={{
            fontFamily: "'IBM Plex Mono'",
            fontSize: 11,
            color: "#4a6a7a",
          }}
        >
          领域内暂无节点数据
        </div>
        <Button
          onClick={onBack}
          style={{
            marginTop: 16,
            background: "#080e16",
            border: "1px solid #1a2535",
            color: "#8ab4c8",
          }}
        >
          返回主图
        </Button>
      </div>
    );
  }

  return (
    <div style={{ height: "100%", width: "100%", display: "flex" }}>
      {/* 主图区域 */}
      <div style={{ flex: 1, position: "relative" }}>
        {/* 工具栏 */}
        <div
          style={{
            position: "absolute",
            top: 10,
            left: 10,
            zIndex: 10,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          {/* 返回按钮 */}
          <Button
            onClick={onBack}
            icon={<ArrowLeftOutlined />}
            style={{
              background: "rgba(10,15,22,0.9)",
              border: "1px solid #1a2535",
              color: "#8ab4c8",
              fontFamily: "'IBM Plex Mono'",
              fontSize: 10,
            }}
          >
            返回
          </Button>

          {/* 领域名称 */}
          <Tag
            color={domain.color}
            style={{
              fontFamily: "'Syne', sans-serif",
              fontSize: 11,
              fontWeight: 600,
              margin: 0,
              padding: "4px 10px",
            }}
          >
            {domain.name}
          </Tag>

          {/* 详细度切换 */}
          <div style={{ display: "flex", gap: 2 }}>
            {(["compact", "standard", "detailed"] as const).map((level, i) => {
              const label = ["简洁", "标准", "详细"][i];
              const active = detailLevel === level;
              return (
                <button
                  key={level}
                  onClick={() => setDetailLevel(level)}
                  style={{
                    background: active ? "#1a2f40" : "rgba(10,15,22,0.9)",
                    border: `1px solid ${active ? "#00d4ff" : "#1a2535"}`,
                    borderRadius: i === 0 ? "4px 0 0 4px" : i === 2 ? "0 4px 4px 0" : "0",
                    padding: "4px 10px",
                    cursor: "pointer",
                    fontFamily: "'IBM Plex Mono'",
                    fontSize: 10,
                    color: active ? "#00d4ff" : "#4a6a7a",
                    transition: "all 0.15s",
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* 统计 */}
          <div style={{ display: "flex", gap: 8 }}>
            <Tag color="#b08eff">
              {filteredData.stats.filtered}/{filteredData.stats.total} 节点
            </Tag>
            <Tag color="#00d4ff">{filteredData.edges.length} 边</Tag>
          </div>

          {/* 布局切换 */}
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
                color: "#8ab4c8",
                fontFamily: "'IBM Plex Mono'",
                fontSize: 10,
              }}
            >
              {layoutType === "TB" ? (
                <ApartmentOutlined />
              ) : (
                <ShareAltOutlined />
              )}
            </button>
          </Tooltip>
        </div>

        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={handleNodeClick}
          onNodeDoubleClick={handleNodeDoubleClick}
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
              const data = n.data as { node?: { type: string } };
              const type = data?.node?.type;
              switch (type) {
                case "Controller":
                case "APIEndpoint":
                  return "#00d4ff";
                case "Service":
                  return "#00f084";
                case "Repository":
                case "DAO":
                  return "#ffc145";
                default:
                  return "#8ab4c8";
              }
            }}
            maskColor="rgba(7,9,13,0.75)"
          />
        </ReactFlow>
      </div>

      {/* 右侧固定信息面板 */}
      <div
        style={{
          width: 280,
          background: "rgba(7,9,13,0.97)",
          borderLeft: "1px solid #1a2535",
          padding: 16,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <DomainInfoPanel
          type={selectedNode ? "node" : "domain"}
          data={selectedNode && nodeDetail ? nodeDetail : defaultDomainDescription}
          domainInfo={!selectedNode ? domainInfoForPanel : undefined}
          loading={false}
        />
      </div>

    </div>
  );
};

export default DomainDetailView;
