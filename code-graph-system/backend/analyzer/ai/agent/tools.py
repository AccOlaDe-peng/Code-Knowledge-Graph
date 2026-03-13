"""
Agent tools for autonomous repository exploration.
"""

import re
from pathlib import Path
from typing import Any, Optional


class AgentTools:
    """Tools available to AIGraphAgent for exploring repositories."""

    MAX_FILE_LINES = 200
    MAX_SEARCH_RESULTS = 50

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

            # Security check: ensure file is within repo_path
            try:
                file_path = file_path.resolve()
                file_path.relative_to(self.repo_path.resolve())
            except ValueError:
                return {
                    "success": False,
                    "error": f"Path outside repository: {path}",
                }

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

    def list_directory(self, path: str) -> dict[str, Any]:
        """
        List files and subdirectories in a directory (non-recursive).

        Args:
            path: Directory path (absolute or relative to repo_path)

        Returns:
            {
                "success": bool,
                "entries": [{"name": str, "type": "file"|"dir", "size": int}],
                "error": str (if success=False)
            }
        """
        try:
            dir_path = Path(path)
            if not dir_path.is_absolute():
                dir_path = self.repo_path / dir_path

            # Security check: ensure directory is within repo_path
            try:
                dir_path = dir_path.resolve()
                dir_path.relative_to(self.repo_path.resolve())
            except ValueError:
                return {
                    "success": False,
                    "error": f"Path outside repository: {path}",
                }

            if not dir_path.exists():
                return {
                    "success": False,
                    "error": f"Directory not found: {path}",
                }

            if not dir_path.is_dir():
                return {
                    "success": False,
                    "error": f"Not a directory: {path}",
                }

            entries = []
            for item in sorted(dir_path.iterdir()):
                entry = {
                    "name": item.name,
                    "type": "dir" if item.is_dir() else "file",
                }
                if item.is_file():
                    entry["size"] = item.stat().st_size
                entries.append(entry)

            return {
                "success": True,
                "entries": entries,
            }

        except Exception as e:
            return {
                "success": False,
                "error": str(e),
            }

    def search_code(
        self,
        pattern: str,
        file_glob: str = "**/*",
    ) -> dict[str, Any]:
        """
        Search for pattern in repository files.

        Args:
            pattern: Search pattern (regex)
            file_glob: File glob pattern (default: all files)

        Returns:
            {
                "success": bool,
                "matches": [{"file": str, "line": int, "content": str}],
                "truncated": bool,
                "error": str (if success=False)
            }
        """
        try:
            regex = re.compile(pattern, re.IGNORECASE)
            matches = []

            # Simple recursive search (not using ripgrep for simplicity)
            for file_path in self.repo_path.glob(file_glob):
                if not file_path.is_file():
                    continue

                # Security check: ensure file is within repo_path
                try:
                    file_path.resolve().relative_to(self.repo_path.resolve())
                except ValueError:
                    continue  # Skip files outside repo

                # Skip binary files and common ignore patterns
                if file_path.suffix in {".pyc", ".so", ".dll", ".exe"}:
                    continue
                if any(part.startswith(".") for part in file_path.parts):
                    continue

                try:
                    with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                        for line_num, line in enumerate(f, start=1):
                            if regex.search(line):
                                rel_path = file_path.relative_to(self.repo_path)
                                matches.append({
                                    "file": str(rel_path),
                                    "line": line_num,
                                    "content": line.rstrip(),
                                })

                                if len(matches) >= self.MAX_SEARCH_RESULTS:
                                    return {
                                        "success": True,
                                        "matches": matches,
                                        "truncated": True,
                                    }
                except (UnicodeDecodeError, PermissionError):
                    continue

            return {
                "success": True,
                "matches": matches,
                "truncated": False,
            }

        except Exception as e:
            return {
                "success": False,
                "error": str(e),
            }

    def get_ast_nodes(self, path: str) -> dict[str, Any]:
        """
        Get AST nodes (classes, functions) from static analysis for a file.

        Args:
            path: File path (relative to repo_path)

        Returns:
            {
                "success": bool,
                "nodes": [{"id": str, "type": str, "name": str, "line": int}],
                "error": str (if success=False)
            }
        """
        try:
            if self.static_graph is None:
                return {
                    "success": False,
                    "error": "Static graph not available",
                }

            # Normalize path
            norm_path = str(Path(path)).replace("\\", "/")

            # Filter nodes by file
            matching_nodes = []
            for node in self.static_graph.nodes:
                node_file = node.properties.get("file", "")
                if node_file:
                    norm_node_file = str(Path(node_file)).replace("\\", "/")
                    # Match if exact match or ends with the path (e.g., "file.py" matches "src/file.py")
                    if norm_node_file == norm_path or norm_node_file.endswith("/" + norm_path):
                        matching_nodes.append({
                            "id": node.id,
                            "type": str(node.type),  # Convert enum to string
                            "name": node.name,
                            "line": node.properties.get("line", 0),
                        })

            return {
                "success": True,
                "nodes": matching_nodes,
            }

        except Exception as e:
            return {
                "success": False,
                "error": str(e),
            }
