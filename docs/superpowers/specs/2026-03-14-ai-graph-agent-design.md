# AI Graph Agent 设计文档

**日期**: 2026-03-14
**状态**: 设计阶段
**作者**: Claude Sonnet 4.6

## 概述

用单一的 `AIGraphAgent` 替代现有的 4 个 AI 分析器（`AIArchitectureAnalyzer`、`AIServiceDetector`、`AIBusinessFlowAnalyzer`、`AIDataLineageAnalyzer`），通过 Agent 自主探索仓库代码，生成完整的知识图谱。

### 核心目标

- **端到端重新设计** AI 分析子系统
- **Agent 自主探索**：LLM 通过工具主动读取代码，而非被动接收截断的摘要
- **全量图谱输出**：一次性输出所有 `GraphNode` + `GraphEdge`，替代原 4 个分析器的职责
- **混合模式**：预填充静态分析摘要作为初始上下文 + 丰富工具集（文件读取、AST 查询、调用图查询）
- **平衡成本与准确性**：最多 20 轮工具调用，优先探索高价值路径

## 背景与问题

### 现状

当前流水线步骤 10-13 使用 4 个独立的 AI 分析器：

```
步骤 10: AIArchitectureAnalyzer    → LAYER 节点
步骤 11: AIServiceDetector         → SERVICE 节点
步骤 12: AIBusinessFlowAnalyzer    → FLOW 节点
步骤 13: AIDataLineageAnalyzer     → READS/WRITES/TRANSFORMS 边
```

每个分析器通过 `RepoSummaryBuilder` 获取一个截断的摘要（前 20 个模块、前 30 个函数等），调用 LLM 返回 JSON。

### 核心瓶颈

1. **上下文受限**：LLM 只看到扁平列表，无法感知代码的真实层次结构和语义关系
2. **被动分析**：LLM 无法主动探索感兴趣的代码，只能基于预先截断的摘要推断
3. **分散职责**：4 个分析器独立运行，无法跨模块建立语义关联
4. **Token 浪费**：每个分析器都重复接收相似的摘要信息

## 方案选择

### 对比的 3 种方案

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| **A. 单一 Agent** | 一个 `AIGraphAgent` 替代 4 个分析器 | 全局上下文，跨文件关联；实现简单 | 输出不可拆分调试 |
| B. 多 Agent 并行 | 4 个专项 Agent 并行运行 | 并行提速；职责单一 | 无法共享探索；重复读文件 |
| C. 层级 Agent | Director + Workers | 资源分配最优 | 实现最复杂；两轮 LLM 调用 |

**选择方案 A**，理由：
- Agent 单一视角能跨模块建立关联（比 4 个分开的 Agent 更准）
- 静态分析摘要作为初始上下文，大幅减少探索轮次
- 实现复杂度最低，与现有 pipeline 集成最简单

## 架构设计

### 总体架构

用 `AIGraphAgent`（单一类）替代现有的 4 个分析器（步骤 10-13）。流水线步骤从 16 步简化为 13 步：

```
原流水线:  步骤1-9（静态） → 步骤9（摘要） → 步骤10-13（4个AI分析器） → 步骤14-16
新流水线:  步骤1-9（静态） → 步骤9（摘要） → 步骤10（AIGraphAgent）   → 步骤11-13
```

### 组件结构

```
backend/analyzer/ai/
├── agent/
│   ├── graph_agent.py          # AIGraphAgent 主类（替代原 4 个分析器）
│   ├── tools.py                # Agent 可调用的工具函数（7个工具）
│   ├── context_builder.py      # 初始上下文构建（静态摘要 → 结构化 prompt）
│   └── output_parser.py        # 解析 emit_graph() 输出 → GraphNode/GraphEdge
├── ai_analyzer_base.py         # 保留（graph_agent.py 继承它）
└── prompts/
    └── graph_agent.txt         # Agent 的 system prompt 模板
```

### 数据流

```
RepoSummary (步骤9输出)
  → ContextBuilder.build()      → 结构化初始上下文（文件树+调用图+摘要）
  → AIGraphAgent.analyze()
      ↓ LLM 接收初始上下文
      ↓ [工具调用循环, 最多20轮]
        ├─ read_file(path)
        ├─ list_directory(path)
        ├─ search_code(pattern)
        ├─ get_ast_nodes(path)        # 直接返回已解析的 AST 节点
        ├─ get_call_graph(node_id)    # 返回某节点的调用子图
        ├─ get_imports(path)          # 返回文件的 import 关系
        └─ emit_graph(nodes, edges)  # ← 终止工具，触发输出
      ↓ OutputParser 将 JSON 转换为 GraphNode/GraphEdge
  → BuiltGraph（与静态图谱合并）
```

## 工具集设计

### 7 个工具定义

```python
TOOLS = [
    {
        "name": "read_file",
        "description": "读取指定文件的源代码（最多 200 行，超长自动截断）",
        "input_schema": {"path": str, "start_line": int = 1, "end_line": int = 200}
    },
    {
        "name": "list_directory",
        "description": "列出目录下的文件和子目录（不递归）",
        "input_schema": {"path": str}
    },
    {
        "name": "search_code",
        "description": "在仓库中全文搜索关键词，返回匹配的文件名+行号+上下文",
        "input_schema": {"pattern": str, "file_glob": str = "**/*"}
    },
    {
        "name": "get_ast_nodes",
        "description": "返回某文件中已解析的 AST 节点（类、函数、变量），直接使用静态分析结果，无需重新解析",
        "input_schema": {"path": str}
    },
    {
        "name": "get_call_graph",
        "description": "返回某节点的调用关系子图（深度可配置，默认 depth=1）",
        "input_schema": {"node_id": str, "depth": int = 1}
    },
    {
        "name": "get_imports",
        "description": "返回某文件的 import 依赖列表（已由静态分析解析好）",
        "input_schema": {"path": str}
    },
    {
        "name": "emit_graph",
        "description": "【终止工具】提交最终图谱结果，调用后 Agent 停止探索",
        "input_schema": {
            "nodes": list[NodeSpec],   # {type, name, properties}
            "edges": list[EdgeSpec],   # {from, to, type, properties}
            "confidence": float,
            "exploration_summary": str
        }
    }
]
```

### Agent 行为约束

**预算控制**（硬限制，不可配置）：
- 最多 `max_tool_calls=20` 次工具调用（`emit_graph` 不计入）
- 超出预算时强制触发 `emit_graph`（使用已收集信息）

**探索优先级引导**（写入 system prompt）：
```
探索顺序建议：
1. 先读 list_directory("/") 了解顶层结构
2. 优先读入口文件（main.py, app.py, server.py, __init__.py）
3. 对"看起来核心"的模块，用 get_ast_nodes + get_call_graph 获取结构
4. 对"不确定语义"的代码，用 read_file 读源码
5. 确认充分后调用 emit_graph
```

**输出节点类型约束**（写入 system prompt）：
Agent 只能输出 `graph_schema.py` 中已定义的节点/边类型，非法类型由 `OutputParser` 过滤并记录警告。

## 初始上下文设计

### ContextBuilder 输出结构

Agent 启动时收到的初始上下文（`user` 消息），由 `ContextBuilder.build(summary)` 生成：

```
# Repository: {repo_name}
# Languages: {languages}
# Git commit: {commit_sha}

## File Tree (top 3 levels)
{directory_tree}          ← 目录树，超过 100 行截断

## Modules ({count} total)
{module_list}             ← 每行: "  - backend/auth/ (12 files, 8 functions)"

## Key Functions (top 50 by call frequency)
{function_list}           ← 按 PageRank 排序，每行: "  - auth.verify_token (called 23x)"

## Call Graph Sample (top 40 edges)
{call_graph}              ← 每行: "  create_order → validate_payment"

## APIs ({count} endpoints)
{api_list}                ← 每行: "  POST /users/register → register_user()"

## Events/Topics ({count})
{event_list}              ← Kafka/RabbitMQ topics

## Existing Nodes from Static Analysis
{node_summary}            ← 静态分析已产生的节点统计: "Function:1200, Module:45, ..."

---
Your goal: explore this repository and emit a complete knowledge graph.
Call tools to explore, then call emit_graph() when ready.
Budget: {max_tool_calls} tool calls remaining.
```

### System Prompt 核心段落

```
You are a senior software architect analyzing a code repository.
You have access to tools to explore the codebase.

## Your Mission
Produce a complete knowledge graph with GraphNode and GraphEdge objects.
Focus on HIGH-LEVEL semantic nodes that static analysis cannot detect:
- LAYER nodes (architectural layers)
- SERVICE nodes (microservice boundaries)
- FLOW nodes (business processes end-to-end)
- DATA_OBJECT nodes (domain entities)
- Semantic edges: BELONGS_TO, FLOW_STEP, TRANSFORMS, DEPENDS_ON

Do NOT re-emit nodes that static analysis already produced
(Module, File, Function, Class are already in the graph).
Focus on SEMANTIC ENRICHMENT.

## Output Quality Rules
1. Only emit node types defined in the schema
2. Confidence < 0.6 → do not emit that node
3. Every edge must reference existing node IDs (from static analysis or nodes you emit)
4. Provide exploration_summary explaining your reasoning
```

**关键设计决策**：System Prompt 明确告诉 Agent **不要重复**静态分析已有的节点（Function/Module/File），只补充语义层节点。这避免了输出膨胀，也让 Agent 能聚焦在真正需要 AI 理解的内容上。

## 流水线集成

### analyze_repository.py 中步骤 10 的变化

```python
# 原来（4步，串行）:
for cls_name in ["AIArchitectureAnalyzer", "AIServiceDetector",
                 "AIBusinessFlowAnalyzer", "AIDataLineageAnalyzer"]:
    analyzer = cls(llm_client)
    graph = analyzer.analyze(summary)
    builder.merge_graph(graph)

# 新（1步）:
agent = AIGraphAgent(
    llm_client=llm_client,
    repo_path=repo_path,          # 用于工具访问文件系统
    static_graph=builder.snapshot(), # 静态图谱快照，供工具查询
    max_tool_calls=20,
)
graph = agent.analyze(summary)    # 返回 AIAnalysisGraph（duck typing 不变）
builder.merge_graph(graph)
step_stats["10_ai_agent"] = graph.meta
```

### 缓存策略（复用现有机制）

```python
# cache key 不变，只是 analyzer 名称改为 "AIGraphAgent"
cached = _ai_cache.get(repo_name, commit_sha, "AIGraphAgent")
if cached:
    builder.merge_graph(cached)
else:
    graph = agent.analyze(summary)
    _ai_cache.put(repo_name, commit_sha, "AIGraphAgent", graph)
```

## 错误处理与降级

### 错误处理策略

| 场景 | 处理方式 |
|------|----------|
| LLM 不可用 | `_fallback()`：关键字推断（复用原4个分析器的 fallback 逻辑） |
| 工具调用超预算 | 强制调用 `emit_graph`（使用已收集信息，不中断） |
| `emit_graph` JSON 无效 | `OutputParser` 过滤非法节点/边，记录 warning，返回合法子集 |
| 整个 agent 崩溃 | 记录 warning，pipeline 继续（与现有行为一致） |

### Fallback 实现

当 LLM 不可用或调用失败时，`AIGraphAgent._fallback()` 复用原 4 个分析器的静态推断逻辑：

- **架构层**：基于函数名后缀/关键字推断（controller → PresentationLayer，service → BusinessLayer）
- **服务边界**：每个顶层模块生成一个 Service 节点
- **业务流程**：每个 API 端点对应一个 Flow 节点
- **数据血缘**：基于函数名前缀推断（get → READS，save → WRITES）

## 新增文件清单

| 文件 | 说明 |
|------|------|
| `backend/analyzer/ai/agent/graph_agent.py` | 主类，LLM 工具循环 |
| `backend/analyzer/ai/agent/tools.py` | 7 个工具的实现 |
| `backend/analyzer/ai/agent/context_builder.py` | 初始上下文生成 |
| `backend/analyzer/ai/agent/output_parser.py` | `emit_graph` → GraphNode/GraphEdge |
| `backend/analyzer/ai/prompts/graph_agent.txt` | System prompt 模板 |

**删除/保留**：原 4 个分析器文件**保留**（不删除），`analyze_repository.py` 中默认改用 `AIGraphAgent`，原分析器可通过 `--legacy-ai` 参数启用，方便对比。

## 实现计划

### 阶段 1：基础设施（工具 + 上下文）

1. 实现 `tools.py` 中的 7 个工具函数
2. 实现 `context_builder.py`，生成初始上下文
3. 实现 `output_parser.py`，解析 `emit_graph` 输出

### 阶段 2：Agent 主循环

1. 实现 `graph_agent.py` 的 LLM 工具调用循环
2. 实现预算控制和强制终止逻辑
3. 实现 `_fallback()` 方法（复用原分析器逻辑）

### 阶段 3：Prompt 工程

1. 编写 `prompts/graph_agent.txt` 模板
2. 测试并优化 system prompt（探索顺序、输出质量规则）

### 阶段 4：流水线集成

1. 修改 `analyze_repository.py`，替换步骤 10-13
2. 添加 `--legacy-ai` 参数支持旧分析器
3. 更新缓存逻辑

### 阶段 5：测试与优化

1. 在小型仓库（< 100 文件）测试完整流程
2. 在中型仓库（100-500 文件）测试预算控制
3. 对比新旧分析器的输出质量和耗时

## 成功指标

- **准确性**：AI 生成的节点/边置信度 >= 0.7（平均）
- **覆盖率**：识别出至少 80% 的核心架构模式（与人工标注对比）
- **成本**：平均工具调用次数 <= 15 次/仓库
- **性能**：分析耗时 <= 原 4 个分析器总和的 1.5 倍

## 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| 20 轮工具调用不够 | 初始上下文已包含丰富摘要，Agent 只需针对性探索；超预算时强制输出 |
| Agent 输出格式不稳定 | `OutputParser` 容错解析；非法节点/边过滤而非拒绝整个输出 |
| 大型仓库性能问题 | 工具自动截断（文件最多 200 行，目录树最多 100 行） |
| 与现有 pipeline 不兼容 | 保留旧分析器，通过 `--legacy-ai` 回退 |

## 未来扩展

- **动态预算分配**：根据仓库规模自动调整 `max_tool_calls`
- **多轮对话**：允许用户在 Agent 探索后追问（"再看看认证模块"）
- **并行探索**：将 Agent 拆分为多个 Worker，并行探索不同模块
- **增量更新**：Git diff 驱动的局部重新探索

## 总结

通过 `AIGraphAgent` 替代现有的 4 个 AI 分析器，系统能够：

1. **主动探索**：LLM 自主决定读取哪些代码，而非被动接收截断摘要
2. **全局视角**：单一 Agent 跨文件建立语义关联，输出更准确
3. **成本可控**：20 轮工具调用预算 + 初始上下文，平衡准确性与成本
4. **向后兼容**：保留旧分析器，支持 `--legacy-ai` 回退

这是一次端到端的架构升级，将 AI 分析从"静态推断"提升为"主动理解"。
