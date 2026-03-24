"""
代码片段服务。

从源代码文件中提取代码片段。
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Optional
from pydantic import BaseModel


class CodeSnippet(BaseModel):
    """代码片段模型。"""
    language: str
    content: str
    start_line: int
    end_line: int
    highlight_lines: list[int] = []


class CodeSnippetService:
    """代码片段提取服务。"""

    # 语言映射（文件扩展名 -> 语言名）
    LANGUAGE_MAP = {
        ".java": "java",
        ".kt": "kotlin",
        ".py": "python",
        ".ts": "typescript",
        ".tsx": "typescript",
        ".js": "javascript",
        ".jsx": "javascript",
        ".go": "go",
        ".rs": "rust",
        ".cpp": "cpp",
        ".c": "c",
        ".h": "c",
        ".hpp": "cpp",
        ".cs": "csharp",
        ".rb": "ruby",
        ".php": "php",
        ".swift": "swift",
        ".scala": "scala",
    }

    def __init__(self, repo_base_path: Optional[str] = None):
        """
        初始化服务。

        Args:
            repo_base_path: 仓库基础路径，用于解析相对路径
        """
        self.repo_base_path = repo_base_path

    def set_repo_base_path(self, path: str) -> None:
        """设置仓库基础路径。"""
        self.repo_base_path = path

    def extract_snippet(
        self,
        file_path: str,
        start_line: int,
        end_line: Optional[int] = None,
        context_lines: int = 5,
        max_lines: int = 30,
    ) -> Optional[CodeSnippet]:
        """
        从文件中提取代码片段。

        Args:
            file_path: 文件路径（相对或绝对）
            start_line: 起始行号（1-indexed）
            end_line: 结束行号（可选）
            context_lines: 上下文行数
            max_lines: 最大行数

        Returns:
            CodeSnippet 或 None
        """
        # 解析文件路径
        full_path = self._resolve_path(file_path)
        if not full_path or not full_path.exists():
            return None

        try:
            with open(full_path, "r", encoding="utf-8", errors="ignore") as f:
                lines = f.readlines()
        except Exception:
            return None

        if not lines:
            return None

        # 计算实际行号范围
        total_lines = len(lines)
        actual_start = max(1, start_line - context_lines)
        actual_end = min(
            total_lines,
            (end_line or start_line) + context_lines
        )

        # 限制最大行数
        if actual_end - actual_start + 1 > max_lines:
            # 优先保留 start_line 附近的内容
            actual_start = max(1, start_line - max_lines // 3)
            actual_end = min(total_lines, actual_start + max_lines - 1)

        # 提取代码
        snippet_lines = lines[actual_start - 1 : actual_end]
        content = "".join(snippet_lines)

        # 识别语言
        language = self._get_language(full_path)

        # 识别高亮行
        highlight_lines = self._identify_highlight_lines(
            snippet_lines, start_line - actual_start + 1
        )

        return CodeSnippet(
            language=language,
            content=content,
            start_line=actual_start,
            end_line=actual_end,
            highlight_lines=highlight_lines,
        )

    def extract_method_snippet(
        self,
        file_path: str,
        method_name: str,
        start_line: int,
        max_lines: int = 25,
    ) -> Optional[CodeSnippet]:
        """
        提取方法级代码片段。

        尝试找到完整的方法定义。
        """
        full_path = self._resolve_path(file_path)
        if not full_path or not full_path.exists():
            return None

        try:
            with open(full_path, "r", encoding="utf-8", errors="ignore") as f:
                lines = f.readlines()
        except Exception:
            return None

        if not lines or start_line > len(lines):
            return None

        # 从 start_line 开始查找方法结束
        brace_count = 0
        found_open = False
        end_line = start_line

        for i in range(start_line - 1, min(len(lines), start_line + max_lines * 3)):
            line = lines[i]
            brace_count += line.count("{") - line.count("}")
            if "{" in line:
                found_open = True
            if found_open and brace_count == 0:
                end_line = i + 1
                break

        # 限制行数
        if end_line - start_line + 1 > max_lines:
            end_line = start_line + max_lines - 1

        return self.extract_snippet(
            file_path, start_line, end_line, context_lines=2, max_lines=max_lines
        )

    def _resolve_path(self, file_path: str) -> Optional[Path]:
        """解析文件路径。"""
        path = Path(file_path)

        # 如果是绝对路径且存在
        if path.is_absolute() and path.exists():
            return path

        # 如果有仓库基础路径，尝试拼接
        if self.repo_base_path:
            full_path = Path(self.repo_base_path) / file_path
            if full_path.exists():
                return full_path

        return None

    def _get_language(self, file_path: Path) -> str:
        """根据文件扩展名识别语言。"""
        ext = file_path.suffix.lower()
        return self.LANGUAGE_MAP.get(ext, "text")

    def _identify_highlight_lines(
        self, lines: list[str], method_line_offset: int
    ) -> list[int]:
        """
        识别需要高亮的行。

        包括：方法签名行、return 语句、注解行等。
        """
        highlight_lines = []

        for i, line in enumerate(lines):
            stripped = line.strip()

            # 方法签名行（通常是第一行或包含 public/private/def 等）
            if i == method_line_offset - 1:
                highlight_lines.append(i + 1)
                continue

            # return 语句
            if stripped.startswith("return ") or stripped == "return":
                highlight_lines.append(i + 1)
                continue

            # 注解行
            if stripped.startswith("@") and not stripped.startswith("@Override"):
                highlight_lines.append(i + 1)
                continue

        return highlight_lines


# 全局服务实例
_service: Optional[CodeSnippetService] = None


def get_code_snippet_service() -> CodeSnippetService:
    """获取代码片段服务单例。"""
    global _service
    if _service is None:
        _service = CodeSnippetService()
    return _service
