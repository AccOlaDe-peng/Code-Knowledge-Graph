"""模块检测 Agent。"""

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


class ModuleDetectorAgent(BaseAgent):
    """模块检测 Agent。

    职责：
    - 识别仓库中的模块边界
    - 检测入口文件和配置文件
    - 识别模块间的依赖关系
    """

    def __init__(self, context: AgentContext, llm_client: LLMClient):
        super().__init__(
            agent_type="module_detector",
            context=context,
            llm_client=llm_client,
        )
        self._file_tools = FileTools(context.repo_path)

        # 注册工具
        self.register_tool(
            name="list_directory",
            description="列出目录结构，用于了解项目布局",
            input_schema={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "相对路径，空字符串表示根目录"},
                    "max_depth": {"type": "integer", "description": "最大遍历深度", "default": 2},
                },
            },
        )
        self.register_tool(
            name="read_file",
            description="读取文件内容",
            input_schema={
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "文件路径"},
                    "start_line": {"type": "integer", "description": "起始行号", "default": 0},
                    "end_line": {"type": "integer", "description": "结束行号"},
                },
                "required": ["path"],
            },
        )
        self.register_tool(
            name="search_code",
            description="搜索代码模式",
            input_schema={
                "type": "object",
                "properties": {
                    "pattern": {"type": "string", "description": "搜索模式"},
                    "file_pattern": {"type": "string", "description": "文件通配符", "default": "*.py"},
                },
                "required": ["pattern"],
            },
        )

    def get_system_prompt(self) -> str:
        return """你是一个代码仓库分析专家。你的任务是识别仓库中的模块结构。

你需要：
1. 扫描目录结构，识别模块边界
2. 找出入口文件（main.py, app.py, index.ts 等）
3. 找出配置文件（pyproject.toml, package.json 等）
4. 识别模块间的依赖关系

输出格式（JSON）：
{
  "modules": [
    {
      "module_id": "module:xxx",
      "name": "ModuleName",
      "path": "path/to/module",
      "module_type": "service|library|shared|config",
      "language": "python|typescript|go",
      "framework": "fastapi|express|gin",
      "entry_points": ["main.py"],
      "dependencies": ["module:yyy"],
      "confidence": 0.9
    }
  ],
  "entry_files": ["main.py"],
  "config_files": ["pyproject.toml"]
}

只输出 JSON，不要其他解释。"""

    def run(self) -> AgentOutput:
        """执行模块检测。"""
        start_time = time.time()

        # 初始消息
        messages = [{
            "role": "user",
            "content": f"""请分析以下仓库的模块结构：

仓库路径: {self.context.repo_path}

使用 list_directory 工具查看目录结构，使用 read_file 工具查看关键文件内容。
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
                # 尝试从 final_message 中提取 JSON
                content = result.final_message
                if "```json" in content:
                    content = content.split("```json")[1].split("```")[0]
                elif "```" in content:
                    content = content.split("```")[1].split("```")[0]

                data = json.loads(content.strip())

                # 转换为 GraphNode
                nodes = []
                edges = []

                for mod in data.get("modules", []):
                    nodes.append(GraphNode(
                        id=mod["module_id"],
                        type="Module",
                        name=mod["name"],
                        properties={
                            "path": mod["path"],
                            "module_type": mod.get("module_type", "unknown"),
                            "language": mod.get("language", "unknown"),
                            "framework": mod.get("framework", ""),
                            "confidence": mod.get("confidence", 1.0),
                        },
                    ))

                    for dep in mod.get("dependencies", []):
                        edges.append(GraphEdge(
                            from_=mod["module_id"],
                            to=dep,
                            type="depends_on",
                            properties={},
                        ))

                return self.create_output(
                    status="success",
                    nodes=nodes,
                    edges=edges,
                    execution_time_ms=execution_time_ms,
                    iterations=result.iterations,
                    tool_calls=len(result.tool_calls),
                )

            except json.JSONDecodeError as e:
                logger.error(f"解析 LLM 响应失败: {e}")
                return self.create_output(
                    status="failed",
                    execution_time_ms=execution_time_ms,
                    errors=[{"code": "PARSE_ERROR", "message": str(e)}],
                )

        return self.create_output(
            status=result.status,
            execution_time_ms=execution_time_ms,
            errors=[{"code": "INCOMPLETE", "message": "Agent 未完成分析"}],
        )