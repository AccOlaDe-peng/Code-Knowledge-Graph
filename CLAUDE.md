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
pip install -r requirements-minimal.txt   # 快速启动
# 或
pip install -r requirements.txt           # 完整功能
```

## 常用命令

```bash
# 以下所有命令均需在 code-graph-system/ 根目录下执行

# 启动 API 服务器（访问 http://localhost:8000/docs）
python -m uvicorn backend.api.server:app --host 0.0.0.0 --port 8000 --reload

# 命令行分析代码仓库
python scripts/run_analysis.py /path/to/repo
python scripts/run_analysis.py /path/to/repo --enable-ai   # 启用 AI 语义增强
python scripts/run_analysis.py /path/to/repo --languages python javascript

# 运行测试
pytest backend/tests/test_basic.py -v

# 运行单个测试
pytest backend/tests/test_basic.py::test_code_parser -v

# 检查依赖状态
python scripts/check_deps.py
```

## 架构概览

### 核心数据流

```
代码仓库 → RepoScanner → CodeParser → 各类 Analyzer → GraphBuilder → GraphRepository
                                                                    ↓
                                                             VectorStore（可选）
                                                                    ↓
                                                          GraphRAGEngine（查询）
```

### 分析流水线（`backend/pipeline/analyze_repository.py`）

`AnalysisPipeline.analyze()` 是整个系统的核心入口，按顺序执行：
1. `RepoScanner` - 扫描文件，识别语言，获取 Git 信息
2. `CodeParser` - 用 Tree-sitter 解析 AST，提取函数/类/导入
3. `ModuleDetector` - 识别模块边界，生成 IMPORTS 边
4. `ComponentDetector` - 识别类/接口，生成 CONTAINS/INHERITS 边
5. `CallGraphBuilder` - 构建函数调用关系 CALLS 边
6. `DataLineageAnalyzer` - 追踪数据读写关系 READS/WRITES 边
7. `EventAnalyzer` - 分析事件发布/订阅 EMITS/LISTENS 边
8. `DependencyAnalyzer` + `InfraAnalyzer` - 外部依赖和基础设施分析
9. `GraphBuilder` - 汇总所有节点和边，构建 `CodeGraph` 对象
10. `GraphRepository` - 持久化为 JSON（`data/graphs/`）
11. `VectorStore` - 可选，写入 ChromaDB（`data/chroma/`）

### 数据模型（`backend/graph/schema.py`）

所有节点继承自 `NodeBase`，关键节点类型：`RepositoryNode`、`ModuleNode`、`ComponentNode`、`FunctionNode`、`DataEntityNode`、`EventNode`、`InfrastructureNode`。

边统一使用 `EdgeBase`，通过 `EdgeType` 枚举区分关系类型（`CALLS`、`IMPORTS`、`INHERITS` 等）。

`CodeGraph` 是顶层容器，含 `nodes: list[NodeBase]`、`edges: list[EdgeBase]`，`stats` 自动统计。

### GraphRAG 查询（`backend/rag/`）

- `VectorStore` 封装 ChromaDB，将节点 `embedding` 字段存储为向量索引
- `GraphRAGEngine` 混合向量检索和图遍历：先向量搜索候选节点，再沿图边扩展上下文，最后调用 LLM 生成答案

### API 层（`backend/api/server.py`）

FastAPI 应用，通过 `lifespan` 管理 `GraphRepository`、`VectorStore`、`AnalysisPipeline`、`GraphRAGEngine` 四个全局单例。

## 存储

- 图谱数据：`data/graphs/`（JSON 文件，已加入 .gitignore）
- 向量索引：`data/chroma/`（ChromaDB，已加入 .gitignore）
- 默认不需要 Neo4j，配置 `NEO4J_URI` 环境变量后自动切换

## 环境变量

复制 `.env.example` 为 `.env`，关键配置：

| 变量 | 说明 |
|------|------|
| `ANTHROPIC_API_KEY` | 启用 AI 功能时必须 |
| `LLM_PROVIDER` | `anthropic`（默认）/ `openai` / `ollama` |
| `NEO4J_URI` | 可选，配置后使用 Neo4j 替代 JSON 存储 |

## 添加新 Analyzer 的方式

1. 在 `backend/analyzer/` 创建新模块，实现 `analyze(parsed_files, ...)` 方法，返回 `(nodes, edges)` 元组
2. 在 `backend/pipeline/analyze_repository.py` 的 `AnalysisPipeline.analyze()` 中调用，并将返回的节点/边通过 `builder.add_nodes()` / `builder.add_edges()` 注册
