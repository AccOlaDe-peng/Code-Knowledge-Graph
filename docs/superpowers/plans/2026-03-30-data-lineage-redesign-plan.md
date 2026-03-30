# 数据血缘页面重构实现计划

## 概述

重构 DataLineage 页面，使用 `data-lineage.json` 作为数据源，实现模块依赖图 + 详情面板的交互模式。

## 前置条件

- 设计文档：`docs/superpowers/specs/2026-03-30-data-lineage-redesign-design.md`
- 数据文件：`code-graph-system/data/graphs/data-lineage.json`（已存在）

---

## Phase 1: 后端 API

### Task 1.1: 创建数据血缘 API 路由

**文件**: `code-graph-system/backend/api/routers/data_lineage.py`

**内容**:
- 创建 `router = APIRouter(prefix="/data-lineage", tags=["数据血缘"])`
- 实现 `GET /data-lineage` 端点
- 读取 `data/graphs/data-lineage.json` 文件
- 返回 JSON 内容，文件不存在时返回 404

**依赖**: 无

### Task 1.2: 注册路由到主服务器

**文件**: `code-graph-system/backend/api/server.py`

**修改**:
- 添加 `from backend.api.routers import data_lineage as data_lineage_router`
- 添加 `app.include_router(data_lineage_router.router)`

**依赖**: Task 1.1

### Task 1.3: 前端 API 客户端

**文件**: `code-graph-ui/src/api/dataLineageApi.ts`

**内容**:
- 创建 `getDataLineage()` 函数
- 调用 `GET /data-lineage`
- 返回 `DataLineageJSON` 类型

**依赖**: Task 1.2

---

## Phase 2: 前端类型定义

### Task 2.1: 创建数据血缘类型文件

**文件**: `code-graph-ui/src/pages/DataLineage/types/dataLineage.ts`

**内容**:
- 定义 `DataLineageJSON` 接口
- 定义 `Module` 接口
- 定义 `Entity` 接口
- 定义 `BusinessFlow` 接口
- 定义 `FlowStep` 接口
- 定义 `SubFunction` 接口
- 定义 `DataFlowNode` 接口
- 定义 `DataFlowEdge` 接口
- 定义 `ModuleDependency` 接口
- 定义 `FlowComponent` 和 `FlowType` 接口

**依赖**: 无

---

## Phase 3: 前端组件实现

### Task 3.1: 模块图组件 - ModuleGraph

**文件**: `code-graph-ui/src/pages/DataLineage/components/ModuleGraph/index.tsx`

**内容**:
- 使用 ReactFlow 渲染模块依赖图
- 节点数据来自 `modules` 数组
- 边数据来自 `moduleDependencies.dependencies`
- 支持节点点击事件 `onModuleClick`
- 应用 dagre 布局
- 边样式按依赖类型区分

**依赖**: Task 2.1

### Task 3.2: 模块节点组件 - ModuleNode

**文件**: `code-graph-ui/src/pages/DataLineage/components/ModuleGraph/ModuleNode.tsx`

**内容**:
- 自定义 ReactFlow 节点
- 显示模块名称、描述
- 使用模块 color 字段设置节点颜色
- 支持选中状态高亮

**依赖**: Task 3.1

### Task 3.3: 模块详情面板 - ModuleDetailPanel

**文件**: `code-graph-ui/src/pages/DataLineage/components/ModuleDetailPanel/index.tsx`

**内容**:
- 可折叠面板组件
- 顶部显示模块名称和描述
- 三个 Tab：实体、业务流程、功能
- 支持 `collapsed` 状态管理

**依赖**: Task 2.1

### Task 3.4: 实体 Tab 组件 - EntityTab

**文件**: `code-graph-ui/src/pages/DataLineage/components/ModuleDetailPanel/EntityTab.tsx`

**内容**:
- 列表展示所有实体
- 每个实体显示：名称、表名、描述
- 字段列表可折叠展开
- 显示来源文件路径

**依赖**: Task 3.3

### Task 3.5: 业务流程 Tab 组件 - BusinessFlowTab

**文件**: `code-graph-ui/src/pages/DataLineage/components/ModuleDetailPanel/BusinessFlowTab.tsx`

**内容**:
- 列表展示所有业务流程
- 每个流程显示：名称、描述、触发条件
- 步骤时间线组件
- 显示输入/输出数据
- 显示关联服务

**依赖**: Task 3.3

### Task 3.6: 流程步骤时间线组件 - FlowStepTimeline

**文件**: `code-graph-ui/src/pages/DataLineage/components/FlowStepTimeline.tsx`

**内容**:
- 垂直时间线布局
- 每个步骤显示：步骤号、名称、描述
- 显示输入/输出
- 支持折叠展开

**依赖**: Task 3.5

### Task 3.7: 功能 Tab 组件 - FunctionTab

**文件**: `code-graph-ui/src/pages/DataLineage/components/ModuleDetailPanel/FunctionTab.tsx`

**内容**:
- 列表展示所有功能
- 每个功能显示：名称、API 端点、描述
- 显示输入来源、输出目标
- 显示关联实体、服务、DAO

**依赖**: Task 3.3

---

## Phase 4: 主页面重构

### Task 4.1: 重构 DataLineage 主页面

**文件**: `code-graph-ui/src/pages/DataLineage/index.tsx`

**修改**:
- 移除旧的仓库选择器和状态管理
- 加载数据血缘数据（调用 `getDataLineage()`）
- 布局：上部 ModuleGraph + 下部 ModuleDetailPanel
- 管理选中模块状态
- 错误处理和加载状态

**依赖**: Task 3.1, Task 3.3

---

## Phase 5: 清理旧代码

### Task 5.1: 删除不再使用的组件

**文件**（删除）:
- `code-graph-ui/src/pages/DataLineage/components/ModuleView.tsx`
- `code-graph-ui/src/pages/DataLineage/components/ServiceView.tsx`
- `code-graph-ui/src/pages/DataLineage/components/DetailView.tsx`
- `code-graph-ui/src/pages/DataLineage/components/BusinessDomainView.tsx`
- `code-graph-ui/src/pages/DataLineage/components/BusinessDomainNode.tsx`
- `code-graph-ui/src/pages/DataLineage/components/DomainDetailView.tsx`
- `code-graph-ui/src/pages/DataLineage/components/DomainInfoPanel.tsx`
- `code-graph-ui/src/pages/DataLineage/components/DomainInfoDrawer.tsx`
- `code-graph-ui/src/pages/DataLineage/components/NodeInfoDrawer.tsx`
- `code-graph-ui/src/pages/DataLineage/components/DomainConfigPanel.tsx`
- `code-graph-ui/src/pages/DataLineage/components/ViewModeSelector.tsx`
- `code-graph-ui/src/pages/DataLineage/components/CrossModulePanel.tsx`
- `code-graph-ui/src/pages/DataLineage/utils/domainAggregation.ts`
- `code-graph-ui/src/pages/DataLineage/components/ModuleNode.tsx`

**依赖**: Task 4.1

### Task 5.2: 清理不再使用的 Store 和 API

**文件**:
- `code-graph-ui/src/store/lineageStore.ts` - 移除不再使用的状态
- `code-graph-ui/src/api/domainApi.ts` - 可保留或移除
- `code-graph-ui/src/api/graphApi.ts` - 清理 `getLineageView`、`getLineageModules` 等不再使用的函数

**依赖**: Task 5.1

---

## 验收清单

- [ ] 后端 API 正确返回 `data-lineage.json` 内容
- [ ] 前端首屏正确展示模块依赖图
- [ ] 模块节点使用正确的颜色
- [ ] 边按依赖类型显示不同样式
- [ ] 点击模块节点显示详情面板
- [ ] 实体 Tab 正确显示实体列表和字段
- [ ] 业务流程 Tab 正确显示流程和步骤时间线
- [ ] 功能 Tab 正确显示功能和 API 端点
- [ ] 面板可折叠
- [ ] 错误状态和加载状态正确显示
- [ ] 旧组件已清理

---

## 执行顺序

```
Phase 1 (后端)
  1.1 → 1.2 → 1.3

Phase 2 (类型)
  2.1

Phase 3 (组件)
  3.1 → 3.2
  3.3 → 3.4, 3.5 → 3.6, 3.7 (可并行)

Phase 4 (主页面)
  4.1

Phase 5 (清理)
  5.1 → 5.2
```
