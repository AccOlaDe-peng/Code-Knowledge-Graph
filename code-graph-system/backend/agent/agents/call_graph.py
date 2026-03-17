"""调用图分析 Agent。

分析函数间的调用关系，识别同步/异步调用、入口点和热点函数。
"""

from __future__ import annotations

import json
import logging
import time

from backend.agent.base import BaseAgent
from backend.agent.context import AgentContext
from backend.agent.tools.file_tools import FileTools
from backend.graph.graph_schema import GraphNode, GraphEdge
from backend.llm.client import LLMClient
from backend.models.agent_output import AgentOutput

logger = logging.getLogger(__name__)


class CallGraphAgent(BaseAgent):
    """调用图分析 Agent。

    职责：
    - 分析函数间的调用关系
    - 识别同步调用（calls）和异步调用（async_calls）
    - 检测入口点（API handlers, event handlers）
    - 识别热点函数（被多次调用的函数）
    - 追踪调用链深度
    """

    def __init__(self, context: AgentContext, llm_client: LLMClient):
        super().__init__(
            agent_type="call_graph",
            context=context,
            llm_client=llm_client,
        )
        self._file_tools = FileTools(context.repo_path)

        # 注册工具
        self.register_tool(
            name="read_file",
            description="读取文件内容，分析函数调用",
            input_schema={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "文件路径"},
                    "start_line": {"type": "integer", "description": "起始行号"},
                    "end_line": {"type": "integer", "description": "结束行号"},
                },
                "required": ["path"],
            },
        )
        self.register_tool(
            name="search_code",
            description="搜索函数调用模式",
            input_schema={
                "type": "object",
                "properties": {
                    "pattern": {"type": "string", "description": "搜索模式"},
                    "file_pattern": {"type": "string", "default": "*.py"},
                },
                "required": ["pattern"],
            },
        )
        self.register_tool(
            name="list_directory",
            description="列出目录结构",
            input_schema={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "相对路径"},
                },
            },
        )

    def get_system_prompt(self) -> str:
        """返回调用图分析系统提示词。"""
        return """你是一个调用图分析专家。你的任务是分析代码中的函数调用关系。

## 任务目标

1. **识别函数调用**
   - 同步调用：`func()` / `obj.method()`
   - 异步调用：`await func()` / `asyncio.run()`
   - 回调模式：`on_success(callback)`

2. **识别入口点**
   - API handlers: `@app.route`, `@router.get`
   - Event handlers: `@event_handler`, `on_message`
   - Main functions: `if __name__ == "__main__"`

3. **追踪调用链**
   - 入口点 → 调用的函数 → 进一步调用
   - 标记跨模块调用
   - 检测循环调用

## 输出格式（JSON）

```json
{
  "functions": [
    {
      "function_id": "func:main",
      "name": "main",
      "file_path": "main.py",
      "line_start": 10,
      "line_end": 25,
      "is_entry_point": true,
      "is_async": false,
      "calls_to": ["func:init_db", "func:run_server"],
      "called_by": [],
      "side_effects": ["db_init", "network"],
      "confidence": 0.95
    }
  ],
  "call_edges": [
    {
      "from": "func:main",
      "to": "func:init_db",
      "type": "calls",
      "is_async": false,
      "line_number": 15
    },
    {
      "from": "func:main",
      "to": "func:run_server",
      "type": "async_calls",
      "is_async": true,
      "line_number": 16
    }
  ],
  "call_chains": [
    {
      "chain_id": "chain:api-login",
      "start": "func:handle_login",
      "end": "func:validate_token",
      "path": ["func:handle_login", "func:authenticate", "func:validate_token"],
      "depth": 3
    }
  ]
}
```

只输出 JSON，不要其他解释。"""

    def run(self) -> AgentOutput:
        """执行调用图分析。"""
        start_time = time.time()

        # 构建上下文信息
        func_info = ""
        if self.context.discoveries.functions:
            func_info = "\n## 已识别的函数\n"
            for func in self.context.discoveries.functions[:20]:  # 限制数量
                func_info += f"- {func.function_id}: {func.name} ({func.file_path}:{func.line_start})\n"

        # 初始消息
        messages = [{
            "role": "user",
            "content": f"""请分析以下代码的调用图：

仓库路径: {self.context.repo_path}
模块 ID: {self.context.module_id}
{func_info}

使用工具分析函数调用关系。
完成后输出 JSON 格式的分析结果。"""
        }]

        # 执行 tool call loop
        result = self.llm_client.tool_call_loop(
            system=self.get_system_prompt(),
            messages=messages,
            tools=self._tools,
            max_iterations=self.context.max_iterations,
            tool_executor=self._file_tools,
            context_monitor=self.context.context_monitor,
        )

        execution_time_ms = int((time.time() - start_time) * 1000)

        # 解析结果
        if result.status == "completed" and result.final_message:
            try:
                # 提取 JSON
                content = result.final_message
                if "```json" in content:
                    content = content.split("```json")[1].split("```")[0]
                elif "```" in content:
                    content = content.split("```")[1].split("```")[0]

                data = json.loads(content.strip())

                # 转换为图谱节点/边
                nodes = []
                edges = []

                # 创建 Function 节点
                for func in data.get("functions", []):
                    nodes.append(GraphNode(
                        id=func["function_id"],
                        type="Function",
                        name=func["name"],
                        properties={
                            "file_path": func.get("file_path", ""),
                            "line_start": func.get("line_start", 0),
                            "line_end": func.get("line_end", 0),
                            "is_entry_point": func.get("is_entry_point", False),
                            "is_async": func.get("is_async", False),
                            "side_effects": func.get("side_effects", []),
                            "confidence": func.get("confidence", 1.0),
                        },
                    ))

                # 创建调用边
                for edge in data.get("call_edges", []):
                    edges.append(GraphEdge(
                        from_=edge["from"],
                        to=edge["to"],
                        type=edge.get("type", "calls"),
                        properties={
                            "is_async": edge.get("is_async", False),
                            "line_number": edge.get("line_number", 0),
                        },
                    ))

                # 创建 CallChain 节点和边
                for chain in data.get("call_chains", []):
                    chain_node = GraphNode(
                        id=chain["chain_id"],
                        type="CallChain",
                        name=f"Chain: {chain['start']} → {chain['end']}",
                        properties={
                            "start": chain["start"],
                            "end": chain["end"],
                            "depth": chain.get("depth", 0),
                        },
                    )
                    nodes.append(chain_node)

                    # CallChain 包含的函数
                    for func_id in chain.get("path", []):
                        edges.append(GraphEdge(
                            from_=chain["chain_id"],
                            to=func_id,
                            type="contains",
                            properties={},
                        ))

                # 更新 Discovery
                from backend.models.discovery import FunctionDiscovery, CallChainDiscovery
                for func in data.get("functions", []):
                    self.context.discoveries.functions.append(FunctionDiscovery(
                        function_id=func["function_id"],
                        name=func["name"],
                        file_path=func.get("file_path", ""),
                        line_start=func.get("line_start", 0),
                        line_end=func.get("line_end", 0),
                        is_async=func.get("is_async", False),
                        is_entry_point=func.get("is_entry_point", False),
                        calls_to=func.get("calls_to", []),
                        called_by=func.get("called_by", []),
                        side_effects=func.get("side_effects", []),
                        confidence=func.get("confidence", 1.0),
                    ))

                for chain in data.get("call_chains", []):
                    self.context.discoveries.call_chains.append(CallChainDiscovery(
                        chain_id=chain["chain_id"],
                        start_function=chain["start"],
                        end_function=chain["end"],
                        path=chain.get("path", []),
                        depth=chain.get("depth", 0),
                        confidence=0.9,
                    ))

                return self.create_output(
                    status="success",
                    nodes=nodes,
                    edges=edges,
                    execution_time_ms=execution_time_ms,
                    function_count=len(data.get("functions", [])),
                    edge_count=len(data.get("call_edges", [])),
                    chain_count=len(data.get("call_chains", [])),
                    iterations=result.iterations,
                    tool_calls=len(result.tool_calls),
                )

            except json.JSONDecodeError as e:
                logger.error(f"解析调用图结果失败: {e}")
                return self.create_output(
                    status="failed",
                    execution_time_ms=execution_time_ms,
                    errors=[{"code": "PARSE_ERROR", "message": str(e)}],
                )

        return self.create_output(
            status=result.status,
            execution_time_ms=execution_time_ms,
            errors=[{"code": "INCOMPLETE", "message": "调用图分析未完成"}],
        )