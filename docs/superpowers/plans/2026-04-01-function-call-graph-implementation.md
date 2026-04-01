# 函数调用图功能实现计划

## 概述

基于设计规格文档 `docs/superpowers/specs/2026-04-01-function-call-graph-design.md`，实现三层视图的函数调用图可视化功能。

---

## Phase 1: 后端 API（P0）

### Task 1.1: 添加函数调用图数据 API

**文件**: `code-graph-system/backend/api/routers/graphs.py`

**新增端点**:
```
GET /graph/function-call?repo_id={repo_id}
```

**实现步骤**:
1. 定义 Pydantic 响应模型（Module、Function、CallChain、ModuleCall）
2. 实现 `_load_function_call_graph(repo_id)` 辅助函数
3. 实现 `_compute_module_calls(data)` 计算模块间调用统计
4. 添加路由处理函数

**响应模型**:
```python
class FunctionCallGraphResponse(BaseModel):
    repo_id: str
    project_name: str
    total_modules: int
    total_functions: int
    total_call_chains: int
    modules: list[dict]
    call_chains: list[dict]
    module_calls: list[dict]  # 聚合数据
```

### Task 1.2: 添加路径追踪 API

**文件**: `code-graph-system/backend/api/routers/graphs.py`

**新增端点**:
```
GET /graph/function-call/path?repo_id={repo_id}&from={func_id}&to={func_id}
```

**实现步骤**:
1. 实现 BFS 路径搜索算法
2. 支持多路径返回（最多 5 条）
3. 最大深度限制 10 层

**响应模型**:
```python
class PathTraceResponse(BaseModel):
    found: bool
    paths: list[dict]
    max_depth_reached: bool = False
```

---

## Phase 2: 前端基础架构（P0）

### Task 2.1: 定义 TypeScript 类型

**文件**: `code-graph-ui/src/pages/FunctionCallGraph/types.ts`

**内容**:
- `FunctionCallGraph` 接口
- `Module` 接口
- `Function` 接口
- `CallChain` 接口
- `ModuleCall` 接口
- `FunctionType` 类型
- 路径追踪相关类型

### Task 2.2: 创建 Zustand Store

**文件**: `code-graph-ui/src/store/functionCallStore.ts`

**状态**:
```typescript
type FunctionCallStore = {
  // 数据
  data: FunctionCallGraph | null;
  loading: boolean;
  error: string | null;

  // 视图状态
  currentView: 'overview' | 'detail';
  selectedModuleId: string | null;
  selectedFunctionId: string | null;

  // 路径追踪
  pathFrom: string | null;
  pathTo: string | null;
  tracedPaths: TracedPath[] | null;

  // Actions
  loadData: (repoId: string) => Promise<void>;
  setSelectedModule: (id: string | null) => void;
  setSelectedFunction: (id: string | null) => void;
  setPathFrom: (funcId: string | null) => void;
  setPathTo: (funcId: string | null) => void;
  tracePath: () => Promise<void>;
  reset: () => void;
};
```

### Task 2.3: 添加 API 调用

**文件**: `code-graph-ui/src/api/graphApi.ts`

**新增方法**:
```typescript
// 获取函数调用图数据
getFunctionCallGraph(repoId: string): Promise<FunctionCallGraphResponse>

// 路径追踪
traceFunctionPath(repoId: string, from: string, to: string): Promise<PathTraceResponse>
```

---

## Phase 3: 前端组件开发（P0）

### Task 3.1: 主页面容器

**文件**: `code-graph-ui/src/pages/FunctionCallGraph/index.tsx`

**职责**:
- 数据加载入口
- 视图切换逻辑（overview / detail）
- 工具栏（仓库选择、搜索、返回按钮）
- 布局容器

**结构**:
```tsx
<FunctionCallGraph>
  <Toolbar>
    <RepoSelector />
    <GlobalSearch />
    <BackButton /> {/* 仅 detail 视图显示 */}
  </Toolbar>

  {currentView === 'overview' && <ModuleOverview />}
  {currentView === 'detail' && <ModuleDetail />}

  <FunctionDrawer />
  <PathTracePanel />
</FunctionCallGraph>
```

### Task 3.2: 模块总览组件

**文件**: `code-graph-ui/src/pages/FunctionCallGraph/components/ModuleOverview/index.tsx`

**职责**:
- 渲染模块节点（ReactFlow）
- 渲染模块间调用边
- 力导向布局
- 点击模块进入详情

**子组件**:
- `ModuleNode.tsx` - 模块节点渲染
- `ModuleEdge.tsx` - 模块边渲染

**数据映射**:
- 节点: modules[] → ReactFlow nodes
- 边: module_calls[] → ReactFlow edges
- 节点大小: Math.sqrt(functionCount) * 缩放因子
- 边粗细: Math.log(count) * 缩放因子

### Task 3.3: 模块详情组件

**文件**: `code-graph-ui/src/pages/FunctionCallGraph/components/ModuleDetail/index.tsx`

**职责**:
- 左侧面板：模块树 + 函数列表
- 右侧面板：函数调用图（Dagre 布局）
- 过滤和搜索

**子组件**:
- `ModuleTree.tsx` - 左侧模块树导航
- `FunctionList.tsx` - 左侧函数列表（支持类型过滤）
- `FunctionGraph.tsx` - 右侧函数调用图

### Task 3.4: 函数详情抽屉

**文件**: `code-graph-ui/src/pages/FunctionCallGraph/components/FunctionDrawer/index.tsx`

**职责**:
- 显示函数签名、参数、返回值
- 显示 Callers / Callees 列表
- 路径追踪按钮（设为起点/终点）

**内容分区**:
1. 头部：函数名 + 类型标签
2. 基础信息：模块、签名、位置
3. 参数列表
4. 返回值
5. Callers 列表（可点击跳转）
6. Callees 列表（可点击跳转）
7. 路径追踪操作

---

## Phase 4: 增强功能（P1）

### Task 4.1: 全局搜索

**文件**: `code-graph-ui/src/pages/FunctionCallGraph/components/GlobalSearch/index.tsx`

**职责**:
- 搜索框（支持函数名模糊匹配）
- 下拉结果列表
- 点击跳转到函数详情

**实现**:
- 从已加载的 data.modules[].functions 中搜索
- 防抖 300ms
- 最多显示 20 条结果

### Task 4.2: 路径追踪面板

**文件**: `code-graph-ui/src/pages/FunctionCallGraph/components/PathTrace/index.tsx`

**职责**:
- 显示起点/终点函数
- 查找路径按钮
- 显示路径列表
- 选择路径高亮显示

**交互**:
- 从抽屉的"设为起点/终点"按钮设置
- 点击路径在图中高亮
- 清除按钮重置

### Task 4.3: Dagre 布局工具

**文件**: `code-graph-ui/src/pages/FunctionCallGraph/utils/layout.ts`

**职责**:
- 使用 dagre 库计算节点位置
- 从左到右布局方向
- 支持动态添加节点

**实现**:
```typescript
import dagre from 'dagre';

export function computeDagreLayout(
  nodes: FunctionNode[],
  edges: CallChain[]
): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 50, ranksep: 100 });
  // ...
}
```

---

## Phase 5: 数据转换工具（P0）

### Task 5.1: 数据转换工具

**文件**: `code-graph-ui/src/pages/FunctionCallGraph/utils/transform.ts`

**职责**:
- 后端数据 → 前端展示格式
- 构建 callers/callees 索引
- 模块函数映射

**函数**:
```typescript
// 构建 functionId → callers 映射
export function buildCallersIndex(
  callChains: CallChain[]
): Map<string, CallChain[]>

// 构建 functionId → callees 映射
export function buildCalleesIndex(
  callChains: CallChain[]
): Map<string, CallChain[]>

// 构建 functionId → Module 映射
export function buildFunctionModuleIndex(
  modules: Module[]
): Map<string, Module>
```

---

## 文件变更清单

### 后端新增/修改

| 文件 | 操作 | 说明 |
|------|------|------|
| `backend/api/routers/graphs.py` | 修改 | 添加 2 个新端点 |

### 前端新增

| 文件 | 说明 |
|------|------|
| `src/pages/FunctionCallGraph/types.ts` | 类型定义 |
| `src/store/functionCallStore.ts` | Zustand store |
| `src/pages/FunctionCallGraph/index.tsx` | 主页面（重写） |
| `src/pages/FunctionCallGraph/components/ModuleOverview/index.tsx` | 模块总览 |
| `src/pages/FunctionCallGraph/components/ModuleOverview/ModuleNode.tsx` | 模块节点 |
| `src/pages/FunctionCallGraph/components/ModuleDetail/index.tsx` | 模块详情 |
| `src/pages/FunctionCallGraph/components/ModuleDetail/ModuleTree.tsx` | 模块树 |
| `src/pages/FunctionCallGraph/components/ModuleDetail/FunctionList.tsx` | 函数列表 |
| `src/pages/FunctionCallGraph/components/ModuleDetail/FunctionGraph.tsx` | 函数调用图 |
| `src/pages/FunctionCallGraph/components/FunctionDrawer/index.tsx` | 函数详情抽屉 |
| `src/pages/FunctionCallGraph/components/GlobalSearch/index.tsx` | 全局搜索 |
| `src/pages/FunctionCallGraph/components/PathTrace/index.tsx` | 路径追踪 |
| `src/pages/FunctionCallGraph/utils/layout.ts` | Dagre 布局 |
| `src/pages/FunctionCallGraph/utils/transform.ts` | 数据转换 |

### 前端修改

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/api/graphApi.ts` | 修改 | 添加 2 个 API 方法 |
| `src/store/index.ts` | 修改 | 导出新 store（如果存在） |

---

## 依赖检查

### 后端
- 无新增依赖

### 前端
- `dagre` - 布局算法（需检查是否已安装）
- `@types/dagre` - 类型定义

**检查命令**:
```bash
cd code-graph-ui
npm ls dagre
```

**安装命令**:
```bash
npm install dagre @types/dagre
```

---

## 执行顺序

```
Phase 1 (后端)
├── Task 1.1: 函数调用图数据 API
└── Task 1.2: 路径追踪 API

Phase 2 (前端基础)
├── Task 2.1: TypeScript 类型定义
├── Task 2.2: Zustand Store
└── Task 2.3: API 调用方法

Phase 3 (前端组件)
├── Task 3.1: 主页面容器
├── Task 3.2: 模块总览组件
├── Task 3.3: 模块详情组件
└── Task 3.4: 函数详情抽屉

Phase 4 (增强功能)
├── Task 4.1: 全局搜索
├── Task 4.2: 路径追踪面板
└── Task 4.3: Dagre 布局工具

Phase 5 (工具)
└── Task 5.1: 数据转换工具
```

---

## 验证检查点

### Phase 1 完成后
- [ ] `GET /graph/function-call?repo_id=adms` 返回正确数据
- [ ] `GET /graph/function-call/path?from=...&to=...` 返回路径

### Phase 3 完成后
- [ ] 选择仓库后显示模块总览
- [ ] 点击模块进入详情视图
- [ ] 点击函数节点打开详情抽屉
- [ ] Callers/Callees 列表正确显示

### Phase 4 完成后
- [ ] 全局搜索返回正确结果
- [ ] 路径追踪功能正常工作
- [ ] 选择路径后图中正确高亮
