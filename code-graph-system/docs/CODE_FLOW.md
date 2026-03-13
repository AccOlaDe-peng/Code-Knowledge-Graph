# 代码知识图谱系统 - 代码流程文档

## 系统概述

本系统是一个 AI 代码知识图谱系统，基于 Python 构建，能够解析多语言代码仓库并生成结构化的知识图谱，支持 GraphRAG 自然语言查询和语义检索。

## 整体架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                         用户请求入口                                  │
│   ┌──────────────────┐    ┌─────────────────────────────────────┐  │
│   │  命令行 CLI       │    │         FastAPI Server              │  │
│   │  (analyze_repo)  │    │         (server.py)                 │  │
│   └────────┬─────────┘    └────────────────┬────────────────────┘  │
│            │                               │                         │
│            └───────────┬───────────────────┘                         │
│                        ▼                                              │
│            ┌───────────────────────┐                                 │
│            │    AnalysisPipeline    │  ← 主分析流水线 (16步)         │
│            │   (analyze_repository) │                                 │
│            └───────────┬────────────┘                                 │
│                        │                                              │
│            ┌───────────▼────────────┐                                 │
│            │     GraphPipeline      │  ← 新版流水线 (5步)           │
│            │    (graph_pipeline)    │                                 │
│            └────────────────────────┘                                 │
└─────────────────────────────────────────────────────────────────────┘
```

## 核心数据流

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

---

## 一、API 服务层 (server.py)

### 1.1 启动流程

**文件**: `backend/api/server.py`

```python
# 启动时初始化全局单例
_graph_repo     = GraphRepository()      # 图谱持久化
_vector_store   = VectorStore()          # ChromaDB 向量存储
_pipeline       = AnalysisPipeline()     # 16步旧流水线
_rag_engine     = GraphRAGEngine()       # RAG 引擎
_graph_pipeline = GraphPipeline()         # 5步新流水线
_graph_storage  = GraphStorage()         # 图谱存储
```

### 1.2 API 端点一览

| 方法   | 路径                  | 功能                                   |
| ------ | --------------------- | -------------------------------------- |
| POST   | `/analyze/repository` | 分析仓库（统一走 GraphPipeline）       |
| POST   | `/analyze/upload-zip` | 上传 ZIP 分析                          |
| POST   | `/analyze/graph`      | GraphPipeline 直接分析，返回完整 graph |
| GET    | `/graph`              | 列出图谱 / 获取图谱详情                |
| GET    | `/graph/data`         | 获取完整 JSON Graph                    |
| GET    | `/graph/call`         | 获取调用子图（calls 边）               |
| GET    | `/graph/module`       | 获取模块结构子图                       |
| GET    | `/graph/summary`      | 获取图谱 LOD-0 摘要                    |
| GET    | `/graph/export`       | 导出标准 JSON Graph                    |
| DELETE | `/graph/{graph_id}`   | 删除图谱                               |
| GET    | `/lineage`            | 依赖血缘图                             |
| GET    | `/events`             | 事件流图                               |
| GET    | `/services`           | 基础设施服务图                         |
| POST   | `/query`              | GraphRAG 自然语言查询                  |
| GET    | `/health`             | 健康检查                               |

### 1.3 核心请求处理流程

````
POST /analyze/repository
  │
  ├─ 1. 判断是否为 Git URL
  │     ├─ 是 → git clone 到临时目录
  │     └─ 否 → 直接使用本地路径
  │
  ├─ 2. 调用 GraphPipeline.run()
  │     └─ 返回 GraphPipelineResult
  │
  ├─ 3. (可选) RAG 向量化
  │     └─ rag_engine.embed_nodes()
  │
  └─ 4. 返回 AnalyzeResponse
        { graph_id, node_count, edge_count, ... }
``` |
| GET | `/callgraph` | 函数调用图

---

## 二、分析流水线

系统包含两套并行的流水线：

### 2.1 AnalysisPipeline（旧版 16 步）

**文件**: `backend/pipeline/analyze_repository.py`

````

步骤 1-9: 静态分析（必选）
步骤 10-13: AI 分析（可选 enable_ai=True）
步骤 14-16: 图构建 + 持久化 + 向量化

```

| 步骤 | 类 | 功能 |
|------|-----|------|
| 1 | `RepoScanner` | 扫描仓库文件，识别语言，获取 Git 信息 |
| 2 | `CodeParser` | Tree-sitter AST 解析，提取类/函数/调用 |
| 3 | `ModuleDetector` | 目录级模块节点 + File 节点 + contains 边 |
| 4 | `ComponentDetector` | 组件/类/函数节点 + implements/contains 边 |
| 5 | `DependencyAnalyzer` | 模块/服务依赖 + 循环依赖检测 |
| 6 | `CallGraphBuilder` | 函数调用图（calls 边） |
| 7 | `EventAnalyzer` | Kafka/RabbitMQ 事件发布/订阅 |
| 8 | `InfraAnalyzer` | Dockerfile/K8s/Terraform 基础设施 |
| 9 | `RepoSummaryBuilder` | 构建 AI 分析所需的仓库摘要 |
| 10 | `AIArchitectureAnalyzer` | LLM 识别架构模式，生成 Layer 节点 |
| 11 | `AIServiceDetector` | LLM 识别微服务边界，补全 Service 节点 |
| 12 | `AIBusinessFlowAnalyzer` | LLM 识别业务流程，生成 Flow 节点 |
| 13 | `AIDataLineageAnalyzer` | LLM 追踪数据血缘，生成 reads/writes 边 |
| 14 | `GraphBuilder` | 合并所有图谱，计算 PageRank/度指标 |
| 15 | `GraphRepository` | 持久化为 JSON（可选 Neo4j 双写） |
| 16 | `GraphRAGEngine` | 向量化节点到 ChromaDB |

### 2.2 GraphPipeline（新版 5 步）

**文件**: `backend/pipeline/graph_pipeline.py`

```

Step 1: scan_repo — RepoScanner 扫描仓库
Step 2: parse_code — CodeParser AST 解析
Step 3: ai_analyze — LLM 逐文件分析（可选）
Step 4: build_graph — CodeGraphBuilder 合并图
Step 5: export_graph — 持久化 graph.json

````

**特点**:
- AI 分析以**文件为单位**逐一调用 LLM
- 输出直接为标准 `{"nodes": [], "edges": []}` 格式
- 不依赖 NetworkX / ChromaDB（最小依赖环境）

---

## 三、核心模块详解

### 3.1 RepoScanner（仓库扫描）

**文件**: `backend/scanner/repo_scanner.py`

```python
class RepoScanner:
    def scan(self, path: Path, languages=None) -> ScanResult:
        # 1. 遍历目录，识别文件语言
        # 2. 过滤 .git/node_modules 等目录
        # 3. 获取 Git 提交信息
        # 返回: ScanResult { files, total_files, language_stats, git_commit }
````

### 3.2 CodeParser（代码解析）

**文件**: `backend/parser/code_parser.py`

```python
class CodeParser:
    def scan_repository(self, path: Path, languages=None) -> ParseResult:
        # 1. 使用 Tree-sitter 解析每个支持的文件
        # 2. 提取:
        #    - classes: 类名、父类、方法列表
        #    - functions: 函数名、参数、调用关系
        #    - calls: 调用关系（caller → callee）
        #    - imports: 导入模块
        # 返回: ParseResult { files, classes, functions, calls, imports }
```

### 3.3 分析器模块

| 模块                 | 文件                                      | 功能                                   |
| -------------------- | ----------------------------------------- | -------------------------------------- |
| `ModuleDetector`     | `backend/analyzer/module_detector.py`     | 生成 Module/File 节点和 contains 边    |
| `ComponentDetector`  | `backend/analyzer/component_detector.py`  | 生成 Class/Function 节点               |
| `DependencyAnalyzer` | `backend/analyzer/dependency_analyzer.py` | 分析 import/require 依赖，检测循环依赖 |
| `CallGraphBuilder`   | `backend/analyzer/call_graph_builder.py`  | 构建函数调用图                         |
| `EventAnalyzer`      | `backend/analyzer/event_analyzer.py`      | 分析 Kafka/RabbitMQ 事件               |
| `InfraAnalyzer`      | `backend/analyzer/infra_analyzer.py`      | 分析 Docker/K8s/Terraform              |

### 3.4 GraphBuilder（图构建）

**文件**: `backend/graph/graph_builder.py`

```python
class GraphBuilder:
    def add_node(self, node: GraphNode): ...
    def merge_graph(self, graph): ...  # 合并其他图的节点和边
    def build(self) -> BuiltGraph:      # 计算 PageRank 和度中心性
        # 1. 合并所有节点（去重，后合并的覆盖先的）
        # 2. 合并所有边
        # 3. 使用 NetworkX 计算:
        #    - PageRank 分数
        #    - 入度/出度
        # 返回 BuiltGraph { nodes, edges, meta, metrics }
```

### 3.5 GraphRepository（图谱持久化）

**文件**: `backend/graph/graph_repository.py`

```python
class GraphRepository:
    def save(self, built: BuiltGraph, repo_name: str) -> graph_id:
        # 1. 写入 JSON 文件到 data/graphs/<graph_id>.json
        # 2. (可选) 写入 Neo4j
        # 3. 更新 index.json

    def load(self, graph_id: str) -> BuiltGraph: ...

    def list_graphs(self) -> list[dict]: ...  # 返回所有图谱摘要
```

### 3.6 VectorStore（向量存储）

**文件**: `backend/rag/vector_store.py`

- 使用 ChromaDB 存储节点向量
- Collection 命名: `kg_{graph_id}`
- 向量化目标: Function, Component, API 节点

### 3.7 GraphRAGEngine（RAG 引擎）

**文件**: `backend/rag/graph_rag_engine.py`

```python
class GraphRAGEngine:
    def embed_nodes(self, graph_id: str, nodes: list[GraphNode]):
        # 1. 提取节点文本（函数签名、类名、文件路径）
        # 2. 调用 embedding API 向量化
        # 3. 存入 ChromaDB

    def rag_query(self, graph_id: str, question: str, ...):
        # 1. 向量检索相似节点
        # 2. 图展开（根据节点 ID 扩展邻居）
        # 3. 构建 prompt 调用 LLM 生成回答
        # 返回: { question, answer, nodes, edges, sources, confidence }
```

---

## 四、数据模型

### 4.1 节点类型（NodeType）

**静态分析**:

- `Repository` - 代码仓库根节点
- `Module` - 目录级模块
- `File` - 源代码文件
- `Class` - 类定义
- `Function` - 函数/方法
- `Component` - 组件
- `API` - API 端点
- `DataObject` - 数据对象
- `Table` - 数据库表
- `Event` - 事件
- `Topic` - 消息 Topic
- `Pipeline` - 数据管道
- `Cluster` - K8s 集群
- `Database` - 数据库实例

**AI 分析**（步骤 10-13）:

- `Layer` - 架构层级
- `Flow` / `BusinessFlow` - 业务流程
- `Domain` - 领域
- `BoundedContext` - 限界上下文
- `DomainEntity` - 领域实体

### 4.2 边类型（EdgeType）

| 边类型                  | 说明                              |
| ----------------------- | --------------------------------- |
| `contains`              | 包含关系（module → file → class） |
| `imports`               | 导入关系（file → module）         |
| `calls`                 | 函数调用                          |
| `reads`                 | 读数据                            |
| `writes`                | 写数据                            |
| `depends_on`            | 依赖关系                          |
| `produces` / `consumes` | 事件发布/订阅                     |
| `deployed_on`           | 部署关系                          |

### 4.3 数据结构

```python
# GraphNode
{
    "id": "function:service.user.create",
    "type": "Function",
    "name": "create",
    "properties": {
        "file": "service/user.py",
        "line": 42,
        "language": "python"
    }
}

# GraphEdge
{
    "from": "function:service.user.create",
    "to": "function:service.db.save",
    "type": "calls"
}
```

---

## 五、调用示例

### 5.1 命令行分析

```bash
# 进入项目目录
cd code-graph-system

# 基础分析
python -m backend.pipeline.analyze_repository /path/to/repo

# 启用 AI 分析
python -m backend.pipeline.analyze_repository /path/to/repo --enable-ai

# 启用 RAG 向量化
python -m backend.pipeline.analyze_repository /path/to/repo --enable-ai --enable-rag

# 限定语言
python -m backend.pipeline.analyze_repository /path/to/repo --languages python typescript
```

### 5.2 API 调用

```bash
# 启动服务
python -m uvicorn backend.api.server:app --reload

# 分析仓库
curl -X POST http://localhost:8000/analyze/repository \
  -H "Content-Type: application/json" \
  -d '{"repo_path": "/path/to/repo", "enable_ai": false}'

# 查询图谱
curl "http://localhost:8000/graph?graph_id=my-project"

# RAG 查询
curl -X POST http://localhost:8000/query \
  -H "Content-Type: application/json" \
  -d '{"graph_id": "my-project", "question": "登录功能如何实现？"}'
```

### 5.3 Python 代码调用

```python
from backend.pipeline.analyze_repository import AnalysisPipeline

pipeline = AnalysisPipeline()
result = pipeline.analyze(
    "/path/to/repo",
    enable_ai=True,
    enable_rag=True,
)

print(result.summary())
# 仓库: my-repo  (/path/to/repo)
# 图谱 ID: my-repo
# 节点数: 1234
# 边数: 5678
# 耗时: 12.34s
```

---

## 六、存储结构

| 路径                     | 内容              |
| ------------------------ | ----------------- |
| `data/graphs/`           | 图谱 JSON 文件    |
| `data/graphs/index.json` | 所有图谱摘要索引  |
| `data/chroma/`           | ChromaDB 向量索引 |
| `data/ai_analysis/`      | AI 分析结果缓存   |

---

## 七、流程图

### 7.1 完整分析流程

```
┌──────────────┐
│   用户请求   │
└──────┬───────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│                    API Server (server.py)                    │
│  ┌─────────────┐    ┌──────────────┐    ┌─────────────────┐  │
│  │ Git Clone  │    │ ZIP Extract  │    │  Local Path    │  │
│  └──────┬──────┘    └──────┬───────┘    └───────┬────────┘  │
└─────────┼──────────────────┼────────────────────┼───────────┘
          │                  │                    │
          ▼                  ▼                    ▼
┌──────────────────────────────────────────────────────────────┐
│                 GraphPipeline (5 步)                          │
│                                                              │
│  ┌─────────┐   ┌──────────┐   ┌─────────┐   ┌─────────┐    │
│  │ Step 1  │ → │  Step 2  │ → │ Step 3  │ → │ Step 4  │    │
│  │ 扫描    │   │ AST 解析  │   │ AI 分析 │   │ 构建图  │    │
│  └────┬────┘   └────┬─────┘   └────┬────┘   └────┬────┘    │
│       │             │              │             │          │
│       ▼             ▼              ▼             ▼          │
│  ┌─────────┐   ┌──────────┐   ┌─────────┐   ┌─────────┐     │
│  │ Repo    │   │ Parse    │   │ LLM     │   │ Code    │     │
│  │ Scanner │   │ Result   │   │ per-file│   │ Graph   │     │
│  └─────────┘   └──────────┘   └─────────┘   │ Builder │     │
│                                               └────┬────┘     │
└────────────────────────────────────────────────────┼──────────┘
                                                   │
                                                   ▼
┌──────────────────────────────────────────────────────────────┐
│                    Step 5: Export                             │
│  ┌─────────────────┐    ┌─────────────────────────────┐    │
│  │ data/graphs/    │    │  GraphRepository             │    │
│  │ <graph_id>.json│    │  (BuiltGraph 兼容格式)       │    │
│  └────────┬────────┘    └──────────────┬──────────────┘    │
└───────────┼───────────────────────────┼────────────────────┘
            │                           │
            ▼                           ▼
┌─────────────────────────┐    ┌──────────────────────────────┐
│ GET /graph/data         │    │  GET /graph, /callgraph,    │
│ GET /graph/call         │    │  /lineage, /events, etc.    │
└─────────────────────────┘    └──────────────────────────────┘
```

### 7.2 RAG 查询流程

```
┌──────────────┐
│  用户问题    │
└──────┬───────┘
       │
       ▼
┌─────────────────────────────────────┐
│      GraphRAGEngine.rag_query()     │
│                                     │
│  1. 向量检索                        │
│     └─ ChromaDB.search()            │
│                                     │
│  2. 图展开                          │
│     └─ GraphRepository.query_       │
│        neighbors()                  │
│                                     │
│  3. LLM 生成                        │
│     └─ 构建 prompt → LLM API        │
│                                     │
└──────┬──────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│  返回: { question, answer,         │
│         nodes, edges, sources,     │
│         confidence }               │
└─────────────────────────────────────┘
```

---

## 八、环境变量

| 变量                    | 说明                                               |
| ----------------------- | -------------------------------------------------- |
| `ANTHROPIC_API_KEY`     | Anthropic Claude API Key（启用 AI 分析）           |
| `OPENAI_API_KEY`        | OpenAI API Key（可选）                             |
| `LLM_PROVIDER`          | `anthropic`（默认）/ `openai` / `ollama`           |
| `NEO4J_URI`             | Neo4j 连接地址（可选）                             |
| `CELERY_BROKER_URL`     | Redis URL（可选，默认 `redis://localhost:6379/0`） |
| `CELERY_RESULT_BACKEND` | Redis URL（可选）                                  |
