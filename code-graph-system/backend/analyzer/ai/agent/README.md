# AI Graph Agent

AI 驱动的代码图谱分析 Agent，使用 LLM 进行自主代码探索，识别高层架构模式。

## 组件

### 1. AIGraphAgent (graph_agent.py)

核心 Agent 类，负责：
- 管理 LLM 工具调用循环
- 控制预算（最多 20 次工具调用）
- 解析工具调用结果
- 输出知识图谱

### 2. AgentTools (tools.py)

提供 7 个探索工具：
- `read_file`: 读取文件内容
- `list_directory`: 列出目录内容
- `search_code`: 搜索代码模式
- `get_ast_nodes`: 获取 AST 节点
- `get_call_graph`: 获取调用图
- `get_imports`: 获取导入依赖
- `emit_graph`: 提交最终图谱（终止信号）

### 3. ContextBuilder (context_builder.py)

构建初始上下文提示，包含：
- 仓库概览
- 静态分析摘要
- 工具说明
- 预算提示

### 4. OutputParser (output_parser.py)

解析 `emit_graph` 输出的 JSON，转换为 GraphNode 和 GraphEdge 对象，并进行容错处理。

## 使用示例

```python
from backend.analyzer.ai.agent.graph_agent import AIGraphAgent
from backend.graph.graph_builder import BuiltGraph
from backend.pipeline.repo_summary_builder import RepoSummary, RepoSummaryBuilder
import anthropic

# 1. 准备静态图谱和摘要
built_graph = ...  # 来自 GraphBuilder
summary_builder = RepoSummaryBuilder()
summary = summary_builder.build_summary(built_graph)

# 2. 创建 LLM 客户端
llm_client = anthropic.Anthropic(api_key="your-api-key")

# 3. 创建 Agent
agent = AIGraphAgent(
    llm_client=llm_client,
    repo_path="/path/to/repo",
    static_graph=built_graph,
    max_tool_calls=20,
)

# 4. 执行分析
result = agent.analyze(summary)

# 5. 使用结果
print(f"发现 {len(result['nodes'])} 个语义节点")
print(f"发现 {len(result['edges'])} 条语义边")
```

## 输出格式

```python
{
    "nodes": [GraphNode],  # 语义节点列表（Layer, Service, Flow, DataObject）
    "edges": [GraphEdge],  # 语义边列表
    "meta": {
        "exploration_summary": str,  # Agent 的探索总结
        "tool_calls_used": int,      # 使用的工具调用次数
        ...
    }
}
```

## 测试

运行测试：
```bash
pytest backend/tests/test_graph_agent.py -v
```

测试覆盖：
- Agent 初始化
- emit_graph 终止循环
- 预算耗尽处理
- 工具执行错误处理
