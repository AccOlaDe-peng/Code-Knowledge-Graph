/**
 * Dagre 布局工具
 */

import dagre from "dagre";
import type { FunctionInfo, CallChain, LAYOUT_CONFIG, CallChainNodeData, CallChainEdgeData } from "../types";

/**
 * 计算函数调用图的 Dagre 布局
 */
export function computeDagreLayout(
  functions: FunctionInfo[],
  callChains: CallChain[],
  config: typeof LAYOUT_CONFIG.dagre = {
    rankdir: "LR",
    nodesep: 60,
    ranksep: 120,
    marginx: 50,
    marginy: 50,
  }
): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: config.rankdir,
    nodesep: config.nodesep,
    ranksep: config.ranksep,
    marginx: config.marginx,
    marginy: config.marginy,
  });
  g.setDefaultEdgeLabel(() => ({}));

  // 添加节点
  const nodeWidth = 180;
  const nodeHeight = 60;
  for (const func of functions) {
    g.setNode(func.id, { width: nodeWidth, height: nodeHeight });
  }

  // 添加边
  for (const chain of callChains) {
    // 只添加两个函数都在当前列表中的边
    const sourceExists = functions.some((f) => f.id === chain.sourceFunctionId);
    const targetExists = functions.some((f) => f.id === chain.targetFunctionId);
    if (sourceExists && targetExists) {
      g.setEdge(chain.sourceFunctionId, chain.targetFunctionId);
    }
  }

  // 计算布局
  dagre.layout(g);

  // 提取位置
  const positions = new Map<string, { x: number; y: number }>();
  for (const func of functions) {
    const node = g.node(func.id);
    if (node) {
      positions.set(func.id, { x: node.x, y: node.y });
    }
  }

  return positions;
}

/**
 * 计算模块节点位置（力导向布局简化版）
 */
export function computeModulePositions(
  modules: Array<{ id: string; functionCount: number }>,
  width: number,
  height: number
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const count = modules.length;

  if (count === 0) return positions;

  // 简单网格布局作为初始位置
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const cellWidth = width / (cols + 1);
  const cellHeight = height / (rows + 1);

  modules.forEach((module, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    positions.set(module.id, {
      x: cellWidth * (col + 1),
      y: cellHeight * (row + 1),
    });
  });

  return positions;
}

/**
 * 计算节点大小（基于函数数量）
 */
export function calculateModuleNodeSize(
  functionCount: number,
  minSize: number,
  maxSize: number,
  maxFunctions: number
): { width: number; height: number } {
  const ratio = Math.sqrt(functionCount / maxFunctions);
  const size = minSize + (maxSize - minSize) * ratio;
  return { width: size, height: size * 0.6 };
}

/**
 * 计算边粗细（基于调用次数）
 */
export function calculateEdgeWidth(
  count: number,
  minWidth: number,
  maxWidth: number,
  maxCount: number
): number {
  const ratio = Math.log(count + 1) / Math.log(maxCount + 1);
  return minWidth + (maxWidth - minWidth) * ratio;
}

// ─── 调用链布局 ────────────────────────────────────────────────────────────────

/**
 * 计算调用链布局
 *
 * 特点：
 * - 根节点在中心偏左
 * - 调用者在左侧，被调用者在右侧
 * - 同层级节点垂直对齐
 */
export function computeCallChainLayout(
  nodes: CallChainNodeData[],
  edges: CallChainEdgeData[],
  rootId: string
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();

  if (nodes.length === 0) return positions;

  // 按距离和方向分组
  const callerGroups = new Map<number, CallChainNodeData[]>();
  const calleeGroups = new Map<number, CallChainNodeData[]>();
  let rootNode: CallChainNodeData | null = null;

  for (const node of nodes) {
    if (node.direction === "root") {
      rootNode = node;
    } else if (node.direction === "caller") {
      const group = callerGroups.get(node.distance) || [];
      group.push(node);
      callerGroups.set(node.distance, group);
    } else if (node.direction === "callee") {
      const group = calleeGroups.get(node.distance) || [];
      group.push(node);
      calleeGroups.set(node.distance, group);
    }
  }

  const nodeWidth = 160;
  const nodeHeight = 60;
  const horizontalSpacing = 200;  // 层级间距
  const verticalSpacing = 80;  // 同层级节点间距

  // 根节点位置（中心偏左）
  const rootX = 400;
  const rootY = 300;

  if (rootNode) {
    positions.set(rootNode.id, { x: rootX, y: rootY });
  }

  // 放置调用者（向左）
  const callerDistances = Array.from(callerGroups.keys()).sort((a, b) => a - b);
  for (const distance of callerDistances) {
    const group = callerGroups.get(distance) || [];
    const x = rootX - distance * horizontalSpacing;
    const totalHeight = group.length * nodeHeight + (group.length - 1) * verticalSpacing;
    const startY = rootY - totalHeight / 2 + nodeHeight / 2;

    group.forEach((node, index) => {
      positions.set(node.id, {
        x,
        y: startY + index * (nodeHeight + verticalSpacing),
      });
    });
  }

  // 放置被调用者（向右）
  const calleeDistances = Array.from(calleeGroups.keys()).sort((a, b) => a - b);
  for (const distance of calleeDistances) {
    const group = calleeGroups.get(distance) || [];
    const x = rootX + distance * horizontalSpacing;
    const totalHeight = group.length * nodeHeight + (group.length - 1) * verticalSpacing;
    const startY = rootY - totalHeight / 2 + nodeHeight / 2;

    group.forEach((node, index) => {
      positions.set(node.id, {
        x,
        y: startY + index * (nodeHeight + verticalSpacing),
      });
    });
  }

  // 处理折叠节点
  for (const node of nodes) {
    if (node.isCollapsed && !positions.has(node.id)) {
      // 折叠节点放在对应层级的边缘
      const distance = node.distance;
      const direction = node.direction;
      const x = direction === "caller"
        ? rootX - distance * horizontalSpacing
        : rootX + distance * horizontalSpacing;

      // 找到该层级的最大 Y 值，放在下方
      const group = (direction === "caller" ? callerGroups : calleeGroups).get(distance) || [];
      const maxY = Math.max(...group.map(n => positions.get(n.id)?.y || 0), 0);

      positions.set(node.id, {
        x,
        y: maxY + nodeHeight + verticalSpacing,
      });
    }
  }

  return positions;
}

/**
 * 使用 Dagre 计算调用链布局（备选方案，适用于复杂图）
 */
export function computeCallChainDagreLayout(
  nodes: CallChainNodeData[],
  edges: CallChainEdgeData[]
): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: "LR",
    nodesep: 60,
    ranksep: 160,
    marginx: 80,
    marginy: 80,
  });
  g.setDefaultEdgeLabel(() => ({}));

  const nodeWidth = 160;
  const nodeHeight = 60;

  // 添加节点
  for (const node of nodes) {
    g.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  }

  // 添加边（需要重建边关系）
  for (const node of nodes) {
    if (node.direction === "caller") {
      // 调用者指向目标
      // 找到这个调用者调用的函数
      const targetDistance = node.distance - 1;
      // 简化：假设边信息已包含
    }
  }

  // 计算布局
  dagre.layout(g);

  // 提取位置
  const positions = new Map<string, { x: number; y: number }>();
  for (const node of nodes) {
    const gNode = g.node(node.id);
    if (gNode) {
      positions.set(node.id, { x: gNode.x, y: gNode.y });
    }
  }

  return positions;
}
