# AI 代码知识图谱系统

一个基于 Python 的智能代码分析系统，能够自动构建代码知识图谱，支持 GraphRAG 查询和语义检索。

## 功能特性

### 核心能力

1. **代码结构分析**
   - 多语言支持（Python、JavaScript、TypeScript、Java、Go、Rust）
   - 基于 Tree-sitter 的精确 AST 解析
   - 模块、类、函数的完整识别

2. **关系图谱构建**
   - 模块依赖关系（IMPORTS）
   - 函数调用图（CALLS）
   - 类继承关系（INHERITS/IMPLEMENTS）
   - 数据血缘追踪（READS/WRITES）
   - 事件流分析（EMITS/LISTENS）
   - 基础设施依赖（DEPENDS_ON）

3. **AI 语义增强**
   - LLM 驱动的代码语义理解
   - 自动生成函数/类摘要
   - 设计模式识别
   - 向量化嵌入（支持语义检索）

4. **GraphRAG 查询**
   - 自然语言代码问答
   - 向量检索 + 图遍历混合查询
   - 影响范围分析
   - 依赖链追踪

5. **多存储后端**
   - Neo4j 图数据库（可选）
   - 本地 JSON 存储（默认）
   - ChromaDB 向量存储

## 技术栈

- **语言**: Python 3.11+
- **Web 框架**: FastAPI
- **代码解析**: Tree-sitter
- **图计算**: NetworkX
- **图数据库**: Neo4j（可选）
- **向量存储**: ChromaDB
- **AI 模型**: Anthropic Claude / OpenAI GPT
- **数据验证**: Pydantic v2

## 快速开始

### 1. 安装依赖

**推荐：Python 3.9 或更高版本**

#### 选项 A：完整安装（包含所有功能）

```bash
cd code-graph-system
pip install -r requirements.txt
```

#### 选项 B：最小安装（仅核心功能，快速测试）

```bash
cd code-graph-system
pip install -r requirements-minimal.txt
```

#### 选项 C：分步安装（推荐用于调试）

```bash
# 1. 安装核心依赖
pip install fastapi uvicorn pydantic networkx gitpython python-dotenv rich

# 2. 安装 Tree-sitter（代码解析必需）
pip install tree-sitter tree-sitter-python

# 3. 可选：安装 AI 功能
pip install anthropic openai chromadb tiktoken

# 4. 可选：安装图数据库支持
pip install neo4j

# 5. 可选：安装其他语言支持
pip install tree-sitter-javascript tree-sitter-typescript tree-sitter-java
```

**注意事项：**
- 如果遇到 Tree-sitter 编译错误，请先安装系统依赖：
  - macOS: `brew install tree-sitter`
  - Ubuntu: `sudo apt-get install tree-sitter`
- ChromaDB 可能需要较新的 Python 版本（3.10+）
- 如果不需要 AI 功能，可以跳过 anthropic/openai/chromadb 的安装

### 2. 配置环境变量（可选）

创建 `.env` 文件：

```bash
# LLM 配置（启用 AI 功能时需要）
ANTHROPIC_API_KEY=your_api_key_here
# 或使用 OpenAI
# OPENAI_API_KEY=your_api_key_here
# LLM_PROVIDER=openai

# Neo4j 配置（可选）
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=password
```

### 3. 分析代码仓库

#### 命令行方式

```bash
# 基础分析（不使用 AI）
python scripts/run_analysis.py /path/to/your/repo

# 启用 AI 语义分析
python scripts/run_analysis.py /path/to/your/repo --enable-ai

# 指定语言
python scripts/run_analysis.py /path/to/your/repo --languages python javascript

# 详细日志
python scripts/run_analysis.py /path/to/your/repo -v
```

#### API 方式

启动服务器：

```bash
cd backend/api
python server.py
```

访问 API 文档：http://localhost:8000/docs

提交分析任务：

```bash
curl -X POST http://localhost:8000/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "repo_path": "/path/to/repo",
    "enable_ai": true
  }'
```

### 4. 查询图谱

#### GraphRAG 查询

```bash
curl -X POST http://localhost:8000/query \
  -H "Content-Type: application/json" \
  -d '{
    "query": "用户认证功能是如何实现的？",
    "repo_id": "your-graph-id",
    "limit": 10
  }'
```

#### 代码检索

```bash
curl "http://localhost:8000/search?query=authentication&node_type=Function&limit=5"
```

## 项目结构

```
code-graph-system/
├── backend/
│   ├── api/
│   │   └── server.py              # FastAPI 服务器
│   ├── parser/
│   │   ├── code_parser.py         # 代码解析器
│   │   └── language_loader.py     # 语言加载器
│   ├── scanner/
│   │   └── repo_scanner.py        # 仓库扫描器
│   ├── analyzer/
│   │   ├── module_detector.py     # 模块识别
│   │   ├── component_detector.py  # 组件识别
│   │   ├── call_graph_builder.py  # 调用图构建
│   │   ├── dependency_analyzer.py # 依赖分析
│   │   ├── data_lineage_analyzer.py # 数据血缘
│   │   ├── event_analyzer.py      # 事件流分析
│   │   └── infra_analyzer.py      # 基础设施分析
│   ├── graph/
│   │   ├── schema.py              # 数据模型定义
│   │   ├── graph_builder.py       # 图谱构建器
│   │   └── graph_repository.py    # 图谱存储
│   ├── ai/
│   │   ├── llm_client.py          # LLM 客户端
│   │   └── semantic_analyzer.py   # 语义分析器
│   ├── rag/
│   │   ├── vector_store.py        # 向量存储
│   │   └── graph_rag_engine.py    # GraphRAG 引擎
│   ├── pipeline/
│   │   └── analyze_repository.py  # 分析流水线
│   └── schemas/
│       └── graph_schema.json      # JSON Schema 定义
├── scripts/
│   └── run_analysis.py            # 命令行工具
├── requirements.txt               # Python 依赖
└── README.md                      # 本文档
```

## API 接口

### 分析接口

- `POST /analyze` - 提交代码仓库分析任务
- `GET /graphs` - 列出所有图谱
- `GET /graphs/{graph_id}` - 获取图谱详情
- `DELETE /graphs/{graph_id}` - 删除图谱

### 查询接口

- `POST /query` - GraphRAG 自然语言查询
- `GET /search` - 向量检索代码节点
- `GET /graphs/{graph_id}/nodes` - 获取节点列表
- `GET /graphs/{graph_id}/neighbors/{node_id}` - 获取邻居子图

### 健康检查

- `GET /health` - 服务健康状态

## 数据模型

### 节点类型

- **Repository**: 代码仓库根节点
- **Module**: 模块/文件节点
- **Component**: 类/接口/结构体
- **Function**: 函数/方法
- **DataEntity**: 数据实体（ORM 模型、数据库表）
- **Event**: 事件节点（消息、信号）
- **Infrastructure**: 基础设施（数据库、缓存、队列）

### 边类型

- **CONTAINS**: 包含关系（模块包含类、类包含方法）
- **IMPORTS**: 模块导入
- **CALLS**: 函数调用
- **INHERITS**: 类继承
- **IMPLEMENTS**: 接口实现
- **READS/WRITES**: 数据读写
- **EMITS/LISTENS**: 事件发布/订阅
- **DEPENDS_ON**: 依赖关系
- **DEPLOYED_ON**: 部署关系

## 配置说明

### LLM 提供商

支持以下 LLM 提供商：

1. **Anthropic Claude**（默认）
   - 设置 `ANTHROPIC_API_KEY` 环境变量
   - 默认模型：`claude-sonnet-4-6`

2. **OpenAI GPT**
   - 设置 `OPENAI_API_KEY` 和 `LLM_PROVIDER=openai`
   - 默认模型：`gpt-4o`

3. **本地 Ollama**
   - 设置 `LLM_PROVIDER=ollama`
   - 默认模型：`llama3.2`

### 存储配置

- **图谱存储**: `./data/graphs/` （JSON 文件）
- **向量存储**: `./data/chroma/` （ChromaDB）
- **Neo4j**: 可选，配置 `NEO4J_URI` 启用

## 使用示例

### Python API

```python
from backend.pipeline.analyze_repository import AnalysisPipeline
from backend.graph.schema import AnalysisRequest

# 创建流水线
pipeline = AnalysisPipeline()

# 分析仓库
request = AnalysisRequest(
    repo_path="/path/to/repo",
    enable_ai=True,
    languages=["python"]
)
response = pipeline.analyze(request)

print(f"图谱 ID: {response.repo_id}")
print(f"节点数: {response.stats.node_count}")
```

### GraphRAG 查询

```python
from backend.rag.graph_rag_engine import GraphRAGEngine
from backend.graph.schema import GraphQueryRequest

engine = GraphRAGEngine(graph_repo, vector_store)

request = GraphQueryRequest(
    query="数据库连接是如何管理的？",
    repo_id="your-graph-id",
    limit=10
)
response = engine.query(request)

print(response.answer)
print(f"置信度: {response.confidence}")
```

## 性能优化

- 大型仓库（>10万行）建议分批分析
- 启用增量更新模式（`--incremental`）
- AI 语义分析较慢，可先不启用
- Neo4j 适合超大规模图谱（>10万节点）

## 故障排查

### Tree-sitter 安装失败

```bash
# macOS
brew install tree-sitter

# Linux
sudo apt-get install tree-sitter
```

### ChromaDB 初始化错误

```bash
pip install --upgrade chromadb
```

### LLM API 调用失败

检查 API Key 配置和网络连接。

## 开发计划

- [ ] 支持更多编程语言（C++、C#、Ruby）
- [ ] Web UI 可视化界面
- [ ] 实时增量更新
- [ ] 分布式分析支持
- [ ] 代码变更影响分析
- [ ] CI/CD 集成

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！

## 联系方式

- 项目地址: https://github.com/your-org/code-graph-system
- 文档: https://docs.code-graph-system.dev
