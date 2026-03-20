"""Stage 2: AI 模块边界识别。"""
from __future__ import annotations

import logging
from typing import Callable

from backend.agent.agents.module_scanner import ModuleScannerAgent
from backend.agent.context import AgentContext, SharedKnowledgeBase
from backend.cache.shared_knowledge_pool import SharedKnowledgePool
from backend.llm.client import LLMClient
from backend.models.ai_analysis import ModulePlan
from backend.pipeline.stages.base import StageBase
from backend.scanner.repo_scanner import FileInfo, ScanResult

logger = logging.getLogger(__name__)


class ModuleBoundaryStage(StageBase):
    """Stage 2: 调用 ModuleScannerAgent 识别模块边界（注入预构建索引）。"""

    name = "module_boundary"

    def run(
        self,
        pool: SharedKnowledgePool,
        llm_client: LLMClient,
        on_progress: Callable | None = None,
    ) -> ModulePlan:
        if on_progress:
            on_progress(
                {
                    "step": "module_boundary",
                    "status": "start",
                    "message": "AI 识别模块边界...",
                }
            )

        context = AgentContext(
            repo_path=str(pool.repo_path),
            module_id="scanner",
            shared_knowledge=SharedKnowledgeBase(),
            structure_indexer=pool.structure_indexer,  # 注入预构建索引
        )

        # 构造 ScanResult（复用 pool 中已有的文件信息）
        scan_files = []
        for rel_path, info in pool.file_index.items():
            scan_files.append(
                FileInfo(
                    path=rel_path,
                    abs_path=str(info.absolute_path),
                    language=info.language,
                )
            )

        scan_result = ScanResult(
            repo_path=str(pool.repo_path),
            repo_name="",  # 不影响模块扫描逻辑
            files=scan_files,
        )

        agent = ModuleScannerAgent(context=context, llm_client=llm_client)
        plan = agent.scan(scan_result)

        modules = plan.modules or []
        msg = f"模块边界识别完成: {len(modules)} 个模块"
        logger.info("Stage 2 完成: %s", msg)
        if on_progress:
            on_progress(
                {
                    "step": "module_boundary",
                    "status": "complete",
                    "message": msg,
                    "modules": len(modules),
                }
            )

        return plan
