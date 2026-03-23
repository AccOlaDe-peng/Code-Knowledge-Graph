# 数据血缘三层视图实现计划

## 概述

本文档是 [数据血缘三层视图设计文档](../specs/2026-03-23-lineage-three-layer-view.md) 的实现计划。

## 前置条件

- [x] 设计文档已完成
- [x] 数据盘点已完成（确认现有数据可支撑实现）
- [ ] 后端 API 服务可正常启动
- [ ] 前端开发服务可正常启动

---

## 任务列表

### 阶段 1：后端模块级 API

#### 任务 1.1：新增模块级血缘 API 端点

**文件**: `code-graph-system/backend/api/routers/graphs.py`

**改动点**:
- 新增 `GET /graph/lineage/modules` 端点
- 实现模块归属推断函数 `_get_module_id()`
- 实现 Class 级边聚合函数 `_aggregate_module_edges()`

**代码位置**: 在现有 `get_lineage` 函数之后添加新端点

**依赖**: 无

---

#### 任务 1.2：扩展现有血缘 API

**文件**: `code-graph-system/backend/api/routers/graphs.py`

**改动点**:
- 在 `get_lineage` 端点新增 `module_id` 参数
- 在 `get_lineage` 端点新增 `view_level` 参数
- 实现按模块过滤节点和边的逻辑

**代码位置**: 修改现有 `get_lineage` 函数

**依赖**: 任务 1.1

---

#### 任务 1.3：添加后端单元测试

**文件**: `code-graph-system/backend/tests/test_lineage_modules_api.py`（新建）

**改动点**:
- 测试模块归属推断逻辑
- 测试 Class → Module 边聚合
- 测试 API 响应格式

**依赖**: 任务 1.1, 任务 1.2

---

### 阶段 2：前端层级 1 - 模块主图

#### 任务 2.1：创建模块聚合工具函数

**文件**: `code-graph-ui/src/pages/DataLineage/utils/moduleAggregation.ts`（新建）

**改动点**:
- 实现 `getModuleId()` 函数：从 Class ID 提取模块归属
- 实现 `aggregateToModuleLevel()` 函数：聚合 Class 级数据为 Module 级
- 实现 `getCrossModuleEdges()` 函数：提取跨模块边

**依赖**: 无

---

#### 任务 2.2：创建 ModuleNode 自定义节点组件

**文件**: `code-graph-ui/src/pages/DataLineage/components/ModuleNode.tsx`（新建）

**改动点**:
- 实现模块分组节点的视觉样式
- 支持展开/折叠内部 Service 列表
- 显示模块统计信息（Service 数量、跨模块依赖数）

**依赖**: 无

---

#### 任务 2.3：创建 ModuleView 主视图组件

**文件**: `code-graph-ui/src/pages/DataLineage/components/ModuleView.tsx`（新建）

**改动点**:
- 加载模块级数据（调用后端 API 或本地聚合）
- 渲染 ReactFlow 图（ModuleNode + 跨模块边）
- 实现点击模块进入层级 2 的交互
- 实现悬停显示统计信息

**依赖**: 任务 2.1, 任务 2.2

---

#### 任务 2.4：实现跨模块边样式

**文件**: `code-graph-ui/src/pages/DataLineage/components/CrossModuleEdge.tsx`（新建）

**改动点**:
- 实现虚线 + 动画的边样式
- 支持点击边高亮涉及的 Service 调用

**依赖**: 无

---

### 阶段 3：前端层级 2 - 模块内视图

#### 任务 3.1：创建 ServiceView 组件

**文件**: `code-graph-ui/src/pages/DataLineage/components/ServiceView.tsx`（新建）

**改动点**:
- 复用现有血缘图渲染逻辑
- 过滤显示当前模块内的节点和边
- 调用 `GET /graph/lineage?module_id=xxx` 获取数据

**依赖**: 任务 1.2

---

#### 任务 3.2：创建跨模块依赖面板

**文件**: `code-graph-ui/src/pages/DataLineage/components/CrossModulePanel.tsx`（新建）

**改动点**:
- 显示当前模块的跨模块调用列表
- 支持点击跳转到目标 Service
- 区分入向依赖和出向依赖

**依赖**: 任务 3.1

---

#### 任务 3.3：实现双击返回交互

**文件**: `code-graph-ui/src/pages/DataLineage/components/ServiceView.tsx`

**改动点**:
- 监听双击事件，触发返回层级 1 的操作
- 清除当前选中的模块 ID

**依赖**: 任务 3.1

---

### 阶段 4：前端层级 3 - 详细血缘

#### 任务 4.1：创建 DetailView 组件

**文件**: `code-graph-ui/src/pages/DataLineage/components/DetailView.tsx`（新建）

**改动点**:
- 调用现有 `GET /graph/lineage?node_id=xxx` 获取子图
- 渲染 Function 级调用链
- 标注跨模块调用（特殊样式）

**依赖**: 无（可复用现有逻辑）

---

#### 任务 4.2：优化 Function 级节点显示

**文件**: `code-graph-ui/src/pages/DataLineage/components/DetailView.tsx`

**改动点**:
- 显示方法签名（简化版）
- 显示文件路径和行号
- 区分 Controller/Service/Repository 方法

**依赖**: 任务 4.1

---

### 阶段 5：集成与状态管理

#### 任务 5.1：创建血缘状态管理 Store

**文件**: `code-graph-ui/src/store/lineageStore.ts`（新建）

**改动点**:
- 定义 `LineageState` 接口
- 实现 `level`、`selectedModuleId`、`selectedServiceId` 状态
- 实现导航 actions：`navigateToModule`、`navigateToService`、`navigateBack`

**依赖**: 无

---

#### 任务 5.2：重构 DataLineage 主页面

**文件**: `code-graph-ui/src/pages/DataLineage/index.tsx`

**改动点**:
- 引入三层视图组件
- 根据当前 `level` 渲染对应视图
- 移除或重构现有血缘图逻辑

**依赖**: 任务 2.3, 任务 3.1, 任务 4.1, 任务 5.1

---

#### 任务 5.3：添加 API 端点调用

**文件**: `code-graph-ui/src/api/graphApi.ts`

**改动点**:
- 新增 `getLineageModules()` 方法
- 扩展 `getLineageView()` 方法支持新参数

**依赖**: 任务 1.1, 任务 1.2

---

### 阶段 6：测试与优化

#### 任务 6.1：端到端测试

**测试场景**:
1. 打开血缘图页面，显示模块主图
2. 点击一个模块，进入模块内视图
3. 点击一个 Service，进入详细血缘
4. 双击空白处，返回上一层
5. 点击跨模块依赖，跳转到目标

**依赖**: 所有前置任务

---

#### 任务 6.2：性能优化

**优化点**:
- 大型图谱的渲染性能
- 模块主图的布局算法
- 数据缓存策略

**依赖**: 任务 6.1

---

## 实现顺序

```
阶段 1 (后端 API)
    │
    ├─ 任务 1.1: 新增模块级 API
    │
    ├─ 任务 1.2: 扩展现有 API
    │
    └─ 任务 1.3: 后端测试
         │
         ▼
阶段 2 (前端模块主图)
    │
    ├─ 任务 2.1: 聚合工具函数 ◄─────────┐
    │                                   │
    ├─ 任务 2.2: ModuleNode 组件        │ 可并行
    │                                   │
    ├─ 任务 2.3: ModuleView 组件        │
    │                                   │
    └─ 任务 2.4: 跨模块边样式 ◄─────────┘
         │
         ▼
阶段 3 (前端模块内视图)
    │
    ├─ 任务 3.1: ServiceView 组件
    │
    ├─ 任务 3.2: 跨模块依赖面板
    │
    └─ 任务 3.3: 双击返回交互
         │
         ▼
阶段 4 (前端详细血缘)
    │
    ├─ 任务 4.1: DetailView 组件
    │
    └─ 任务 4.2: Function 级节点优化
         │
         ▼
阶段 5 (集成)
    │
    ├─ 任务 5.1: 状态管理 Store
    │
    ├─ 任务 5.2: 主页面重构
    │
    └─ 任务 5.3: API 调用
         │
         ▼
阶段 6 (测试)
    │
    ├─ 任务 6.1: 端到端测试
    │
    └─ 任务 6.2: 性能优化
```

---

## 验收清单

### 功能验收

- [ ] 层级 1：模块主图正确显示所有模块
- [ ] 层级 1：跨模块边用虚线清晰标注
- [ ] 层级 1：点击模块可进入层级 2
- [ ] 层级 2：显示当前模块内的 Controller/Service/Repository
- [ ] 层级 2：跨模块调用在右侧面板展示
- [ ] 层级 2：双击可返回层级 1
- [ ] 层级 3：显示 Function 级完整调用链
- [ ] 层级 3：跨模块调用有明确标注

### 性能验收

- [ ] 模块主图加载 < 1 秒
- [ ] 模块内视图加载 < 2 秒
- [ ] 详细血缘加载 < 1 秒

### 代码质量

- [ ] 后端新增 API 有单元测试
- [ ] 前端组件有 TypeScript 类型定义
- [ ] 无 console 错误或警告

---

## 风险与缓解

| 风险 | 影响 | 缓解措施 |
|-----|------|---------|
| 大型图谱渲染性能 | 高 | 使用虚拟化渲染、LOD 策略 |
| 模块归属推断不准确 | 中 | 提供手动调整机制（P2） |
| 跨模块调用遗漏 | 低 | 补充更多推断规则 |

---

## 时间估算

| 阶段 | 预估时间 |
|-----|---------|
| 阶段 1: 后端 API | 2-3 小时 |
| 阶段 2: 前端模块主图 | 3-4 小时 |
| 阶段 3: 前端模块内视图 | 2-3 小时 |
| 阶段 4: 前端详细血缘 | 1-2 小时 |
| 阶段 5: 集成 | 2-3 小时 |
| 阶段 6: 测试优化 | 1-2 小时 |
| **总计** | **11-17 小时** |
