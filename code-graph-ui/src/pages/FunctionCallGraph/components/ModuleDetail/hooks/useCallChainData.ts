/**
 * useCallChainData - 调用链数据处理 Hook
 *
 * 功能：
 * 1. BFS 遍历获取完整调用链
 * 2. 智能折叠远距离节点
 * 3. 检测循环调用
 */
import { useMemo } from "react";
import type {
  FunctionInfo,
  CallChain,
  CallChainNodeData,
  CallChainEdgeData,
} from "../../../types";
import { useFunctionCallStore } from "../../../../../store/functionCallStore";

// ─── 常量 ─────────────────────────────────────────────────────────────────────

const DEFAULT_MAX_DEPTH = 3;  // 默认展开深度
const LARGE_NODE_THRESHOLD = 200;  // 大量节点阈值

// ─── 类型定义 ────────────────────────────────────────────────────────────────

interface UseCallChainDataResult {
  nodes: CallChainNodeData[];
  edges: CallChainEdgeData[];
  collapsedInfo: Map<string, { count: number; distance: number; direction: "caller" | "callee" }>;
  hasCycle: boolean;
  cycleEdges: Set<string>;  // 循环调用边 ID
  totalNodes: number;  // 总节点数（包括折叠的）
}

// ─── 辅助函数 ────────────────────────────────────────────────────────────────

/**
 * BFS 遍历获取调用链
 */
function traverseCallChain(
  rootId: string,
  callersIndex: Map<string, CallChain[]>,
  calleesIndex: Map<string, CallChain[]>,
  funcInfoIndex: Map<string, FunctionInfo>,
  maxDepth: number,
  collapsedNodes: Set<string>
): {
  nodes: Map<string, CallChainNodeData>;
  edges: Map<string, { edge: CallChainEdgeData; chain: CallChain }>;
  collapsedInfo: Map<string, { count: number; distance: number; direction: "caller" | "callee" }>;
  hasCycle: boolean;
  cycleEdges: Set<string>;
  totalNodes: number;
} {
  const nodes = new Map<string, CallChainNodeData>();
  const edges = new Map<string, { edge: CallChainEdgeData; chain: CallChain }>();
  const collapsedInfo = new Map<string, { count: number; distance: number; direction: "caller" | "callee" }>();
  const visited = new Set<string>();
  const cycleEdges = new Set<string>();
  let hasCycle = false;
  let totalNodes = 0;

  // 获取根节点信息
  const rootFunc = funcInfoIndex.get(rootId);
  if (!rootFunc) {
    return { nodes, edges, collapsedInfo, hasCycle, cycleEdges, totalNodes: 0 };
  }

  // 添加根节点
  nodes.set(rootId, {
    ...rootFunc,
    distance: 0,
    direction: "root",
    isRoot: true,
  });
  visited.add(rootId);
  totalNodes = 1;

  // BFS 队列：[函数ID, 距离, 方向]
  const queue: Array<{ id: string; distance: number; direction: "caller" | "callee" }> = [];

  // 初始化：添加根节点的直接调用者和被调用者
  const rootCallers = callersIndex.get(rootId) || [];
  const rootCallees = calleesIndex.get(rootId) || [];

  for (const chain of rootCallers) {
    const callerId = chain.sourceFunctionId;
    if (!visited.has(callerId) && funcInfoIndex.has(callerId)) {
      queue.push({ id: callerId, distance: 1, direction: "caller" });
    }
    // 添加边
    const edgeId = `${callerId}->${rootId}`;
    if (!edges.has(edgeId)) {
      edges.set(edgeId, {
        edge: {
          sourceLine: chain.sourceLine,
          callType: chain.callType,
          isCrossModule: chain.sourceModuleId !== chain.targetModuleId,
        },
        chain,
      });
    }
  }

  for (const chain of rootCallees) {
    const calleeId = chain.targetFunctionId;
    if (!visited.has(calleeId) && funcInfoIndex.has(calleeId)) {
      queue.push({ id: calleeId, distance: 1, direction: "callee" });
    }
    // 添加边
    const edgeId = `${rootId}->${calleeId}`;
    if (!edges.has(edgeId)) {
      edges.set(edgeId, {
        edge: {
          sourceLine: chain.sourceLine,
          callType: chain.callType,
          isCrossModule: chain.sourceModuleId !== chain.targetModuleId,
        },
        chain,
      });
    }
  }

  // BFS 遍历
  const collapsedCounts = new Map<string, number>();

  while (queue.length > 0) {
    const { id, distance, direction } = queue.shift()!;

    // 检查是否已访问（循环检测）
    if (visited.has(id)) {
      hasCycle = true;
      // 标记循环边
      const cycleEdgeId = direction === "caller"
        ? `${id}->${rootId}`
        : `${rootId}->${id}`;
      cycleEdges.add(cycleEdgeId);
      continue;
    }

    totalNodes++;

    // 检查是否超过最大深度（折叠）
    if (distance > maxDepth && !collapsedNodes.has(`collapsed-${direction}-${distance}`)) {
      // 统计折叠节点
      const collapseKey = `collapsed-${direction}-${distance}`;
      collapsedCounts.set(collapseKey, (collapsedCounts.get(collapseKey) || 0) + 1);
      continue;
    }

    // 添加节点
    const func = funcInfoIndex.get(id);
    if (func) {
      nodes.set(id, {
        ...func,
        distance,
        direction,
        isRoot: false,
      });
      visited.add(id);

      // 继续遍历
      if (distance < maxDepth || collapsedNodes.has(`collapsed-${direction}-${distance + 1}`)) {
        const callers = callersIndex.get(id) || [];
        const callees = calleesIndex.get(id) || [];

        for (const chain of callers) {
          const callerId = chain.sourceFunctionId;
          const edgeId = `${callerId}->${id}`;

          if (!edges.has(edgeId)) {
            edges.set(edgeId, {
              edge: {
                sourceLine: chain.sourceLine,
                callType: chain.callType,
                isCrossModule: chain.sourceModuleId !== chain.targetModuleId,
              },
              chain,
            });
          }

          if (funcInfoIndex.has(callerId)) {
            queue.push({ id: callerId, distance: distance + 1, direction: "caller" });
          }
        }

        for (const chain of callees) {
          const calleeId = chain.targetFunctionId;
          const edgeId = `${id}->${calleeId}`;

          if (!edges.has(edgeId)) {
            edges.set(edgeId, {
              edge: {
                sourceLine: chain.sourceLine,
                callType: chain.callType,
                isCrossModule: chain.sourceModuleId !== chain.targetModuleId,
              },
              chain,
            });
          }

          if (funcInfoIndex.has(calleeId)) {
            queue.push({ id: calleeId, distance: distance + 1, direction: "callee" });
          }
        }
      }
    }
  }

  // 构建折叠信息
  for (const [key, count] of collapsedCounts) {
    const match = key.match(/collapsed-(caller|callee)-(\d+)/);
    if (match) {
      collapsedInfo.set(key, {
        count,
        distance: parseInt(match[2]),
        direction: match[1] as "caller" | "callee",
      });
    }
  }

  return { nodes, edges, collapsedInfo, hasCycle, cycleEdges, totalNodes };
}

// ─── Hook 实现 ────────────────────────────────────────────────────────────────

export function useCallChainData(): UseCallChainDataResult {
  const {
    callChainRootId,
    collapsedNodes,
    callersIndex,
    calleesIndex,
    funcInfoIndex,
  } = useFunctionCallStore();

  return useMemo(() => {
    if (!callChainRootId || !callersIndex || !calleesIndex || !funcInfoIndex) {
      return {
        nodes: [],
        edges: [],
        collapsedInfo: new Map(),
        hasCycle: false,
        cycleEdges: new Set(),
        totalNodes: 0,
      };
    }

    // 根据总节点数动态调整展开深度
    const result = traverseCallChain(
      callChainRootId,
      callersIndex,
      calleesIndex,
      funcInfoIndex,
      DEFAULT_MAX_DEPTH,
      collapsedNodes
    );

    // 如果节点数过多，再次折叠
    if (result.totalNodes > LARGE_NODE_THRESHOLD && collapsedNodes.size === 0) {
      const reducedResult = traverseCallChain(
        callChainRootId,
        callersIndex,
        calleesIndex,
        funcInfoIndex,
        2,  // 减少到 2 层
        collapsedNodes
      );
      return {
        nodes: Array.from(reducedResult.nodes.values()),
        edges: Array.from(reducedResult.edges.values()).map(e => e.edge),
        collapsedInfo: reducedResult.collapsedInfo,
        hasCycle: reducedResult.hasCycle,
        cycleEdges: reducedResult.cycleEdges,
        totalNodes: reducedResult.totalNodes,
      };
    }

    return {
      nodes: Array.from(result.nodes.values()),
      edges: Array.from(result.edges.values()).map(e => e.edge),
      collapsedInfo: result.collapsedInfo,
      hasCycle: result.hasCycle,
      cycleEdges: result.cycleEdges,
      totalNodes: result.totalNodes,
    };
  }, [callChainRootId, callersIndex, calleesIndex, funcInfoIndex, collapsedNodes]);
}

/**
 * 获取折叠节点的虚拟节点数据
 */
export function useCollapsedVirtualNodes(
  collapsedInfo: Map<string, { count: number; distance: number; direction: "caller" | "callee" }>
): CallChainNodeData[] {
  return useMemo(() => {
    const virtualNodes: CallChainNodeData[] = [];

    for (const [id, info] of collapsedInfo) {
      virtualNodes.push({
        id,
        name: `...${info.count} 个节点`,
        className: "",
        fullName: "",
        type: "util",
        visibility: "public",
        description: `折叠的${info.direction === "caller" ? "调用者" : "被调用者"}节点`,
        sourceFile: "",
        sourceLine: 0,
        params: [],
        returnType: { type: "void" },
        annotations: [],
        callerCount: 0,
        calleeCount: 0,
        static: false,
        distance: info.distance,
        direction: info.direction,
        isCollapsed: true,
        collapsedCount: info.count,
      });
    }

    return virtualNodes;
  }, [collapsedInfo]);
}
