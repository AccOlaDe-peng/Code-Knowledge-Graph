# 架构图渲染管道简化设计

**日期**：2026-03-17
**状态**：已批准
**分支**：dev/v2

---

## 背景与问题

当前架构图前端无法展示节点。后端 API 返回正常，但画布为空。

根因：现有渲染管道层次过深，任何一环断掉均导致节点不显示：

```
API → GraphLoader → BatchQueue (RAF) → graphEngineStore →
useEffect 订阅 → syncNodesToCy → Cytoscape
```

此外，用户目标是：**先展示高层节点（Repository/Module），支持手动点击展开子节点**。

---

## 目标

1. 修复架构图节点不显示的问题
2. 实现可靠的 LOD 展开交互（点击展开子节点）
3. 节点非常多时不影响使用（按需加载，不一次性渲染全图）

---

## 方案：简化渲染管道 + 直连 Cytoscape

### 核心原则

**移除间接层**，改为 `GraphViewerPro` 通过 imperative ref 直接调用 Cytoscape：

```
API → 归一化 → cy.add() → dagre layout → fit
         ↑
     点击展开（expandNode）
         ↓
API (/expand) → cy.add(增量) → 局部 layout → focusNode
```

---

## 架构设计

### 1. CyHandle 接口

`GraphCanvas` 通过 `React.forwardRef + useImperativeHandle` 暴露命令式 API：

```typescript
type CyHandle = {
  addElements(nodes: EngineGraphNode[], edges: EngineGraphEdge[]): void
  clear(): void
  runLayout(algo?: 'dagre' | 'cose-bilkent', opts?: object): Promise<void>
  fit(padding?: number): void
  focusNode(nodeId: string): void
}
```

### 2. 数据流

**初始加载（mount 时）：**
```
1. store.setLoading('streaming')
2. cyRef.current.clear()
3. loader.loadInitialGraph()
   → 内部先尝试 GET /graph/summary，404 时 fallback 到 GET /graph 并客户端过滤
   → 返回 { nodes: EngineGraphNode[], edges: EngineGraphEdge[] }（已归一化）
4. cyRef.current.addElements(nodes, edges)
5. cyRef.current.runLayout('dagre')
6. cyRef.current.fit()
7. store.setLoading('done')
```

**点击展开节点：**
```
1. store.setExpandingNode(nodeId)
2. loader.expandNodeRaw(nodeId)
   → GET /graph/expand?node_id=xxx → 返回 { nodes, edges, has_more }（已归一化，不写 Store）
3. cyRef.current.addElements(newNodes, newEdges)
4. cyRef.current.runLayout('dagre', { incrementalOnly: true })
   → 实现：先 cy.nodes().not('.new').lock()，再跑 dagre，完成后解锁
   → 仅新增节点参与布局，已有节点位置不变
5. cyRef.current.focusNode(nodeId)
6. store.markExpanded(nodeId)

失败处理：API 失败时画布保留当前已有节点，不做回滚；
store.setExpandingNode(null) 在 finally 块中执行（自动清除 spinner）。
```

**注意**：`GraphLoader` 需新增 `expandNodeRaw` 方法，返回原始 `{ nodes, edges }` 而不写入 Store，供 `GraphViewerPro` 直接传给 `cyRef`。原有 `expandNode`（写 Store 版本）在新流程中不再使用。

### 3. 组件边界

| 文件 | 改动 |
|------|------|
| `GraphCanvas.tsx` | 加 `forwardRef`，通过 `useImperativeHandle` 暴露 `CyHandle` |
| `GraphViewerPro.tsx` | 重写数据加载部分，用 `cyRef.current.*` 直接驱动画布 |
| `GraphSidePanel.tsx` | 不动，"展开"按钮回调改为调用 `handleExpandNode` |
| `GraphLoader.ts` | 新增 `expandNodeRaw(nodeId)` 方法（直接返回 `{ nodes, edges }`，不写 Store）；原有 API 调用逻辑保留 |
| `graphEngineStore.ts` | 精简：只保留 `selectedNode`、`expandedNodes`、`loading`、`expandingNodeId`；删除 `nodes`/`edges`/`visibleNodes`/`visibleEdges` Map（节点数据完全由 Cytoscape 持有） |

### 4. 删除清单

| 删除内容 | 原因 |
|---------|------|
| `BatchQueue.ts` | RAF 分帧交付，直连后不需要 |
| `GraphLayoutWorker` + worker 文件 | 布局改为主线程直接调用 cy（初始图 < 200 节点，无阻塞风险） |
| Store 中的 `nodes` / `edges` / `visibleNodes` / `visibleEdges` Map | 节点数据由 Cytoscape 自己持有，Store 不再双份存储 |
| `syncNodesToCy` / `buildCyNode` / `syncEdgesToCy` 等同步函数 | 被 `addElements` 取代 |

---

## 不在范围内

- 修改后端 API
- 修改其他页面（CallGraph、Lineage 等）
- 修改设计系统 / 主题

---

## 成功标准

1. 打开架构图页面，选择仓库后，Repository 和 Module 节点正常显示
2. 点击节点侧边栏中的"展开"按钮，子节点增量出现在画布上
3. 节点数量超过 1000 时，初始加载仍在 2 秒内完成（因为初始只加载 LOD-0）：从 `loadInitialGraph()` 调用开始，到 `cyRef.current.fit()` 执行完毕，elapsed time < 2000ms（通过 `console.time` 或 Performance API 验证）
