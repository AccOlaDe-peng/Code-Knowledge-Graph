/**
 * ModuleGraph - 模块依赖图组件。
 *
 * 使用 ReactFlow 渲染模块依赖图：
 * - 节点 = 模块
 * - 边 = 模块间依赖关系
 * - 支持点击选中模块
 * - 支持悬停边显示描述
 * - 支持悬停节点高亮关联元素
 *
 * v2.3 - 修复拖动节点后位置重置问题：
 * - 初始布局只在 modules 变化时计算
 * - 悬浮高亮通过 useMemo 动态计算样式，不触发重新布局
 */
import React, {
  useEffect,
  useMemo,
  useCallback,
  useState,
  useRef,
} from "react";
import { createPortal } from "react-dom";
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
  type EdgeMouseHandler,
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

// ─── 节点类型注册 ──────────────────────────────────────────────────────────

const nodeTypes: NodeTypes = {
  module: ModuleNode,
};

// ─── 边样式配置 - 高对比度版本 ──────────────────────────────────────────────

const EDGE_STYLES: Record<
  string,
  { color: string; dash: string | undefined; width: number }
> = {
  data: { color: "#00d4ff", dash: undefined, width: 3 },
  config: { color: "#39e5ff", dash: "6,4", width: 2.5 },
  service: { color: "#00f084", dash: undefined, width: 3 },
  auth: { color: "#ffc145", dash: "3,3", width: 2.5 },
  aggregate: { color: "#88aacc", dash: undefined, width: 2 },
};

// ─── Tooltip 组件 ────────────────────────────────────────────────────────────

interface EdgeTooltipProps {
  dep: ModuleDependency;
  x: number;
  y: number;
  moduleMap: Map<string, Module>;
}

const EdgeTooltip: React.FC<EdgeTooltipProps> = ({ dep, x, y, moduleMap }) => {
  const fromModule = moduleMap.get(dep.from);
  const toModule = moduleMap.get(dep.to);
  const style = EDGE_STYLES[dep.type] || EDGE_STYLES.data;

  return (
    <div
      style={{
        position: "fixed",
        left: x,
        top: y,
        transform: "translate(-50%, -120%)",
        background: "rgba(10, 15, 24, 0.98)",
        border: `1px solid ${style.color}40`,
        borderRadius: 8,
        padding: "10px 14px",
        minWidth: 200,
        maxWidth: 320,
        boxShadow: `0 4px 20px rgba(0,0,0,0.5), 0 0 20px ${style.color}20`,
        zIndex: 9999,
        pointerEvents: "none",
      }}
    >
      {/* 类型标签 */}
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "3px 8px",
          background: `${style.color}15`,
          border: `1px solid ${style.color}40`,
          borderRadius: 4,
          marginBottom: 8,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: style.color,
          }}
        />
        <span
          style={{
            fontFamily: "'JetBrains Mono', 'IBM Plex Mono'",
            fontSize: 10,
            fontWeight: 600,
            color: style.color,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
          }}
        >
          {dep.type}
        </span>
      </div>

      {/* 流向描述 */}
      <div
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: 13,
          color: "#e0e8f8",
          marginBottom: 8,
          lineHeight: 1.5,
        }}
      >
        <span style={{ color: style.color, fontWeight: 600 }}>
          {toModule?.name || dep.to}
        </span>
        <span style={{ color: "#98a8c8", margin: "0 6px" }}>→</span>
        <span style={{ color: "#c8d4e8" }}>{fromModule?.name || dep.from}</span>
      </div>

      {/* 依赖描述 */}
      <div
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: 12,
          color: "#a8b8d8",
          lineHeight: 1.6,
          marginBottom: dep.detail ? 8 : 0,
        }}
      >
        {dep.description}
      </div>

      {/* 详细说明 */}
      {dep.detail && (
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "#98a8c8",
            lineHeight: 1.6,
            borderTop: "1px solid #1a2840",
            paddingTop: 8,
            marginTop: 4,
          }}
        >
          {dep.detail}
        </div>
      )}
    </div>
  );
};

// ─── 布局函数 ────────────────────────────────────────────────────────────────

function applyDagreLayout(
  nodes: Node[],
  edges: Edge[],
  direction: "TB" | "LR" = "LR",
): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    nodesep: 120, // 节点水平间距优化
    ranksep: 180, // 层级垂直间距优化
    marginx: 60, // 边距优化
    marginy: 60,
    align: "UL", // 上左对齐，减少布局抖动
  });

  nodes.forEach((n) => {
    g.setNode(n.id, { width: 220, height: 90 });
  });

  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);

  return nodes.map((n) => {
    const pos = g.node(n.id);
    return { ...n, position: { x: pos.x - 110, y: pos.y - 45 } };
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

  // Tooltip 状态
  const [hoveredEdge, setHoveredEdge] = useState<{
    dep: ModuleDependency;
    x: number;
    y: number;
  } | null>(null);

  // 悬浮高亮状态
  const [hoveredModuleId, setHoveredModuleId] = useState<string | null>(null);

  // 标记是否已完成初始布局
  const initializedRef = useRef(false);

  // 构建模块 ID 到模块的映射
  const moduleMap = useMemo(() => {
    const map = new Map<string, Module>();
    modules.forEach((m) => map.set(m.id, m));
    return map;
  }, [modules]);

  // 构建依赖 ID 到依赖的映射
  const depMap = useMemo(() => {
    const map = new Map<string, ModuleDependency>();
    dependencies.forEach((dep) => {
      const edgeId = `${dep.from}--${dep.type}--${dep.to}`;
      map.set(edgeId, dep);
    });
    return map;
  }, [dependencies]);

  // 计算悬浮节点关联的节点集合
  const relatedNodes = useMemo(() => {
    if (!hoveredModuleId) return null;
    const related = new Set<string>([hoveredModuleId]);
    dependencies.forEach((dep) => {
      if (dep.from === hoveredModuleId) related.add(dep.to);
      if (dep.to === hoveredModuleId) related.add(dep.from);
    });
    return related;
  }, [hoveredModuleId, dependencies]);

  // 判断边是否与悬浮节点关联
  const relatedEdges = useMemo(() => {
    if (!hoveredModuleId) return null;
    const related = new Set<string>();
    dependencies.forEach((dep) => {
      if (dep.from === hoveredModuleId || dep.to === hoveredModuleId) {
        related.add(`${dep.from}--${dep.type}--${dep.to}`);
      }
    });
    return related;
  }, [hoveredModuleId, dependencies]);

  // 仅在 modules 变化时初始化布局（不包含悬浮状态依赖）
  useEffect(() => {
    if (!modules.length) {
      return;
    }

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
        source: dep.to,
        target: dep.from,
        type: "smoothstep",
        animated: dep.type === "data" || dep.type === "service",
        label: dep.type,
        labelStyle: {
          fontFamily: "'JetBrains Mono', 'IBM Plex Mono'",
          fontSize: 10,
          fill: style.color,
          fontWeight: 600,
        },
        labelBgStyle: {
          fill: "#0a0f18",
          fillOpacity: 0.98,
          stroke: style.color,
          strokeWidth: 1,
          strokeOpacity: 0.8,
        },
        labelBgPadding: [6, 4] as [number, number],
        labelBgBorderRadius: 4,
        style: {
          stroke: style.color,
          strokeWidth: style.width,
          strokeDasharray: style.dash,
          opacity: 0.95,
          cursor: "pointer",
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: style.color,
          width: 14,
          height: 14,
        },
        data: { dependency: dep },
      };
    });

    // 应用布局
    const laidNodes = applyDagreLayout(flowNodes, flowEdges);

    setRfNodes(laidNodes);
    setRfEdges(flowEdges);
    initializedRef.current = true;
  }, [modules, dependencies, setRfNodes, setRfEdges]); // 不依赖 selectedModuleId 和 hoveredModuleId

  // 动态计算节点样式（不触发重新布局）
  const nodesWithHighlight = useMemo(() => {
    if (!hoveredModuleId || !relatedNodes) {
      // 无悬浮时，仅更新选中状态
      return rfNodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          isSelected: selectedModuleId === node.id,
        },
      }));
    }

    return rfNodes.map((node) => {
      const isRelated = relatedNodes.has(node.id);
      return {
        ...node,
        data: {
          ...node.data,
          isSelected: selectedModuleId === node.id,
        },
        style: {
          opacity: isRelated ? 1 : 0.15,
          transition: "opacity 0.2s ease",
        },
      };
    });
  }, [rfNodes, hoveredModuleId, relatedNodes, selectedModuleId]);

  // 动态计算边样式（不触发重新布局）
  const edgesWithHighlight = useMemo(() => {
    if (!hoveredModuleId || !relatedEdges) {
      return rfEdges;
    }

    return rfEdges.map((edge) => {
      const isRelated = relatedEdges.has(edge.id);
      return {
        ...edge,
        style: {
          ...edge.style,
          opacity: isRelated ? 0.95 : 0.15,
          transition: "opacity 0.2s ease",
        },
      };
    });
  }, [rfEdges, hoveredModuleId, relatedEdges]);

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
    [moduleMap, onModuleClick],
  );

  // 处理边鼠标进入
  const handleEdgeMouseEnter: EdgeMouseHandler = useCallback(
    (event, edge) => {
      const dep = depMap.get(edge.id);
      if (dep) {
        setHoveredEdge({
          dep,
          x: event.clientX,
          y: event.clientY,
        });
      }
    },
    [depMap],
  );

  // 处理边鼠标移动
  const handleEdgeMouseMove: EdgeMouseHandler = useCallback(
    (event, _edge) => {
      if (hoveredEdge) {
        setHoveredEdge((prev) =>
          prev ? { ...prev, x: event.clientX, y: event.clientY } : null,
        );
      }
    },
    [hoveredEdge],
  );

  // 处理边鼠标离开
  const handleEdgeMouseLeave: EdgeMouseHandler = useCallback(() => {
    setHoveredEdge(null);
  }, []);

  // 处理节点悬浮进入
  const handleNodeMouseEnter = useCallback(
    (_: React.MouseEvent, node: Node) => {
      setHoveredModuleId(node.id);
    },
    [],
  );

  // 处理节点悬浮离开
  const handleNodeMouseLeave = useCallback(() => {
    setHoveredModuleId(null);
  }, []);

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
              fontSize: 12,
              color: "#93b0d2",
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
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "linear-gradient(180deg, #080c14 0%, #0a0f18 100%)",
      }}
    >
      <ReactFlow
        nodes={nodesWithHighlight}
        edges={edgesWithHighlight}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onNodeMouseEnter={handleNodeMouseEnter}
        onNodeMouseLeave={handleNodeMouseLeave}
        onEdgeMouseEnter={handleEdgeMouseEnter}
        onEdgeMouseMove={handleEdgeMouseMove}
        onEdgeMouseLeave={handleEdgeMouseLeave}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        minZoom={0.2}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={32}
          size={1}
          color="#152030"
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
          nodeColor="#00d4ff"
          maskColor="rgba(7, 9, 13, 0.8)"
        />
      </ReactFlow>

      {/* Tooltip - 渲染到 body */}
      {hoveredEdge &&
        createPortal(
          <EdgeTooltip
            dep={hoveredEdge.dep}
            x={hoveredEdge.x}
            y={hoveredEdge.y}
            moduleMap={moduleMap}
          />,
          document.body,
        )}
    </div>
  );
};

export default ModuleGraph;
