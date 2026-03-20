"""Stage 1: 骨架解析 — 利用预扫描文件列表构建 StructureIndexer，跳过重复遍历。"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Callable

from backend.cache.shared_knowledge_pool import SharedKnowledgePool
from backend.pipeline.stages.base import StageBase

logger = logging.getLogger(__name__)


class StructureParseStage(StageBase):
    """Stage 1: 从 Stage 0 的文件列表构建骨架索引。"""

    name = "structure_parse"

    def run(
        self,
        pool: SharedKnowledgePool,
        on_progress: Callable | None = None,
    ) -> None:
        if on_progress:
            on_progress(
                {
                    "step": "structure_parse",
                    "status": "start",
                    "message": "解析代码骨架...",
                }
            )

        file_paths = list(pool.file_index.keys())
        pool.structure_indexer.build_index_from_files(pool.repo_path, file_paths)

        indexed = len(pool.structure_indexer._index)
        msg = f"骨架解析完成: {indexed} 个文件已索引"
        logger.info("Stage 1 完成: %s", msg)
        if on_progress:
            on_progress(
                {
                    "step": "structure_parse",
                    "status": "complete",
                    "message": msg,
                    "indexed": indexed,
                }
            )
