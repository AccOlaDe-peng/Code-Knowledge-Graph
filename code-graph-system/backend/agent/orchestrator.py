"""Agent 编排器。

协调多个专业 Agent 完成复杂的代码分析任务。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Optional

from backend.agent.context import AgentContext, SharedKnowledgeBase
from backend.agent.agents.module_detector import ModuleDetectorAgent
from backend.agent.agents.architecture import ArchitectureAgent
from backend.agent.agents.call_graph import CallGraphAgent
from backend.agent.agents.data_lineage import DataLineageAgent
from backend.agent.agents.api_endpoint import APIEndpointAgent
from backend.agent.agents.cross_module import CrossModuleAgent
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
    2. ArchitectureAgent - 架构分析
    3. CallGraphAgent - 调用图分析
    4. DataLineageAgent - 数据血缘分析
    5. APIEndpointAgent - API 端点分析
    6. CrossModuleAgent - 跨模块分析
    """

    def __init__(
        self,
        repo_path: str,
        llm_client: LLMClient,
        max_iterations: int = 20,
        on_progress: Optional[Callable[[dict], None]] = None,
    ):
        self.repo_path = Path(repo_path).resolve()
        self.llm_client = llm_client
        self.max_iterations = max_iterations
        self.on_progress = on_progress

        # 共享知识库
        self.shared_knowledge = SharedKnowledgeBase()

    def _emit_progress(self, agent_type: str, status: str, message: str, **extra):
        """发布进度事件。"""
        if self.on_progress:
            try:
                self.on_progress({
                    "agent": agent_type,
                    "status": status,
                    "message": message,
                    **extra,
                })
            except Exception:
                pass

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

    def run_architecture_analysis(self) -> AgentOutput:
        """运行架构分析 Agent。"""
        context = self._create_context()
        agent = ArchitectureAgent(context=context, llm_client=self.llm_client)
        return agent.run()

    def run_call_graph_analysis(self) -> AgentOutput:
        """运行调用图分析 Agent。"""
        context = self._create_context()
        agent = CallGraphAgent(context=context, llm_client=self.llm_client)
        return agent.run()

    def run_data_lineage_analysis(self) -> AgentOutput:
        """运行数据血缘分析 Agent。"""
        context = self._create_context()
        agent = DataLineageAgent(context=context, llm_client=self.llm_client)
        return agent.run()

    def run_api_endpoint_analysis(self) -> AgentOutput:
        """运行 API 端点分析 Agent。"""
        context = self._create_context()
        agent = APIEndpointAgent(context=context, llm_client=self.llm_client)
        return agent.run()

    def run_cross_module_analysis(self) -> AgentOutput:
        """运行跨模块分析 Agent。"""
        context = self._create_context()
        agent = CrossModuleAgent(context=context, llm_client=self.llm_client)
        return agent.run()

    def run_all(
        self,
        enable_architecture: bool = True,
        enable_call_graph: bool = True,
        enable_data_lineage: bool = True,
        enable_api_endpoint: bool = True,
        enable_cross_module: bool = True,
    ) -> OrchestratorResult:
        """运行所有 Agent。"""
        all_nodes: list[GraphNode] = []
        all_edges: list[GraphEdge] = []
        agent_outputs: dict[str, AgentOutput] = {}

        def _run_agent(name: str, runner: Callable[[], AgentOutput], depends_on: list[str] = None):
            """运行单个 Agent 并处理结果。"""
            logger.info(f"运行 {name}...")
            self._emit_progress(name, "running", f"开始 {name}")

            try:
                output = runner()
                agent_outputs[name] = output

                if output.status == "success":
                    all_nodes.extend(output.nodes)
                    all_edges.extend(output.edges)
                    logger.info(f"  → {len(output.nodes)} 节点 / {len(output.edges)} 边")
                    self._emit_progress(name, "success", f"完成 {name}",
                                       nodes=len(output.nodes), edges=len(output.edges))
                else:
                    logger.warning(f"  → {name} 失败: {output.status}")
                    self._emit_progress(name, "failed", f"{name} 失败: {output.status}")

            except Exception as e:
                logger.error(f"{name} 执行失败: {e}", exc_info=True)
                self._emit_progress(name, "error", f"{name} 执行失败: {e}")

        # Step 1: 模块检测（基础）
        _run_agent("module_detector", self.run_module_detection)

        # Step 2: 架构分析（依赖模块检测）
        if enable_architecture:
            _run_agent("architecture", self.run_architecture_analysis)

        # Step 3: 调用图分析（依赖架构分析）
        if enable_call_graph:
            _run_agent("call_graph", self.run_call_graph_analysis)

        # Step 4: 数据血缘分析（并行）
        if enable_data_lineage:
            _run_agent("data_lineage", self.run_data_lineage_analysis)

        # Step 5: API 端点分析（并行）
        if enable_api_endpoint:
            _run_agent("api_endpoint", self.run_api_endpoint_analysis)

        # Step 6: 跨模块分析（依赖所有前面的分析）
        if enable_cross_module:
            _run_agent("cross_module", self.run_cross_module_analysis)

        # 确定最终状态
        successful = [a for a in agent_outputs.values() if a.status == "success"]
        if len(successful) == len(agent_outputs):
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
                "successful_agents": len(successful),
                "total_nodes": len(all_nodes),
                "total_edges": len(all_edges),
            },
        )
