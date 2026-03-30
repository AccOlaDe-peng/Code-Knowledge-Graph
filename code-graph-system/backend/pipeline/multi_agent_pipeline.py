"""多 Agent 协作分析流水线。

使用 MultiAgentOrchestrator 协调多个领域 Agent 进行协作式代码分析。

特点：
- 多 Agent 并行协作（Entity、Service、Flow、Lineage、Topic）
- 跨 Agent 冲突检测与仲裁
- 迭代收敛控制
- Agent 间知识共享

使用示例：
    pipeline = MultiAgentPipeline()
    result = pipeline.analyze(
        repo_path="/path/to/repo",
        repo_name="my-service",
        enable_rag=True,
    )
"""

from __future__ import annotations

import logging
import os
import time
from pathlib import Path
from typing import Callable, Optional

from backend.collaboration import (
    MultiAgentOrchestrator,
    MultiAgentResult,
    IterationConfig,
)
from backend.graph.graph_builder import BuiltGraph
from backend.graph.graph_repository import GraphRepository
from backend.llm.client import LLMClient
from backend.models.ai_analysis import AIAnalysisConfig, AIAnalysisResult
from backend.pipeline.observer import AnalysisObserver
from backend.rag.graph_rag_engine import GraphRAGEngine
from backend.rag.vector_store import VectorStore

logger = logging.getLogger(__name__)


class MultiAgentPipeline:
    """多 Agent 协作分析流水线。

    使用 MultiAgentOrchestrator 协调多个领域 Agent 进行代码分析：

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

    3. 与 AIFirstPipeline 的区别：
       - AIFirstPipeline：Stage 串行执行，每个 Stage 专注一类分析
       - MultiAgentPipeline：Agent 并行协作，支持迭代精化和冲突解决
    """

    def __init__(
        self,
        config: Optional[AIAnalysisConfig] = None,
        iteration_config: Optional[IterationConfig] = None,
        graph_repo: Optional[GraphRepository] = None,
        vector_store: Optional[VectorStore] = None,
        rag_engine: Optional[GraphRAGEngine] = None,
        max_workers: int = 3,
    ):
        """初始化流水线。

        Args:
            config: 分析配置
            iteration_config: 迭代配置
            graph_repo: 图谱存储
            vector_store: 向量存储
            rag_engine: RAG 引擎
            max_workers: 最大并发数
        """
        self.config = config or AIAnalysisConfig()
        self.iteration_config = iteration_config or IterationConfig()
        self._repo = graph_repo or GraphRepository()
        self._vector_store = vector_store
        self._rag_engine = rag_engine
        self.max_workers = max_workers

    def analyze(
        self,
        repo_path: str | Path,
        *,
        repo_name: str = "",
        enable_rag: bool = False,
        on_progress: Optional[Callable[[dict], None]] = None,
        observer: Optional[AnalysisObserver] = None,
        agent_priorities: Optional[dict[str, float]] = None,
    ) -> AIAnalysisResult:
        """执行多 Agent 协作分析。

        Args:
            repo_path: 仓库路径
            repo_name: 仓库名称
            enable_rag: 是否启用 RAG 向量化
            on_progress: 进度回调
            observer: 分析观察器
            agent_priorities: Agent 优先级配置（如 {"EntityAgent": 1.5}）

        Returns:
            AIAnalysisResult
        """
        start = time.time()
        repo_path = Path(repo_path).resolve()

        if not repo_path.exists():
            raise ValueError(f"仓库路径不存在: {repo_path}")
        if not repo_path.is_dir():
            raise ValueError(f"路径不是目录: {repo_path}")

        name = repo_name or repo_path.name
        llm_client = self._create_llm_client()

        # 创建观察器（如果未提供）
        if observer is None:
            observer = AnalysisObserver()

        # 发送开始事件
        if on_progress:
            on_progress({
                "step": "multi_agent_init",
                "status": "start",
                "message": "初始化多 Agent 协作分析...",
            })

        # 创建编排器
        orchestrator = MultiAgentOrchestrator(
            repo_path=repo_path,
            llm_client=llm_client,
            config=self.iteration_config,
            max_workers=self.max_workers,
            on_progress=on_progress,
        )

        # 设置 Agent 优先级
        if agent_priorities:
            for agent_name, priority in agent_priorities.items():
                orchestrator.set_agent_priority(agent_name, priority)

        # 执行分析
        if on_progress:
            on_progress({
                "step": "multi_agent_analysis",
                "status": "start",
                "message": "执行多 Agent 协作分析...",
            })

        result = orchestrator.run()

        # ── 持久化 ───────────────────────────────────────────────────────────
        if on_progress:
            on_progress({
                "step": "repository",
                "status": "start",
                "message": "保存图谱...",
            })

        # 构建 BuiltGraph
        built = BuiltGraph(
            nodes=result.nodes,
            edges=result.edges,
            meta={
                "repo_name": name,
                "pipeline": "multi_agent",
                "iterations": result.iterations,
                "conflict_count": len(result.conflicts),
                "resolved_conflicts": len([a for a in result.arbitrations if a.resolved]),
                **result.meta,
            },
        )

        graph_id = self._repo.save(built, repo_name=name)

        if on_progress:
            on_progress({
                "step": "repository",
                "status": "complete",
                "message": f"图谱已保存: {graph_id}",
                "graph_id": graph_id,
            })

        # ── RAG（可选）──────────────────────────────────────────────────────
        if enable_rag:
            try:
                rag = self._get_rag_engine()
                rag.embed_nodes(graph_id, built.nodes)
            except Exception as e:
                logger.warning("向量化失败: %s", e)

        # ── 结果汇总 ────────────────────────────────────────────────────────
        duration = time.time() - start

        # 确定状态
        if result.status == "converged":
            status = "success"
        elif result.status in ("success", "stalled"):
            status = "success" if len(result.nodes) > 0 else "partial"
        elif len(result.nodes) > 0:
            status = "partial"
        else:
            status = "failed"

        # 发送完成事件
        if observer:
            observer.emit_end()

        # 构建警告列表
        warnings = []
        for conflict in result.conflicts:
            warnings.append(f"冲突: {conflict.description}")
        for arb in result.arbitrations:
            if not arb.resolved:
                warnings.append(f"未解决的冲突: {arb.conflict_id}")

        logger.info(
            "MultiAgentPipeline 完成: status=%s, 耗时=%.2fs, graph_id=%s"
            " | 节点=%d, 边=%d"
            " | 迭代=%d, 冲突=%d, 已解决=%d",
            status,
            duration,
            graph_id,
            built.node_count,
            built.edge_count,
            result.iterations,
            len(result.conflicts),
            len([a for a in result.arbitrations if a.resolved]),
        )

        return AIAnalysisResult(
            graph_id=graph_id,
            nodes=result.nodes,
            edges=result.edges,
            status=status,
            failed_modules=[],
            warnings=warnings,
            duration_seconds=duration,
        )

    def _create_llm_client(self) -> LLMClient:
        """创建 LLM 客户端。"""
        provider = os.environ.get("LLM_PROVIDER", self.config.provider)

        # 根据 provider 选择正确的 API Key
        if provider == "anthropic":
            api_key = os.environ.get("ANTHROPIC_API_KEY")
        elif provider == "openai":
            api_key = os.environ.get("OPENAI_API_KEY")
        elif provider == "minimax":
            api_key = os.environ.get("MINIMAX_API_KEY")
        elif provider == "zhipu":
            api_key = os.environ.get("ZHIPU_API_KEY")
        else:
            # Fallback: 尝试所有可能的 API Key
            api_key = (
                os.environ.get("LLM_API_KEY")
                or os.environ.get("ANTHROPIC_API_KEY")
                or os.environ.get("OPENAI_API_KEY")
                or os.environ.get("MINIMAX_API_KEY")
                or os.environ.get("ZHIPU_API_KEY")
            )

        # 根据 provider 选择正确的 base_url
        # 优先级：专用 BASE_URL > LLM_BASE_URL（通用）
        if provider == "anthropic":
            base_url = os.environ.get("ANTHROPIC_BASE_URL") or os.environ.get("LLM_BASE_URL")
        elif provider == "openai":
            base_url = os.environ.get("OPENAI_BASE_URL") or os.environ.get("LLM_BASE_URL")
        elif provider == "minimax":
            base_url = os.environ.get("MINIMAX_BASE_URL") or os.environ.get("LLM_BASE_URL")
        elif provider == "zhipu":
            base_url = os.environ.get("ZHIPU_BASE_URL") or os.environ.get("LLM_BASE_URL")
        else:
            base_url = os.environ.get("LLM_BASE_URL")

        model = os.environ.get("LLM_MODEL", self.config.model)
        return LLMClient(
            provider=provider,
            model=model or None,
            api_key=api_key,
            base_url=base_url,
            max_tokens=self.config.max_tokens,
            temperature=self.config.temperature,
        )

    def _get_rag_engine(self) -> GraphRAGEngine:
        """获取 RAG 引擎。"""
        if self._rag_engine is None:
            vs = self._vector_store or VectorStore()
            self._rag_engine = GraphRAGEngine(
                graph_repo=self._repo, vector_store=vs
            )
        return self._rag_engine
