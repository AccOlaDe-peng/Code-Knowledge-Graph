/**
 * ModuleOverview - 模块总览视图
 *
 * 展示模块节点和模块间调用边（使用轻量级概览数据）
 */
import React, { useMemo, useCallback } from "react";
import {
  ReactFlow,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
  MarkerType,
  Panel,
} from "reactflow";
import type { Node, Edge } from "reactflow";
import "reactflow/dist/style.css";
import { useFunctionCallStore } from "../../../../store/functionCallStore";
import { calculateEdgeWidth } from "../../utils/layout";

// ─── 模块节点组件 ────────────────────────────────────────────────────────────

const ModuleNode: React.FC<{
  data: {
    id: string;
    name: string;
    displayName: string;
    functionCount: number;
    callChainCount: number;
    heat: number;
  };
}> = ({ data }) => {
  const heatColor = `rgba(0, 212, 255, ${0.3 + data.heat * 0.5})`;

  return (
    <div
      style={{
        padding: "16px 20px",
        background: `linear-gradient(135deg, ${heatColor}15 0%, ${heatColor}05 100%)`,
        border: `1.5px solid ${heatColor}`,
        borderRadius: 10,
        minWidth: 160,
        maxWidth: 220,
        cursor: "pointer",
        boxShadow: `0 0 20px ${heatColor}30`,
        transition: "all 0.2s ease",
      }}
    >
      {/* 模块名 */}
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "#00d4ff",
          fontFamily: "var(--font-mono)",
          marginBottom: 4,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {data.name}
      </div>

      {/* 显示名 */}
      <div
        style={{
          fontSize: 11,
          color: "#7888a8",
          marginBottom: 12,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {data.displayName}
      </div>

      {/* 统计 */}
      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
        <div>
          <span style={{ fontSize: 14, fontWeight: 600, color: "#00f084", fontFamily: "var(--font-mono)" }}>
            {data.functionCount.toLocaleString()}
          </span>
          <span style={{ fontSize: 10, color: "#5a6a8a", marginLeft: 4 }}>函数</span>
        </div>
        <div>
          <span style={{ fontSize: 14, fontWeight: 600, color: "#ffc145", fontFamily: "var(--font-mono)" }}>
            {data.callChainCount.toLocaleString()}
          </span>
          <span style={{ fontSize: 10, color: "#5a6a8a", marginLeft: 4 }}>调用</span>
        </div>
      </div>

      {/* 热度条 */}
      <div
        style={{
          marginTop: 10,
          height: 3,
          borderRadius: 2,
          background: "rgba(255,255,255,0.1)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${data.heat * 100}%`,
            height: "100%",
            background: `linear-gradient(90deg, #00d4ff, #00f084)`,
            borderRadius: 2,
          }}
        />
      </div>
    </div>
  );
};

const nodeTypes = { moduleNode: ModuleNode };

// ─── 主组件 ──────────────────────────────────────────────────────────────────

const ModuleOverview: React.FC = () => {
  const { overview, setCurrentView, setSelectedModule, loadModuleDetail } = useFunctionCallStore();

  // 计算最大值用于归一化
  const maxFunctions = useMemo(
    () => Math.max(...(overview?.modules.map((m) => m.functionCount) || [1])),
    [overview?.modules]
  );
  const maxCallChains = useMemo(
    () => Math.max(...(overview?.modules.map((m) => m.callChainCount) || [1])),
    [overview?.modules]
  );
  const maxModuleCalls = useMemo(
    () => Math.max(...(overview?.module_calls.map((mc) => mc.count) || [1])),
    [overview?.module_calls]
  );

  // 转换为 ReactFlow 节点
  const initialNodes = useMemo((): Node[] => {
    if (!overview?.modules) return [];

    return overview.modules.map((module, index) => {
      const cols = Math.ceil(Math.sqrt(overview.modules.length));
      const col = index % cols;
      const row = Math.floor(index / cols);
      const heat =
        (module.functionCount / maxFunctions) * 0.4 +
        (module.callChainCount / maxCallChains) * 0.6;

      return {
        id: module.id,
        type: "moduleNode",
        position: { x: col * 280 + 100, y: row * 180 + 100 },
        data: {
          id: module.id,
          name: module.name,
          displayName: module.displayName,
          functionCount: module.functionCount,
          callChainCount: module.callChainCount,
          heat,
        },
      };
    });
  }, [overview?.modules, maxFunctions, maxCallChains]);

  // 转换为 ReactFlow 边
  const initialEdges = useMemo((): Edge[] => {
    if (!overview?.module_calls) return [];

    return overview.module_calls.slice(0, 100).map((mc, index) => {
      const width = calculateEdgeWidth(mc.count, 1, 5, maxModuleCalls);

      return {
        id: `edge-${index}`,
        source: mc.from,
        target: mc.to,
        type: "smoothstep",
        animated: mc.count > maxModuleCalls * 0.3,
        style: {
          stroke: mc.count > maxModuleCalls * 0.5 ? "#ffc145" : "#00d4ff",
          strokeWidth: width,
          opacity: 0.6,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: mc.count > maxModuleCalls * 0.5 ? "#ffc145" : "#00d4ff",
          width: 10,
          height: 10,
        },
        label: mc.count > maxModuleCalls * 0.3 ? `${mc.count}` : undefined,
        labelStyle: {
          fill: "#7888a8",
          fontSize: 10,
          fontFamily: "var(--font-mono)",
        },
        labelBgStyle: {
          fill: "#0a0d14",
          fillOpacity: 0.9,
        },
        labelBgPadding: [2, 4] as [number, number],
        labelBgBorderRadius: 3,
      };
    });
  }, [overview?.module_calls, maxModuleCalls]);

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  // 点击模块进入详情
  const onNodeClick = useCallback(
    async (_: React.MouseEvent, node: Node) => {
      const repoId = overview?.repo_id;
      if (!repoId) return;

      // 先设置选中模块和视图
      setSelectedModule(node.id);
      setCurrentView("detail");

      // 然后加载模块详情数据
      await loadModuleDetail(repoId, node.id);
    },
    [overview?.repo_id, setSelectedModule, setCurrentView, loadModuleDetail]
  );

  if (!overview) return null;

  return (
    <div style={{ width: "100%", height: "100%" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.3}
        maxZoom={1.5}
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

        {/* 图例 */}
        <Panel position="bottom-left">
          <div style={styles.legend}>
            <div style={styles.legendTitle}>模块调用关系</div>
            <div style={styles.legendItem}>
              <div style={{ ...styles.legendLine, background: "#00d4ff" }} />
              <span>普通调用</span>
            </div>
            <div style={styles.legendItem}>
              <div style={{ ...styles.legendLine, background: "#ffc145", boxShadow: "0 0 6px #ffc145" }} />
              <span>高频调用</span>
            </div>
          </div>
        </Panel>

        {/* 提示 */}
        <Panel position="top-right">
          <div style={styles.hint}>点击模块查看函数调用详情</div>
        </Panel>
      </ReactFlow>
    </div>
  );
};

// ─── 样式 ────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  legend: {
    background: "rgba(10,13,20,0.9)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 8,
    padding: "12px 16px",
  },
  legendTitle: {
    fontSize: 11,
    color: "#5a6a8a",
    fontFamily: "var(--font-mono)",
    marginBottom: 8,
    letterSpacing: "0.05em",
  },
  legendItem: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
    fontSize: 11,
    color: "#7888a8",
  },
  legendLine: {
    width: 20,
    height: 2,
    borderRadius: 1,
  },
  hint: {
    fontSize: 11,
    color: "#5a6a8a",
    fontFamily: "var(--font-mono)",
    background: "rgba(10,13,20,0.8)",
    padding: "6px 12px",
    borderRadius: 4,
  },
};

export default ModuleOverview;
