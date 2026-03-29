# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

AI 代码知识图谱系统，基于 Python 构建，能够解析多语言代码仓库并生成结构化的知识图谱，支持 GraphRAG 自然语言查询和语义检索。

**项目结构：**
```
code-knowledge-graph/
├── code-graph-system/    # Python 后端（API + 图谱分析流水线）
├── code-graph-ui/        # React 前端
└── docs/                 # 文档
```

## 后端开发环境

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

## 后端常用命令

```bash
# 以下所有命令均需在 code-graph-system/ 根目录下执行
cd code-graph-system

# 启动 API 服务器（访问 http://localhost:8000/docs）
python -m uvicorn backend.api.server:app --host 0.0.0.0 --port 8000 --reload

# AI 分析代码仓库（新方式）
python -m backend.pipeline.ai_analyze /path/to/repo
python -m backend.pipeline.ai_analyze /path/to/repo --name my-project --enable-rag
python -m backend.pipeline.ai_analyze /path/to/repo --verbose --json

# AI 优先流水线（字段级血缘）
python -m backend.pipeline.ai_analyze /path/to/repo --pipeline-mode ai_first

# 运行单个测试文件
pytest backend/tests/test_ai_analysis_models.py -v
pytest backend/tests/test_ai_pipeline.py -v
pytest backend/tests/test_ai_pipeline_e2e.py -v  # 需要 LLM API Key
pytest backend/tests/test_ai_first_pipeline.py -v  # AI 优先流水线测试

# 运行静态优先流水线测试
pytest backend/tests/test_static_first_pipeline.py -v
pytest backend/tests/test_phase*.py -v

# 运行 Agent 系统测试
pytest backend/tests/test_agent_orchestrator.py -v
pytest backend/tests/test_agent_*.py -v

# 运行单个测试函数
pytest backend/tests/test_ai_pipeline.py::test_scan_repository -v

# 运行所有测试
pytest backend/tests/ -v

# 检查依赖状态
python scripts/check_deps.py

# Celery Worker（需先启动 Redis）
celery -A backend.scheduler.celery_app worker --loglevel=info
celery -A backend.scheduler.celery_app worker --beat --loglevel=info  # Worker + Beat

# Windows Celery Worker（需使用 solo pool）
celery -A backend.scheduler.celery_app worker --loglevel=info --pool=solo
# 或使用启动脚本
.\start-celery-worker.ps1   # PowerShell
.\start-celery-worker.bat   # CMD
```

## 架构概览

### 核心数据流

**静态优先流水线（推荐，默认启用）：**

```
代码仓库
  → FileIndexStage           扫描文件 + Git 增量检测
  → DeepStaticAnalysisStage  AST 解析 + Spring 框架分析（产出 A+B）
  → DirectoryClusterStage    目录聚类（零 LLM）|| 并行
  → SpringDIEventStaticStage Spring DI/Event 静态解析 || 并行
  → AISemanticEnhanceStage   AI 语义增强（模块并行）
  → SpringDIEventAIStage     AI 解析歧义（仅处理无法静态解析的）
  → GraphMergeWithQuality    合并图谱 + 质量报告
  → GraphRepository          持久化 JSON / Neo4j
  → GraphRAGEngine           向量化写入 ChromaDB（可选）
```

**传统 AI 流水线（备用）：**

```
代码仓库
  → RepoScanner       扫描文件 + Git 信息
  → AIModuleScanner   AI 识别模块边界
  → AICodeAnalyzer    AI 代码分析（多 Agent 并行）
  → GraphBuilder      合并图谱 + PageRank
  → GraphRepository   持久化 JSON / Neo4j
  → GraphRAGEngine    向量化写入 ChromaDB（可选）
```

**AI 优先流水线（`pipeline_mode=ai_first`）：**

```
代码仓库
  → AIRepositoryScanStage   AI 探索仓库结构，识别实体、流程、服务
  → AIEntityAnalysisStage   AI 分析实体字段和关系（并行处理）
  → AIFieldLineageStage     AI 推断字段级数据血缘
  → AIEntityDescriptionStage AI 生成实体描述和重要性评分
  → AIGraphBuildStage       构建图谱节点和边
  → GraphRepository         持久化 JSON / Neo4j
  → GraphRAGEngine          向量化写入 ChromaDB（可选）
```

**特点：**
- 完全由 AI 驱动，无静态分析前置
- 支持字段级血缘追踪
- 支持实体重要性评分
- 产出实体级节点（Entity, Table, Field）
- 产出关系级边（one_to_one, one_to_many, many_to_many, flow_to）

### 静态优先流水线（`backend/pipeline/static_first_pipeline.py`）

**特点：**
- 静态分析产出结构层数据（高置信度，~0.95）
- AI 增强补充语义信息（低置信度字段追加，不覆盖静态数据）
- Stage 3 (DirectoryCluster) 和 Stage 4a (SpringDIEventStatic) 并行执行
- LLM 调用量减少 > 50%，相同 commit SHA 重跑模块边界 100% 可复现

**Stage 编排：**

| Stage | 类                         | 说明                                      |
| ----- | -------------------------- | ----------------------------------------- |
| 1     | `FileIndexStage`           | 异步文件索引 + Git 增量检测               |
| 2     | `DeepStaticAnalysisStage`  | AST 解析 + Spring 框架分析                |
| 3     | `DirectoryClusterStage`    | 目录聚类（零 LLM）                        |
| 4a    | `SpringDIEventStaticStage` | Spring DI/Event 静态解析（零 LLM）        |
| 3b    | `AISemanticEnhanceStage`   | AI 语义增强（两次调用：边界 + 边验证）    |
| 4b    | `SpringDIEventAIStage`     | AI 解析歧义（DI/Topic/Event）             |
| 5     | `GraphMergeWithQuality`    | 合并图谱 + 质量报告                       |

**置信度体系：**
- 静态分析：0.80-0.98（直接导入、注解驱动、框架模式）
- AI 增强：0.65-0.75（语义描述、新发现关系）
- 字段级合并：静态节点的 source/confidence 保持不变，AI 字段追加

**增量分析与阶段缓存（`backend/pipeline/stage_cache.py`）：**
- Git diff 检测变更文件；模块级缓存只重分析含变更文件的模块
- `StageCacheManager` 按 `(repo_name, commit_sha)` 缓存各 Stage 输出，支持断点续跑
- 缓存路径：`data/pipeline_cache/{repo_name}/`（modules/ 子目录存模块级缓存）

### 分析流水线（`backend/pipeline/ai_analyze.py`）

`AIPipeline.analyze(repo_path, *, repo_name, enable_rag)` 根据 `enable_static_first` 参数选择流水线：

**默认行为（`enable_static_first=True`）：**
使用 `StaticFirstPipeline`，静态优先、AI 增强。

**备用行为（`enable_static_first=False, enable_optimization=True`）：**
使用 `OptimizedPipeline`，旧的 5 阶段优化流水线。

**传统行为（都为 False）：**
使用传统 6 步 AI 驱动分析：

| 步骤 | 类                   | 说明                             |
| ---- | -------------------- | -------------------------------- |
| 1    | `RepoScanner`        | 扫描文件，识别语言               |
| 2    | `ModuleScannerAgent` | AI 识别模块边界                  |
| 3    | `AgentOrchestrator`  | AI 代码分析（多 Agent 并行）     |
| 4    | `GraphBuilder`       | 合并图谱，计算 PageRank / 度指标 |
| 5    | `GraphRepository`    | 持久化 JSON / Neo4j              |
| 6    | `GraphRAGEngine`     | 向量化（可选）                   |

任意步骤失败只记录警告，不中断整体流水线。

### 多 Agent 系统（`backend/agent/`）

`AgentOrchestrator` 协调 6 个专业 Agent 进行 AI 代码分析：

| Agent                 | 职责                         |
| --------------------- | ---------------------------- |
| `ModuleDetectorAgent` | 模块检测                     |
| `ArchitectureAgent`   | 架构分析（分层、边界上下文） |
| `CallGraphAgent`      | 调用图分析                   |
| `DataLineageAgent`    | 数据血缘追踪                 |
| `APIEndpointAgent`    | API 端点分析                 |
| `CrossModuleAgent`    | 跨模块依赖分析               |

每个 Agent 共享 `SharedKnowledgeBase`，通过 `AgentContext` 访问仓库路径和配置。Agent 使用 LLM 工具（`read_file`、`search_code`、`list_directory` 等）自主探索代码，输出 `GraphNode` / `GraphEdge`。

### 数据模型

**Schema**（`backend/graph/graph_schema.py`）— 当前流水线和所有新代码使用：

- `GraphNode(id, type, name, properties)` — 通用节点
- `GraphEdge(from_, to, type, properties)` — 通用边（`from_` 是 Python 属性名，序列化为 `"from"`）
- `NodeType` / `EdgeType` — 枚举定义所有合法类型
- `GraphSchema.validate_graph()` — 三层验证（节点/边/引用完整性）

**前后端边字段映射：**
- 后端（Python）：`from_` / `to`
- 前端（TypeScript）：`source` / `target`
- 转换函数：`src/api/graphApi.ts` 中的 `rawEdgeToGraphEdge()`

节点类型：`Repository`, `Module`, `File`, `Class`, `Function`, `Component`, `Service`, `API`, `APIEndpoint`, `DataObject`, `DataSource`, `DataSink`, `Table`, `Event`, `EventHandler`, `Topic`, `MessageQueue`, `Pipeline`, `Cluster`, `Database`, `Layer`, `Flow`, `BusinessFlow`, `Domain`, `BoundedContext`, `DomainEntity`, `ExternalAPI`, `Infrastructure`, `Entity`, `Field`, `FlowNode`

边类型：`contains`, `imports`, `defines`, `calls`, `depends_on`, `implements`, `reads`, `writes`, `produces`, `consumes`, `publishes`, `subscribes`, `deployed_on`, `uses`, `routes_to`, `triggers`, `belongs_to`, `flow_step`, `transforms`, `part_of`, `async_calls`, `handles`, `extends`, `overrides`, `queries`, `flow_to`, `maps_to`, `has_field`, `one_to_one`, `one_to_many`, `many_to_one`, `many_to_many`

**`BuiltGraph`**（`backend/graph/graph_builder.py`）— 流水线输出容器：

- `nodes: list[GraphNode]`，`edges: list[GraphEdge]`
- `meta: dict`（含 `node_type_counts`、`edge_type_counts`、`created_at`、`git_commit`）
- `metrics: dict[node_id, {in_degree, out_degree, pagerank}]`（需安装 networkx）

### GraphRepository（`backend/graph/graph_repository.py`）

默认本地 JSON（`data/graphs/`），配置 `NEO4J_URI` 后自动双写 Neo4j：

```python
repo.save(built, repo_name="my-svc")
repo.load(graph_id)
repo.list_graphs()
repo.query_neighbors(graph_id, node_id, depth=1, edge_types=["calls"])

# Neo4j 专属（需先 connect 或配置 NEO4J_URI）
repo.connect("bolt://localhost:7687", "neo4j", "password")
repo.save_nodes(graph_id, nodes)   # UNWIND+MERGE，按 node.type 分组
repo.save_edges(graph_id, edges)
repo.query("MATCH (n {graph_id: $gid}) RETURN n LIMIT 10", {"gid": graph_id})
```

### GraphRAGEngine（`backend/rag/graph_rag_engine.py`）

向量化目标类型：`Function`、`Component`、`API`；ChromaDB Collection 命名：`kg_{graph_id}`：

```python
engine.embed_nodes(graph_id, built.nodes)
engine.vector_search(graph_id, "用户登录", limit=5)
engine.graph_expand(graph_id, seed_ids, depth=1)
engine.rag_query(graph_id, "登录如何实现？")
# 返回: {question, answer, nodes, edges, sources, confidence}
```

### API 端点

API 分为 4 个 Router，均挂载在 `backend/api/server.py`：

**仓库管理（`routers/repos.py`）：**

| 方法   | 路径                        | 说明                                           |
| ------ | --------------------------- | ---------------------------------------------- |
| GET    | `/repos`                    | 列出所有仓库（含最近一次分析摘要）             |
| POST   | `/repos`                    | 创建仓库配置                                   |
| PUT    | `/repos/{repo_id}`          | 编辑仓库配置（名称、分支、语言）               |
| DELETE | `/repos/{repo_id}`          | 删除仓库及所有分析历史、关联图谱、向量集合     |
| GET    | `/repos/{repo_id}/analyses` | 获取仓库分析历史（含进行中任务虚拟记录）       |
| GET    | `/api/pipeline/stages`      | 获取流水线阶段定义                             |

**分析任务（`routers/analysis.py`）：**

| 方法   | 路径                          | 说明                                                              |
| ------ | ----------------------------- | ----------------------------------------------------------------- |
| GET    | `/health`                     | 健康检查                                                          |
| POST   | `/analyze/repository`         | 异步提交分析任务，**立即返回 `task_id`**（非 graph_id）           |
| GET    | `/analyze/stream/{task_id}`   | SSE 实时进度（Redis Pub/Sub），支持断线重连；心跳每 15 秒一次    |
| GET    | `/analyze/status/{task_id}`   | 轮询分析状态（断线重连恢复用）                                    |
| POST   | `/analyze/cancel/{task_id}`   | 取消分析任务（revoke Celery 任务 + 发布 canceled 事件）           |
| POST   | `/analyze/upload-zip`         | 上传 ZIP 文件分析，**同步**返回 graph_id + 统计                   |
| POST   | `/analyze/graph`              | GraphPipeline 直接分析（文件级 LLM），仅支持本地绝对路径          |

**图谱数据（`routers/graphs.py`）：**

| 方法 | 路径                | 说明                                                                           |
| ---- | ------------------- | ------------------------------------------------------------------------------ |
| GET  | `/graph/framework`  | 架构图视图（`repo_id` + 可选 `node_types`；默认过滤细粒度节点）                |
| GET  | `/graph/call`       | 调用图视图（`repo_id` + 可选 `node_id`/`depth`；无 `node_id` 返回全图）        |
| GET  | `/graph/lineage`    | 数据血缘视图（`repo_id` + 可选 `edge_types`/`node_id`/`depth`）                |
| GET  | `/events`           | 事件流图（`graph_id`；Event/Topic 节点 + produces/consumes 边）                |
| GET  | `/services`         | 基础设施服务图（`graph_id`；Service/Cluster/Database 节点）                    |

**参数说明：**
- `/graph/framework`：`node_types=all` 返回全部节点；不传使用 `ARCHITECTURE_NODE_TYPES` 默认集合
- `/graph/call`：`node_id` 指定后 BFS 展开调用子图，`depth` 控制深度（默认 2，最大 5）
- `/graph/lineage`：默认追踪 `depends_on`/`reads`/`writes`/`produces`/`consumes`/`imports`
- `/events` 和 `/services` 仍使用 `graph_id`（GraphRepository 体系），不在本次重构范围

**查询（`routers/query.py`）：**

| 方法 | 路径     | 说明                   |
| ---- | -------- | ---------------------- |
| POST | `/query` | GraphRAG 自然语言查询  |

四个全局单例通过 `lifespan` 管理：`_graph_repo`、`_vector_store`、`_pipeline`、`_rag_engine`。

**`/analyze/repository` 异步流程：**
1. POST 立即返回 `{task_id, status: "pending"}`
2. GET `/analyze/stream/{task_id}` 订阅 SSE（Redis Pub/Sub channel `progress:{task_id}`）
3. SSE 数据格式：`{step, total, stage, message, log, status, elapsed_seconds}`；完成时含 `{graph_id, node_count, edge_count}`
4. GET `/analyze/status/{task_id}` 用于轮询或断线重连恢复

**`/analyze/repository` 的 `depth` 参数：** `quick` | `standard`（默认）| `deep`

### LLM 上下文管理（`backend/llm/`）

`client.py` 在调用 LLM 前自动压缩 context，三级阈值（context 使用率）：
- **L1（70%）**：滑动窗口裁剪旧轮次
- **L2（85%）**：同上 + 压缩保留轮次中的大 tool result（替换为占位符）
- **L3（95%）**：极简保留，仅首条系统消息 + 最近 1 轮

其他模块：`context_manager.py`（上下文构建）、`context_monitor.py`（用量监控）、`sliding_window.py`、`summarizer.py`（历史摘要）。

### Celery 异步任务（`backend/scheduler/`）

- `celery_app.py` — Celery 实例，broker/backend 均为 Redis
- `tasks.py` — 两个任务（task name 前缀为 `tasks.`）：

```python
from backend.scheduler.tasks import analyze_repository, incremental_update

analyze_repository.delay("/path/to/repo", repo_name="my-svc")
incremental_update.delay("my-svc", "/path/to/repo")
# 返回: {updated, reason, new_commits, graph_id, node_count, ...}
```

增量检测优先级：Git SHA 对比 → commit 计数（自 `created_at`）→ 目录 mtime → 退化全量分析。每次分析完毕将当前 git HEAD SHA 写回 `BuiltGraph.meta["git_commit"]`。

## 存储

| 路径                     | 内容                                                                    |
| ------------------------ | ----------------------------------------------------------------------- |
| `data/graphs/`           | 图谱 JSON 文件（已加入 .gitignore）                                     |
| `data/graphs/index.json` | 所有图谱摘要索引                                                        |
| `data/chroma/`           | ChromaDB 向量索引（已加入 .gitignore）                                  |
| `data/ai_analysis/`      | AI 分析结果缓存，按 `(repo_name, commit_sha)` 命中（已加入 .gitignore） |

AI 分析缓存（`backend/ai/cache/`）：commit SHA 不变则跳过 LLM 调用，直接返回上次结果。非 Git 仓库（SHA 为空）不写缓存。`cache.invalidate("repo-name")` 清除整个仓库缓存。

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

## 添加新 Agent

1. 在 `backend/agent/` 创建新 Agent 类，继承 `BaseAgent`
2. 实现 `run()` 方法，返回 `AgentResult`（包含 `nodes`/`edges`）
3. 在 `AgentOrchestrator` 中注册新 Agent

`GraphBuilder.merge_graph()` 通过 duck typing 自动提取 `GraphNode` / `GraphEdge`；后 merge 的同 ID 节点覆盖前者。

---

## 前端（code-graph-ui）

### 技术栈

React 19 + TypeScript 5.9 + Vite 7 + Ant Design 6 + React Router v7 + Zustand 5 + Axios + Cytoscape.js（含 cytoscape-dagre、cytoscape-cose-bilkent）+ @xyflow/react（ReactFlow）+ ECharts

### 前端常用命令

```bash
cd code-graph-ui

# 开发
npm run dev      # 启动开发服务器 http://localhost:5173
npm run build    # 构建生产版本
npm run preview  # 预览生产构建
npm run lint     # 运行 ESLint
```

### 前端环境变量

创建 `code-graph-ui/.env.local`：
```
VITE_API_BASE_URL=http://localhost:8000
```

### 架构（已升级为企业级模块化架构）

**新架构**（推荐使用）：

```
src/
├── core/                   # 核心基础设施
│   ├── api/               # 统一 API 层
│   │   ├── client.ts      # Axios 客户端（带拦截器）
│   │   └── endpoints/     # API 端点模块（graph.ts, rag.ts）
│   └── hooks/             # 通用 Hooks（useAsync, useDebounce）
│
├── components/             # 共享组件库
│   ├── graph/             # 图形组件
│   │   ├── GraphViewer/   # Cytoscape.js 图形渲染（支持 grid/dagre/force）
│   │   ├── NodeDetailPanel/  # 节点详情抽屉
│   │   └── GraphToolbar/  # 图形工具栏
│   └── ui/                # UI 组件
│       ├── SearchBar/     # 节点搜索（支持类型过滤）
│       ├── FilterPanel/   # 高级过滤面板
│       ├── StatCard/      # 统计卡片
│       └── ChartCard/     # 图表容器
│
├── features/               # Feature 模块（新架构）
│   └── architecture/      # 架构探索器（其余页面仍在 pages/）
│
├── pages/                  # 页面：Dashboard, Repository, CallGraph, DataLineage,
│                           #        EventFlow, GraphQuery, ImpactAnalysis, Architecture
├── layouts/                # 布局组件（MainLayout, Sidebar, Header）
├── store/                  # 全局状态（Zustand）
├── types/                  # 全局类型定义
└── theme/                  # 设计系统
```

**`graph-engine/` 子系统（`src/graph-engine/`）：**

独立的高性能图渲染引擎，用于大规模图谱场景：
- `loader/GraphLoader.ts` — 批量按需加载，`BatchQueue` 控制并发
- `store/graphEngineStore.ts` — 独立 Zustand store，管理 LOD/视口/集群/过滤状态
- `types/` — 引擎专属类型：`EngineGraphNode`、`EngineGraphEdge`、LOD 层级、视口、集群

LOD（Level-of-Detail）：按缩放级别自动切换可见节点类型，减少渲染压力。后端 `name` 字段在引擎中映射为 `label`。`GraphCanvas`（`components/graph/GraphCanvas/`）是配套的 Cytoscape.js 渲染器。

**Zustand Store 说明（`src/store/`）：**

| Store | 文件 | 职责 |
|-------|------|------|
| `useGraphStore` | `graphStore.ts` | 图谱数据、选中节点、各视图（调用图/血缘/事件/模块/全图） |
| `usePipelineStore` | `pipelineStore.ts` | 分析任务状态、SSE 进度 |
| `useRepoStore` | `repoStore.ts` | 仓库列表 |

**使用新架构的组件：**

```tsx
// 导入共享组件
import {
  GraphViewer,
  NodeDetailPanel,
  GraphToolbar,
  SearchBar,
} from "@/components";

// 导入 API（新架构，推荐）
import { graphEndpoints, ragEndpoints } from "@/core/api";

// 导入 API（旧架构，兼容）
import { graphApi } from "@/api/graphApi";

// 导入 Hooks
import { useAsync, useDebounce } from "@/core/hooks";
```

**注意：** 前端存在两套 API 层：
- `src/core/api/` — 新架构，推荐用于新功能
- `src/api/graphApi.ts` — 旧架构，带缓存和类型转换，仍被现有页面使用

### TypeScript 限制

- `tsconfig.app.json` 开启了 `erasableSyntaxOnly: true`，**禁止使用 TypeScript `enum`**，改用 `const` 对象 + `as const`
- Ant Design `Card` 组件无 `icon` prop
- `GraphNode` 类型只有 `id`, `type`, `label`, `properties`，**没有 `name` 属性**

### Windows 开发注意事项

- Celery Worker 在 Windows 上需使用 `--pool=solo` 参数
- 启动脚本：`start-celery-worker.bat`（CMD）或 `start-celery-worker.ps1`（PowerShell）
- 虚拟环境激活：`venv\Scripts\activate`（非 `source venv/bin/activate`）

### 设计系统（Mission Control Dark）

颜色 token 定义在 `src/theme/index.ts`，CSS 变量在 `src/styles/global.css`：

| CSS 变量             | 用途           |
| -------------------- | -------------- |
| `--s-void #07090d`   | 最深背景       |
| `--a-cyan #00d4ff`   | 主强调色       |
| `--a-green #00f084`  | 成功/Service   |
| `--a-amber #ffc145`  | 警告/Event     |
| `--a-purple #b08eff` | Class/Database |

字体：Syne（UI/标题）+ IBM Plex Mono（数据/代码），通过 Google Fonts CDN 引入。

Ant Design 使用 `theme.darkAlgorithm` + 自定义 token，完整配置见 `src/theme/index.ts`。

### 添加新 Feature 模块

1. 在 `src/features/` 创建新目录
2. 使用 `src/components/` 中的共享组件
3. 使用 `src/core/api/` 中的 API 端点
4. 在 `src/App.tsx` 中添加路由
5. 参考 `src/features/architecture/` 作为模板

详细架构文档见 `code-graph-ui/ARCHITECTURE.md`。
