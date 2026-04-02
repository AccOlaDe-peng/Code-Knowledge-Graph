/**
 * ModuleDetail - 模块详情视图
 *
 * 左侧：控制面板 + 模块树 + 函数列表（按热度排序）
 * 右侧：函数调用图（热点函数优先，点击展开调用链）或调用链视图
 */
import React, {
  useState,
  useMemo,
  useCallback,
  useEffect,
  useRef,
} from "react";
import {
  ReactFlow,
  Controls,
  Background,
  Handle,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
  MarkerType,
  Panel,
  Position,
} from "reactflow";
import type { Node, Edge } from "reactflow";
import "reactflow/dist/style.css";
import {
  Input,
  Select,
  Tag,
  Empty,
  Button,
  Slider,
  Switch,
  Tooltip,
  Spin,
  Radio,
} from "antd";
import {
  SearchOutlined,
  FolderOutlined,
  FunctionOutlined,
  FireOutlined,
  ReloadOutlined,
  ApartmentOutlined,
} from "@ant-design/icons";
import { useFunctionCallStore } from "../../../../store/functionCallStore";
import {
  FUNCTION_TYPE_COLORS,
  EDGE_COLORS,
  type FunctionInfo,
} from "../../types";
import { computeDagreLayout } from "../../utils/layout";
import CallChainView from "./CallChainView";

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

// ─── 函数节点组件 ────────────────────────────────────────────────────────────

const FunctionNode: React.FC<{
  data: FunctionInfo & {
    isExpanded?: boolean;
    isHot?: boolean;
    heat?: number;
  };
}> = ({ data }) => {
  const colors =
    FUNCTION_TYPE_COLORS[data.type] || FUNCTION_TYPE_COLORS.service;
  const heat = data.heat ?? calculateHeat(data);
  const isHot = data.isHot ?? heat > 10;

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
        boxShadow: isHot
          ? `0 0 12px ${colors.border}30`
          : "0 2px 6px rgba(0,0,0,0.2)",
        transition: "all 0.15s ease",
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ opacity: 0, width: 8, height: 8, border: "none" }}
        isConnectable={false}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{ opacity: 0, width: 8, height: 8, border: "none" }}
        isConnectable={false}
      />

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
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "#ffc145",
              fontFamily: "var(--font-mono)",
            }}
          >
            {heat}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <span style={{ fontSize: 9, color: "#5a6a8a" }}>被调</span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 500,
              color: "#00d4ff",
              fontFamily: "var(--font-mono)",
            }}
          >
            {data.callerCount}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <span style={{ fontSize: 9, color: "#5a6a8a" }}>调出</span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 500,
              color: "#00f084",
              fontFamily: "var(--font-mono)",
            }}
          >
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

// ─── 主组件 ──────────────────────────────────────────────────────────────────

const ModuleDetail: React.FC = () => {
  const {
    overview,
    currentModuleId,
    moduleDetails,
    moduleLoading,
    setSelectedFunction,
    setDrawerFunction,
    callersIndex,
    calleesIndex,
    funcInfoIndex,
    setSelectedModule,
    selectedFunctionId,
    loadModuleDetail,
    // 调用链视图状态
    viewMode,
    setViewMode,
    callChainRootId,
    setCallChainRoot,
    resetCallChain,
  } = useFunctionCallStore();

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [showAllFunctions, setShowAllFunctions] = useState(false);
  const [hotFunctionsLimit, setHotFunctionsLimit] =
    useState(HOT_FUNCTIONS_LIMIT);
  const [hoveredFunctionId, setHoveredFunctionId] = useState<string | null>(
    null,
  );

  // 展开的函数 ID 集合
  const [expandedFuncIds, setExpandedFuncIds] = useState<Set<string>>(
    new Set(),
  );
  const expandDepthRef = useRef<Map<string, number>>(new Map());

  // 当前选中的模块详情
  const currentModuleDetail = currentModuleId
    ? moduleDetails.get(currentModuleId)
    : null;
  const currentModule = currentModuleDetail?.module;
  const callChains = currentModuleDetail?.callChains ?? [];

  // 当前模块的函数（过滤后）
  const filteredFunctions = useMemo(() => {
    if (!currentModule) return [];
    let result = [...currentModule.functions];
    if (search) {
      const s = search.toLowerCase();
      result = result.filter(
        (f) =>
          f.name.toLowerCase().includes(s) ||
          f.fullName.toLowerCase().includes(s) ||
          f.className.toLowerCase().includes(s),
      );
    }
    if (typeFilter) {
      result = result.filter((f) => f.type === typeFilter);
    }
    return result;
  }, [currentModule, search, typeFilter]);

  // 按热度排序后的函数列表
  const sortedFunctions = useMemo(
    () => sortByHeat(filteredFunctions),
    [filteredFunctions],
  );

  // 中间节点（既有 callers 又有 callees 的函数，优先显示）
  const middleNodes = useMemo(() => {
    return sortedFunctions.filter(
      (f) => f.callerCount > 0 && f.calleeCount > 0,
    );
  }, [sortedFunctions]);

  // 基础函数列表（优先中间节点，再补充热点函数）
  const baseFunctions = useMemo(() => {
    if (showAllFunctions) {
      return sortedFunctions;
    }

    // 优先选择中间节点（最多占 2/3）
    const middleNodeLimit = Math.floor(hotFunctionsLimit * 0.67);
    const selectedMiddle = middleNodes.slice(0, middleNodeLimit);

    // 再补充其他热点函数
    const selectedIds = new Set(selectedMiddle.map((f) => f.id));
    const remaining = sortedFunctions.filter((f) => !selectedIds.has(f.id));
    const remainingCount = hotFunctionsLimit - selectedMiddle.length;

    return [...selectedMiddle, ...remaining.slice(0, remainingCount)];
  }, [sortedFunctions, middleNodes, showAllFunctions, hotFunctionsLimit]);

  // 获取当前模块相关的调用链（包括模块内部调用和跨模块调用）
  const moduleCallChains = useMemo(() => {
    if (!callChains || !currentModule) return [];

    return callChains.filter(
      (chain) =>
        chain.sourceModuleId === currentModule.id ||
        chain.targetModuleId === currentModule.id,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callChains, currentModule?.id]);

  // 计算图中应该显示的函数（基础函数 + 展开函数的直接关联函数）
  const displayedFunctions = useMemo(() => {
    const result = new Map<string, FunctionInfo>();

    // 添加基础函数（热点函数）
    for (const func of baseFunctions) {
      result.set(func.id, func);
    }

    // 只添加与基础函数直接相关的调用链中的外部函数
    // 限制数量以避免性能问题
    const baseFuncIds = new Set(baseFunctions.map((f) => f.id));
    let externalAdded = 0;
    const MAX_EXTERNAL = 50; // 限制外部函数数量

    for (const chain of moduleCallChains) {
      // 只有当基础函数是调用链的一端时，才添加另一端的函数
      const sourceInBase = baseFuncIds.has(chain.sourceFunctionId);
      const targetInBase = baseFuncIds.has(chain.targetFunctionId);

      if (sourceInBase && !targetInBase && externalAdded < MAX_EXTERNAL) {
        // 源函数在基础集合中，添加目标函数
        const targetFunc = funcInfoIndex?.get(chain.targetFunctionId);
        if (targetFunc && !result.has(chain.targetFunctionId)) {
          result.set(chain.targetFunctionId, targetFunc);
          externalAdded++;
        }
      } else if (
        targetInBase &&
        !sourceInBase &&
        externalAdded < MAX_EXTERNAL
      ) {
        // 目标函数在基础集合中，添加源函数
        const sourceFunc = funcInfoIndex?.get(chain.sourceFunctionId);
        if (sourceFunc && !result.has(chain.sourceFunctionId)) {
          result.set(chain.sourceFunctionId, sourceFunc);
          externalAdded++;
        }
      }
    }

    // 添加展开的函数
    for (const funcId of expandedFuncIds) {
      const func = funcInfoIndex?.get(funcId);
      if (func) {
        result.set(funcId, func);
      }
    }

    return result;
  }, [baseFunctions, moduleCallChains, funcInfoIndex, expandedFuncIds]);

  // 获取与显示函数相关的调用链（两端都在显示函数集合中）
  const displayedCallChains = useMemo(() => {
    if (!callChains) return [];

    const funcIds = new Set(displayedFunctions.keys());

    // 只保留两端函数都在图中的调用链
    return callChains.filter(
      (chain) =>
        funcIds.has(chain.sourceFunctionId) &&
        funcIds.has(chain.targetFunctionId),
    );
  }, [callChains, displayedFunctions]);

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

    // 只渲染两端函数都在图中的调用链
    // 注意：displayedCallChains 可能包含外部函数调用（一端在图中，一端不在）
    // 这些边不应该被渲染，因为目标节点不存在
    return displayedCallChains
      .filter(
        (c) =>
          funcIds.has(c.sourceFunctionId) && funcIds.has(c.targetFunctionId),
      )
      .map((chain, index) => {
        const isCross = chain.sourceModuleId !== chain.targetModuleId;
        const color = isCross
          ? EDGE_COLORS.cross_module
          : EDGE_COLORS.same_module;

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

  const hoverRelatedNodeIds = useMemo(() => {
    if (!hoveredFunctionId) return null;

    const related = new Set<string>([hoveredFunctionId]);
    for (const chain of displayedCallChains) {
      if (chain.sourceFunctionId === hoveredFunctionId) {
        related.add(chain.targetFunctionId);
      }
      if (chain.targetFunctionId === hoveredFunctionId) {
        related.add(chain.sourceFunctionId);
      }
    }
    return related;
  }, [hoveredFunctionId, displayedCallChains]);

  const renderNodes = useMemo(() => {
    if (!hoverRelatedNodeIds || !hoveredFunctionId) return nodes;

    return nodes.map((node) => ({
      ...node,
      style: {
        ...(node.style || {}),
        opacity: hoverRelatedNodeIds.has(node.id) ? 1 : 0.2,
        transition: "opacity 0.15s ease",
      },
    }));
  }, [nodes, hoverRelatedNodeIds, hoveredFunctionId]);

  const renderEdges = useMemo(() => {
    if (!hoveredFunctionId) return edges;

    return edges.map((edge) => {
      const isRelated =
        edge.source === hoveredFunctionId || edge.target === hoveredFunctionId;

      return {
        ...edge,
        style: {
          ...(edge.style || {}),
          opacity: isRelated ? 0.9 : 0.08,
          transition: "opacity 0.15s ease",
        },
      };
    });
  }, [edges, hoveredFunctionId]);

  // 更新节点和边
  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  // 模块切换时自动展开前几个中间节点的调用链
  // 只在模块 ID 变化时执行，避免其他依赖项变化导致的重复执行
  useEffect(() => {
    if (!currentModule?.id || !callersIndex || !calleesIndex || !funcInfoIndex)
      return;

    // 使用 requestAnimationFrame 避免同步 setState
    const timeoutId = setTimeout(() => {
      // 重置展开状态
      setExpandedFuncIds(new Set());
      expandDepthRef.current.clear();

      // 找前 5 个中间节点并自动展开
      const topMiddleNodes = middleNodes.slice(0, 5);
      const newExpanded = new Set<string>();

      for (const func of topMiddleNodes) {
        // 展开调用者
        const callers = callersIndex.get(func.id) ?? [];
        for (const chain of callers.slice(0, 3)) {
          if (funcInfoIndex.has(chain.sourceFunctionId)) {
            newExpanded.add(chain.sourceFunctionId);
            expandDepthRef.current.set(chain.sourceFunctionId, 1);
          }
        }

        // 展开被调用者
        const callees = calleesIndex.get(func.id) ?? [];
        for (const chain of callees.slice(0, 5)) {
          if (funcInfoIndex.has(chain.targetFunctionId)) {
            newExpanded.add(chain.targetFunctionId);
            expandDepthRef.current.set(chain.targetFunctionId, 1);
          }
        }
      }

      if (newExpanded.size > 0) {
        setExpandedFuncIds(newExpanded);
      }
    }, 50); // 增加延迟，等待状态稳定

    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentModule?.id]); // 只依赖模块 ID，其他数据通过 ref 或直接访问获取

  // 点击节点展开调用链
  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const funcId = node.id;
      const currentDepth = expandDepthRef.current.get(funcId) ?? 0;

      if (currentDepth >= MAX_EXPAND_DEPTH) {
        return;
      }

      const callers = callersIndex?.get(funcId) ?? [];
      const callees = calleesIndex?.get(funcId) ?? [];

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
        setExpandedFuncIds((prev) => {
          const next = new Set(prev);
          for (const id of newFuncIds) {
            next.add(id);
            expandDepthRef.current.set(id, currentDepth + 1);
          }
          return next;
        });
      }

      setSelectedFunction(funcId);
      setDrawerFunction(funcId);
    },
    [
      callersIndex,
      calleesIndex,
      displayedFunctions,
      setSelectedFunction,
      setDrawerFunction,
    ],
  );

  const onNodeMouseEnter = useCallback((_: React.MouseEvent, node: Node) => {
    setHoveredFunctionId(node.id);
  }, []);

  const onNodeMouseLeave = useCallback(() => {
    setHoveredFunctionId(null);
  }, []);

  // 重置展开状态
  const handleResetExpand = useCallback(() => {
    setExpandedFuncIds(new Set());
    expandDepthRef.current.clear();
    resetCallChain();
  }, [resetCallChain]);

  // 从左侧列表选择函数
  const handleSelectFunction = useCallback(
    (funcId: string) => {
      setSelectedFunction(funcId);

      // 在调用链模式下，设置调用链根节点
      if (viewMode === "callchain") {
        setCallChainRoot(funcId);
        return;
      }

      // 热点图模式下，展开调用链
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
    [
      setSelectedFunction,
      callersIndex,
      calleesIndex,
      viewMode,
      setCallChainRoot,
    ],
  );

  // 加载中状态
  if (moduleLoading) {
    return (
      <div style={styles.loading}>
        <Spin size="large" />
        <span style={{ color: "#7888a8", marginTop: 16 }}>加载模块详情...</span>
      </div>
    );
  }

  if (!currentModule) {
    return (
      <div style={styles.empty}>
        <Empty
          description={<span style={{ color: "#5a6a8a" }}>请选择模块</span>}
        />
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* 左侧面板 */}
      <div style={styles.leftPanel}>
        {/* 控制面板 */}
        <div style={styles.controlPanel}>
          <div style={styles.controlHeader}>
            <span style={styles.controlTitle}>显示设置</span>
            <Tooltip title="重置当前视图">
              <Button
                size="small"
                icon={<ReloadOutlined />}
                onClick={handleResetExpand}
                style={{ fontSize: 11 }}
              >
                重置
              </Button>
            </Tooltip>
          </div>

          {/* 视图模式切换 */}
          <div style={styles.modeSwitch}>
            <Radio.Group
              value={viewMode}
              onChange={(e) => setViewMode(e.target.value)}
              size="small"
              optionType="button"
              buttonStyle="solid"
              style={{ width: "100%" }}
            >
              <Radio.Button value="heatmap" style={styles.modeButton}>
                <FireOutlined style={{ marginRight: 4 }} />
                热点图
              </Radio.Button>
              <Radio.Button value="callchain" style={styles.modeButton}>
                <ApartmentOutlined style={{ marginRight: 4 }} />
                调用链
              </Radio.Button>
            </Radio.Group>
          </div>

          {/* 热点图模式的设置 */}
          {viewMode === "heatmap" && (
            <>
              <div style={styles.controlRow}>
                <span style={styles.controlLabel}>显示全部函数</span>
                <Switch
                  checked={showAllFunctions}
                  onChange={setShowAllFunctions}
                  size="small"
                />
              </div>
              {!showAllFunctions && (
                <div style={styles.controlRow}>
                  <span style={styles.controlLabel}>
                    热点数量: {hotFunctionsLimit}
                  </span>
                  <Slider
                    value={hotFunctionsLimit}
                    onChange={setHotFunctionsLimit}
                    min={10}
                    max={100}
                    step={10}
                    style={{ flex: 1, marginLeft: 8 }}
                  />
                </div>
              )}
              <div style={styles.expandInfo}>
                已展开 {expandedFuncIds.size} 个函数
              </div>
            </>
          )}

          {/* 调用链模式的提示 */}
          {viewMode === "callchain" && (
            <div style={styles.callChainHint}>
              {callChainRootId ? (
                <span>点击函数查看调用链</span>
              ) : (
                <span style={{ color: "#ffc145" }}>请选择函数查看调用链</span>
              )}
            </div>
          )}
        </div>

        {/* 搜索 */}
        <div style={styles.searchSection}>
          <Input
            placeholder="搜索函数..."
            prefix={<SearchOutlined style={{ color: "#5a6a8a" }} />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
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
            {overview?.modules.map((m) => (
              <div
                key={m.id}
                onClick={async () => {
                  if (m.id !== currentModuleId && overview?.repo_id) {
                    setSelectedModule(m.id);
                    await loadModuleDetail(overview.repo_id, m.id);
                  }
                }}
                style={{
                  ...styles.treeItem,
                  background:
                    m.id === currentModuleId
                      ? "rgba(0,212,255,0.1)"
                      : "transparent",
                  borderLeft:
                    m.id === currentModuleId
                      ? "2px solid #00d4ff"
                      : "2px solid transparent",
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
              函数列表（按热度）
            </div>
            <Select
              placeholder="类型"
              value={typeFilter}
              onChange={setTypeFilter}
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
            {sortedFunctions.slice(0, 100).map((f) => {
              const heat = calculateHeat(f);
              return (
                <div
                  key={f.id}
                  onClick={() => handleSelectFunction(f.id)}
                  style={{
                    ...styles.funcItem,
                    background:
                      f.id === selectedFunctionId
                        ? "rgba(0,212,255,0.1)"
                        : "transparent",
                  }}
                >
                  <span style={styles.funcName}>
                    {heat > 10 && (
                      <FireOutlined
                        style={{
                          fontSize: 9,
                          color: "#ffc145",
                          marginRight: 4,
                        }}
                      />
                    )}
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
            {sortedFunctions.length === 0 && (
              <Empty
                description={
                  <span style={{ color: "#5a6a8a" }}>无匹配函数</span>
                }
              />
            )}
            {sortedFunctions.length > 100 && (
              <div style={styles.moreHint}>仅显示前 100 条热点函数</div>
            )}
          </div>
        </div>
      </div>

      {/* 右侧图形区 */}
      <div style={styles.rightPanel}>
        {viewMode === "callchain" ? (
          <CallChainView />
        ) : (
          <div style={{ width: "100%", height: "100%" }}>
            <ReactFlow
              nodes={renderNodes}
              edges={renderEdges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={onNodeClick}
              onNodeMouseEnter={onNodeMouseEnter}
              onNodeMouseLeave={onNodeMouseLeave}
              onPaneMouseLeave={onNodeMouseLeave}
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
                  <div style={styles.moduleDesc}>
                    {currentModule.displayName}
                  </div>
                  <div style={styles.moduleStats}>
                    {currentModule.functions.length} 函数 · 显示{" "}
                    {displayedFunctions.size} 个
                  </div>
                </div>
              </Panel>

              {/* 图例 */}
              <Panel position="bottom-left">
                <div style={styles.legend}>
                  <div style={styles.legendItem}>
                    <FireOutlined style={{ color: "#ffc145", fontSize: 10 }} />
                    <span>热点函数（热度&gt;10）</span>
                  </div>
                  <div style={styles.legendItem}>
                    <div
                      style={{
                        ...styles.legendLine,
                        background: EDGE_COLORS.same_module,
                      }}
                    />
                    <span>同模块调用</span>
                  </div>
                  <div style={styles.legendItem}>
                    <div
                      style={{
                        ...styles.legendLine,
                        background: EDGE_COLORS.cross_module,
                        borderStyle: "dashed",
                      }}
                    />
                    <span>跨模块调用</span>
                  </div>
                </div>
              </Panel>
            </ReactFlow>
          </div>
        )}
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
  loading: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    width: "100%",
  },
  // 控制面板
  controlPanel: {
    padding: "12px 14px",
    borderBottom: "1px solid rgba(255,255,255,0.04)",
    background: "rgba(0,20,40,0.3)",
  },
  controlHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  controlTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: "#00d4ff",
    fontFamily: "var(--font-mono)",
  },
  controlRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  controlLabel: {
    fontSize: 11,
    color: "#a8b8d8",
  },
  modeSwitch: {
    marginBottom: 10,
  },
  modeButton: {
    width: "50%",
    textAlign: "center" as const,
    fontSize: 11,
  },
  callChainHint: {
    fontSize: 10,
    color: "#7888a8",
    textAlign: "center",
    marginTop: 8,
    padding: "6px 8px",
    background: "rgba(0,0,0,0.2)",
    borderRadius: 4,
  },
  expandInfo: {
    fontSize: 10,
    color: "#5a6a8a",
    textAlign: "center",
    marginTop: 4,
  },
  // 搜索
  searchSection: {
    padding: "10px 14px",
    borderBottom: "1px solid rgba(255,255,255,0.04)",
  },
  searchInput: {
    background: "rgba(0,0,0,0.3)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 4,
    fontSize: 12,
  },
  // 模块树
  treeSection: {
    padding: "8px 14px",
    borderBottom: "1px solid rgba(255,255,255,0.04)",
    maxHeight: 150,
    overflow: "auto",
  },
  sectionTitle: {
    fontSize: 11,
    color: "#7888a8",
    fontFamily: "var(--font-mono)",
    letterSpacing: "0.05em",
    marginBottom: 6,
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
    padding: "5px 8px",
    borderRadius: 4,
    cursor: "pointer",
    transition: "all 0.15s ease",
  },
  treeItemName: {
    fontSize: 11,
    color: "#a8b8d8",
    fontFamily: "var(--font-mono)",
  },
  treeItemCount: {
    fontSize: 10,
    color: "#5a6a8a",
    fontFamily: "var(--font-mono)",
  },
  // 函数列表
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
    padding: "8px 14px",
    borderBottom: "1px solid rgba(255,255,255,0.04)",
  },
  funcList: {
    flex: 1,
    overflow: "auto",
    padding: "8px 14px",
  },
  funcItem: {
    display: "flex",
    alignItems: "center",
    padding: "5px 8px",
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
    marginRight: 6,
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
  // 模块信息
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
  // 图例
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
