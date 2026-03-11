"""
代码仓库扫描器模块。

支持大型仓库分批扫描（每批最多 50 文件）、增量扫描和模块探测。

核心输出结构::

    ScanBatch(
        directories = [DirectoryInfo, ...],
        files       = [FileInfo, ...],
        modules     = [ModuleInfo, ...],
    )

主要方法：
    scan_repository()  —— 流式产出 ScanBatch，每批 ≤ BATCH_SIZE 个文件
    scan_directory()   —— 扫描单个目录，返回一个 ScanBatch
    detect_modules()   —— 识别仓库内所有模块根，返回 list[ModuleInfo]
    scan()             —— 向后兼容：收集全部批次返回 ScanResult
"""

from __future__ import annotations

import hashlib
import logging
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator, Optional

from backend.parser.language_loader import LanguageLoader, default_loader

logger = logging.getLogger(__name__)

# 每批最多处理的文件数
BATCH_SIZE = 50

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DEFAULT_IGNORE_DIRS: frozenset[str] = frozenset({
    ".git", ".svn", ".hg",
    "node_modules", "__pycache__", ".pytest_cache",
    "venv", ".venv", "env", ".env",
    "dist", "build", "target", "out",
    ".idea", ".vscode", ".tox",
    "coverage", ".coverage", "htmlcov",
})

DEFAULT_IGNORE_EXTENSIONS: frozenset[str] = frozenset({
    ".pyc", ".pyo", ".pyd",
    ".class", ".jar", ".war",
    ".o", ".obj", ".so", ".dll", ".exe",
    ".min.js", ".min.css",
    ".lock",
})

# 模块标记文件 → 对应语言
MODULE_MARKERS: dict[str, str] = {
    "__init__.py":        "python",
    "pyproject.toml":     "python",
    "setup.py":           "python",
    "setup.cfg":          "python",
    "package.json":       "javascript",
    "go.mod":             "go",
    "Cargo.toml":         "rust",
    "pom.xml":            "java",
    "build.gradle":       "java",
    "build.gradle.kts":   "java",
}


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------


@dataclass
class DirectoryInfo:
    """目录元数据。"""

    path: str
    """相对于仓库根目录的路径"""

    abs_path: str
    """绝对路径"""

    depth: int = 0
    """相对于仓库根的深度（根目录为 0）"""

    file_count: int = 0
    """目录直接包含的源码文件数"""


@dataclass
class FileInfo:
    """单个文件的元数据。"""

    path: str
    """相对于仓库根目录的路径"""

    abs_path: str
    """绝对路径"""

    language: str
    """检测到的编程语言"""

    size_bytes: int = 0
    line_count: int = 0
    sha256: str = ""
    last_modified: float = 0.0


@dataclass
class ModuleInfo:
    """模块/包根节点信息。"""

    path: str
    """相对于仓库根目录的路径"""

    abs_path: str
    """绝对路径"""

    name: str
    """模块名称（取目录名）"""

    language: str
    """模块主语言"""

    marker_file: str
    """触发识别的标记文件名（如 __init__.py）"""


@dataclass
class ScanBatch:
    """一批扫描结果，每批包含至多 BATCH_SIZE 个文件。"""

    directories: list[DirectoryInfo] = field(default_factory=list)
    files: list[FileInfo] = field(default_factory=list)
    modules: list[ModuleInfo] = field(default_factory=list)

    batch_index: int = 0
    """从 0 开始的批次序号"""

    is_last: bool = False
    """是否为最后一批"""


@dataclass
class ScanState:
    """增量扫描状态，保存上次扫描的文件哈希。"""

    repo_path: str
    file_hashes: dict[str, str] = field(default_factory=dict)
    """{ 相对路径: sha256 }"""


# ---------------------------------------------------------------------------
# Backward-compat ScanResult（pipeline 仍使用此结构）
# ---------------------------------------------------------------------------


@dataclass
class ScanResult:
    """向后兼容：仓库全量扫描结果（由 scan() 返回）。"""

    repo_path: str
    repo_name: str
    files: list[FileInfo] = field(default_factory=list)
    language_stats: dict[str, int] = field(default_factory=dict)
    total_lines: int = 0
    total_files: int = 0
    git_branch: Optional[str] = None
    git_commit: Optional[str] = None
    git_remote_url: Optional[str] = None
    errors: list[str] = field(default_factory=list)

    def primary_language(self) -> Optional[str]:
        if not self.language_stats:
            return None
        return max(self.language_stats, key=self.language_stats.get)  # type: ignore


# ---------------------------------------------------------------------------
# RepoScanner
# ---------------------------------------------------------------------------


class RepoScanner:
    """
    代码仓库扫描器。

    - ``scan_repository()`` — 大型仓库流式分批扫描，每批 ≤ BATCH_SIZE 文件
    - ``scan_directory()``  — 扫描单一目录
    - ``detect_modules()``  — 识别仓库模块边界
    - ``scan()``            — 一次性全量扫描（向后兼容）
    """

    def __init__(
        self,
        loader: Optional[LanguageLoader] = None,
        ignore_dirs: Optional[set[str]] = None,
        ignore_extensions: Optional[set[str]] = None,
        max_file_size_mb: float = 10.0,
        batch_size: int = BATCH_SIZE,
    ) -> None:
        self.loader = loader or default_loader
        self.ignore_dirs = DEFAULT_IGNORE_DIRS | (ignore_dirs or set())
        self.ignore_extensions = DEFAULT_IGNORE_EXTENSIONS | (ignore_extensions or set())
        self.max_file_size = int(max_file_size_mb * 1024 * 1024)
        self.batch_size = batch_size

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def scan_repository(
        self,
        repo_path: str | Path,
        languages: Optional[list[str]] = None,
        state: Optional[ScanState] = None,
    ) -> Iterator[ScanBatch]:
        """流式扫描整个仓库，每批最多 ``batch_size`` 个文件。

        Args:
            repo_path: 仓库根目录。
            languages: 限定语言列表，为空扫描全部。
            state:     上次扫描状态；若提供则跳过未变更文件（增量模式）。

        Yields:
            ScanBatch，batch_index 从 0 递增，最后一批 is_last=True。
        """
        root = Path(repo_path).resolve()
        if not root.exists():
            raise ValueError(f"仓库路径不存在: {root}")

        lang_filter = set(languages) if languages else None
        previous_hashes: dict[str, str] = state.file_hashes if state else {}
        is_incremental = bool(previous_hashes)

        # 一次性扫出所有目录和模块（轻量，不受批次限制）
        directories = list(self._collect_directories(root))
        modules = self.detect_modules(root)

        # 按批次产出文件
        file_buffer: list[FileInfo] = []
        batch_index = 0

        for file_info in self._walk_files(root, lang_filter, compute_hash=True):
            # 增量模式：跳过未修改的文件
            if is_incremental:
                prev_hash = previous_hashes.get(file_info.path)
                if prev_hash and prev_hash == file_info.sha256:
                    continue

            file_buffer.append(file_info)

            if len(file_buffer) >= self.batch_size:
                yield ScanBatch(
                    directories=directories,
                    files=file_buffer,
                    modules=modules,
                    batch_index=batch_index,
                    is_last=False,
                )
                file_buffer = []
                batch_index += 1

        # 最后一批（含空批次，确保调用方收到 is_last 信号）
        yield ScanBatch(
            directories=directories,
            files=file_buffer,
            modules=modules,
            batch_index=batch_index,
            is_last=True,
        )

        logger.info(
            "scan_repository 完成: %s | 批次: %d | 模式: %s",
            root.name,
            batch_index + 1,
            "增量" if is_incremental else "全量",
        )

    def scan_directory(
        self,
        dir_path: str | Path,
        root: Optional[str | Path] = None,
        languages: Optional[list[str]] = None,
    ) -> ScanBatch:
        """扫描单个目录（非递归），返回一个 ScanBatch。

        Args:
            dir_path:  要扫描的目录。
            root:      仓库根目录，用于计算相对路径；默认与 dir_path 相同。
            languages: 语言过滤。
        """
        dir_path = Path(dir_path).resolve()
        root_path = Path(root).resolve() if root else dir_path

        if not dir_path.is_dir():
            raise ValueError(f"目录不存在: {dir_path}")

        lang_filter = set(languages) if languages else None
        rel = dir_path.relative_to(root_path) if dir_path != root_path else Path(".")

        dir_info = DirectoryInfo(
            path=str(rel),
            abs_path=str(dir_path),
            depth=len(rel.parts),
        )

        files: list[FileInfo] = []
        for entry in dir_path.iterdir():
            if not entry.is_file():
                continue
            if entry.suffix.lower() in self.ignore_extensions:
                continue

            language = self.loader.get_language_for_file(entry)
            if language is None:
                continue
            if lang_filter and language not in lang_filter:
                continue

            try:
                stat = entry.stat()
            except OSError:
                continue

            if stat.st_size > self.max_file_size:
                continue

            try:
                content = entry.read_bytes()
                line_count = content.count(b"\n") + 1
                sha256 = hashlib.sha256(content).hexdigest()
            except OSError:
                continue

            files.append(FileInfo(
                path=str(entry.relative_to(root_path)),
                abs_path=str(entry),
                language=language,
                size_bytes=stat.st_size,
                line_count=line_count,
                sha256=sha256,
                last_modified=stat.st_mtime,
            ))
            if len(files) >= self.batch_size:
                break

        dir_info.file_count = len(files)

        # 模块探测：仅在当前目录内查找
        modules = [
            m for m in self.detect_modules(root_path)
            if Path(m.abs_path).parent == dir_path or Path(m.abs_path) == dir_path
        ]

        return ScanBatch(
            directories=[dir_info],
            files=files,
            modules=modules,
            batch_index=0,
            is_last=True,
        )

    def detect_modules(self, repo_path: str | Path) -> list[ModuleInfo]:
        """扫描仓库，识别所有模块/包根节点。

        通过查找 MODULE_MARKERS 中定义的标记文件来定位模块边界。

        Args:
            repo_path: 仓库根目录。

        Returns:
            ModuleInfo 列表，每个代表一个独立模块。
        """
        root = Path(repo_path).resolve()
        modules: list[ModuleInfo] = []
        seen: set[str] = set()

        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [
                d for d in dirnames
                if d not in self.ignore_dirs and not d.startswith(".")
            ]

            dir_path = Path(dirpath)
            filename_set = set(filenames)

            for marker, language in MODULE_MARKERS.items():
                if marker not in filename_set:
                    continue

                abs_str = str(dir_path)
                if abs_str in seen:
                    break  # 同目录已登记，不重复
                seen.add(abs_str)

                try:
                    rel = str(dir_path.relative_to(root))
                except ValueError:
                    rel = abs_str

                modules.append(ModuleInfo(
                    path=rel if rel != "." else "",
                    abs_path=abs_str,
                    name=dir_path.name or root.name,
                    language=language,
                    marker_file=marker,
                ))
                break  # 每个目录只记录一次（第一个匹配的 marker）

        logger.debug("detect_modules: 识别到 %d 个模块", len(modules))
        return modules

    # ------------------------------------------------------------------
    # Backward compat — used by AnalysisPipeline
    # ------------------------------------------------------------------

    def scan(
        self,
        repo_path: str | Path,
        languages: Optional[list[str]] = None,
        compute_hash: bool = True,
    ) -> ScanResult:
        """全量扫描，返回 ScanResult（向后兼容 pipeline）。"""
        root = Path(repo_path).resolve()
        if not root.exists():
            raise ValueError(f"仓库路径不存在: {root}")

        result = ScanResult(
            repo_path=str(root),
            repo_name=root.name,
        )
        self._read_git_info(root, result)

        lang_filter = set(languages) if languages else None
        for file_info in self._walk_files(root, lang_filter, compute_hash):
            result.files.append(file_info)
            result.total_lines += file_info.line_count
            lang = file_info.language
            result.language_stats[lang] = result.language_stats.get(lang, 0) + 1

        result.total_files = len(result.files)
        logger.info(
            "scan 完成: %s | 文件: %d | 行数: %d | 语言: %s",
            result.repo_name,
            result.total_files,
            result.total_lines,
            result.language_stats,
        )
        return result

    def build_state(self, repo_path: str | Path) -> ScanState:
        """扫描仓库并构建当前状态（用于下次增量比对）。"""
        root = Path(repo_path).resolve()
        hashes: dict[str, str] = {}
        for file_info in self._walk_files(root, lang_filter=None, compute_hash=True):
            hashes[file_info.path] = file_info.sha256
        return ScanState(repo_path=str(root), file_hashes=hashes)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _collect_directories(self, root: Path) -> Iterator[DirectoryInfo]:
        """遍历所有非忽略子目录，产出 DirectoryInfo。"""
        for dirpath, dirnames, _ in os.walk(root):
            dirnames[:] = [
                d for d in dirnames
                if d not in self.ignore_dirs and not d.startswith(".")
            ]
            dir_path = Path(dirpath)
            try:
                rel = dir_path.relative_to(root)
            except ValueError:
                continue
            yield DirectoryInfo(
                path=str(rel) if str(rel) != "." else "",
                abs_path=str(dir_path),
                depth=len(rel.parts),
            )

    def _walk_files(
        self,
        root: Path,
        lang_filter: Optional[set[str]],
        compute_hash: bool,
    ) -> Iterator[FileInfo]:
        """递归遍历目录产出 FileInfo（不受批次大小限制）。"""
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [
                d for d in dirnames
                if d not in self.ignore_dirs and not d.startswith(".")
            ]

            for filename in filenames:
                full_path = Path(dirpath) / filename
                ext = full_path.suffix.lower()

                if ext in self.ignore_extensions:
                    continue

                language = self.loader.get_language_for_file(full_path)
                if language is None:
                    continue
                if lang_filter and language not in lang_filter:
                    continue

                try:
                    stat = full_path.stat()
                except OSError:
                    continue

                if stat.st_size > self.max_file_size:
                    logger.debug("跳过超大文件: %s (%dKB)", full_path, stat.st_size // 1024)
                    continue

                rel_path = str(full_path.relative_to(root))
                sha256 = ""
                line_count = 0

                try:
                    content = full_path.read_bytes()
                    line_count = content.count(b"\n") + 1
                    if compute_hash:
                        sha256 = hashlib.sha256(content).hexdigest()
                except OSError as e:
                    logger.warning("读取文件失败 %s: %s", full_path, e)
                    continue

                yield FileInfo(
                    path=rel_path,
                    abs_path=str(full_path),
                    language=language,
                    size_bytes=stat.st_size,
                    line_count=line_count,
                    sha256=sha256,
                    last_modified=stat.st_mtime,
                )

    def _read_git_info(self, root: Path, result: ScanResult) -> None:
        """读取 Git 元数据写入 ScanResult。"""
        try:
            import git  # gitpython

            repo = git.Repo(root, search_parent_directories=True)
            result.git_branch = repo.active_branch.name
            result.git_commit = repo.head.commit.hexsha
            remotes = repo.remotes
            if remotes:
                result.git_remote_url = remotes[0].url
        except ImportError:
            logger.warning("gitpython 未安装，跳过 Git 元数据读取")
        except Exception as e:
            logger.debug("读取 Git 信息失败: %s", e)
            result.errors.append(f"Git 读取失败: {e}")
