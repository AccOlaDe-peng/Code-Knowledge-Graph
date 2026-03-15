"""跨模块分析 Agent。

分析模块间的依赖关系、服务边界和跨模块调用。
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


class CrossModuleAgent(BaseAgent):
    """跨模块分析 Agent。

    职责：
    - 分析模块间依赖关系
    - 检测循环依赖
    - 识别服务边界
    - 追踪跨模块调用链
    - 发现隐式耦合
    """

    def __init__(self, context: AgentContext, llm_client: LLMClient):
        super().__init__(
            agent_type="cross_module",
            context=context,
            llm_client=llm_client,
        )
        self._file_tools = FileTools(context.repo_path)

        # 注册工具
        self.register_tool(
            name="search_code",
            description="搜索跨模块导入和调用",
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
            description="读取模块入口文件",
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
            description="列出模块目录结构",
            input_schema={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "相对路径"},
                },
            },
        )

    def get_system_prompt(self) -> str:
        """返回跨模块分析系统提示词。"""
        return """你是一个跨模块依赖分析专家。你的任务是分析代码中模块间的依赖关系。

## 任务目标

1. **分析模块依赖**
   - import 语句（from X import Y）
   - 跨模块函数调用
   - 共享数据类型

2. **检测循环依赖**
   - A → B → A
   - A → B → C → A
   - 标记严重程度

3. **识别服务边界**
   - 高内聚模块组
   - 共享内核
   - 上下文映射

4. **发现隐式耦合**
   - 共享配置
   - 共享数据库表
   - 事件订阅关系

## 输出格式（JSON）

```json
{
  "module_dependencies": [
    {
      "from_module": "module:auth",
      "to_module": "module:user",
      "dependency_type": "import",
      "imports": ["UserService", "UserDTO"],
      "strength": 0.8,
      "line_numbers": [5, 12]
    }
  ],
  "circular_dependencies": [
    {
      "chain_id": "circular:auth-user",
      "modules": ["module:auth", "module:user"],
      "path": ["module:auth", "module:user", "module:auth"],
      "severity": "high",
      "suggestion": "考虑引入共享接口层"
    }
  ],
  "service_boundaries": [
    {
      "boundary_id": "boundary:identity",
      "name": "Identity Context",
      "modules": ["module:auth", "module:user", "module:permission"],
      "cohesion_score": 0.85,
      "description": "用户身份和权限管理"
    }
  ],
  "cross_module_calls": [
    {
      "call_id": "call:auth-to-user",
      "from_function": "func:authenticate",
      "to_function": "func:get_user",
      "from_module": "module:auth",
      "to_module": "module:user",
      "is_async": false
    }
  ]
}
```

只输出 JSON，不要其他解释。"""

    def run(self) -> AgentOutput:
        """执行跨模块分析。"""
        start_time = time.time()

        # 构建上下文信息
        module_info = ""
        if self.context.shared_knowledge.modules:
            module_info = "\n## 已识别的模块\n"
            for mod in self.context.shared_knowledge.modules:
                module_info += f"- {mod.get('id', '?')}: {mod.get('name', '?')} ({mod.get('path', '?')})\n"

        func_info = ""
        if self.context.discoveries.functions:
            func_info = "\n## 已识别的函数（跨模块）\n"
            cross_module_funcs = [
                f for f in self.context.discoveries.functions
                if len(f.calls_to) > 0 or len(f.called_by) > 0
            ][:20]
            for func in cross_module_funcs:
                func_info += f"- {func.function_id}: calls={len(func.calls_to)}, called_by={len(func.called_by)}\n"

        # 初始消息
        messages = [{
            "role": "user",
            "content": f"""请分析以下代码的跨模块关系：

仓库路径: {self.context.repo_path}
{module_info}
{func_info}

使用工具搜索跨模块导入和调用。
完成后输出 JSON 格式的分析结果。"""
        }]

        # 执行 tool call loop
        result = self.llm_client.tool_call_loop(
            system=self.get_system_prompt(),
            messages=messages,
            tools=self._tools,
            max_iterations=self.context.max_iterations,
            tool_executor=self._file_tools,
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

                # 创建模块依赖边
                for dep in data.get("module_dependencies", []):
                    edges.append(GraphEdge(
                        from_=dep["from_module"],
                        to=dep["to_module"],
                        type="depends_on",
                        properties={
                            "dependency_type": dep.get("dependency_type", "import"),
                            "imports": dep.get("imports", []),
                            "strength": dep.get("strength", 1.0),
                            "line_numbers": dep.get("line_numbers", []),
                        },
                    ))

                # 创建 CircularDependency 节点
                for circ in data.get("circular_dependencies", []):
                    nodes.append(GraphNode(
                        id=circ["chain_id"],
                        type="CircularDependency",
                        name=f"Circular: {' → '.join(circ['modules'])}",
                        properties={
                            "modules": circ["modules"],
                            "path": circ["path"],
                            "severity": circ.get("severity", "medium"),
                            "suggestion": circ.get("suggestion", ""),
                        },
                    ))

                    # 关联模块
                    for mod_id in circ["modules"]:
                        edges.append(GraphEdge(
                            from_=circ["chain_id"],
                            to=mod_id,
                            type="involves",
                            properties={},
                        ))

                # 创建 ServiceBoundary 节点
                for boundary in data.get("service_boundaries", []):
                    nodes.append(GraphNode(
                        id=boundary["boundary_id"],
                        type="ServiceBoundary",
                        name=boundary["name"],
                        properties={
                            "cohesion_score": boundary.get("cohesion_score", 0.0),
                            "description": boundary.get("description", ""),
                        },
                    ))

                    # boundary → module (contains 边)
                    for mod_id in boundary.get("modules", []):
                        edges.append(GraphEdge(
                            from_=boundary["boundary_id"],
                            to=mod_id,
                            type="contains",
                            properties={},
                        ))

                # 创建跨模块调用边
                for call in data.get("cross_module_calls", []):
                    edge_type = "async_calls" if call.get("is_async") else "calls"
                    edges.append(GraphEdge(
                        from_=call["from_function"],
                        to=call["to_function"],
                        type=edge_type,
                        properties={
                            "from_module": call["from_module"],
                            "to_module": call["to_module"],
                            "cross_module": True,
                        },
                    ))

                # 更新 Discovery
                from backend.models.discovery import CallChainDiscovery

                for call in data.get("cross_module_calls", []):
                    self.context.discoveries.call_chains.append(CallChainDiscovery(
                        chain_id=call["call_id"],
                        start_function=call["from_function"],
                        end_function=call["to_function"],
                        path=[call["from_function"], call["to_function"]],
                        is_cross_service=True,
                        is_async=call.get("is_async", False),
                        depth=1,
                        confidence=0.9,
                    ))

                return self.create_output(
                    status="success",
                    nodes=nodes,
                    edges=edges,
                    execution_time_ms=execution_time_ms,
                    dependency_count=len(data.get("module_dependencies", [])),
                    circular_count=len(data.get("circular_dependencies", [])),
                    boundary_count=len(data.get("service_boundaries", [])),
                    cross_call_count=len(data.get("cross_module_calls", [])),
                    iterations=result.iterations,
                    tool_calls=len(result.tool_calls),
                )

            except json.JSONDecodeError as e:
                logger.error(f"解析跨模块分析结果失败: {e}")
                return self.create_output(
                    status="failed",
                    execution_time_ms=execution_time_ms,
                    errors=[{"code": "PARSE_ERROR", "message": str(e)}],
                )

        return self.create_output(
            status=result.status,
            execution_time_ms=execution_time_ms,
            errors=[{"code": "INCOMPLETE", "message": "跨模块分析未完成"}],
        )