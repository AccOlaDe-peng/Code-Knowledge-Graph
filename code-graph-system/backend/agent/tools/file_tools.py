"""文件读取和搜索工具。"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any


class FileTools:
    """文件操作工具集。"""

    def __init__(self, repo_path: str):
        self.repo_path = Path(repo_path)

    def read_file(self, path: str, start_line: int = 0, end_line: int = None) -> dict[str, Any]:
        """读取文件内容。

        Args:
            path: 相对于仓库的文件路径
            start_line: 起始行号（0-indexed）
            end_line: 结束行号（不包含）

        Returns:
            {"success": bool, "content": str, "line_count": int, "error": str}
        """
        try:
            file_path = self.repo_path / path
            if not file_path.exists():
                return {"success": False, "error": f"文件不存在: {path}"}

            lines = file_path.read_text(encoding="utf-8").splitlines()
            total_lines = len(lines)

            if end_line is None:
                end_line = total_lines

            selected = lines[start_line:end_line]
            return {
                "success": True,
                "content": "\n".join(selected),
                "line_count": len(selected),
                "total_lines": total_lines,
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    def search_code(self, pattern: str, file_pattern: str = "*.py") -> dict[str, Any]:
        """搜索代码模式。

        Args:
            pattern: 搜索模式
            file_pattern: 文件通配符

        Returns:
            {"success": bool, "matches": list, "error": str}
        """
        try:
            matches = []
            for file_path in self.repo_path.rglob(file_pattern):
                if file_path.is_file():
                    try:
                        lines = file_path.read_text(encoding="utf-8").splitlines()
                        for i, line in enumerate(lines):
                            if pattern in line:
                                matches.append({
                                    "file": str(file_path.relative_to(self.repo_path)),
                                    "line": i + 1,
                                    "content": line.strip(),
                                })
                    except:
                        continue

            return {"success": True, "matches": matches, "count": len(matches)}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def list_directory(self, path: str = "", max_depth: int = 2) -> dict[str, Any]:
        """列出目录结构。

        Args:
            path: 相对路径
            max_depth: 最大深度

        Returns:
            {"success": bool, "entries": list, "error": str}
        """
        try:
            dir_path = self.repo_path / path if path else self.repo_path
            entries = []

            for root, dirs, files in os.walk(dir_path):
                rel_root = Path(root).relative_to(self.repo_path)
                depth = len(rel_root.parts) if str(rel_root) != "." else 0

                if depth > max_depth:
                    dirs.clear()
                    continue

                for f in files:
                    entries.append({
                        "path": str(rel_root / f),
                        "type": "file",
                        "depth": depth,
                    })

                for d in dirs:
                    entries.append({
                        "path": str(rel_root / d),
                        "type": "directory",
                        "depth": depth,
                    })

            return {"success": True, "entries": entries, "count": len(entries)}
        except Exception as e:
            return {"success": False, "error": str(e)}