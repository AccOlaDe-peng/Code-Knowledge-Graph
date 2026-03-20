"""Stage 0: 文件索引（asyncio + 增量检测）。

扫描仓库文件，构建文件元数据索引，支持增量检测（git diff 优先）。
"""
from __future__ import annotations

import asyncio
import logging
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from backend.models.static_analysis import FileInfo, FileIndexResult
from backend.pipeline.observer import AnalysisObserver, StageStarted, StageCompleted
from backend.pipeline.stages.base import StageBase
from backend.scanner.repo_scanner import RepoScanner

logger = logging.getLogger(__name__)


# 支持语言扩展名映射
_LANG_MAP: dict[str, str] = {
    ".py": "python",
    ".java": "java",
    ".ts": "typescript",
    ".js": "javascript",
    ".go": "go",
    ".rs": "rust",
    ".cpp": "cpp",
    ".c": "c",
    ".h": "c",
    ".kt": "kotlin",
    ".scala": "scala",
    ".cs": "csharp",
}


@dataclass
class CachedFileIndex:
    """缓存的文件索引（用于增量检测）。"""

    file_paths: list[str]  # 相对路径列表
    commit_sha: str  # 当时的 commit SHA
    dir_set: set[str]  # 目录集合（用于 Stage 2 增量判断）


class FileIndexStage(StageBase):
    """Stage 0: 文件索引（asyncio + 增量检测）。

    与旧 FileIndexStage 的区别：
    1. 使用 asyncio + aiofiles 并发读取文件元数据
    2. 增量检测改为 git diff 优先
    3. 返回 FileIndexResult（含 is_incremental 和 changed_files）
    """

    name = "file_index"

    def __init__(
        self,
        max_concurrent: int = 50,
    ):
        """
        Args:
            max_concurrent: 并发读取文件的最大数量
        """
        self.max_concurrent = max_concurrent

    def run(
        self,
        repo_path: Path,
        last_commit_sha: str | None = None,
        cached_index: CachedFileIndex | None = None,
        observer: AnalysisObserver | None = None,
        on_progress: Callable[[dict], None] | None = None,
    ) -> FileIndexResult:
        """执行文件索引（同步包装器，内部调用异步实现）。

        Args:
            repo_path: 仓库根目录
            last_commit_sha: 上次分析的 commit SHA（用于 git diff 增量检测）
            cached_index: 缓存的文件索引（用于非 git 增量检测）
            observer: 事件观察器
            on_progress: 进度回调

        Returns:
            FileIndexResult: 文件索引结果
        """
        return asyncio.run(
            self.run_async(
                repo_path,
                last_commit_sha=last_commit_sha,
                cached_index=cached_index,
                observer=observer,
                on_progress=on_progress,
            )
        )

    async def run_async(
        self,
        repo_path: Path,
        last_commit_sha: str | None = None,
        cached_index: CachedFileIndex | None = None,
        observer: AnalysisObserver | None = None,
        on_progress: Callable[[dict], None] | None = None,
    ) -> FileIndexResult:
        """异步执行文件索引。"""
        repo_path = Path(repo_path).resolve()
        start_time = asyncio.get_event_loop().time()

        # 发送开始事件
        if observer:
            observer.emit(StageStarted.create("file_index"))

        if on_progress:
            on_progress(
                {"step": "file_index", "status": "start", "message": "扫描文件列表..."}
            )

        # Step 1: 获取当前 commit SHA
        current_sha = self._get_commit_sha(repo_path)

        # Step 2: 判断是否增量模式
        is_incremental = False
        changed_files: set[str] = set()

        if last_commit_sha and current_sha and last_commit_sha != current_sha:
            # Git diff 增量检测
            changed_files = self._get_changed_files(repo_path, last_commit_sha)
            is_incremental = len(changed_files) > 0
            if is_incremental:
                logger.info(
                    "Git 增量检测: %d 个变更文件 (%s -> %s)",
                    len(changed_files),
                    last_commit_sha[:8],
                    current_sha[:8],
                )
        elif cached_index and not last_commit_sha:
            # 非 Git，使用缓存的文件列表
            # 这里简化处理：假设所有文件都需要重新扫描
            # 实际可以对比 mtime，但收益不大
            pass

        # Step 3: 扫描文件
        scanner = RepoScanner()
        scan_result = scanner.scan(repo_path)
        file_paths = [f.path for f in scan_result.files]

        if not file_paths:
            raise ValueError(f"没有找到任何源码文件: {repo_path}")

        # Step 4: 并发构建文件元数据
        all_files = await self._build_file_index_async(repo_path, file_paths)

        elapsed_ms = int((asyncio.get_event_loop().time() - start_time) * 1000)

        # 发送完成事件
        if observer:
            observer.emit(
                StageCompleted.create("file_index", elapsed_ms, cache_hit=False)
            )

        msg = f"文件索引完成: {len(all_files)} 个文件"
        if is_incremental:
            msg += f" | 增量: {len(changed_files)} 个变更"

        logger.info("Stage 0 完成: %s", msg)
        if on_progress:
            on_progress(
                {
                    "step": "file_index",
                    "status": "complete",
                    "message": msg,
                    "files": len(all_files),
                    "is_incremental": is_incremental,
                }
            )

        return FileIndexResult(
            all_files=all_files,
            changed_files=changed_files,
            is_incremental=is_incremental,
        )

    async def _build_file_index_async(
        self,
        repo_path: Path,
        file_paths: list[str],
    ) -> dict[str, FileInfo]:
        """并发构建文件元数据索引。"""
        semaphore = asyncio.Semaphore(self.max_concurrent)

        async def build_single(rel_path: str) -> tuple[str, FileInfo] | None:
            async with semaphore:
                abs_path = repo_path / rel_path
                if not abs_path.exists():
                    return None

                try:
                    stat = abs_path.stat()
                    lang = _LANG_MAP.get(abs_path.suffix.lower(), "unknown")

                    # 使用 aiofiles 读取行数
                    try:
                        import aiofiles

                        async with aiofiles.open(abs_path, encoding="utf-8", errors="ignore") as f:
                            line_count = sum(1 async for _ in f)
                    except ImportError:
                        # aiofiles 未安装，使用同步方式
                        line_count = sum(1 for _ in abs_path.open(encoding="utf-8", errors="ignore"))

                    return (
                        rel_path,
                        FileInfo(
                            path=rel_path,
                            absolute_path=abs_path,
                            language=lang,
                            size_bytes=stat.st_size,
                            line_count=line_count,
                            modified_time=stat.st_mtime,
                        ),
                    )
                except OSError as e:
                    logger.warning("无法读取文件元信息 %s: %s", rel_path, e)
                    return None

        # 并发执行
        tasks = [build_single(p) for p in file_paths]
        results = await asyncio.gather(*tasks)

        # 构建字典
        all_files: dict[str, FileInfo] = {}
        for item in results:
            if item is not None:
                rel_path, file_info = item
                all_files[rel_path] = file_info

        return all_files

    def _get_commit_sha(self, repo_path: Path) -> str:
        """获取当前 commit SHA。"""
        try:
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

    def _get_changed_files(self, repo_path: Path, last_sha: str) -> set[str]:
        """获取两次 commit 之间的变更文件。"""
        try:
            result = subprocess.run(
                ["git", "diff", "--name-only", last_sha, "HEAD"],
                cwd=repo_path,
                capture_output=True,
                text=True,
                timeout=30,
            )
            if result.returncode != 0:
                return set()

            changed = set()
            for line in result.stdout.strip().split("\n"):
                line = line.strip()
                if line:
                    changed.add(line)
            return changed
        except Exception as e:
            logger.warning("Git diff 失败: %s", e)
            return set()
