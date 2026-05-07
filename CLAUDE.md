# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

AI 代码知识图谱系统，基于 TypeScript Agent 架构，能够解析多语言代码仓库并生成结构化的知识图谱。

**项目结构：**

```
code-knowledge-graph/
├── code-graph-ts/    # TypeScript Agent 后端（API + 图谱分析流水线）
├── code-graph-ui/    # React 前端
└── docs/             # 文档
```

---

## 后端（code-graph-ts）

### 技术栈

Bun + Fastify + Graphology + Web-tree-sitter + Claude SDK

### 开发环境

所有后端命令在 `code-graph-ts/` 目录下执行：

```bash
cd code-graph-ts
bun install
```

### 常用命令

```bash
cd code-graph-ts

# 启动 API 服务器
bun start                     # 默认 http://localhost:8848
bun dev                       # 热重载开发模式（--hot）
PORT=9000 bun start           # 自定义端口

# 分析代码仓库（CLI）
bun run analyze /path/to/repo
bun run analyze /path/to/repo --enable-lineage --budget 100000

# 运行测试
bun test                      # 全量测试
bun test tests/<file>.ts      # 单个测试文件

# MCP Server（提供 4 个工具：analyze_codebase, trace_lineage, get_lineage_graph, query_graph）
bun run mcp
```

**测试文件：** `api.test.ts`, `core.test.ts`, `e2e.test.ts`, `lineage.test.ts`, `mcp.test.ts`, `phase2.test.ts`

### Agent 架构

`Coordinator` 协调 6 个专业 Agent，所有 Agent 继承 `BaseAgent`（`src/agents/BaseAgent.ts`）：

```
Coordinator（指挥官）
  ├── ScannerAgent      文件扫描
  ├── StaticAgent       静态分析（Tree-sitter AST）
  ├── SemanticAgent     语义分析（LLM）
  ├── LineageAgent      数据血缘
  ├── GraphBuildAgent   图谱构建
  └── ReportAgent       报告生成
```

**分析流水线（5 阶段）：**

1. **Scanner** — 扫描文件树，收集待分析文件
2. **Static + Semantic（并行）** — 静态 AST 分析和 LLM 语义分析同时运行
3. **Merger（同步点）** — `Merger` 按 source priority + confidence priority 确定性合并结果；然后可选运行 **LineageAgent**
4. **GraphBuild** — 构建最终图谱
5. **Report** — 生成分析报告

**Agent 可自我 Fork：** `AgentPool`（`src/agents/AgentPool.ts`）管理 Fork 生命周期，支持并发控制（`maxConcurrency`）和超时保护。Fork 出的子 Agent 继承父 Agent 的 context 和 tool pool。

**Coordinator 自动决策分析模式：**

- 首次全量分析 → 完整 5 阶段流水线
- 增量更新（`--update`）→ 仅处理未缓存文件
- 无 LLM API Key → 降级为纯静态分析（跳过 SemanticAgent）
- 启用 lineage → 在 Merger 后插入 LineageAgent
- `pipelineMode: 'ai_first'` → 跳过 StaticAgent，直接 LLM 分析（适合动态语言）

### API 路由

| Router        | 路径前缀 | 功能                    |
| ------------- | -------- | ----------------------- |
| `health.ts`   | `/health` | 健康检查                |
| `repos.ts`    | `/repos` | 仓库管理（兼容前端）    |
| `analyze.ts`  | `/api/analyze` | 分析任务（含 SSE 端点 `/api/analyze/:taskId/stream`） |
| `graph.ts`    | `/api/graph` | 图谱数据               |
| `lineage.ts`  | `/api/lineage` | 数据血缘               |
| `frontend.ts` | `/analyze`, `/graph` | 前端兼容路由 |
| `ws.ts`       | `/ws` | WebSocket 实时通知（`/ws/analyze/:taskId`, `/ws/status`） |
| `fs.ts`       | `/api/fs` | 服务端文件系统浏览 |
| `sse.ts`      | — | SSE 广播器（被 analyze.ts 使用） |

### 数据模型

**Schema（`src/graph/schema.ts`）：**

```typescript
GraphNode: { id, label, type, file, location?, confidence?, metadata }
GraphEdge: { id, source, target, type, confidence, weight, file?, location?, metadata? }
NodeType / EdgeType / Confidence: const 对象（禁用 enum）
```

### 会话管理（`src/api/sessions.ts`）

分析任务以 Session 为单位管理，每个 Session 创建一个 `Coordinator` 实例并注册全部 6 个 Agent。Session 状态通过 WebSocket 和 SSE 实时推送。完成后 24 小时自动清理。

### 后端核心模块

| 模块 | 路径 | 功能 |
| ---- | ---- | ---- |
| `CacheManager` | `src/cache/` | 文件级分析结果缓存，支持增量更新 |
| `CostTracker` | `src/cost/` | Token 用量和预算追踪，超预算自动中断 |
| `CheckpointManager` | `src/errors/` | 错误恢复检查点，`AgentError` 区分可恢复/不可恢复 |
| `TaskQueue` | `src/queue/` | 后台分析任务队列 |
| `Merger` | `src/coordinator/Merger.ts` | 多 Agent 结果确定性合并（优先级：ast > lineage > graph-build > report > semantic） |
| `AgentPool` | `src/agents/AgentPool.ts` | Agent Fork 生命周期管理，并发限流 |

### MCP Server

`src/mcp/server.ts` 提供 4 个 MCP 工具（定义在 `src/mcp/tools.ts`）：

| 工具 | 功能 |
| ---- | ---- |
| `analyze_codebase` | 分析代码仓库，返回 sessionId |
| `trace_lineage` | 追踪实体上下游数据血缘 |
| `get_lineage_graph` | 获取完整数据血缘图谱 |
| `query_graph` | 自然语言查询知识图谱 |

### 环境变量

| 变量               | 说明                            |
| ------------------ | ------------------------------- |
| `ANTHROPIC_API_KEY` | LLM 调用（SemanticAgent 需要） |
| `LLM_BASE_URL`     | 自定义 LLM endpoint             |
| `PORT`             | API 服务器端口，默认 8848       |
| `HOST`             | API 服务器 host，默认 0.0.0.0   |

---

## 前端（code-graph-ui）

### 技术栈

React 19 + TypeScript 5.9 + Vite 7 + Ant Design 6 + React Router v7 + Zustand 5 + Cytoscape.js + ReactFlow + ECharts

### 开发环境

```bash
cd code-graph-ui
npm install
```

### 常用命令

```bash
cd code-graph-ui
npm run dev      # 开发服务器 http://localhost:5173（Vite 代理 /api, /repos, /analyze, /graph, /health → localhost:8848）
npm run build    # 生产构建（tsc -b && vite build）
npm run lint     # ESLint
npm run preview  # 预览生产构建
```

### 架构

```
src/
├── api/              # API 层（旧架构）
├── core/api/         # API 层（新架构，推荐）— client.ts + endpoints/
├── core/hooks/       # 通用 hooks（useAnalysisStream, useAsync, useDebounce, useInteraction）
├── components/       # 共享组件
│   ├── graph/        #   图谱渲染组件（GraphCanvas, LayeredArchitecture, ArchitectureCanvas）
│   ├── graph-viewer/ #   图谱查看器（GraphViewerPro, GraphSearch, GraphSidePanel, GraphToolbar）
│   └── ui/           #   UI 基础组件（ChartCard, EmptyState, FilterPanel, SearchBar, StatCard, Icons）
├── graph-engine/     # 性能优化图谱引擎（LOD, 聚类, 批量加载, 视口管理）
├── features/         # Feature 模块（新架构）— architecture/
├── pages/            # 页面组件 — Dashboard, Repository, DataLineage, FieldLineage, FunctionCallGraph
├── layouts/          # 布局 — MainLayout, Sidebar, Header
├── store/            # Zustand stores
├── theme/            # 设计系统 — nodeTypeColors, edgeTypeColors, colorGenerator
└── types/            # TypeScript 类型定义
```

**新架构模式：** 新功能使用 `core/api/` + `features/` + `graph-engine/` 模式，旧代码在 `api/` 和 `components/` 中逐步迁移。`graph-engine/` 提供 LOD（细节层次）、聚类、批量加载和视口管理，用于大规模图谱的高性能渲染。

**路由（`src/App.tsx`，全部 lazy import）：**

- `/` — Dashboard
- `/repository` — 仓库管理
- `/architecture` — 架构探索（新 feature）
- `/lineage` — 数据血缘
- `/fieldlineage` — 字段血缘
- `/callgraph` — 函数调用图

**Zustand Stores：**

- `useGraphStore` — 图谱数据和视图状态
- `usePipelineStore` — 分析任务状态
- `useRepoStore` — 仓库列表
- `useMetaStore` — 元数据（NodeTypes 等，页面可见性变化时自动刷新）
- `useLineageStore` — 数据血缘状态
- `useFunctionCallStore` — 函数调用图状态

### TypeScript 限制

- `tsconfig.app.json` 和 `tsconfig.json` 均开启 `erasableSyntaxOnly: true`，**前后端均禁止使用 `enum`**，改用 `const` 对象 + `as const`
- `GraphNode` 类型字段：`id`, `label`, `type`, `file`, `metadata`，**没有 `name` 和 `properties` 属性**
- Ant Design `Card` 组件无 `icon` prop

---

## Bun 开发规范（code-graph-ts）

- 使用 `bun <file>` 替代 `node <file>` 或 `ts-node <file>`
- 使用 `bun test` 替代 `jest` 或 `vitest`
- 使用 `bun install` 替代 `npm install`
- Bun 自动加载 `.env`，无需 dotenv
- 服务器框架使用 **Fastify**（非 `Bun.serve()`）

---

## 添加新功能

**后端 Agent：**

1. 在 `src/agents/specialized/` 创建 Agent 类，继承 `BaseAgent`
2. 实现 `execute(task: Task): Promise<AgentResult>` 及生命周期方法
3. 定义 `AgentConfig`（name, description, tools, model, maxConcurrency）
4. 如需新工具，在 `src/agents/tools/` 创建 Tool 类
5. 在 `Coordinator.decideMode()` 中注册 Agent 激活条件

**前端 Feature 模块：**

1. 在 `src/features/` 创建目录
2. 使用 `src/core/api/` API 端点（新架构）
3. 使用 `src/components/ui/` 共享 UI 组件
4. 引用 `src/graph-engine/` 进行图谱渲染
5. 在 `src/App.tsx` 添加 lazy import 路由