/**
 * 边类型颜色映射
 *
 * 分组策略：
 * - Green: 调用关系 - calls, async_calls, handles
 * - Cyan: 依赖关系 - depends_on, imports, uses
 * - Purple: 数据关系 - reads, writes, transforms
 * - Amber: 事件关系 - produces, consumes, publishes, subscribes
 * - Blue: 架构关系 - belongs_to, flow_step, implements
 * - Gray: 包含关系 - contains, defines, part_of
 */

import { generateEdgeColor } from './colorGenerator'

/**
 * 边类型颜色映射
 */
export const EDGE_TYPE_COLORS: Record<string, string> = {
  // ── 调用关系 (Green) ────────────────────────────────
  calls:       generateEdgeColor('green'),
  async_calls: generateEdgeColor('green'),
  handles:     generateEdgeColor('green'),

  // ── 依赖关系 (Cyan) ─────────────────────────────────
  depends_on:  generateEdgeColor('cyan'),
  imports:     generateEdgeColor('cyan'),
  uses:        generateEdgeColor('cyan'),

  // ── 数据关系 (Purple) ───────────────────────────────
  reads:       generateEdgeColor('purple'),
  writes:      generateEdgeColor('purple'),
  transforms:  generateEdgeColor('purple'),

  // ── 事件关系 (Amber) ────────────────────────────────
  produces:    generateEdgeColor('amber'),
  consumes:    generateEdgeColor('amber'),
  publishes:   generateEdgeColor('amber'),
  subscribes:  generateEdgeColor('amber'),

  // ── 架构关系 (Blue) ─────────────────────────────────
  belongs_to:  generateEdgeColor('blue'),
  flow_step:   generateEdgeColor('blue'),
  implements:  generateEdgeColor('blue'),

  // ── 包含关系 (Gray) ────────────────────────────────
  contains:    '#6b7a9d',
  defines:     '#6b7a9d',
  part_of:     '#6b7a9d',

  // ── 其他关系 ────────────────────────────────────────
  deployed_on: '#9d7dff',
  routes_to:   '#44aaff',
  triggers:    '#ffc145',
}

/**
 * 获取边类型颜色
 */
export function getEdgeTypeColor(type: string): string {
  return EDGE_TYPE_COLORS[type] ?? '#6b7a9d'
}