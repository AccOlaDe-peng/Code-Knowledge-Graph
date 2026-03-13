"""
Agent tools for autonomous repository exploration.
"""

from pathlib import Path
from typing import Any, Optional


class AgentTools:
    """Tools available to AIGraphAgent for exploring repositories."""

    MAX_FILE_LINES = 200

    def __init__(self, repo_path: str, static_graph: Any):
        """
        Initialize agent tools.

        Args:
            repo_path: Absolute path to repository root
            static_graph: Snapshot of static analysis graph (for get_ast_nodes, get_call_graph)
        """
        self.repo_path = Path(repo_path)
        self.static_graph = static_graph

    def read_file(
        self,
        path: str,
        start_line: int = 1,
        end_line: Optional[int] = None,
    ) -> dict[str, Any]:
        """
        Read source code from a file.

        Args:
            path: File path (absolute or relative to repo_path)
            start_line: Starting line number (1-indexed)
            end_line: Ending line number (inclusive), None = read to end

        Returns:
            {
                "success": bool,
                "content": str,
                "lines": int,
                "truncated": bool,
                "error": str (if success=False)
            }
        """
        try:
            file_path = Path(path)
            if not file_path.is_absolute():
                file_path = self.repo_path / file_path

            if not file_path.exists():
                return {
                    "success": False,
                    "error": f"File not found: {path}",
                }

            with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                all_lines = f.readlines()

            # Apply line range
            start_idx = max(0, start_line - 1)
            if end_line is None:
                end_idx = len(all_lines)
            else:
                end_idx = min(len(all_lines), end_line)

            selected_lines = all_lines[start_idx:end_idx]

            # Truncate if exceeds MAX_FILE_LINES
            truncated = False
            if len(selected_lines) > self.MAX_FILE_LINES:
                selected_lines = selected_lines[:self.MAX_FILE_LINES]
                truncated = True

            content = "".join(selected_lines)

            return {
                "success": True,
                "content": content,
                "lines": len(selected_lines),
                "truncated": truncated,
            }

        except Exception as e:
            return {
                "success": False,
                "error": str(e),
            }
