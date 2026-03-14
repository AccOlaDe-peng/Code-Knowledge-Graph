"""
代码仓库分析流水线。

按顺序编排 13 个步骤，将代码仓库转换为结构化知识图谱：

    1  RepoScanner           — 扫描仓库文件，识别语言和 Git 信息
    2  CodeParser            — Tree-sitter AST 解析，提取类/函数/调用
    3  ModuleDetector        — 目录级模块节点 + File 节点 + contains 边
    4  ComponentDetector     — 组件 / 类 / 函数节点 + implements / contains 边
    5  DependencyAnalyzer    — 模块依赖 / 服务依赖 + 循环依赖检测
    6  CallGraphBuilder      — 函数调用图（Function→Function / Service→Service）
    7  EventAnalyzer         — 事件发布/订阅（Kafka / RabbitMQ / EventBus）
    8  InfraAnalyzer         — Dockerfile / Kubernetes / Terraform 基础设施
    9  RepoSummaryBuilder    — 构建 AI 分析所需的仓库摘要（静态图谱快照）
    10 AIGraphAgent          — AI 驱动的自主代码探索，识别架构模式（可选）
                               替代原 AIArchitectureAnalyzer / AIServiceDetector /
                               AIBusinessFlowAnalyzer / AIDataLineageAnalyzer
    11 GraphBuilder          — 合并所有分析器输出，计算 PageRank / 度指标
    12 GraphRepository       — 持久化为 JSON（可选 Neo4j 双写）
    13 GraphRAGEngine        — 向量化 Function/Component/API 节点到 ChromaDB（可选）

步骤 10 仅在 ``enable_ai=True`` 时运行；任意步骤失败只记录警告，
不中断整体流水线。

输出：
    AnalysisResult — 含 graph_id / BuiltGraph / 每步统计 / 循环依赖 / 耗时 / 警告

典型用法::

    pipeline = AnalysisPipeline()
    result = pipeline.analyze(
        "/path/to/repo",
        enable_ai=True,     # 启用 AI 分析（步骤 10，需 LLM API Key）
        enable_rag=True,    # 启用向量化（步骤 13，需安装 chromadb）
    )
    print(result.summary())
"""

from __future__ import annotations

import dataclasses
import logging
import time
from pathlib import Path
from typing import Any, Callable, Optional

from backend.analyzer.call_graph_builder import CallGraphBuilder
from backend.analyzer.component_detector import ComponentDetector
from backend.analyzer.dependency_analyzer import DependencyAnalyzer
from backend.analyzer.event_analyzer import EventAnalyzer
from backend.analyzer.infra_analyzer import InfraAnalyzer
from backend.analyzer.module_detector import ModuleDetector
from backend.graph.graph_builder import BuiltGraph, GraphBuilder
from backend.graph.graph_repository import GraphRepository
from backend.parser.code_parser import CodeParser, ParseResult
from backend.rag.graph_rag_engine import GraphRAGEngine
from backend.rag.vector_store import VectorStore
from backend.scanner.repo_scanner import RepoScanner

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Output container
# ---------------------------------------------------------------------------


@dataclasses.dataclass
class AnalysisResult:
    """AnalysisPipeline.analyze() 的完整输出。

    Attributes:
        graph_id:         GraphRepository 中的图谱 ID（同时是文件名 stem）。
        built:            完整图谱，含节点 / 边 / PageRank 等指标。
        repo_path:        仓库绝对路径（字符串）。
        repo_name:        仓库/图谱名称。
        step_stats:       每步骤的统计信息字典，键格式为 ``"N_<step>"``。
        circular_deps:    DependencyAnalyzer 检测到的循环依赖链列表。
        duration_seconds: 总分析耗时（秒）。
        warnings:         非致命警告列表（步骤被跳过时追加）。
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
                lines.append(f"  ⚠ {w}")
        return "\n".join(lines)


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------


class AnalysisPipeline:
    """
    代码仓库分析流水线（13 步）。

    示例::

        pipeline = AnalysisPipeline()

        # 基础分析（仅静态代码分析，无 LLM）
        result = pipeline.analyze("/path/to/repo")

        # 完整分析（含 AI 语义分析 + 向量索引）
        result = pipeline.analyze(
            "/path/to/repo",
            enable_ai=True,
            enable_rag=True,
        )
        print(result.summary())

        # 分析完成后自然语言查询
        rag = pipeline.build_rag_engine()
        answer = rag.rag_query(result.graph_id, "登录功能如何实现？")
        print(answer["answer"])
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
            rag_engine:   预构建的 GraphRAGEngine（None 则按需自动创建）。
        """
        self._repo = graph_repo or GraphRepository()
        self._vector_store = vector_store
        self._rag_engine = rag_engine

    # ------------------------------------------------------------------
    # Public
    # ------------------------------------------------------------------

    def analyze(
        self,
        repo_path: str | Path,
        *,
        repo_name: str = "",
        languages: Optional[list[str]] = None,
        enable_ai: bool = False,
        enable_rag: bool = False,
        on_progress: Optional[Callable[[dict], None]] = None,
    ) -> AnalysisResult:
        """执行完整分析流水线，返回 AnalysisResult。

        Args:
            repo_path:  仓库根目录（本地路径）。
            repo_name:  图谱名称前缀；空字符串时使用目录名。
            languages:  限定分析语言，例如 ``["python", "typescript"]``；
                        None 表示自动探测所有支持语言。
            enable_ai:  启用 AI 分析器（步骤 10），需配置 LLM API Key
                        （``ANTHROPIC_API_KEY`` / ``OPENAI_API_KEY`` 等）。
                        未配置 Key 时 AI 步骤自动跳过。
            enable_rag: 启用 GraphRAGEngine.embed_nodes()（步骤 13），
                        需安装 ``chromadb``。

        Returns:
            AnalysisResult。

        Raises:
            ValueError: 仓库路径不存在，或未找到任何可分析文件。
        """
        path = Path(repo_path).resolve()
        if not path.exists():
            raise ValueError(f"仓库路径不存在: {path}")

        name = repo_name or path.name
        t0 = time.time()
        step_stats: dict[str, dict[str, Any]] = {}
        warnings: list[str] = []

        def _emit(step: int, stage: str, message: str, log: str = "",
                  status: str = "running", elapsed: float = 0.0) -> None:
            """发布进度事件（忽略回调异常，避免中断分析）。"""
            if on_progress is None:
                return
            try:
                on_progress({
                    "step":            step,
                    "total":           13,
                    "stage":           stage,
                    "message":         message,
                    "log":             log,
                    "status":          status,
                    "elapsed_seconds": round(elapsed, 3),
                })
            except Exception:
                pass

        logger.info("=" * 60)
        logger.info("开始分析仓库: %s", path)
        logger.info("=" * 60)

        # ── Step 1: RepoScanner ────────────────────────────────────────
        _emit(1, "RepoScanner", "扫描仓库文件...")
        logger.info("[1/13] RepoScanner: 扫描仓库文件...")
        _step_t = time.time()
        scan_result = RepoScanner().scan(path, languages=languages)
        commit_sha: str = getattr(scan_result, "git_commit", "") or ""
        step_stats["1_scan"] = {
            "files":      scan_result.total_files,
            "languages":  getattr(scan_result, "language_counts", {}),
            "repo_name":  scan_result.repo_name,
            "commit_sha": commit_sha[:8] if commit_sha else "(none)",
        }
        logger.info(
            "  → %d 个文件  commit=%s",
            scan_result.total_files,
            commit_sha[:8] if commit_sha else "(no git)",
        )
        _emit(1, "RepoScanner", "扫描仓库文件",
              log=f"→ {scan_result.total_files} 个文件  commit={commit_sha[:8] if commit_sha else '(no git)'}",
              status="step_done", elapsed=time.time() - _step_t)

        if scan_result.total_files == 0:
            raise ValueError(
                "未找到可分析的源码文件，请检查仓库路径或语言过滤条件"
            )

        # ── Step 2: CodeParser ─────────────────────────────────────────
        _emit(2, "CodeParser", "AST 解析代码结构...")
        logger.info("[2/13] CodeParser: AST 解析...")
        _step_t = time.time()
        parsed_result: ParseResult = CodeParser().scan_repository(
            path, languages=languages
        )
        step_stats["2_parse"] = parsed_result.stats
        logger.info(
            "  → %d 文件 / %d 类 / %d 函数 / %d 调用",
            len(parsed_result.files), len(parsed_result.classes),
            len(parsed_result.functions), len(parsed_result.calls),
        )
        _emit(2, "CodeParser", "AST 解析代码结构",
              log=f"→ {len(parsed_result.files)} 文件 / {len(parsed_result.classes)} 类 / {len(parsed_result.functions)} 函数",
              status="step_done", elapsed=time.time() - _step_t)

        parsed_files: dict[str, Any] = {
            pf.file_path: pf for pf in parsed_result.files
        }

        # ── Step 3: ModuleDetector ─────────────────────────────────────
        _emit(3, "ModuleDetector", "识别模块/文件节点...")
        logger.info("[3/13] ModuleDetector: 识别模块/文件节点...")
        _step_t = time.time()
        module_graph = ModuleDetector(path).detect(scan_result)
        step_stats["3_module"] = module_graph.stats
        logger.info(
            "  → %d 模块 / %d 文件节点 / %d 边",
            len(module_graph.modules), len(module_graph.files),
            len(module_graph.edges),
        )
        _emit(3, "ModuleDetector", "识别模块/文件节点",
              log=f"→ {len(module_graph.modules)} 模块 / {len(module_graph.files)} 文件节点",
              status="step_done", elapsed=time.time() - _step_t)

        # ── Step 4: ComponentDetector ──────────────────────────────────
        _emit(4, "ComponentDetector", "识别组件/类/函数节点...")
        logger.info("[4/13] ComponentDetector: 识别组件/类/函数节点...")
        _step_t = time.time()
        component_graph = ComponentDetector().detect(parsed_files)
        step_stats["4_component"] = component_graph.stats
        logger.info(
            "  → %d 组件 / %d 类 / %d 函数",
            len(component_graph.components), len(component_graph.classes),
            len(component_graph.functions),
        )
        _emit(4, "ComponentDetector", "识别组件/类/函数节点",
              log=f"→ {len(component_graph.components)} 组件 / {len(component_graph.classes)} 类 / {len(component_graph.functions)} 函数",
              status="step_done", elapsed=time.time() - _step_t)

        # ── Step 5: DependencyAnalyzer ─────────────────────────────────
        _emit(5, "DependencyAnalyzer", "分析模块/服务依赖...")
        logger.info("[5/13] DependencyAnalyzer: 分析模块/服务依赖...")
        _step_t = time.time()
        dep_graph = DependencyAnalyzer(path).analyze(
            module_graph, component_graph, parsed_result
        )
        step_stats["5_dependency"] = dep_graph.stats
        if dep_graph.circular_deps:
            logger.warning("  ⚠ 检测到 %d 个循环依赖", len(dep_graph.circular_deps))
        logger.info(
            "  → 模块依赖 %d / 服务依赖 %d / 循环依赖 %d",
            len(dep_graph.module_deps), len(dep_graph.service_deps),
            len(dep_graph.circular_deps),
        )
        _emit(5, "DependencyAnalyzer", "分析模块/服务依赖",
              log=f"→ 模块依赖 {len(dep_graph.module_deps)} / 循环依赖 {len(dep_graph.circular_deps)}",
              status="step_done", elapsed=time.time() - _step_t)

        # ── Step 6: CallGraphBuilder ───────────────────────────────────
        _emit(6, "CallGraphBuilder", "构建函数调用图...")
        logger.info("[6/13] CallGraphBuilder: 构建函数调用图...")
        _step_t = time.time()
        call_graph = CallGraphBuilder().build(component_graph, parsed_result)
        step_stats["6_callgraph"] = call_graph.stats
        logger.info("  → %d 条调用边", len(call_graph.edges))
        _emit(6, "CallGraphBuilder", "构建函数调用图",
              log=f"→ {len(call_graph.edges)} 条调用边",
              status="step_done", elapsed=time.time() - _step_t)

        # ── Step 7: EventAnalyzer ──────────────────────────────────────
        _emit(7, "EventAnalyzer", "分析事件流...")
        logger.info("[7/13] EventAnalyzer: 分析事件流...")
        _step_t = time.time()
        event_graph = EventAnalyzer().analyze(parsed_result, component_graph)
        step_stats["7_event"] = {
            "events": len(event_graph.events),
            "topics": len(event_graph.topics),
            "edges":  len(event_graph.edges),
        }
        logger.info(
            "  → %d 事件 / %d Topic / %d 边",
            len(event_graph.events), len(event_graph.topics),
            len(event_graph.edges),
        )
        _emit(7, "EventAnalyzer", "分析事件流",
              log=f"→ {len(event_graph.events)} 事件 / {len(event_graph.topics)} Topic",
              status="step_done", elapsed=time.time() - _step_t)

        # ── Step 8: InfraAnalyzer ──────────────────────────────────────
        _emit(8, "InfraAnalyzer", "分析基础设施配置...")
        logger.info("[8/13] InfraAnalyzer: 分析基础设施配置...")
        _step_t = time.time()
        infra_graph = InfraAnalyzer().analyze(path)
        step_stats["8_infra"] = infra_graph.stats
        logger.info(
            "  → 服务 %d / 集群 %d / 数据库 %d / 容器 %d",
            len(infra_graph.services), len(infra_graph.clusters),
            len(infra_graph.databases), len(infra_graph.containers),
        )
        _emit(8, "InfraAnalyzer", "分析基础设施配置",
              log=f"→ 服务 {len(infra_graph.services)} / 集群 {len(infra_graph.clusters)} / 数据库 {len(infra_graph.databases)}",
              status="step_done", elapsed=time.time() - _step_t)

        # ── Step 9: RepoSummaryBuilder ─────────────────────────────────
        # Build a preliminary graph from static analyzers only, then feed it
        # to RepoSummaryBuilder to produce the AI-consumable summary.
        # The final graph (step 11) will include AI analyzer results on top.
        _emit(9, "RepoSummaryBuilder", "构建 AI 分析摘要...")
        _step_t = time.time()
        summary = None
        static_graph = None
        logger.info("[9/13] RepoSummaryBuilder: 构建 AI 分析摘要...")
        try:
            from backend.pipeline.repo_summary_builder import RepoSummaryBuilder

            pre_builder = GraphBuilder()
            pre_builder.add_node(module_graph.repository)
            pre_builder.merge_graph(module_graph)
            pre_builder.merge_graph(component_graph)
            pre_builder.merge_graph(dep_graph)
            pre_builder.merge_graph(call_graph)
            pre_builder.merge_graph(event_graph)
            pre_builder.merge_graph(infra_graph)
            static_graph = pre_builder.build()

            summary = RepoSummaryBuilder().build_summary(static_graph)
            step_stats["9_summary"] = {
                "token_estimate": summary.token_estimate,
                "functions":      len(summary.functions),
                "modules":        len(summary.modules),
                "apis":           len(summary.apis),
                "databases":      len(summary.databases),
                "events":         len(summary.events),
                "truncated":      summary.truncated,
            }
            logger.info(
                "  → %d 函数 / %d 模块 / %d API / %d 数据库 / token 估算=%d%s",
                len(summary.functions), len(summary.modules),
                len(summary.apis), len(summary.databases),
                summary.token_estimate,
                " [截断]" if summary.truncated else "",
            )
            _emit(9, "RepoSummaryBuilder", "构建 AI 分析摘要",
                  log=f"→ {len(summary.functions)} 函数 / {len(summary.modules)} 模块  token≈{summary.token_estimate}",
                  status="step_done", elapsed=time.time() - _step_t)
        except Exception:
            logger.warning("[9/13] RepoSummaryBuilder 失败，AI 步骤将跳过", exc_info=True)
            warnings.append("RepoSummaryBuilder 失败，AI 分析（步骤 10）已跳过")
            step_stats["9_summary"] = {"skipped": True}
            _emit(9, "RepoSummaryBuilder", "构建 AI 分析摘要", log="→ 跳过（失败）", status="step_done", elapsed=0.0)

        # ── Step 10: AIGraphAgent (optional) ───────────────────────────
        # Replaces the previous 4 AI analyzers (AIArchitectureAnalyzer,
        # AIServiceDetector, AIBusinessFlowAnalyzer, AIDataLineageAnalyzer)
        # with a single AI agent that autonomously explores the codebase.
        _emit(10, "AIGraphAgent", "AI 驱动的代码探索（LLM）...")
        _step_t = time.time()
        ai_graph = None

        if enable_ai and summary is not None and static_graph is not None:
            logger.info("[10/13] AIGraphAgent: AI 驱动的代码探索...")
            try:
                from backend.ai.llm_client import get_default_client
                from backend.analyzer.ai.agent.graph_agent import AIGraphAgent

                # Get LLM client
                llm_client = get_default_client()

                if not llm_client.is_available():
                    logger.warning("LLM 客户端不可用，跳过 AI 分析")
                    warnings.append("LLM 客户端不可用（未配置 API Key），AI 分析已跳过")
                    step_stats["10_ai_graph_agent"] = {"skipped": True}
                else:
                    # Run AIGraphAgent (reuse static_graph from step 9)
                    agent = AIGraphAgent(
                        llm_client=llm_client._get_client(),  # Get underlying Anthropic client
                        repo_path=str(path),
                        static_graph=static_graph,
                        max_tool_calls=20,
                    )
                    ai_graph = agent.analyze(summary)

                    step_stats["10_ai_graph_agent"] = {
                        "nodes": len(ai_graph.get("nodes", [])),
                        "edges": len(ai_graph.get("edges", [])),
                        "tool_calls": ai_graph.get("meta", {}).get("tool_calls_used", 0),
                    }
                    logger.info(
                        "  → %d 节点 / %d 边 / %d 次工具调用",
                        len(ai_graph.get("nodes", [])),
                        len(ai_graph.get("edges", [])),
                        ai_graph.get("meta", {}).get("tool_calls_used", 0),
                    )

            except ImportError:
                logger.warning("AIGraphAgent 模块导入失败，步骤 10 跳过", exc_info=True)
                warnings.append("AIGraphAgent 导入失败，AI 分析已跳过")
                step_stats["10_ai_graph_agent"] = {"skipped": True}
            except Exception:
                logger.warning("[10/13] AIGraphAgent 失败，跳过", exc_info=True)
                warnings.append("AIGraphAgent 分析失败，已跳过")
                step_stats["10_ai_graph_agent"] = {"skipped": True}
        else:
            reason = "enable_ai=False" if not enable_ai else "RepoSummaryBuilder 失败"
            logger.info("[10/13] AIGraphAgent: 跳过（%s）", reason)
            step_stats["10_ai_graph_agent"] = {"skipped": True}
        _emit(10, "AIGraphAgent", "AI 驱动的代码探索",
              log=f"→ {len(ai_graph.get('nodes', []))} 节点 / {ai_graph.get('meta', {}).get('tool_calls_used', 0)} 次工具调用" if ai_graph else "→ 跳过",
              status="step_done", elapsed=time.time() - _step_t)

        # ── Step 11: GraphBuilder ──────────────────────────────────────
        _emit(11, "GraphBuilder", "合并所有图谱，计算图论指标...")
        logger.info("[11/13] GraphBuilder: 合并所有图谱，计算图论指标...")
        _step_t = time.time()
        builder = GraphBuilder()

        # Repository root node
        builder.add_node(module_graph.repository)

        # Static analysis layers (later merges override same-ID nodes)
        builder.merge_graph(module_graph)
        builder.merge_graph(component_graph)
        builder.merge_graph(dep_graph)
        builder.merge_graph(call_graph)
        builder.merge_graph(event_graph)
        builder.merge_graph(infra_graph)

        # AI analysis layer (merged last so AI enrichments win on conflicts)
        if ai_graph is not None:
            builder.merge_graph(ai_graph)

        built = builder.build()
        step_stats["11_builder"] = {
            "nodes":             built.node_count,
            "edges":             built.edge_count,
            "node_types":        built.meta.get("node_type_counts", {}),
            "edge_types":        built.meta.get("edge_type_counts", {}),
            "metrics_available": built.meta.get("metrics_available", False),
            "ai_nodes":          len(ai_graph.get("nodes", [])) if ai_graph else 0,
            "ai_edges":          len(ai_graph.get("edges", [])) if ai_graph else 0,
        }
        logger.info(
            "  → %d 节点 / %d 边  (AI贡献: %d节点/%d边)  指标:%s",
            built.node_count, built.edge_count,
            step_stats["11_builder"]["ai_nodes"],
            step_stats["11_builder"]["ai_edges"],
            "✓" if built.meta.get("metrics_available") else "✗（需安装 networkx）",
        )
        _emit(11, "GraphBuilder", "合并所有图谱",
              log=f"→ {built.node_count} 节点 / {built.edge_count} 边",
              status="step_done", elapsed=time.time() - _step_t)

        # ── Step 12: GraphRepository ───────────────────────────────────
        _emit(12, "GraphRepository", "持久化图谱...")
        logger.info("[12/13] GraphRepository: 持久化图谱...")
        _step_t = time.time()
        graph_id: str = self._repo.save(built, repo_name=name)
        step_stats["12_repository"] = {"graph_id": graph_id}
        logger.info("  → 图谱 ID: %s", graph_id)
        _emit(12, "GraphRepository", "持久化图谱",
              log=f"→ graph_id={graph_id}",
              status="step_done", elapsed=time.time() - _step_t)

        # ── Step 13: GraphRAGEngine (optional) ────────────────────────
        _emit(13, "GraphRAGEngine", "向量化 Function/Component/API 节点...")
        logger.info("[13/13] GraphRAGEngine: 向量化 Function/Component/API 节点...")
        _step_t = time.time()
        _rag_count = 0
        if enable_rag:
            try:
                rag = self._rag_engine or self._build_rag_engine()
                count: int = rag.embed_nodes(graph_id, built.nodes)
                _rag_count = count
                step_stats["13_rag"] = {"embedded_nodes": count}
                logger.info("  → 向量化完成: %d 个节点", count)
            except Exception:
                logger.warning("[13/13] GraphRAGEngine 失败，跳过", exc_info=True)
                warnings.append(
                    "GraphRAGEngine.embed_nodes() 失败（chromadb 未安装或初始化失败），已跳过"
                )
                step_stats["13_rag"] = {"skipped": True}
        else:
            logger.info("[13/13] GraphRAGEngine: 跳过（enable_rag=False）")
            step_stats["13_rag"] = {"skipped": True}
        _emit(13, "GraphRAGEngine", "向量化节点",
              log=f"→ {_rag_count} 个节点已向量化" if enable_rag else "→ 跳过",
              status="step_done", elapsed=time.time() - _step_t)

        duration = round(time.time() - t0, 3)
        logger.info("=" * 60)
        logger.info(
            "分析完成: %d 节点 / %d 边 / 耗时 %.2fs",
            built.node_count, built.edge_count, duration,
        )
        logger.info("=" * 60)

        return AnalysisResult(
            graph_id=graph_id,
            built=built,
            repo_path=str(path),
            repo_name=name,
            step_stats=step_stats,
            circular_deps=dep_graph.circular_deps,
            duration_seconds=duration,
            warnings=warnings,
        )

    def build_rag_engine(self) -> GraphRAGEngine:
        """获取或创建 GraphRAGEngine 实例（共享当前 graph_repo 和 vector_store）。"""
        if self._rag_engine:
            return self._rag_engine
        return self._build_rag_engine()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _build_rag_engine(self) -> GraphRAGEngine:
        """按需构建 GraphRAGEngine。"""
        vs = self._vector_store or VectorStore()
        return GraphRAGEngine(self._repo, vs)


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
        description="代码知识图谱分析流水线",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python -m backend.pipeline.analyze_repository /path/to/repo
  python -m backend.pipeline.analyze_repository . --enable-ai
  python -m backend.pipeline.analyze_repository . --enable-ai --enable-rag
  python -m backend.pipeline.analyze_repository . --languages python typescript
        """,
    )
    ap.add_argument("repo_path", help="仓库根目录路径")
    ap.add_argument("--repo-name", default="", help="图谱名称（默认使用目录名）")
    ap.add_argument(
        "--languages", nargs="+", default=None,
        help="限定分析语言，例如 --languages python typescript",
    )
    ap.add_argument(
        "--enable-ai", action="store_true",
        help="启用 AI 分析器（步骤 10，需配置 LLM API Key）",
    )
    ap.add_argument(
        "--enable-rag", action="store_true",
        help="启用向量化索引（步骤 13，需安装 chromadb）",
    )
    ap.add_argument(
        "--json", action="store_true",
        help="以 JSON 格式输出结果摘要到 stdout",
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
