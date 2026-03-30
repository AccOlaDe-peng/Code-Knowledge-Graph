"""多 Agent 编排器。

协调多个领域 Agent 进行协作式代码分析。

工作流程：
1. 初始化所有领域 Agent 和协作组件
2. 迭代执行：发现 → 分析 → 验证 → 冲突检测 → 仲裁
3. 收敛检测后输出最终图谱

使用示例：
    orchestrator = MultiAgentOrchestrator(
        repo_path="/path/to/repo",
        llm_client=llm_client,
    )

    result = orchestrator.run()

    print(f"节点: {len(result.nodes)}")
    print(f"边: {len(result.edges)}")
    print(f"迭代: {result.iterations}")
"""

from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Optional

from backend.agent_v2.base_agent import AgentResult, DomainAgent, AgentContext
from backend.agent_v2.entity_agent import EntityAgent
from backend.agent_v2.service_agent import ServiceAgent
from backend.agent_v2.flow_agent import FlowAgent
from backend.agent_v2.lineage_agent import LineageAgent
from backend.agent_v2.topic_agent import TopicAgent
from backend.collaboration.cross_validation import CrossValidationLayer, ConflictInfo
from backend.collaboration.arbitrator import Arbitrator, ArbitrationResult, ResolutionStrategy
from backend.collaboration.iteration_controller import (
    IterationController,
    IterationConfig,
    IterationState,
    IterationMetrics,
)
from backend.graph.graph_schema import GraphNode, GraphEdge
from backend.knowledge.hub import KnowledgeHub
from backend.tools.executor import ToolExecutor
from backend.llm.client import LLMClient

logger = logging.getLogger(__name__)


@dataclass
class MultiAgentResult:
    """多 Agent 分析结果。"""
    status: str  # "success" | "partial" | "failed" | "converged" | "stalled"
    nodes: list[GraphNode] = field(default_factory=list)
    edges: list[GraphEdge] = field(default_factory=list)
    iterations: int = 0
    agent_results: dict[str, AgentResult] = field(default_factory=dict)
    conflicts: list[ConflictInfo] = field(default_factory=list)
    arbitrations: list[ArbitrationResult] = field(default_factory=list)
    meta: dict[str, Any] = field(default_factory=dict)


class MultiAgentOrchestrator:
    """多 Agent 编排器。

    协调多个领域 Agent 进行协作式代码分析：

    1. Agent 体系：
       - EntityAgent：JPA 实体、字段、关系
       - ServiceAgent：Spring 服务、Controller、DI
       - FlowAgent：业务流程、调用链
       - LineageAgent：数据血缘、字段级追踪
       - TopicAgent：Kafka/RabbitMQ/Event

    2. 协作机制：
       - KnowledgeHub：Agent 间知识共享
       - CrossValidationLayer：跨 Agent 冲突检测
       - Arbitrator：冲突仲裁
       - IterationController：迭代控制

    3. 迭代流程：
       ```
       while should_continue():
           for agent in agents:
               targets = agent.discover()
               for target in targets:
                   result = agent.analyze(target)
                   valid, issues = agent.validate(result)

           conflicts = cross_validation.detect_conflicts()
           for conflict in conflicts:
               arbitrator.arbitrate(conflict)

           metrics = collect_metrics()
           iteration_controller.end_iteration(metrics)
       ```
    """

    # Agent 配置：名称、类、是否并行
    AGENT_CONFIGS = [
        ("EntityAgent", EntityAgent, False),      # 基础，先运行
        ("ServiceAgent", ServiceAgent, False),    # 依赖 Entity
        ("FlowAgent", FlowAgent, True),           # 可并行
        ("LineageAgent", LineageAgent, True),     # 可并行
        ("TopicAgent", TopicAgent, True),         # 可并行
    ]

    def __init__(
        self,
        repo_path: str | Path,
        llm_client: LLMClient,
        config: Optional[IterationConfig] = None,
        max_workers: int = 3,
        on_progress: Optional[Callable[[dict], None]] = None,
    ):
        """初始化编排器。

        Args:
            repo_path: 仓库路径
            llm_client: LLM 客户端
            config: 迭代配置
            max_workers: 最大并发数
            on_progress: 进度回调
        """
        self.repo_path = Path(repo_path).resolve()
        self.llm_client = llm_client
        self.config = config or IterationConfig()
        self.max_workers = max_workers
        self.on_progress = on_progress

        # 核心组件
        self.knowledge_hub = KnowledgeHub()
        self.iteration_controller = IterationController(self.config)
        self.cross_validation = CrossValidationLayer()
        self.arbitrator = Arbitrator(llm_client=llm_client)

        # Agent 实例
        self._agents: dict[str, DomainAgent] = {}
        self._init_agents()

    def _init_agents(self) -> None:
        """初始化所有 Agent。"""
        for name, agent_class, _ in self.AGENT_CONFIGS:
            # 每个 Agent 有独立的 ToolExecutor
            tool_executor = ToolExecutor(
                repo_path=str(self.repo_path),
                agent_name=name,
                llm_client=self.llm_client,
            )

            # 创建 Agent 上下文
            context = AgentContext(
                repo_path=str(self.repo_path),
                knowledge_hub=self.knowledge_hub,
                tool_executor=tool_executor,
            )

            self._agents[name] = agent_class(context=context)
            logger.debug("[Orchestrator] 初始化 Agent: %s", name)

    def _emit_progress(self, stage: str, status: str, message: str, **extra) -> None:
        """发送进度事件。"""
        if self.on_progress:
            try:
                self.on_progress({
                    "stage": stage,
                    "status": status,
                    "message": message,
                    **extra,
                })
            except Exception:
                pass

    # ═══════════════════════════════════════════════════════════════
    # 主流程
    # ═══════════════════════════════════════════════════════════════

    def run(self) -> MultiAgentResult:
        """执行多 Agent 分析。

        Returns:
            MultiAgentResult: 分析结果
        """
        start_time = time.time()
        self._emit_progress("init", "start", "初始化多 Agent 分析...")

        all_results: dict[str, AgentResult] = {}
        all_conflicts: list[ConflictInfo] = []
        all_arbitrations: list[ArbitrationResult] = []

        try:
            while self.iteration_controller.should_continue():
                iteration = self.iteration_controller.start_iteration()
                self._emit_progress(
                    "iteration", "start",
                    f"开始迭代 {iteration}",
                    iteration=iteration,
                )

                # 执行一轮分析
                iter_results = self._run_iteration(iteration)

                # 收集结果
                for agent_name, result in iter_results.items():
                    all_results[agent_name] = result
                    self.cross_validation.add_result(agent_name, result)

                # 冲突检测
                conflicts = self.cross_validation.detect_conflicts()
                all_conflicts.extend(conflicts)

                # 冲突仲裁
                for conflict in conflicts:
                    arbitration = self._arbitrate_conflict(conflict, iter_results)
                    if arbitration:
                        all_arbitrations.append(arbitration)

                # 计算指标
                metrics = self._collect_metrics(iter_results, conflicts)
                state = self.iteration_controller.end_iteration(metrics)

                self._emit_progress(
                    "iteration", "end",
                    f"迭代 {iteration} 完成: {state.value}",
                    iteration=iteration,
                    state=state.value,
                    node_count=metrics.node_count,
                    edge_count=metrics.edge_count,
                    conflict_count=metrics.conflict_count,
                    avg_confidence=metrics.avg_confidence,
                )

                # 检查是否需要精化
                if state == IterationState.RUNNING and conflicts:
                    self._refine_agents(conflicts, all_arbitrations)

            # 获取最终状态
            final_state = self.iteration_controller.state
            merged_nodes, merged_edges = self.cross_validation.get_merged_results()

            # 应用仲裁结果
            self._apply_arbitrations(all_arbitrations, merged_nodes, merged_edges)

            # 确定最终状态
            if final_state == IterationState.CONVERGED:
                status = "converged"
            elif final_state == IterationState.STALLED:
                status = "stalled"
            elif final_state == IterationState.MAX_ITERATIONS:
                status = "success"
            elif len(merged_nodes) > 0:
                status = "partial"
            else:
                status = "failed"

            duration = time.time() - start_time
            result = MultiAgentResult(
                status=status,
                nodes=merged_nodes,
                edges=merged_edges,
                iterations=self.iteration_controller.current_iteration,
                agent_results=all_results,
                conflicts=all_conflicts,
                arbitrations=all_arbitrations,
                meta={
                    "duration_seconds": duration,
                    "final_state": final_state.value,
                    "convergence_reason": self.iteration_controller.convergence_reason.value
                    if self.iteration_controller.convergence_reason else None,
                    "total_conflicts": len(all_conflicts),
                    "resolved_conflicts": len([a for a in all_arbitrations if a.resolved]),
                    **self.iteration_controller.get_stats(),
                },
            )

            self._emit_progress(
                "complete", status,
                f"分析完成: {len(merged_nodes)} 节点, {len(merged_edges)} 边",
                **result.meta,
            )

            return result

        except Exception as e:
            logger.error("[Orchestrator] 执行失败: %s", e, exc_info=True)
            self._emit_progress("error", "failed", f"执行失败: {e}")

            # 返回部分结果
            merged_nodes, merged_edges = self.cross_validation.get_merged_results()
            return MultiAgentResult(
                status="failed",
                nodes=merged_nodes,
                edges=merged_edges,
                iterations=self.iteration_controller.current_iteration,
                agent_results=all_results,
                conflicts=all_conflicts,
                arbitrations=all_arbitrations,
                meta={"error": str(e)},
            )

    # ═══════════════════════════════════════════════════════════════
    # 迭代执行
    # ═══════════════════════════════════════════════════════════════

    def _run_iteration(self, iteration: int) -> dict[str, AgentResult]:
        """执行一轮迭代。

        Args:
            iteration: 当前迭代号

        Returns:
            各 Agent 的分析结果
        """
        results: dict[str, AgentResult] = {}

        # Phase 1: 串行执行基础 Agent（Entity、Service）
        sequential_agents = [
            (name, cls) for name, cls, parallel in self.AGENT_CONFIGS
            if not parallel
        ]

        for name, _ in sequential_agents:
            if name not in self._agents:
                continue

            agent = self._agents[name]
            self._emit_progress(
                f"agent_{name}", "start",
                f"[迭代 {iteration}] {name} 开始分析...",
            )

            try:
                result = agent.run()
                results[name] = result

                # 发布到知识库
                self.knowledge_hub.publish(
                    name,
                    {
                        "nodes": result.nodes,
                        "edges": result.edges,
                        "confidence": result.confidence,
                    },
                    confidence=result.confidence,
                )

                self._emit_progress(
                    f"agent_{name}", "success",
                    f"{name} 完成: {len(result.nodes)} 节点, {len(result.edges)} 边",
                    nodes=len(result.nodes),
                    edges=len(result.edges),
                    confidence=result.confidence,
                )

            except Exception as e:
                logger.error("[Orchestrator] Agent %s 失败: %s", name, e, exc_info=True)
                self._emit_progress(f"agent_{name}", "error", f"{name} 失败: {e}")

        # Phase 2: 并行执行剩余 Agent（Flow、Lineage、Topic）
        parallel_agents = [
            (name, cls) for name, cls, parallel in self.AGENT_CONFIGS
            if parallel
        ]

        if parallel_agents:
            with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
                futures = {}
                for name, _ in parallel_agents:
                    if name in self._agents:
                        agent = self._agents[name]
                        futures[executor.submit(self._run_agent, agent, iteration)] = name

                for future in as_completed(futures):
                    name = futures[future]
                    try:
                        result = future.result()
                        results[name] = result

                        # 发布到知识库
                        self.knowledge_hub.publish(
                            name,
                            {
                                "nodes": result.nodes,
                                "edges": result.edges,
                                "confidence": result.confidence,
                            },
                            confidence=result.confidence,
                        )

                        self._emit_progress(
                            f"agent_{name}", "success",
                            f"{name} 完成: {len(result.nodes)} 节点",
                            nodes=len(result.nodes),
                            edges=len(result.edges),
                        )

                    except Exception as e:
                        logger.error("[Orchestrator] Agent %s 失败: %s", name, e, exc_info=True)
                        self._emit_progress(f"agent_{name}", "error", f"{name} 失败: {e}")

        return results

    def _run_agent(self, agent: DomainAgent, iteration: int) -> AgentResult:
        """运行单个 Agent。"""
        return agent.run()

    # ═══════════════════════════════════════════════════════════════
    # 冲突处理
    # ═══════════════════════════════════════════════════════════════

    def _arbitrate_conflict(
        self,
        conflict: ConflictInfo,
        results: dict[str, AgentResult],
    ) -> Optional[ArbitrationResult]:
        """仲裁冲突。

        Args:
            conflict: 冲突信息
            results: Agent 结果

        Returns:
            仲裁结果
        """
        # 构建上下文
        agent_results = {}
        for agent_name in conflict.agents:
            if agent_name in results:
                result = results[agent_name]
                agent_results[agent_name] = {
                    "confidence": result.confidence,
                    "nodes": result.nodes,
                    "edges": result.edges,
                }

        context = {"agent_results": agent_results}

        # 执行仲裁
        arbitration = self.arbitrator.arbitrate(conflict, context)

        logger.info(
            "[Orchestrator] 仲裁: %s -> %s (resolved=%s)",
            conflict.conflict_id,
            arbitration.strategy.value,
            arbitration.resolved,
        )

        return arbitration

    def _apply_arbitrations(
        self,
        arbitrations: list[ArbitrationResult],
        nodes: list[GraphNode],
        edges: list[GraphEdge],
    ) -> None:
        """应用仲裁结果。

        Args:
            arbitrations: 仲裁结果列表
            nodes: 节点列表（会被修改）
            edges: 边列表（会被修改）
        """
        for arb in arbitrations:
            if not arb.resolved:
                continue

            self.arbitrator.apply_result(arb, nodes, edges)

    # ═══════════════════════════════════════════════════════════════
    # 精化
    # ═══════════════════════════════════════════════════════════════

    def _refine_agents(
        self,
        conflicts: list[ConflictInfo],
        arbitrations: list[ArbitrationResult],
    ) -> None:
        """根据冲突进行 Agent 精化。

        Args:
            conflicts: 冲突列表
            arbitrations: 仲裁结果
        """
        # 按冲突涉及的节点/边，通知相关 Agent 进行精化
        for conflict in conflicts:
            for agent_name in conflict.agents:
                if agent_name not in self._agents:
                    continue

                agent = self._agents[agent_name]

                # 构建精化提示
                hints = {
                    "conflict_id": conflict.conflict_id,
                    "conflict_type": conflict.conflict_type.value,
                    "description": conflict.description,
                    "nodes_involved": conflict.nodes_involved,
                    "edges_involved": conflict.edges_involved,
                }

                # 找到对应的仲裁结果
                for arb in arbitrations:
                    if arb.conflict_id == conflict.conflict_id and arb.resolved:
                        hints["winner"] = arb.winner
                        hints["final_value"] = arb.final_value
                        break

                # 如果 Agent 支持 refine，调用它
                if hasattr(agent, "refine"):
                    try:
                        agent.refine(hints)
                    except Exception as e:
                        logger.warning(
                            "[Orchestrator] Agent %s 精化失败: %s",
                            agent_name, e,
                        )

    # ═══════════════════════════════════════════════════════════════
    # 指标收集
    # ═══════════════════════════════════════════════════════════════

    def _collect_metrics(
        self,
        results: dict[str, AgentResult],
        conflicts: list[ConflictInfo],
    ) -> IterationMetrics:
        """收集迭代指标。

        Args:
            results: Agent 结果
            conflicts: 冲突列表

        Returns:
            迭代指标
        """
        # 合并所有结果
        all_nodes: list[GraphNode] = []
        all_edges: list[GraphEdge] = []
        confidences: list[float] = []

        for result in results.values():
            all_nodes.extend(result.nodes)
            all_edges.extend(result.edges)
            if result.confidence > 0:
                confidences.append(result.confidence)

        avg_confidence = sum(confidences) / len(confidences) if confidences else 0.5

        return IterationMetrics(
            iteration=self.iteration_controller.current_iteration,
            node_count=len(all_nodes),
            edge_count=len(all_edges),
            conflict_count=len(conflicts),
            avg_confidence=avg_confidence,
            elapsed_seconds=0,  # 由 IterationController 计算
        )

    # ═══════════════════════════════════════════════════════════════
    # 配置
    # ═══════════════════════════════════════════════════════════════

    def set_agent_priority(self, agent_name: str, priority: float) -> None:
        """设置 Agent 优先级（影响仲裁）。

        Args:
            agent_name: Agent 名称
            priority: 优先级（> 1 表示更高优先级）
        """
        self.arbitrator.set_agent_priority(agent_name, priority)

    def set_resolution_strategy(
        self,
        conflict_type: str,
        strategy: ResolutionStrategy,
    ) -> None:
        """设置冲突解决策略。

        Args:
            conflict_type: 冲突类型
            strategy: 解决策略
        """
        self.arbitrator.set_strategy(conflict_type, strategy)

    def get_stats(self) -> dict:
        """获取统计信息。"""
        return {
            "iterations": self.iteration_controller.get_stats(),
            "arbitrator": self.arbitrator.get_stats(),
            "cross_validation": self.cross_validation.get_stats(),
            "knowledge_hub": self.knowledge_hub.get_stats(),
        }
