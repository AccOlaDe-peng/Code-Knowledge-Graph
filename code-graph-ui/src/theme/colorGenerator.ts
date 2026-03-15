/**
 * 颜色生成器 - HSL 颜色算法
 *
 * 为图谱节点和边生成一致的配色方案
 */

/**
 * 基础色相定义（延续 Mission Control Dark 风格）
 */
export const BASE_HUES = {
  cyan: 190,    // #00d4ff - 代码结构
  green: 150,   // #00f084 - 服务/组件
  purple: 270,  // #b08eff - 类/数据
  amber: 40,    // #ffc145 - 事件/流程
  red: 350,     // #ff4568 - 外部/警告
  blue: 220,    // #44aaff - 架构层
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
 * 为节点类型生成颜色变体
 *
 * @param baseHue - 基础色相（度数或名称）
 * @param variant - 变体编号（0-5），用于生成同色系的亮度差异
 */
export function generateNodeColor(
  baseHue: number | HueName,
  variant: number = 0
): NodeTypeColorScheme {
  const hue = typeof baseHue === 'string' ? BASE_HUES[baseHue] : baseHue
  const lightnessShift = variant * 3  // 每个变体亮度差异 3%

  return {
    primary: hslToHex(hue, 85, 55 + lightnessShift),
    bg:      hslToHex(hue, 30, 8 + lightnessShift * 0.5),
    border:  hslToHex(hue, 85, 55 + lightnessShift),
    text:    hslToHex(hue, 90, 70 + lightnessShift),
    dim:     hslToHex(hue, 30, 12 + lightnessShift * 0.3),
  }
}

/**
 * 为边类型生成颜色
 */
export function generateEdgeColor(baseHue: number | HueName): string {
  const hue = typeof baseHue === 'string' ? BASE_HUES[baseHue] : baseHue
  return hslToHex(hue, 80, 65)
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
