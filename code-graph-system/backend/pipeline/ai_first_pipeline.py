"""AI 优先分析流水线。

使用 AI 直接分析代码结构，产出实体级、字段级、血缘级的精确图谱。

Stage 编排：
1. AIRepositoryScanStage — AI 探索仓库结构
2. AIEntityAnalysisStage — AI 分析实体字段（并行）
3. AIFieldLineageStage — AI 推断字段血缘
4. AIEntityDescriptionStage — AI 生成描述
5. AIGraphBuildStage — 构建图谱

特点：
- 完全由 AI 驱动，无静态分析前置
- 支持字段级血缘
- 支持实体重要性评分
"""
from __future__ import annotations

import logging
import os
import time
from pathlib import Path
from typing import Callable, Optional

from backend.graph.graph_builder import BuiltGraph
from backend.graph.graph_repository import GraphRepository
from backend.llm.client import LLMClient
from backend.models.ai_analysis import AIAnalysisConfig, AIAnalysisResult
from backend.models.ai_first_analysis import (
    RepositoryScanResult,
    FieldLineageResult,
    DescriptionResult,
)
from backend.pipeline.observer import AnalysisObserver, AnalysisCompleted
from backend.pipeline.stages.ai_repository_scan import AIRepositoryScanStage
from backend.pipeline.stages.ai_entity_analysis import AIEntityAnalysisStage
from backend.pipeline.stages.ai_field_lineage import AIFieldLineageStage
from backend.pipeline.stages.ai_entity_description import AIEntityDescriptionStage
from backend.pipeline.stages.ai_graph_build import AIGraphBuildStage
from backend.rag.graph_rag_engine import GraphRAGEngine
from backend.rag.vector_store import VectorStore
from backend.models.static_analysis import QualityReport

logger = logging.getLogger(__name__)


class AIFirstPipeline:
    """AI 优先分析流水线。

    完全由 AI 驱动的代码分析流水线，产出：
    - 实体级节点（Entity, Table, Field）
    - 关系级边（one_to_one, one_to_many, many_to_many）
    - 字段级血缘（flow_to）
    - AI 生成的描述
    """

    def __init__(
        self,
        config: Optional[AIAnalysisConfig] = None,
        graph_repo: Optional[GraphRepository] = None,
        vector_store: Optional[VectorStore] = None,
        rag_engine: Optional[GraphRAGEngine] = None,
        max_workers: int = 3,
    ):
        """
        Args:
            config: 分析配置
            graph_repo: 图谱存储
            vector_store: 向量存储
            rag_engine: RAG 引擎
            max_workers: 最大并发数
        """
        self.config = config or AIAnalysisConfig()
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
    ) -> AIAnalysisResult:
        """执行 AI 优先分析。

        Args:
            repo_path: 仓库路径
            repo_name: 仓库名称
            enable_rag: 是否启用 RAG 向量化
            on_progress: 进度回调
            observer: 分析观察器

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

        # ── Stage 1: AIRepositoryScan ─────────────────────────────────────────
        if on_progress:
            on_progress({
                "step": "ai_repository_scan",
                "status": "start",
                "message": "AI 探索仓库结构...",
            })

        scan_stage = AIRepositoryScanStage()
        scan_result = scan_stage.run(
            repo_path=repo_path,
            llm_client=llm_client,
            observer=observer,
            on_progress=on_progress,
        )

        if not scan_result.entities:
            # 构建详细警告信息
            # 检查是否是模型不支持工具调用的情况（tool_calls 为 0）
            tool_call_count = scan_result.stats.get("tool_calls", 0) if scan_result.stats else 0

            if tool_call_count == 0:
                warning_msg = (
                    "当前模型可能不支持工具调用（function calling），"
                    "AI 仓库扫描需要此能力。请使用支持工具调用的模型，"
                    "如 Claude、GPT-4 或智谱 GLM-4，或切换到 static_first 流水线。"
                )
            else:
                warning_msg = "未识别到任何实体"
                if scan_result.stats and scan_result.stats.get("elapsed_ms", 0) > 0:
                    warning_msg += f"（分析耗时 {scan_result.stats['elapsed_ms'] // 1000}s）"

            logger.warning(
                "[ai_first_pipeline] 扫描结果为空: entities=%d, services=%d, flows=%d, stats=%s",
                len(scan_result.entities),
                len(scan_result.services),
                len(scan_result.flows),
                scan_result.stats,
            )

            if on_progress:
                on_progress({
                    "step": "ai_repository_scan",
                    "status": "failed",
                    "message": warning_msg,
                    "log": f"扫描统计: {scan_result.stats}",
                })

            return AIAnalysisResult(
                graph_id="",
                nodes=[],
                edges=[],
                status="failed",
                failed_modules=[],
                warnings=[warning_msg],
                duration_seconds=time.time() - start,
            )

        logger.info(
            "[ai_repository_scan] 完成: %d 实体, %d 服务, %d 流程",
            len(scan_result.entities),
            len(scan_result.services),
            len(scan_result.flows),
        )

        # ── Stage 2: AIEntityAnalysis ─────────────────────────────────────────
        if on_progress:
            on_progress({
                "step": "ai_entity_analysis",
                "status": "start",
                "message": f"AI 分析 {len(scan_result.entities)} 个实体...",
            })

        entity_stage = AIEntityAnalysisStage(max_concurrency=self.max_workers)
        entity_results, failed_entities = entity_stage.run(
            repo_path=repo_path,
            candidates=scan_result.entities,
            llm_client=llm_client,
            observer=observer,
            on_progress=on_progress,
        )

        logger.info(
            "[ai_entity_analysis] 完成: %d 成功, %d 失败",
            len(entity_results),
            len(failed_entities),
        )

        # ── Stage 3: AIFieldLineage ───────────────────────────────────────────
        if on_progress:
            on_progress({
                "step": "ai_field_lineage",
                "status": "start",
                "message": "AI 推断字段血缘...",
            })

        lineage_stage = AIFieldLineageStage()
        lineage_result = lineage_stage.run(
            repo_path=repo_path,
            entity_results=entity_results,
            service_candidates=scan_result.services,
            llm_client=llm_client,
            observer=observer,
            on_progress=on_progress,
        )

        logger.info(
            "[ai_field_lineage] 完成: %d 条血缘",
            len(lineage_result.lineages),
        )

        # ── Stage 4: AIEntityDescription ──────────────────────────────────────
        if on_progress:
            on_progress({
                "step": "ai_entity_description",
                "status": "start",
                "message": "AI 生成描述...",
            })

        desc_stage = AIEntityDescriptionStage(max_concurrency=self.max_workers)
        description_result = desc_stage.run(
            repo_path=repo_path,
            entity_results=entity_results,
            llm_client=llm_client,
            observer=observer,
            on_progress=on_progress,
        )

        logger.info(
            "[ai_entity_description] 完成: %d 实体描述, %d 字段描述",
            len(description_result.entity_descriptions),
            len(description_result.field_descriptions),
        )

        # ── Stage 5: AIGraphBuild ─────────────────────────────────────────────
        if on_progress:
            on_progress({
                "step": "ai_graph_build",
                "status": "start",
                "message": "构建图谱...",
            })

        build_stage = AIGraphBuildStage()
        nodes, edges, quality_report = build_stage.run(
            scan_result=scan_result,
            entity_results=entity_results,
            lineage_result=lineage_result,
            description_result=description_result,
            observer=observer,
            on_progress=on_progress,
        )

        logger.info(
            "[ai_graph_build] 完成: %d 节点, %d 边",
            len(nodes),
            len(edges),
        )

        # ── 持久化 ───────────────────────────────────────────────────────────
        if on_progress:
            on_progress({
                "step": "repository",
                "status": "start",
                "message": "保存图谱...",
            })

        # 构建 BuiltGraph
        built = BuiltGraph(
            nodes=nodes,
            edges=edges,
            meta={
                "repo_name": name,
                "pipeline": "ai_first",
                "entity_count": len(entity_results),
                "lineage_count": len(lineage_result.lineages),
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
        status = "success" if not failed_entities else "partial"

        # 发送完成事件
        if observer:
            observer.emit_end()

        logger.info(
            "AIFirstPipeline 完成: status=%s, 耗时=%.2fs, graph_id=%s"
            " | 节点=%d, 边=%d"
            " | 实体=%d, 血缘=%d, 失败=%d",
            status,
            duration,
            graph_id,
            built.node_count,
            built.edge_count,
            len(entity_results),
            len(lineage_result.lineages),
            len(failed_entities),
        )

        warnings = list(quality_report.warnings)
        warnings.extend(quality_report.errors)

        return AIAnalysisResult(
            graph_id=graph_id,
            nodes=nodes,
            edges=edges,
            status=status,
            failed_modules=failed_entities,
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
