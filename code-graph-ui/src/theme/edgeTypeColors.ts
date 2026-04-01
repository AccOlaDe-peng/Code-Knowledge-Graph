/**
 * 边类型颜色映射
 *
 * v3.0 颜色方案 - 高对比度设计
 *
 * 分组策略：
 * - Green: 调用关系 - calls, async_calls, handles
 * - Cyan: 依赖关系 - depends_on, imports, uses
 * - Magenta: 数据关系 - reads, writes, transforms（替代紫色）
 * - Amber: 事件关系 - produces, consumes, publishes, subscribes
 * - Blue: 架构关系 - belongs_to, flow_step, implements
 * - Silver: 包含关系 - contains, defines, part_of（替代灰色）
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

  // ── 数据关系 (Magenta - 替代紫色，更亮) ────────────
  reads:       generateEdgeColor('magenta'),
  writes:      generateEdgeColor('magenta'),
  transforms:  generateEdgeColor('magenta'),

  // ── 事件关系 (Amber) ────────────────────────────────
  produces:    generateEdgeColor('amber'),
  consumes:    generateEdgeColor('amber'),
  publishes:   generateEdgeColor('amber'),
  subscribes:  generateEdgeColor('amber'),

  // ── 架构关系 (Blue) ─────────────────────────────────
  belongs_to:  generateEdgeColor('blue'),
  flow_step:   generateEdgeColor('blue'),
  implements:  generateEdgeColor('blue'),

  // ── 包含关系 (Silver - 替代灰色，更明亮) ──────────
  contains:    '#88aacc',   // 银蓝色，清晰可见
  defines:     '#88aacc',
  part_of:     '#88aacc',

  // ── AI 优先流水线 - 实体关系 (Magenta) ─────────────
  maps_to:      generateEdgeColor('magenta'),
  has_field:    '#99bbdd',                    // 浅银蓝色
  one_to_one:   generateEdgeColor('green'),
  one_to_many:  generateEdgeColor('green'),
  many_to_one:  generateEdgeColor('green'),
  many_to_many: generateEdgeColor('amber'),

  // ── AI 优先流水线 - 数据血缘 (Cyan) ────────────────
  flow_to:      generateEdgeColor('cyan'),

  // ── 其他关系 ────────────────────────────────────────
  deployed_on: '#cc88ff',   // 亮紫色
  routes_to:   '#55bbff',   // 亮蓝色
  triggers:    '#ffcc55',   // 亮琥珀色
}

/**
 * 获取边类型颜色
 * 默认返回银蓝色，替代暗灰色
 */
export function getEdgeTypeColor(type: string): string {
  return EDGE_TYPE_COLORS[type] ?? '#88aacc'
}