"""Stage 0: 文件索引 — 扫描仓库文件，构建 SharedKnowledgePool.file_index。"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Callable

from backend.cache.shared_knowledge_pool import SharedKnowledgePool
from backend.pipeline.stages.base import StageBase
from backend.scanner.repo_scanner import RepoScanner

logger = logging.getLogger(__name__)


class FileIndexStage(StageBase):
    """Stage 0: 扫描文件列表，填充 SharedKnowledgePool.file_index。"""

    name = "file_index"

    def run(
        self,
        repo_path: Path,
        pool: SharedKnowledgePool,
        on_progress: Callable | None = None,
    ) -> list[str]:
        """
        Returns:
            已扫描的相对路径列表
        """
        if on_progress:
            on_progress(
                {"step": "file_index", "status": "start", "message": "扫描文件列表..."}
            )

        scanner = RepoScanner()
        scan_result = scanner.scan(repo_path)

        file_paths = [f.path for f in scan_result.files]
        pool.build_file_index(file_paths)

        msg = f"文件索引完成: {len(file_paths)} 个文件"
        logger.info("Stage 0 完成: %s", msg)
        if on_progress:
            on_progress(
                {
                    "step": "file_index",
                    "status": "complete",
                    "message": msg,
                    "files": len(file_paths),
                }
            )

        return file_paths
