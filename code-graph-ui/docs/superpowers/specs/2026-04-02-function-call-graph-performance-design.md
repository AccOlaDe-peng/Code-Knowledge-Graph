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
}
```

---

## 三、实现步骤

### Phase 1: 后端 API
1. 在 `graphs.py` 添加 `/graph/function-call/overview` 接口
2. 添加 `/graph/function-call/module/{module_id}` 接口

### Phase 2: 前端 Store 重构
1. 重构 `functionCallStore.ts` 状态结构
2. 实现 `loadOverview` 和 `loadModuleDetail` actions

### Phase 3: 前端组件适配
1. 更新 `FunctionCallGraph` 主页面
2. 更新 `ModuleOverview` 和 `ModuleDetail` 组件
