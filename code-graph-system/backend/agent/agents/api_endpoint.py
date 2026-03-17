"""API 端点分析 Agent。

识别 HTTP API 端点、请求/响应结构和处理函数。
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


class APIEndpointAgent(BaseAgent):
    """API 端点分析 Agent。

    职责：
    - 识别 HTTP API 端点（REST/GraphQL）
    - 检测 HTTP 方法（GET/POST/PUT/DELETE）
    - 分析请求/响应数据结构
    - 关联处理函数
    - 识别认证/授权要求
    """

    # API 框架模式
    FRAMEWORK_PATTERNS = {
        "fastapi": {
            "decorators": ["@app.get", "@app.post", "@app.put", "@app.delete",
                          "@router.get", "@router.post", "@router.put", "@router.delete"],
            "imports": ["from fastapi import", "from fastapi.routing"],
        },
        "flask": {
            "decorators": ["@app.route", "@blueprint.route", "@bp.route"],
            "imports": ["from flask import", "from flask import Blueprint"],
        },
        "django": {
            "patterns": ["urlpatterns", "path(", "re_path("],
            "imports": ["from django.urls", "from django.http"],
        },
        "express": {
            "patterns": ["app.get(", "app.post(", "router.get(", "router.post("],
        },
    }

    def __init__(self, context: AgentContext, llm_client: LLMClient):
        super().__init__(
            agent_type="api_endpoint",
            context=context,
            llm_client=llm_client,
        )
        self._file_tools = FileTools(context.repo_path)

        # 注册工具
        self.register_tool(
            name="search_code",
            description="搜索 API 路由装饰器和端点定义",
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
            name="read_file",
            description="读取 API 定义文件",
            input_schema={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "文件路径"},
                },
                "required": ["path"],
            },
        )
        self.register_tool(
            name="list_directory",
            description="列出目录结构，查找 API 模块",
            input_schema={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "相对路径"},
                },
            },
        )

    def get_system_prompt(self) -> str:
        """返回 API 端点分析系统提示词。"""
        return """你是一个 API 分析专家。你的任务是识别代码中的 HTTP API 端点。

## 任务目标

1. **识别 API 端点**
   - REST API: @app.get, @app.post, @router.route
   - GraphQL: Query, Mutation, Subscription
   - WebSocket: @websocket.route

2. **提取端点信息**
   - HTTP 方法（GET/POST/PUT/DELETE/PATCH）
   - URL 路径（/api/users/{id}）
   - 处理函数名称
   - 请求/响应数据类型

3. **识别认证要求**
   - @require_auth, @login_required
   - Depends(get_current_user)
   - 权限检查

## 输出格式（JSON）

```json
{
  "framework": "fastapi | flask | django | express",
  "api_endpoints": [
    {
      "endpoint_id": "endpoint:get-users",
      "method": "GET",
      "path": "/api/users",
      "handler_function": "func:list_users",
      "module_id": "module:api-users",
      "request_type": "UserQuery",
      "response_type": "UserListResponse",
      "auth_required": true,
      "description": "获取用户列表",
      "line_number": 25,
      "confidence": 0.95
    }
  ],
  "api_groups": [
    {
      "group_id": "group:user-api",
      "name": "User API",
      "base_path": "/api/users",
      "endpoints": ["endpoint:get-users", "endpoint:get-user", "endpoint:create-user"]
    }
  ]
}
```

只输出 JSON，不要其他解释。"""

    def run(self) -> AgentOutput:
        """执行 API 端点分析。"""
        start_time = time.time()

        # 构建上下文信息
        module_info = ""
        if self.context.shared_knowledge.modules:
            module_info = "\n## 相关模块\n"
            for mod in self.context.shared_knowledge.modules[:10]:
                module_info += f"- {mod.get('id', '?')}: {mod.get('name', '?')} ({mod.get('path', '?')})\n"

        func_info = ""
        if self.context.discoveries.functions:
            func_info = "\n## 已识别的函数\n"
            for func in self.context.discoveries.functions[:15]:
                func_info += f"- {func.function_id}: {func.name}\n"

        # 初始消息
        messages = [{
            "role": "user",
            "content": f"""请分析以下代码的 API 端点：

仓库路径: {self.context.repo_path}
模块 ID: {self.context.module_id}
{module_info}
{func_info}

使用工具搜索 API 路由定义，分析端点结构。
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

                # 创建 APIEndpoint 节点
                for ep in data.get("api_endpoints", []):
                    nodes.append(GraphNode(
                        id=ep["endpoint_id"],
                        type="APIEndpoint",
                        name=f"{ep['method']} {ep['path']}",
                        properties={
                            "method": ep["method"],
                            "path": ep["path"],
                            "handler_function": ep.get("handler_function", ""),
                            "request_type": ep.get("request_type", ""),
                            "response_type": ep.get("response_type", ""),
                            "auth_required": ep.get("auth_required", False),
                            "description": ep.get("description", ""),
                            "line_number": ep.get("line_number", 0),
                            "confidence": ep.get("confidence", 1.0),
                        },
                    ))

                    # handler_function → endpoint (handles 边)
                    if ep.get("handler_function"):
                        edges.append(GraphEdge(
                            from_=ep["handler_function"],
                            to=ep["endpoint_id"],
                            type="handles",
                            properties={},
                        ))

                    # module → endpoint (contains 边)
                    if ep.get("module_id"):
                        edges.append(GraphEdge(
                            from_=ep["module_id"],
                            to=ep["endpoint_id"],
                            type="contains",
                            properties={},
                        ))

                # 创建 APIGroup 节点
                for group in data.get("api_groups", []):
                    nodes.append(GraphNode(
                        id=group["group_id"],
                        type="APIGroup",
                        name=group["name"],
                        properties={
                            "base_path": group.get("base_path", ""),
                        },
                    ))

                    # group → endpoint (contains 边)
                    for ep_id in group.get("endpoints", []):
                        edges.append(GraphEdge(
                            from_=group["group_id"],
                            to=ep_id,
                            type="contains",
                            properties={},
                        ))

                # 更新 Discovery
                from backend.models.discovery import APIEndpointDiscovery

                for ep in data.get("api_endpoints", []):
                    self.context.discoveries.api_endpoints.append(APIEndpointDiscovery(
                        endpoint_id=ep["endpoint_id"],
                        method=ep["method"],
                        path=ep["path"],
                        handler_function=ep.get("handler_function", ""),
                        module_id=ep.get("module_id", ""),
                        confidence=ep.get("confidence", 1.0),
                    ))

                return self.create_output(
                    status="success",
                    nodes=nodes,
                    edges=edges,
                    execution_time_ms=execution_time_ms,
                    framework=data.get("framework", "unknown"),
                    endpoint_count=len(data.get("api_endpoints", [])),
                    group_count=len(data.get("api_groups", [])),
                    iterations=result.iterations,
                    tool_calls=len(result.tool_calls),
                )

            except json.JSONDecodeError as e:
                logger.error(f"解析 API 端点结果失败: {e}")
                return self.create_output(
                    status="failed",
                    execution_time_ms=execution_time_ms,
                    errors=[{"code": "PARSE_ERROR", "message": str(e)}],
                )

        return self.create_output(
            status=result.status,
            execution_time_ms=execution_time_ms,
            errors=[{"code": "INCOMPLETE", "message": "API 端点分析未完成"}],
        )