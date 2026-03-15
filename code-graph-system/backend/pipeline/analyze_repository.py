"""
代码仓库分析流水线（向后兼容层）。

此模块提供向后兼容的 AnalysisPipeline 类，内部委托给新的 AIPipeline。
静态分析步骤已被移除，所有分析现由 AI Agent 系统驱动。

迁移指南:
    旧代码（已弃用）:
        from backend.pipeline.analyze_repository import AnalysisPipeline
        pipeline = AnalysisPipeline()
        result = pipeline.analyze("/path/to/repo", enable_ai=True)

    新代码（推荐）:
        from backend.pipeline import AIPipeline
        pipeline = AIPipeline()
        result = pipeline.analyze("/path/to/repo")

注意:
    - AnalysisResult 类保留用于向后兼容
    - enable_ai 参数现在被忽略（AI 分析始终启用）
    - languages 参数现在被忽略（由 AI 自动检测）
"""

from __future__ import annotations

import dataclasses
import logging
import time
import warnings
from pathlib import Path
from typing import Any, Callable, Optional

from backend.graph.graph_builder import BuiltGraph, GraphBuilder
from backend.graph.graph_repository import GraphRepository
from backend.graph.graph_schema import GraphNode, GraphEdge
from backend.pipeline.ai_analyze import AIPipeline
from backend.models.ai_analysis import AIAnalysisResult
from backend.rag.graph_rag_engine import GraphRAGEngine
from backend.rag.vector_store import VectorStore
from backend.scanner.repo_scanner import RepoScanner

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Output container (backward compatible)
# ---------------------------------------------------------------------------


@dataclasses.dataclass
class AnalysisResult:
    """AnalysisPipeline.analyze() 的完整输出（向后兼容）。

    注意：此类的许多字段现在由 AIPipeline 填充。
    某些字段可能为空或使用默认值以保持向后兼容。

    Attributes:
        graph_id:         GraphRepository 中的图谱 ID。
        built:            完整图谱，含节点 / 边。
        repo_path:        仓库绝对路径。
        repo_name:        仓库/图谱名称。
        step_stats:       每步骤的统计信息（简化版）。
        circular_deps:    循环依赖链列表（AI 分析不检测此信息）。
        duration_seconds: 总分析耗时。
        warnings:         非致命警告列表。
    """

    graph_id:         str
    built:            BuiltGraph
    repo_path:        str
    repo_name:        str
    step_stats:       dict[str, dict[str, Any]]
    circular_deps:    list[list[str]]
    duration_seconds: float
    warnings:         list[str]

    @property
    def node_count(self) -> int:
        return self.built.node_count

    @property
    def edge_count(self) -> int:
        return self.built.edge_count

    def summary(self) -> str:
        """返回人类可读的分析摘要字符串。"""
        lines = [
            f"仓库:     {self.repo_name}  ({self.repo_path})",
            f"图谱 ID:  {self.graph_id}",
            f"节点数:   {self.node_count}",
            f"边数:     {self.edge_count}",
            f"耗时:     {self.duration_seconds:.2f}s",
        ]
        node_types = self.built.meta.get("node_type_counts", {})
        if node_types:
            lines.append("节点类型: " + "  ".join(
                f"{t}:{n}" for t, n in sorted(node_types.items())
            ))
        if self.circular_deps:
            lines.append(f"循环依赖: {len(self.circular_deps)} 个")
        if self.warnings:
            lines.append(f"警告 ({len(self.warnings)}):")
            for w in self.warnings:
                lines.append(f"  - {w}")
        return "\n".join(lines)


# ---------------------------------------------------------------------------
# Pipeline (backward compatible wrapper)
# ---------------------------------------------------------------------------


class AnalysisPipeline:
    """
    代码仓库分析流水线（向后兼容层）。

    此类委托给新的 AIPipeline，保持与旧 API 的兼容性。

    .. deprecated::
        请使用 backend.pipeline.AIPipeline 代替。
        此类将在未来版本中移除。

    示例::

        # 旧代码（已弃用但仍然有效）
        pipeline = AnalysisPipeline()
        result = pipeline.analyze("/path/to/repo", enable_ai=True)
        print(result.summary())

        # 新代码（推荐）
        from backend.pipeline import AIPipeline
        pipeline = AIPipeline()
        result = pipeline.analyze("/path/to/repo")
    """

    def __init__(
        self,
        graph_repo: Optional[GraphRepository] = None,
        vector_store: Optional[VectorStore] = None,
        rag_engine: Optional[GraphRAGEngine] = None,
    ) -> None:
        """
        Args:
            graph_repo:   图谱持久化仓库（默认 ``./data/graphs``）。
            vector_store: ChromaDB 向量存储（默认 ``./data/chroma``）。
            rag_engine:   预构建的 GraphRAGEngine。
        """
        self._repo = graph_repo or GraphRepository()
        self._vector_store = vector_store
        self._rag_engine = rag_engine
        self._ai_pipeline = AIPipeline(
            graph_repo=graph_repo,
            vector_store=vector_store,
            rag_engine=rag_engine,
        )

    # ------------------------------------------------------------------
    # Public
    # ------------------------------------------------------------------

    def analyze(
        self,
        repo_path: str | Path,
        *,
        repo_name: str = "",
        languages: Optional[list[str]] = None,
        enable_ai: bool = False,  # Ignored - AI is always used
        enable_rag: bool = False,
        on_progress: Optional[Callable[[dict], None]] = None,
    ) -> AnalysisResult:
        """执行分析流水线，返回 AnalysisResult。

        Args:
            repo_path:  仓库根目录（本地路径）。
            repo_name:  图谱名称前缀；空字符串时使用目录名。
            languages:  限定分析语言（已忽略，由 AI 自动检测）。
            enable_ai:  启用 AI 分析（已忽略，始终使用 AI）。
            enable_rag: 启用 GraphRAGEngine 向量化。
            on_progress: 进度回调函数。

        Returns:
            AnalysisResult。

        Raises:
            ValueError: 仓库路径不存在。
        """
        # Emit deprecation warning
        warnings.warn(
            "AnalysisPipeline is deprecated. Use backend.pipeline.AIPipeline instead.",
            DeprecationWarning,
            stacklevel=2,
        )

        if languages is not None:
            logger.warning(
                "languages 参数已被忽略，AI 分析会自动检测语言"
            )

        if not enable_ai:
            logger.info(
                "enable_ai=False 被忽略，新的流水线始终使用 AI 分析"
            )

        # Run AI pipeline
        ai_result = self._ai_pipeline.analyze(
            repo_path,
            repo_name=repo_name,
            enable_rag=enable_rag,
            on_progress=self._convert_progress_callback(on_progress),
        )

        # Convert AIAnalysisResult to AnalysisResult
        return self._convert_result(ai_result, repo_path, repo_name)

    def build_rag_engine(self) -> GraphRAGEngine:
        """获取或创建 GraphRAGEngine 实例。"""
        if self._rag_engine:
            return self._rag_engine
        vs = self._vector_store or VectorStore()
        return GraphRAGEngine(self._repo, vs)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _convert_progress_callback(
        self,
        on_progress: Optional[Callable[[dict], None]]
    ) -> Optional[Callable[[dict], None]]:
        """Convert old-style progress callback to new style."""
        if on_progress is None:
            return None

        def _wrapper(event: dict) -> None:
            # Map new step names to old step numbers
            step_map = {
                "scanner": 1,
                "module_scanner": 2,
                "code_analyzer": 3,
                "graph_builder": 4,
                "repository": 5,
                "rag": 6,
            }
            step_name = event.get("step", "")
            step_num = step_map.get(step_name, 0)

            try:
                on_progress({
                    "step": step_num,
                    "total": 6,
                    "stage": step_name,
                    "message": event.get("message", ""),
                    "log": "",
                    "status": event.get("status", "running"),
                    "elapsed_seconds": 0.0,
                })
            except Exception:
                pass

        return _wrapper

    def _convert_result(
        self,
        ai_result: AIAnalysisResult,
        repo_path: str | Path,
        repo_name: str,
    ) -> AnalysisResult:
        """Convert AIAnalysisResult to legacy AnalysisResult."""
        # Build BuiltGraph from nodes and edges
        builder = GraphBuilder()
        for node in ai_result.nodes:
            builder.add_node(node)
        for edge in ai_result.edges:
            builder.add_edge(edge)
        built = builder.build()

        # Create step stats
        step_stats = {
            "1_scan": {"files": 0, "languages": {}},
            "2_module_scanner": {"modules": 0},
            "3_code_analyzer": {
                "nodes": ai_result.node_count,
                "edges": ai_result.edge_count,
            },
            "4_graph_builder": {
                "nodes": built.node_count,
                "edges": built.edge_count,
            },
            "5_repository": {"graph_id": ai_result.graph_id},
        }

        if ai_result.failed_modules:
            step_stats["warnings"] = {
                "failed_modules": len(ai_result.failed_modules)
            }

        return AnalysisResult(
            graph_id=ai_result.graph_id,
            built=built,
            repo_path=str(repo_path),
            repo_name=repo_name or Path(repo_path).name,
            step_stats=step_stats,
            circular_deps=[],  # AI analysis doesn't detect circular deps
            duration_seconds=ai_result.duration_seconds,
            warnings=[fm.reason for fm in ai_result.failed_modules] + ai_result.warnings,
        )


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------


if __name__ == "__main__":
    import argparse
    import json
    import sys

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
    )

    ap = argparse.ArgumentParser(
        description="代码知识图谱分析流水线（向后兼容层）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python -m backend.pipeline.analyze_repository /path/to/repo
  python -m backend.pipeline.analyze_repository . --enable-rag

注意: 静态分析已移除，所有分析现由 AI 驱动。
        """,
    )
    ap.add_argument("repo_path", help="仓库根目录路径")
    ap.add_argument("--repo-name", default="", help="图谱名称（默认使用目录名）")
    ap.add_argument(
        "--languages", nargs="+", default=None,
        help="（已忽略）限定分析语言",
    )
    ap.add_argument(
        "--enable-ai", action="store_true",
        help="（已忽略）AI 分析始终启用",
    )
    ap.add_argument(
        "--enable-rag", action="store_true",
        help="启用向量化索引",
    )
    ap.add_argument(
        "--json", action="store_true",
        help="以 JSON 格式输出结果摘要",
    )
    args = ap.parse_args()

    try:
        pipeline = AnalysisPipeline()
        result = pipeline.analyze(
            args.repo_path,
            repo_name=args.repo_name,
            languages=args.languages,
            enable_ai=args.enable_ai,
            enable_rag=args.enable_rag,
        )

        if args.json:
            output = {
                "graph_id":         result.graph_id,
                "repo_name":        result.repo_name,
                "repo_path":        result.repo_path,
                "node_count":       result.node_count,
                "edge_count":       result.edge_count,
                "duration_seconds": result.duration_seconds,
                "warnings":         result.warnings,
                "step_stats":       result.step_stats,
                "circular_deps":    result.circular_deps,
            }
            print(json.dumps(output, ensure_ascii=False, indent=2))
        else:
            print()
            print(result.summary())

        sys.exit(0)

    except ValueError as e:
        logger.error("分析失败: %s", e)
        sys.exit(1)
    except Exception:
        logger.exception("分析过程中发生意外错误")
        sys.exit(2)
