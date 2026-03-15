# AI 驱动模块化代码图谱分析系统设计文档

**版本**: 1.1
**日期**: 2026-03-15
**状态**: 待审批

---

## 修订历史

| 版本 | 日期 | 修改内容 |
|------|------|---------|
| 1.0 | 2026-03-15 | 初始版本 |
| 1.1 | 2026-03-15 | 根据审查意见补充：迁移策略、IntermediateGraph 定义、缺失类型、P0 策略概述 |

---

## 1. 概述

### 1.1 背景

当前 Code-Knowledge-Graph 系统采用**静态分析驱动**的方式，通过 Tree-sitter AST 解析代码，生成知识图谱。此方式存在以下局限：

- 无法理解代码语义和业务逻辑
- 难以识别高层架构模式（分层、微服务边界）
- 无法推断数据血缘和转换关系
- 对动态语言和复杂模式支持有限

### 1.2 目标

将系统从**静态分析驱动**转变为 **AI 驱动**，实现：

1. **系统架构图** - 分层架构 + 基础设施依赖
2. **函数调用图** - 调用关系 + 跨服务调用 + 异步流向 + 函数签名/副作用
3. **数据血缘图** - 数据流转路径 + 转换关系 + 来源追踪 + 去向追踪

### 1.3 关键决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| AI 职责 | 完全替代静态分析 | 用户需求，AI 主导分析 |
| 分析策略 | 模块化分析 | Token 可控、可并行、增量友好 |
| Agent 模式 | 多 Agent 专业分工 | 职责分离、质量可控 |
| LLM 集成 | 重新设计 | 需要多 Agent 协调能力 |
| Provider 支持 | Anthropic + 国产 API + 本地模型 | 用户需求 |
| 成本策略 | 质量优先 | 用户需求 |

---

## 1.4 迁移策略

本设计采用**渐进式演进**策略，而非完全重写：

| 阶段 | 内容 | 说明 |
|------|------|------|
| **阶段 1** | 新建 AI 分析模块 | 在 `backend/llm/` 和 `backend/agent/` 创建新模块，不影响现有代码 |
| **阶段 2** | 扩展 Schema | 在 `graph_schema.py` 中新增节点/边类型（向后兼容） |
| **阶段 3** | 替换 Pipeline | 新增 `AIAnalysisPipeline` 作为替代入口，保留原 `AnalysisPipeline` |
| **阶段 4** | 切换默认 | 验证稳定后，将 AI Pipeline 设为默认，原静态分析作为降级选项 |

**与现有代码的关系**：

| 现有模块 | 处理方式 |
|---------|---------|
| `backend/ai/llm_client.py` | 保留，新 `backend/llm/client.py` 参考其设计并扩展 |
| `backend/analyzer/ai/agent/` | 保留，新 Agent 系统可复用其 tools 和 prompts |
| `backend/graph/graph_schema.py` | 扩展，新增节点/边类型 |
| `backend/pipeline/analyze_repository.py` | 保留，新增 AI 版本入口 |

---

## 1.5 与现有 Schema 兼容性

### 节点类型映射

| 现有 NodeType | 设计文档节点类型 | 处理方式 |
|--------------|-----------------|---------|
| REPOSITORY | Repository | 复用 |
| MODULE | Module | 复用 |
| FILE | - | 新系统不生成（AI 分析代码级别） |
| CLASS | Class | 复用 |
| FUNCTION | Function | 复用 |
| COMPONENT | Component | 复用 |
| SERVICE | Service | 复用 |
| API | APIEndpoint | 新增 APIEndpoint，与 API 共存 |
| DATA_OBJECT | DataObject | 复用 |
| TABLE | Table | 复用 |
| EVENT | Event / EventHandler | 新增 EventHandler 细化 |
| TOPIC | Topic | 复用 |
| PIPELINE | Pipeline | 复用 |
| CLUSTER | Cluster | 复用 |
| DATABASE | Database | 复用 |
| LAYER | Layer | 复用 |
| FLOW | Flow | 复用 |
| BUSINESS_FLOW | BusinessFlow | 复用 |
| DOMAIN | Domain | 复用 |
| BOUNDED_CONTEXT | BoundedContext | 复用 |
| DOMAIN_ENTITY | DomainEntity | 复用 |
| - | **DataSource** | 新增 |
| - | **DataSink** | 新增 |
| - | **ExternalAPI** | 新增 |
| - | **MessageQueue** | 新增 |

### 1.4 迁移策略

本设计采用**渐进式演进**策略，与现有系统保持兼容：

| 阶段 | 内容 | 说明 |
|------|------|------|
| Phase 1 | 新增 AI 分析模式 | 作为 `enable_ai=True` 的新实现，不修改现有静态分析流程 |
| Phase 2 | 并行运行 | 静态分析和 AI 分析并行运行，可对比结果 |
| Phase 3 | AI 为主 | 当 AI 分析成熟后，静态分析降级为可选验证手段 |

**目录结构策略**：
- 新增 `backend/llm/` 目录（重新设计 LLM 集成）
- 新增 `backend/agent/` 目录（新 Agent 系统）
- 保留 `backend/ai/` 目录（兼容过渡期）
- 保留 `backend/analyzer/` 目录（静态分析器保留）

**Schema 兼容性**：新增节点/边类型将扩展 `graph_schema.py`，保持向后兼容。

### 1.5 与现有 Schema 的兼容性

本设计新增以下节点和边类型，将扩展到 `backend/graph/graph_schema.py`：

#### 新增节点类型

| 新增节点类型 | 所属图谱 | NodeType 枚举值 |
|-------------|---------|----------------|
| APIEndpoint | Call Graph | API_ENDPOINT |
| EventHandler | Call Graph | EVENT_HANDLER |
| DataSource | Data Lineage | DATA_SOURCE |
| DataSink | Data Lineage | DATA_SINK |
| ExternalAPI | Architecture | EXTERNAL_API |
| MessageQueue | Architecture | MESSAGE_QUEUE |

#### 新增边类型

| 新增边类型 | 说明 | EdgeType 枚举值 |
|-----------|------|----------------|
| async_calls | 异步调用 | ASYNC_CALLS |
| handles | 处理请求 | HANDLES |

#### 复用的现有类型

以下类型直接复用 `graph_schema.py` 现有定义：
- 节点：Repository, Module, Layer, Service, Function, Class, Database, Event, Topic, DataObject
- 边：contains, calls, depends_on, reads, writes, produces, consumes, publishes, subscribes, belongs_to, transforms

---

## 2. 系统架构

### 2.1 架构总览

```
┌─────────────────────────────────────────────────────────────────────────┐
│              AI-Driven Module-Aware Code Knowledge Graph System          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                    LLM Integration Layer                            │ │
│  │  • Unified Interface (complete/stream/tool_call_loop)              │ │
│  │  • Provider Adapters (Anthropic/OpenAI Compatible/Ollama/vLLM)     │ │
│  │  • Cross-Cutting (Retry/Token Counter/Rate Limiter/Logging)        │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                    │                                     │
│                                    ▼                                     │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                    Analysis Orchestrator                            │ │
│  │  • Session Management                                               │ │
│  │  • Strategy Selection (global vs module-based)                     │ │
│  │  • Parallel Execution Coordinator                                  │ │
│  │  • Progress Tracking & Callbacks                                   │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                    │                                     │
│         ┌──────────────────────────┴──────────────────────────┐         │
│         ▼                                                      ▼         │
│  ┌─────────────────┐                                  ┌─────────────────┐ │
│  │ Phase 1         │                                  │ Phase 2         │ │
│  │ Module Detector │                                  │ Module Analysis │ │
│  │ Agent           │                                  │ (Parallel)      │ │
│  └────────┬────────┘                                  └────────┬────────┘ │
│           │                                                    │         │
│           │ modules[]                                          │         │
│           └────────────────────────┬───────────────────────────┘         │
│                                    ▼                                     │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ Phase 3: Per-Module Analysis (Parallel Execution)                  │ │
│  │                                                                     │ │
│  │   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐             │ │
│  │   │  Module A   │   │  Module B   │   │  Module C   │             │ │
│  │   │             │   │             │   │             │             │ │
│  │   │ ┌─────────┐ │   │ ┌─────────┐ │   │ ┌─────────┐ │             │ │
│  │   │ │  Arch   │ │   │ │  Arch   │ │   │ │  Arch   │ │             │ │
│  │   │ │  Agent  │ │   │ │  Agent  │ │   │ │  Agent  │ │             │ │
│  │   │ └─────────┘ │   │ └─────────┘ │   │ └─────────┘ │             │ │
│  │   │ ┌─────────┐ │   │ ┌─────────┐ │   │ ┌─────────┐ │             │ │
│  │   │ │ Call    │ │   │ │ Call    │ │   │ │ Call    │ │  ← 并行     │ │
│  │   │ │ Graph   │ │   │ │ Graph   │ │   │ │ Graph   │ │             │ │
│  │   │ └─────────┘ │   │ └─────────┘ │   │ └─────────┘ │             │ │
│  │   │ ┌─────────┐ │   │ ┌─────────┐ │   │ ┌─────────┐ │             │ │
│  │   │ │  Data   │ │   │ │  Data   │ │   │ │  Data   │ │             │ │
│  │   │ │ Lineage │ │   │ │ Lineage │ │   │ │ Lineage │ │             │ │
│  │   │ └─────────┘ │   │ └─────────┘ │   │ └─────────┘ │             │ │
│  │   │             │   │             │   │             │             │ │
│  │   │ Validator   │   │ Validator   │   │ Validator   │             │ │
│  │   └─────────────┘   └─────────────┘   └─────────────┘             │ │
│  │                                                                     │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                    │                                     │
│                                    ▼                                     │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ Phase 4: Cross-Module Agent                                         │ │
│  │  • 识别模块间 HTTP/RPC 调用                                         │ │
│  │  • 识别消息队列跨模块通信                                           │ │
│  │  • 识别共享库依赖                                                   │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                    │                                     │
│                                    ▼                                     │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ Phase 5: Graph Merger & Finalizer                                   │ │
│  │  • 合并所有模块图谱（添加模块前缀）                                  │ │
│  │  • 添加跨模块边                                                     │ │
│  │  • 全局验证 & 幻觉检测                                              │ │
│  │  • 计算 PageRank / 度指标                                           │ │
│  │  • 持久化 (JSON / Neo4j)                                            │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 执行流程

```
Phase 1: Module Detection
├── 扫描目录结构
├── 读取包管理配置 (package.json, go.mod, requirements.txt)
├── AI 推断模块边界（兜底）
└── 输出: modules[] + dependencies[]

Phase 2-3: Per-Module Analysis (并行)
├── 对每个 module 并行执行:
│   ├── Architecture Agent → Layer/Service/Module/Database 节点
│   ├── Call Graph Agent → Function/APIEndpoint + calls 边
│   ├── Data Lineage Agent → DataObject + reads/writes/transforms 边
│   └── Validation → 输出验证后的模块图谱
└── 输出: 每个模块的 IntermediateGraph

Phase 4: Cross-Module Analysis
├── 识别模块间 HTTP/RPC 调用
├── 识别消息队列跨模块通信
├── 识别共享库依赖
└── 输出: cross_module_edges[]

Phase 5: Merge & Finalize
├── 合并所有模块图谱（添加模块前缀避免 ID 冲突）
├── 添加跨模块边
├── 全局验证
├── 计算图论指标
└── 持久化
```

---

## 3. LLM 集成层设计

### 3.1 架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      LLM Integration Layer                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    Unified LLM Interface                  │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐   │   │
│  │  │  complete() │  │  stream()   │  │ tool_call_loop()│   │   │
│  │  └─────────────┘  └─────────────┘  └─────────────────┘   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│  ┌───────────────────────────┼───────────────────────────────┐  │
│  │                    Provider Adapters                        │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐    │  │
│  │  │  Anthropic  │  │  OpenAI     │  │  Local Models   │    │  │
│  │  │  Adapter    │  │ Compatible  │  │  (Ollama/vLLM)  │    │  │
│  │  │  (Native)   │  │ (国产API)   │  │                 │    │  │
│  │  └─────────────┘  └─────────────┘  └─────────────────┘    │  │
│  └─────────────────────────────────────────────────────────────┘ │
│                              │                                   │
│  ┌───────────────────────────┼───────────────────────────────┐  │
│  │                    Cross-Cutting Concerns                  │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │  │
│  │  │  Retry   │  │  Token   │  │  Rate    │  │  Logging │   │  │
│  │  │  Policy  │  │  Counter │  │  Limiter │  │  & Trace │   │  │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │  │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 统一接口

```python
class LLMClient:
    """统一 LLM 客户端接口"""

    def __init__(
        self,
        provider: str,           # "anthropic" | "openai" | "ollama" | "minimax"
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

    def count_tokens(self, text: str) -> int: ...

    def is_available(self) -> bool: ...
```

#### 3.2.1 ToolCallLoopResult

```python
@dataclass
class ToolCallLoopResult:
    """tool_call_loop 的返回结果"""

    status: str                        # "completed" | "max_iterations" | "error"
    final_message: str                 # 最终 LLM 输出内容
    tool_calls: list[ToolCallRecord]   # 工具调用记录
    total_iterations: int              # 总迭代次数
    total_tokens: int                  # 总 token 消耗
    execution_time_ms: int             # 执行时间


@dataclass
class ToolCallRecord:
    """单次工具调用记录"""

    iteration: int                     # 迭代序号
    tool_name: str                     # 工具名称
    tool_input: dict                   # 工具输入参数
    tool_output: dict                  # 工具输出结果
    success: bool                      # 是否成功
    error: str | None                  # 错误信息（如果有）
```

### 3.3 Provider 支持

| Provider | 实现方式 | 说明 |
|----------|---------|------|
| Anthropic | 原生 SDK | 支持 tool use，推荐用于生产 |
| 国产 API (MiniMax/DeepSeek/Qwen) | OpenAI 兼容协议 | 使用 OpenAI SDK 适配 |
| 本地模型 (Ollama/vLLM) | OpenAI 兼容协议 | 本地部署，无成本限制 |

---

## 4. Agent 系统设计

### 4.1 Agent 总览

| Agent | 阶段 | 职责 | 输入 | 输出 |
|-------|------|------|------|------|
| **Module Detector** | Phase 1 | 识别模块边界 | repo_path | modules[], dependencies[] |
| **Architecture Agent** | Phase 3 | 分析模块内架构 | module_path, context | Layer, Service, Module 节点 |
| **Call Graph Agent** | Phase 3 | 分析函数调用 | module_path, arch_output | Function, calls 边 |
| **Data Lineage Agent** | Phase 3 | 分析数据血缘 | module_path, call_output | DataObject, transforms 边 |
| **Cross-Module Agent** | Phase 4 | 分析跨模块关系 | all_module_outputs | cross_module_edges[] |

### 4.2 Agent 通信协议

#### 4.2.1 AgentOutput

```python
@dataclass
class AgentOutput:
    """Agent 执行结果的标准格式"""

    agent_type: str                    # "module_detector" | "architecture" | "call_graph" | "data_lineage" | "cross_module"
    module_id: str                     # 所属模块 ID (Phase 3 Agents)
    status: str                        # "success" | "partial" | "failed"
    execution_time_ms: int

    nodes: list[GraphNode]             # 生成的节点
    edges: list[GraphEdge]             # 生成的边
    discoveries: DiscoveryRegistry     # 发现记录（供后续 Agent 查询）

    meta: dict                         # 统计、token 消耗等
    errors: list[AgentError]
    warnings: list[str]
```

#### 4.2.2 IntermediateGraph

```python
@dataclass
class IntermediateGraph:
    """模块分析的中间图谱结果"""

    module_id: str                     # 所属模块 ID
    nodes: list[GraphNode]             # 节点列表
    edges: list[GraphEdge]             # 边列表
    discoveries: DiscoveryRegistry     # 发现记录
    meta: dict                         # 统计信息
    # meta 包含:
    # - "token_count": int        # Token 消耗
    # - "execution_time_ms": int  # 执行时间
    # - "tool_calls": int         # 工具调用次数
    # - "files_read": int         # 读取文件数
    # - "confidence_avg": float   # 平均置信度

    @property
    def node_count(self) -> int:
        return len(self.nodes)

    @property
    def edge_count(self) -> int:
        return len(self.edges)
```

#### 4.2.3 DiscoveryRegistry

```python
@dataclass
class DiscoveryRegistry:
    """Agent 发现的结构化记录，供后续 Agent 查询"""

    # 文件发现
    entry_points: list[FileDiscovery]
    config_files: list[FileDiscovery]

    # 结构发现
    layers: list[LayerDiscovery]
    services: list[ServiceDiscovery]
    modules: list[ModuleDiscovery]

    # 代码发现
    functions: list[FunctionDiscovery]
    data_objects: list[DataObjectDiscovery]

    # 关系发现
    call_chains: list[CallChainDiscovery]
    data_flows: list[DataFlowDiscovery]

    def query(self, discovery_type: str, filters: dict) -> list:
        """查询特定类型的发现"""
        pass
```

#### 4.2.4 Discovery 类型定义

**基础发现类型**：

```python
@dataclass
class FileDiscovery:
    """文件发现记录"""
    path: str                          # 相对路径
    file_type: str                     # "entry" | "config" | "source" | "test"
    language: str                      # "python" | "typescript" | "go"
    purpose: str                       # AI 推断的用途
    key_symbols: list[str]             # 关键符号（类名、函数名）
    confidence: float
```

**模块相关**：

```python
@dataclass
class ModuleDiscovery:
    """模块发现记录"""
    module_id: str                     # "module:user-service"
    name: str                          # "UserService"
    path: str                          # "services/user"
    module_type: str                   # "service" | "library" | "shared" | "config"
    language: str                      # "python" | "typescript" | "go"
    framework: str                     # "fastapi" | "express" | "gin"
    entry_points: list[str]            # ["main.py", "app.py"]
    dependencies: list[str]            # ["module:auth", "module:common"]
    confidence: float
```

**架构相关**：

```python
@dataclass
class LayerDiscovery:
    """架构层发现记录"""
    layer_id: str                      # 节点 ID
    layer_type: str                    # "presentation" | "business" | "data" | "infrastructure"
    name: str
    description: str
    modules: list[str]                 # 包含的模块 ID
    entry_points: list[str]            # 入口文件路径
    confidence: float


@dataclass
class ServiceDiscovery:
    """服务发现记录"""
    service_id: str                    # 节点 ID
    name: str
    description: str
    layer_id: str                      # 所属架构层
    entry_file: str                    # 入口文件
    api_endpoints: list[str]           # API 端点列表
    dependencies: list[str]            # 依赖的服务/数据库 ID
    confidence: float
```

**代码相关**：

```python
@dataclass
class FunctionDiscovery:
    """函数发现记录"""
    function_id: str                   # 节点 ID
    name: str
    file_path: str
    line_start: int
    line_end: int
    signature: str                     # 函数签名
    is_async: bool
    is_entry_point: bool               # 是否是入口函数
    side_effects: list[str]            # ["db_write", "http_call", "file_io"]
    calls_to: list[str]                # 调用的函数 ID
    called_by: list[str]               # 被谁调用
    confidence: float


@dataclass
class APIEndpointDiscovery:
    """API 端点发现记录"""
    endpoint_id: str                   # 节点 ID
    method: str                        # "GET" | "POST" | "PUT" | "DELETE"
    path: str                          # "/api/users/{id}"
    handler_function: str              # 处理函数 ID
    module_id: str                     # 所属模块
    confidence: float


@dataclass
class DataObjectDiscovery:
    """数据对象发现记录"""
    object_id: str                     # 节点 ID
    name: str
    object_type: str                   # "dto" | "entity" | "vo" | "model"
    file_path: str
    fields: list[dict]                 # [{"name": "id", "type": "int"}, ...]
    transforms_to: list[str]           # 转换目标对象 ID
    transforms_from: list[str]         # 转换来源对象 ID
    confidence: float
```

**关系相关**：

```python
@dataclass
class CallChainDiscovery:
    """调用链发现记录"""
    chain_id: str
    start_function: str                # 起始函数 ID
    end_function: str                  # 终止函数 ID
    path: list[str]                    # 路径上的函数 ID 列表
    is_cross_service: bool             # 是否跨服务
    is_async: bool                     # 是否包含异步调用
    depth: int                         # 调用深度
    confidence: float


@dataclass
class DataFlowDiscovery:
    """数据流发现记录"""
    flow_id: str
    source_type: str                   # "database" | "api" | "file" | "user_input"
    source_location: str               # 来源位置
    sink_type: str                     # "database" | "api" | "file" | "log"
    sink_location: str                 # 去向位置
    transformations: list[str]         # 中间转换的数据对象 ID
    functions_involved: list[str]      # 涉及的函数 ID
    confidence: float
```

### 4.3 共享知识库

#### 4.3.1 ExplorationCache

```python
@dataclass
class CachedFile:
    """缓存的文件内容"""
    path: str                          # 相对路径
    content: str                       # 文件内容
    line_count: int                    # 行数
    token_estimate: int                # Token 估算
    language: str                      # 语言
    cached_at: datetime                # 缓存时间


class ExplorationCache:
    """文件探索缓存，避免重复读取"""

    def __init__(self, max_files: int = 100, max_tokens: int = 50000):
        self.max_files = max_files
        self.max_tokens = max_tokens
        self._cache: dict[str, CachedFile] = {}
        self._total_tokens: int = 0

    def get(self, path: str) -> CachedFile | None:
        """获取缓存的文件"""
        return self._cache.get(path)

    def put(self, path: str, content: str, language: str) -> CachedFile:
        """缓存文件内容"""
        # LRU 淘汰逻辑在实现阶段细化
        ...

    def get_or_read(self, path: str, repo_root: str) -> CachedFile:
        """获取缓存或读取文件"""
        ...

    def clear(self) -> None:
        """清空缓存"""
        self._cache.clear()
        self._total_tokens = 0
```

#### 4.3.2 SharedKnowledgeBase

```python
class SharedKnowledgeBase:
    """跨 Agent 共享的知识库"""

    def __init__(self, session_id: str, repo_path: str):
        self.session_id = session_id
        self.repo_path = repo_path
        self.exploration_cache: ExplorationCache = ExplorationCache()
        self.modules: dict[str, ModuleDiscovery] = {}
        self.intermediate_graphs: dict[str, IntermediateGraph] = {}
        self.discoveries: DiscoveryRegistry = DiscoveryRegistry()

    # 模块管理
    def register_module(self, module: ModuleDiscovery) -> None: ...
    def get_module(self, module_id: str) -> ModuleDiscovery | None: ...
    def get_all_modules(self) -> list[ModuleDiscovery]: ...

    # 中间图谱
    def commit_module_graph(self, module_id: str, graph: IntermediateGraph) -> None: ...
    def get_module_graph(self, module_id: str) -> IntermediateGraph | None: ...

    # 跨模块查询
    def find_function_across_modules(self, function_name: str) -> list[FunctionDiscovery]: ...
    def find_service_endpoint(self, path_pattern: str) -> list[APIEndpointDiscovery]: ...
```

### 4.4 AgentContext

```python
class AgentContext:
    """Agent 执行上下文，提供对共享知识的访问"""

    def __init__(self, module_id: str, knowledge_base: SharedKnowledgeBase):
        self.module_id = module_id
        self.kb = knowledge_base

    # 查询前置 Agent 结果
    def get_architecture_graph(self) -> IntermediateGraph: ...
    def get_call_graph(self) -> IntermediateGraph: ...

    # 查询发现记录
    def find_entry_points(self) -> list[FileDiscovery]: ...
    def find_service_by_name(self, name: str) -> ServiceDiscovery | None: ...
    def find_functions_in_layer(self, layer_id: str) -> list[FunctionDiscovery]: ...
    def find_function_by_file(self, file_path: str) -> list[FunctionDiscovery]: ...
    def find_data_objects_in_service(self, service_id: str) -> list[DataObjectDiscovery]: ...
    def find_call_chains_from(self, function_id: str) -> list[CallChainDiscovery]: ...

    # 写入发现
    def register_discovery(self, discovery: Discovery) -> None: ...
    def register_discoveries(self, discoveries: list[Discovery]) -> None: ...

    # 图谱操作
    def add_node(self, node: GraphNode) -> None: ...
    def add_edge(self, edge: GraphEdge) -> None: ...
    def commit_output(self, output: AgentOutput) -> None: ...
```

### 4.5 各 Agent 职责详解

#### 4.5.1 Module Detector Agent

**职责**：识别代码仓库中的模块边界

**识别策略**（优先级从高到低）：

1. **显式配置**
   - pnpm-workspace.yaml, lerna.json, nx.json, turbo.json

2. **包管理器定义**
   - package.json (workspaces)
   - go.mod (module)
   - Cargo.toml (workspace)

3. **目录结构推断**
   - services/*, packages/*, libs/*, apps/*, src/modules/*

4. **AI 推断**（兜底）
   - 分析目录结构 + import 关系

**输出**：
```python
[
    ModuleDiscovery(
        module_id="module:user-service",
        name="UserService",
        path="services/user",
        module_type="service",
        language="python",
        framework="fastapi",
        entry_points=["main.py"],
        dependencies=["module:auth", "module:common"],
        confidence=0.85
    ),
    ...
]
```

#### 4.5.2 Architecture Agent

**职责**：分析模块内的架构结构

**分析内容**：
- 识别分层架构（Presentation / Business / Data / Infrastructure）
- 发现服务边界和职责
- 识别基础设施依赖（Database / ExternalAPI / MessageQueue）

**输出节点类型**：
- `Layer` - 架构层
- `Service` - 微服务/子系统
- `Module` - 代码模块/包
- `Database` - 数据库
- `ExternalAPI` - 外部服务
- `MessageQueue` - 消息队列

**输出边类型**：
- `contains` - 包含关系
- `belongs_to` - 归属关系
- `depends_on` - 依赖关系
- `publishes` / `subscribes` - 事件发布/订阅

#### 4.5.3 Call Graph Agent

**职责**：分析函数调用关系

**分析内容**：
- 从入口点追踪调用链
- 识别 HTTP/RPC 调用
- 分析异步调用模式（async/await, Promise, callback）

**输出节点类型**：
- `Function` - 函数/方法
- `APIEndpoint` - HTTP API
- `EventHandler` - 事件处理器

**输出边类型**：
- `calls` - 同步调用
- `async_calls` - 异步调用
- `handles` - 处理请求
- `triggers` - 触发事件

#### 4.5.4 Data Lineage Agent

**职责**：分析数据血缘关系

**分析内容**：
- 追踪数据来源（Database / ExternalAPI / UserInput）
- 识别数据对象（DTO / Entity / VO）
- 追踪数据转换关系
- 追踪数据去向（Database / ExternalAPI / File / Log）

**输出节点类型**：
- `DataSource` - 数据来源
- `DataObject` - 数据实体
- `DataSink` - 数据去向

**输出边类型**：
- `reads` - 读取数据
- `writes` - 写入数据
- `produces` - 产出数据
- `consumes` - 消费数据
- `transforms` - 转换数据

#### 4.5.5 Cross-Module Agent

**职责**：识别模块间的关系

**分析内容**：
- HTTP/RPC 调用（跨模块）
- 消息队列通信（跨模块）
- 共享库依赖

**输出**：
```python
[
    CrossModuleEdge(
        from_module="module:user-service",
        to_module="module:auth-service",
        from_node="userservice:function:login",
        to_node="authservice:function:validateToken",
        edge_type="calls",
        connection_type="http",
        properties={"method": "POST", "path": "/auth/validate"}
    ),
    ...
]
```

---

## 5. 验证体系设计

### 5.1 验证流水线

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Validation Pipeline                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Layer 1: Schema Validation                                              │
│  ──────────────────────────                                              │
│  • 节点 ID 格式验证 (module:prefix:type:name)                            │
│  • 节点类型合法性                                                        │
│  • 边类型合法性                                                          │
│  • 必填属性检查                                                          │
│                                                                          │
│  Layer 2: Existence Validation                                           │
│  ────────────────────────────                                            │
│  • 代码锚定验证 (file_path + line_number)                                │
│  • 函数/类存在性检查                                                     │
│  • 模块路径验证                                                          │
│  • 幻觉检测                                                              │
│                                                                          │
│  Layer 3: Graph Validation                                               │
│  ──────────────────────────                                              │
│  • 引用完整性 (边的 from/to 存在)                                        │
│  • 孤立节点检测                                                          │
│  • 语义一致性 (边类型与节点类型兼容)                                     │
│  • 置信度分布检查                                                        │
│                                                                          │
│  Auto Correction                                                         │
│  ────────────────                                                        │
│  • 低置信度节点降权 (threshold=0.4)                                      │
│  • 无锚定节点标记                                                        │
│  • 自动移除无效边                                                        │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 5.2 验证模式

| 模式 | 行为 | 适用场景 |
|------|------|---------|
| **strict** | 任何错误拒绝输出 | 生产环境 |
| **normal** | 自动修正，移除低置信度节点 | 默认模式 |
| **relaxed** | 只记录警告，接受所有输出 | 调试阶段 |

### 5.3 幻觉检测策略

| 策略 | 说明 |
|------|------|
| **代码锚定** | 每个节点必须关联到具体的代码位置 (file_path + line) |
| **交叉验证** | 同一实体被多次独立发现 → 置信度提升 |
| **模式匹配** | AI 声称的函数名，在代码中搜索验证 |
| **一致性检查** | 边的 from/to 必须指向存在的节点 |
| **置信度衰减** | 长调用链：每增加一跳，置信度 × 0.9 |

---

## 6. 节点与边类型定义

### 6.1 节点类型

| 节点类型 | 所属图谱 | 说明 | 关键属性 |
|---------|---------|------|---------|
| `Repository` | Architecture | 代码仓库 | `name`, `languages[]` |
| `Module` | Architecture | 代码模块 | `path`, `module_type`, `language` |
| `Layer` | Architecture | 架构层 | `layer_type`, `pattern` |
| `Service` | Architecture | 微服务 | `entry_points[]`, `responsibility` |
| `Database` | Architecture | 数据库 | `type`, `connection_pattern` |
| `ExternalAPI` | Architecture | 外部服务 | `provider`, `purpose` |
| `MessageQueue` | Architecture | 消息队列 | `type`, `topics[]` |
| `Function` | Call Graph | 函数/方法 | `signature`, `is_async`, `side_effects[]` |
| `APIEndpoint` | Call Graph | HTTP API | `method`, `path`, `handler` |
| `EventHandler` | Call Graph | 事件处理器 | `event_type`, `topic` |
| `DataSource` | Data Lineage | 数据来源 | `type`, `location` |
| `DataObject` | Data Lineage | 数据实体 | `fields[]`, `entity_type` |
| `DataSink` | Data Lineage | 数据去向 | `type`, `location` |

### 6.2 边类型

| 边类型 | 所属图谱 | 说明 | from → to |
|--------|---------|------|-----------|
| `contains` | Architecture | 包含关系 | Repository → Module, Layer → Function |
| `belongs_to` | Architecture | 归属关系 | Function → Service, Module → Layer |
| `depends_on` | Architecture | 依赖关系 | Service → Database, Module → Module |
| `calls` | Call Graph | 同步调用 | Function → Function |
| `async_calls` | Call Graph | 异步调用 | Function → Function |
| `handles` | Call Graph | 处理请求 | APIEndpoint → Function |
| `publishes` | Call Graph | 发布事件 | Function → MessageQueue |
| `subscribes` | Call Graph | 订阅事件 | Function → MessageQueue |
| `reads` | Data Lineage | 读取数据 | Function → DataSource |
| `writes` | Data Lineage | 写入数据 | Function → DataSink |
| `produces` | Data Lineage | 产出数据 | Function → DataObject |
| `consumes` | Data Lineage | 消费数据 | Function → DataObject |
| `transforms` | Data Lineage | 转换数据 | DataObject → DataObject |

---

## 7. 文件结构

```
code-graph-system/backend/
├── llm/                              # LLM 集成层
│   ├── __init__.py
│   ├── client.py                     # 统一 LLM 客户端
│   ├── providers/                    # Provider 适配器
│   │   ├── __init__.py
│   │   ├── base.py                   # Provider 基类
│   │   ├── anthropic_provider.py     # Anthropic 原生
│   │   ├── openai_compatible.py      # OpenAI 兼容（国产 API）
│   │   └── local_provider.py         # 本地模型
│   ├── retry.py                      # 重试策略
│   └── token_counter.py              # Token 计数
│
├── agent/                            # Agent 系统
│   ├── __init__.py
│   ├── base.py                       # Agent 基类
│   ├── context.py                    # AgentContext / SharedKnowledgeBase
│   ├── orchestrator.py               # 编排器（策略选择/并行调度）
│   ├── tools/                        # 工具集
│   │   ├── __init__.py
│   │   ├── file_reader.py
│   │   ├── code_search.py
│   │   └── directory_lister.py
│   ├── prompts/                      # Prompt 模板
│   │   ├── module_detector.txt
│   │   ├── architecture.txt
│   │   ├── call_graph.txt
│   │   ├── data_lineage.txt
│   │   └── cross_module.txt
│   └── agents/                       # Agent 实现
│       ├── __init__.py
│       ├── module_detector.py        # Phase 1
│       ├── architecture.py           # Phase 3a
│       ├── call_graph.py             # Phase 3b
│       ├── data_lineage.py           # Phase 3c
│       └── cross_module.py           # Phase 4
│
├── validation/                       # 验证体系
│   ├── __init__.py
│   ├── pipeline.py                   # 验证流水线
│   ├── schema_validator.py           # Schema 验证
│   ├── existence_validator.py        # 存在性验证
│   ├── graph_validator.py            # 图谱验证
│   └── auto_corrector.py             # 自动修正
│
├── pipeline/                         # 分析流水线
│   ├── __init__.py
│   ├── orchestrator.py               # 主编排器
│   └── merger.py                     # 图谱合并
│
├── graph/                            # 图谱模型（保留）
│   ├── graph_schema.py               # 节点/边类型定义
│   ├── graph_builder.py              # 图构建
│   └── graph_repository.py           # 持久化
│
└── models/                           # 数据模型
    ├── __init__.py
    ├── discovery.py                  # Discovery 类型定义
    ├── agent_output.py               # AgentOutput 定义
    └── validation.py                 # 验证结果定义
```

---

## 8. 待细化内容（实现阶段）

以下内容将在实现阶段细化：

| 优先级 | 模块 | 说明 |
|--------|------|------|
| 🔴 P0 | Token 预算控制 | 每个模块/Agent 的 token 上限，熔断机制 |
| 🔴 P0 | 大文件处理 | 文件大小阈值，分段读取，摘要策略 |
| 🟡 P1 | 模块边界验证 | 粒度检查，内聚性检查，用户确认接口 |
| 🟡 P1 | 并行执行设计 | 并发策略，部分失败处理，进度追踪 |
| 🟡 P1 | 错误恢复机制 | Agent 失败重试，降级策略 |
| 🟢 P2 | Prompt 工程 | 每个 Agent 的详细 Prompt，Few-shot 示例 |
| 🟢 P2 | 增量分析 | 变更检测，缓存复用 |
| 🟢 P2 | 质量评估 | 召回率/精确率指标，黄金数据集 |

### 8.1 P0 策略概述

以下为 P0 事项的高层策略，具体实现在实现阶段细化：

#### 8.1.1 Token 预算控制

```
┌─────────────────────────────────────────────────────────────┐
│  Token Budget Strategy                                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  全局预算 = 模块数 × 单模块预算 × 安全系数(1.2)              │
│                                                              │
│  单模块预算分配:                                              │
│  ├── Architecture Agent:  30%                                │
│  ├── Call Graph Agent:    40%                                │
│  └── Data Lineage Agent:  30%                                │
│                                                              │
│  熔断机制:                                                    │
│  ├── 当剩余预算 < 20% 时，跳过非关键分析                      │
│  ├── 当剩余预算 < 10% 时，强制终止并返回部分结果              │
│  └── 每次工具调用前检查预算                                   │
│                                                              │
│  默认配置:                                                    │
│  ├── 单模块预算: 50000 tokens                                │
│  ├── ExplorationCache 上限: 50000 tokens                     │
│  └── 单文件上限: 5000 tokens (超出则分段/摘要)               │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

#### 8.1.2 大文件处理策略

```
┌─────────────────────────────────────────────────────────────┐
│  Large File Strategy                                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  阈值配置:                                                    │
│  ├── 小文件: < 500 行     → 完整读取                         │
│  ├── 中文件: 500-2000 行  → 完整读取，记录警告               │
│  ├── 大文件: 2000-5000 行 → 分段读取                         │
│  └── 超大文件: > 5000 行  → AI 摘要 + 按需读取              │
│                                                              │
│  分段读取策略:                                                │
│  ├── 优先读取: 类/函数定义区域                               │
│  ├── 按需读取: 函数体（跟随调用链）                          │
│  └── 跳过: 注释、空行、import 区域                           │
│                                                              │
│  摘要策略 (超大文件):                                         │
│  ├── 读取文件头部 (前 100 行)                                │
│  ├── AI 生成结构摘要 (类/函数列表)                           │
│  └── 后续按需读取特定区域                                    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 9. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 模块边界识别错误 | 分析结果偏离 | 多策略识别 + AI 增强 + 用户确认 |
| Token 超限 | 分析失败 | 模块化 + 预算控制 + 大文件处理 |
| AI 幻觉 | 生成不存在的节点/边 | 三层验证 + 代码锚定 + 置信度过滤 |
| 跨模块关系遗漏 | 图谱不完整 | 多种关系识别策略 + 人工补充接口 |
| 并行执行失败 | 部分结果丢失 | 容错机制 + 断点续传 |

---

## 10. 附录

### 10.1 名词解释

| 术语 | 定义 |
|------|------|
| Agent | AI 驱动的分析单元，负责特定类型的分析任务 |
| Discovery | Agent 发现的结构化记录，可被其他 Agent 查询 |
| Module | 代码仓库中的独立单元（服务、库、包） |
| Cross-Module Edge | 连接不同模块的边 |
| 幻觉 | AI 生成不存在于代码中的节点或关系 |

### 10.2 参考资料

- [Anthropic Claude API](https://docs.anthropic.com/)
- [OpenAI API](https://platform.openai.com/docs/)
- [Ollama](https://ollama.ai/)
- [Tree-sitter](https://tree-sitter.github.io/tree-sitter/)
