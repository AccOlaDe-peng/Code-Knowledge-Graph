"""Agent 基类。"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import Any

from backend.agent.context import AgentContext
from backend.llm.client import LLMClient
from backend.models.agent_output import AgentOutput

logger = logging.getLogger(__name__)


class BaseAgent(ABC):
    """Agent 基类。"""

    def __init__(
        self,
        agent_type: str,
        context: AgentContext,
        llm_client: LLMClient,
    ):
        self.agent_type = agent_type
        self.context = context
        self.llm_client = llm_client
        self._tools: list[dict] = []
        self._tool_executors: dict[str, Any] = {}

    def register_tool(self, name: str, description: str, input_schema: dict, executor: Any = None) -> None:
        """注册工具。executor 为可选的工具执行器对象，用于 per-tool 路由。"""
        self._tools.append({
            "name": name,
            "description": description,
            "input_schema": input_schema,
        })
        if executor is not None:
            self._tool_executors[name] = executor

    @abstractmethod
    def get_system_prompt(self) -> str:
        """返回 Agent 的系统提示词。"""
        pass

    @abstractmethod
    def run(self) -> AgentOutput:
        """执行 Agent 分析。"""
        pass

    def create_output(
        self,
        status: str,
        nodes: list = None,
        edges: list = None,
        errors: list = None,
        **meta
    ) -> AgentOutput:
        """创建标准输出。"""
        from backend.graph.graph_schema import GraphNode, GraphEdge
        from backend.models.agent_output import AgentError

        return AgentOutput(
            agent_type=self.agent_type,
            module_id=self.context.module_id,
            status=status,
            execution_time_ms=meta.get("execution_time_ms", 0),
            nodes=nodes or [],
            edges=edges or [],
            errors=errors or [],
            meta=meta,
        )