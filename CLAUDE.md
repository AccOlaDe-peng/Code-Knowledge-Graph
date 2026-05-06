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

# 启动 API 服务器（默认 http://localhost:8848）
bun run src/index.ts serve
PORT=9000 bun run src/index.ts serve  # 自定义端口

# 分析代码仓库（CLI）
bun run src/index.ts analyze /path/to/repo
bun run src/index.ts analyze /path/to/repo --enable-lineage --budget 100000

# 运行测试
bun test
bun test tests/<test-file>.ts  # 单个测试文件

# MCP Server
bun run src/mcp/server.ts
```

### Agent 架构

`Coordinator` 协调 6 个专业 Agent：

```
Coordinator（指挥官）
  ├── ScannerAgent      文件扫描
  ├── StaticAgent       静态分析（Tree-sitter AST）
  ├── SemanticAgent     语义分析（LLM）
  ├── LineageAgent      数据血缘
  ├── GraphBuildAgent   图谱构建
  └── ReportAgent       报告生成
```

**Coordinator 自动决策分析模式：**

- 首次全量分析 → Scanner → Static + Semantic(并行) → Lineage → GraphBuild → Report
- 增量更新（`--update`）→ 仅处理未缓存文件
- 无 LLM API Key → 降级为纯静态分析（跳过 SemanticAgent）
- 启用 lineage → 插入 LineageAgent

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
npm run dev      # 开发服务器 http://localhost:8118
npm run build    # 生产构建
npm run lint     # ESLint
npm run preview  # 预览生产构建
```

### 架构

```
src/
├── api/           # API 层（旧架构，graphApi.ts）
├── core/api/      # API 层（新架构，推荐）
├── components/    # 共享组件（GraphViewer, NodeDetailPanel, SearchBar）
├── features/      # Feature 模块（新架构）
├── pages/         # 页面组件
├── store/         # Zustand stores
└── theme/         # 设计系统
```

**路由（`src/App.tsx`）：**

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
- `useMetaStore` — 元数据（NodeTypes 等）

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
2. 定义 `AgentConfig`（model, temperature, maxTokens）
3. 在 `Coordinator` 注册：`coordinator.registerAgent('MyAgent', (name) => new MyAgent(name))`

**前端 Feature 模块：**

1. 在 `src/features/` 创建目录
2. 使用 `src/components/` 共享组件
3. 使用 `src/core/api/` API 端点
4. 在 `src/App.tsx` 添加路由（lazy import）