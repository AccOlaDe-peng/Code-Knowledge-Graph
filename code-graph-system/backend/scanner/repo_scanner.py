"""
代码仓库扫描器模块。

负责遍历本地代码仓库目录，收集所有可解析的源码文件，
支持 Git 仓库元数据读取、文件过滤和增量变更检测。
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

# 默认忽略的目录和文件模式
DEFAULT_IGNORE_DIRS = {
    ".git", ".svn", ".hg",
    "node_modules", "__pycache__", ".pytest_cache",
    "venv", ".venv", "env", ".env",
    "dist", "build", "target", "out",
    ".idea", ".vscode", ".tox",
    "coverage", ".coverage", "htmlcov",
}

DEFAULT_IGNORE_EXTENSIONS = {
    ".pyc", ".pyo", ".pyd",
    ".class", ".jar", ".war",
    ".o", ".obj", ".so", ".dll", ".exe",
    ".min.js", ".min.css",
    ".lock",
}


@dataclass
class FileInfo:
    """单个文件的元数据信息。"""

    path: str
    """相对于仓库根目录的路径"""

    abs_path: str
    """绝对路径"""

    language: str
    """检测到的编程语言"""

    size_bytes: int = 0
    """文件大小（字节）"""

    line_count: int = 0
    """行数"""

    sha256: str = ""
    """文件内容哈希，用于增量检测"""

    last_modified: float = 0.0
    """最后修改时间戳"""


@dataclass
class ScanResult:
    """仓库扫描结果。"""

    repo_path: str
    """仓库根路径"""

    repo_name: str
    """仓库名称"""

    files: list[FileInfo] = field(default_factory=list)
    """扫描到的文件列表"""

    language_stats: dict[str, int] = field(default_factory=dict)
    """各语言文件数量统计"""

    total_lines: int = 0
    """总代码行数"""

    total_files: int = 0
    """总文件数"""

    git_branch: Optional[str] = None
    """当前 Git 分支"""

    git_commit: Optional[str] = None
    """当前 Git 提交哈希"""

    git_remote_url: Optional[str] = None
    """远程仓库 URL"""

    errors: list[str] = field(default_factory=list)
    """扫描过程中的错误信息"""

    def primary_language(self) -> Optional[str]:
        """返回代码量最多的主语言。"""
        if not self.language_stats:
            return None
        return max(self.language_stats, key=self.language_stats.get)  # type: ignore


class RepoScanner:
    """
    代码仓库扫描器。

    遍历仓库目录，识别源码文件，读取 Git 元数据。
    支持大型仓库的流式迭代扫描模式。

    示例::

        scanner = RepoScanner()
        result = scanner.scan("/path/to/repo")
        print(f"发现 {result.total_files} 个源码文件")
        print(f"主语言: {result.primary_language()}")
    """

    def __init__(
        self,
        loader: Optional[LanguageLoader] = None,
        ignore_dirs: Optional[set[str]] = None,
        ignore_extensions: Optional[set[str]] = None,
        max_file_size_mb: float = 10.0,
    ) -> None:
        """
        初始化扫描器。

        Args:
            loader: 语言加载器实例
            ignore_dirs: 额外要忽略的目录名集合
            ignore_extensions: 额外要忽略的文件扩展名集合
            max_file_size_mb: 单文件最大尺寸（MB），超出则跳过
        """
        self.loader = loader or default_loader
        self.ignore_dirs = DEFAULT_IGNORE_DIRS | (ignore_dirs or set())
        self.ignore_extensions = DEFAULT_IGNORE_EXTENSIONS | (ignore_extensions or set())
        self.max_file_size = int(max_file_size_mb * 1024 * 1024)

    def scan(
        self,
        repo_path: str | Path,
        languages: Optional[list[str]] = None,
        compute_hash: bool = True,
    ) -> ScanResult:
        """
        扫描整个仓库目录。

        Args:
            repo_path: 仓库根目录路径
            languages: 指定要扫描的语言列表，为空则扫描所有支持的语言
            compute_hash: 是否计算文件哈希（用于增量检测，会略微增加扫描时间）

        Returns:
            ScanResult 对象，包含所有文件信息和统计数据
        """
        root = Path(repo_path).resolve()
        if not root.exists():
            raise ValueError(f"仓库路径不存在: {root}")

        result = ScanResult(
            repo_path=str(root),
            repo_name=root.name,
        )

        # 读取 Git 元数据
        self._read_git_info(root, result)

        # 收集文件
        lang_filter = set(languages) if languages else None
        files_iter = self._walk_files(root, lang_filter, compute_hash)

        for file_info in files_iter:
            result.files.append(file_info)
            result.total_lines += file_info.line_count
            lang = file_info.language
            result.language_stats[lang] = result.language_stats.get(lang, 0) + 1

        result.total_files = len(result.files)
        logger.info(
            f"扫描完成: {result.repo_name} | "
            f"文件: {result.total_files} | "
            f"行数: {result.total_lines} | "
            f"语言: {result.language_stats}"
        )
        return result

    def iter_files(
        self,
        repo_path: str | Path,
        languages: Optional[list[str]] = None,
    ) -> Iterator[FileInfo]:
        """
        流式迭代仓库中的源码文件。

        适用于大型仓库，避免一次性加载所有文件信息到内存。

        Args:
            repo_path: 仓库根目录路径
            languages: 指定语言过滤，为空则返回所有

        Yields:
            FileInfo 对象
        """
        root = Path(repo_path).resolve()
        lang_filter = set(languages) if languages else None
        yield from self._walk_files(root, lang_filter, compute_hash=False)

    def detect_changes(
        self,
        repo_path: str | Path,
        previous_hashes: dict[str, str],
    ) -> tuple[list[str], list[str], list[str]]:
        """
        检测仓库文件变更（增量更新用）。

        Args:
            repo_path: 仓库根目录路径
            previous_hashes: 上次扫描时的 {相对路径: sha256} 字典

        Returns:
            (新增文件列表, 修改文件列表, 删除文件列表) 三元组
        """
        root = Path(repo_path).resolve()
        current: dict[str, str] = {}

        for file_info in self._walk_files(root, lang_filter=None, compute_hash=True):
            rel = file_info.path
            current[rel] = file_info.sha256

        prev_set = set(previous_hashes)
        curr_set = set(current)

        added = list(curr_set - prev_set)
        deleted = list(prev_set - curr_set)
        modified = [
            p for p in curr_set & prev_set if current[p] != previous_hashes[p]
        ]

        return added, modified, deleted

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _walk_files(
        self,
        root: Path,
        lang_filter: Optional[set[str]],
        compute_hash: bool,
    ) -> Iterator[FileInfo]:
        """内部：递归遍历目录产生 FileInfo 对象。"""
        for dirpath, dirnames, filenames in os.walk(root):
            # 过滤忽略目录（原地修改 dirnames 让 os.walk 不进入）
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
                    logger.debug(f"跳过超大文件: {full_path} ({stat.st_size / 1024:.0f}KB)")
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
                    logger.warning(f"读取文件失败 {full_path}: {e}")
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
        """读取 Git 仓库元数据并写入 ScanResult。"""
        try:
            import git  # gitpython

            repo = git.Repo(root, search_parent_directories=True)
            result.git_branch = repo.active_branch.name
            result.git_commit = repo.head.commit.hexsha
            remotes = repo.remotes
            if remotes:
                result.git_remote_url = remotes[0].url
            logger.debug(
                f"Git 信息: branch={result.git_branch} commit={result.git_commit[:8]}"
            )
        except ImportError:
            logger.warning("gitpython 未安装，跳过 Git 元数据读取")
        except Exception as e:
            logger.debug(f"读取 Git 信息失败（可能不是 Git 仓库）: {e}")
            result.errors.append(f"Git 读取失败: {e}")


if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO)
    target = sys.argv[1] if len(sys.argv) > 1 else "."
    scanner = RepoScanner()
    scan_result = scanner.scan(target)
    print(f"\n仓库: {scan_result.repo_name}")
    print(f"总文件: {scan_result.total_files}")
    print(f"总行数: {scan_result.total_lines:,}")
    print(f"主语言: {scan_result.primary_language()}")
    print(f"语言分布: {scan_result.language_stats}")
    if scan_result.git_branch:
        print(f"Git分支: {scan_result.git_branch} @ {scan_result.git_commit[:8] if scan_result.git_commit else 'N/A'}")
