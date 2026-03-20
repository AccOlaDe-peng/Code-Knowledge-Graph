"""优化版流水线 — 5 阶段编排入口。

内部编排 5 个 Stage，对外暴露与 AIPipeline 相同的 analyze() 接口。
"""
from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import asdict
from pathlib import Path
from typing import Callable, Optional

from backend.cache.shared_knowledge_pool import SharedKnowledgePool
from backend.graph.graph_repository import GraphRepository
from backend.llm.client import LLMClient
from backend.models.ai_analysis import (
    AIAnalysisConfig,
    AIAnalysisResult,
    ModuleInfo,
    ModulePlan,
)
from backend.pipeline.pipeline_scheduler import SchedulerConfig
from backend.pipeline.stage_cache import StageCacheEntry, StageCacheManager
from backend.pipeline.stages.file_index import FileIndexStage
from backend.pipeline.stages.graph_merge import GraphMergeStage
from backend.pipeline.stages.module_boundary import ModuleBoundaryStage
from backend.pipeline.stages.parallel_analysis import ParallelAnalysisStage
from backend.pipeline.stages.structure_parse import StructureParseStage
from backend.rag.graph_rag_engine import GraphRAGEngine
from backend.rag.vector_store import VectorStore

logger = logging.getLogger(__name__)


class OptimizedPipeline:
    """优化版 AI 分析流水线（5 阶段）。

    与 AIPipeline 接口兼容，通过 AIPipeline(enable_optimization=True) 调用。
    """

    def __init__(
        self,
        config: Optional[AIAnalysisConfig] = None,
        graph_repo: Optional[GraphRepository] = None,
        vector_store: Optional[VectorStore] = None,
        rag_engine: Optional[GraphRAGEngine] = None,
        scheduler_config: Optional[SchedulerConfig] = None,
        persist_stage_cache: bool = False,
    ):
        self.config = config or AIAnalysisConfig()
        self._repo = graph_repo or GraphRepository()
        self._vector_store = vector_store
        self._rag_engine = rag_engine
        self._scheduler_config = scheduler_config or SchedulerConfig()
        self._stage_cache = StageCacheManager()
        self._persist_stage_cache = persist_stage_cache

    def analyze(
        self,
        repo_path: str | Path,
        *,
        repo_name: str = "",
        enable_rag: bool = False,
        on_progress: Optional[Callable[[dict], None]] = None,
    ) -> AIAnalysisResult:
        start = time.time()
        repo_path = Path(repo_path).resolve()

        if not repo_path.exists():
            raise ValueError(f"仓库路径不存在: {repo_path}")
        if not repo_path.is_dir():
            raise ValueError(f"路径不是目录: {repo_path}")

        name = repo_name or repo_path.name
        llm_client = self._create_llm_client()
        pool = SharedKnowledgePool(repo_path)

        # 获取 commit sha（用于缓存 key）
        commit_sha = self._get_commit_sha(repo_path)

        # ── Stage 0: FileIndex ───────────────────────────────────────────────
        cached = self._stage_cache.load(name, commit_sha, "file_index")
        if cached:
            pool.build_file_index(cached.data)
            logger.info("Stage 0 缓存命中")
            if on_progress:
                on_progress(
                    {
                        "step": "file_index",
                        "status": "cached",
                        "message": "文件索引缓存命中",
                    }
                )
        else:
            file_paths = FileIndexStage().run(repo_path, pool, on_progress)
            if not file_paths:
                raise ValueError(f"没有找到任何源码文件: {repo_path}")
            self._stage_cache.save(
                StageCacheEntry(
                    stage_name="file_index",
                    repo_name=name,
                    commit_sha=commit_sha,
                    data=file_paths,
                ),
                persist=self._persist_stage_cache,
            )

        # ── Stage 1: StructureParse ──────────────────────────────────────────
        cached = self._stage_cache.load(name, commit_sha, "structure_parse")
        if cached:
            logger.info("Stage 1 缓存命中，跳过骨架解析")
            if on_progress:
                on_progress(
                    {
                        "step": "structure_parse",
                        "status": "cached",
                        "message": "骨架解析缓存命中",
                    }
                )
        else:
            StructureParseStage().run(pool, on_progress)
            self._stage_cache.save(
                StageCacheEntry(
                    stage_name="structure_parse",
                    repo_name=name,
                    commit_sha=commit_sha,
                    data=True,
                ),
                persist=self._persist_stage_cache,
            )

        # ── Stage 2: ModuleBoundary ──────────────────────────────────────────
        cached = self._stage_cache.load(name, commit_sha, "module_boundary")
        if cached:
            plan_data = cached.data
            if isinstance(plan_data, dict):
                plan = ModulePlan(
                    modules=[
                        ModuleInfo(**m) if isinstance(m, dict) else m
                        for m in plan_data.get("modules", [])
                    ],
                    architecture_hints=plan_data.get("architecture_hints", {}),
                    confidence=plan_data.get("confidence", 0.0),
                )
            else:
                plan = plan_data
            logger.info("Stage 2 缓存命中")
            if on_progress:
                on_progress(
                    {
                        "step": "module_boundary",
                        "status": "cached",
                        "message": "模块边界缓存命中",
                    }
                )
        else:
            plan = ModuleBoundaryStage().run(pool, llm_client, on_progress)
            # 序列化 plan 用于缓存
            plan_dict = {
                "modules": [asdict(m) for m in (plan.modules or [])],
                "architecture_hints": plan.architecture_hints or {},
                "confidence": plan.confidence,
            }
            self._stage_cache.save(
                StageCacheEntry(
                    stage_name="module_boundary",
                    repo_name=name,
                    commit_sha=commit_sha,
                    data=plan_dict,
                ),
                persist=self._persist_stage_cache,
            )

        modules = plan.modules or []
        if not modules:
            modules = [self._create_default_module(pool)]

        # ── Stage 3: ParallelAnalysis ────────────────────────────────────────
        all_nodes, all_edges, failed = ParallelAnalysisStage().run(
            modules=modules,
            pool=pool,
            llm_client=llm_client,
            scheduler_config=self._scheduler_config,
            on_progress=on_progress,
        )

        # ── Stage 4: GraphMerge ──────────────────────────────────────────────
        built = GraphMergeStage().run(all_nodes, all_edges, on_progress)

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

        status = (
            "success"
            if not failed
            else ("partial" if len(failed) < len(modules) else "failed")
        )
        duration = time.time() - start
        logger.info(
            "OptimizedPipeline 完成: status=%s, 耗时=%.2fs", status, duration
        )

        return AIAnalysisResult(
            graph_id=graph_id,
            nodes=all_nodes,
            edges=all_edges,
            status=status,
            failed_modules=failed,
            warnings=[],
            duration_seconds=duration,
        )

    # ── 私有工具 ─────────────────────────────────────────────────────────────

    def _create_llm_client(self) -> LLMClient:
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

    def _create_default_module(self, pool: SharedKnowledgePool) -> ModuleInfo:
        return ModuleInfo(
            id="module:default",
            name="Default Module",
            files=list(pool.file_index.keys()),
            purpose="自动创建的默认模块",
            language="unknown",
            confidence=1.0,
        )

    def _get_rag_engine(self) -> GraphRAGEngine:
        if self._rag_engine is None:
            vs = self._vector_store or VectorStore()
            self._rag_engine = GraphRAGEngine(
                graph_repo=self._repo, vector_store=vs
            )
        return self._rag_engine

    @staticmethod
    def _get_commit_sha(repo_path: Path) -> str:
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
