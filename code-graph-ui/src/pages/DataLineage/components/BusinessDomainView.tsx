/**
 * BusinessDomainView - 业务领域视图组件。
 *
 * 展示按业务领域聚合的血缘图。
 * 支持：
 * - 单击领域节点：显示右侧面板信息
 * - 双击领域节点：进入领域子图
 */
import React, { useEffect, useMemo, useCallback, useState, useRef } from "react";
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
  useReactFlow,
} from "reactflow";
import "reactflow/dist/style.css";
import dagre from "dagre";
import { Spin, Tooltip, Tag } from "antd";
import { ApartmentOutlined, ShareAltOutlined } from "@ant-design/icons";
import BusinessDomainNodeComponent from "./BusinessDomainNode";
import DomainInfoPanel from "./DomainInfoPanel";
import DomainInfoDrawer from "./DomainInfoDrawer";
import {
  aggregateToBusinessDomain,
} from "../utils/domainAggregation";
import type { RawNode, RawEdge, BusinessDomainNode as BusinessDomainNodeType } from "../utils/domainAggregation";
import type {
  DomainDefinition,
  InferredDomain,
  DomainInfo,
  DomainDescription,
} from "../../../store/lineageStore";

// ─── 类型定义 ────────────────────────────────────────────────────────────────

interface BusinessDomainViewProps {
  nodes: RawNode[];
  edges: RawEdge[];
  domains: DomainDefinition[];
  inferredDomains: InferredDomain[];
  loading?: boolean;
  onDomainDoubleClick?: (domainId: string, domain: BusinessDomainNodeType) => void;
}

// ─── 节点类型注册 ────────────────────────────────────────────────────────────

const nodeTypes: NodeTypes = {
  businessDomain: BusinessDomainNodeComponent,
};

// ─── 边颜色 ──────────────────────────────────────────────────────────────────

const EDGE_COLORS: Record<string, string> = {
  flow_to: "#00f08466",
  reads: "#00d4ff66",
  writes: "#ffc14566",
};

// ─── 双击检测常量 ────────────────────────────────────────────────────────────

const DOUBLE_CLICK_DELAY = 300; // ms

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
    g.setNode(n.id, { width: 240, height: 100 });
  });

  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);

  return nodes.map((n) => {
    const pos = g.node(n.id);
    return { ...n, position: { x: pos.x - 120, y: pos.y - 50 } };
  });
}

// ─── 主组件 ──────────────────────────────────────────────────────────────────

const BusinessDomainView: React.FC<BusinessDomainViewProps> = ({
  nodes,
  edges,
  domains,
  inferredDomains,
  loading,
  onDomainDoubleClick,
}) => {
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState([]);
  const [layoutType, setLayoutType] = useState<"TB" | "LR">("LR");
  const { fitView } = useReactFlow();

  // 交互状态
  const [selectedDomainId, setSelectedDomainId] = useState<string | null>(null);
  const [domainDrawerVisible, setDomainDrawerVisible] = useState(false);

  // 双击检测
  const lastClickTimeRef = useRef(0);
  const lastClickedNodeRef = useRef<string | null>(null);

  // 聚合数据为业务领域级
  const domainData = useMemo(() => {
    if (!nodes.length || !edges.length) {
      return { domains: [], edges: [] };
    }
    return aggregateToBusinessDomain(nodes, edges, domains, inferredDomains);
  }, [nodes, edges, domains, inferredDomains]);

  // 选中的领域信息
  const selectedDomain = useMemo(() => {
    if (!selectedDomainId) return null;
    return domainData.domains.find((d) => d.id === selectedDomainId) || null;
  }, [selectedDomainId, domainData.domains]);

  // 转换为 DomainInfo 格式
  const domainInfo: DomainInfo | undefined = selectedDomain
    ? {
        id: selectedDomain.id,
        key: selectedDomain.key,
        name: selectedDomain.name,
        color: selectedDomain.color,
        nodeCount: selectedDomain.nodeCount,
        serviceCount: selectedDomain.services.length,
        controllerCount: selectedDomain.controllers.length,
        repositoryCount: selectedDomain.repositories.length,
        crossDomainCalls: 0, // TODO: 计算跨领域调用数
      }
    : undefined;

  // 模拟领域描述（后续从后端获取）
  const domainDescription: DomainDescription | null = selectedDomain
    ? {
        domainId: selectedDomain.id,
        summary: `${selectedDomain.name}包含 ${selectedDomain.nodeCount} 个节点，主要负责处理${selectedDomain.key}相关的业务逻辑。`,
        coreServices: selectedDomain.services.slice(0, 5).map((s) => s.name),
        dataFlowPattern: "Controller → Service → Repository",
        generatedAt: new Date().toISOString(),
        confidence: 0.85,
      }
    : null;

  // 构建 ReactFlow 节点和边
  useEffect(() => {
    if (!domainData.domains.length) return;

    // 创建节点
    const flowNodes: Node[] = domainData.domains.map((domain) => ({
      id: domain.id,
      type: "businessDomain",
      position: { x: 0, y: 0 },
      data: {
        domain,
        isSelected: domain.id === selectedDomainId,
      },
    }));

    // 创建边
    const flowEdges: Edge[] = domainData.edges.map((edge) => {
      const color = EDGE_COLORS[edge.type] || "#1e3a4a";

      return {
        id: `${edge.from}--${edge.type}--${edge.to}`,
        source: edge.from,
        target: edge.to,
        type: "smoothstep",
        animated: true,
        label: edge.callCount > 1 ? `${edge.callCount} calls` : undefined,
        labelStyle: {
          fontFamily: "'IBM Plex Mono'",
          fontSize: 8,
          fill: color.replace("66", "cc"),
        },
        labelBgStyle: { fill: "#07090d", fillOpacity: 0.85 },
        style: {
          stroke: color.replace("66", "99"),
          strokeWidth: 2,
          strokeDasharray: "5,5",
          opacity: 0.8,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: color.replace("66", "cc"),
          width: 10,
          height: 10,
        },
        data: { edge },
      };
    });

    // 应用布局
    const laidNodes = applyDagreLayout(flowNodes, flowEdges, layoutType);
    setRfNodes(laidNodes);
    setRfEdges(flowEdges);

    setTimeout(() => fitView({ padding: 0.1, duration: 300 }), 60);
  }, [domainData, layoutType, selectedDomainId, setRfNodes, setRfEdges, fitView]);

  // 处理节点点击（单击/双击检测）
  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (node.type !== "businessDomain") return;

      const now = Date.now();
      const isSameNode = lastClickedNodeRef.current === node.id;
      const isDoubleClick = isSameNode && now - lastClickTimeRef.current < DOUBLE_CLICK_DELAY;

      lastClickTimeRef.current = now;
      lastClickedNodeRef.current = node.id;

      if (isDoubleClick) {
        // 双击：进入子图
        const domain = domainData.domains.find((d) => d.id === node.id);
        if (domain && onDomainDoubleClick) {
          onDomainDoubleClick(node.id, domain);
        }
      } else {
        // 单击：显示面板
        setSelectedDomainId(node.id);
        // 重置计时器，等待可能的第二次点击
        setTimeout(() => {
          // 如果 300ms 内没有第二次点击，确认是单击
        }, DOUBLE_CLICK_DELAY);
      }
    },
    [domainData.domains, onDomainDoubleClick]
  );

  // 查看详情
  const handleViewDetail = useCallback(() => {
    setDomainDrawerVisible(true);
  }, []);

  // 关闭抽屉
  const handleCloseDrawer = useCallback(() => {
    setDomainDrawerVisible(false);
  }, []);

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
          加载业务领域视图...
        </span>
      </div>
    );
  }

  if (!domainData.domains.length) {
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
            暂无业务领域数据
          </div>
        </div>
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

          {/* 统计 */}
          <div style={{ display: "flex", gap: 12 }}>
            <Tag color="#00f084">{domainData.domains.length} 业务领域</Tag>
            <Tag color="#00d4ff">{domainData.edges.length} 跨领域调用</Tag>
          </div>
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
              if (n.type === "businessDomain") {
                const data = n.data as { domain: { color: string } };
                return data.domain?.color || "#00f084";
              }
              return "#00f084";
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
          type={selectedDomain ? "domain" : null}
          data={domainDescription}
          domainInfo={domainInfo}
          loading={false}
          onViewDetail={handleViewDetail}
        />
      </div>

      {/* 领域详情抽屉 */}
      <DomainInfoDrawer
        visible={domainDrawerVisible}
        domain={domainDescription}
        domainInfo={domainInfo}
        onClose={handleCloseDrawer}
      />
    </div>
  );
};

export default BusinessDomainView;
