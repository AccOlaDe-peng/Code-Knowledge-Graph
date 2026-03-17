"""文件读取和搜索工具。"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any


class FileTools:
    """文件操作工具集。"""

    # 输出限制配置常量
    MAX_FILE_LINES: int = 500  # 单次读取最大行数
    MAX_SEARCH_RESULTS: int = 50  # 搜索结果最大数量
    MAX_LINE_LENGTH: int = 500  # 单行最大长度

    def __init__(self, repo_path: str):
        self.repo_path = Path(repo_path)

    def read_file(self, path: str, start_line: int = 0, end_line: int = None) -> dict[str, Any]:
        """读取文件内容。

        Args:
            path: 相对于仓库的文件路径
            start_line: 起始行号（0-indexed）
            end_line: 结束行号（不包含）

        Returns:
            {
                "success": bool,
                "content": str,
                "line_count": int,      # 实际返回的行数
                "total_lines": int,     # 文件原始总行数
                "truncated": bool,      # 是否被截断
                "error": str            # 错误信息（如果有）
            }
        """
        try:
            file_path = self.repo_path / path
            if not file_path.exists():
                return {"success": False, "error": f"文件不存在: {path}"}

            lines = file_path.read_text(encoding="utf-8").splitlines()
            total_lines = len(lines)

            if end_line is None:
                end_line = total_lines

            # 限制读取行数
            requested_lines = end_line - start_line
            if requested_lines > self.MAX_FILE_LINES:
                end_line = start_line + self.MAX_FILE_LINES

            selected = lines[start_line:end_line]

            # 截断超长行
            truncated_lines = []
            for line in selected:
                if len(line) > self.MAX_LINE_LENGTH:
                    truncated_lines.append(line[: self.MAX_LINE_LENGTH - 3] + "...")
                else:
                    truncated_lines.append(line)

            # 判断是否被截断
            truncated = (end_line < total_lines) or any(
                len(line) > self.MAX_LINE_LENGTH for line in selected
            )

            return {
                "success": True,
                "content": "\n".join(truncated_lines),
                "line_count": len(truncated_lines),
                "total_lines": total_lines,
                "truncated": truncated,
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    def search_code(self, pattern: str, file_pattern: str = "*.py") -> dict[str, Any]:
        """搜索代码模式。

        Args:
            pattern: 搜索模式
            file_pattern: 文件通配符

        Returns:
            {
                "success": bool,
                "matches": list,        # 匹配结果列表
                "count": int,           # 实际返回的匹配数
                "total_count": int,     # 原始匹配总数
                "truncated": bool,      # 是否被截断
                "error": str            # 错误信息（如果有）
            }
        """
        try:
            matches = []
            for file_path in self.repo_path.rglob(file_pattern):
                if file_path.is_file():
                    try:
                        lines = file_path.read_text(encoding="utf-8").splitlines()
                        for i, line in enumerate(lines):
                            if pattern in line:
                                # 截断超长行
                                content = line.strip()
                                if len(content) > self.MAX_LINE_LENGTH:
                                    content = content[: self.MAX_LINE_LENGTH - 3] + "..."

                                matches.append({
                                    "file": str(file_path.relative_to(self.repo_path)),
                                    "line": i + 1,
                                    "content": content,
                                })
                    except:
                        continue

            total_count = len(matches)
            truncated = total_count > self.MAX_SEARCH_RESULTS

            # 限制返回结果数量
            if truncated:
                matches = matches[: self.MAX_SEARCH_RESULTS]

            return {
                "success": True,
                "matches": matches,
                "count": len(matches),
                "total_count": total_count,
                "truncated": truncated,
            }
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