# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

AI 代码知识图谱系统，基于 Python 构建，能够解析多语言代码仓库并生成结构化的知识图谱，支持 GraphRAG 自然语言查询和语义检索。

## 开发环境

所有命令在 `code-graph-system/` 目录下执行：

```bash
cd code-graph-system
python3 -m venv venv
source venv/bin/activate
pip install -r requirements-minimal.txt   # 快速启动（无 AI/向量/Neo4j）
pip install -r requirements.txt           # 完整功能
```

## 常用命令

```bash
# 以下所有命令均需在 code-graph-system/ 根目录下执行

# 启动 API 服务器（访问 http://localhost:8000/docs）
python -m uvicorn backend.api.server:app --host 0.0.0.0 --port 8000 --reload

# 命令行分析代码仓库（直接使用 pipeline 模块）
python -m backend.pipeline.analyze_repository /path/to/repo
python -m backend.pipeline.analyze_repository /path/to/repo --enable-ai
python -m backend.pipeline.analyze_repository /path/to/repo --languages python typescript
python -m backend.pipeline.analyze_repository /path/to/repo --json   # JSON 输出

# 运行测试（注意：test_basic.py 中部分测试仍依赖旧 schema，会 fail）
pytest backend/tests/test_basic.py -v
pytest backend/tests/test_basic.py::test_language_loader -v

# 检查依赖状态
python scripts/check_deps.py

# Celery Worker（需先启动 Redis）
celery -A backend.scheduler.celery_app worker --loglevel=info
celery -A backend.scheduler.celery_app worker --beat --loglevel=info  # Worker + Beat
```

## 架构概览

### 核心数据流

```
代码仓库
  → RepoScanner       扫描文件 + Git 信息
  → CodeParser        Tree-sitter AST 解析
  → [Analyzers]       各类分析器（见流水线步骤）
  → GraphBuilder      合并 → BuiltGraph（含 PageRank/度指标）
  → GraphRepository   持久化 JSON / Neo4j
  → VectorStore       向量化写入 ChromaDB（可选）
  → GraphRAGEngine    向量检索 + 图展开 + LLM 回答（查询时用）
```

### 分析流水线（`backend/pipeline/analyze_repository.py`）

`AnalysisPipeline.analyze(repo_path, *, repo_name, languages, enable_ai, enable_rag)` 按顺序执行 13 步，返回 `AnalysisResult`：

| 步骤 | 类 | 说明 |
|------|----|------|
| 1 | `RepoScanner` | 扫描文件，识别语言 |
| 2 | `CodeParser` | AST 解析，提取类/函数/调用 |
| 3 | `ModuleDetector` | 目录级模块节点 + contains 边 |
| 4 | `ComponentDetector` | 组件/类/函数节点 |
| 5 | `DependencyAnalyzer` | 模块/服务依赖 + 循环依赖检测 |
| 6 | `CallGraphBuilder` | 函数调用图（calls 边） |
| 7 | ~~DataLineageAnalyzer~~ | **跳过**（依赖旧 schema，待迁移） |
| 8 | `EventAnalyzer` | Kafka/RabbitMQ 事件发布/订阅 |
| 9 | `InfraAnalyzer` | Dockerfile/K8s/Terraform 基础设施 |
| 10 | `SemanticAnalyzer` | LLM 语义标注（`enable_ai=True` 时运行） |
| 11 | `GraphBuilder` | 合并所有图谱，计算图论指标 |
| 12 | `GraphRepository` | 持久化 JSON / Neo4j |
| 13 | `GraphRAGEngine` | 向量化节点到 ChromaDB（`enable_rag=True` 时运行） |

### 数据模型（双 schema 并存）

**新 schema**（`backend/graph/graph_schema.py`）— 当前流水线和所有新代码使用：
- `GraphNode(id, type, name, properties)` — 通用节点
- `GraphEdge(from_, to, type, properties)` — 通用边（`from_` 是 Python 属性名，序列化为 `"from"`）
- `NodeType` / `EdgeType` — 枚举定义所有合法类型
- `GraphSchema.validate_graph()` — 三层验证（节点/边/引用完整性）

**旧 schema**（`backend/graph/schema.py`）— 仅 `test_basic.py` 和 `scripts/run_analysis.py` 仍在使用，**不要在新代码中引入**：
- `NodeBase` 及其子类：`FunctionNode`、`ModuleNode`、`ComponentNode` 等
- `CodeGraph`、`AnalysisRequest`、`GraphQueryRequest`

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

### API 端点（`backend/api/server.py`）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/analyze/repository` | 全量分析，返回 graph_id + 统计 |
| GET  | `/graph` | 无 `graph_id` 返回列表；有则返回节点+边 |
| GET  | `/callgraph` | Function/API 节点 + calls 边 |
| GET  | `/lineage` | depends_on / reads / writes / produces / consumes 边 |
| GET  | `/services` | Service / Cluster / Database 节点 |
| POST | `/query` | GraphRAG 自然语言查询 |

四个全局单例通过 `lifespan` 管理：`_graph_repo`、`_vector_store`、`_pipeline`、`_rag_engine`。

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

| 路径 | 内容 |
|------|------|
| `data/graphs/` | 图谱 JSON 文件（已加入 .gitignore） |
| `data/graphs/index.json` | 所有图谱摘要索引 |
| `data/chroma/` | ChromaDB 向量索引（已加入 .gitignore） |

## 环境变量

| 变量 | 说明 |
|------|------|
| `ANTHROPIC_API_KEY` | 启用 SemanticAnalyzer 时必须 |
| `LLM_PROVIDER` | `anthropic`（默认）/ `openai` / `ollama` |
| `NEO4J_URI` | 可选，如 `bolt://localhost:7687` |
| `CELERY_BROKER_URL` | 默认 `redis://localhost:6379/0` |
| `CELERY_RESULT_BACKEND` | 默认 `redis://localhost:6379/1` |

## 添加新 Analyzer

1. 在 `backend/analyzer/` 创建新模块，实现 `analyze(...)` 方法，返回带 `nodes`/`edges` 属性的 graph 对象（duck typing）
2. 在 `AnalysisPipeline.analyze()` 中按步骤顺序调用，通过 `builder.merge_graph(new_graph)` 合并到主图
3. 将统计写入 `step_stats[f"{N}_<name>"]`

`GraphBuilder.merge_graph()` 通过 duck typing 自动提取 `GraphNode` / `GraphEdge`；后 merge 的同 ID 节点覆盖前者。
