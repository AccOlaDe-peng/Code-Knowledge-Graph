/**
 * 领域子图核心路径过滤算法。
 *
 * 识别并保留数据流的核心路径，过滤次要节点。
 * 支持三种详细度：compact（简洁）、standard（标准）、detailed（详细）
 */

import type { RawNode, RawEdge } from "../../../api/graphApi";

// ─── 类型定义 ────────────────────────────────────────────────────────────────

export type DetailLevel = "compact" | "standard" | "detailed";

export interface FilteredGraphData {
  nodes: RawNode[];
  edges: RawEdge[];
  stats: {
    total: number;
    filtered: number;
    entryNodes: number;
    exitNodes: number;
    pathNodes: number;
  };
}

// ─── 节点类型常量 ────────────────────────────────────────────────────────────
// 注意：后端返回的节点类型可能是小写或首字母大写，需要兼容两种格式

const ENTRY_NODE_TYPES = new Set([
  "Controller",
  "controller",
  "APIEndpoint",
  "apiendpoint",
  "Component",
  "component",
]);

const EXIT_NODE_TYPES = new Set([
  "Repository",
  "repository",
  "DAO",
  "dao",
  "Database",
  "database",
]);

// ─── 主过滤函数 ──────────────────────────────────────────────────────────────

/**
 * 过滤节点，保留核心数据流路径。
 */
export function filterCorePathNodes(
  nodes: RawNode[],
  edges: RawEdge[],
  detailLevel: DetailLevel
): FilteredGraphData {
  // 详细级别直接返回全部
  if (detailLevel === "detailed") {
    return {
      nodes,
      edges,
      stats: {
        total: nodes.length,
        filtered: nodes.length,
        entryNodes: 0,
        exitNodes: 0,
        pathNodes: 0,
      },
    };
  }

  // 识别入口节点
  const entryNodes = nodes.filter((n) => ENTRY_NODE_TYPES.has(n.type));
  const entryNodeIds = new Set(entryNodes.map((n) => n.id));

  // 识别出口节点
  const exitNodes = nodes.filter((n) => EXIT_NODE_TYPES.has(n.type));
  const exitNodeIds = new Set(exitNodes.map((n) => n.id));

  // 从入口节点 BFS 遍历，记录主路径上的节点
  const pathNodeIds = new Set<string>();

  // 构建边索引
  const outEdgesMap = new Map<string, RawEdge[]>();
  for (const edge of edges) {
    const existing = outEdgesMap.get(edge.from) || [];
    existing.push(edge);
    outEdgesMap.set(edge.from, existing);
  }

  // 如果没有传统入口节点（Controller/APIEndpoint/Component），
  // 降级为以 Service 节点作为 BFS 起点
  const bfsStartIds =
    entryNodeIds.size > 0
      ? [...entryNodeIds]
      : nodes
          .filter((n) => n.type === "Service" || n.type === "service")
          .map((n) => n.id);

  const queue = bfsStartIds;

  // BFS 遍历
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (pathNodeIds.has(nodeId)) continue;

    pathNodeIds.add(nodeId);

    // 查找该节点的所有出边
    const outEdges = outEdgesMap.get(nodeId) || [];
    for (const edge of outEdges) {
      // 只处理在当前节点集合中的边
      if (nodes.some((n) => n.id === edge.to) && !pathNodeIds.has(edge.to)) {
        queue.push(edge.to);
      }
    }
  }

  // 计算每个节点的被调用次数
  const calledByCount = new Map<string, number>();
  for (const node of nodes) {
    calledByCount.set(node.id, 0);
  }
  for (const edge of edges) {
    const count = calledByCount.get(edge.to) || 0;
    calledByCount.set(edge.to, count + 1);
  }

  // 根据详细度确定最小调用数阈值
  const minCallCount = detailLevel === "compact" ? 5 : 3;

  // 过滤节点
  const filteredNodes = nodes.filter((node) => {
    // 保留入口和出口节点
    if (entryNodeIds.has(node.id) || exitNodeIds.has(node.id)) {
      return true;
    }

    // 保留主路径上的节点
    if (pathNodeIds.has(node.id)) {
      return true;
    }

    // 保留高调用数节点
    const callCount = calledByCount.get(node.id) || 0;
    return callCount >= minCallCount;
  });

  // 保底：过滤后节点为空时（例如域内既无入口也无 Service 节点），
  // 直接返回全部节点，避免画布空白
  if (filteredNodes.length === 0 && nodes.length > 0) {
    return {
      nodes,
      edges,
      stats: {
        total: nodes.length,
        filtered: nodes.length,
        entryNodes: entryNodes.length,
        exitNodes: exitNodes.length,
        pathNodes: pathNodeIds.size,
      },
    };
  }

  const filteredNodeIds = new Set(filteredNodes.map((n) => n.id));

  // 过滤边：只保留两端都在过滤后节点集合中的边
  const filteredEdges = edges.filter(
    (edge) => filteredNodeIds.has(edge.from) && filteredNodeIds.has(edge.to)
  );

  return {
    nodes: filteredNodes,
    edges: filteredEdges,
    stats: {
      total: nodes.length,
      filtered: filteredNodes.length,
      entryNodes: entryNodes.length,
      exitNodes: exitNodes.length,
      pathNodes: pathNodeIds.size,
    },
  };
}

// ─── 辅助函数 ────────────────────────────────────────────────────────────────

/**
 * 获取节点的被调用次数。
 */
export function getNodeCalledByCount(nodeId: string, edges: RawEdge[]): number {
  return edges.filter((e) => e.to === nodeId).length;
}

/**
 * 获取节点的调用次数。
 */
export function getNodeCallCount(nodeId: string, edges: RawEdge[]): number {
  return edges.filter((e) => e.from === nodeId).length;
}

/**
 * 获取节点的依赖列表。
 */
export function getNodeDependencies(
  nodeId: string,
  edges: RawEdge[]
): string[] {
  return edges.filter((e) => e.from === nodeId).map((e) => e.to);
}

/**
 * 计算节点统计信息。
 */
export function calculateNodeStats(
  nodes: RawNode[],
  edges: RawEdge[]
): Map<string, { callCount: number; calledByCount: number }> {
  const stats = new Map<string, { callCount: number; calledByCount: number }>();

  for (const node of nodes) {
    stats.set(node.id, { callCount: 0, calledByCount: 0 });
  }

  for (const edge of edges) {
    const fromStats = stats.get(edge.from);
    const toStats = stats.get(edge.to);

    if (fromStats) fromStats.callCount++;
    if (toStats) toStats.calledByCount++;
  }

  return stats;
}

/**
 * 过滤指定领域的节点。
 */
export function filterDomainNodes(
  nodes: RawNode[],
  domainKey: string,
  domainAliases: string[] = []
): RawNode[] {
  const keys = [domainKey, ...domainAliases].map((k) => k.toLowerCase());

  return nodes.filter((node) => {
    const nodeId = node.id.toLowerCase();
    const nodeName = (node.name || "").toLowerCase();

    // 检查节点路径是否包含领域关键字
    for (const key of keys) {
      if (nodeId.includes(`/${key}/`) || nodeId.includes(`\\${key}\\`)) {
        return true;
      }
      // 检查类名前缀
      const classPrefix = nodeName.split(/(?=[A-Z])/)[0];
      if (classPrefix.toLowerCase() === key) {
        return true;
      }
    }

    return false;
  });
}

/**
 * 过滤指定领域的边。
 */
export function filterDomainEdges(
  edges: RawEdge[],
  domainNodeIds: Set<string>
): RawEdge[] {
  return edges.filter(
    (edge) => domainNodeIds.has(edge.from) && domainNodeIds.has(edge.to)
  );
}
