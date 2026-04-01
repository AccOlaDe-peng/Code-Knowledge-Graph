/**
 * ModuleDetail - 模块详情视图
 *
 * 左侧：模块树 + 函数列表（按热度排序）
 * 右侧：函数调用图（热点函数优先，点击展开调用链）
 */
import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
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
import { Input, Select, Tag, Empty, Button, Slider, Switch, Tooltip } from "antd";
import {
  SearchOutlined,
  FolderOutlined,
  FunctionOutlined,
  CompressOutlined,
  FireOutlined,
} from "@ant-design/icons";
import { useFunctionCallStore } from "../../../../store/functionCallStore";
import { FUNCTION_TYPE_COLORS, EDGE_COLORS, type FunctionInfo, type CallChain } from "../../types";
import { computeDagreLayout } from "../../utils/layout";

// ─── 常量 ─────────────────────────────────────────────────────────────────────

const HOT_FUNCTIONS_LIMIT = 30; // 默认显示的热点函数数量
const MAX_EXPAND_DEPTH = 3; // 最大展开深度

// ─── 辅助函数 ──────────────────────────────────────────────────────────────────

/** 计算函数热度 */
function calculateHeat(func: FunctionInfo): number {
  return func.callerCount + func.calleeCount;
}

/** 按热度排序函数 */
function sortByHeat(functions: FunctionInfo[]): FunctionInfo[] {
  return [...functions].sort((a, b) => calculateHeat(b) - calculateHeat(a));
}

/** 获取热点函数 */
function getHotFunctions(functions: FunctionInfo[], limit: number): FunctionInfo[] {
  return sortByHeat(functions).slice(0, limit);
}

// ─── 函数节点组件 ────────────────────────────────────────────────────────────

const FunctionNode: React.FC<{
  data: FunctionInfo & {
    isExpanded?: boolean;
    isHot?: boolean;
    heat?: number;
  };
}> = ({ data }) => {
  const colors = FUNCTION_TYPE_COLORS[data.type] || FUNCTION_TYPE_COLORS.service;
  const heat = data.heat ?? calculateHeat(data);
  const isHot = data.isHot ?? (heat > 10);

  return (
    <div
      style={{
        padding: "8px 12px",
        background: isHot
          ? `linear-gradient(135deg, ${colors.border}15 0%, ${colors.border}05 100%)`
          : colors.bg,
        border: `1.5px solid ${isHot ? colors.border : `${colors.border}66`}`,
        borderRadius: 6,
        minWidth: 140,
        maxWidth: 180,
        cursor: "pointer",
        boxShadow: isHot ? `0 0 12px ${colors.border}30` : "0 2px 6px rgba(0,0,0,0.2)",
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
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        {isHot && <FireOutlined style={{ fontSize: 10, color: "#ffc145" }} />}
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

      {/* 热度和统计 */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <span style={{ fontSize: 9, color: "#ffc145" }}>热度</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: "#ffc145", fontFamily: "var(--font-mono)" }}>
            {heat}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <span style={{ fontSize: 9, color: "#5a6a8a" }}>被调</span>
          <span style={{ fontSize: 10, fontWeight: 500, color: "#00d4ff", fontFamily: "var(--font-mono)" }}>
            {data.callerCount}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <span style={{ fontSize: 9, color: "#5a6a8a" }}>调出</span>
          <span style={{ fontSize: 10, fontWeight: 500, color: "#00f084", fontFamily: "var(--font-mono)" }}>
            {data.calleeCount}
          </span>
        </div>
      </div>

      {/* 展开提示 */}
      <div
        style={{
          fontSize: 8,
          color: "#5a6a8a",
          marginTop: 4,
          textAlign: "center",
        }}
      >
        点击展开调用链
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
  onSelectFunction: (funcId: string) => void;
}> = ({ selectedModuleId, search, onSearch, typeFilter, onTypeFilter, onSelectFunction }) => {
  const { data, setSelectedModule, selectedFunctionId } = useFunctionCallStore();

  // 过滤当前模块的函数
  const currentFunctions = useMemo(() => {
    const module = data?.modules.find((m) => m.id === selectedModuleId);
    if (!module) return [];
    let result = [...module.functions];
    if (search) {
      const s = search.toLowerCase();
      result = result.filter(
        (f) =>
          f.name.toLowerCase().includes(s) ||
          f.fullName.toLowerCase().includes(s) ||
          f.className.toLowerCase().includes(s)
      );
    }
    if (typeFilter) {
      result = result.filter((f) => f.type === typeFilter);
    }
    return sortByHeat(result);
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

      {/* 函数列表（按热度排序） */}
      <div style={styles.funcSection}>
        <div style={styles.sectionHeader}>
          <div style={styles.sectionTitle}>
            <FunctionOutlined style={{ marginRight: 6 }} />
            函数列表（按热度）
          </div>
          <Select
            placeholder="类型"
            value={typeFilter}
            onChange={onTypeFilter}
            allowClear
            style={{ width: 90 }}
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
          {currentFunctions.slice(0, 100).map((f) => {
            const heat = calculateHeat(f);
            return (
              <div
                key={f.id}
                onClick={() => onSelectFunction(f.id)}
                style={{
                  ...styles.funcItem,
                  background: f.id === selectedFunctionId ? "rgba(0,212,255,0.1)" : "transparent",
                }}
              >
                <span style={styles.funcName}>
                  {heat > 10 && <FireOutlined style={{ fontSize: 9, color: "#ffc145", marginRight: 4 }} />}
                  {f.name}
                </span>
                <span style={styles.funcHeat}>{heat}</span>
                <Tag
                  style={{
                    background: `${FUNCTION_TYPE_COLORS[f.type]?.border}15`,
                    border: "none",
                    color: FUNCTION_TYPE_COLORS[f.type]?.border,
                    fontSize: 9,
                    padding: "0 4px",
                    marginLeft: 4,
                  }}
                >
                  {f.type}
                </Tag>
              </div>
            );
          })}
          {currentFunctions.length === 0 && (
            <Empty description={<span style={{ color: "#5a6a8a" }}>无匹配函数</span>} />
          )}
          {currentFunctions.length > 100 && (
            <div style={styles.moreHint}>仅显示前 100 条热点函数</div>
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
    setSelectedFunction,
    callersIndex,
    calleesIndex,
    funcInfoIndex,
  } = useFunctionCallStore();

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [showAllFunctions, setShowAllFunctions] = useState(false);
  const [hotFunctionsLimit, setHotFunctionsLimit] = useState(HOT_FUNCTIONS_LIMIT);

  // 展开的函数 ID 集合
  const [expandedFuncIds, setExpandedFuncIds] = useState<Set<string>>(new Set());
  const expandDepthRef = useRef<Map<string, number>>(new Map());

  // 当前选中的模块
  const currentModule = useMemo(
    () => data?.modules.find((m) => m.id === selectedModuleId),
    [data?.modules, selectedModuleId]
  );

  // 基础函数列表（热点函数）
  const baseFunctions = useMemo(() => {
    if (!currentModule) return [];
    if (showAllFunctions) {
      return sortByHeat(currentModule.functions);
    }
    return getHotFunctions(currentModule.functions, hotFunctionsLimit);
  }, [currentModule, showAllFunctions, hotFunctionsLimit]);

  // 计算图中应该显示的函数（基础 + 展开的调用链）
  const displayedFunctions = useMemo(() => {
    const result = new Map<string, FunctionInfo>();

    // 添加基础函数
    for (const func of baseFunctions) {
      result.set(func.id, func);
    }

    // 添加展开的函数
    for (const funcId of expandedFuncIds) {
      const func = funcInfoIndex?.get(funcId);
      if (func) {
        result.set(funcId, func);
      }
    }

    return result;
  }, [baseFunctions, expandedFuncIds, funcInfoIndex]);

  // 获取与显示函数相关的调用链
  const displayedCallChains = useMemo(() => {
    if (!data?.call_chains) return [];

    const funcIds = new Set(displayedFunctions.keys());
    const result: CallChain[] = [];

    for (const chain of data.call_chains) {
      const sourceInGraph = funcIds.has(chain.sourceFunctionId);
      const targetInGraph = funcIds.has(chain.targetFunctionId);

      // 至少有一端在图中
      if (sourceInGraph || targetInGraph) {
        result.push(chain);
      }
    }

    return result;
  }, [data?.call_chains, displayedFunctions]);

  // 计算 Dagre 布局
  const layoutPositions = useMemo(() => {
    const funcs = Array.from(displayedFunctions.values());
    if (funcs.length === 0) return new Map();
    return computeDagreLayout(funcs, displayedCallChains);
  }, [displayedFunctions, displayedCallChains]);

  // 转换为 ReactFlow 节点
  const initialNodes = useMemo((): Node[] => {
    return Array.from(displayedFunctions.values()).map((func) => {
      const pos = layoutPositions.get(func.id) || { x: 0, y: 0 };
      const heat = calculateHeat(func);
      const isHot = heat > 10;
      const isExpanded = expandedFuncIds.has(func.id);

      return {
        id: func.id,
        type: "functionNode",
        position: pos,
        data: {
          ...func,
          heat,
          isHot,
          isExpanded,
        },
      };
    });
  }, [displayedFunctions, layoutPositions, expandedFuncIds]);

  // 转换为 ReactFlow 边
  const initialEdges = useMemo((): Edge[] => {
    const funcIds = new Set(displayedFunctions.keys());

    return displayedCallChains
      .filter((c) => funcIds.has(c.sourceFunctionId) && funcIds.has(c.targetFunctionId))
      .map((chain, index) => {
        const isCross = chain.sourceModuleId !== chain.targetModuleId;
        const color = isCross ? EDGE_COLORS.cross_module : EDGE_COLORS.same_module;

        return {
          id: `edge-${index}`,
          source: chain.sourceFunctionId,
          target: chain.targetFunctionId,
          type: "smoothstep",
          animated: isCross,
          style: {
            stroke: color,
            strokeWidth: 1.5,
            opacity: 0.7,
            strokeDasharray: isCross ? "5,5" : undefined,
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color,
            width: 8,
            height: 8,
          },
        };
      });
  }, [displayedCallChains, displayedFunctions]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // 更新节点和边
  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  // 点击节点展开调用链
  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const funcId = node.id;
      const currentDepth = expandDepthRef.current.get(funcId) ?? 0;

      if (currentDepth >= MAX_EXPAND_DEPTH) {
        // 已达到最大深度，不再展开
        return;
      }

      // 获取调用者和被调用者
      const callers = callersIndex?.get(funcId) ?? [];
      const callees = calleesIndex?.get(funcId) ?? [];

      // 收集要添加的函数 ID
      const newFuncIds = new Set<string>();

      for (const chain of callers) {
        if (!displayedFunctions.has(chain.sourceFunctionId)) {
          newFuncIds.add(chain.sourceFunctionId);
        }
      }

      for (const chain of callees) {
        if (!displayedFunctions.has(chain.targetFunctionId)) {
          newFuncIds.add(chain.targetFunctionId);
        }
      }

      if (newFuncIds.size > 0) {
        // 更新展开状态
        setExpandedFuncIds((prev) => {
          const next = new Set(prev);
          for (const id of newFuncIds) {
            next.add(id);
            expandDepthRef.current.set(id, currentDepth + 1);
          }
          return next;
        });
      }

      // 同时设置选中的函数
      setSelectedFunction(funcId);
    },
    [callersIndex, calleesIndex, displayedFunctions, setSelectedFunction]
  );

  // 重置展开状态
  const handleResetExpand = useCallback(() => {
    setExpandedFuncIds(new Set());
    expandDepthRef.current.clear();
  }, []);

  // 从左侧列表选择函数
  const handleSelectFunction = useCallback(
    (funcId: string) => {
      setSelectedFunction(funcId);
      // 自动展开该函数的调用链
      const callers = callersIndex?.get(funcId) ?? [];
      const callees = calleesIndex?.get(funcId) ?? [];

      const newFuncIds = new Set<string>();
      for (const chain of callers) {
        newFuncIds.add(chain.sourceFunctionId);
      }
      for (const chain of callees) {
        newFuncIds.add(chain.targetFunctionId);
      }

      if (newFuncIds.size > 0) {
        setExpandedFuncIds((prev) => {
          const next = new Set(prev);
          for (const id of newFuncIds) {
            next.add(id);
            expandDepthRef.current.set(id, 1);
          }
          return next;
        });
      }
    },
    [setSelectedFunction, callersIndex, calleesIndex]
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
        onSelectFunction={handleSelectFunction}
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
                  {currentModule.functionCount} 函数 · 显示 {displayedFunctions.size} 个
                </div>
              </div>
            </Panel>

            {/* 控制面板 */}
            <Panel position="top-right">
              <div style={styles.controlPanel}>
                <div style={styles.controlRow}>
                  <span style={styles.controlLabel}>显示全部</span>
                  <Switch
                    checked={showAllFunctions}
                    onChange={setShowAllFunctions}
                    size="small"
                  />
                </div>

                {!showAllFunctions && (
                  <div style={styles.controlRow}>
                    <span style={styles.controlLabel}>热点数量</span>
                    <Slider
                      value={hotFunctionsLimit}
                      onChange={setHotFunctionsLimit}
                      min={10}
                      max={100}
                      step={10}
                      style={{ width: 100 }}
                    />
                    <span style={styles.controlValue}>{hotFunctionsLimit}</span>
                  </div>
                )}

                <div style={styles.controlRow}>
                  <Tooltip title="重置展开的调用链">
                    <Button
                      size="small"
                      icon={<CompressOutlined />}
                      onClick={handleResetExpand}
                    >
                      重置
                    </Button>
                  </Tooltip>
                </div>

                <div style={styles.expandHint}>
                  已展开 {expandedFuncIds.size} 个函数
                </div>
              </div>
            </Panel>

            {/* 图例 */}
            <Panel position="bottom-left">
              <div style={styles.legend}>
                <div style={styles.legendItem}>
                  <FireOutlined style={{ color: "#ffc145", fontSize: 10 }} />
                  <span>热点函数</span>
                </div>
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
    width: 260,
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
    maxHeight: 180,
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
  funcHeat: {
    fontSize: 10,
    color: "#ffc145",
    fontFamily: "var(--font-mono)",
    fontWeight: 600,
    minWidth: 20,
    textAlign: "right",
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
  controlPanel: {
    background: "rgba(10,13,20,0.9)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 8,
    padding: "12px 16px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  controlRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  controlLabel: {
    fontSize: 11,
    color: "#7888a8",
    minWidth: 60,
  },
  controlValue: {
    fontSize: 11,
    color: "#00d4ff",
    fontFamily: "var(--font-mono)",
    minWidth: 30,
    textAlign: "right",
  },
  expandHint: {
    fontSize: 10,
    color: "#5a6a8a",
    textAlign: "center",
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
