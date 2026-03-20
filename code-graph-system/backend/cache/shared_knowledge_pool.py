"""共享知识池 — 统一管理文件索引、结构索引和内容缓存。"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from backend.agent.structure_indexer import FileSkeleton, StructureIndexer
from backend.cache.content_cache import ContentCache

if TYPE_CHECKING:
    pass

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
class FileInfo:
    """文件元信息。"""

    path: str  # 相对路径
    absolute_path: Path  # 绝对路径
    language: str  # 语言类型
    size_bytes: int  # 文件大小（字节）
    line_count: int  # 行数
    modified_time: float  # mtime


class SharedKnowledgePool:
    """共享知识池（线程安全）。

    生命周期：
        pool = SharedKnowledgePool(repo_path)
        pool.build_file_index(file_paths)          # Stage 0 后调用
        pool.structure_indexer.build_index_from_files(...)  # Stage 1 后填充
        content = pool.get_content("src/Foo.java") # Stage 3 中 Agent 调用
    """

    def __init__(
        self,
        repo_path: Path,
        max_content_cache_bytes: int = 100 * 1024 * 1024,
    ) -> None:
        self.repo_path = Path(repo_path)
        self.file_index: dict[str, FileInfo] = {}
        self.structure_indexer: StructureIndexer = StructureIndexer(depth="standard")
        self._content_cache = ContentCache(max_bytes=max_content_cache_bytes)

    # ── Stage 0：构建文件索引 ────────────────────────────────────────────────

    def build_file_index(self, file_paths: list[str]) -> None:
        """从已知路径列表构建文件元信息索引。"""
        self.file_index.clear()
        for rel_path in file_paths:
            abs_path = self.repo_path / rel_path
            if not abs_path.exists():
                continue
            try:
                stat = abs_path.stat()
                lang = _LANG_MAP.get(abs_path.suffix.lower(), "unknown")
                line_count = self._count_lines(abs_path)
                self.file_index[rel_path] = FileInfo(
                    path=rel_path,
                    absolute_path=abs_path,
                    language=lang,
                    size_bytes=stat.st_size,
                    line_count=line_count,
                    modified_time=stat.st_mtime,
                )
            except OSError as e:
                logger.warning("无法读取文件元信息 %s: %s", rel_path, e)

    # ── 公共查询接口 ─────────────────────────────────────────────────────────

    def get_file_info(self, path: str) -> FileInfo | None:
        """获取文件元信息。"""
        return self.file_index.get(path)

    def get_structure(self, path: str) -> FileSkeleton | None:
        """获取文件骨架（类/方法），委托给 StructureIndexer。"""
        return self.structure_indexer._index.get(path)

    def get_content(self, path: str) -> str | None:
        """获取文件内容（自动缓存，线程安全）。"""
        if path not in self.file_index:
            return None
        cached = self._content_cache.get(path)
        if cached is not None:
            return cached
        abs_path = self.file_index[path].absolute_path
        try:
            content = abs_path.read_text(encoding="utf-8", errors="ignore")
            self._content_cache.put(path, content)
            return content
        except OSError as e:
            logger.warning("读取文件失败 %s: %s", path, e)
            return None

    def estimate_tokens(self, paths: list[str]) -> int:
        """估算一组文件的 GLM Token 数。

        GLM Token 规则：
        - 中文字符（\\u4e00-\\u9fff）：1 Token ≈ 1.6 字符
        - 其他内容：约 4 字节/Token
        """
        total = 0
        for path in paths:
            content = self.get_content(path) or ""
            chinese_chars = sum(1 for c in content if "\u4e00" <= c <= "\u9fff")
            other_bytes = len(content.encode("utf-8")) - chinese_chars * 3
            total += int(chinese_chars / 1.6) + max(0, other_bytes // 4)
        return total

    # ── 私有工具 ─────────────────────────────────────────────────────────────

    @staticmethod
    def _count_lines(path: Path) -> int:
        try:
            return sum(1 for _ in path.open(encoding="utf-8", errors="ignore"))
        except OSError:
            return 0
