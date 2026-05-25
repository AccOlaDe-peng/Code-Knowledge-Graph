# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

AI 代码知识图谱系统：解析多语言代码仓库 → 结构化知识图谱，支持 GraphRAG 查询和语义检索。

```
code-knowledge-graph/
├── code-graph-system/    # Python 后端（API + 图谱分析流水线）
├── code-graph-ui/        # React 前端
└── docs/                 # 文档
```

## 后端开发

所有后端命令在 `code-graph-system/` 目录下执行：

```bash
cd code-graph-system
python3 -m venv venv && source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements-minimal.txt  # 快速启动（无 AI/向量/Neo4j）
pip install -r requirements.txt          # 完整功能

# 启动 API 服务器
python -m uvicorn backend.api.server:app --host 0.0.0.0 --port 8000 --reload

# 分析代码仓库
python -m backend.pipeline.ai_analyze /path/to/repo
python -m backend.pipeline.ai_analyze /path/to/repo --name my-project --enable-rag
python -m backend.pipeline.ai_analyze /path/to/repo --pipeline-mode ai_first  # AI 优先流水线

# 测试
pytest backend/tests/ -v                                          # 全部
pytest backend/tests/test_static_first_pipeline.py -v             # 单文件
pytest backend/tests/test_ai_pipeline.py::test_scan_repository -v # 单函数

# Celery Worker（需先启动 Redis）
celery -A backend.scheduler.celery_app worker --loglevel=info
# Windows: 加 --pool=solo 或使用 start-celery-worker.bat/.ps1
```

### 流水线选择

`AIPipeline.analyze()` 根据 `enable_static_first` 参数选择：

- **`enable_static_first=True`（默认）** → `StaticFirstPipeline`：静态优先、AI 增强，LLM 调用量减少 >50%
- **`enable_static_first=False, enable_optimization=True`** → `OptimizedPipeline`：旧 5 阶段
- **`pipeline_mode=ai_first`** → `AIFirstPipeline`：纯 AI 驱动，支持字段级血缘

### 静态优先流水线（默认）

```
FileIndexStage → DeepStaticAnalysisStage → DirectoryClusterStage (零LLM) ∥ SpringDIEventStaticStage (零LLM)
  → AISemanticEnhanceStage → SpringDIEventAIStage → GraphMergeWithQuality
```

核心设计：静态分析产出高置信度数据（0.80-0.98），AI 增强仅追加低置信度字段、不覆盖静态数据。Stage 3 和 4a 并行执行。增量分析通过 `StageCacheManager` 按 `(repo_name, commit_sha)` 缓存，缓存路径 `data/pipeline_cache/{repo_name}/`。

### 多 Agent 系统（`backend/agent/`）

`AgentOrchestrator` 协调 6 个专业 Agent：ModuleDetector / Architecture / CallGraph / DataLineage / APIEndpoint / CrossModule。每个 Agent 共享 `SharedKnowledgeBase`，使用 LLM 工具（`read_file`、`search_code`、`list_directory`）自主探索代码，输出 `GraphNode` / `GraphEdge`。

### 数据模型

Schema 在 `backend/graph/graph_schema.py`：`GraphNode(id, type, name, properties)`、`GraphEdge(from_, to, type, properties)`。所有合法 NodeType/EdgeType 见该文件枚举定义。`GraphSchema.validate_graph()` 三层验证。

**前后端边字段映射：** 后端 `from_`/`to` → 前端 `source`/`target`，转换函数 `src/api/graphApi.ts` 的 `rawEdgeToGraphEdge()`。

`BuiltGraph`（`backend/graph/graph_builder.py`）是流水线输出容器：`nodes`、`edges`、`meta`、`metrics`。

### 持久化

- `GraphRepository`（`backend/graph/graph_repository.py`）：默认 JSON（`data/graphs/`），配置 `NEO4J_URI` 后双写 Neo4j
- `GraphRAGEngine`（`backend/rag/graph_rag_engine.py`）：ChromaDB 向量化，Collection `kg_{graph_id}`
- AI 缓存（`backend/ai/cache/`）：commit SHA 不变跳过 LLM，`data/ai_analysis/`

### API

4 个 Router 挂载在 `backend/api/server.py`：`repos.py`（仓库 CRUD）、`analysis.py`（异步分析任务 + SSE 进度）、`graphs.py`（架构图/调用图/血缘/事件流/服务图）、`query.py`（GraphRAG）。四个全局单例通过 `lifespan` 管理。

关键：`POST /analyze/repository` 异步返回 `task_id`（非 graph_id），通过 `GET /analyze/stream/{task_id}` SSE 获取进度。

### LLM 上下文管理（`backend/llm/`）

`client.py` 自动压缩 context：L1(70%) 滑动窗口裁剪 → L2(85%) + 压缩大 tool result → L3(95%) 极简保留。

### 添加新 Agent

1. 在 `backend/agent/` 创建类，继承 `BaseAgent`
2. 实现 `run()` → 返回 `AgentResult`（含 `nodes`/`edges`）
3. 在 `AgentOrchestrator` 注册

`GraphBuilder.merge_graph()` duck typing 合并；同 ID 节点后覆盖前。

## 前端开发

```bash
cd code-graph-ui
npm run dev      # http://localhost:5173
npm run build    # tsc -b && vite build
npm run lint
```

环境变量：`code-graph-ui/.env.local` → `VITE_API_BASE_URL=http://localhost:8000`

### 技术栈

React 19 + TypeScript 5.9 + Vite 7 + Ant Design 6 + React Router v7 + Zustand 5 + Axios + Cytoscape.js + @xyflow/react + ECharts

### 架构

两套 API 层并存：
- `src/core/api/` — **新架构，新功能优先使用**
- `src/api/graphApi.ts` — 旧架构，带缓存和类型转换，现有页面仍在用

`src/graph-engine/` 是独立的高性能图渲染引擎：`GraphLoader`（批量按需加载）、`graphEngineStore`（LOD/视口/集群/过滤）、LOD 按缩放级别切换可见节点类型。后端 `name` 字段映射为引擎 `label`。

Zustand Store：`useGraphStore`（图谱数据/视图）、`usePipelineStore`（分析任务/SSE）、`useRepoStore`（仓库列表）。

### TypeScript 严格约束

`tsconfig.app.json` 关键配置：

- **`erasableSyntaxOnly: true`** — 禁止 `enum`，用 `const` 对象 + `as const`
- **`verbatimModuleSyntax: true`** — 类型导入必须用 `import type { X }`，不能 `import { X }`
- **`noUnusedLocals` / `noUnusedParameters: true`** — 未使用的变量/参数会报错
- `GraphNode` 类型只有 `id`, `type`, `label`, `properties`，**没有 `name` 属性**
- Ant Design `Card` 无 `icon` prop

### 设计系统（Mission Control Dark）

颜色 token：`--a-cyan #00d4ff`（主强调/Module）、`--a-green #00f084`（Service）、`--a-amber #ffc145`（Event）、`--a-purple #b08eff`（Class/DB）、`--s-void #07090d`（最深背景）。字体：Syne + IBM Plex Mono。配置见 `src/theme/index.ts` + `src/styles/global.css`。

### 添加新 Feature 模块

1. 在 `src/features/` 创建目录，参考 `src/features/architecture/`
2. 使用 `src/components/` 共享组件 + `src/core/api/` 端点
3. 在 `src/App.tsx` 添加路由

## 环境变量

| 变量                    | 说明                                                 |
| ----------------------- | ---------------------------------------------------- |
| `LLM_PROVIDER`          | `anthropic`（默认）/ `openai` / `minimax` / `ollama` / `zhipu` |
| `ANTHROPIC_API_KEY`     | LLM_PROVIDER=anthropic 时必须                        |
| `OPENAI_API_KEY`        | LLM_PROVIDER=openai 时使用                           |
| `MINIMAX_API_KEY`       | LLM_PROVIDER=minimax 时必须                          |
| `MINIMAX_GROUP_ID`      | LLM_PROVIDER=minimax 时必须                          |
| `ZHIPU_API_KEY`         | LLM_PROVIDER=zhipu 时必须                            |
| `LLM_MODEL`             | 覆盖默认模型名称                                     |
| `LLM_BASE_URL`          | 自定义 LLM API 端点（优先级最高）                    |
| `ANTHROPIC_BASE_URL`    | Anthropic API 自定义端点                             |
| `OPENAI_BASE_URL`       | OpenAI API 自定义端点                                |
| `OLLAMA_BASE_URL`       | Ollama 端点，默认 `http://localhost:11434/v1`        |
| `NEO4J_URI`             | 可选，如 `bolt://localhost:7687`                     |
| `CELERY_BROKER_URL`     | 默认 `redis://localhost:6379/0`                      |
| `CELERY_RESULT_BACKEND` | 默认 `redis://localhost:6379/1`                      |
| `AI_DESCRIPTION_CONCURRENCY` | AI 描述生成并发数，默认 3                       |
| `AI_ENTITY_CONCURRENCY` | AI 实体分析并发数，默认 3                            |
| `LLM_MAX_CONCURRENCY`   | LLM 最大并发数                                       |
