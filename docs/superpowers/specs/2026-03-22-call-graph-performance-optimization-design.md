# 调用图性能优化设计

**日期:** 2026-03-22
**状态:** 已批准
**范围:** `code-graph-ui` 前端，调用图页面

---

## 问题陈述

调用图页面（`src/pages/CallGraph/index.tsx`）使用 ReactFlow 渲染节点，在 2000–10000 节点、10000–50000 边的规模下，初始加载、布局计算和交互操作（拖拽、缩放、点击）均出现明显卡顿，影响使用体验。

**根本原因：**
- ReactFlow 将每个节点渲染为独立 DOM 元素，节点数量线性增加 DOM 压力
- dagre 布局同步运行在主线程，阻塞 UI
- pan/zoom 触发全量重排和重绘
- 无批量更新机制，任何状态变化都触发 React re-render + DOM diff

---

## 解决方案

用 Cytoscape.js（Canvas 渲染）替换 ReactFlow，新建专用的 `CallGraphCanvas` 组件。

**核心思路：** 只替换渲染层，保留原页面的全部业务逻辑不变。

---

## 架构设计

### 组件结构

```
pages/CallGraph/index.tsx                   ← 保留业务逻辑，替换渲染器引用
components/graph/CallGraphCanvas/
  ├── index.tsx                             ← 新建：Cytoscape 渲染组件
  └── callGraphStyles.ts                    ← 新建：节点/边样式定义（独立文件，不继承 cyStyles.ts）
```

### 数据流

```
graphStore.loadCallGraph(activeRepo.graphId)
    ↓ API: GET /graph/call
    ↓ 注：store 参数名为 repoId，实际传入值来自 activeRepo.graphId（即 graphId）
rawNodes / rawEdges（完整图谱数据）
    ↓ [页面层，纯函数，不变]
calcDegrees() → BFS过滤(focusNodeId, depth) → searchHighlight()
    ↓
{ filteredNodes, filteredEdges, highlightedIds, dimmedIds }
    ↓ props（含 nodeDegrees: Map<string, {in: number, out: number}>）
<CallGraphCanvas />
    ↓ Cytoscape 内部
cy.batch() → 元素差量更新 → dagre 布局（异步）→ Canvas 渲染
```

### 渲染对比

| 维度 | 当前（ReactFlow）| 优化后（Cytoscape）|
|---|---|---|
| 渲染方式 | DOM 元素，每节点一个 div | Canvas 统一绘制 |
| 布局计算 | 同步，阻塞主线程 | Cytoscape layout 异步 |
| 状态更新 | React re-render + DOM diff | `cy.batch()` 批量更新，零 re-render |
| pan/zoom | 触发重排 | `textureOnViewport` 变为贴图操作 |

---

## 组件接口

### 类型说明

`CallGraphCanvas` 使用 `src/types/graph.ts` 中的 `GraphNode` / `GraphEdge`（与页面层一致），**不使用** `graph-engine/types` 的 `EngineGraphNode` / `EngineGraphEdge`。

```typescript
// src/types/graph.ts（已有，不变）
type GraphNode = { id: string; type: string; label: string; properties?: Record<string, unknown> }
type GraphEdge = { source: string; target: string; type: string }
```

`GraphEdge` 没有 `id` 字段，差量更新时边的唯一 ID 在实现层合成为 `${source}->${target}`。

### Props

```typescript
interface CallGraphCanvasProps {
  nodes: GraphNode[]
  edges: GraphEdge[]
  nodeDegrees: Map<string, { in: number; out: number }>  // 度数信息（页面层已有）
  highlightedIds?: Set<string>   // 搜索匹配节点
  dimmedIds?: Set<string>        // 需要淡出的节点
  focusEdgeIds?: Set<string>     // 焦点节点相连的边 ID（格式：`${src}-[${type}]->${tgt}`）
  onNodeClick?: (nodeId: string) => void
}
```

### 命令式 Handle（ref）

```typescript
interface CallGraphCanvasHandle {
  focusNode(nodeId: string): void   // 动画居中 + 放大
  fitView(): void                   // 全局 fit
  runLayout(): Promise<void>        // 重新布局
}
```

---

## 交互行为

| 操作 | 行为 |
|---|---|
| 点击节点 | `onNodeClick(id)` → 页面判断 toggle（再次点击同一节点则清空 focusNodeId）→ BFS 过滤 → `ref.focusNode()` |
| 搜索输入 | 页面计算 highlightedIds/dimmedIds → props 传入 → `cy.batch()` 更新样式类 |
| 深度滑块 | 页面重新 BFS → 新 nodes/edges 传入 → 差量更新 + `runLayout()` |
| 重置 | 页面清空状态 → 全量数据传入 → `fitView()` |
| pan/zoom | Cytoscape 原生，`textureOnViewport` 保证流畅 |

**Toggle 语义：** `onNodeClick` 始终传入被点击节点的 id，toggle 判断（`id === focusNodeId ? clear : set`）由页面层负责，`CallGraphCanvas` 不处理。

**focusEdgeIds 计算（页面层）：**

```typescript
const focusEdgeIds = useMemo(() => {
  if (!focusNodeId) return new Set<string>()
  return new Set(
    rawEdges
      .filter(e => e.source === focusNodeId || e.target === focusNodeId)
      .map(e => `${e.source}-[${e.type}]->${e.target}`)
  )
}, [focusNodeId, rawEdges])
```

**错误状态：** `callGraph.error` 由页面层处理（显示错误提示），`CallGraphCanvas` 仅接收合法数据或空数组，不处理错误逻辑。

**空图状态：** 节点数为 0 时，`CallGraphCanvas` 渲染空 Canvas，页面层显示"暂无调用图数据"占位内容。

---

## 节点视觉规格

`callGraphStyles.ts` 为独立样式文件，不继承 `cyStyles.ts`，但可复用其工具函数（`resolveNodeColors`、`truncateLabel`）。节点尺寸与现有 FunctionNode 保持一致（宽 200px，高 48px），是有意区别于 `cyStyles.ts` 中默认的 140px。

| 属性 | 值 |
|---|---|
| 尺寸 | 200 × 48 px |
| 圆角 | 4px |
| 左侧边框效果 | Cytoscape 原生仅支持统一 `border-color`，无法分侧着色。实现方案：用节点背景渐变模拟（左侧 3px 为强调色，其余为正常背景色）。若渐变实现复杂，降级为统一 border-color 按节点类型区分。 |
| 字体 | IBM Plex Mono, 11px |
| 标签（第一行）| 截断至 18 字符的节点名称 |
| 度数（第二行）| `←{in} {out}→` 格式，通过 Cytoscape 多行 label（`\n`）渲染 |
| 选中态 | 发光阴影 + 背景亮化 |
| 淡出态 | opacity 0.25 |

---

## 边的视觉规格

| 状态 | 样式 |
|---|---|
| 普通边 | 半透明灰色，opacity 0.5 |
| 焦点边（`focusEdgeIds` 中） | 亮色（强调色），opacity 1，line-width 2 |
| 淡出边 | opacity 0.1 |

**注：** 现有 ReactFlow 实现中焦点边有流动动画（`animated: true`）。Cytoscape.js 原生不支持此效果，本次替换为静态高亮样式（颜色 + 加粗），不引入额外动画插件，与性能目标一致。

---

## 布局配置

```typescript
{
  name: 'dagre',
  rankDir: 'LR',
  nodeSep: 44,
  rankSep: 90,
  marginx: 24,
  marginy: 24,
  animate: false,   // 大图跳过动画，直接就位
}
```

---

## 性能配置

### Cytoscape 实例参数

```typescript
{
  textureOnViewport: true,      // pan/zoom 变贴图，不重绘
  motionBlur: true,
  motionBlurOpacity: 0.08,
  hideEdgesOnViewport: true,    // pan/zoom 时隐藏边（10k+ 边时关键优化）
  boxSelectionEnabled: false,   // 禁用框选，减少 CPU
  wheelSensitivity: 0.2,
  minZoom: 0.05,
  maxZoom: 8,
  pixelRatio: 'auto',
}
```

### 批量样式更新

```typescript
cy.batch(() => {
  cy.elements().removeClass('highlighted dimmed focal-edge')
  highlightedIds.forEach(id => cy.$id(id).addClass('highlighted'))
  dimmedIds.forEach(id => cy.$id(id).addClass('dimmed'))
  focusEdgeIds.forEach(id => cy.$id(id).addClass('focal-edge'))
})
```

### 差量元素更新

当 BFS 过滤结果变化时，只增删变化的元素，不重建整个图。

边使用合成 ID `${source}-[${type}]->${target}` 进行匹配（含 type 以避免同对节点多条边冲突）。`GraphEdge.type` 由后端保证非空；实现层加 fallback 防御：

```typescript
const edgeId = (e: GraphEdge) => `${e.source}-[${e.type || 'edge'}]->${e.target}`

const newNodeIds = new Set(newNodes.map(n => n.id))
const newEdgeIds = new Set(newEdges.map(edgeId))

cy.batch(() => {
  cy.edges().filter(e => !newEdgeIds.has(e.id())).remove()
  cy.nodes().filter(n => !newNodeIds.has(n.id())).remove()
  newNodes.filter(n => !cy.$id(n.id).length).forEach(n => cy.add(buildCyNode(n)))
  newEdges.filter(e => !cy.$id(edgeId(e)).length).forEach(e => cy.add(buildCyEdge(e)))
})
if (changed) runLayout()
```

`buildCyNode` / `buildCyEdge` 在 `callGraphStyles.ts` 中定义，不复用 `GraphCanvas` 的同名函数。

### 大图安全边界

当节点数超过 **3000** 时，前端自动将初始深度收紧为 2，并展示提示：

> "当前图谱包含 X 个节点，已自动限制深度为 2。可通过滑块手动调整。"

**触发时机：** 数据加载完成后，基于 `rawData.nodes.length` 判断；仅在初始化时生效，用户手动调整深度滑块后提示自动关闭。

---

## 移除功能说明

| 功能 | 决策 |
|---|---|
| ReactFlow MiniMap | **移除**。Cytoscape.js 无内置 MiniMap，引入额外插件与性能目标相悖；用户可通过 fitView 按钮和缩放控件导航 |
| 焦点边流动动画 | **替换为静态高亮**（颜色 + 加粗），原因同上 |

---

## 不在本次范围内

- graph-engine LOD / 聚类（2k-10k 节点无需）
- 后端接口变更
- 其他页面（架构图、血缘图、事件流）的渲染器迁移
- Web Worker 布局（Cytoscape 异步布局已足够）

---

## 文件变更清单

| 操作 | 文件 |
|---|---|
| 新建 | `src/components/graph/CallGraphCanvas/index.tsx` |
| 新建 | `src/components/graph/CallGraphCanvas/callGraphStyles.ts` |
| 修改 | `src/pages/CallGraph/index.tsx`（移除 ReactFlow，接入 CallGraphCanvas；传入 nodeDegrees 和 focusEdgeIds） |
| 可选删除 | `reactflow` 依赖（当前使用的是 v11 的 `reactflow` 包，而非 `@xyflow/react`；确认 DataLineage 等页面也不再使用后可从 package.json 移除） |
