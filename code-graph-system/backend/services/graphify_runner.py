"""GraphifyRunner — 管理 Claude Code CLI 子进程执行 /graphify skill。"""
from __future__ import annotations

import json
import logging
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

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

    # 执行阶段定义
    STAGES = [
        {"key": "detect", "label": "项目探测", "description": "读取 pom.xml/build.gradle，识别技术栈"},
        {"key": "analyze", "label": "AI 分析", "description": "执行 3 个并行 Agent 分析"},
        {"key": "merge", "label": "合并图谱", "description": "合并架构图/调用图/血缘图"},
        {"key": "validate", "label": "验证输出", "description": "验证 4 个 JSON 文件"},
    ]

    def __init__(
        self,
        claude_bin: str = "claude",
        timeout: int = 1800,
        graph_dir: str | Path | None = None,
        on_progress: Optional[Callable[[str, int, int, str], None]] = None,
    ) -> None:
        self.claude_bin = claude_bin
        self.timeout = timeout
        self._graph_dir = Path(graph_dir) if graph_dir else _GRAPH_DIR
        self._on_progress = on_progress

    def _report_progress(self, stage: str, step: int, total: int, message: str) -> None:
        """报告进度（调用回调或记录日志）。"""
        logger.info("[Graphify] %s (%d/%d): %s", stage, step, total, message)
        if self._on_progress:
            self._on_progress(stage, step, total, message)

    def _build_command(self, repo_path: str, repo_name: str = "") -> list[str]:
        """构建 Claude Code CLI 命令。"""
        prompt = f"/graphify {repo_path}"
        if repo_name:
            prompt += f" --name {repo_name}"
        return [self.claude_bin, "-p", prompt, "--output-format", "json"]

    def run(self, repo_path: str, repo_name: str = "") -> GraphifyResult:
        """执行 /graphify skill，返回结果。"""
        cmd = self._build_command(repo_path, repo_name)

        # Stage 1: 项目探测
        self._report_progress("detect", 1, 4, f"扫描仓库: {repo_path}")

        # Stage 2: 启动 AI 分析
        self._report_progress("analyze", 2, 4, f"启动 Claude Code CLI: {' '.join(cmd[:3])}...")
        logger.info("GraphifyRunner: %s", " ".join(cmd))

        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=self.timeout,
            )
        except FileNotFoundError:
            self._report_progress("failed", 0, 4, f"Claude Code CLI 未安装")
            return GraphifyResult(
                success=False,
                error=f"Claude Code CLI not found: {self.claude_bin}. Install from https://docs.anthropic.com/en/docs/claude-code",
            )
        except subprocess.TimeoutExpired:
            self._report_progress("failed", 0, 4, f"超时 ({self.timeout}s)")
            return GraphifyResult(
                success=False,
                error=f"Timeout after {self.timeout}s",
            )

        # Stage 3: 合并图谱
        self._report_progress("merge", 3, 4, "解析输出结果")

        if proc.returncode != 0:
            self._report_progress("failed", 0, 4, f"执行失败: {proc.stderr.strip()[:100]}")
            return GraphifyResult(
                success=False,
                error=proc.stderr.strip() or f"Exit code {proc.returncode}",
                output=proc.stdout,
            )

        try:
            data = json.loads(proc.stdout)
            files_written = data.get("files_written", 0)
            self._report_progress("merge", 3, 4, f"解析完成，写入 {files_written} 个文件")
        except json.JSONDecodeError:
            files_written = 0
            logger.warning("JSON 解析失败，输出非标准格式")

        return GraphifyResult(
            success=True,
            files_written=files_written,
            output=proc.stdout,
        )

    def validate_output(self, graph_dir: str | None = None, repo_name: str = "") -> ValidationResult:
        """验证 graphify 输出的 4 个 JSON 文件是否存在。"""
        self._report_progress("validate", 4, 4, f"验证输出文件: {repo_name}")

        base = Path(graph_dir) if graph_dir else self._graph_dir
        required = [
            f"{repo_name}.json",
            f"{repo_name}-architecture.json",
            f"{repo_name}-function-call-graph.json",
            f"{repo_name}-lineage.json",
        ]
        missing = [f for f in required if not (base / f).exists()]

        if len(missing) == 0:
            self._report_progress("completed", 4, 4, f"验证通过，共 4 个文件")
        else:
            self._report_progress("partial", 4, 4, f"缺失 {len(missing)} 个文件: {', '.join(missing)}")

        return ValidationResult(
            all_exist=len(missing) == 0,
            missing=missing,
        )
