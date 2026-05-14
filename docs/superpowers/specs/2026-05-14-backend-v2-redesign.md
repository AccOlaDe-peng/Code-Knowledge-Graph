# 后端 V2 重构设计

## 概述

重写 `code-graph-ts/` 后端，替换技术栈（Bun → Node.js, Fastify → Hono），简化架构（Agent 流水线 → Route-Service-Store 三层），MVP 阶段聚焦骨架 + API 契约匹配。

## 技术栈

| 项目 | 选型 |
|------|------|
| 运行时 | Node.js 22+ (ESM) |
| Web 框架 | Hono v4 |
| 包管理 | pnpm |
| 开发工具 | tsx (watch) |
| 构建 | tsup |
| 测试 | Vitest |
| 图引擎 | Graphology (内存) |
| 持久化 | JSON 文件 (`~/.code-graph/`) |
| 日志 | console / pino |

**TypeScript 约束：** 严格模式，`erasableSyntaxOnly: true`，禁用 enum，使用 `const` 对象 + `as const`。

## 架构

三层结构：Route → Service → Store

```
code-graph-ts/
├── src/
│   ├── index.ts                  # 启动入口
│   ├── app.ts                    # Hono app + 全局中间件(CORS, logger, error)
│   ├── routes/
│   │   ├── index.ts              # 路由注册汇总
│   │   ├── health.ts             # /health
│   │   ├── repos.ts              # /repos/*
│   │   ├── analyze.ts            # /analyze/*
│   │   ├── graph.ts              # /graph/*
│   │   └── lineage.ts            # /lineage/*
│   ├── services/
│   │   ├── repo.service.ts       # 仓库 CRUD
│   │   ├── analysis.service.ts   # 分析任务管理
│   │   └── graph.service.ts      # 图数据查询
│   ├── stores/
│   │   ├── repo-store.ts         # JSON 文件持久化 (~/.code-graph/repos/)
│   │   ├── graph-store.ts        # Graphology 内存图 + JSON 持久化
│   │   └── analysis-store.ts     # 内存 Map (任务状态)
│   ├── types/
│   │   ├── graph.ts              # GraphNode, GraphEdge, NodeTypes, EdgeTypes
│   │   ├── repo.ts               # RepoInfo, AnalysisStatus
│   │   └── api.ts                # 请求/响应类型
│   └── utils/
│       ├── logger.ts
│       └── sse.ts                # SSE 广播工具
├── tests/
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── .gitignore
```

**层职责：**
- **Route：** 参数校验、调用 Service、格式化响应（含 snake_case 转换）
- **Service：** 纯业务逻辑，不依赖 Hono context
- **Store：** 数据存取，可替换实现

## API 路由

### 仓库管理

| Method | Path | 功能 |
|--------|------|------|
| GET | `/repos` | 列出所有仓库（含分析状态） |
| POST | `/repos` | 注册仓库 |
| POST | `/repos/save` | 创建/更新仓库 |
| DELETE | `/repos/:id` | 删除仓库 |
| GET | `/repos/:id/analyses` | 获取仓库分析历史 |

### 分析任务

| Method | Path | 功能 |
|--------|------|------|
| POST | `/analyze/repository` | 提交分析（返回 task_id，MVP 返回 mock 状态） |
| GET | `/analyze/status/:taskId` | 查询分析状态 |
| GET | `/analyze/stream/:taskId` | SSE 推送进度 |
| POST | `/analyze/cancel/:taskId` | 取消分析 |
| GET | `/api/pipeline/stages` | 流水线阶段定义 |

### 图数据

| Method | Path | 功能 |
|--------|------|------|
| GET | `/graph/framework` | 架构视图（按 node_types 筛选） |
| GET | `/graph/lineage` | 数据血缘视图 |
| GET | `/graph/lineage/modules` | 模块级血缘 |
| GET | `/graph/function-call` | 函数调用图 |
| GET | `/graph/architecture/:repoId` | 架构图 |
| GET | `/services` | 服务节点 |
| GET | `/events` | 事件流 |

### 血缘与影响分析

| Method | Path | 功能 |
|--------|------|------|
| POST | `/lineage/impact` | 影响分析 |
| POST | `/lineage/trace` | 血缘追踪 |

### 基础设施

| Method | Path | 功能 |
|--------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/meta/node-types` | 节点/边类型元数据 |
| GET | `/api/fs/*` | 服务端文件浏览 |

## 数据模型

### NodeTypes（37 种，const 对象）

Repository, Module, File, Class, Function, Component, Service, API, APIEndpoint, Database, Table, DataObject, DataSource, DataSink, Event, Topic, EventHandler, MessageQueue, Pipeline, Flow, BusinessFlow, Layer, Domain, BoundedContext, DomainEntity, ExternalAPI, Cluster, Infrastructure, Entity, Field, FlowNode, Interface, Method, Controller, Config, Endpoint, Community

### EdgeTypes（30+ 种，const 对象）

contains, imports, defines, calls, depends_on, implements, reads, writes, produces, consumes, publishes, subscribes, deployed_on, uses, routes_to, triggers, belongs_to, flow_step, transforms, part_of, async_calls, handles, queries, flow_to, references, shares_data_with, conceptually_related_to, belongs_to_community, extends, overrides

### GraphNode

```typescript
interface GraphNode {
  id: string;
  label: string;
  type: string;
  file?: string;
  location?: { startLine: number; endLine?: number };
  confidence?: number;
  metadata?: Record<string, unknown>;
}
```

### GraphEdge

```typescript
interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  confidence?: number;
  weight?: number;
  file?: string;
  location?: { startLine: number; endLine?: number };
  metadata?: Record<string, unknown>;
}
```

### 响应 Wire Format（匹配前端契约）

API 响应时做字段映射（在路由层）：
- 节点：`label` → `name`，`metadata` → `properties`
- 边：`source` → `from`，`target` → `to`

## 存储层

| Store | 存储 | 持久化 | 说明 |
|-------|------|--------|------|
| `RepoStore` | 仓库注册表 | `~/.code-graph/repos/repos.json` | CRUD + 查询 |
| `GraphStore` | Graphology 图实例 | `~/.code-graph/graphs/<repo_id>.json` | 内存图 + 读写文件 |
| `AnalysisStore` | 分析任务状态 | 内存 Map | 任务生命周期管理 |

## SSE 推送

前端通过 `GET /analyze/stream/:taskId` 接收分析进度，事件格式：

```
event: progress
data: {"status":"running","step":2,"total":5,"stage":"static_analysis","message":"解析 AST...","elapsed_seconds":12}

event: done
data: {"status":"completed","graph_id":"xxx","node_count":120,"edge_count":340}
```

`utils/sse.ts` 封装 SSE 广播器，`AnalysisStore` 持有 `EventEmitter`，状态变更时触发推送。

## 错误处理

Hono 全局 `onError` 处理器，统一错误响应格式：

```typescript
{ error: string; message: string; status: number }
```

## MVP 实现策略

1. 仓库管理、健康检查、元数据 — **完整实现**
2. 分析任务 — **提交返回 mock 状态，SSE 框架就绪**
3. 图数据路由 — **返回空图或 mock 数据**
4. 分析流程 — **后续迭代实现**

## 开发命令

```bash
pnpm dev      # tsx watch 热重载
pnpm build    # tsup 构建
pnpm test     # Vitest
pnpm start    # 运行构建产物
```

默认端口 8848，与前端 Vite 代理配置一致。
