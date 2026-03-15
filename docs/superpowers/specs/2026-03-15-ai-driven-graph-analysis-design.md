# AI 驱动的极简分析流水线设计文档

**版本**: 2.0
**日期**: 2026-03-15
**状态**: 待审批

---

## 修订历史

| 版本 | 日期 | 修改内容 |
|------|------|---------|
| 1.0 | 2026-03-15 | 初始版本 - 渐进式演进策略 |
| 1.1 | 2026-03-15 | 根据审查意见补充：迁移策略、IntermediateGraph 定义、缺失类型、P0 策略概述 |
| 2.0 | 2026-03-15 | **重大重构** - 完全删除 AST 分析，采用极简 AI 驱动架构 |

---

## 1. 概述

### 1.1 背景

当前 Code-Knowledge-Graph 系统采用**静态分析驱动**的方式，通过 Tree-sitter AST 解析代码，生成知识图谱。此方式存在以下局限：

- 无法理解代码语义和业务逻辑
- 难以识别高层架构模式（分层、微服务边界）
- 无法推断数据血缘和转换关系
- 需要维护多语言 Tree-sitter grammar，维护成本高

### 1.2 目标

将系统从**静态分析驱动**完全转变为 **AI 驱动**，实现：

1. **更深入的语义理解** - AI 能理解业务意图、设计模式、领域概念
2. **简化架构** - 从 13 步流水线简化为 6 步
3. **降低维护成本** - 不再需要维护 Tree-sitter grammar

### 1.3 关键决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| AST 分析 | **完全删除** | 用户需求，AI 主导分析，简化架构 |
| 流水线步骤 | **6 步** | 精简流程，聚焦核心功能 |
| 分析模式 | **分层分析** | 仓库扫描 → 模块级并行 → 跨模块整合 |
| 模块划分 | **AI 自动识别** | 更准确地反映代码真实结构 |
| 节点 ID | **启发式稳定** | `文件路径:名称` 格式，支持增量分析 |
| LLM 支持 | **多 Provider** | Anthropic / OpenAI / MiniMax / Ollama |

---

## 2. 系统架构

### 2.1 架构总览

**重构前（13 步）：**
```
RepoScanner → CodeParser → ModuleDetector → ComponentDetector →
DependencyAnalyzer → CallGraphBuilder → EventAnalyzer → InfraAnalyzer →
RepoSummaryBuilder → AgentOrchestrator → GraphBuilder → GraphRepository → GraphRAGEngine
```

**重构后（6 步）：**
```
RepoScanner → AIModuleScanner → AICodeAnalyzer → GraphBuilder → GraphRepository → GraphRAGEngine
```

### 2.2 架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│           AI-Driven Minimal Analysis Pipeline (6 Steps)                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │  Step 1: RepoScanner                                                │ │
│  │  • 扫描文件列表                                                      │ │
│  │  • 识别语言分布                                                      │ │
│  │  • 获取 Git commit SHA                                              │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                    │                                     │
│                                    ▼                                     │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │  Step 2: AIModuleScanner                                            │ │
│  │  • AI 分析目录结构                                                   │ │
│  │  • AI 识别模块边界                                                   │ │
│  │  • 输出: ModulePlan (modules[], architecture_hints)                │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                    │                                     │
│                                    ▼                                     │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │  Step 3: AICodeAnalyzer (并行模块分析)                              │ │
│  │                                                                     │ │
│  │   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐             │ │
│  │   │  Module A   │   │  Module B   │   │  Module C   │             │ │
│  │   │  Agent      │   │  Agent      │   │  Agent      │  ← 并行     │ │
│  │   └─────────────┘   └─────────────┘   └─────────────┘             │ │
│  │                                                                     │ │
│  │  • 提取节点: Function, Class, API, Event, DataObject 等           │ │
│  │  • 提取边: calls, implements, depends_on, produces, consumes 等   │ │
│  │  • 跨模块整合: 识别模块间依赖                                       │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                    │                                     │
│                                    ▼                                     │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │  Step 4: GraphBuilder                                               │ │
│  │  • 合并所有模块图谱                                                  │ │
│  │  • 计算 PageRank / 度指标                                           │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                    │                                     │
│                                    ▼                                     │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │  Step 5: GraphRepository                                            │ │
│  │  • 持久化 JSON / Neo4j                                              │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                    │                                     │
│                                    ▼                                     │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │  Step 6: GraphRAGEngine (可选)                                      │ │
│  │  • 向量化节点到 ChromaDB                                            │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 组件职责

### 3.1 Step 1: RepoScanner（保留，精简）

**输入**: 仓库路径

**输出**: `ScanResult`
```python
@dataclass
class ScanResult:
    files: list[FileInfo]      # 文件路径、语言、大小
    languages: dict[str, int]  # 语言分布
    git_commit: str            # 当前 commit SHA
```

**职责**: 仅扫描文件列表，不做解析。

---

### 3.2 Step 2: AIModuleScanner（新建）

**输入**: `ScanResult`

**输出**: `ModulePlan`
```python
@dataclass
class ModulePlan:
    modules: list[ModuleInfo]
    architecture_hints: dict   # 分层、边界上下文等

@dataclass
class ModuleInfo:
    id: str          # 模块 ID
    name: str        # 模块名
    files: list[str] # 包含的文件路径
    purpose: str     # AI 推断的模块职责
```

**职责**: AI 分析目录结构 + 文件内容采样，自动划分模块边界。

---

### 3.3 Step 3: AICodeAnalyzer（改造 AgentOrchestrator）

**输入**: `ScanResult` + `ModulePlan`

**输出**: `AnalysisGraph`
```python
@dataclass
class AnalysisGraph:
    nodes: list[GraphNode]
    edges: list[GraphEdge]
```

**内部流程**:
1. **并行模块分析** — 每个 Module 分配一个 AI Agent
2. **节点提取** — Function, Class, API, Event, DataObject 等
3. **边提取** — calls, implements, depends_on, produces, consumes 等
4. **跨模块整合** — 识别模块间依赖

**并行策略**:

| 仓库规模 | 模块数量 | 单模块 Token 上限 | 并发数 |
|----------|----------|-------------------|--------|
| 小型 (<100 文件) | 1-3 | 32K | 3 |
| 中型 (100-500 文件) | 5-15 | 16K | 5 |
| 大型 (>500 文件) | 15+ | 8K | 10 |

---

### 3.4 Step 4-6: GraphBuilder / GraphRepository / GraphRAGEngine

保持不变，合并图谱、计算指标、持久化、向量化。

---

## 4. 节点类型与边类型

### 4.1 保留的节点类型

| 类型 | 说明 | AI 提取方式 |
|------|------|-------------|
| `Repository` | 仓库根节点 | 系统生成 |
| `Module` | 模块 | AI 识别边界 |
| `File` | 文件 | RepoScanner 扫描 |
| `Class` | 类/接口 | AI 从代码识别 |
| `Function` | 函数/方法 | AI 从代码识别 |
| `API` | API 端点 | AI 从路由/装饰器识别 |
| `Event` | 事件 | AI 从消息队列代码识别 |
| `DataObject` | 数据实体 | AI 从模型/Schema 识别 |
| `Service` | 服务 | AI 从配置/部署文件识别 |
| `Database` | 数据库 | AI 从配置/ORM 识别 |

### 4.2 新增的节点类型（AI 语义增强）

| 类型 | 说明 | 示例 |
|------|------|------|
| `Domain` | 领域概念 | 用户认证、订单管理 |
| `BoundedContext` | 边界上下文 | 支付域、库存域 |
| `BusinessFlow` | 业务流程 | 用户注册流程、订单结算流程 |
| `Layer` | 架构层 | 表示层、业务层、数据层 |

### 4.3 边类型

| 类型 | 说明 | 节点组合示例 |
|------|------|-------------|
| `contains` | 包含关系 | Repository→Module, Module→File |
| `calls` | 调用关系 | Function→Function |
| `implements` | 实现关系 | Class→Interface |
| `depends_on` | 依赖关系 | Module→Module |
| `produces` | 发布事件 | Function→Event |
| `consumes` | 订阅事件 | Function→Event |
| `reads` | 读取数据 | Function→Database |
| `writes` | 写入数据 | Function→Database |
| `belongs_to` | 归属领域 | Function→Domain |

### 4.4 节点 ID 生成规则

```python
# 函数/方法
f"{file_path}:{function_name}"

# 类
f"{file_path}:{class_name}"

# 模块
f"module:{module_name}"

# API 端点
f"api:{method}:{path}"
```

**节点属性示例**:
```python
{
    "id": "src/auth/login.py:authenticate",
    "type": "Function",
    "name": "authenticate",
    "properties": {
        "file_path": "src/auth/login.py",
        "line_start": 45,      # AI 推断，可能不精确
        "line_end": 78,
        "is_async": true,
        "parameters": ["user", "password"],
        "return_type": "Token",
        "docstring": "验证用户身份并返回访问令牌",
        "summary": "用户登录认证",        # AI 生成
        "business_purpose": "身份验证",   # AI 推断
    }
}
```

---

## 5. Agent 架构

### 5.1 Agent 结构

```
AICodeAnalyzer
├── ModuleScannerAgent      — 模块边界识别
├── CodeAnalysisAgent       — 代码语义分析（核心）
│   ├── 函数/类提取
│   ├── 调用关系识别
│   ├── API 端点识别
│   └── 数据流追踪
└── CrossModuleAgent        — 跨模块依赖整合
```

### 5.2 Agent 工具集

| 工具 | 用途 |
|------|------|
| `read_file` | 读取指定文件内容 |
| `search_code` | 关键词搜索代码 |
| `list_directory` | 列出目录结构 |
| `grep_pattern` | 正则搜索 |

### 5.3 并行执行流程

```python
async def analyze_repository(repo_path: str):
    # Step 1: 扫描文件
    scan_result = RepoScanner().scan(repo_path)

    # Step 2: AI 识别模块（串行，需全局视角）
    module_plan = await ModuleScannerAgent().scan(scan_result)

    # Step 3: 并行分析各模块
    module_graphs = await asyncio.gather(*[
        CodeAnalysisAgent().analyze(module, scan_result)
        for module in module_plan.modules
    ])

    # Step 4: 整合跨模块关系
    final_graph = await CrossModuleAgent().merge(module_graphs)

    return final_graph
```

---

## 6. 错误处理与容错

### 6.1 错误分类

| 错误类型 | 场景 | 处理策略 |
|----------|------|----------|
| `FileReadError` | 文件读取失败 | 跳过该文件，记录警告 |
| `LLMTimeoutError` | AI 响应超时 | 重试 2 次，失败则跳过该模块 |
| `LLMRateLimitError` | API 限流 | 指数退避重试，最多等待 60s |
| `LLMContentFilter` | 内容被过滤 | 跳过该文件，记录警告 |
| `ParseError` | AI 输出格式错误 | 重试 1 次，失败则跳过 |
| `ModuleAnalysisFailed` | 模块分析失败 | 标记为失败，继续其他模块 |

### 6.2 容错结果

```python
@dataclass
class AnalysisResult:
    graph_id: str
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    status: str  # "success" | "partial" | "failed"
    failed_modules: list[FailedModule]
    warnings: list[str]
    duration_seconds: float

@dataclass
class FailedModule:
    module_id: str
    reason: str
    files_attempted: list[str]
```

### 6.3 降级模式

| 场景 | 降级策略 |
|------|----------|
| LLM API 完全不可用 | 返回错误，提示用户检查 API Key |
| 大部分模块失败 (>50%) | 返回 `partial` 结果，建议用户分批分析 |
| 单个模块过大超 token | 自动拆分为子模块重新分析 |

---

## 7. 缓存策略

### 7.1 缓存层级

| 层级 | Key | 缓存内容 | 失效条件 |
|------|-----|----------|----------|
| 仓库级 | `repo_name:commit_sha` | 完整图谱 | commit 变化 |
| 模块级 | `repo_name:module_id:file_hashes` | 模块图谱 | 模块内任一文件变化 |
| 文件级 | `file_path:content_hash` | 文件分析结果 | 文件内容变化 |

### 7.2 缓存存储

```
data/ai_cache/
├── repos/
│   └── {repo_name}/
│       └── {commit_sha}.json      # 完整图谱缓存
├── modules/
│   └── {repo_name}/
│       └── {module_id}/
│           └── {hash}.json        # 模块图谱缓存
└── files/
    └── {file_path_hash}.json      # 文件分析缓存
```

### 7.3 增量分析流程

```python
def analyze(repo_path: str, incremental: bool = True):
    current_sha = get_git_commit(repo_path)
    cached = load_cache(repo_name, current_sha)

    if cached and incremental:
        return cached  # 命中缓存，直接返回

    # 未命中，执行分析
    result = analyze_full(repo_path)

    # 写入缓存
    save_cache(repo_name, current_sha, result)
    return result
```

---

## 8. LLM 集成

### 8.1 支持的 Provider

| Provider | 环境变量 | 说明 |
|----------|----------|------|
| Anthropic | `ANTHROPIC_API_KEY` | Claude 系列 |
| OpenAI | `OPENAI_API_KEY` | GPT 系列 |
| MiniMax | `MINIMAX_API_KEY` + `MINIMAX_GROUP_ID` | MiniMax 系列 |
| Ollama | `OLLAMA_BASE_URL` | 本地部署 |

### 8.2 统一接口

```python
class LLMClient:
    def __init__(
        self,
        provider: str,           # "anthropic" | "openai" | "minimax" | "ollama"
        model: str,
        api_key: str | None,
        base_url: str | None,
    ): ...

    def complete(
        self,
        prompt: str,
        system: str | None = None,
        max_tokens: int = 4096,
        temperature: float = 0.1,
    ) -> str: ...

    def complete_with_json(
        self,
        prompt: str,
        system: str | None = None,
        json_schema: dict | None = None,
    ) -> dict: ...

    def tool_call_loop(
        self,
        system: str,
        messages: list[dict],
        tools: list[dict],
        max_iterations: int = 20,
    ) -> ToolCallLoopResult: ...
```

---

## 9. 配置项

### 9.1 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `LLM_PROVIDER` | LLM 提供商 | `anthropic` |
| `LLM_API_KEY` | 通用 API Key | - |
| `ANTHROPIC_API_KEY` | Anthropic API Key | - |
| `OPENAI_API_KEY` | OpenAI API Key | - |
| `MINIMAX_API_KEY` | MiniMax API Key | - |
| `MINIMAX_GROUP_ID` | MiniMax Group ID | - |
| `OLLAMA_BASE_URL` | Ollama 服务地址 | `http://localhost:11434` |
| `LLM_BASE_URL` | 自定义 Base URL | - |
| `LLM_MODEL` | 模型名称 | 提供商默认 |
| `LLM_MAX_TOKENS` | 单次请求最大 Token | `16384` |
| `AI_CACHE_DIR` | 缓存目录 | `data/ai_cache` |
| `AI_CACHE_ENABLED` | 是否启用缓存 | `true` |

### 9.2 代码配置

```python
@dataclass
class AIAnalysisConfig:
    # LLM 配置
    provider: str = "anthropic"
    model: str = ""  # 空则使用默认
    max_tokens: int = 16384
    temperature: float = 0.1

    # 并行配置
    max_parallel_modules: int = 5

    # 模块分析配置
    max_files_per_module: int = 50
    max_tokens_per_module: int = 32000

    # 缓存配置
    cache_enabled: bool = True
    cache_dir: str = "data/ai_cache"

    # 容错配置
    retry_count: int = 2
    retry_delay_seconds: float = 2.0
    timeout_seconds: float = 120.0
```

### 9.3 CLI 参数

```bash
python -m backend.pipeline.ai_analyze /path/to/repo \
    --provider minimax \
    --model abab6.5s-chat \
    --enable-cache \
    --max-parallel 5 \
    --output json
```

---

## 10. 测试策略

### 10.1 核心测试用例

| 测试用例 | 说明 |
|----------|------|
| 流水线完整运行 | 小型仓库 + **真实 LLM 调用**，验证完整流程 |
| 节点 ID 生成 | 验证 ID 格式为 `文件路径:名称` |
| 空仓库处理 | 空仓库不崩溃，返回合理结果 |

### 10.2 测试配置

```python
# pytest marker - 任一 API Key 配置即可运行
@pytest.mark.skipif(
    not any([
        os.environ.get("ANTHROPIC_API_KEY"),
        os.environ.get("OPENAI_API_KEY"),
        os.environ.get("MINIMAX_API_KEY"),
        os.environ.get("OLLAMA_BASE_URL"),
    ]),
    reason="需要配置至少一个 LLM API Key"
)
def test_pipeline_with_real_llm():
    result = AIPipeline().analyze("./code-graph-system")
    assert result.status in ("success", "partial")
    assert result.node_count > 0
```

### 10.3 测试要求

- 使用真实 LLM API
- 测试仓库：使用项目自身 `code-graph-system/` 作为测试对象
- CI 环境：跳过需要 LLM 的测试（通过环境变量控制）

---

## 11. 文件变更清单

### 11.1 删除的文件

| 文件 | 说明 |
|------|------|
| `backend/parser/code_parser.py` | Tree-sitter AST 解析 |
| `backend/analyzer/module_detector.py` | 静态模块检测 |
| `backend/analyzer/component_detector.py` | 静态组件检测 |
| `backend/analyzer/dependency_analyzer.py` | 静态依赖分析 |
| `backend/analyzer/call_graph_builder.py` | 静态调用图 |
| `backend/analyzer/event_analyzer.py` | 静态事件分析 |
| `backend/analyzer/infra_analyzer.py` | 静态基础设施分析 |
| `backend/pipeline/repo_summary_builder.py` | 静态摘要构建 |

### 11.2 新建的文件

| 文件 | 说明 |
|------|------|
| `backend/pipeline/ai_analyze.py` | AI 分析主入口 |
| `backend/agent/agents/module_scanner.py` | 模块扫描 Agent |

### 11.3 改造的文件

| 文件 | 改造内容 |
|------|----------|
| `backend/agent/orchestrator.py` | 改造为 `AICodeAnalyzer` |
| `backend/llm/client.py` | 添加 MiniMax 支持 |
| `backend/pipeline/analyze_repository.py` | 简化为 6 步 |

---

## 12. 性能基准（目标）

| 指标 | 目标值 |
|------|--------|
| 小仓库 (<50 文件) | < 30s |
| 中仓库 (50-200 文件) | < 2min |
| 大仓库 (200-500 文件) | < 5min |
| 超大仓库 (>500 文件) | 支持分批分析 |

---

## 13. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| AI 幻觉 | 生成不存在的节点/边 | 节点 ID 锚定文件路径 + 置信度过滤 |
| Token 超限 | 分析失败 | 模块化 + 预算控制 + 大文件处理 |
| 模块边界识别错误 | 分析结果偏离 | AI 自动识别 + 可人工调整 |
| 跨模块关系遗漏 | 图谱不完整 | 多种关系识别策略 |
| 并行执行失败 | 部分结果丢失 | 容错机制 + 缓存 |

---

## 14. 附录

### 14.1 名词解释

| 术语 | 定义 |
|------|------|
| AIModuleScanner | AI 驱动的模块边界识别组件 |
| AICodeAnalyzer | AI 驱动的代码分析核心组件 |
| 启发式稳定 ID | 基于 `文件路径:名称` 生成的节点 ID，保证同一代码多次分析 ID 不变 |

### 14.2 参考资料

- [Anthropic Claude API](https://docs.anthropic.com/)
- [OpenAI API](https://platform.openai.com/docs/)
- [MiniMax API](https://www.minimaxi.com/)
- [Ollama](https://ollama.ai/)