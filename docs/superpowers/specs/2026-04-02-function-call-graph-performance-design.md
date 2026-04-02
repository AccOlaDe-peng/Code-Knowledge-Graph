# 函数调用图性能优化设计

## 问题背景

当前 `/graph/function-call` API 一次性返回所有数据，包括完整的模块函数列表和所有调用链。大数据量时导致：
- 响应体过大，浏览器 DevTools 无法缓存
- 前端一次性处理大量数据导致界面卡顿

## 解决方案：两阶段加载

### 设计原则

1. **按需加载** - 用户先看模块总览，点击后才加载详情
2. **数据切割清晰** - 概览数据极轻量，详情数据按模块请求
3. **缓存友好** - 概览数据长期缓存，详情数据按模块缓存

---

## 一、后端 API 设计

### 1.1 新增概览接口

```
GET /graph/function-call/overview?repo_id={repo_id}
```

**响应结构：**
```python
class FunctionCallOverviewResponse(BaseModel):
    repo_id: str
    project_name: str
    total_modules: int
    total_functions: int
    total_call_chains: int
    modules: list[ModuleSummary]  # 不含 functions 数组
    module_calls: list[ModuleCall]

class ModuleSummary(BaseModel):
    id: str
    name: str
    display_name: str
    description: str
    path: str
    function_count: int
    call_chain_count: int
```

### 1.2 新增模块详情接口

```
GET /graph/function-call/module/{module_id}?repo_id={repo_id}
```

**响应结构：**
```python
class ModuleDetailResponse(BaseModel):
    module: Module  # 含完整 functions
    call_chains: list[CallChain]  # 仅该模块相关的调用链
```

**调用链过滤规则：**
- `sourceModuleId == module_id` 或 `targetModuleId == module_id`

### 1.3 兼容性

保留原 `GET /graph/function-call` 接口不变，供小规模数据或外部集成使用。

---

## 二、前端 Store 重构

### 2.1 状态结构

```typescript
interface FunctionCallStore {
  // === 概览数据 ===
  overview: OverviewData | null;
  overviewLoading: boolean;
  overviewError: string | null;

  // === 模块详情 ===
  moduleDetails: Map<string, ModuleDetailData>;  // 已加载的模块缓存
  currentModuleId: string | null;
  moduleLoading: boolean;
  moduleError: string | null;

  // === 选中状态 ===
  selectedFunctionId: string | null;
  currentView: ViewLevel;

  // === 路径追踪 ===
  pathFrom: string | null;
  pathTo: string | null;
  tracedPaths: TracedPath[] | null;
  selectedPathIndex: number | null;
  tracingPath: boolean;

  // === 索引（仅当前模块） ===
  callersIndex: Map<string, CallChain[]> | null;
  calleesIndex: Map<string, CallChain[]> | null;
  funcInfoIndex: Map<string, FunctionInfo> | null;

  // === Actions ===
  loadOverview(repoId: string): Promise<void>;
  loadModuleDetail(moduleId: string): Promise<void>;
  setSelectedModule(moduleId: string | null): void;
  setSelectedFunction(funcId: string | null): void;
  clearData(): void;

  // === 路径追踪 Actions ===
  setPathFrom(funcId: string | null): void;
  setPathTo(funcId: string | null): void;
  tracePath(repoId: string): Promise<void>;
  clearPathTrace(): void;
}
```

### 2.2 数据加载流程

```
用户选择仓库
    │
    ▼
loadOverview(repoId)
    │
    ├── 概览加载成功 → 显示 ModuleOverview
    │
    └── 概览加载失败 → 显示错误
            │
            ▼
    用户点击模块节点
            │
            ▼
    setSelectedModule(moduleId)
    setCurrentView("detail")
            │
            ▼
    loadModuleDetail(moduleId)
            │
            ├── 检查缓存 → 命中则直接使用
            │
            └── 未命中 → 请求 API → 缓存结果 → 构建索引 → 显示
```

---

## 三、前端组件调整

### 3.1 FunctionCallGraph（主页面）

```typescript
// 加载概览数据
useEffect(() => {
  if (activeRepo?.repoId) {
    loadOverview(activeRepo.repoId);
  } else {
    clearData();
  }
}, [activeRepo?.repoId]);
```

### 3.2 ModuleOverview

- 从 Store 读取 `overview` 数据
- 点击模块时：
  1. 调用 `setSelectedModule(moduleId)`
  2. 调用 `setCurrentView("detail")`
  3. 调用 `loadModuleDetail(moduleId)`

### 3.3 ModuleDetail

- 从 Store 读取 `currentModuleId` 和 `moduleDetails.get(currentModuleId)`
- 如果数据未加载，显示加载中状态
- 函数列表超过 100 条时启用虚拟滚动

---

## 四、性能优化措施

| 优化项 | 触发条件 | 实现方式 |
|--------|----------|----------|
| 虚拟滚动 | 函数列表 > 100 | `@tanstack/react-virtual` |
| 分批渲染 | 调用图节点 > 50 | ReactFlow 分批添加节点 |
| 索引构建 | 模块详情加载后 | `requestIdleCallback` |
| 模块缓存 | 模块详情加载后 | Store `moduleDetails` Map |

---

## 五、实现步骤

### Phase 1: 后端 API（约 1 小时）
1. 在 `graphs.py` 添加 `/graph/function-call/overview` 接口
2. 添加 `/graph/function-call/module/{module_id}` 接口
3. 添加对应的 Pydantic 模型

### Phase 2: 前端 Store 重构（约 1 小时）
1. 重构 `functionCallStore.ts` 状态结构
2. 实现 `loadOverview` 和 `loadModuleDetail` actions
3. 添加 API 调用方法

### Phase 3: 前端组件适配（约 1 小时）
1. 更新 `FunctionCallGraph` 主页面
2. 更新 `ModuleOverview` 组件
3. 更新 `ModuleDetail` 组件

### Phase 4: 性能优化（约 30 分钟）
1. 添加虚拟滚动支持
2. 优化索引构建时机

---

## 六、类型定义更新

### 新增类型

```typescript
// types.ts

// 模块概览（不含函数列表）
export interface ModuleSummary {
  id: string;
  name: string;
  displayName: string;
  description: string;
  path: string;
  functionCount: number;
  callChainCount: number;
}

// 概览响应
export interface FunctionCallOverviewResponse {
  repo_id: string;
  project_name: string;
  total_modules: number;
  total_functions: number;
  total_call_chains: number;
  modules: ModuleSummary[];
  module_calls: ModuleCall[];
}

// 模块详情响应
export interface ModuleDetailResponse {
  module: Module;
  call_chains: CallChain[];
}
```

---

## 七、风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| API 兼容性 | 旧前端调用失败 | 保留原接口，新增接口 |
| 缓存一致性 | 切换仓库时数据残留 | `clearData()` 清理所有状态 |
| 模块切换延迟 | 用户等待 | 模块详情缓存 + 加载状态提示 |
