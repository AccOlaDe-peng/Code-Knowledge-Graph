# 数据血缘业务领域视图设计文档

## 1. 概述

### 1.1 背景

当前数据血缘图的模块划分基于文件路径的第一个目录名（如 `adms-api`、`adms-repository`），这是技术分层而非业务领域划分，导致：
- 模块间关系不清晰
- 无法体现业务逻辑
- 难以理解数据在业务层面的流向

### 1.2 目标

实现**混合视图**：支持「技术架构视图」和「业务领域视图」切换，让用户可以从不同维度理解数据血缘关系。

### 1.3 业务领域识别策略

**目录结构优先 + 命名规则补充 + 手动映射配置**

1. 优先从 Java 包路径识别业务模块（如 `service/drs/...`）
2. 补充使用命名规则（如 `Drs*Controller` → `drs` 领域）
3. 支持用户自定义映射配置

---

## 2. 数据模型

### 2.1 业务领域配置

```typescript
// 业务领域配置（持久化存储）
interface DomainConfig {
  repoId: string;            // 仓库 ID
  version: number;           // 配置版本，用于增量更新
  lastModified: string;      // ISO 时间戳
  domains: DomainDefinition[];
}

// 领域定义（用户可编辑）
interface DomainDefinition {
  id: string;                // 唯一标识，如 "domain:drs"
  key: string;               // 目录关键字，如 "drs"
  name: string;              // 显示名称，如 "数据报表服务"
  aliases: string[];         // 别名模式，如 ["drsdata", "drs-report"]
  color: string;             // 显示颜色
  icon?: string;             // 可选图标
  description?: string;      // 可选描述
  tags?: string[];           // 可选标签，如 ["核心业务", "数据分析"]
}
```

### 2.2 自动推断结果

```typescript
interface InferredDomain {
  key: string;               // 目录关键字
  suggestedName: string;     // 推断的中文名
  confidence: number;        // 置信度 0-1
  nodeCount: number;         // 节点数量
  relatedKeys: string[];     // 相关关键字，如 ["drs", "drsdata"]
  sampleNodes: string[];     // 示例节点名，帮助用户确认
}
```

### 2.3 聚合后的业务领域节点

```typescript
interface BusinessDomainNode {
  id: string;                // 如 "domain:drs"
  name: string;              // 如 "数据报表服务"
  key: string;               // 如 "drs"
  color: string;
  nodeCount: number;         // 包含的代码节点数
  services: NodeSummary[];   // Service 摘要
  controllers: NodeSummary[];
  repositories: NodeSummary[];
  inModules: string[];       // 跨哪些技术模块，如 ["adms-api", "adms-repository"]
}

interface NodeSummary {
  id: string;
  name: string;
  module: string;            // 所属技术模块
}

interface DomainEdge {
  from: string;              // 源领域 ID
  to: string;                // 目标领域 ID
  type: "flow_to" | "reads" | "writes";
  callCount: number;
  servicePairs: [string, string][];
}
```

---

## 3. 核心功能流程

### 3.1 视图模式切换

```
用户选择视图模式
       │
       ├──▶ 技术架构视图 ──▶ aggregateToModuleLevel()
       │                        按技术模块聚合
       │
       └──▶ 业务领域视图 ──▶ aggregateToBusinessDomain()
                                按业务领域聚合
```

### 3.2 业务领域聚合算法

```
输入: nodes[], edges[], domainConfig

1. 遍历所有节点
   - 提取节点的业务目录路径（如 service/drs/...）
   - 匹配 domainConfig.domains 中的定义
   - 未匹配的节点尝试自动推断

2. 聚合同一业务领域的节点
   - 统计 Service/Controller/Repository 数量
   - 记录跨技术模块信息

3. 聚合跨领域边
   - 同一领域内节点间的调用 → 忽略
   - 跨领域节点间的调用 → 生成领域间的 flow_to 边

4. 输出: BusinessDomainNode[], DomainEdge[]
```

### 3.3 中文名称推断规则

```typescript
const DOMAIN_NAME_INFERENCE: Record<string, string> = {
  // 缩写展开
  'drs': '数据报表服务',
  'mdm': '主数据管理',
  'frs': '风险扫描',
  'bav': '资产漏洞检测',
  'srs': '安全报告服务',

  // 常见词翻译
  'permission': '权限管理',
  'engine': '引擎服务',
  'dashboard': '仪表盘',
  'dashbord': '仪表盘',
  'email': '邮件服务',
  'report': '报表服务',
  'white': '白名单管理',
  'application': '应用管理',
  'preAnalysis': '预分析服务',
  'config': '配置管理',
  'log': '日志服务',
  'auth': '认证服务',
  'policy': '策略管理',
};

// 未匹配时的默认处理：驼峰转空格 + 首字母大写
// 如 "AssetInspection" → "Asset Inspection"
```

---

## 4. API 设计

### 4.1 后端 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/graph/lineage/domains/config` | 获取业务领域配置 |
| POST | `/graph/lineage/domains/config` | 保存业务领域配置 |
| GET | `/graph/lineage/domains/infer` | 自动推断业务领域 |

### 4.2 响应示例

```json
// GET /graph/lineage/domains/config?repo_id=adms
{
  "repo_id": "adms",
  "version": 3,
  "last_modified": "2024-03-24T10:30:00Z",
  "domains": [
    {
      "id": "domain:drs",
      "key": "drs",
      "name": "数据报表服务",
      "aliases": ["drsdata"],
      "color": "#00d4ff",
      "icon": "chart"
    },
    {
      "id": "domain:mdm",
      "key": "mdm",
      "name": "主数据管理",
      "aliases": [],
      "color": "#00f084"
    }
  ]
}

// GET /graph/lineage/domains/infer?repo_id=adms
{
  "repo_id": "adms",
  "inferred": [
    {
      "key": "drs",
      "suggested_name": "数据报表服务",
      "confidence": 0.95,
      "node_count": 424,
      "related_keys": ["drs", "drsdata"],
      "sample_nodes": ["DrsDataController", "DrsReportService"]
    }
  ]
}
```

---

## 5. 存储设计

### 5.1 配置文件位置

```
code-graph-system/
└── data/
    └── domain_configs/
        └── {repo_id}.json    # 每个仓库一份配置
```

### 5.2 配置文件格式

```json
{
  "repo_id": "adms",
  "version": 3,
  "last_modified": "2024-03-24T10:30:00Z",
  "domains": [
    {
      "id": "domain:drs",
      "key": "drs",
      "name": "数据报表服务",
      "aliases": ["drsdata"],
      "color": "#00d4ff"
    }
  ]
}
```

---

## 6. UI 组件设计

### 6.1 视图模式选择器

位于血缘图工具栏，下拉选择器包含：
- **技术架构** — 按技术模块聚合（默认）
- **业务领域** — 按业务领域聚合
- **管理领域配置** — 打开配置面板

### 6.2 业务领域配置面板

抽屉式面板，包含：
1. **已定义领域列表** — 显示、编辑、删除已有领域定义
2. **自动推断区域** — 显示推断结果，支持确认添加
3. **添加/编辑领域表单** — 编辑领域名称、别名、颜色

### 6.3 业务领域节点样式

- 左侧色条 + 领域图标
- 显示领域名称和关键字
- 统计信息：Service/Controller/Repository 数量
- 跨模块标识：显示跨越的技术模块
- 数据访问：显示访问的数据库
- 外部调用：显示跨领域调用数量

---

## 7. 文件结构

### 7.1 后端新增文件

```
code-graph-system/
└── backend/
    ├── api/routers/
    │   └── domains.py              # 业务领域 API 路由
    ├── services/
    │   └── domain_config_service.py # 领域配置服务
    └── data/
        └── domain_configs/          # 配置存储目录
```

### 7.2 前端新增文件

```
code-graph-ui/
└── src/
    ├── pages/DataLineage/
    │   ├── components/
    │   │   ├── BusinessDomainView.tsx    # 业务领域视图组件
    │   │   ├── BusinessDomainNode.tsx     # 业务领域节点组件
    │   │   ├── ViewModeSelector.tsx       # 视图模式选择器
    │   │   └── DomainConfigPanel.tsx      # 领域配置面板
    │   └── utils/
    │       └── domainAggregation.ts       # 业务领域聚合逻辑
    ├── store/
    │   └── domainConfigStore.ts           # 领域配置状态管理
    └── api/
        └── domainApi.ts                   # 领域配置 API
```

---

## 8. 实现优先级

### Phase 1: 基础能力
1. 后端：领域配置存储和 API
2. 前端：视图模式选择器
3. 前端：业务领域聚合逻辑
4. 前端：业务领域视图组件

### Phase 2: 配置管理
1. 前端：领域配置面板
2. 后端：自动推断 API
3. 前端：推断结果确认流程

### Phase 3: 增强
1. 领域图标支持
2. 领域标签分类
3. 导出配置功能
