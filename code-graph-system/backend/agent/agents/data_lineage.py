"""数据血缘分析 Agent。

追踪数据在系统中的流向，识别数据源、数据汇和转换关系。
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


class DataLineageAgent(BaseAgent):
    """数据血缘分析 Agent。

    职责：
    - 追踪数据流向（从数据源到数据汇）
    - 识别数据源（数据库、API、文件、用户输入）
    - 识别数据汇（数据库、API、文件、日志）
    - 检测数据转换关系（DTO → Entity → VO）
    - 标记敏感数据处理
    """

    # 数据源类型
    SOURCE_TYPES = {
        "database": ["db", "database", "sql", "query", "find", "get"],
        "api": ["api", "fetch", "request", "http", "get", "post"],
        "file": ["file", "read", "load", "parse", "csv", "json"],
        "user_input": ["input", "form", "request", "body", "params"],
        "message_queue": ["kafka", "rabbitmq", "queue", "consume", "subscribe"],
    }

    # 数据汇类型
    SINK_TYPES = {
        "database": ["save", "insert", "update", "create", "write", "db"],
        "api": ["response", "return", "send", "post", "put"],
        "file": ["write", "save", "export", "generate"],
        "log": ["log", "logger", "print", "debug", "info", "error"],
        "message_queue": ["publish", "produce", "send", "emit"],
    }

    def __init__(self, context: AgentContext, llm_client: LLMClient):
        super().__init__(
            agent_type="data_lineage",
            context=context,
            llm_client=llm_client,
        )
        self._file_tools = FileTools(context.repo_path)

        # 注册工具
        self.register_tool(
            name="read_file",
            description="读取文件内容，分析数据处理",
            input_schema={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "文件路径"},
                },
                "required": ["path"],
            },
        )
        self.register_tool(
            name="search_code",
            description="搜索数据访问模式",
            input_schema={
                "type": "object",
                "properties": {
                    "pattern": {"type": "string", "description": "搜索模式"},
                    "file_pattern": {"type": "string", "default": "*.py"},
                },
                "required": ["pattern"],
            },
        )

    def get_system_prompt(self) -> str:
        """返回数据血缘分析系统提示词。"""
        return """你是一个数据血缘分析专家。你的任务是追踪数据在系统中的流向。

## 任务目标

1. **识别数据源**
   - 数据库查询（SELECT, find, get）
   - API 调用（fetch, request）
   - 文件读取（read, load）
   - 用户输入（form data, request body）
   - 消息队列（consume, subscribe）

2. **识别数据汇**
   - 数据库写入（INSERT, UPDATE, save）
   - API 响应（return, response）
   - 文件输出（write, export）
   - 日志输出（log, print）
   - 消息发布（publish, emit）

3. **追踪数据转换**
   - DTO → Entity → VO 转换链
   - 数据清洗和验证
   - 敏感数据处理（加密、脱敏）

## 输出格式（JSON）

```json
{
  "data_sources": [
    {
      "source_id": "source:postgres-users",
      "type": "database",
      "name": "PostgreSQL Users Table",
      "location": "database://postgres/users",
      "accessed_by": ["func:get_user", "func:list_users"],
      "confidence": 0.9
    }
  ],
  "data_sinks": [
    {
      "sink_id": "sink:api-response",
      "type": "api",
      "name": "API Response",
      "location": "response://api/v1/users",
      "written_by": ["func:get_user"],
      "confidence": 0.95
    }
  ],
  "data_flows": [
    {
      "flow_id": "flow:user-login",
      "source_type": "database",
      "source_location": "database://postgres/users",
      "sink_type": "api",
      "sink_location": "response://api/v1/login",
      "transformations": ["UserDTO → UserEntity", "password hash verify"],
      "functions_involved": ["func:login", "func:verify_password", "func:generate_token"],
      "sensitive_data": ["password", "token"],
      "confidence": 0.85
    }
  ],
  "data_objects": [
    {
      "object_id": "dto:UserDTO",
      "name": "UserDTO",
      "object_type": "dto",
      "file_path": "models/dto.py",
      "fields": [
        {"name": "id", "type": "int"},
        {"name": "username", "type": "str"}
      ],
      "transforms_to": ["entity:User"],
      "transforms_from": []
    }
  ]
}
```

只输出 JSON，不要其他解释。"""

    def run(self) -> AgentOutput:
        """执行数据血缘分析。"""
        start_time = time.time()

        # 构建上下文信息
        data_info = ""
        if self.context.discoveries.data_objects:
            data_info = "\n## 已识别的数据对象\n"
            for obj in self.context.discoveries.data_objects[:10]:
                data_info += f"- {obj.object_id}: {obj.name} ({obj.object_type})\n"

        # 初始消息
        messages = [{
            "role": "user",
            "content": f"""请分析以下代码的数据血缘：

仓库路径: {self.context.repo_path}
模块 ID: {self.context.module_id}
{data_info}

使用工具分析数据流向和转换关系。
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

                # 创建 DataSource 节点
                for source in data.get("data_sources", []):
                    nodes.append(GraphNode(
                        id=source["source_id"],
                        type="DataSource",
                        name=source["name"],
                        properties={
                            "source_type": source["type"],
                            "location": source["location"],
                            "accessed_by": source.get("accessed_by", []),
                            "confidence": source.get("confidence", 1.0),
                        },
                    ))

                # 创建 DataSink 节点
                for sink in data.get("data_sinks", []):
                    nodes.append(GraphNode(
                        id=sink["sink_id"],
                        type="DataSink",
                        name=sink["name"],
                        properties={
                            "sink_type": sink["type"],
                            "location": sink["location"],
                            "written_by": sink.get("written_by", []),
                            "confidence": sink.get("confidence", 1.0),
                        },
                    ))

                # 创建 DataObject 节点
                for obj in data.get("data_objects", []):
                    nodes.append(GraphNode(
                        id=obj["object_id"],
                        type="DataObject",
                        name=obj["name"],
                        properties={
                            "object_type": obj.get("object_type", "unknown"),
                            "file_path": obj.get("file_path", ""),
                            "fields": obj.get("fields", []),
                            "confidence": 0.9,
                        },
                    ))

                    # transforms_to 边
                    for target in obj.get("transforms_to", []):
                        edges.append(GraphEdge(
                            from_=obj["object_id"],
                            to=target,
                            type="transforms",
                            properties={},
                        ))

                # 创建数据流边
                for flow in data.get("data_flows", []):
                    # 创建 Flow 节点
                    nodes.append(GraphNode(
                        id=flow["flow_id"],
                        type="Flow",
                        name=f"Flow: {flow['source_location']} → {flow['sink_location']}",
                        properties={
                            "source_type": flow["source_type"],
                            "source_location": flow["source_location"],
                            "sink_type": flow["sink_type"],
                            "sink_location": flow["sink_location"],
                            "transformations": flow.get("transformations", []),
                            "sensitive_data": flow.get("sensitive_data", []),
                            "confidence": flow.get("confidence", 1.0),
                        },
                    ))

                    # 函数参与关系
                    for func_id in flow.get("functions_involved", []):
                        edges.append(GraphEdge(
                            from_=func_id,
                            to=flow["flow_id"],
                            type="participates_in",
                            properties={},
                        ))

                # 更新 Discovery
                from backend.models.discovery import DataObjectDiscovery, DataFlowDiscovery

                for obj in data.get("data_objects", []):
                    self.context.discoveries.data_objects.append(DataObjectDiscovery(
                        object_id=obj["object_id"],
                        name=obj["name"],
                        object_type=obj.get("object_type", "unknown"),
                        file_path=obj.get("file_path", ""),
                        fields=obj.get("fields", []),
                        transforms_to=obj.get("transforms_to", []),
                        transforms_from=obj.get("transforms_from", []),
                        confidence=0.9,
                    ))

                for flow in data.get("data_flows", []):
                    self.context.discoveries.data_flows.append(DataFlowDiscovery(
                        flow_id=flow["flow_id"],
                        source_type=flow["source_type"],
                        source_location=flow["source_location"],
                        sink_type=flow["sink_type"],
                        sink_location=flow["sink_location"],
                        transformations=flow.get("transformations", []),
                        functions_involved=flow.get("functions_involved", []),
                        confidence=flow.get("confidence", 1.0),
                    ))

                return self.create_output(
                    status="success",
                    nodes=nodes,
                    edges=edges,
                    execution_time_ms=execution_time_ms,
                    source_count=len(data.get("data_sources", [])),
                    sink_count=len(data.get("data_sinks", [])),
                    flow_count=len(data.get("data_flows", [])),
                    iterations=result.iterations,
                    tool_calls=len(result.tool_calls),
                )

            except json.JSONDecodeError as e:
                logger.error(f"解析数据血缘结果失败: {e}")
                return self.create_output(
                    status="failed",
                    execution_time_ms=execution_time_ms,
                    errors=[{"code": "PARSE_ERROR", "message": str(e)}],
                )

        return self.create_output(
            status=result.status,
            execution_time_ms=execution_time_ms,
            errors=[{"code": "INCOMPLETE", "message": "数据血缘分析未完成"}],
        )