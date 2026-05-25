"""GraphifyRunner — 管理 Claude Code CLI 子进程执行 /graphify skill。"""
from __future__ import annotations

import json
import logging
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger(__name__)

_GRAPH_DIR = Path(__file__).parent.parent.parent / "data" / "graphs"


@dataclass
class GraphifyResult:
    """GraphifyRunner.run() 的输出。"""
    success: bool
    files_written: int = 0
    error: str = ""
    output: str = ""
    missing: list[str] = field(default_factory=list)


@dataclass
class ValidationResult:
    """validate_output() 的输出。"""
    all_exist: bool
    missing: list[str]


class GraphifyRunner:
    """管理 Claude Code CLI 子进程，执行 /graphify skill 分析代码仓库。"""

    def __init__(
        self,
        claude_bin: str = "claude",
        timeout: int = 1800,
        graph_dir: str | Path | None = None,
    ) -> None:
        self.claude_bin = claude_bin
        self.timeout = timeout
        self._graph_dir = Path(graph_dir) if graph_dir else _GRAPH_DIR

    def _build_command(self, repo_path: str, repo_name: str = "") -> list[str]:
        """构建 Claude Code CLI 命令。"""
        prompt = f"/graphify {repo_path}"
        if repo_name:
            prompt += f" --name {repo_name}"
        return [self.claude_bin, "-p", prompt, "--output-format", "json"]

    def run(self, repo_path: str, repo_name: str = "") -> GraphifyResult:
        """执行 /graphify skill，返回结果。"""
        cmd = self._build_command(repo_path, repo_name)
        logger.info("GraphifyRunner: %s", " ".join(cmd))

        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=self.timeout,
            )
        except FileNotFoundError:
            return GraphifyResult(
                success=False,
                error=f"Claude Code CLI not found: {self.claude_bin}. Install from https://docs.anthropic.com/en/docs/claude-code",
            )
        except subprocess.TimeoutExpired:
            return GraphifyResult(
                success=False,
                error=f"Timeout after {self.timeout}s",
            )

        if proc.returncode != 0:
            return GraphifyResult(
                success=False,
                error=proc.stderr.strip() or f"Exit code {proc.returncode}",
                output=proc.stdout,
            )

        try:
            data = json.loads(proc.stdout)
            files_written = data.get("files_written", 0)
        except json.JSONDecodeError:
            files_written = 0

        return GraphifyResult(
            success=True,
            files_written=files_written,
            output=proc.stdout,
        )

    def validate_output(self, graph_dir: str | None = None, repo_name: str = "") -> ValidationResult:
        """验证 graphify 输出的 4 个 JSON 文件是否存在。"""
        base = Path(graph_dir) if graph_dir else self._graph_dir
        required = [
            f"{repo_name}.json",
            f"{repo_name}-architecture.json",
            f"{repo_name}-function-call-graph.json",
            f"{repo_name}-lineage.json",
        ]
        missing = [f for f in required if not (base / f).exists()]
        return ValidationResult(
            all_exist=len(missing) == 0,
            missing=missing,
        )
