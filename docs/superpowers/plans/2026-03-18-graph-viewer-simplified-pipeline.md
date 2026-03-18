# Graph Viewer 简化渲染管道 实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复架构图节点不显示的问题，简化渲染管道为"API → cy.add() → dagre layout"直连模式，支持点击展开子节点。

**Architecture:** 移除 Store→Cytoscape 间接同步层，改为 `GraphViewerPro` 通过 `CyHandle` imperative ref 直接驱动 Cytoscape。`nodes`/`edges` Map 保留在 Store 中供 Search/SidePanel 使用，但不再驱动渲染。删除 `visibleNodes`/`visibleEdges`（这是导致节点被隐藏的根本原因）。

**Tech Stack:** React 19 + TypeScript + Cytoscape.js (cytoscape-dagre) + Zustand

**Spec:** `docs/superpowers/specs/2026-03-17-graph-viewer-simplified-pipeline-design.md`

---

## 根本原因说明

`recomputeVisibleEdges()` 在流式加载完成后被调用，它将 `visibleEdges` 设为空 Set（因为 `visibleNodes` 为空），触发 `syncVisibilityToCy`，后者对所有节点执行 `display: none`。结果：节点被加入 Cytoscape 后立刻被隐藏。

**修复策略**：删除 `visibleNodes`/`visibleEdges` 和 `syncVisibilityToCy`，改为直连模式——加入 cy 的节点默认可见，无需可见性管理。

---

## 文件改动总览

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/components/graph/GraphCanvas/GraphCanvas.tsx` | **修改** | 加 `forwardRef`，暴露 `CyHandle`；删除 Store→Cy 节点/边/可见性同步 |
| `src/components/graph/GraphCanvas/index.ts` | **修改** | 导出 `CyHandle` 类型 |
| `src/graph-engine/loader/GraphLoader.ts` | **修改** | 新增 `expandNodeRaw()` 方法 |
| `src/components/graph-viewer/GraphViewerPro.tsx` | **修改** | 重写数据加载：用 `cyRef.current.*` 直接驱动画布 |
| `src/graph-engine/store/graphEngineStore.ts` | **修改** | 删除 `visibleNodes`/`visibleEdges` 及相关 actions |
| `src/graph-engine/loader/BatchQueue.ts` | **保留** | `streamIntoStore` 仍用它把节点写入 Store（供 Search/SidePanel） |
| `src/graph-engine/layout/` (全目录) | **删除** | 布局改为主线程直接调用 cy |

---

## Chunk 1: CyHandle + GraphCanvas 重构

### Task 1: 在 Store 中删除 visibleNodes / visibleEdges

**Files:**
- Modify: `src/graph-engine/store/graphEngineStore.ts`

这是最高优先级：删除导致节点被隐藏的可见性系统。

- [ ] **Step 1: 从 `GraphEngineState` 类型中删除 visibleNodes/visibleEdges 字段及其 actions**

找到并删除以下内容（`graphEngineStore.ts`）：

```typescript
// 删除这些类型字段（约第 94-100 行）：
visibleNodes: Set<string>
visibleEdges: Set<string>

// 删除这些 action 类型（约第 156-166 行）：
setVisibleNodes: (ids: ReadonlySet<string>) => void
setVisibleEdges: (ids: ReadonlySet<string>) => void
recomputeVisibleEdges: () => void
```

- [ ] **Step 2: 从 Store 初始化和实现中删除对应字段**

删除初始状态中的：
```typescript
// 在 create() 初始 state 中删除：
visibleNodes:  new Set(),
visibleEdges:  new Set(),
```

删除 `initGraph` 和 `destroyGraph` 中的：
```typescript
visibleNodes:   new Set(),
visibleEdges:   new Set(),
```

删除 `removeNode` 中操作 visibleNodes 的代码（约第 298-303 行）：
```typescript
// 删除这三行及 set() 中的 visibleNodes 参数：
const visibleNodes = new Set(get().visibleNodes)
visibleNodes.delete(id)
// set() 改为：set({ nodes, edges })   ← 去掉 visibleNodes 参数
```
同时删除 `removeNode` 末尾的 `get().recomputeVisibleEdges()` 调用（约第 302 行）。

删除 `removeEdge` 中操作 visibleEdges 的代码：
```typescript
// 删除这两行及 set() 中的 visibleEdges 参数：
const visibleEdges = new Set(get().visibleEdges)
visibleEdges.delete(id)
// set() 改为：set({ edges })
```

完整删除 `setVisibleNodes`、`setVisibleEdges`、`recomputeVisibleEdges` 三个 action 实现（约第 350-405 行）。

- [ ] **Step 3: 删除 collapseCluster / expandCluster 中的 visibleNodes 引用和 recomputeVisibleEdges 调用**

`collapseCluster` 和 `expandCluster` 在简化架构下直接由 cy 管理节点显示，Store 不再管理可见性。将这两个函数中的 visibleNodes 操作和 `recomputeVisibleEdges` 调用全部删除：

```typescript
// collapseCluster 中删除：
const visibleNodes = new Set(get().visibleNodes)
for (const memberId of cluster.memberIds) visibleNodes.delete(memberId)
// set() 改为：set({ clusters, nodes })   ← 去掉 visibleNodes 参数
// 删除末尾的：get().recomputeVisibleEdges()

// expandCluster 中删除：
const visibleNodes = new Set(get().visibleNodes)
for (const memberId of cluster.memberIds) {
  // ... visible: true 的操作也删除
  visibleNodes.add(memberId)
}
// set() 改为：set({ clusters, nodes })   ← 去掉 visibleNodes 参数
// 删除末尾的：get().recomputeVisibleEdges()
```

注意：`clearClusters` 函数中对 `visible: true` 的节点属性设置可以保留（它不涉及 visibleNodes Set）。

- [ ] **Step 4: 删除 Selectors 中的 visibleNodes/visibleEdges selectors**

```typescript
// 删除：
export const selectVisibleNodeCount = (s: GraphEngineState) => s.visibleNodes.size
export const selectVisibleEdgeCount = (s: GraphEngineState) => s.visibleEdges.size
```

- [ ] **Step 5: 运行 TypeScript 编译检查**

```bash
cd code-graph-ui
npm run build 2>&1 | head -50
```

预期：关于 visibleNodes/visibleEdges 的类型错误（将在后续 Task 中修复）

- [ ] **Step 6: Commit**

```bash
cd code-graph-ui
git add src/graph-engine/store/graphEngineStore.ts
git commit -m "refactor: remove visibleNodes/visibleEdges from store"
```

---

### Task 2: 将 GraphCanvas 改为 forwardRef，暴露 CyHandle

**Files:**
- Modify: `src/components/graph/GraphCanvas/GraphCanvas.tsx`
- Modify: `src/components/graph/GraphCanvas/index.ts`

这是本 Chunk 最核心的改动。`CyHandle` 类型直接在 `GraphCanvas.tsx` 中定义（避免 index.ts ↔ GraphCanvas.tsx 循环引用），再由 `index.ts` 重导出。

- [ ] **Step 1: 在 `GraphCanvas.tsx` 顶部定义并导出 `CyHandle` 类型**

在 `GraphCanvas.tsx` 的现有 `import` 后、`GraphCanvasProps` 类型定义前，插入：

```typescript
// ─── CyHandle ─────────────────────────────────────────────────────────────────

/**
 * Imperative handle exposed by GraphCanvas via forwardRef.
 * Use this ref to drive the Cytoscape instance directly from a parent component.
 */
export type CyHandle = {
  /** Add nodes and edges to the canvas (incremental — does not clear first). */
  addElements(nodes: EngineGraphNode[], edges: EngineGraphEdge[]): void
  /** Remove all elements from the canvas. */
  clear(): void
  /**
   * Run a layout algorithm on the canvas.
   * @param algo            Algorithm name. Default: 'dagre'.
   * @param incrementalOnly If true, lock existing nodes so only newly-added ones
   *                        get repositioned. Default: false.
   */
  runLayout(algo?: 'dagre' | 'cose-bilkent', incrementalOnly?: boolean): Promise<void>
  /** Fit the viewport to show all elements, with optional padding (px). */
  fit(padding?: number): void
  /** Animate the viewport to center on a specific node. */
  focusNode(nodeId: string): void
}
```

- [ ] **Step 2: 修改 `GraphCanvas` 的导出声明为 `forwardRef`**

将：
```typescript
export const GraphCanvas: React.FC<GraphCanvasProps> = ({
  height          = '100%',
  onNodeClick,
  onNodeHover,
  onBackgroundClick,
  showStats    = true,
  showControls = true,
}) => {
```

改为：
```typescript
export const GraphCanvas = React.forwardRef<CyHandle, GraphCanvasProps>(function GraphCanvas({
  height          = '100%',
  onNodeClick,
  onNodeHover,
  onBackgroundClick,
  showStats    = true,
  showControls = true,
}, ref) {
```

组件末尾的 `}` 改为 `})`（闭合 `forwardRef`）。

- [ ] **Step 3: 在组件顶层（useEffect 之前）添加 `useImperativeHandle`**

`useImperativeHandle` 是 React Hook，**必须**在组件函数体顶层调用，不能放在 `useEffect` 内部。`cyRef` 是稳定的 Ref 对象，可以在闭包中安全访问。

在 `const cyRef = useRef<Core | null>(null)` 之后，第一个 `useEffect` 之前，插入：

```typescript
// Expose imperative CyHandle to parent via forwardRef.
// cyRef is a stable object — deps array [] is correct.
React.useImperativeHandle(ref, () => ({
  addElements(nodes: EngineGraphNode[], edges: EngineGraphEdge[]): void {
    const inst = cyRef.current
    if (!inst) return
    inst.startBatch()
    for (const node of nodes) {
      if (!inst.$id(node.id).length) {
        // Add node and mark it as 'new-node' so runLayout(incrementalOnly=true)
        // can identify it as a candidate for repositioning.
        inst.add(buildCyNode(node)).addClass('new-node')
      }
    }
    for (const edge of edges) {
      if (!inst.$id(edge.id).length &&
          inst.$id(edge.source).length &&
          inst.$id(edge.target).length) {
        inst.add(buildCyEdge(edge))
      }
    }
    inst.endBatch()
  },

  clear(): void {
    cyRef.current?.elements().remove()
  },

  runLayout(algo: 'dagre' | 'cose-bilkent' = 'dagre', incrementalOnly = false): Promise<void> {
    const inst = cyRef.current
    if (!inst) return Promise.resolve()
    return new Promise<void>((resolve) => {
      if (incrementalOnly) {
        // Lock existing nodes; only newly-added (class 'new-node') get repositioned
        inst.nodes().not('.new-node').lock()
      }
      const layout = inst.layout({
        name: algo,
        // @ts-expect-error cytoscape-dagre options
        rankDir:           'TB',
        nodeSep:           60,
        rankSep:           80,
        padding:           40,
        animate:           true,
        animationDuration: 400,
        stop: () => {
          if (incrementalOnly) {
            inst.nodes().unlock()
            inst.nodes().removeClass('new-node')
          }
          resolve()
        },
      })
      layout.run()
    })
  },

  fit(padding = 40): void {
    cyRef.current?.fit(undefined, padding)
  },

  focusNode(nodeId: string): void {
    const inst = cyRef.current
    if (!inst) return
    const node = inst.$id(nodeId)
    if (!node.length) return
    inst.animate({
      center:   { eles: node },
      zoom:     Math.max(inst.zoom(), 1.2),
      duration: 400,
      easing:   'ease-in-out-cubic',
    })
  },
}), []) // cyRef object is stable — no deps needed
```

- [ ] **Step 4: 从 Store 订阅中删除节点/边/可见性同步，保留 selection + search highlight**

在 `useEffect` 内找到 `const unsubscribeStore = useGraphEngineStore.subscribe(...)` 代码块，**整体替换**为：

```typescript
const unsubscribeStore = useGraphEngineStore.subscribe(
  (state: GraphEngineState, prev: GraphEngineState) => {
    if (!cyRef.current || cyRef.current.destroyed()) return
    const inst = cyRef.current  // 注意：使用 inst 变量，不要用闭包中的 cy

    // Selection: highlight neighbourhood, dim everything else
    if (state.selectedNodeId !== prev.selectedNodeId) {
      syncSelectionToCy(inst, state.selectedNodeId, prev.selectedNodeId)
      applyNeighbourhoodHighlight(inst, state.selectedNodeId)
    }

    // Search: add 'highlighted' class to search-result nodes
    if (state.filters.highlightedIds !== prev.filters.highlightedIds) {
      inst.startBatch()
      inst.nodes().removeClass('highlighted')
      state.filters.highlightedIds.forEach(id => {
        inst.$id(id).addClass('highlighted')
      })
      inst.endBatch()
    }
  },
)
```

**同时删除** subscriber 中原有的三个分支（它们驱动旧的间接渲染）：
- `if (state.nodes !== prev.nodes)` → 调用 `syncNodesToCy` 的分支
- `if (state.edges !== prev.edges)` → 调用 `syncEdgesToCy` 的分支
- `if (state.visibleNodes !== prev.visibleNodes || state.visibleEdges !== prev.visibleEdges)` → 调用 `syncVisibilityToCy` 的分支

**同时删除** useEffect 内的以下代码：
- `const initial = useGraphEngineStore.getState()` 及其后的 seed 代码块（`if (initial.nodes.size > 0) { ... }`）
- `const updateVisibleNodes = debounce(...)` 函数定义
- `cy.on('viewport', updateVisibleNodes)` 这一行

**保留**：
- `cy.on('zoom', () => { store.updateViewport(...) })` — 供 stats 栏读 zoom
- `cy.on('tap', 'node', ...)` — 节点点击
- `cy.on('tap', ...)` — 背景点击（取消选中）
- `cy.on('mouseover', 'node', ...)` — hover 高亮
- `cy.on('mouseout', 'node', ...)` — hover 取消

- [ ] **Step 5: 修复节点点击/hover 中读取节点数据的方式**

`buildCyNode` 并未将原始 `EngineGraphNode` 存入 `data('raw')`，因此不能用 `cyNode.data('raw')`。由于 `store.nodes` 仍然通过 `streamIntoStore` 填充（供 Search/SidePanel 使用），继续从 Store 读取是正确的：

```typescript
// tap node 保持原样，store.nodes 仍有数据：
cy.on('tap', 'node', (evt) => {
  const cyNode  = evt.target
  const nodeId: string = cyNode.id()
  const store   = useGraphEngineStore.getState()
  const node    = store.nodes.get(nodeId)
  if (!node) return

  store.setSelectedNode(nodeId)
  onNodeClick?.(node)
})

// mouseover node 保持原样：
cy.on('mouseover', 'node', (evt) => {
  const cyNode  = evt.target
  const nodeId: string = cyNode.id()
  const node    = useGraphEngineStore.getState().nodes.get(nodeId)
  if (!node) return

  cy.startBatch()
  cyNode.addClass('hovered')
  cy.elements()
    .not(cyNode.closedNeighborhood())
    .addClass('faded')
  cy.endBatch()

  container.style.cursor = 'pointer'
  onNodeHover?.(node)
})
```

- [ ] **Step 6: 修复 stats 栏不再反映实际画布节点数**

当前 stats 读 `selectNodeCount`（`store.nodes.size`）— 由于 `streamIntoStore` 仍运行，这个值其实是准确的，无需改动。但 `selectVisibleNodeCount`（读 `visibleNodes.size`，已被删除）需要替换。

改动：
1. 删除 `const visibleCount = useGraphEngineStore(selectVisibleNodeCount)` 这一行（变量定义）
2. 将 JSX 中 `visibleCount={visibleCount}` 改为 `visibleCount={totalCount}`（简化展示，不再区分可见/总数）
3. 删除 `selectVisibleNodeCount` 的 import

- [ ] **Step 7: 删除不再使用的函数和 import**

删除以下函数（不再被任何代码调用）：
- `syncNodesToCy` 函数（约第 79-106 行）
- `syncEdgesToCy` 函数（约第 112-135 行）
- `syncVisibilityToCy` 函数（约第 142-171 行）
- `debounce` 工具函数（约第 59-68 行）

删除以下 import：
- `computeBufferedBBox`, `isInBBox`, `VIEWPORT_DEBOUNCE_MS` from `'../../../graph-engine/types'`
- `selectVisibleNodeCount` from `'../../../graph-engine/store'`

- [ ] **Step 8: 更新 `index.ts` 重导出 CyHandle**

将 `src/components/graph/GraphCanvas/index.ts` 改为：

```typescript
export { GraphCanvas } from './GraphCanvas'
export type { CyHandle, GraphCanvasProps } from './GraphCanvas'
```

如果 `index.ts` 已有其他导出，保留它们，只添加 `CyHandle` 到 `export type` 列表。

- [ ] **Step 9: 运行 TypeScript 检查**

```bash
cd code-graph-ui
npm run build 2>&1 | head -80
```

预期：只有 `GraphViewerPro.tsx` 相关的类型错误（因为它还没更新）。

- [ ] **Step 10: Commit**

```bash
cd code-graph-ui
git add src/components/graph/GraphCanvas/GraphCanvas.tsx \
        src/components/graph/GraphCanvas/index.ts
git commit -m "feat: add CyHandle forwardRef to GraphCanvas, remove store-to-cy sync"
```

---

### Task 3: （已合并至 Task 2）

---

## Chunk 2: GraphLoader + GraphViewerPro + 收尾

### Task 5: GraphLoader 新增 `expandNodeRaw` 方法

**Files:**
- Modify: `src/graph-engine/loader/GraphLoader.ts`

`expandNodeRaw` 与现有 `expandNode` 的区别：不写入 Store，直接返回归一化后的节点/边。

- [ ] **Step 1: 删除 GraphLoader 中对 `recomputeVisibleEdges` 的调用**

`recomputeVisibleEdges` 已在 Task 1 中从 Store 中删除。`GraphLoader.ts` 中有两处调用需要同时删除：

1. `expandNode` 方法（约第 166 行）：`store.recomputeVisibleEdges()` — 直接删除这一行
2. `streamIntoStore` 的 `onComplete` 回调（约第 366 行）：`store.recomputeVisibleEdges()` — 直接删除这一行

不删除这两处会导致运行时报错（`store.recomputeVisibleEdges is not a function`）。

- [ ] **Step 2: 在 `GraphLoader` 类中新增 `expandNodeRaw` 方法**

在 `expandNode` 方法（约第 154 行）之后插入：

```typescript
/**
 * Fetch the direct children of `nodeId` and return them directly.
 *
 * Unlike `expandNode`, this method does NOT write to the store.
 * The caller is responsible for adding elements to the canvas via CyHandle.
 *
 * @returns Normalized nodes/edges, or empty arrays if the request fails.
 */
async expandNodeRaw(nodeId: string): Promise<{
  nodes: EngineGraphNode[]
  edges: EngineGraphEdge[]
  hasMore: boolean
}> {
  try {
    const data = await this.fetchExpand(nodeId)
    return {
      nodes:   normalizeNodes(data.nodes),
      edges:   normalizeEdges(data.edges),
      hasMore: data.has_more,
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      return { nodes: [], edges: [], hasMore: false }
    }
    throw err
  }
}
```

- [ ] **Step 3: 同时修改 `loadInitialGraph` 的返回值，返回归一化的节点/边**

当前 `loadInitialGraph` 只返回计数。改为同时返回节点和边（供 `GraphViewerPro` 传给 cy）：

将 `LoadInitialResult` 类型（在 `loader/types.ts` 中）或内联修改返回值：

在 `GraphLoader.ts` 的 `loadInitialGraph` 方法中，将：
```typescript
return {
  nodeCount:      nodes.length,
  edgeCount:      edges.length,
  totalNodeCount: data.total_node_count,
  totalEdgeCount: data.total_edge_count,
}
```

改为：
```typescript
return {
  nodes,          // ← 新增：归一化后的节点数组
  edges,          // ← 新增：归一化后的边数组
  nodeCount:      nodes.length,
  edgeCount:      edges.length,
  totalNodeCount: data.total_node_count,
  totalEdgeCount: data.total_edge_count,
}
```

同时更新 `loader/types.ts` 中的 `LoadInitialResult` 类型（如果存在）：
```typescript
export type LoadInitialResult = {
  nodes:          EngineGraphNode[]
  edges:          EngineGraphEdge[]
  nodeCount:      number
  edgeCount:      number
  totalNodeCount: number
  totalEdgeCount: number
}
```

同时更新 `loadInitialGraph` catch 分支的 AbortError 返回值，使其包含 `nodes`/`edges`：
```typescript
// catch 分支中将：
return { nodeCount: 0, edgeCount: 0, totalNodeCount: 0, totalEdgeCount: 0 }
// 改为：
return { nodes: [], edges: [], nodeCount: 0, edgeCount: 0, totalNodeCount: 0, totalEdgeCount: 0 }
```

**注意**：`loadInitialGraph` 内部仍会调用 `streamIntoStore` 把节点写入 Store（供 GraphSearch / GraphSidePanel 使用）。不删除这个调用。

- [ ] **Step 4: 运行 TypeScript 检查**

```bash
cd code-graph-ui
npx tsc --noEmit 2>&1 | grep "GraphLoader\|loader" | head -20
```

- [ ] **Step 5: Commit**

```bash
cd code-graph-ui
git add src/graph-engine/loader/GraphLoader.ts src/graph-engine/loader/types.ts
git commit -m "feat: add expandNodeRaw to GraphLoader, return nodes/edges from loadInitialGraph"
```

---

### Task 6: 重写 GraphViewerPro 数据加载

**Files:**
- Modify: `src/components/graph-viewer/GraphViewerPro.tsx`

这是最重要的一步：把数据加载从 "写 Store 等 GraphCanvas 订阅" 改为 "直接调用 cyRef"。

- [ ] **Step 1: 修改 GraphCanvas 的使用方式（加 ref）**

在 `GraphViewerPro.tsx` 中：

添加 import：
```typescript
import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { CyHandle } from '../graph/GraphCanvas'
```

在组件内添加 ref：
```typescript
const cyRef = useRef<CyHandle | null>(null)
```

修改 `CanvasWithEvents` 组件，将 cyRef 传入：

将：
```tsx
const CanvasWithEvents: React.FC<{ wrapRef: React.RefObject<HTMLDivElement | null> }> = ...
  return <GraphCanvas height="100%" showStats={false} showControls={true} />
```

改为：
```tsx
type CanvasWithEventsProps = {
  wrapRef: React.RefObject<HTMLDivElement | null>
  cyRef:   React.RefObject<CyHandle | null>
}

const CanvasWithEvents: React.FC<CanvasWithEventsProps> = ({ wrapRef, cyRef }) => {
  void wrapRef
  return (
    <GraphCanvas
      ref={cyRef}
      height="100%"
      showStats={true}
      showControls={true}
    />
  )
}
```

在 `GraphViewerPro` 的 render 中，给 `CanvasWithEvents` 传入 `cyRef`：
```tsx
<CanvasWithEvents wrapRef={canvasWrapRef} cyRef={cyRef} />
```

- [ ] **Step 2: 重写图谱初始化 useEffect**

将现有 useEffect（约第 63-89 行）替换为：

```typescript
useEffect(() => {
  if (!graphId) return

  initGraph(graphId)

  const loader = createGraphLoader(graphId)
  loaderRef.current = loader

  const t0 = performance.now()

  // Load initial graph (LOD-0: Repository + Module)
  loader.loadInitialGraph()
    .then((result) => {
      if (!cyRef.current) return  // unmounted
      cyRef.current.clear()
      cyRef.current.addElements(result.nodes, result.edges)
      return cyRef.current.runLayout('dagre')
    })
    .then(() => {
      if (!cyRef.current) return
      cyRef.current.fit()
      console.log(`[GraphViewerPro] initial load: ${Math.round(performance.now() - t0)}ms`)
    })
    .catch(err => {
      console.error('[GraphViewerPro] load failed:', err)
    })

  return () => {
    loader.abort()
    loaderRef.current = null
    destroyGraph()
  }
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [graphId])
```

**注意**：删除对 `getLayoutWorker` / `terminateLayoutWorker` 的调用和 import。

- [ ] **Step 3: 重写 handleExpandNode**

将现有：
```typescript
const handleExpandNode = useCallback(async (nodeId: string) => {
  const loader = loaderRef.current
  if (!loader) return
  await loader.expandNode(nodeId)
  getLayoutWorker().computeLayoutFromStore().catch(() => undefined)
}, [])
```

改为：
```typescript
const handleExpandNode = useCallback(async (nodeId: string) => {
  const loader = loaderRef.current
  const cy     = cyRef.current
  if (!loader || !cy) return

  // Use getState() inside callback to avoid subscribing to re-renders
  const store = useGraphEngineStore.getState()
  store.setExpandingNode(nodeId)
  try {
    const { nodes, edges } = await loader.expandNodeRaw(nodeId)
    // addElements() adds 'new-node' class automatically;
    // runLayout(incrementalOnly=true) locks existing nodes so only new ones move.
    cy.addElements(nodes, edges)
    await cy.runLayout('dagre', true)  // incrementalOnly = true
    cy.focusNode(nodeId)
    useGraphEngineStore.getState().markExpanded(nodeId)
    // Also merge into store for search/sidepanel
    useGraphEngineStore.getState().mergeNodes(nodes)
    useGraphEngineStore.getState().mergeEdges(edges)
  } finally {
    useGraphEngineStore.getState().setExpandingNode(null)
  }
}, []) // no deps: uses refs and getState() calls
```

- [ ] **Step 4: 改写 `handleRunLayout`，删除 LayoutWorker 相关 import**

`handleRunLayout` 当前调用 `getLayoutWorker().computeLayoutFromStore()`，Task 7 删除 layout 目录后会崩溃。改为通过 `cyRef` 调用：

```typescript
const handleRunLayout = useCallback(async () => {
  setLayoutRunning(true)
  try {
    await cyRef.current?.runLayout('dagre')
    cyRef.current?.fit()
  } finally {
    setLayoutRunning(false)
  }
}, [])
```

同时删除以下 import（不再需要）：
```typescript
import { getLayoutWorker, terminateLayoutWorker } from '../../graph-engine/layout'
```

同时删除 cleanup 函数中的 `terminateLayoutWorker()` 调用（如果存在）。

- [ ] **Step 5: 运行开发服务器确认编译通过**

```bash
cd code-graph-ui
npm run dev 2>&1 | head -30
```

预期：无编译错误，开发服务器启动在 http://localhost:5173

- [ ] **Step 6: 手动测试**

1. 打开 http://localhost:5173/architecture
2. 选择一个已分析的仓库
3. 预期：Repository 和 Module 节点出现在画布上，自动排布为 dagre 树形
4. 点击一个 Module 节点，在 SidePanel 中点击"展开"
5. 预期：子节点增量出现，已有节点位置不变

- [ ] **Step 7: Commit**

```bash
cd code-graph-ui
git add src/components/graph-viewer/GraphViewerPro.tsx
git commit -m "feat: rewrite GraphViewerPro to drive Cytoscape via CyHandle directly"
```

---

### Task 7: 删除 LayoutWorker（BatchQueue 保留）

**Files:**
- **保留**: `src/graph-engine/loader/BatchQueue.ts`（`streamIntoStore` 仍使用它把节点写入 Store 供 Search/SidePanel）
- Delete: `src/graph-engine/layout/` (全目录)

- [ ] **Step 1: 确认 LayoutWorker 无其他引用**

```bash
cd code-graph-ui
grep -r "getLayoutWorker\|terminateLayoutWorker\|GraphLayoutWorker\|layoutWorker" src/ --include="*.ts" --include="*.tsx"
```

预期：`GraphViewerPro.tsx` 中的引用已在 Task 6 中删除，结果为空。

- [ ] **Step 2: 确认 BatchQueue 仍被 GraphLoader.ts 使用（不删除）**

```bash
cd code-graph-ui
grep -r "BatchQueue\|buildWorkQueue" src/ --include="*.ts" --include="*.tsx"
```

预期：只在 `GraphLoader.ts` 的 `streamIntoStore` 中有引用 — 这是正常的，保留不删除。

- [ ] **Step 3: 删除 layout 目录**

```bash
cd code-graph-ui
rm -rf src/graph-engine/layout/
```

- [ ] **Step 4: 运行编译确认无残留引用**

```bash
cd code-graph-ui
npx tsc --noEmit 2>&1 | head -30
```

预期：无与 layout 相关的错误

- [ ] **Step 5: Commit**

```bash
cd code-graph-ui
git add -A src/graph-engine/layout/
git commit -m "chore: remove GraphLayoutWorker (replaced by direct cy.layout() calls)"
```

---

### Task 8: 收尾 — 修复残留 TypeScript 错误

**Files:**
- Various（根据编译结果）

- [ ] **Step 1: 全量编译检查**

```bash
cd code-graph-ui
npm run build 2>&1
```

- [ ] **Step 2: 修复所有剩余错误**

常见问题：
- `selectVisibleNodeCount` 被删除但仍有 import → 删除该 import
- `visibleNodes`/`visibleEdges` 在某处仍被引用 → 删除引用
- `LoadInitialResult` 类型不匹配 → 更新 `loader/types.ts`
- `GraphMiniMap`（`src/components/graph-viewer/GraphMiniMap.tsx`）若读 `visibleNodes` → 改为读 `nodes`（仍在 store 中）或直接删除该引用
- `GraphViewerPro.tsx` 中 `const nodes = useGraphEngineStore(s => s.nodes)` 用于计算 `presentTypes`（过滤面板节点类型列表）— 这个订阅**合法保留**，`nodes` Map 仍在 store 中（Task 1 只删除了 `visibleNodes`/`visibleEdges`）

- [ ] **Step 3: 最终手动验证**

验证清单：
- [ ] 架构图页面，选择仓库，节点正常显示（Repository + Module）
- [ ] 点击节点，SidePanel 出现并显示节点详情
- [ ] 点击 SidePanel "展开"按钮，子节点增量出现
- [ ] 搜索功能正常工作（节点高亮）
- [ ] 过滤面板正常工作
- [ ] 控制台无 TypeError/未处理 Promise rejection

- [ ] **Step 4: 最终 Commit**

```bash
cd code-graph-ui
git add -A
git commit -m "fix: architecture graph now renders correctly with simplified direct-cy pipeline"
```

---

## 附录：根本原因总结

**Bug**：`streamIntoStore` 完成后调用 `recomputeVisibleEdges()`，由于 `visibleNodes` 为空，所有边的 `shouldBeVisible = false`，`visibleEdges` 被设为新的空 Set（引用变化）→ 触发 store subscriber → `syncVisibilityToCy(cy, {}, {})` → 对所有节点执行 `display: none`。

**修复**：删除 `visibleNodes`/`visibleEdges` 可见性系统，改为直连 cy，节点默认可见。
