"""静态优先、AI 增强流水线。

Stage 编排：
1. FileIndexStage — 异步文件索引
2. DeepStaticAnalysisStage — 深度静态分析（产出 A+B）
3. DirectoryClusterStage — 目录聚类（零 LLM） || 并行
4a. SpringDIEventStaticStage — Spring 静态解析（零 LLM）|| 并行
3b. AISemanticEnhanceStage — AI 语义增强（并行模块处理）
4b. SpringDIEventAIStage — AI 解析歧义
5. GraphMergeStage — 合并 + 质量评分

特点：
- Stage 3 (DirectoryCluster) 和 Stage 4a (SpringDIEventStatic) 并行执行
- Stage 3b 在 Stage 3 完成后执行
- Stage 4b 在 Stage 4a 完成后执行，接收歧义列表
"""
from __future__ import annotations

import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Callable, Optional

from backend.graph.graph_builder import GraphBuilder
from backend.graph.graph_repository import GraphRepository
from backend.llm.client import LLMClient
from backend.models.ai_analysis import AIAnalysisConfig, AIAnalysisResult
from backend.models.static_analysis import QualityReport, ModuleEnhancement
from backend.pipeline.observer import AnalysisObserver, AnalysisCompleted
from backend.pipeline.stage_cache import StageCacheManager, ModuleCacheEntry
from backend.pipeline.stages.ai_semantic_enhance import AISemanticEnhanceStage
from backend.pipeline.stages.deep_static_analysis import DeepStaticAnalysisStage
from backend.pipeline.stages.directory_cluster import DirectoryClusterStage
from backend.pipeline.stages.file_index_async import FileIndexStage
from backend.pipeline.stages.graph_merge_with_quality import (
    GraphMergeWithQualityStage,
    emit_analysis_completed,
)
from backend.pipeline.stages.spring_di_event_ai import SpringDIEventAIStage
from backend.pipeline.stages.spring_di_event_static import SpringDIEventStaticStage
from backend.rag.graph_rag_engine import GraphRAGEngine
from backend.rag.vector_store import VectorStore

logger = logging.getLogger(__name__)


class StaticFirstPipeline:
    """静态优先、AI 增强流水线。

    特点：
    1. 静态分析产出结构层数据（高置信度）
    2. AI 增强补充语义信息（低置信度字段追加）
    3. Stage 3 和 Stage 4a 并行执行
    4. 字段级合并，保留静态分析的高置信度元数据
    """

    def __init__(
        self,
        config: Optional[AIAnalysisConfig] = None,
        graph_repo: Optional[GraphRepository] = None,
        vector_store: Optional[VectorStore] = None,
        rag_engine: Optional[GraphRAGEngine] = None,
        max_workers: int = 4,
        enable_cache: bool = True,
    ):
        self.config = config or AIAnalysisConfig()
        self._repo = graph_repo or GraphRepository()
        self._vector_store = vector_store
        self._rag_engine = rag_engine
        self.max_workers = max_workers
        self.enable_cache = enable_cache
        self._cache_manager = StageCacheManager() if enable_cache else None

    def analyze(
        self,
        repo_path: str | Path,
        *,
        repo_name: str = "",
        enable_rag: bool = False,
        on_progress: Optional[Callable[[dict], None]] = None,
        observer: Optional[AnalysisObserver] = None,
        last_commit_sha: Optional[str] = None,
    ) -> AIAnalysisResult:
        """执行静态优先分析。

        Args:
            repo_path: 仓库路径
            repo_name: 仓库名称
            enable_rag: 是否启用 RAG 向量化
            on_progress: 进度回调
            observer: 分析观察器（用于 SSE 事件流）
            last_commit_sha: 上次分析的 commit SHA（用于增量模式）

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

        # 获取当前 commit SHA
        current_commit_sha = self._get_commit_sha(repo_path)

        # ── Stage 1: FileIndex ───────────────────────────────────────────────
        if on_progress:
            on_progress(
                {"step": "file_index", "status": "start", "message": "扫描文件..."}
            )

        file_index_stage = FileIndexStage()
        file_index_result = file_index_stage.run(repo_path)

        if not file_index_result.all_files:
            raise ValueError(f"没有找到任何源码文件: {repo_path}")

        if on_progress:
            on_progress(
                {
                    "step": "file_index",
                    "status": "complete",
                    "message": f"文件扫描完成: {len(file_index_result.all_files)} 个文件",
                    "file_count": len(file_index_result.all_files),
                    "is_incremental": file_index_result.is_incremental,
                }
            )

        logger.info(
            "[file_index] 完成: %d 文件, 增量=%s",
            len(file_index_result.all_files),
            file_index_result.is_incremental,
        )

        # ── Stage 2: DeepStaticAnalysis ───────────────────────────────────────
        if on_progress:
            on_progress(
                {"step": "deep_static_analysis", "status": "start", "message": "深度静态分析..."}
            )

        static_stage = DeepStaticAnalysisStage(max_workers=self.max_workers)
        static_result = static_stage.run(
            repo_path,
            file_index_result.all_files,
            observer=observer,
            on_progress=on_progress,
        )

        if on_progress:
            on_progress(
                {
                    "step": "deep_static_analysis",
                    "status": "complete",
                    "message": f"静态分析完成: {len(static_result.structural_nodes)} 节点",
                    "node_count": len(static_result.structural_nodes),
                    "edge_count": len(static_result.structural_edges),
                }
            )

        logger.info(
            "[deep_static_analysis] 完成: %d 节点, %d 边, %d 框架模式",
            len(static_result.structural_nodes),
            len(static_result.structural_edges),
            len(static_result.framework_patterns),
        )

        # ── Stage 3 + Stage 4a 并行执行 ──────────────────────────────────────
        if on_progress:
            on_progress(
                {"step": "parallel_stage", "status": "start", "message": "并行执行 Stage 3 + Stage 4a..."}
            )

        # 并行执行结果容器
        module_candidates = None
        di_event_edges = []
        di_event_ambiguities = []

        # 使用 ThreadPoolExecutor 并行执行
        with ThreadPoolExecutor(max_workers=2) as executor:
            # Stage 3: DirectoryCluster
            cluster_future = executor.submit(
                self._run_stage3_cluster,
                file_index_result.all_files,
                static_result.import_graph,
                observer,
                on_progress,
            )

            # Stage 4a: SpringDIEventStatic
            di_event_future = executor.submit(
                self._run_stage4a_static,
                static_result,
                repo_path,
                observer,
                on_progress,
            )

            # 等待结果
            module_candidates = cluster_future.result()
            di_event_edges, di_event_ambiguities = di_event_future.result()

        if on_progress:
            on_progress(
                {
                    "step": "parallel_stage",
                    "status": "complete",
                    "message": f"并行阶段完成: {len(module_candidates)} 模块, {len(di_event_edges)} DI/Event 边",
                }
            )

        logger.info(
            "[parallel_stage] 完成: %d 模块候选, %d DI/Event 边, %d 歧义",
            len(module_candidates),
            len(di_event_edges),
            len(di_event_ambiguities),
        )

        # ── Stage 3b: AISemanticEnhance ───────────────────────────────────────
        if on_progress:
            on_progress(
                {"step": "ai_semantic_enhance", "status": "start", "message": "AI 语义增强..."}
            )

        ai_enhance_stage = AISemanticEnhanceStage(max_concurrency=self.max_workers)
        enhancements, ai_nodes, ai_edges, failed_modules = ai_enhance_stage.run(
            module_candidates=module_candidates,
            static_result=static_result,
            llm_client=llm_client,
            observer=observer,
            on_progress=on_progress,
        )

        if on_progress:
            on_progress(
                {
                    "step": "ai_semantic_enhance",
                    "status": "complete",
                    "message": f"AI 语义增强完成: {len(enhancements)} 模块",
                    "module_count": len(enhancements),
                    "failed_count": len(failed_modules),
                }
            )

        logger.info(
            "[ai_semantic_enhance] 完成: %d 增强, %d 新节点, %d 新边, %d 失败",
            len(enhancements),
            len(ai_nodes),
            len(ai_edges),
            len(failed_modules),
        )

        # ── Stage 4b: SpringDIEventAI ─────────────────────────────────────────
        all_di_event_edges = list(di_event_edges)

        if di_event_ambiguities:
            if on_progress:
                on_progress(
                    {
                        "step": "spring_di_event_ai",
                        "status": "start",
                        "message": f"AI 解析 {len(di_event_ambiguities)} 个歧义...",
                    }
                )

            ai_di_stage = SpringDIEventAIStage()
            ai_di_edges = ai_di_stage.run(
                ambiguities=di_event_ambiguities,
                llm_client=llm_client,
                observer=observer,
                on_progress=on_progress,
            )
            all_di_event_edges.extend(ai_di_edges)

            if on_progress:
                on_progress(
                    {
                        "step": "spring_di_event_ai",
                        "status": "complete",
                        "message": f"AI 歧义解析完成: {len(ai_di_edges)} 条边",
                        "edge_count": len(ai_di_edges),
                    }
                )

            logger.info("[spring_di_event_ai] 完成: %d 条 AI 解析边", len(ai_di_edges))
        else:
            logger.info("[spring_di_event_ai] 跳过: 无歧义")

        # ── Stage 5: GraphMerge + QualityReport ───────────────────────────────
        merge_stage = GraphMergeWithQualityStage()
        built, quality_report = merge_stage.run(
            structural_nodes=static_result.structural_nodes,
            structural_edges=static_result.structural_edges,
            ai_enhanced_nodes=ai_nodes,
            ai_enhanced_edges=ai_edges,
            di_event_edges=all_di_event_edges,
            failed_modules=failed_modules,
            observer=observer,
            on_progress=on_progress,
        )

        # ── 持久化 ──────────────────────────────────────────────────────────
        if on_progress:
            on_progress(
                {"step": "repository", "status": "start", "message": "保存图谱..."}
            )

        graph_id = self._repo.save(built, repo_name=name)

        if on_progress:
            on_progress(
                {
                    "step": "repository",
                    "status": "complete",
                    "message": f"图谱已保存: {graph_id}",
                    "graph_id": graph_id,
                }
            )

        # ── RAG（可选）──────────────────────────────────────────────────────
        if enable_rag:
            try:
                rag = self._get_rag_engine()
                rag.embed_nodes(graph_id, built.nodes)
            except Exception as e:
                logger.warning("向量化失败: %s", e)

        # ── 结果汇总 ────────────────────────────────────────────────────────
        duration = time.time() - start
        elapsed_ms = int(duration * 1000)
        status = "success" if not failed_modules else "partial"

        # 发送 AnalysisCompleted 事件
        if observer:
            emit_analysis_completed(
                observer=observer,
                graph_id=graph_id,
                quality_report=quality_report,
                elapsed_ms=elapsed_ms,
            )
            observer.emit_end()

        logger.info(
            "StaticFirstPipeline 完成: status=%s, 耗时=%.2fs, graph_id=%s"
            " | 节点=%d, 边=%d"
            " | 静态节点=%.1f%%, AI节点=%.1f%%, 低置信度边=%.1f%%"
            " | 失败模块=%d, 告警=%d",
            status,
            duration,
            graph_id,
            built.node_count,
            built.edge_count,
            quality_report.static_node_ratio * 100,
            quality_report.ai_node_ratio * 100,
            quality_report.low_confidence_edge_ratio * 100,
            len(quality_report.failed_modules),
            len(quality_report.warnings),
        )

        # 将质量报告警告添加到结果中
        all_warnings = list(quality_report.warnings)
        all_warnings.extend(quality_report.errors)

        return AIAnalysisResult(
            graph_id=graph_id,
            nodes=built.nodes,
            edges=built.edges,
            status=status,
            failed_modules=failed_modules,
            warnings=all_warnings,
            duration_seconds=duration,
        )

    def _run_stage3_cluster(
        self,
        all_files,
        import_graph,
        observer,
        on_progress,
    ):
        """执行 Stage 3: DirectoryCluster。"""
        cluster_stage = DirectoryClusterStage()
        candidates = cluster_stage.run(
            all_files=all_files,
            import_graph=import_graph,
            observer=observer,
            on_progress=on_progress,
        )
        return candidates

    def _run_stage4a_static(
        self,
        static_result,
        repo_path,
        observer,
        on_progress,
    ):
        """执行 Stage 4a: SpringDIEventStatic。"""
        di_event_stage = SpringDIEventStaticStage()

        # 查找 application.yml 文件
        yml_paths = list(repo_path.glob("**/application*.yml"))
        yml_paths.extend(repo_path.glob("**/application*.yaml"))

        edges, ambiguities = di_event_stage.run(
            framework_patterns=static_result.framework_patterns,
            application_yml_paths=yml_paths,
            observer=observer,
            on_progress=on_progress,
        )
        return edges, ambiguities

    def _create_llm_client(self) -> LLMClient:
        """创建 LLM 客户端。"""
        provider = os.environ.get("LLM_PROVIDER", self.config.provider)
        api_key = (
            os.environ.get("LLM_API_KEY")
            or os.environ.get("ZHIPU_API_KEY")
            or os.environ.get("ANTHROPIC_API_KEY")
            or os.environ.get("OPENAI_API_KEY")
            or os.environ.get("MINIMAX_API_KEY")
        )
        base_url = os.environ.get("LLM_BASE_URL") or os.environ.get(
            "ANTHROPIC_BASE_URL"
        )
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

    @staticmethod
    def _get_commit_sha(repo_path: Path) -> str:
        """获取当前 commit SHA。"""
        try:
            import subprocess
            result = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=repo_path,
                capture_output=True,
                text=True,
                timeout=5,
            )
            return result.stdout.strip() if result.returncode == 0 else ""
        except Exception:
            return ""
