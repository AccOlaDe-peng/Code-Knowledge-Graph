/**
 * 颜色生成器 - HSL 颜色算法
 *
 * 为图谱节点和边生成一致的配色方案
 * v3.0 - 高对比度设计，解决紫色和灰色看不清的问题
 */

/**
 * 基础色相定义（优化后）
 *
 * 关键改进：
 * - Purple → Magenta (更亮的粉紫色，对比度更高)
 * - Gray → Silver (银灰色，更明亮)
 */
export const BASE_HUES = {
  cyan:    190,   // #00d4ff - 代码结构
  green:   150,   // #00f084 - 服务/组件
  magenta: 300,   // #ff66cc - 数据/类（替代 purple 270，更亮）
  purple:  300,   // 别名，指向 magenta
  amber:   40,    // #ffc145 - 事件/流程
  red:     350,   // #ff4568 - 外部/警告
  blue:    220,   // #44aaff - 架构层
  silver:  210,   // #88aacc - 替代灰色，更亮
  teal:    170,   // #00ccaa - 青绿色，用于字段
} as const

export type HueName = keyof typeof BASE_HUES

/**
 * 节点颜色方案
 */
export interface NodeTypeColorScheme {
  primary: string   // 主色
  bg: string        // 背景色
  border: string    // 边框色
  text: string      // 文字色
  dim: string       // 暗淡色（用于选中态背景）
  glow: string      // 发光色（用于 hover/focus 效果）
}

/**
 * HSL 转 Hex
 */
export function hslToHex(h: number, s: number, l: number): string {
  s /= 100
  l /= 100
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
    return Math.round(255 * color).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

/**
 * HSL 转 RGBA（用于发光效果）
 */
export function hslToRgba(h: number, s: number, l: number, a: number): string {
  s /= 100
  l /= 100
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const color = l - s * Math.min(l, 1 - l) * Math.max(Math.min(k - 3, 9 - k, 1), -1)
    return Math.round(255 * color)
  }
  return `rgba(${f(0)}, ${f(8)}, ${f(4)}, ${a})`
}

/**
 * 为节点类型生成颜色变体
 *
 * @param baseHue - 基础色相（度数或名称）
 * @param variant - 变体编号（0-5），用于生成同色系的亮度差异
 *
 * v3.0 改进：
 * - 背景亮度从 16% 提升到 20%
 * - 背景饱和度从 45% 提升到 55%，颜色更鲜明
 * - 边框亮度提升到 60%，确保清晰可见
 */
export function generateNodeColor(
  baseHue: number | HueName,
  variant: number = 0
): NodeTypeColorScheme {
  const hue = typeof baseHue === 'string' ? BASE_HUES[baseHue] : baseHue
  const lightnessShift = variant * 2  // 每个变体亮度差异 2%

  return {
    // 主色 - 高饱和度，较高亮度
    primary: hslToHex(hue, 92, 62 + lightnessShift),
    // 背景 - 大幅提升亮度和饱和度
    bg:      hslToHex(hue, 55, 20 + lightnessShift * 0.5),
    // 边框 - 高饱和度，高亮度
    border:  hslToHex(hue, 92, 60 + lightnessShift),
    // 文字 - 高亮度，确保可读性
    text:    hslToHex(hue, 95, 78 + lightnessShift),
    // 暗淡背景（选中态）
    dim:     hslToHex(hue, 60, 26 + lightnessShift * 0.3),
    // 发光效果
    glow:    hslToRgba(hue, 92, 58 + lightnessShift, 0.45),
  }
}

/**
 * 为边类型生成颜色
 * v3.0 - 大幅提升亮度和饱和度
 */
export function generateEdgeColor(baseHue: number | HueName): string {
  const hue = typeof baseHue === 'string' ? BASE_HUES[baseHue] : baseHue
  return hslToHex(hue, 90, 65)  // 高饱和度、高亮度
}

/**
 * 字符串哈希
 */
function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

/**
 * 为未知类型生成颜色（基于类型名哈希）
 */
export function generateColorFromTypeName(typeName: string): NodeTypeColorScheme {
  const hash = hashString(typeName)
  const hue = (hash % 36) * 10  // 0-350 色相
  return generateNodeColor(hue, 0)
}
