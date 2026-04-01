/**
 * ModuleDetail - 模块详情视图
 *
 * 左侧：模块树 + 函数列表
 * 右侧：函数调用图（Dagre 布局）
 */
import React, { useState, useMemo, useCallback, useEffect } from "react";
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
import { Input, Select, Tag, Empty } from "antd";
import { SearchOutlined, FolderOutlined, FunctionOutlined } from "@ant-design/icons";
import { useFunctionCallStore } from "../../../../store/functionCallStore";
import { FUNCTION_TYPE_COLORS, EDGE_COLORS, type FunctionInfo } from "../../types";
import { computeDagreLayout } from "../../utils/layout";
import { filterFunctions, getModuleCallChains } from "../../utils/transform";

// ─── 函数节点组件 ────────────────────────────────────────────────────────────

const FunctionNode: React.FC<{
  data: FunctionInfo & {
    isCrossModule?: boolean;
    isSelected?: boolean;
    isPathNode?: boolean;
  };
}> = ({ data }) => {
  const colors = FUNCTION_TYPE_COLORS[data.type] || FUNCTION_TYPE_COLORS.service;
  const borderColor = data.isCrossModule ? EDGE_COLORS.cross_module : colors.border;

  return (
    <div
      style={{
        padding: "8px 12px",
        background: data.isSelected
          ? `linear-gradient(135deg, ${borderColor}22 0%, ${borderColor}08 100%)`
          : colors.bg,
        border: `1.5px solid ${data.isSelected ? borderColor : `${borderColor}66`}`,
        borderRadius: 6,
        minWidth: 140,
        maxWidth: 180,
        cursor: "pointer",
        boxShadow: data.isSelected
          ? `0 0 16px ${borderColor}40`
          : "0 2px 6px rgba(0,0,0,0.2)",
        transition: "all 0.15s ease",
      }}
    >
      {/* 函数名 */}
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: colors.text,
          fontFamily: "var(--font-mono)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          marginBottom: 4,
        }}
      >
        {data.name}
      </div>

      {/* 类名 */}
      <div
        style={{
          fontSize: 9,
          color: "#5a6a8a",
          fontFamily: "var(--font-mono)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          marginBottom: 6,
        }}
      >
        {data.className}
      </div>

      {/* 统计 */}
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <span style={{ fontSize: 9, color: "#5a6a8a" }}>被调</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: "#00d4ff", fontFamily: "var(--font-mono)" }}>
            {data.callerCount}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <span style={{ fontSize: 9, color: "#5a6a8a" }}>调出</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: "#00f084", fontFamily: "var(--font-mono)" }}>
            {data.calleeCount}
          </span>
        </div>
      </div>
    </div>
  );
};

const nodeTypes = { functionNode: FunctionNode };

// ─── 左侧面板 ────────────────────────────────────────────────────────────────

const LeftPanel: React.FC<{
  selectedModuleId: string;
  search: string;
  onSearch: (v: string) => void;
  typeFilter: string | null;
  onTypeFilter: (v: string | null) => void;
}> = ({ selectedModuleId, search, onSearch, typeFilter, onTypeFilter }) => {
  const { data, setSelectedModule, selectedFunctionId, setSelectedFunction } = useFunctionCallStore();

  // 过滤当前模块的函数
  const currentFunctions = useMemo(() => {
    const module = data?.modules.find((m) => m.id === selectedModuleId);
    if (!module) return [];
    return filterFunctions(module.functions, {
      searchText: search,
      types: typeFilter ? [typeFilter] : undefined,
    });
  }, [data?.modules, selectedModuleId, search, typeFilter]);

  return (
    <div style={styles.leftPanel}>
      {/* 搜索 */}
      <div style={styles.searchSection}>
        <Input
          placeholder="搜索函数..."
          prefix={<SearchOutlined style={{ color: "#5a6a8a" }} />}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          style={styles.searchInput}
          allowClear
        />
      </div>

      {/* 模块树 */}
      <div style={styles.treeSection}>
        <div style={styles.sectionTitle}>
          <FolderOutlined style={{ marginRight: 6 }} />
          模块列表
        </div>
        <div style={styles.treeList}>
          {data?.modules.map((m) => (
            <div
              key={m.id}
              onClick={() => setSelectedModule(m.id)}
              style={{
                ...styles.treeItem,
                background: m.id === selectedModuleId ? "rgba(0,212,255,0.1)" : "transparent",
                borderLeft: m.id === selectedModuleId ? "2px solid #00d4ff" : "2px solid transparent",
              }}
            >
              <span style={styles.treeItemName}>{m.name}</span>
              <span style={styles.treeItemCount}>{m.functionCount}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 函数列表 */}
      <div style={styles.funcSection}>
        <div style={styles.sectionHeader}>
          <div style={styles.sectionTitle}>
            <FunctionOutlined style={{ marginRight: 6 }} />
            函数列表
          </div>
          <Select
            placeholder="类型"
            value={typeFilter}
            onChange={onTypeFilter}
            allowClear
            style={{ width: 100 }}
            size="small"
            options={[
              { value: "service", label: "Service" },
              { value: "controller", label: "Controller" },
              { value: "repository", label: "Repository" },
              { value: "dto", label: "DTO" },
              { value: "entity", label: "Entity" },
              { value: "handler", label: "Handler" },
            ]}
          />
        </div>
        <div style={styles.funcList}>
          {currentFunctions.slice(0, 100).map((f) => (
            <div
              key={f.id}
              onClick={() => setSelectedFunction(f.id)}
              style={{
                ...styles.funcItem,
                background: f.id === selectedFunctionId ? "rgba(0,212,255,0.1)" : "transparent",
              }}
            >
              <span style={styles.funcName}>{f.name}</span>
              <Tag
                style={{
                  background: `${FUNCTION_TYPE_COLORS[f.type]?.border}15`,
                  border: "none",
                  color: FUNCTION_TYPE_COLORS[f.type]?.border,
                  fontSize: 9,
                  padding: "0 4px",
                }}
              >
                {f.type}
              </Tag>
            </div>
          ))}
          {currentFunctions.length === 0 && (
            <Empty description={<span style={{ color: "#5a6a8a" }}>无匹配函数</span>} />
          )}
          {currentFunctions.length > 100 && (
            <div style={styles.moreHint}>仅显示前 100 条，请使用搜索过滤</div>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── 主组件 ──────────────────────────────────────────────────────────────────

const ModuleDetail: React.FC = () => {
  const {
    data,
    selectedModuleId,
    selectedFunctionId,
    setSelectedFunction,
    tracedPaths,
    selectedPathIndex,
  } = useFunctionCallStore();

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);

  // 当前选中的模块
  const currentModule = useMemo(
    () => data?.modules.find((m) => m.id === selectedModuleId),
    [data?.modules, selectedModuleId]
  );

  // 当前模块的函数
  const currentFunctions = useMemo(() => {
    if (!currentModule) return [];
    return filterFunctions(currentModule.functions, {
      searchText: search,
      types: typeFilter ? [typeFilter] : undefined,
    });
  }, [currentModule, search, typeFilter]);

  // 当前模块相关的调用链
  const currentCallChains = useMemo(() => {
    if (!data || !selectedModuleId) return [];
    return getModuleCallChains(selectedModuleId, data.call_chains);
  }, [data, selectedModuleId]);

  // 计算 Dagre 布局
  const layoutPositions = useMemo(() => {
    if (currentFunctions.length === 0) return new Map();
    return computeDagreLayout(currentFunctions, currentCallChains);
  }, [currentFunctions, currentCallChains]);

  // 路径高亮的节点 ID
  const pathNodeIds = useMemo(() => {
    if (!tracedPaths || selectedPathIndex === null) return new Set<string>();
    const path = tracedPaths[selectedPathIndex];
    return new Set(path.nodes.map((n) => n.id));
  }, [tracedPaths, selectedPathIndex]);

  // 转换为 ReactFlow 节点
  const initialNodes = useMemo((): Node[] => {
    return currentFunctions.map((func) => {
      const pos = layoutPositions.get(func.id) || { x: 0, y: 0 };
      const isCrossModule = currentCallChains.some(
        (c) =>
          (c.sourceFunctionId === func.id && c.targetModuleId !== selectedModuleId) ||
          (c.targetFunctionId === func.id && c.sourceModuleId !== selectedModuleId)
      );

      return {
        id: func.id,
        type: "functionNode",
        position: pos,
        data: {
          ...func,
          isCrossModule,
          isSelected: func.id === selectedFunctionId,
          isPathNode: pathNodeIds.has(func.id),
        },
      };
    });
  }, [currentFunctions, layoutPositions, currentCallChains, selectedModuleId, selectedFunctionId, pathNodeIds]);

  // 转换为 ReactFlow 边
  const initialEdges = useMemo((): Edge[] => {
    return currentCallChains
      .filter(
        (c) =>
          currentFunctions.some((f) => f.id === c.sourceFunctionId) &&
          currentFunctions.some((f) => f.id === c.targetFunctionId)
      )
      .map((chain, index) => {
        const isCross = chain.sourceModuleId !== chain.targetModuleId;
        const color = isCross ? EDGE_COLORS.cross_module : EDGE_COLORS.same_module;
        const inPath =
          pathNodeIds.has(chain.sourceFunctionId) && pathNodeIds.has(chain.targetFunctionId);

        return {
          id: `edge-${index}`,
          source: chain.sourceFunctionId,
          target: chain.targetFunctionId,
          type: "smoothstep",
          animated: isCross,
          style: {
            stroke: inPath ? "#00f084" : color,
            strokeWidth: inPath ? 2 : 1,
            opacity: inPath ? 1 : 0.5,
            strokeDasharray: isCross ? "5,5" : undefined,
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: inPath ? "#00f084" : color,
            width: 8,
            height: 8,
          },
        };
      });
  }, [currentCallChains, currentFunctions, pathNodeIds]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // 更新节点状态
  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  // 点击节点
  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      setSelectedFunction(node.id);
    },
    [setSelectedFunction]
  );

  if (!currentModule) {
    return (
      <div style={styles.empty}>
        <Empty description={<span style={{ color: "#5a6a8a" }}>请选择模块</span>} />
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* 左侧面板 */}
      <LeftPanel
        selectedModuleId={selectedModuleId || ""}
        search={search}
        onSearch={setSearch}
        typeFilter={typeFilter}
        onTypeFilter={setTypeFilter}
      />

      {/* 右侧图形区 */}
      <div style={styles.rightPanel}>
        <div style={{ width: "100%", height: "100%" }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.2 }}
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

            {/* 模块信息 */}
            <Panel position="top-left">
              <div style={styles.moduleInfo}>
                <div style={styles.moduleName}>{currentModule.name}</div>
                <div style={styles.moduleDesc}>{currentModule.displayName}</div>
                <div style={styles.moduleStats}>
                  {currentModule.functionCount} 函数 · {currentModule.callChainCount} 调用
                </div>
              </div>
            </Panel>

            {/* 图例 */}
            <Panel position="bottom-left">
              <div style={styles.legend}>
                <div style={styles.legendItem}>
                  <div style={{ ...styles.legendLine, background: EDGE_COLORS.same_module }} />
                  <span>同模块调用</span>
                </div>
                <div style={styles.legendItem}>
                  <div style={{ ...styles.legendLine, background: EDGE_COLORS.cross_module, borderStyle: "dashed" }} />
                  <span>跨模块调用</span>
                </div>
              </div>
            </Panel>
          </ReactFlow>
        </div>
      </div>
    </div>
  );
};

// ─── 样式 ────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    height: "100%",
    width: "100%",
  },
  leftPanel: {
    width: 240,
    background: "rgba(6,8,12,0.95)",
    borderRight: "1px solid rgba(255,255,255,0.04)",
    display: "flex",
    flexDirection: "column",
  },
  rightPanel: {
    flex: 1,
    position: "relative",
  },
  searchSection: {
    padding: "12px",
    borderBottom: "1px solid rgba(255,255,255,0.04)",
  },
  searchInput: {
    background: "rgba(0,0,0,0.3)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 4,
  },
  treeSection: {
    padding: "8px 12px",
    borderBottom: "1px solid rgba(255,255,255,0.04)",
    maxHeight: 200,
    overflow: "auto",
  },
  sectionTitle: {
    fontSize: 11,
    color: "#7888a8",
    fontFamily: "var(--font-mono)",
    letterSpacing: "0.05em",
    marginBottom: 8,
    display: "flex",
    alignItems: "center",
  },
  treeList: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  treeItem: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "6px 8px",
    borderRadius: 4,
    cursor: "pointer",
    transition: "all 0.15s ease",
  },
  treeItemName: {
    fontSize: 12,
    color: "#a8b8d8",
    fontFamily: "var(--font-mono)",
  },
  treeItemCount: {
    fontSize: 10,
    color: "#5a6a8a",
    fontFamily: "var(--font-mono)",
  },
  funcSection: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 12px",
    borderBottom: "1px solid rgba(255,255,255,0.04)",
  },
  funcList: {
    flex: 1,
    overflow: "auto",
    padding: "8px 12px",
  },
  funcItem: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "6px 8px",
    borderRadius: 4,
    cursor: "pointer",
    marginBottom: 2,
    transition: "all 0.15s ease",
  },
  funcName: {
    fontSize: 11,
    color: "#a8b8d8",
    fontFamily: "var(--font-mono)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    flex: 1,
    marginRight: 8,
  },
  moreHint: {
    fontSize: 10,
    color: "#5a6a8a",
    textAlign: "center",
    padding: "8px",
  },
  moduleInfo: {
    background: "rgba(10,13,20,0.9)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 8,
    padding: "12px 16px",
  },
  moduleName: {
    fontSize: 14,
    fontWeight: 600,
    color: "#00d4ff",
    fontFamily: "var(--font-mono)",
    marginBottom: 4,
  },
  moduleDesc: {
    fontSize: 11,
    color: "#7888a8",
    marginBottom: 8,
  },
  moduleStats: {
    fontSize: 10,
    color: "#5a6a8a",
  },
  legend: {
    background: "rgba(10,13,20,0.9)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 8,
    padding: "10px 14px",
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
  empty: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    width: "100%",
  },
};

export default ModuleDetail;
