# 调用图交互改进计划

## 背景

当前前端调用图的交互体验不佳，用户反馈：
- 拖拽卡顿/不跟手
- 缩放后找不到方向
- 布局不清晰
- 节点太多看不过来

目标图谱规模：2000-5000 节点。

## 方案概述

将 CallGraph 从独立的 `CallGraphCanvas` 迁移到 `GraphEngine` 架构，并新增小地图导航和拖拽优化。

## 实施步骤

### Phase 1: 拖拽性能优化

**目标**：解决 2000-5000 节点图谱拖拽卡顿问题

**改动**：

1. **扩展 graphEngineStore**
   - 新增 `isDragging: boolean` 状态
   - 新增 `setDragging(isDragging: boolean)` action

2. **修改 GraphCanvas**
   - 监听 `grab` 事件：设置 `isDragging = true`
   - 监听 `free` 事件：设置 `isDragging = false`
   - 拖拽时添加 CSS class `.dragging` 到容器，通过样式隐藏边：
     ```css
     .dragging .cy-edge { opacity: 0 !important; }
     ```

3. **性能收益**
   - 拖拽时边数量从 O(E) 降到 0
   - 减少 GPU 重绘负担

### Phase 2: 小地图导航

**目标**：解决缩放后迷失方向问题

**改动**：

1. **创建 GraphMinimap 组件** (`src/graph-engine/components/GraphMinimap/`)
   - 独立的 Cytoscape 实例（共享样式，简化版本）
   - 实时同步主视图节点位置
   - 显示当前视口矩形框
   - 支持点击定位

2. **视口矩形同步**
   - 主视图 pan/zoom 变化时更新小地图视口框
   - 小地图点击时计算对应主视图位置并 animate

3. **性能优化**
   - 小地图使用简化样式（无标签、无边）
   - 节省渲染资源

### Phase 3: 重构 CallGraph 页面

**目标**：统一使用 GraphEngine 架构

**改动**：

1. **迁移到 GraphEngine**
   - 删除 CallGraphCanvas 组件
   - CallGraph 页面使用 GraphCanvas + graphEngineStore
   - 保留 BFS 深度过滤逻辑（迁移到 store）

2. **扩展 graphEngineStore for CallGraph**
   - 新增 `focusNodeId: string | null` 状态
   - 新增 `depth: number` 状态
   - 新增 `visibleIds: Set<string>` 计算属性
   - 新增 `setFocusNode(nodeId: string | null)` action
   - 新增 `setDepth(depth: number)` action

3. **保留现有功能**
   - 深度滑块（1-6 层）
   - 搜索高亮
   - 大图谱自动聚焦
   - 节点详情面板

### Phase 4: 布局与搜索增强

**目标**：提升布局清晰度和搜索体验

**改动**：

1. **布局算法选择**
   - 新增布局切换按钮（dagre LR / dagre TB / cose-bilkent）
   - 存储用户偏好到 localStorage

2. **搜索自动聚焦**
   - 搜索匹配后自动聚焦第一个结果
   - 添加「下一个」「上一个」搜索导航按钮

3. **搜索结果计数**
   - 显示匹配节点数量

### Phase 5: 视口持久化

**目标**：刷新后恢复用户视口位置

**改动**：

1. **视口状态存储**
   - pan/zoom 变化时 debounce 写入 localStorage
   - key 格式：`callgraph:${repoId}:viewport`

2. **视口恢复**
   - 加载图谱时读取 localStorage
   - 无缓存时使用 fit 默认行为

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/graph-engine/store/graphEngineStore.ts` | 修改 | 新增 isDragging/focusNodeId/depth 状态 |
| `src/graph-engine/components/GraphMinimap/index.tsx` | 新增 | 小地图容器组件 |
| `src/graph-engine/components/GraphMinimap/MinimapCanvas.tsx` | 新增 | 小地图 Cytoscape 渲染 |
| `src/components/graph/GraphCanvas/GraphCanvas.tsx` | 修改 | 拖拽优化 + 集成小地图 |
| `src/pages/CallGraph/index.tsx` | 重构 | 使用 GraphEngine 架构 |
| `src/components/graph/CallGraphCanvas/` | 删除 | 废弃独立组件 |

## 验收标准

1. **拖拽流畅度**：3000 节点图谱拖拽帧率 > 30fps
2. **小地图导航**：点击小地图可在 300ms 内定位到目标区域
3. **搜索定位**：输入搜索词后 200ms 内高亮并聚焦第一个结果
4. **视口恢复**：刷新页面后视口位置保持不变

## 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| 小地图同步可能增加主线程负担 | 使用 RAF 节流，仅 60fps 同步 |
| 拖拽时隐藏边可能影响用户理解 | 仅在拖拽时隐藏，释放立即恢复 |
| 重构可能引入回归 | 保留现有测试，新增交互测试 |

## 时间估算

- Phase 1 (拖拽优化): 2-3 小时
- Phase 2 (小地图): 4-5 小时
- Phase 3 (重构 CallGraph): 3-4 小时
- Phase 4 (布局与搜索): 2-3 小时
- Phase 5 (视口持久化): 1-2 小时

**总计**: 12-17 小时
