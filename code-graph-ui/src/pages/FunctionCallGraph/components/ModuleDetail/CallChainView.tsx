/**
 * CallChainView - 调用链视图组件
 *
 * 功能：
 * - 展示选中函数的完整调用链
 * - 从左到右布局：调用者在左，被调用者在右
 * - 智能折叠远距离节点
 * - 边上显示调用行号和类型
 */
import React, { useMemo, useCallback, useEffect } from "react";
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
import { Empty, Tag } from "antd";
import { WarningOutlined } from "@ant-design/icons";
import { useFunctionCallStore } from "../../../../store/functionCallStore";
import { useCallChainData, useCollapsedVirtualNodes } from "./hooks/useCallChainData";
import { computeCallChainLayout } from "../../utils/layout";
import { EDGE_COLORS } from "../../types";
import CallChainNode from "./CallChainNode";
import CallChainEdge from "./CallChainEdge";

// ─── 常量 ─────────────────────────────────────────────────────────────────────

const nodeTypes = { callChainNode: CallChainNode };
const edgeTypes = { callChainEdge: CallChainEdge };

// ─── 主组件 ────────────────────────────────────────────────────────────────────

const CallChainView: React.FC = () => {
  const {
    callChainRootId,
    toggleCollapsedNode,
    funcInfoIndex,
    setSelectedFunction,
  } = useFunctionCallStore();

  // 获取调用链数据
  const { nodes: chainNodes, edges: chainEdges, collapsedInfo, hasCycle, cycleEdges } = useCallChainData();

  // 获取折叠虚拟节点
  const virtualNodes = useCollapsedVirtualNodes(collapsedInfo);

  // 合并节点（包括折叠节点）
  const allNodes = useMemo(() => {
    return [...chainNodes, ...virtualNodes];
  }, [chainNodes, virtualNodes]);

  // 计算布局
  const layoutPositions = useMemo(() => {
    if (!callChainRootId) return new Map();
    return computeCallChainLayout(allNodes, chainEdges, callChainRootId);
  }, [allNodes, chainEdges, callChainRootId]);

  // 转换为 ReactFlow 节点
  const initialNodes = useMemo((): Node[] => {
    return allNodes.map((node) => {
      const pos = layoutPositions.get(node.id) || { x: 0, y: 0 };
      return {
        id: node.id,
        type: "callChainNode",
        position: pos,
        data: node,
      };
    });
  }, [allNodes, layoutPositions]);

  // 转换为 ReactFlow 边
  const initialEdges = useMemo((): Edge[] => {
    // 需要根据节点数据重建边
    const nodeIds = new Set(allNodes.map(n => n.id));
    const edges: Edge[] = [];

    // 遍历节点，根据方向和距离重建边关系
    for (const node of allNodes) {
      if (node.direction === "root" || node.isCollapsed) continue;

      // 找到该节点连接的目标节点
      if (node.direction === "caller") {
        // 调用者连接到距离更近的节点
        const targetDistance = node.distance - 1;
        const possibleTargets = allNodes.filter(
          n => (n.distance === targetDistance && n.direction === "caller") || n.direction === "root"
        );

        for (const target of possibleTargets) {
          if (nodeIds.has(target.id)) {
            const isCycle = cycleEdges.has(`${node.id}->${target.id}`);
            edges.push({
              id: `edge-${node.id}-${target.id}`,
              source: node.id,
              target: target.id,
              type: "callChainEdge",
              animated: false,
              data: {
                sourceLine: 0,  // 需要从原始数据获取
                callType: "direct",
                isCrossModule: false,
                isCycle,
              },
              markerEnd: {
                type: MarkerType.ArrowClosed,
                color: isCycle ? "#ff6b6b" : EDGE_COLORS.same_module,
              },
            });
          }
        }
      } else if (node.direction === "callee") {
        // 被调用者从距离更近的节点连接
        const sourceDistance = node.distance - 1;
        const possibleSources = allNodes.filter(
          n => (n.distance === sourceDistance && n.direction === "callee") || n.direction === "root"
        );

        for (const source of possibleSources) {
          if (nodeIds.has(source.id)) {
            const isCycle = cycleEdges.has(`${source.id}->${node.id}`);
            edges.push({
              id: `edge-${source.id}-${node.id}`,
              source: source.id,
              target: node.id,
              type: "callChainEdge",
              animated: false,
              data: {
                sourceLine: 0,
                callType: "direct",
                isCrossModule: false,
                isCycle,
              },
              markerEnd: {
                type: MarkerType.ArrowClosed,
                color: isCycle ? "#ff6b6b" : EDGE_COLORS.same_module,
              },
            });
          }
        }
      }
    }

    return edges;
  }, [allNodes, cycleEdges]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // 更新节点和边
  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  // 点击节点
  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const data = node.data as any;

      // 点击折叠节点，展开
      if (data.isCollapsed) {
        toggleCollapsedNode(data.id);
        return;
      }

      // 点击普通节点，选中
      setSelectedFunction(data.id);
    },
    [toggleCollapsedNode, setSelectedFunction]
  );

  // 未选择函数
  if (!callChainRootId) {
    return (
      <div style={styles.empty}>
        <Empty
          description={
            <span style={{ color: "#5a6a8a" }}>
              请从左侧列表选择函数以查看调用链
            </span>
          }
        />
      </div>
    );
  }

  // 无调用关系
  if (chainNodes.length <= 1 && collapsedInfo.size === 0) {
    const rootFunc = funcInfoIndex?.get(callChainRootId);
    return (
      <div style={styles.empty}>
        <div style={styles.singleNode}>
          <div style={styles.singleNodeName}>{rootFunc?.name}</div>
          <div style={styles.singleNodeHint}>无调用关系</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "100%" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.2}
        maxZoom={2}
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

        {/* 统计信息 */}
        <Panel position="top-left">
          <div style={styles.statsPanel}>
            <div style={styles.statsRow}>
              <span style={styles.statsLabel}>节点</span>
              <span style={styles.statsValue}>{chainNodes.length}</span>
            </div>
            <div style={styles.statsRow}>
              <span style={styles.statsLabel}>边</span>
              <span style={styles.statsValue}>{chainEdges.length}</span>
            </div>
            {hasCycle && (
              <Tag color="warning" style={{ marginLeft: 8 }}>
                <WarningOutlined /> 存在循环调用
              </Tag>
            )}
          </div>
        </Panel>

        {/* 图例 */}
        <Panel position="bottom-left">
          <div style={styles.legend}>
            <div style={styles.legendTitle}>调用链图例</div>
            <div style={styles.legendItem}>
              <div style={{ ...styles.legendLine, background: EDGE_COLORS.same_module }} />
              <span>同模块调用</span>
            </div>
            <div style={styles.legendItem}>
              <div style={{ ...styles.legendLine, background: EDGE_COLORS.cross_module, borderStyle: "dashed" }} />
              <span>跨模块调用</span>
            </div>
            <div style={styles.legendItem}>
              <div style={{ ...styles.legendLine, background: EDGE_COLORS.interface_call }} />
              <span>接口调用</span>
            </div>
            <div style={styles.legendItem}>
              <div style={{ ...styles.legendLine, background: "#ff6b6b" }} />
              <span>循环调用</span>
            </div>
          </div>
        </Panel>

        {/* 提示 */}
        {collapsedInfo.size > 0 && (
          <Panel position="top-right">
            <div style={styles.hint}>
              已折叠 {Array.from(collapsedInfo.values()).reduce((sum, info) => sum + info.count, 0)} 个节点，
              点击折叠节点可展开
            </div>
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
};

// ─── 样式 ────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  empty: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    width: "100%",
  },
  singleNode: {
    textAlign: "center",
    padding: 20,
  },
  singleNodeName: {
    fontSize: 16,
    fontWeight: 600,
    color: "#00d4ff",
    fontFamily: "var(--font-mono)",
    marginBottom: 8,
  },
  singleNodeHint: {
    fontSize: 12,
    color: "#5a6a8a",
  },
  statsPanel: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    background: "rgba(10,13,20,0.9)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 8,
    padding: "8px 12px",
  },
  statsRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  statsLabel: {
    fontSize: 10,
    color: "#5a6a8a",
  },
  statsValue: {
    fontSize: 12,
    fontWeight: 600,
    color: "#00d4ff",
    fontFamily: "var(--font-mono)",
  },
  legend: {
    background: "rgba(10,13,20,0.9)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 8,
    padding: "10px 14px",
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
    fontSize: 10,
    color: "#7888a8",
  },
  legendLine: {
    width: 16,
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

export default CallChainView;
