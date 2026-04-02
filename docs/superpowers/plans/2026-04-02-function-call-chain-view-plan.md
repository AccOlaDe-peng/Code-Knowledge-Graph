# 函数调用链视图实现计划

## 概述

根据设计文档 `docs/superpowers/specs/2026-04-02-function-call-chain-view-design.md`，在模块详情视图中新增「函数调用链」模式。

## 实现步骤

### Phase 1: Store 扩展

**文件**: `code-graph-ui/src/store/functionCallStore.ts`

1. 新增状态字段：
   - `viewMode: "heatmap" | "callchain"` — 视图模式，默认 `"heatmap"`
   - `callChainRootId: string | null` — 调用链根节点 ID
   - `collapsedNodes: Set<string>` — 折叠的虚拟节点 ID 集合

2. 新增 Actions：
   - `setViewMode(mode)` — 切换视图模式
   - `setCallChainRoot(funcId)` — 设置调用链根节点
   - `toggleCollapsedNode(nodeId)` — 切换折叠节点状态
   - `resetCallChain()` — 重置调用链状态

3. 新增辅助方法：
   - `getCallChainNodes()` — 获取调用链所有节点（带距离和方向）
   - `getCallChainEdges()` — 获取调用链所有边

---

### Phase 2: 类型定义

**文件**: `code-graph-ui/src/pages/FunctionCallGraph/types.ts`

1. 新增类型：
   ```typescript
   export type ViewMode = "heatmap" | "callchain";

   export interface CallChainNodeData extends FunctionInfo {
     distance: number;
     direction: "caller" | "callee" | "root";
     isCollapsed?: boolean;
     collapsedCount?: number;
   }

   export interface CallChainEdgeData {
     sourceLine: number;
     callType: "direct" | "interface";
     isCrossModule: boolean;
   }
   ```

---

### Phase 3: 调用链数据处理 Hook

**文件**: `code-graph-ui/src/pages/FunctionCallGraph/components/ModuleDetail/hooks/useCallChainData.ts`（新建）

1. 实现 BFS 遍历获取完整调用链：
   - 从根节点出发，向左遍历 callers，向右遍历 callees
   - 记录每个节点的距离（distance）和方向（direction）
   - 检测循环调用

2. 实现智能折叠逻辑：
   - 默认展开深度为 3 层
   - 超过深度的节点折叠为虚拟节点
   - 统计每层折叠的节点数量

3. 返回值：
   - `nodes: CallChainNodeData[]` — 节点列表
   - `edges: CallChainEdgeData[]` — 边列表
   - `collapseInfo: Map<string, number>` — 折叠节点信息

---

### Phase 4: 调用链布局算法

**文件**: `code-graph-ui/src/pages/FunctionCallGraph/utils/layout.ts`

1. 新增 `computeCallChainLayout` 函数：
   - 基于 Dagre 布局
   - 确保根节点在中心偏左
   - callers 在左侧，callees 在右侧
   - 同层级节点垂直对齐

2. 处理折叠节点的布局：
   - 折叠节点作为虚拟节点参与布局
   - 保持层级对齐

---

### Phase 5: 调用链视图组件

**文件**: `code-graph-ui/src/pages/FunctionCallGraph/components/ModuleDetail/CallChainView.tsx`（新建）

1. 主组件结构：
   ```tsx
   const CallChainView: React.FC = () => {
     // 使用 useCallChainData hook
     // 渲染 ReactFlow
     // 处理节点点击（展开折叠）
   };
   ```

2. 自定义节点组件 `CallChainNode.tsx`：
   - 复用现有 FunctionNode 样式
   - 增强选中状态（加粗边框 + 发光）
   - 折叠节点样式（虚线边框 + 展开图标）

3. 自定义边组件 `CallChainEdge.tsx`：
   - 使用 `EdgeLabelRenderer` 显示调用信息
   - 显示：行号 `L:42` + 调用类型
   - 区分样式：同模块/跨模块/接口调用

---

### Phase 6: 模式切换 UI

**文件**: `code-graph-ui/src/pages/FunctionCallGraph/components/ModuleDetail/index.tsx`

1. 修改控制面板，添加模式切换：
   - 使用 Radio.Group 或 Segmented 组件
   - 选项：「热点图」/「调用链」

2. 根据模式渲染不同视图：
   ```tsx
   {viewMode === "heatmap" ? (
     <HeatmapView />
   ) : (
     <CallChainView />
   )}
   ```

3. 修改函数列表点击行为：
   - 在调用链模式下，点击函数设置 `callChainRootId`

---

### Phase 7: 样式和交互细节

1. **边样式**（`CallChainEdge.tsx`）：
   - 同模块调用：青色实线 `#00d4ff`
   - 跨模块调用：橙色虚线 `#ffc145`
   - 接口调用：紫色虚线 `#b08eff`

2. **节点样式**：
   - 选中函数：加粗边框 + 发光效果
   - 折叠节点：灰色虚线边框 + 展开图标 + 节点数量

3. **交互**：
   - 点击折叠节点展开该层级
   - 点击普通节点选中并高亮

---

### Phase 8: 边界情况处理

1. **无调用关系的函数**：
   - 显示单个节点
   - 在图上显示提示「无调用关系」

2. **循环调用检测**：
   - 在 `useCallChainData` 中检测循环
   - 循环边使用红色标记 `#ff6b6b`

3. **超大量节点**：
   - 当节点数 > 200 时，默认折叠到 2 层
   - 显示提示「节点较多，已折叠部分层级」

4. **外部函数**：
   - 跨模块调用的外部函数
   - 显示模块名标签

---

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/store/functionCallStore.ts` | 修改 | 新增 viewMode、callChainRootId 等状态 |
| `src/pages/FunctionCallGraph/types.ts` | 修改 | 新增 ViewMode、CallChainNodeData 等类型 |
| `src/pages/FunctionCallGraph/utils/layout.ts` | 修改 | 新增 computeCallChainLayout 函数 |
| `src/pages/FunctionCallGraph/components/ModuleDetail/index.tsx` | 修改 | 添加模式切换逻辑 |
| `src/pages/FunctionCallGraph/components/ModuleDetail/CallChainView.tsx` | 新建 | 调用链视图主组件 |
| `src/pages/FunctionCallGraph/components/ModuleDetail/CallChainNode.tsx` | 新建 | 调用链节点组件 |
| `src/pages/FunctionCallGraph/components/ModuleDetail/CallChainEdge.tsx` | 新建 | 调用链边组件 |
| `src/pages/FunctionCallGraph/components/ModuleDetail/hooks/useCallChainData.ts` | 新建 | 调用链数据处理 Hook |

---

## 验收检查

- [ ] 用户可切换「热点图」/「调用链」两种模式
- [ ] 在调用链模式下，点击函数列表展示完整调用链
- [ ] 调用链布局从左到右，调用者在左，被调用者在右
- [ ] 边上显示调用行号和调用类型
- [ ] 距离超过 3 层的节点自动折叠
- [ ] 点击折叠节点可展开
- [ ] 区分同模块/跨模块/接口调用的边样式
- [ ] 无调用关系的函数显示单个节点
- [ ] 循环调用用红色边标记

---

## 依赖项

- 无新增外部依赖
- 复用现有 dagre 布局库
- 复用现有 ReactFlow 组件
