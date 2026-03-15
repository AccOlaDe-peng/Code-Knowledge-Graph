"""Agent 编排器。

协调多个专业 Agent 完成复杂的代码分析任务。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from backend.agent.context import AgentContext, SharedKnowledgeBase
from backend.agent.agents.module_detector import ModuleDetectorAgent
from backend.graph.graph_schema import GraphNode, GraphEdge
from backend.llm.client import LLMClient
from backend.models.agent_output import AgentOutput

logger = logging.getLogger(__name__)


@dataclass
class OrchestratorResult:
    """编排器执行结果。"""
    status: str  # "success" | "partial" | "failed"
    nodes: list[GraphNode] = field(default_factory=list)
    edges: list[GraphEdge] = field(default_factory=list)
    agent_outputs: dict[str, AgentOutput] = field(default_factory=dict)
    meta: dict[str, Any] = field(default_factory=dict)


class AgentOrchestrator:
    """Agent 编排器。

    协调多个专业 Agent 完成代码分析任务：
    1. ModuleDetectorAgent - 模块检测
    2. (未来) ArchitectureAgent - 架构分析
    3. (未来) CallGraphAgent - 调用图分析
    4. (未来) DataLineageAgent - 数据血缘分析
    """

    def __init__(
        self,
        repo_path: str,
        llm_client: LLMClient,
        max_iterations: int = 20,
    ):
        self.repo_path = Path(repo_path).resolve()
        self.llm_client = llm_client
        self.max_iterations = max_iterations

        # 共享知识库
        self.shared_knowledge = SharedKnowledgeBase()

    def _create_context(self, module_id: str = None) -> AgentContext:
        """创建 Agent 上下文。"""
        return AgentContext(
            repo_path=str(self.repo_path),
            module_id=module_id or f"repo:{self.repo_path.name}",
            shared_knowledge=self.shared_knowledge,
            max_iterations=self.max_iterations,
        )

    def run_module_detection(self) -> AgentOutput:
        """运行模块检测 Agent。"""
        context = self._create_context()
        agent = ModuleDetectorAgent(context=context, llm_client=self.llm_client)
        return agent.run()

    def run_all(self) -> OrchestratorResult:
        """运行所有 Agent。"""
        all_nodes: list[GraphNode] = []
        all_edges: list[GraphEdge] = []
        agent_outputs: dict[str, AgentOutput] = {}

        # Step 1: 模块检测
        logger.info("运行 ModuleDetectorAgent...")
        try:
            module_output = self.run_module_detection()
            agent_outputs["module_detector"] = module_output

            if module_output.status == "success":
                all_nodes.extend(module_output.nodes)
                all_edges.extend(module_output.edges)

                # 更新共享知识库
                for node in module_output.nodes:
                    if node.type == "Module":
                        self.shared_knowledge.modules.append({
                            "id": node.id,
                            "name": node.name,
                            "path": node.properties.get("path", ""),
                        })

                logger.info(f"  → {len(module_output.nodes)} 节点 / {len(module_output.edges)} 边")
            else:
                logger.warning(f"  → ModuleDetectorAgent 失败: {module_output.status}")

        except Exception as e:
            logger.error(f"ModuleDetectorAgent 执行失败: {e}", exc_info=True)

        # Step 2+: 其他 Agent（未来实现）
        # ...

        # 确定最终状态
        if all(agent_output.status == "success" for agent_output in agent_outputs.values()):
            status = "success"
        elif len(all_nodes) > 0:
            status = "partial"
        else:
            status = "failed"

        return OrchestratorResult(
            status=status,
            nodes=all_nodes,
            edges=all_edges,
            agent_outputs=agent_outputs,
            meta={
                "total_agents": len(agent_outputs),
                "successful_agents": sum(1 for a in agent_outputs.values() if a.status == "success"),
            },
        )
