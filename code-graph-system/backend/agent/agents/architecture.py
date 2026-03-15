"""架构分析 Agent。

识别代码仓库的架构模式、分层结构和服务边界。
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


class ArchitectureAgent(BaseAgent):
    """架构分析 Agent。

    职责：
    - 识别分层架构（Presentation / Business / Data / Infrastructure）
    - 检测架构模式（MVC / Clean Architecture / Microservices / Monolith）
    - 识别服务边界
    - 生成 Layer 节点和 belongs_to 关系
    """

    # 标准架构层定义
    STANDARD_LAYERS = {
        "presentation": {
            "patterns": ["controller", "view", "handler", "api", "endpoint", "route"],
            "description": "处理用户交互和 API 请求",
        },
        "business": {
            "patterns": ["service", "domain", "usecase", "interactor", "manager", "logic"],
            "description": "业务逻辑和领域规则",
        },
        "data": {
            "patterns": ["repository", "dao", "model", "entity", "store", "db", "data"],
            "description": "数据访问和持久化",
        },
        "infrastructure": {
            "patterns": ["config", "util", "helper", "common", "lib", "core", "base"],
            "description": "基础设施和通用工具",
        },
    }

    def __init__(self, context: AgentContext, llm_client: LLMClient):
        super().__init__(
            agent_type="architecture",
            context=context,
            llm_client=llm_client,
        )
        self._file_tools = FileTools(context.repo_path)

        # 注册工具
        self.register_tool(
            name="list_directory",
            description="列出目录结构，了解项目布局",
            input_schema={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "相对路径"},
                    "max_depth": {"type": "integer", "default": 3},
                },
            },
        )
        self.register_tool(
            name="read_file",
            description="读取文件内容，分析架构模式",
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
            description="搜索代码模式，识别架构组件",
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
        """返回架构分析系统提示词。"""
        return """你是一个软件架构分析专家。你的任务是识别代码仓库的架构结构。

## 任务目标

1. **识别架构层**
   - Presentation Layer: 控制器、API 端点、视图
   - Business Layer: 服务、领域逻辑、用例
   - Data Layer: 仓库、DAO、数据模型
   - Infrastructure Layer: 配置、工具、基础设施

2. **检测架构模式**
   - MVC / MVVM
   - Clean Architecture / Hexagonal
   - Microservices / Monolith
   - Layered Architecture

3. **识别服务边界**
   - 主要服务/模块
   - 服务间依赖关系

## 输出格式（JSON）

```json
{
  "architecture_pattern": "Clean Architecture | MVC | Microservices | Monolith | Layered",
  "layers": [
    {
      "layer_id": "layer:presentation",
      "layer_type": "presentation",
      "name": "Presentation Layer",
      "description": "处理 HTTP 请求和响应",
      "modules": ["module:api", "module:controllers"],
      "entry_points": ["main.py", "app.py"],
      "confidence": 0.9
    }
  ],
  "services": [
    {
      "service_id": "service:user-service",
      "name": "UserService",
      "layer_id": "layer:business",
      "description": "用户管理服务",
      "dependencies": ["service:auth-service"],
      "confidence": 0.85
    }
  ],
  "layer_dependencies": [
    {"from": "layer:presentation", "to": "layer:business", "type": "depends_on"}
  ]
}
```

只输出 JSON，不要其他解释。使用工具探索代码库后，输出分析结果。"""

    def run(self) -> AgentOutput:
        """执行架构分析。"""
        start_time = time.time()

        # 构建上下文信息
        module_info = ""
        if self.context.shared_knowledge.modules:
            module_info = "\n## 已识别的模块\n"
            for mod in self.context.shared_knowledge.modules:
                module_info += f"- {mod.get('id', '?')}: {mod.get('name', '?')} ({mod.get('path', '?')})\n"

        # 初始消息
        messages = [{
            "role": "user",
            "content": f"""请分析以下仓库的架构结构：

仓库路径: {self.context.repo_path}
{module_info}

使用工具探索代码库，识别架构层和服务边界。
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

                # 创建 Layer 节点
                for layer in data.get("layers", []):
                    nodes.append(GraphNode(
                        id=layer["layer_id"],
                        type="Layer",
                        name=layer["name"],
                        properties={
                            "layer_type": layer["layer_type"],
                            "description": layer.get("description", ""),
                            "modules": layer.get("modules", []),
                            "entry_points": layer.get("entry_points", []),
                            "confidence": layer.get("confidence", 1.0),
                        },
                    ))

                # 创建 Service 节点
                for svc in data.get("services", []):
                    nodes.append(GraphNode(
                        id=svc["service_id"],
                        type="Service",
                        name=svc["name"],
                        properties={
                            "description": svc.get("description", ""),
                            "layer_id": svc.get("layer_id", ""),
                            "confidence": svc.get("confidence", 1.0),
                        },
                    ))

                    # Service -> Layer 关系
                    if svc.get("layer_id"):
                        edges.append(GraphEdge(
                            from_=svc["service_id"],
                            to=svc["layer_id"],
                            type="belongs_to",
                            properties={},
                        ))

                    # Service 依赖关系
                    for dep in svc.get("dependencies", []):
                        edges.append(GraphEdge(
                            from_=svc["service_id"],
                            to=dep,
                            type="depends_on",
                            properties={},
                        ))

                # Layer 依赖关系
                for dep in data.get("layer_dependencies", []):
                    edges.append(GraphEdge(
                        from_=dep["from"],
                        to=dep["to"],
                        type=dep.get("type", "depends_on"),
                        properties={},
                    ))

                # 更新共享知识库
                for layer in data.get("layers", []):
                    self.context.shared_knowledge.layers.append({
                        "id": layer["layer_id"],
                        "name": layer["name"],
                        "layer_type": layer["layer_type"],
                    })

                return self.create_output(
                    status="success",
                    nodes=nodes,
                    edges=edges,
                    execution_time_ms=execution_time_ms,
                    architecture_pattern=data.get("architecture_pattern", "Unknown"),
                    iterations=result.iterations,
                    tool_calls=len(result.tool_calls),
                )

            except json.JSONDecodeError as e:
                logger.error(f"解析架构分析结果失败: {e}")
                return self.create_output(
                    status="failed",
                    execution_time_ms=execution_time_ms,
                    errors=[{"code": "PARSE_ERROR", "message": str(e)}],
                )

        return self.create_output(
            status=result.status,
            execution_time_ms=execution_time_ms,
            errors=[{"code": "INCOMPLETE", "message": "架构分析未完成"}],
        )