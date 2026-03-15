"""
GraphPipeline — 代码知识图谱分析流水线。

流程
----
    Step 1  scan_repo    — RepoScanner 扫描仓库，收集文件列表和 Git 信息
    Step 2  ai_analyze   — AgentOrchestrator AI 分析，生成图谱节点和边
    Step 3  build_graph  — GraphBuilder 合并图谱
    Step 4  export_graph — 将最终图谱写入 graph.json，返回 GraphPipelineResult

与旧 AnalysisPipeline 的关系
-----------------------------
- 不再使用 Tree-sitter AST 解析，完全由 AI 驱动
- 专注于 AI 分析 → JSON Graph 输出
- 可选启用 RAG 向量化

输出
----
    GraphPipelineResult
        graph_id         — 持久化文件名（stem）
        output_path      — graph.json 绝对路径
        graph            — {"nodes": [...], "edges": [...]}
        node_count       — 节点总数
        edge_count       — 边总数
        step_stats       — 各步骤统计
        duration_seconds — 总耗时
        warnings         — 非致命警告列表

典型用法::

    from backend.pipeline.graph_pipeline import GraphPipeline

    pipeline = GraphPipeline()
    result = pipeline.run("/path/to/repo")
    print(result.summary())

    # 启用 AI（需配置 ANTHROPIC_API_KEY / OPENAI_API_KEY）
    result = pipeline.run("/path/to/repo", enable_ai=True)
"""

from __future__ import annotations

import dataclasses
import json
import logging
import re
import time
import warnings as _warnings
from pathlib import Path
from typing import Any, Callable, Optional

from backend.agent.orchestrator import AgentOrchestrator
from backend.graph.graph_builder import BuiltGraph, GraphBuilder
from backend.graph.graph_repository import GraphRepository
from backend.graph.graph_schema import GraphEdge, GraphNode
from backend.llm.client import LLMClient
from backend.rag.graph_rag_engine import GraphRAGEngine
from backend.rag.vector_store import VectorStore
from backend.scanner.repo_scanner import RepoScanner, ScanResult

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Result container
# ---------------------------------------------------------------------------


@dataclasses.dataclass
class GraphPipelineResult:
    """GraphPipeline.run() 的完整输出。

    Attributes:
        graph_id:         持久化文件名（stem），例如 ``"my-project"``。
        output_path:      graph.json 的绝对路径字符串。
        graph:            最终图谱字典 ``{"nodes": [...], "edges": [...]}``.
        node_count:       节点总数。
        edge_count:       边总数。
        step_stats:       各步骤统计，键格式 ``"N_<step_name>"``.
        duration_seconds: 总耗时（秒）。
        warnings:         非致命警告列表。
    """

    graph_id:         str
    output_path:      str
    graph:            dict[str, Any]
    node_count:       int
    edge_count:       int
    step_stats:       dict[str, dict[str, Any]]
    duration_seconds: float
    warnings:         list[str]

    def summary(self) -> str:
        """返回人类可读的结果摘要。"""
        lines = [
            f"图谱 ID:  {self.graph_id}",
            f"输出路径: {self.output_path}",
            f"节点数:   {self.node_count}",
            f"边数:     {self.edge_count}",
            f"耗时:     {self.duration_seconds:.2f}s",
        ]
        if self.warnings:
            lines.append(f"警告 ({len(self.warnings)}):")
            for w in self.warnings:
                lines.append(f"  - {w}")
        return "\n".join(lines)


# ---------------------------------------------------------------------------
# GraphPipeline
# ---------------------------------------------------------------------------


class GraphPipeline:
    """代码知识图谱分析流水线（AI 驱动）。

    步骤：
        1. scan_repo   — 扫描仓库文件
        2. ai_analyze  — AI 分析（使用 AgentOrchestrator）
        3. build_graph — 合并图谱
        4. export_graph — 持久化 graph.json

    示例::

        pipeline = GraphPipeline()

        # 启用 AI 分析
        result = pipeline.run("/path/to/repo", enable_ai=True)

        print(result.summary())
    """

    def __init__(
        self,
        graph_repo: Optional[GraphRepository] = None,
        llm_client: Optional[LLMClient] = None,
        vector_store: Optional[VectorStore] = None,
        rag_engine: Optional[GraphRAGEngine] = None,
        output_dir: str = "./data/graphs",
    ) -> None:
        """
        Args:
            graph_repo: 图谱持久化仓库（默认 ``./data/graphs``）。
            llm_client: LLM 客户端（None 则按需从环境变量创建）。
            vector_store: 向量存储（用于 RAG）。
            rag_engine: GraphRAG 引擎。
            output_dir: graph.json 输出目录。
        """
        self._output_dir = Path(output_dir)
        self._output_dir.mkdir(parents=True, exist_ok=True)
        self._repo = graph_repo or GraphRepository(output_dir)
        self._llm = llm_client
        self._vector_store = vector_store
        self._rag_engine = rag_engine

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    def run(
        self,
        repo_path: str | Path,
        *,
        repo_name: str = "",
        languages: Optional[list[str]] = None,
        enable_ai: bool = True,
        enable_rag: bool = False,
        on_progress: Optional[Callable[[dict], None]] = None,
    ) -> GraphPipelineResult:
        """执行完整的 4 步分析流水线。

        Args:
            repo_path:  仓库根目录（本地路径）。
            repo_name:  图谱名称；空字符串时使用目录名。
            languages:  限定分析语言（已忽略，由 AI 自动检测）。
            enable_ai:  启用 AI 分析（默认 True）。
            enable_rag: 启用向量化（需安装 chromadb）。
            on_progress: 进度回调函数。

        Returns:
            GraphPipelineResult。

        Raises:
            ValueError: 仓库路径不存在，或未找到任何可分析文件。
        """
        if languages is not None:
            logger.warning("languages 参数已忽略，AI 分析会自动检测语言")

        path = Path(repo_path).resolve()
        if not path.exists():
            raise ValueError(f"仓库路径不存在: {path}")

        name = repo_name or path.name
        t0 = time.time()
        stats: dict[str, dict[str, Any]] = {}
        warnings_list: list[str] = []

        logger.info("=" * 60)
        logger.info("GraphPipeline 开始: %s", path)
        logger.info("=" * 60)

        # ── Step 1: scan_repo ─────────────────────────────────────────
        scan_result, step1_stats = self._step_scan(path, languages)
        stats["1_scan"] = step1_stats

        if scan_result.total_files == 0:
            raise ValueError(
                "未找到可分析的源码文件，请检查仓库路径"
            )

        # ── Step 2: ai_analyze ────────────────────────────────────────
        nodes: list[GraphNode] = []
        edges: list[GraphEdge] = []

        if enable_ai:
            nodes, edges, step2_stats, ai_warnings = self._step_ai_analyze(
                path, scan_result, on_progress
            )
            warnings_list.extend(ai_warnings)
        else:
            logger.info("[2/4] ai_analyze: 跳过（enable_ai=False）")
            step2_stats = {"skipped": True}
            warnings_list.append("AI 分析未启用，图谱将为空")

        stats["2_ai"] = step2_stats

        # ── Step 3: build_graph ───────────────────────────────────────
        graph, built, step3_stats = self._step_build(nodes, edges, name)
        stats["3_build"] = step3_stats

        # ── Step 4: export_graph ──────────────────────────────────────
        graph_id, output_path, step4_stats = self._step_export(
            built, graph, name, scan_result
        )
        stats["4_export"] = step4_stats

        # ── Step 5 (optional): RAG ─────────────────────────────────────
        if enable_rag:
            self._step_rag(graph_id, built, stats, warnings_list)

        duration = round(time.time() - t0, 3)
        logger.info("=" * 60)
        logger.info(
            "GraphPipeline 完成: %d 节点 / %d 边 / 耗时 %.2fs → %s",
            len(graph["nodes"]), len(graph["edges"]), duration, output_path,
        )
        logger.info("=" * 60)

        return GraphPipelineResult(
            graph_id=graph_id,
            output_path=str(output_path),
            graph=graph,
            node_count=len(graph["nodes"]),
            edge_count=len(graph["edges"]),
            step_stats=stats,
            duration_seconds=duration,
            warnings=warnings_list,
        )

    # ------------------------------------------------------------------
    # Step 1: scan_repo
    # ------------------------------------------------------------------

    def _step_scan(
        self,
        path: Path,
        languages: Optional[list[str]],
    ) -> tuple[ScanResult, dict[str, Any]]:
        """Step 1 — 扫描仓库，收集文件列表和 Git 信息。"""
        logger.info("[1/4] scan_repo: 扫描仓库文件...")
        t = time.time()

        scan_result = RepoScanner().scan(path, languages=languages)
        commit = getattr(scan_result, "git_commit", "") or ""

        stats = {
            "files": scan_result.total_files,
            "languages": getattr(scan_result, "language_stats", {}),
            "commit_sha": commit[:8] if commit else "(none)",
            "duration_s": round(time.time() - t, 3),
        }
        logger.info(
            "  → %d 个文件  languages=%s  commit=%s",
            scan_result.total_files,
            list(stats["languages"].keys()),
            stats["commit_sha"],
        )
        return scan_result, stats

    # ------------------------------------------------------------------
    # Step 2: ai_analyze
    # ------------------------------------------------------------------

    def _step_ai_analyze(
        self,
        repo_path: Path,
        scan_result: ScanResult,
        on_progress: Optional[Callable[[dict], None]],
    ) -> tuple[list[GraphNode], list[GraphEdge], dict[str, Any], list[str]]:
        """Step 2 — 使用 AgentOrchestrator 进行 AI 分析。"""
        logger.info("[2/4] ai_analyze: AI 代码分析...")
        t = time.time()

        warnings_list: list[str] = []
        nodes: list[GraphNode] = []
        edges: list[GraphEdge] = []

        try:
            llm_client = self._get_llm()
            if not llm_client or not llm_client.is_available():
                msg = "LLM 不可用（未配置 API Key），跳过 AI 分析"
                logger.warning("  ⚠ %s", msg)
                return nodes, edges, {"skipped": True, "reason": msg}, [msg]

            orchestrator = AgentOrchestrator(
                repo_path=str(repo_path),
                llm_client=llm_client,
                max_iterations=30,
                on_progress=on_progress,
            )

            result = orchestrator.run_architecture_analysis()

            nodes = result.nodes
            edges = result.edges

            stats = {
                "nodes": len(nodes),
                "edges": len(edges),
                "status": result.status,
                "duration_s": round(time.time() - t, 3),
            }

            logger.info(
                "  → %d 节点 / %d 边  status=%s",
                len(nodes), len(edges), result.status
            )

            if result.status == "partial":
                warnings_list.append("部分 Agent 分析失败")

            return nodes, edges, stats, warnings_list

        except Exception as exc:
            logger.error("  ⚠ AI 分析失败: %s", exc)
            warnings_list.append(f"AI 分析失败: {exc}")
            return nodes, edges, {"error": str(exc)}, warnings_list

    # ------------------------------------------------------------------
    # Step 3: build_graph
    # ------------------------------------------------------------------

    def _step_build(
        self,
        nodes: list[GraphNode],
        edges: list[GraphEdge],
        repo_name: str,
    ) -> tuple[dict[str, Any], BuiltGraph, dict[str, Any]]:
        """Step 3 — 构建图谱。"""
        logger.info("[3/4] build_graph: 构建图谱...")
        t = time.time()

        builder = GraphBuilder()

        # 添加仓库根节点
        repo_node = GraphNode(
            id=f"repository:{repo_name}",
            type="Repository",
            name=repo_name,
            properties={},
        )
        builder.add_node(repo_node)

        # 添加 AI 分析结果
        for node in nodes:
            builder.add_node(node)
        for edge in edges:
            builder.add_edge(edge)

        built = builder.build()

        graph = {
            "nodes": [n.model_dump() for n in built.nodes],
            "edges": [e.model_dump() for e in built.edges],
        }

        stats = {
            "node_count": built.node_count,
            "edge_count": built.edge_count,
            "node_types": built.meta.get("node_type_counts", {}),
            "edge_types": built.meta.get("edge_type_counts", {}),
            "duration_s": round(time.time() - t, 3),
        }

        logger.info(
            "  → %d 节点 / %d 边  types=%s",
            built.node_count, built.edge_count, stats["node_types"]
        )

        return graph, built, stats

    # ------------------------------------------------------------------
    # Step 4: export_graph
    # ------------------------------------------------------------------

    def _step_export(
        self,
        built: BuiltGraph,
        graph: dict[str, Any],
        repo_name: str,
        scan_result: ScanResult,
    ) -> tuple[str, Path, dict[str, Any]]:
        """Step 4 — 将图谱写入 graph.json 并更新索引。"""
        logger.info("[4/4] export_graph: 持久化图谱...")
        t = time.time()

        graph_id = _safe_filename(repo_name)
        output_path = self._output_dir / f"{graph_id}.json"
        commit = getattr(scan_result, "git_commit", "") or ""
        now = _utc_now()

        # 更新 meta
        built.meta["graph_id"] = graph_id
        built.meta["repo_name"] = repo_name
        built.meta["git_commit"] = commit
        built.meta["created_at"] = now
        built.meta["pipeline"] = "GraphPipeline"

        # 写入 JSON
        payload = {
            "meta": built.meta,
            "nodes": graph["nodes"],
            "edges": graph["edges"],
        }
        output_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        # 同步写入 GraphRepository
        try:
            self._repo._save_json(built, graph_id, repo_name)
            logger.debug("  → GraphRepository 同步写入完成: %s", graph_id)
        except Exception as exc:
            logger.warning("  ⚠ GraphRepository 同步写入失败: %s", exc)

        stats = {
            "graph_id": graph_id,
            "output_path": str(output_path),
            "size_bytes": output_path.stat().st_size,
            "duration_s": round(time.time() - t, 3),
        }
        logger.info("  → 已写入: %s (%d bytes)", output_path, stats["size_bytes"])

        return graph_id, output_path, stats

    # ------------------------------------------------------------------
    # Step 5: RAG (optional)
    # ------------------------------------------------------------------

    def _step_rag(
        self,
        graph_id: str,
        built: BuiltGraph,
        stats: dict[str, dict[str, Any]],
        warnings_list: list[str],
    ) -> None:
        """Step 5 — 向量化节点（可选）。"""
        logger.info("[5/5] rag: 向量化节点...")
        t = time.time()

        try:
            rag_engine = self._get_rag_engine()
            count = rag_engine.embed_nodes(graph_id, built.nodes)
            stats["5_rag"] = {
                "embedded_nodes": count,
                "duration_s": round(time.time() - t, 3),
            }
            logger.info("  → 已向量化 %d 个节点", count)
        except Exception as exc:
            logger.warning("  ⚠ 向量化失败: %s", exc)
            warnings_list.append(f"向量化失败: {exc}")
            stats["5_rag"] = {"skipped": True, "reason": str(exc)}

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _get_llm(self) -> Optional[LLMClient]:
        """懒加载 LLM 客户端。"""
        if self._llm is None:
            try:
                self._llm = LLMClient.from_env()
            except Exception as exc:
                logger.warning("LLM 客户端初始化失败: %s", exc)
                return None
        return self._llm

    def _get_rag_engine(self) -> GraphRAGEngine:
        """获取或创建 RAG 引擎。"""
        if self._rag_engine is None:
            vs = self._vector_store or VectorStore()
            self._rag_engine = GraphRAGEngine(self._repo, vs)
        return self._rag_engine


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------


def _safe_filename(name: str) -> str:
    """将仓库名转为合法文件名（保留字母数字和 - _）。"""
    s = re.sub(r"[^\w\-]", "_", name.strip())
    return s[:80] or "graph"


def _utc_now() -> str:
    """返回当前 UTC 时间的 ISO 8601 字符串。"""
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------


if __name__ == "__main__":
    import argparse
    import sys

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
    )

    ap = argparse.ArgumentParser(
        description="GraphPipeline — 代码知识图谱分析（AI 驱动）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python -m backend.pipeline.graph_pipeline /path/to/repo
  python -m backend.pipeline.graph_pipeline . --enable-rag
        """,
    )
    ap.add_argument("repo_path", help="仓库根目录路径")
    ap.add_argument("--repo-name", default="", help="图谱名称（默认使用目录名）")
    ap.add_argument(
        "--languages", nargs="+", default=None,
        help="（已忽略）限定分析语言",
    )
    ap.add_argument(
        "--no-ai", action="store_true",
        help="禁用 AI 分析（不推荐，图谱将为空）",
    )
    ap.add_argument(
        "--enable-rag", action="store_true",
        help="启用向量化索引",
    )
    ap.add_argument(
        "--output-dir", default="./data/graphs",
        help="graph.json 输出目录（默认 ./data/graphs）",
    )
    args = ap.parse_args()

    try:
        pipeline = GraphPipeline(output_dir=args.output_dir)
        result = pipeline.run(
            args.repo_path,
            repo_name=args.repo_name,
            languages=args.languages,
            enable_ai=not args.no_ai,
            enable_rag=args.enable_rag,
        )
        print()
        print(result.summary())
        sys.exit(0)
    except ValueError as e:
        logger.error("分析失败: %s", e)
        sys.exit(1)
    except Exception:
        logger.exception("分析过程中发生意外错误")
        sys.exit(2)