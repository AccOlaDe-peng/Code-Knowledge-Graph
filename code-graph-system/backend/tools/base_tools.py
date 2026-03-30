"""基础探索工具实现。"""

from __future__ import annotations

import fnmatch
import logging
import os
import re
from pathlib import Path
from typing import Any, Generator

logger = logging.getLogger(__name__)


class BaseTools:
    """基础探索工具实现。"""

    # 输出限制配置常量
    MAX_FILE_LINES: int = 500
    MAX_SEARCH_RESULTS: int = 100
    MAX_LINE_LENGTH: int = 500

    def __init__(self, repo_path: Path | str):
        self.repo_path = Path(repo_path)

    # ═══════════════════════════════════════════════════════════════
    # list_directory
    # ═══════════════════════════════════════════════════════════════

    def list_directory(
        self,
        path: str = ".",
        recursive: bool = False,
        file_pattern: str = "*",
    ) -> dict:
        """列出目录内容。"""
        target_path = self.repo_path / path

        if not target_path.exists():
            return {"success": False, "error": f"Directory not found: {path}"}

        if not target_path.is_dir():
            return {"success": False, "error": f"Path is not a directory: {path}"}

        items = []

        if recursive:
            for root, dirs, files in os.walk(target_path):
                for f in files:
                    if fnmatch.fnmatch(f, file_pattern):
                        full_path = Path(root) / f
                        rel_path = full_path.relative_to(self.repo_path)
                        items.append({
                            "name": f,
                            "path": str(rel_path),
                            "type": "file",
                            "size": full_path.stat().st_size,
                        })
                for d in dirs:
                    full_path = Path(root) / d
                    rel_path = full_path.relative_to(self.repo_path)
                    items.append({
                        "name": d,
                        "path": str(rel_path),
                        "type": "directory",
                    })
        else:
            for item in target_path.iterdir():
                if item.is_file() and not fnmatch.fnmatch(item.name, file_pattern):
                    continue
                rel_path = item.relative_to(self.repo_path)
                items.append({
                    "name": item.name,
                    "path": str(rel_path),
                    "type": "file" if item.is_file() else "directory",
                    "size": item.stat().st_size if item.is_file() else None,
                })

        return {"success": True, "entries": items, "count": len(items)}

    # ═══════════════════════════════════════════════════════════════
    # search_code
    # ═══════════════════════════════════════════════════════════════

    def search_code(
        self,
        pattern: str,
        file_pattern: str = "*.java",
        context_lines: int = 2,
        max_results: int = None,
    ) -> dict:
        """在代码中搜索模式。"""
        max_results = max_results or self.MAX_SEARCH_RESULTS
        results = []

        try:
            regex = re.compile(pattern)
        except re.error:
            # 不是有效正则，使用字符串搜索
            regex = None

        for file_path in self._iter_files(file_pattern):
            try:
                content = file_path.read_text(encoding="utf-8", errors="replace")
                lines = content.split("\n")

                for i, line in enumerate(lines):
                    matched = False
                    match_groups = []

                    if regex:
                        match = regex.search(line)
                        if match:
                            matched = True
                            match_groups = list(match.groups()) if match.groups() else []
                    elif pattern in line:
                        matched = True

                    if matched:
                        rel_path = str(file_path.relative_to(self.repo_path))

                        context_before = lines[max(0, i - context_lines):i]
                        context_after = lines[i + 1:min(len(lines), i + 1 + context_lines)]

                        results.append({
                            "file_path": rel_path,
                            "line_number": i + 1,
                            "line_content": line.strip(),
                            "context_before": context_before,
                            "context_after": context_after,
                            "match_groups": match_groups,
                        })

                        if len(results) >= max_results:
                            break
            except Exception:
                continue

            if len(results) >= max_results:
                break

        return {
            "success": True,
            "results": results,
            "count": len(results),
            "pattern": pattern,
        }

    # ═══════════════════════════════════════════════════════════════
    # read_file / read_lines
    # ═══════════════════════════════════════════════════════════════

    def read_file(
        self,
        path: str,
        max_size: int = 512 * 1024,
        start_line: int = None,
        end_line: int = None,
    ) -> dict:
        """读取文件内容。"""
        file_path = self.repo_path / path

        if not file_path.exists():
            return {"success": False, "error": f"File not found: {path}"}

        file_size = file_path.stat().st_size
        if file_size > max_size:
            return {
                "success": False,
                "error": f"File too large ({file_size // 1024}KB > {max_size // 1024}KB), use read_lines instead",
            }

        try:
            content = file_path.read_text(encoding="utf-8", errors="replace")
            lines = content.split("\n")

            # 支持行范围
            if start_line is not None or end_line is not None:
                start_idx = max(0, (start_line or 1) - 1)
                end_idx = min(len(lines), end_line or len(lines))
                lines = lines[start_idx:end_idx]
                content = "\n".join(lines)

            return {
                "success": True,
                "content": content,
                "line_count": len(lines),
                "size_bytes": len(content.encode("utf-8")),
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    def read_lines(
        self,
        path: str,
        start_line: int,
        end_line: int,
    ) -> dict:
        """读取指定行范围。"""
        file_path = self.repo_path / path

        if not file_path.exists():
            return {"success": False, "error": f"File not found: {path}"}

        try:
            content = file_path.read_text(encoding="utf-8", errors="replace")
            lines = content.split("\n")

            # 转换为 0-based 索引
            start_idx = max(0, start_line - 1)
            end_idx = min(len(lines), end_line)

            selected_lines = lines[start_idx:end_idx]

            # 带行号的格式
            result = []
            for i, line in enumerate(selected_lines, start=start_line):
                result.append(f"{i:4d} | {line}")

            return {
                "success": True,
                "content": "\n".join(result),
                "start_line": start_line,
                "end_line": end_line,
                "line_count": len(selected_lines),
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ═══════════════════════════════════════════════════════════════
    # find_files
    # ═══════════════════════════════════════════════════════════════

    def find_files(
        self,
        pattern: str,
        path: str = ".",
    ) -> dict:
        """查找文件。"""
        search_path = self.repo_path / path
        results = []

        for file_path in search_path.rglob("*"):
            if file_path.is_file() and fnmatch.fnmatch(file_path.name, pattern):
                rel_path = file_path.relative_to(self.repo_path)
                results.append(str(rel_path))

        return {
            "success": True,
            "files": results,
            "count": len(results),
        }

    # ═══════════════════════════════════════════════════════════════
    # grep_pattern
    # ═══════════════════════════════════════════════════════════════

    def grep_pattern(
        self,
        path: str,
        pattern: str,
        extract_groups: bool = True,
    ) -> dict:
        """在单个文件中使用正则表达式。"""
        file_path = self.repo_path / path

        if not file_path.exists():
            return {"success": False, "error": f"File not found: {path}"}

        try:
            content = file_path.read_text(encoding="utf-8", errors="replace")
            regex = re.compile(pattern, re.MULTILINE)

            results = []
            for match in regex.finditer(content):
                if extract_groups and match.groups():
                    results.append({
                        "match": match.group(0),
                        "groups": list(match.groups()),
                        "start": match.start(),
                        "end": match.end(),
                    })
                else:
                    results.append({
                        "match": match.group(0),
                        "start": match.start(),
                        "end": match.end(),
                    })

            return {
                "success": True,
                "results": results,
                "count": len(results),
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ═══════════════════════════════════════════════════════════════
    # get_file_info
    # ═══════════════════════════════════════════════════════════════

    def get_file_info(self, path: str) -> dict:
        """获取文件元信息。"""
        file_path = self.repo_path / path

        if not file_path.exists():
            return {"success": False, "error": f"File not found: {path}"}

        try:
            stat = file_path.stat()
            content = file_path.read_text(encoding="utf-8", errors="replace")
            lines = content.split("\n")

            # 检测语言
            language = self._detect_language(file_path.name)

            return {
                "success": True,
                "path": path,
                "size_bytes": stat.st_size,
                "line_count": len(lines),
                "language": language,
                "modified_time": stat.st_mtime,
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _detect_language(self, filename: str) -> str:
        """检测文件语言。"""
        ext_map = {
            ".java": "Java",
            ".py": "Python",
            ".ts": "TypeScript",
            ".tsx": "TypeScript",
            ".js": "JavaScript",
            ".jsx": "JavaScript",
            ".go": "Go",
            ".rs": "Rust",
            ".kt": "Kotlin",
            ".scala": "Scala",
            ".xml": "XML",
            ".json": "JSON",
            ".yaml": "YAML",
            ".yml": "YAML",
            ".md": "Markdown",
            ".sql": "SQL",
        }
        ext = Path(filename).suffix.lower()
        return ext_map.get(ext, "Unknown")

    # ═══════════════════════════════════════════════════════════════
    # list_imports
    # ═══════════════════════════════════════════════════════════════

    def list_imports(self, path: str) -> dict:
        """列出文件的 import 语句。"""
        file_path = self.repo_path / path

        if not file_path.exists():
            return {"success": False, "error": f"File not found: {path}"}

        try:
            content = file_path.read_text(encoding="utf-8", errors="replace")

            imports = []

            if path.endswith(".java"):
                # Java import 正则
                pattern = r'import\s+(?:static\s+)?([^;]+);'
                for match in re.finditer(pattern, content, re.MULTILINE):
                    imports.append({
                        "type": "java",
                        "module": match.group(1).strip(),
                        "is_static": "static" in match.group(0),
                    })
            elif path.endswith(".py"):
                # Python import 正则
                pattern = r'^(?:from\s+(\S+)\s+)?import\s+(.+)$'
                for match in re.finditer(pattern, content, re.MULTILINE):
                    imports.append({
                        "type": "python",
                        "module": match.group(1) or match.group(2).strip(),
                        "names": match.group(2).split(",") if match.group(1) else None,
                    })

            return {
                "success": True,
                "imports": imports,
                "count": len(imports),
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ═══════════════════════════════════════════════════════════════
    # 辅助方法
    # ═══════════════════════════════════════════════════════════════

    def _iter_files(self, pattern: str) -> Generator[Path, None, None]:
        """迭代匹配的文件。"""
        for file_path in self.repo_path.rglob("*"):
            if file_path.is_file() and fnmatch.fnmatch(file_path.name, pattern):
                yield file_path
