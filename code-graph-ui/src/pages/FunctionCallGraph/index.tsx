/**
 * FunctionCallGraph - 函数调用图页面
 *
 * 展示仓库内函数调用关系：
 * - 首屏需要选择仓库
 * - 使用 ReactFlow 渲染函数调用图
 * - 支持节点搜索、过滤和详情查看
 */
import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import {
  ReactFlow,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
  MarkerType,
  Position,
  Panel,
} from "reactflow";
import type { Node, Edge } from "reactflow";
import "reactflow/dist/style.css";
import { Input, Select, Drawer, Tag } from "antd";
import {
  SearchOutlined,
  FunctionOutlined,
  CodeOutlined,
  ApiOutlined,
  BranchesOutlined,
} from "@ant-design/icons";
import RepoSelector from "../../components/ui/RepoSelector";
import { useRepoStore } from "../../store/repoStore";

// ─── Types ────────────────────────────────────────────────────────────────────

type FunctionNode = {
  id: string;
  name: string;
  module: string;
  type: "function" | "method" | "api" | "handler" | "service" | "async";
  callsCount: number;
  calledByCount: number;
  complexity: "low" | "medium" | "high";
  description?: string;
};

type CallEdge = {
  id: string;
  source: string;
  target: string;
  type: "direct" | "async" | "callback";
};

// ─── Mock Data ─────────────────────────────────────────────────────────────────

const MOCK_FUNCTIONS: FunctionNode[] = [
  {
    id: "fn-1",
    name: "createUser",
    module: "services/user.service",
    type: "service",
    callsCount: 4,
    calledByCount: 2,
    complexity: "medium",
    description: "创建新用户，验证输入并写入数据库",
  },
  {
    id: "fn-2",
    name: "validateUserInput",
    module: "utils/validation",
    type: "function",
    callsCount: 0,
    calledByCount: 3,
    complexity: "low",
    description: "验证用户输入数据格式",
  },
  {
    id: "fn-3",
    name: "hashPassword",
    module: "utils/crypto",
    type: "function",
    callsCount: 0,
    calledByCount: 2,
    complexity: "low",
    description: "使用 bcrypt 加密密码",
  },
  {
    id: "fn-4",
    name: "saveUserToDB",
    module: "repositories/user.repo",
    type: "function",
    callsCount: 1,
    calledByCount: 1,
    complexity: "medium",
    description: "将用户数据持久化到数据库",
  },
  {
    id: "fn-5",
    name: "sendWelcomeEmail",
    module: "services/email.service",
    type: "async",
    callsCount: 2,
    calledByCount: 1,
    complexity: "medium",
    description: "异步发送欢迎邮件",
  },
  {
    id: "fn-6",
    name: "getUserById",
    module: "services/user.service",
    type: "service",
    callsCount: 1,
    calledByCount: 4,
    complexity: "low",
    description: "根据 ID 查询用户",
  },
  {
    id: "fn-7",
    name: "updateUserProfile",
    module: "services/user.service",
    type: "service",
    callsCount: 3,
    calledByCount: 2,
    complexity: "medium",
    description: "更新用户资料",
  },
  {
    id: "fn-8",
    name: "deleteUser",
    module: "services/user.service",
    type: "service",
    callsCount: 2,
    calledByCount: 1,
    complexity: "high",
    description: "删除用户及相关数据",
  },
  {
    id: "fn-9",
    name: "logUserAction",
    module: "utils/logger",
    type: "function",
    callsCount: 0,
    calledByCount: 5,
    complexity: "low",
    description: "记录用户操作日志",
  },
  {
    id: "fn-10",
    name: "POST /api/users",
    module: "controllers/user.controller",
    type: "api",
    callsCount: 1,
    calledByCount: 0,
    complexity: "low",
    description: "用户注册 API 端点",
  },
  {
    id: "fn-11",
    name: "GET /api/users/:id",
    module: "controllers/user.controller",
    type: "api",
    callsCount: 1,
    calledByCount: 0,
    complexity: "low",
    description: "获取用户信息 API 端点",
  },
  {
    id: "fn-12",
    name: "PUT /api/users/:id",
    module: "controllers/user.controller",
    type: "api",
    callsCount: 1,
    calledByCount: 0,
    complexity: "low",
    description: "更新用户信息 API 端点",
  },
  {
    id: "fn-13",
    name: "DELETE /api/users/:id",
    module: "controllers/user.controller",
    type: "api",
    callsCount: 1,
    calledByCount: 0,
    complexity: "low",
    description: "删除用户 API 端点",
  },
  {
    id: "fn-14",
    name: "cacheUserSession",
    module: "services/cache.service",
    type: "async",
    callsCount: 1,
    calledByCount: 2,
    complexity: "medium",
    description: "缓存用户会话信息",
  },
  {
    id: "fn-15",
    name: "notifyUserDeleted",
    module: "services/notification.service",
    type: "async",
    callsCount: 1,
    calledByCount: 1,
    complexity: "medium",
    description: "通知其他服务用户已删除",
  },
];

const MOCK_EDGES: CallEdge[] = [
  { id: "e-1", source: "fn-10", target: "fn-1", type: "direct" },
  { id: "e-2", source: "fn-1", target: "fn-2", type: "direct" },
  { id: "e-3", source: "fn-1", target: "fn-3", type: "direct" },
  { id: "e-4", source: "fn-1", target: "fn-4", type: "direct" },
  { id: "e-5", source: "fn-1", target: "fn-5", type: "async" },
  { id: "e-6", source: "fn-1", target: "fn-9", type: "direct" },
  { id: "e-7", source: "fn-11", target: "fn-6", type: "direct" },
  { id: "e-8", source: "fn-12", target: "fn-7", type: "direct" },
  { id: "e-9", source: "fn-13", target: "fn-8", type: "direct" },
  { id: "e-10", source: "fn-7", target: "fn-2", type: "direct" },
  { id: "e-11", source: "fn-7", target: "fn-6", type: "direct" },
  { id: "e-12", source: "fn-7", target: "fn-9", type: "direct" },
  { id: "e-13", source: "fn-8", target: "fn-6", type: "direct" },
  { id: "e-14", source: "fn-8", target: "fn-9", type: "direct" },
  { id: "e-15", source: "fn-8", target: "fn-15", type: "async" },
  { id: "e-16", source: "fn-4", target: "fn-14", type: "async" },
  { id: "e-17", source: "fn-5", target: "fn-14", type: "async" },
  { id: "e-18", source: "fn-6", target: "fn-14", type: "async" },
  { id: "e-19", source: "fn-15", target: "fn-9", type: "direct" },
  { id: "e-20", source: "fn-5", target: "fn-9", type: "direct" },
];

// ─── Constants ────────────────────────────────────────────────────────────────

const NODE_COLORS = {
  function: { bg: "#0d1117", border: "#00d4ff", text: "#00d4ff" },
  method: { bg: "#0d1117", border: "#b08eff", text: "#b08eff" },
  api: { bg: "#0d1117", border: "#00f084", text: "#00f084" },
  handler: { bg: "#0d1117", border: "#ffc145", text: "#ffc145" },
  async: { bg: "#0d1117", border: "#ff66cc", text: "#ff66cc" },
  service: { bg: "#0d1117", border: "#00d4ff", text: "#00d4ff" },
};

const EDGE_COLORS = {
  direct: "#00d4ff",
  async: "#ff66cc",
  callback: "#ffc145",
};

const COMPLEXITY_COLORS = {
  low: "#00f084",
  medium: "#ffc145",
  high: "#ff4568",
};

// ─── Custom Node Component ─────────────────────────────────────────────────────

const FunctionNodeComponent: React.FC<{
  data: FunctionNode & { isSelected?: boolean };
}> = ({ data }) => {
  const colors = NODE_COLORS[data.type] || NODE_COLORS.function;
  const complexityColor = COMPLEXITY_COLORS[data.complexity];

  return (
    <div
      style={{
        padding: "12px 16px",
        background: data.isSelected
          ? `linear-gradient(135deg, ${colors.border}22 0%, ${colors.border}08 100%)`
          : colors.bg,
        border: `1.5px solid ${data.isSelected ? colors.border : `${colors.border}66`}`,
        borderRadius: 8,
        minWidth: 160,
        maxWidth: 220,
        boxShadow: data.isSelected
          ? `0 0 20px ${colors.border}40, inset 0 0 12px ${colors.border}10`
          : `0 2px 8px rgba(0,0,0,0.3)`,
        transition: "all 0.2s ease",
        cursor: "pointer",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        {data.type === "api" ? (
          <ApiOutlined style={{ color: colors.text, fontSize: 14 }} />
        ) : data.type === "async" ? (
          <BranchesOutlined style={{ color: colors.text, fontSize: 14 }} />
        ) : (
          <FunctionOutlined style={{ color: colors.text, fontSize: 14 }} />
        )}
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: colors.text,
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.01em",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
        >
          {data.name}
        </span>
      </div>

      {/* Module */}
      <div
        style={{
          fontSize: 10,
          color: "#7888a8",
          fontFamily: "var(--font-mono)",
          marginBottom: 8,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {data.module}
      </div>

      {/* Stats */}
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 10, color: "#7888a8" }}>调出</span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "#00d4ff",
              fontFamily: "var(--font-mono)",
            }}
          >
            {data.callsCount}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 10, color: "#7888a8" }}>调入</span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "#00f084",
              fontFamily: "var(--font-mono)",
            }}
          >
            {data.calledByCount}
          </span>
        </div>
        <div
          style={{
            marginLeft: "auto",
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: complexityColor,
            boxShadow: `0 0 6px ${complexityColor}`,
          }}
          title={`复杂度: ${data.complexity}`}
        />
      </div>
    </div>
  );
};

const nodeTypes = {
  functionNode: FunctionNodeComponent,
};

// ─── Layout Algorithm (Simple Grid) ────────────────────────────────────────────

const calculateLayout = (
  functions: FunctionNode[]
): { nodes: Node[]; edges: Edge[] } => {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Group by module
  const moduleGroups = new Map<string, FunctionNode[]>();
  functions.forEach((fn) => {
    const group = moduleGroups.get(fn.module) || [];
    group.push(fn);
    moduleGroups.set(fn.module, group);
  });

  // Position nodes
  const modules = Array.from(moduleGroups.entries());
  const colWidth = 280;
  const rowHeight = 140;

  modules.forEach(([, fns], moduleIndex) => {
    fns.forEach((fn, fnIndex) => {
      nodes.push({
        id: fn.id,
        type: "functionNode",
        position: {
          x: moduleIndex * colWidth,
          y: fnIndex * rowHeight + (moduleIndex % 2) * 40,
        },
        data: fn,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      });
    });
  });

  // Create edges
  MOCK_EDGES.forEach((edge) => {
    const edgeColor = EDGE_COLORS[edge.type];
    edges.push({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: "smoothstep",
      animated: edge.type === "async",
      style: {
        stroke: edgeColor,
        strokeWidth: 1.5,
        opacity: 0.7,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: edgeColor,
        width: 12,
        height: 12,
      },
      label: edge.type === "async" ? "async" : undefined,
      labelStyle: {
        fill: edgeColor,
        fontWeight: 500,
        fontSize: 9,
        fontFamily: "var(--font-mono)",
      },
      labelBgStyle: {
        fill: "#0a0d14",
        fillOpacity: 0.9,
      },
      labelBgPadding: [4, 6] as [number, number],
      labelBgBorderRadius: 4,
    });
  });

  return { nodes, edges };
};

// ─── Main Component ───────────────────────────────────────────────────────────

const FunctionCallGraph: React.FC = () => {
  const { activeRepo } = useRepoStore();
  const [searchText, setSearchText] = useState("");
  const [filterType, setFilterType] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<FunctionNode | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  // Calculate initial layout
  const initialLayout = useMemo(() => calculateLayout(MOCK_FUNCTIONS), []);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialLayout.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialLayout.edges);

  // Filter nodes based on search and type
  useEffect(() => {
    if (!searchText && !filterType) {
      setNodes(initialLayout.nodes);
      setEdges(initialLayout.edges);
      return;
    }

    const filteredNodeIds = new Set<string>();
    MOCK_FUNCTIONS.forEach((fn) => {
      const matchesSearch =
        !searchText ||
        fn.name.toLowerCase().includes(searchText.toLowerCase()) ||
        fn.module.toLowerCase().includes(searchText.toLowerCase());
      const matchesType = !filterType || fn.type === filterType;
      if (matchesSearch && matchesType) {
        filteredNodeIds.add(fn.id);
      }
    });

    const filteredNodes = initialLayout.nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        isSelected: filteredNodeIds.has(node.id),
      },
      style: {
        opacity: filteredNodeIds.has(node.id) ? 1 : 0.15,
      },
    }));

    const filteredEdges = initialLayout.edges.map((edge) => ({
      ...edge,
      style: {
        ...edge.style,
        opacity:
          filteredNodeIds.has(edge.source) && filteredNodeIds.has(edge.target)
            ? 0.7
            : 0.08,
      },
    }));

    setNodes(filteredNodes);
    setEdges(filteredEdges);
  }, [searchText, filterType, initialLayout, setNodes, setEdges]);

  // Handle node click
  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const fn = MOCK_FUNCTIONS.find((f) => f.id === node.id);
      if (fn) {
        setSelectedNode(fn);
        setDrawerOpen(true);
      }
    },
    []
  );

  // Stats
  const stats = useMemo(() => {
    const typeCounts = MOCK_FUNCTIONS.reduce(
      (acc, fn) => {
        acc[fn.type] = (acc[fn.type] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
    return {
      total: MOCK_FUNCTIONS.length,
      calls: MOCK_EDGES.length,
      typeCounts,
    };
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "#07090d",
        zIndex: 1,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "12px 20px",
          borderBottom: "1px solid rgba(255,255,255,0.04)",
          background: "rgba(6,8,12,0.97)",
          backdropFilter: "blur(12px)",
          flexShrink: 0,
          height: 52,
        }}
      >
        {/* Title */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 9,
              height: 9,
              borderRadius: 2,
              background: "#00d4ff",
              boxShadow: "0 0 12px rgba(0,212,255,0.6)",
            }}
          />
          <span
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: 15,
              fontWeight: 700,
              color: "#00d4ff",
              letterSpacing: "0.04em",
            }}
          >
            函数调用图
          </span>
        </div>

        {/* Repo Selector */}
        <RepoSelector showStats={false} width={220} />

        {/* Search */}
        <Input
          placeholder="搜索函数名或模块..."
          prefix={<SearchOutlined style={{ color: "#5a6a8a" }} />}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          style={{ width: 200 }}
          allowClear
        />

        {/* Type Filter */}
        <Select
          placeholder="类型过滤"
          value={filterType}
          onChange={setFilterType}
          allowClear
          style={{ width: 130 }}
          options={[
            { value: "function", label: "Function" },
            { value: "service", label: "Service" },
            { value: "api", label: "API" },
            { value: "async", label: "Async" },
          ]}
        />

        {/* Stats */}
        {activeRepo && (
          <div style={{ display: "flex", gap: 20, marginLeft: "auto" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 16,
                  fontWeight: 700,
                  color: "#00d4ff",
                }}
              >
                {stats.total}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: 11,
                  color: "#7888a8",
                }}
              >
                函数
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 16,
                  fontWeight: 700,
                  color: "#ff66cc",
                }}
              >
                {stats.calls}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: 11,
                  color: "#7888a8",
                }}
              >
                调用
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, position: "relative" }}>
        {/* No Repo Selected */}
        {!activeRepo && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 16,
              zIndex: 10,
              background: "rgba(6,8,12,0.9)",
            }}
          >
            <CodeOutlined style={{ fontSize: 48, color: "#2a3a5a" }} />
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 13,
                color: "#5a6a8a",
                letterSpacing: "0.04em",
              }}
            >
              请先选择仓库以查看函数调用图
            </div>
          </div>
        )}

        {/* ReactFlow Canvas */}
        {activeRepo && (
          <div ref={reactFlowWrapper} style={{ width: "100%", height: "100%" }}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={onNodeClick}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              minZoom={0.3}
              maxZoom={1.5}
              defaultEdgeOptions={{
                type: "smoothstep",
              }}
              proOptions={{ hideAttribution: true }}
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={20}
                size={1}
                color="rgba(255,255,255,0.04)"
              />
              <Controls
                style={{
                  background: "rgba(10,13,20,0.9)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 8,
                }}
              />

              {/* Legend Panel */}
              <Panel position="bottom-left">
                <div
                  style={{
                    background: "rgba(10,13,20,0.9)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 8,
                    padding: "12px 16px",
                    display: "flex",
                    gap: 16,
                    backdropFilter: "blur(8px)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div
                      style={{
                        width: 12,
                        height: 3,
                        background: EDGE_COLORS.direct,
                        borderRadius: 2,
                      }}
                    />
                    <span
                      style={{
                        fontSize: 11,
                        color: "#7888a8",
                        fontFamily: "var(--font-mono)",
                      }}
                    >
                      直接调用
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div
                      style={{
                        width: 12,
                        height: 3,
                        background: EDGE_COLORS.async,
                        borderRadius: 2,
                        boxShadow: `0 0 6px ${EDGE_COLORS.async}`,
                      }}
                    />
                    <span
                      style={{
                        fontSize: 11,
                        color: "#7888a8",
                        fontFamily: "var(--font-mono)",
                      }}
                    >
                      异步调用
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: COMPLEXITY_COLORS.high,
                        boxShadow: `0 0 6px ${COMPLEXITY_COLORS.high}`,
                      }}
                    />
                    <span
                      style={{
                        fontSize: 11,
                        color: "#7888a8",
                        fontFamily: "var(--font-mono)",
                      }}
                    >
                      高复杂度
                    </span>
                  </div>
                </div>
              </Panel>
            </ReactFlow>
          </div>
        )}
      </div>

      {/* Detail Drawer */}
      <Drawer
        title={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <FunctionOutlined style={{ color: "#00d4ff" }} />
            <span>{selectedNode?.name}</span>
          </div>
        }
        placement="right"
        width={400}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        styles={{
          body: { background: "#0a0d14", padding: "16px 20px" },
          header: {
            background: "#0a0d14",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          },
        }}
      >
        {selectedNode && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Type Badge */}
            <div>
              <Tag
                color={NODE_COLORS[selectedNode.type]?.border || "#00d4ff"}
                style={{
                  background: `${NODE_COLORS[selectedNode.type]?.border}15`,
                  border: `1px solid ${NODE_COLORS[selectedNode.type]?.border}40`,
                  borderRadius: 4,
                  padding: "4px 12px",
                }}
              >
                {selectedNode.type.toUpperCase()}
              </Tag>
              <Tag
                style={{
                  background: `${COMPLEXITY_COLORS[selectedNode.complexity]}15`,
                  border: `1px solid ${COMPLEXITY_COLORS[selectedNode.complexity]}40`,
                  color: COMPLEXITY_COLORS[selectedNode.complexity],
                  borderRadius: 4,
                  padding: "4px 12px",
                  marginLeft: 8,
                }}
              >
                {selectedNode.complexity.toUpperCase()} COMPLEXITY
              </Tag>
            </div>

            {/* Description */}
            <div>
              <div
                style={{
                  fontSize: 11,
                  color: "#5a6a8a",
                  fontFamily: "var(--font-mono)",
                  marginBottom: 6,
                  letterSpacing: "0.04em",
                }}
              >
                描述
              </div>
              <div
                style={{
                  fontSize: 14,
                  color: "#a8b8d8",
                  lineHeight: 1.6,
                }}
              >
                {selectedNode.description || "暂无描述"}
              </div>
            </div>

            {/* Module */}
            <div>
              <div
                style={{
                  fontSize: 11,
                  color: "#5a6a8a",
                  fontFamily: "var(--font-mono)",
                  marginBottom: 6,
                  letterSpacing: "0.04em",
                }}
              >
                所属模块
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: "#00d4ff",
                  fontFamily: "var(--font-mono)",
                  background: "rgba(0,212,255,0.08)",
                  border: "1px solid rgba(0,212,255,0.2)",
                  borderRadius: 4,
                  padding: "8px 12px",
                }}
              >
                {selectedNode.module}
              </div>
            </div>

            {/* Stats Grid */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
              }}
            >
              <div
                style={{
                  background: "rgba(0,212,255,0.06)",
                  border: "1px solid rgba(0,212,255,0.15)",
                  borderRadius: 6,
                  padding: 14,
                }}
              >
                <div
                  style={{
                    fontSize: 24,
                    fontWeight: 700,
                    color: "#00d4ff",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {selectedNode.callsCount}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "#7888a8",
                    marginTop: 4,
                  }}
                >
                  调用其他函数
                </div>
              </div>
              <div
                style={{
                  background: "rgba(0,240,132,0.06)",
                  border: "1px solid rgba(0,240,132,0.15)",
                  borderRadius: 6,
                  padding: 14,
                }}
              >
                <div
                  style={{
                    fontSize: 24,
                    fontWeight: 700,
                    color: "#00f084",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {selectedNode.calledByCount}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "#7888a8",
                    marginTop: 4,
                  }}
                >
                  被其他函数调用
                </div>
              </div>
            </div>

            {/* Call Relationships */}
            <div>
              <div
                style={{
                  fontSize: 11,
                  color: "#5a6a8a",
                  fontFamily: "var(--font-mono)",
                  marginBottom: 10,
                  letterSpacing: "0.04em",
                }}
              >
                调用关系
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {MOCK_EDGES.filter((e) => e.source === selectedNode.id)
                  .slice(0, 5)
                  .map((edge) => {
                    const target = MOCK_FUNCTIONS.find(
                      (f) => f.id === edge.target
                    );
                    return (
                      <div
                        key={edge.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "8px 12px",
                          background: "rgba(255,255,255,0.02)",
                          borderRadius: 4,
                          border: "1px solid rgba(255,255,255,0.04)",
                        }}
                      >
                        <span style={{ color: "#7888a8", fontSize: 10 }}>
                          →
                        </span>
                        <span
                          style={{
                            fontSize: 12,
                            color: "#a8b8d8",
                            fontFamily: "var(--font-mono)",
                          }}
                        >
                          {target?.name}
                        </span>
                        <Tag
                          style={{
                            marginLeft: "auto",
                            background: `${EDGE_COLORS[edge.type]}15`,
                            border: "none",
                            color: EDGE_COLORS[edge.type],
                            fontSize: 9,
                            padding: "2px 6px",
                          }}
                        >
                          {edge.type}
                        </Tag>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
};

export default FunctionCallGraph;
