# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

AI 代码知识图谱系统，基于 Python 构建，能够解析多语言代码仓库并生成结构化的知识图谱，支持 GraphRAG 自然语言查询和语义检索。

**项目结构：**
```
code-knowledge-graph/
├── code-graph-system/    # Python 后端（API + 图谱分析流水线）
├── code-graph-ui/        # React 前端
├── code-graph-ts/        # TypeScript Agent 架构（实验性，开发中）
└── docs/                 # 文档
```

---

## 后端（code-graph-system）

### 开发环境

所有后端命令在 `code-graph-system/` 目录下执行：

```bash
cd code-graph-system

# Unix/macOS
python3 -m venv venv
source venv/bin/activate

# Windows
python -m venv venv
venv\Scripts\activate

pip install -r requirements-minimal.txt   # 快速启动（无 AI/向量/Neo4j）
pip install -r requirements.txt           # 完整功能
```

### 常用命令

```bash
# 以下所有命令均需在 code-graph-system/ 根目录下执行
cd code-graph-system

# 启动 API 服务器（访问 http://localhost:8000/docs）
python -m uvicorn backend.api.server:app --host 0.0.0.0 --port 8000 --reload

# AI 分析代码仓库
python -m backend.pipeline.ai_analyze /path/to/repo
python -m backend.pipeline.ai_analyze /path/to/repo --name my-project --enable-rag
python -m backend.pipeline.ai_analyze /path/to/repo --pipeline-mode ai_first  # AI 优先流水线

# 运行测试
pytest backend/tests/ -v                              # 所有测试
pytest backend/tests/test_ai_pipeline.py -v           # AI 流水线测试
pytest backend/tests/test_static_first_pipeline.py -v # 静态优先流水线测试
pytest backend/tests/test_agent_orchestrator.py -v    # Agent 系统测试
pytest backend/tests/test_ai_pipeline.py::test_scan_repository -v  # 单个测试函数

# 检查依赖状态
python scripts/check_deps.py

# Celery Worker（需先启动 Redis）
celery -A backend.scheduler.celery_app worker --loglevel=info
celery -A backend.scheduler.celery_app worker --beat --loglevel=info  # Worker + Beat

# Windows Celery Worker
celery -A backend.scheduler.celery_app worker --loglevel=info --pool=solo
```

### 流水线架构

**静态优先流水线（默认）：**
```
代码仓库
  → FileIndexStage           扫描文件 + Git 增量检测
  → DeepStaticAnalysisStage  AST 解析 + Spring 框架分析
  → DirectoryClusterStage    目录聚类（零 LLM）|| 并行
  → SpringDIEventStaticStage Spring DI/Event 静态解析 || 并行
  → AISemanticEnhanceStage   AI 语义增强（模块并行）
  → SpringDIEventAIStage     AI 解析歧义
  → GraphMergeWithQuality    合并图谱 + 质量报告
  → GraphRepository          持久化 JSON / Neo4j
  → GraphRAGEngine           向量化写入 ChromaDB（可选）
```

**AI 优先流水线（`--pipeline-mode ai_first`）：**
- 完全由 AI 驱动，支持字段级血缘追踪和实体重要性评分
- 产出实体级节点（Entity, Table, Field）和关系级边（one_to_one, one_to_many, flow_to）

**流水线选择（`ai_analyze.py`）：**
- `enable_static_first=True`（默认）：StaticFirstPipeline
- `enable_static_first=False, enable_optimization=True`：OptimizedPipeline（旧版）
- `pipeline_mode=ai_first`：AI 优先流水线

### 多 Agent 系统（`backend/agent/`）

`AgentOrchestrator` 协调 6 个专业 Agent：

| Agent                 | 职责                         |
| --------------------- | ---------------------------- |
| `ModuleDetectorAgent` | 模块检测                     |
| `ArchitectureAgent`   | 架构分析（分层、边界上下文） |
| `CallGraphAgent`      | 调用图分析                   |
| `DataLineageAgent`    | 数据血缘追踪                 |
| `APIEndpointAgent`    | API 端点分析                 |
| `CrossModuleAgent`    | 跨模块依赖分析               |

### Agent Explorer 系统（`backend/agent_explorer/`）

交互式 Agent 探索系统，支持自主探索和用户引导：

```python
from backend.agent_explorer.orchestrator import AgentOrchestrator

orch = AgentOrchestrator(graph_id="my-project")
await orch.start(targets=["auth 模块", "数据库层", "API 端点"])
await orch.freeze()  # 冻结状态
await orch.thaw()    # 恢复继续
```

**API 端点（`/agent/*`）：**
- `POST /agent/start` — 启动 Agent 探索
- `GET /agent/{agent_id}/status` — 获取状态
- `POST /agent/{agent_id}/guide` — 发送引导消息
- `POST /agent/{agent_id}/stop` — 停止 Agent
- `GET /agent/{agent_id}/events` — SSE 事件流

### MCP Server（`backend/mcp_server/`）

为 Claude Code 提供 MCP 工具集成：

**配置（`~/.claude/settings.json`）：**
```json
{
  "mcpServers": {
    "code-knowledge-graph": {
      "command": "/path/to/code-graph-system/.venv/bin/python",
      "args": ["-m", "backend.mcp_server.server"],
      "cwd": "/path/to/code-graph-system"
    }
  }
}
```

**工具：**
- `query_graph` — 语义搜索节点
- `add_node` / `add_edge` — 添加节点/边
- `get_context` — BFS 展开节点邻域
- `mark_explored` — 标记已探索节点

### API 路由

| Router | 路径前缀 | 功能 |
|--------|---------|------|
| `repos.py` | `/repos` | 仓库管理（CRUD + 分析历史） |
| `analysis.py` | `/analyze` | 分析任务（异步提交 + SSE 进度） |
| `graphs.py` | `/graph` | 图谱数据（架构图/调用图/血缘图） |
| `query.py` | `/query` | GraphRAG 自然语言查询 |
| `agent.py` | `/agent` | Agent Explorer 控制 |

**异步分析流程：**
1. `POST /analyze/repository` → 返回 `{task_id}`
2. `GET /analyze/stream/{task_id}` → SSE 实时进度
3. `GET /analyze/status/{task_id}` → 轮询状态（断线重连）

### 数据模型

**Schema（`backend/graph/graph_schema.py`）：**
```python
GraphNode(id, type, name, properties)
GraphEdge(from_, to, type, properties)  # from_ 序列化为 "from"
NodeType / EdgeType  # 枚举
```

**前后端字段映射：**
- 后端：`from_` / `to`
- 前端：`source` / `target`
- 转换：`src/api/graphApi.ts` 的 `rawEdgeToGraphEdge()`

### 存储与缓存

| 路径 | 内容 |
|------|------|
| `data/graphs/` | 图谱 JSON 文件 |
| `data/chroma/` | ChromaDB 向量索引 |
| `data/ai_analysis/` | AI 分析缓存（按 repo_name + commit_sha） |
| `data/pipeline_cache/` | 阶段缓存（支持断点续跑） |

### 环境变量

| 变量 | 说明 |
|------|------|
| `LLM_PROVIDER` | `anthropic`（默认）/ `openai` / `minimax` / `ollama` / `zhipu` |
| `ANTHROPIC_API_KEY` | LLM_PROVIDER=anthropic 时必须 |
| `NEO4J_URI` | 可选，如 `bolt://localhost:7687` |
| `CELERY_BROKER_URL` | 默认 `redis://localhost:6379/0` |
| `AI_DESCRIPTION_CONCURRENCY` | AI 描述生成并发数，默认 3 |

---

## 前端（code-graph-ui）

### 技术栈

React 19 + TypeScript 5.9 + Vite 7 + Ant Design 6 + React Router v7 + Zustand 5 + Cytoscape.js + ReactFlow + ECharts

### 常用命令

```bash
cd code-graph-ui
npm run dev      # 开发服务器 http://localhost:5173
npm run build    # 生产构建
npm run lint     # ESLint
```

### 架构

```
src/
├── core/api/           # API 层（推荐）
├── components/         # 共享组件（GraphViewer, NodeDetailPanel, SearchBar）
├── features/           # Feature 模块（新架构）
├── pages/              # 页面组件
├── store/              # Zustand stores
└── theme/              # 设计系统
```

**两套 API 层：**
- `src/core/api/` — 新架构，推荐用于新功能
- `src/api/graphApi.ts` — 旧架构，仍被现有页面使用

**Zustand Stores：**
- `useGraphStore` — 图谱数据和视图状态
- `usePipelineStore` — 分析任务状态
- `useRepoStore` — 仓库列表

### TypeScript 限制

- `tsconfig.app.json` 开启 `erasableSyntaxOnly: true`，**禁止使用 `enum`**，改用 `const` 对象 + `as const`
- `GraphNode` 类型只有 `id`, `type`, `label`, `properties`，**没有 `name` 属性**
- Ant Design `Card` 组件无 `icon` prop

### AgentPanel 组件（`src/components/AgentPanel/`）

Agent 探索状态面板，显示 Agent 状态、探索进度、最近发现，提供用户引导输入。

---

## TypeScript Agent 架构（code-graph-ts）

**实验性架构**，计划用统一 TypeScript Agent 系统替代现有 Python 流水线。

### 技术栈

Bun + Fastify + Graphology + Web-tree-sitter + Claude SDK

### 常用命令

```bash
cd code-graph-ts
bun install
bun test                    # 运行所有测试（tests/ 目录）
bun test tests/e2e.test.ts  # 运行单个测试文件
bun run src/index.ts        # 启动 API 服务器（默认端口 3000）
```

### 架构设计

```
Coordinator（指挥官）
  ├── ScannerAgent      文件扫描
  ├── StaticAgent       静态分析（Tree-sitter AST）
  ├── SemanticAgent     语义分析（LLM）
  ├── LineageAgent      数据血缘
  └── GraphBuildAgent   图谱构建
```

**Coordinator 自动决策分析模式：**
- 首次全量分析 → Scanner → Static + Semantic(并行) → Lineage → GraphBuild
- 增量更新（`--update`）→ 仅处理未缓存文件
- 纯代码仓库（代码文件 >95%）→ 跳过语义分析
- 无 LLM API Key → 降级为纯静态分析

**API 路由（Fastify）：**
- `GET /health` — 健康检查
- `POST /api/analyze` — 提交分析任务
- `GET /api/graph/:id` — 获取图谱
- `GET /api/lineage/:id` — 获取数据血缘

详细设计见 `docs/superpowers/specs/2026-04-22-agent-pipeline-redesign.md`。

---

## 添加新功能

**后端 Agent：**
1. 在 `backend/agent/` 创建类，继承 `BaseAgent`
2. 实现 `run()` 方法，返回 `AgentResult`
3. 在 `AgentOrchestrator` 中注册

**前端 Feature 模块：**
1. 在 `src/features/` 创建目录
2. 使用 `src/components/` 共享组件
3. 使用 `src/core/api/` API 端点
4. 在 `src/App.tsx` 添加路由
