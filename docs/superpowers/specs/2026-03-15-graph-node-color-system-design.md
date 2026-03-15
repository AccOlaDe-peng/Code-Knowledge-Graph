# 前端图谱节点类型配色系统重设计

**日期**: 2026-03-15
**状态**: 设计中
**方案**: 混合配色 - 独立类型颜色 + 自动色板生成

---

## 1. 问题背景

### 1.1 现状

后端 `graph_schema.py` 定义了 **27 种节点类型** 和 **22 种边类型**：

**节点类型（27 种）**：

| 分组 | 类型 | 数量 |
|------|------|------|
| 静态分析 | Repository, Module, File, Class, Function, Component, Service, API, DataObject, Table, Event, Topic, Pipeline, Cluster, Database | 15 |
| V2 AI 分析 | Layer, Flow, BusinessFlow, Domain, BoundedContext, DomainEntity | 6 |
| 新增 AI | APIEndpoint, EventHandler, DataSource, DataSink, ExternalAPI, MessageQueue | 6 |

**边类型（22 种）**：

| 分组 | 类型 | 数量 |
|------|------|------|
| 静态分析 | contains, imports, defines, calls, depends_on, implements, reads, writes, produces, consumes, publishes, subscribes, deployed_on, uses, routes_to, triggers | 16 |
| V2 AI 分析 | belongs_to, flow_step, transforms, part_of | 4 |
| 新增 AI | async_calls, handles | 2 |

### 1.2 问题

前端 `theme/index.ts` 仅定义了 **10 种节点类型颜色** 和 **10 种边类型颜色**：

```typescript
// 前端已定义的节点类型（10 种）
Module, Component, Function, Class, Service, Database, API, Event, Cluster, Infrastructure

// 缺失的节点类型（17 种）
Repository, File, DataObject, Table, Topic, Pipeline,
Layer, Flow, BusinessFlow, Domain, BoundedContext, DomainEntity,
APIEndpoint, EventHandler, DataSource, DataSink, ExternalAPI, MessageQueue
```

**类型审计表**：

| 后端类型 | 前端颜色定义 | 状态 |
|----------|--------------|------|
| Repository | ❌ 缺失 | 需添加 |
| Module | ✅ 已有 | - |
| File | ❌ 缺失 | 需添加 |
| Class | ✅ 已有 | - |
| Function | ✅ 已有 | - |
| Component | ✅ 已有 | - |
| Service | ✅ 已有 | - |
| API | ✅ 已有 | - |
| DataObject | ❌ 缺失 | 需添加 |
| Table | ✅ 已有 | - |
| Event | ✅ 已有 | - |
| Topic | ❌ 缺失 | 需添加 |
| Pipeline | ❌ 缺失 | 需添加 |
| Cluster | ✅ 已有 | - |
| Database | ✅ 已有 | - |
| Layer | ❌ 缺失 | 需添加 |
| Flow | ❌ 缺失 | 需添加 |
| BusinessFlow | ❌ 缺失 | 需添加 |
| Domain | ❌ 缺失 | 需添加 |
| BoundedContext | ❌ 缺失 | 需添加 |
| DomainEntity | ❌ 缺失 | 需添加 |
| APIEndpoint | ❌ 缺失 | 需添加 |
| EventHandler | ❌ 缺失 | 需添加 |
| DataSource | ❌ 缺失 | 需添加 |
| DataSink | ❌ 缺失 | 需添加 |
| ExternalAPI | ❌ 缺失 | 需添加 |
| MessageQueue | ❌ 缺失 | 需添加 |

**边类型审计表**：

| 后端类型 | 前端颜色定义 | 状态 |
|----------|--------------|------|
| contains | ✅ 已有 | - |
| imports | ✅ 已有 | - |
| defines | ❌ 缺失 | 需添加 |
| calls | ✅ 已有 | - |
| depends_on | ✅ 已有 | - |
| implements | ❌ 缺失 | 需添加 |
| reads | ✅ 已有 | - |
| writes | ✅ 已有 | - |
| produces | ✅ 已有 | - |
| consumes | ✅ 已有 | - |
| publishes | ✅ 已有 | - |
| subscribes | ✅ 已有 | - |
| deployed_on | ❌ 缺失 | 需添加 |
| uses | ❌ 缺失 | 需添加 |
| routes_to | ❌ 缺失 | 需添加 |
| triggers | ❌ 缺失 | 需添加 |
| belongs_to | ❌ 缺失 | 需添加 |
| flow_step | ❌ 缺失 | 需添加 |
| transforms | ❌ 缺失 | 需添加 |
| part_of | ❌ 缺失 | 需添加 |
| async_calls | ❌ 缺失 | 需添加 |
| handles | ❌ 缺失 | 需添加 |

未定义类型的节点回退到灰色默认样式 `#6b7a9d`，导致：
1. 架构图部分节点颜色无法区分
2. Architecture 页面过滤器选项不全（仅 7 种硬编码）
3. 用户新增类型时需要手动添加颜色定义

---

## 2. 设计目标

1. **完整覆盖**：所有后端节点/边类型都有专属颜色
2. **可扩展**：新增类型自动获得合适颜色，无需手动配置
3. **一致性**：延续现有 Mission Control Dark 色系风格
4. **可维护**：类型定义集中，易于更新

---

## 3. 技术设计

### 3.1 文件结构

```
src/theme/
├── colorGenerator.ts    # 新增：HSL 颜色生成算法
├── nodeTypeColors.ts    # 新增：节点类型颜色定义
├── edgeTypeColors.ts    # 新增：边类型颜色定义
└── index.ts             # 更新：导出合并后的颜色

src/types/
└── graph.ts             # 更新：扩展 NodeType 和 EdgeType 常量

src/pages/Architecture/
└── index.tsx            # 更新：动态生成过滤器
```

### 3.2 颜色生成算法

`src/theme/colorGenerator.ts`：

```typescript
/**
 * 基础色相定义（延续现有风格）
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
function hslToHex(h: number, s: number, l: number): string {
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
```

### 3.3 节点类型颜色定义

`src/theme/nodeTypeColors.ts`：

```typescript
import { generateNodeColor, type NodeTypeColorScheme } from './colorGenerator'

/**
 * 节点类型颜色映射
 *
 * 分组策略：
 * - Cyan (190°): 代码结构 - Repository, Module, File
 * - Green (150°): 服务层 - Service, API, APIEndpoint, Component
 * - Purple (270°): 数据/类 - Class, Database, Table, DataObject, DataSource, DataSink
 * - Amber (40°): 事件/流程 - Event, Topic, EventHandler, MessageQueue, Flow, BusinessFlow, Pipeline
 * - Blue (220°): 架构层 - Layer, Domain, BoundedContext, DomainEntity
 * - Red (350°): 外部系统 - ExternalAPI, Cluster, Infrastructure
 */
export const NODE_TYPE_COLORS: Record<string, NodeTypeColorScheme> = {
  // ── 代码结构层 (Cyan) ───────────────────────────────
  Repository:   generateNodeColor('cyan', 0),
  Module:       generateNodeColor('cyan', 1),
  File:         generateNodeColor('cyan', 2),

  // ── 服务层 (Green) ──────────────────────────────────
  Service:      generateNodeColor('green', 0),
  API:          generateNodeColor('green', 1),
  APIEndpoint:  generateNodeColor('green', 2),
  Component:    generateNodeColor('green', 3),

  // ── 数据/类层 (Purple) ──────────────────────────────
  Class:        generateNodeColor('purple', 0),
  Database:     generateNodeColor('purple', 1),
  Table:        generateNodeColor('purple', 2),
  DataObject:   generateNodeColor('purple', 3),
  DataSource:   generateNodeColor('purple', 4),
  DataSink:     generateNodeColor('purple', 5),

  // ── 事件/流程层 (Amber) ─────────────────────────────
  Event:        generateNodeColor('amber', 0),
  Topic:        generateNodeColor('amber', 1),
  EventHandler: generateNodeColor('amber', 2),
  MessageQueue: generateNodeColor('amber', 3),
  Flow:         generateNodeColor('amber', 4),
  BusinessFlow: generateNodeColor('amber', 5),
  Pipeline:     generateNodeColor('amber', 6),

  // ── 架构层 (Blue) ───────────────────────────────────
  Layer:            generateNodeColor('blue', 0),
  Domain:           generateNodeColor('blue', 1),
  BoundedContext:   generateNodeColor('blue', 2),
  DomainEntity:     generateNodeColor('blue', 3),

  // ── 外部/基础设施 (Red) ─────────────────────────────
  ExternalAPI:      generateNodeColor('red', 0),
  Cluster:          generateNodeColor('red', 1),
  Infrastructure:   generateNodeColor('red', 2),

  // ── 功能层 (混合) ───────────────────────────────────
  Function:     generateNodeColor(200, 0),  // 青灰色
}

/**
 * 获取节点类型颜色
 * 未定义类型自动生成颜色
 *
 * @param type - 节点类型名称（大小写不敏感）
 */
export function getNodeTypeColor(type: string): NodeTypeColorScheme {
  // 标准化类型名称：大小写不敏感匹配
  const normalizedType = type.charAt(0).toUpperCase() + type.slice(1).toLowerCase()

  if (NODE_TYPE_COLORS[normalizedType]) {
    return NODE_TYPE_COLORS[normalizedType]
  }

  // 尝试原始类型名（向后兼容）
  if (NODE_TYPE_COLORS[type]) {
    return NODE_TYPE_COLORS[type]
  }

  // 为未知类型自动生成颜色（基于类型名哈希）
  const hash = hashString(type)
  const hue = (hash % 36) * 10  // 0-350 色相
  return generateNodeColor(hue, 0)
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
```

### 3.4 边类型颜色定义

`src/theme/edgeTypeColors.ts`：

```typescript
import { generateEdgeColor } from './colorGenerator'

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
```

### 3.5 更新 theme/index.ts

```typescript
// 重新导出新的颜色系统
export { getNodeTypeColor, NODE_TYPE_COLORS } from './nodeTypeColors'
export { getEdgeTypeColor, EDGE_TYPE_COLORS } from './edgeTypeColors'
export { generateNodeColor, generateEdgeColor, BASE_HUES } from './colorGenerator'
export type { NodeTypeColorScheme } from './colorGenerator'

// 保持向后兼容：NodeTypeColors 作为 NODE_TYPE_COLORS 的别名
export { NODE_TYPE_COLORS as NodeTypeColors }
export { EDGE_TYPE_COLORS as EdgeTypeColors }
```

### 3.6 更新 types/graph.ts

```typescript
// ─── Node Type Constants ─────────────────────────────────────────────────────

export const NodeType = {
  // 代码结构层
  Repository: 'Repository',
  Module: 'Module',
  File: 'File',

  // 代码元素
  Class: 'Class',
  Function: 'Function',
  Component: 'Component',

  // 服务层
  Service: 'Service',
  API: 'API',
  APIEndpoint: 'APIEndpoint',

  // 数据层
  Database: 'Database',
  Table: 'Table',
  DataObject: 'DataObject',
  DataSource: 'DataSource',
  DataSink: 'DataSink',

  // 事件层
  Event: 'Event',
  Topic: 'Topic',
  EventHandler: 'EventHandler',
  MessageQueue: 'MessageQueue',

  // 流程层
  Flow: 'Flow',
  BusinessFlow: 'BusinessFlow',
  Pipeline: 'Pipeline',

  // 架构层
  Layer: 'Layer',
  Domain: 'Domain',
  BoundedContext: 'BoundedContext',
  DomainEntity: 'DomainEntity',

  // 外部/基础设施
  ExternalAPI: 'ExternalAPI',
  Cluster: 'Cluster',
  Infrastructure: 'Infrastructure',
} as const

// ─── Edge Type Constants ──────────────────────────────────────────────────────

export const EdgeType = {
  // 包含关系
  Contains: 'contains',
  Defines: 'defines',
  PartOf: 'part_of',

  // 依赖关系
  Imports: 'imports',
  DependsOn: 'depends_on',
  Uses: 'uses',

  // 调用关系
  Calls: 'calls',
  AsyncCalls: 'async_calls',
  Handles: 'handles',

  // 数据关系
  Reads: 'reads',
  Writes: 'writes',
  Transforms: 'transforms',

  // 事件关系
  Produces: 'produces',
  Consumes: 'consumes',
  Publishes: 'publishes',
  Subscribes: 'subscribes',

  // 架构关系
  BelongsTo: 'belongs_to',
  FlowStep: 'flow_step',
  Implements: 'implements',

  // 其他
  DeployedOn: 'deployed_on',
  RoutesTo: 'routes_to',
  Triggers: 'triggers',
} as const
```

### 3.7 更新 Architecture 页面过滤器

`src/pages/Architecture/index.tsx`：

```typescript
import { NODE_TYPE_COLORS, getNodeTypeColor } from '../../theme'

// 动态生成过滤器选项
function buildFilterOptions(typeCounts: Record<string, number>) {
  const allCount = Object.values(typeCounts).reduce((a, b) => a + b, 0)

  const options: Array<{ type: string; label: string; color: string; count: number }> = [
    { type: 'all', label: '全部', color: '#6e7a99', count: allCount },
  ]

  // 按分组排序
  const groups: Record<string, string[]> = {
    '代码结构': ['Repository', 'Module', 'File'],
    '代码元素': ['Class', 'Function', 'Component'],
    '服务层': ['Service', 'API', 'APIEndpoint'],
    '数据层': ['Database', 'Table', 'DataObject', 'DataSource', 'DataSink'],
    '事件层': ['Event', 'Topic', 'EventHandler', 'MessageQueue'],
    '流程层': ['Flow', 'BusinessFlow', 'Pipeline'],
    '架构层': ['Layer', 'Domain', 'BoundedContext', 'DomainEntity'],
    '外部': ['ExternalAPI', 'Cluster', 'Infrastructure'],
  }

  for (const [groupName, types] of Object.entries(groups)) {
    for (const type of types) {
      const count = typeCounts[type] ?? 0
      if (count > 0) {
        const color = getNodeTypeColor(type).primary
        options.push({ type, label: type, color, count })
      }
    }
  }

  return options
}
```

---

## 4. 影响范围

### 4.1 需要修改的文件

| 文件 | 修改类型 | 说明 |
|------|----------|------|
| `src/theme/colorGenerator.ts` | 新增 | 颜色生成算法 |
| `src/theme/nodeTypeColors.ts` | 新增 | 节点类型颜色定义 |
| `src/theme/edgeTypeColors.ts` | 新增 | 边类型颜色定义 |
| `src/theme/index.ts` | 修改 | 导出新模块 |
| `src/types/graph.ts` | 修改 | 扩展类型常量 |
| `src/pages/Architecture/index.tsx` | 修改 | 动态过滤器 |
| `src/components/graph/GraphViewer/index.tsx` | 无需修改 | 使用 getNodeTypeColor() |
| `src/components/graph/GraphCanvas/cyStyles.ts` | 无需修改 | 使用 resolveNodeColors() |

### 4.2 向后兼容

- `NodeTypeColors` 作为 `NODE_TYPE_COLORS` 的别名导出，现有代码无需修改
- `getNodeTypeColor()` 函数签名不变
- 未定义类型自动生成颜色，不会报错

---

## 5. 测试计划

1. **单元测试**：颜色生成算法的正确性
2. **集成测试**：所有节点/边类型都有颜色
3. **视觉测试**：在 Architecture 页面验证各类节点的显示效果
4. **回归测试**：现有页面功能不受影响

---

## 6. 风险评估

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|----------|
| 自动生成颜色与现有颜色冲突 | 低 | 低 | 使用 variant 参数区分 |
| 新增类型颜色不美观 | 中 | 低 | 可在 nodeTypeColors.ts 中手动覆盖 |
| 性能影响 | 极低 | 无 | 颜色在渲染时计算一次后缓存 |

---

## 7. 未来扩展

1. **主题切换**：支持亮色主题时，调整 colorGenerator 的亮度参数
2. **用户自定义**：允许用户通过配置文件覆盖特定类型的颜色
3. **类型别名**：支持同一类型多个名称（如 `API` = `APIEndpoint`）
4. **颜色缓存**：在 `getNodeTypeColor()` 中添加简单 LRU 缓存，避免重复计算
5. **大小写处理**：类型匹配应忽略大小写（如 `api` = `API`）