/**
 * Dagre 布局工具
 */

import dagre from "dagre";
import type { FunctionInfo, CallChain, LAYOUT_CONFIG } from "../types";

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
