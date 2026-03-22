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
  └── callGraphStyles.ts                    ← 新建：节点/边样式定义
```

### 数据流

```
graphStore.loadCallGraph(repoId)
    ↓ API: GET /graph/call
rawNodes / rawEdges（完整图谱数据）
    ↓ [页面层，纯函数，不变]
calcDegrees() → BFS过滤(focusNodeId, depth) → searchHighlight()
    ↓
{ filteredNodes, filteredEdges, highlightedIds, dimmedIds }
    ↓ props
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

### Props

```typescript
interface CallGraphCanvasProps {
  nodes: GraphNode[]
  edges: GraphEdge[]
  highlightedIds?: Set<string>    // 搜索匹配节点
  dimmedIds?: Set<string>         // 需要淡出的节点
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
| 点击节点 | `onNodeClick(id)` → 页面更新 focusNodeId → BFS 过滤 → `ref.focusNode()` |
| 搜索输入 | 页面计算 highlightedIds/dimmedIds → props 传入 → `cy.batch()` 更新样式类 |
| 深度滑块 | 页面重新 BFS → 新 nodes/edges 传入 → 差量更新 + `runLayout()` |
| 重置 | 页面清空状态 → 全量数据传入 → `fitView()` |
| pan/zoom | Cytoscape 原生，`textureOnViewport` 保证流畅 |

---

## 节点视觉规格

复刻现有 FunctionNode 外观：

| 属性 | 值 |
|---|---|
| 尺寸 | 200 × 48 px |
| 圆角 | 4px |
| 左侧边框 | 3px，按节点类型使用对应强调色 |
| 字体 | IBM Plex Mono, 11px |
| 标签 | 截断至 18 字符 |
| 选中态 | 发光阴影 + 背景亮化 |
| 淡出态 | opacity 0.25 |

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
  cy.elements().removeClass('highlighted dimmed')
  highlightedIds.forEach(id => cy.$id(id).addClass('highlighted'))
  dimmedIds.forEach(id => cy.$id(id).addClass('dimmed'))
})
```

### 差量元素更新

当 BFS 过滤结果变化时，只增删变化的元素，不重建整个图：

```typescript
const toAdd = newNodes.filter(n => !cy.$id(n.id).length)
const toRemove = cy.nodes().filter(n => !newNodeIds.has(n.id()))
cy.batch(() => {
  cy.remove(toRemove)
  cy.add(toAdd)
})
if (toAdd.length || toRemove.length) runLayout()
```

### 大图安全边界

当节点数超过 **3000** 时，前端自动将初始深度收紧为 2，并展示提示：

> "当前图谱包含 X 个节点，已自动限制深度为 2。可通过滑块手动调整。"

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
| 修改 | `src/pages/CallGraph/index.tsx`（替换 ReactFlow 引用，接入 CallGraphCanvas） |
| 可选删除 | ReactFlow 相关 import（`@xyflow/react`，如其他页面不用可移除依赖） |
