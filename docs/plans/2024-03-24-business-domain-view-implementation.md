# 数据血缘业务领域视图实现计划

## 概述

基于设计文档 `docs/specs/2024-03-24-business-domain-view-design.md`，实现数据血缘的业务领域视图功能。

---

## Phase 1: 后端基础能力

### 1.1 领域配置存储服务

**文件**: `backend/services/domain_config_service.py`

**任务**:
- [ ] 创建 `DomainConfigService` 类
- [ ] 实现 `load_config(repo_id)` 加载配置
- [ ] 实现 `save_config(repo_id, config)` 保存配置
- [ ] 实现 `get_default_config()` 返回默认配置
- [ ] 创建 `data/domain_configs/` 目录

### 1.2 业务领域 API 路由

**文件**: `backend/api/routers/domains.py`

**任务**:
- [ ] 创建 `/graph/lineage/domains/config` GET 端点
- [ ] 创建 `/graph/lineage/domains/config` POST 端点
- [ ] 创建 `/graph/lineage/domains/infer` GET 端点（自动推断）
- [ ] 在 `server.py` 中注册路由

### 1.3 自动推断逻辑

**文件**: `backend/services/domain_inference_service.py`

**任务**:
- [ ] 实现 `_extract_business_key(node_id)` 从节点 ID 提取业务关键字
- [ ] 实现 `_infer_domain_name(key)` 推断业务领域名称
- [ ] 实现 `infer_domains(nodes)` 返回推断结果列表

---

## Phase 2: 前端视图切换

### 2.1 视图模式状态管理

**文件**: `src/store/lineageStore.ts` (修改)

**任务**:
- [ ] 添加 `viewMode: 'tech' | 'business'` 状态
- [ ] 添加 `setViewMode(mode)` action
- [ ] 添加 `domainConfig` 状态
- [ ] 添加 `loadDomainConfig()` action

### 2.2 视图模式选择器组件

**文件**: `src/pages/DataLineage/components/ViewModeSelector.tsx`

**任务**:
- [ ] 创建下拉选择器组件
- [ ] 选项：技术架构、业务领域
- [ ] 集成到主页面工具栏

### 2.3 主页面集成

**文件**: `src/pages/DataLineage/index.tsx` (修改)

**任务**:
- [ ] 添加 ViewModeSelector 到工具栏
- [ ] 根据 viewMode 条件渲染 ModuleView 或 BusinessDomainView

---

## Phase 3: 前端业务领域聚合

### 3.1 聚合工具函数

**文件**: `src/pages/DataLineage/utils/domainAggregation.ts`

**任务**:
- [ ] 实现 `extractBusinessKey(nodeId)` 提取业务关键字
- [ ] 实现 `matchDomain(nodeId, domains)` 匹配领域配置
- [ ] 实现 `aggregateToBusinessDomain(nodes, edges, config)` 聚合逻辑
- [ ] 实现 `inferDomainName(key)` 前端推断备用

### 3.2 业务领域视图组件

**文件**: `src/pages/DataLineage/components/BusinessDomainView.tsx`

**任务**:
- [ ] 创建视图组件，类似 ModuleView 结构
- [ ] 使用 domainAggregation 聚合数据
- [ ] 渲染 BusinessDomainNode 节点
- [ ] 处理节点点击展开领域内节点

### 3.3 业务领域节点组件

**文件**: `src/pages/DataLineage/components/BusinessDomainNode.tsx`

**任务**:
- [ ] 创建节点组件，显示领域信息
- [ ] 显示跨模块标识
- [ ] 显示统计信息

---

## Phase 4: 前端配置管理

### 4.1 领域配置 API

**文件**: `src/api/domainApi.ts`

**任务**:
- [ ] 实现 `getDomainConfig(repoId)`
- [ ] 实现 `saveDomainConfig(repoId, config)`
- [ ] 实现 `inferDomains(repoId)`

### 4.2 领域配置状态管理

**文件**: `src/store/domainConfigStore.ts`

**任务**:
- [ ] 创建专用 store 管理领域配置
- [ ] 管理 `config`, `inferredDomains`, `loading`, `error` 状态
- [ ] 实现 `loadConfig`, `saveConfig`, `loadInferred` actions

### 4.3 领域配置面板

**文件**: `src/pages/DataLineage/components/DomainConfigPanel.tsx`

**任务**:
- [ ] 创建抽屉式配置面板
- [ ] 显示已定义领域列表
- [ ] 支持添加/编辑/删除领域
- [ ] 显示推断结果并支持确认添加

---

## Phase 5: 测试与优化

### 5.1 后端测试

**文件**: `backend/tests/test_domain_config_api.py`

**任务**:
- [ ] 测试配置加载/保存 API
- [ ] 测试自动推断逻辑
- [ ] 测试边界情况

### 5.2 前端测试

**任务**:
- [ ] 测试视图切换流程
- [ ] 测试业务领域聚合正确性
- [ ] 测试配置面板交互

### 5.3 端到端验证

**任务**:
- [ ] 验证 adms 仓库的业务领域划分
- [ ] 验证跨模块调用正确聚合
- [ ] 验证配置持久化

---

## 依赖关系

```
Phase 1 (后端) ─────┬──▶ Phase 2 (前端视图切换)
                    │
                    └──▶ Phase 3 (前端聚合)
                              │
                              ▼
                         Phase 4 (配置管理)
                              │
                              ▼
                         Phase 5 (测试)
```

---

## 预估工作量

| Phase | 任务数 | 预估时间 |
|-------|--------|----------|
| Phase 1 | 10 | 2h |
| Phase 2 | 8 | 1.5h |
| Phase 3 | 10 | 2h |
| Phase 4 | 10 | 2h |
| Phase 5 | 8 | 1.5h |
| **总计** | **46** | **9h** |
