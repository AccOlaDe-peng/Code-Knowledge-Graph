"""
GraphPipeline — 新版代码知识图谱分析流水线。

流程
----
    Step 1  scan_repo    — RepoScanner 扫描仓库，收集文件列表和 Git 信息
    Step 2  parse_code   — CodeParser  AST 解析每个文件，提取类/函数/调用/导入
    Step 3  ai_analyze   — LLM 逐文件分析，每个文件返回 {"nodes":[], "edges":[]}
    Step 4  build_graph  — CodeGraphBuilder 合并所有文件级图，去重节点和边
    Step 5  export_graph — 将最终图谱写入 graph.json，返回 GraphPipelineResult

与旧 AnalysisPipeline 的关系
-----------------------------
- 保留所有现有模块（RepoScanner / CodeParser / GraphRepository 等）不变。
- 不替换旧流水线，两者并存；旧流水线仍可通过 /analyze/repository 调用。
- 新流水线专注于 AI 逐文件分析 → JSON Graph 输出，不依赖 NetworkX / ChromaDB。

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

    # 限定语言
    result = pipeline.run("/path/to/repo", languages=["python"])
"""

from __future__ import annotations

import dataclasses
import json
import logging
import re
import time
from pathlib import Path
from typing import Any, Optional

from backend.ai.llm_client import LLMClient, get_default_client
from backend.graph.code_graph_builder import CodeGraphBuilder
from backend.graph.graph_repository import GraphRepository
from backend.parser.code_parser import CodeParser, ParsedFile
from backend.scanner.repo_scanner import RepoScanner, ScanResult

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# 单文件 AI prompt 的最大字符数（超出则截断）
_MAX_FILE_CONTEXT_CHARS: int = 6_000

# AI 分析时每批并发的最大文件数（顺序处理，批次仅用于日志）
_AI_BATCH_SIZE: int = 20

# 跳过 AI 分析的文件大小上限（bytes）
_MAX_FILE_SIZE_FOR_AI: int = 200_000

# LLM 调用失败时的最大重试次数
_LLM_MAX_RETRIES: int = 2

# 重试间隔（秒）
_LLM_RETRY_DELAYS = (1.0, 2.0)

# 最大 LLM 响应字符数（防止超长无效响应）
_MAX_RESPONSE_CHARS: int = 32_000


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
                lines.append(f"  ⚠ {w}")
        return "\n".join(lines)


# ---------------------------------------------------------------------------
# GraphPipeline
# ---------------------------------------------------------------------------


class GraphPipeline:
    """新版代码知识图谱分析流水线（5 步）。

    步骤：
        1. scan_repo   — 扫描仓库文件
        2. parse_code  — AST 解析
        3. ai_analyze  — AI 逐文件分析（可选）
        4. build_graph — 合并图谱
        5. export_graph — 持久化 graph.json

    示例::

        pipeline = GraphPipeline()

        # 纯静态分析（无 AI）
        result = pipeline.run("/path/to/repo")

        # 启用 AI 逐文件分析
        result = pipeline.run("/path/to/repo", enable_ai=True)

        print(result.summary())
    """

    def __init__(
        self,
        graph_repo: Optional[GraphRepository] = None,
        llm_client: Optional[LLMClient] = None,
        output_dir: str = "./data/graphs",
    ) -> None:
        """
        Args:
            graph_repo: 图谱持久化仓库（默认 ``./data/graphs``）。
            llm_client: LLM 客户端（None 则按需从环境变量创建）。
            output_dir: graph.json 输出目录。
        """
        self._repo       = graph_repo or GraphRepository(output_dir)
        self._llm        = llm_client   # 懒加载，enable_ai=True 时才初始化
        self._output_dir = Path(output_dir)
        self._output_dir.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    def run(
        self,
        repo_path: str | Path,
        *,
        repo_name: str = "",
        languages: Optional[list[str]] = None,
        enable_ai: bool = False,
    ) -> GraphPipelineResult:
        """执行完整的 5 步分析流水线。

        Args:
            repo_path:  仓库根目录（本地路径）。
            repo_name:  图谱名称；空字符串时使用目录名。
            languages:  限定分析语言，例如 ``["python", "typescript"]``；
                        None 表示自动探测所有支持语言。
            enable_ai:  启用 AI 逐文件分析（需配置 LLM API Key）。

        Returns:
            GraphPipelineResult。

        Raises:
            ValueError: 仓库路径不存在，或未找到任何可分析文件。
        """
        path = Path(repo_path).resolve()
        if not path.exists():
            raise ValueError(f"仓库路径不存在: {path}")

        name     = repo_name or path.name
        t0       = time.time()
        stats:   dict[str, dict[str, Any]] = {}
        warnings: list[str] = []

        logger.info("=" * 60)
        logger.info("GraphPipeline 开始: %s", path)
        logger.info("=" * 60)

        # ── Step 1: scan_repo ─────────────────────────────────────────
        scan_result, step1_stats = self._step_scan(path, languages)
        stats["1_scan"] = step1_stats

        if scan_result.total_files == 0:
            raise ValueError(
                "未找到可分析的源码文件，请检查仓库路径或语言过滤条件"
            )

        # ── Step 2: parse_code ────────────────────────────────────────
        parsed_files, step2_stats = self._step_parse(path, scan_result, languages)
        stats["2_parse"] = step2_stats

        # ── Step 3: ai_analyze ────────────────────────────────────────
        builder = CodeGraphBuilder()

        if enable_ai:
            step3_stats, ai_warnings = self._step_ai_analyze(
                parsed_files, path, name, builder
            )
            warnings.extend(ai_warnings)
        else:
            logger.info("[3/5] ai_analyze: 跳过（enable_ai=False）")
            step3_stats = {"skipped": True}

        stats["3_ai"] = step3_stats

        # ── Step 4: build_graph ───────────────────────────────────────
        graph, step4_stats = self._step_build(
            builder, scan_result, parsed_files, name
        )
        stats["4_build"] = step4_stats

        # ── Step 5: export_graph ──────────────────────────────────────
        graph_id, output_path, step5_stats = self._step_export(
            graph, name, scan_result
        )
        stats["5_export"] = step5_stats

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
            warnings=warnings,
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
        logger.info("[1/5] scan_repo: 扫描仓库文件...")
        t = time.time()

        scan_result = RepoScanner().scan(path, languages=languages)
        commit = getattr(scan_result, "git_commit", "") or ""

        stats = {
            "files":      scan_result.total_files,
            "languages":  getattr(scan_result, "language_stats", {}),
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
    # Step 2: parse_code
    # ------------------------------------------------------------------

    def _step_parse(
        self,
        repo_path: Path,
        scan_result: ScanResult,
        languages: Optional[list[str]],
    ) -> tuple[list[ParsedFile], dict[str, Any]]:
        """Step 2 — AST 解析，提取类/函数/调用/导入。"""
        logger.info("[2/5] parse_code: AST 解析...")
        t = time.time()

        parse_result = CodeParser().scan_repository(repo_path, languages=languages)
        parsed_files = parse_result.files

        stats = {
            **parse_result.stats,
            "duration_s": round(time.time() - t, 3),
        }
        logger.info(
            "  → %d 文件 / %d 类 / %d 函数 / %d 调用",
            len(parsed_files),
            len(parse_result.classes),
            len(parse_result.functions),
            len(parse_result.calls),
        )
        return parsed_files, stats

    # ------------------------------------------------------------------
    # Step 3: ai_analyze
    # ------------------------------------------------------------------

    def _step_ai_analyze(
        self,
        parsed_files: list[ParsedFile],
        repo_path: Path,
        repo_name: str,
        builder: CodeGraphBuilder,
    ) -> tuple[dict[str, Any], list[str]]:
        """Step 3 — LLM 逐文件分析，将每个文件的图加入 builder。

        每个文件独立调用 LLM，失败时记录警告并继续。
        返回 (step_stats, warnings)。
        """
        logger.info("[3/5] ai_analyze: AI 逐文件分析（%d 文件）...", len(parsed_files))
        t = time.time()

        llm = self._get_llm()
        if not llm.is_available():
            msg = "LLM 不可用（未配置 API Key），AI 分析步骤跳过"
            logger.warning("  ⚠ %s", msg)
            return {"skipped": True, "reason": msg}, [msg]

        success = failed = skipped = 0
        warnings: list[str] = []

        for i, pf in enumerate(parsed_files):
            file_rel = _relative(pf.file_path, repo_path)

            # 跳过过大文件
            try:
                size = Path(pf.file_path).stat().st_size
                if size > _MAX_FILE_SIZE_FOR_AI:
                    logger.debug("  跳过大文件 (%d bytes): %s", size, file_rel)
                    skipped += 1
                    continue
            except OSError:
                pass

            # 跳过无实质内容的文件
            if not pf.classes and not pf.functions:
                skipped += 1
                continue

            if (i + 1) % _AI_BATCH_SIZE == 0 or i == 0:
                logger.info(
                    "  AI 分析进度: %d/%d 文件 (成功=%d 失败=%d 跳过=%d)",
                    i + 1, len(parsed_files), success, failed, skipped,
                )

            # 构建 prompt 并调用 LLM
            system_prompt, user_prompt = _build_file_prompt(pf, repo_name, file_rel)
            raw = _call_llm_with_retry(llm, system_prompt, user_prompt)

            if not raw:
                failed += 1
                warnings.append(f"AI 分析失败（LLM 无响应）: {file_rel}")
                continue

            # 解析 LLM 返回的 JSON Graph
            file_graph = _extract_json_graph(raw)
            if file_graph is None:
                failed += 1
                warnings.append(f"AI 返回无效 JSON: {file_rel}")
                continue

            # 注入 file 字段（LLM 可能省略）
            _inject_file_field(file_graph, file_rel, pf.language)

            try:
                builder.add_graph(file_graph)
                success += 1
                logger.debug(
                    "  ✓ %s → +%d nodes / +%d edges",
                    file_rel,
                    len(file_graph.get("nodes", [])),
                    len(file_graph.get("edges", [])),
                )
            except Exception as exc:
                failed += 1
                warnings.append(f"add_graph 失败 ({file_rel}): {exc}")

        stats = {
            "files_total":   len(parsed_files),
            "files_success": success,
            "files_failed":  failed,
            "files_skipped": skipped,
            "duration_s":    round(time.time() - t, 3),
        }
        logger.info(
            "  → AI 分析完成: 成功=%d 失败=%d 跳过=%d",
            success, failed, skipped,
        )
        return stats, warnings

    # ------------------------------------------------------------------
    # Step 4: build_graph
    # ------------------------------------------------------------------

    def _step_build(
        self,
        builder: CodeGraphBuilder,
        scan_result: ScanResult,
        parsed_files: list[ParsedFile],
        repo_name: str,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        """Step 4 — 合并所有文件级图，补充静态分析节点。

        若 AI 分析未运行（enable_ai=False）或结果为空，
        则从 ParsedFile 构建基础静态图（repository/module/file/class/function 节点）。
        """
        logger.info("[4/5] build_graph: 合并图谱...")
        t = time.time()

        # 若 builder 为空（AI 未运行），从静态解析结果填充基础图
        if builder.stats["node_count"] == 0:
            logger.info("  AI 图为空，从静态解析结果构建基础图...")
            _populate_static_graph(builder, scan_result, parsed_files, repo_name)

        graph = builder.build()
        s = builder.stats

        stats = {
            **s,
            "duration_s": round(time.time() - t, 3),
        }
        logger.info(
            "  → %d 节点 / %d 边  node_types=%s",
            s["node_count"], s["edge_count"], s["node_types"],
        )
        return graph, stats

    # ------------------------------------------------------------------
    # Step 5: export_graph
    # ------------------------------------------------------------------

    def _step_export(
        self,
        graph: dict[str, Any],
        repo_name: str,
        scan_result: ScanResult,
    ) -> tuple[str, Path, dict[str, Any]]:
        """Step 5 — 将图谱写入 graph.json 并更新索引。"""
        logger.info("[5/5] export_graph: 持久化 graph.json...")
        t = time.time()

        graph_id   = _safe_filename(repo_name)
        output_path = self._output_dir / f"{graph_id}.json"

        # 包装为完整 graph.json 格式（含 meta）
        commit = getattr(scan_result, "git_commit", "") or ""
        payload = {
            "meta": {
                "graph_id":    graph_id,
                "repo_name":   repo_name,
                "node_count":  len(graph["nodes"]),
                "edge_count":  len(graph["edges"]),
                "git_commit":  commit,
                "pipeline":    "GraphPipeline",
                "created_at":  _utc_now(),
            },
            "nodes": graph["nodes"],
            "edges": graph["edges"],
        }

        output_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        # 更新 index.json
        _update_index(self._output_dir, graph_id, repo_name, payload["meta"])

        stats = {
            "graph_id":    graph_id,
            "output_path": str(output_path),
            "size_bytes":  output_path.stat().st_size,
            "duration_s":  round(time.time() - t, 3),
        }
        logger.info("  → 已写入: %s (%d bytes)", output_path, stats["size_bytes"])
        return graph_id, output_path, stats

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _get_llm(self) -> LLMClient:
        """懒加载 LLM 客户端。"""
        if self._llm is None:
            self._llm = get_default_client()
        return self._llm


# ---------------------------------------------------------------------------
# Prompt builder
# ---------------------------------------------------------------------------


def _build_file_prompt(
    pf: ParsedFile,
    repo_name: str,
    file_rel: str,
) -> tuple[str, str]:
    """为单个文件构建 (system_prompt, user_prompt) 元组。

    system_prompt 包含完整的输出格式规范。
    user_prompt 包含文件的结构化摘要（类/函数/调用/导入），
    不包含原始源码（避免超出 context window）。
    """
    system = (
        "You are a code analysis expert. Analyze the provided file summary "
        "and extract the code structure as a JSON graph.\n\n"
        "OUTPUT RULES:\n"
        "1. Return ONLY a valid JSON object. No prose. No markdown. No code fences.\n"
        "2. The JSON must match this exact schema:\n\n"
        '{\n'
        '  "nodes": [\n'
        '    {\n'
        '      "id":   "<type>:<qualified_name>",\n'
        '      "type": "<function|class|api|module|database|table>",\n'
        '      "file": "<relative file path>"\n'
        '    }\n'
        '  ],\n'
        '  "edges": [\n'
        '    {\n'
        '      "from": "<node id>",\n'
        '      "to":   "<node id>",\n'
        '      "type": "<contains|calls|imports|reads|writes>"\n'
        '    }\n'
        '  ]\n'
        '}\n\n'
        "Node id format:\n"
        '  function: "function:<module>.<name>"  e.g. "function:service.user.create"\n'
        '  class:    "class:<module>.<name>"     e.g. "class:service.UserService"\n'
        '  api:      "api:<METHOD>:<path>"       e.g. "api:POST:/users"\n'
        '  module:   "module:<path>"             e.g. "module:service/user"\n'
        '  table:    "table:<name>"              e.g. "table:users"\n\n'
        "Edge types:\n"
        "  contains — class contains method, module contains class/function\n"
        "  calls    — function calls another function\n"
        "  imports  — module imports another module\n"
        "  reads    — function reads from a table/database\n"
        "  writes   — function writes to a table/database\n\n"
        "Rules:\n"
        "- Only emit nodes and edges with clear evidence from the file summary.\n"
        "- Do not invent names — use exact names from the summary.\n"
        "- Emit contains edges from each class to its methods.\n"
        "- Emit calls edges only when a function explicitly calls another.\n"
        "- If no meaningful structure exists, return {\"nodes\": [], \"edges\": []}."
    )

    # 构建用户 prompt：文件结构化摘要
    lines: list[str] = [
        f"Repository: {repo_name}",
        f"File: {file_rel}",
        f"Language: {pf.language}",
        "",
    ]

    # 导入
    if pf.imports:
        lines.append("## Imports")
        for imp in pf.imports[:20]:
            lines.append(f"  import {imp.module}")
        lines.append("")

    # 类
    if pf.classes:
        lines.append("## Classes")
        for cls in pf.classes:
            bases = f"({', '.join(cls.base_classes)})" if cls.base_classes else ""
            lines.append(f"  class {cls.name}{bases}  [line {cls.line_start}]")
            for method in cls.methods[:15]:
                params = _format_params(method.parameters)
                lines.append(f"    def {method.name}({params})  [line {method.line_start}]")
                # 方法内调用
                for call in method.calls[:8]:
                    lines.append(f"      calls: {call.callee}")
        lines.append("")

    # 模块级函数
    if pf.functions:
        lines.append("## Functions")
        for fn in pf.functions[:20]:
            params = _format_params(fn.parameters)
            lines.append(f"  def {fn.name}({params})  [line {fn.line_start}]")
            for call in fn.calls[:8]:
                lines.append(f"    calls: {call.callee}")
        lines.append("")

    user = "\n".join(lines)

    # 截断保护
    if len(user) > _MAX_FILE_CONTEXT_CHARS:
        user = user[:_MAX_FILE_CONTEXT_CHARS] + "\n... (truncated)"

    return system, user


def _format_params(parameters: list[Any]) -> str:
    """将参数列表格式化为简短字符串。"""
    names = []
    for p in parameters[:6]:
        name = getattr(p, "name", str(p))
        if name not in ("self", "cls"):
            names.append(name)
    suffix = ", ..." if len(parameters) > 6 else ""
    return ", ".join(names) + suffix


# ---------------------------------------------------------------------------
# LLM call with retry
# ---------------------------------------------------------------------------


def _call_llm_with_retry(
    llm: LLMClient,
    system: str,
    user: str,
) -> str:
    """调用 LLM，失败时线性退避重试。返回原始文本；全部失败时返回空字符串。"""
    last_error: Optional[Exception] = None

    for attempt in range(_LLM_MAX_RETRIES + 1):
        try:
            text = llm.complete(user, system=system)
            return text or ""
        except Exception as exc:
            last_error = exc
            if attempt < _LLM_MAX_RETRIES:
                delay = _LLM_RETRY_DELAYS[min(attempt, len(_LLM_RETRY_DELAYS) - 1)]
                logger.debug(
                    "LLM 重试 %d/%d (%.1fs): %s",
                    attempt + 1, _LLM_MAX_RETRIES + 1, delay, exc,
                )
                time.sleep(delay)

    logger.warning("LLM 全部重试失败: %s", last_error)
    return ""


# ---------------------------------------------------------------------------
# JSON extraction
# ---------------------------------------------------------------------------


def _extract_json_graph(text: str) -> Optional[dict[str, Any]]:
    """从 LLM 响应文本中提取 {"nodes": [...], "edges": [...]} 字典。

    处理：Markdown 代码围栏、前后散文、嵌套大括号。
    返回 None 表示无法提取有效 JSON。
    """
    if len(text) > _MAX_RESPONSE_CHARS:
        text = text[:_MAX_RESPONSE_CHARS]

    # 1. 直接解析
    stripped = text.strip()
    parsed = _try_parse(stripped)
    if parsed is not None:
        return parsed

    # 2. 去除 markdown 代码围栏
    fence = re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", text, re.IGNORECASE)
    if fence:
        parsed = _try_parse(fence.group(1))
        if parsed is not None:
            return parsed

    # 3. 找最外层 { … }
    start = text.find("{")
    if start == -1:
        return None

    depth = 0
    for i, ch in enumerate(text[start:], start):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                parsed = _try_parse(text[start: i + 1])
                if parsed is not None:
                    return parsed
                break

    return None


def _try_parse(text: str) -> Optional[dict[str, Any]]:
    """尝试解析 JSON 字符串，返回含 nodes/edges 键的字典，否则返回 None。"""
    try:
        obj = json.loads(text.strip())
        if isinstance(obj, dict) and ("nodes" in obj or "edges" in obj):
            return obj
    except (json.JSONDecodeError, ValueError):
        pass
    return None


# ---------------------------------------------------------------------------
# Static graph population (fallback when AI is disabled / empty)
# ---------------------------------------------------------------------------


def _populate_static_graph(
    builder: CodeGraphBuilder,
    scan_result: ScanResult,
    parsed_files: list[ParsedFile],
    repo_name: str,
) -> None:
    """当 AI 分析未运行时，从静态解析结果构建基础图。

    生成节点：repository / module / file / class / function
    生成边：contains / calls / imports
    """
    from backend.graph.code_graph import CodeEdge, CodeNode

    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []

    # Repository 根节点
    repo_id = f"repository:{repo_name}"
    nodes.append({"id": repo_id, "type": "repository", "file": ""})

    # 已见模块集合（避免重复）
    seen_modules: set[str] = set()

    for pf in parsed_files:
        file_rel = _relative(pf.file_path, scan_result.repo_path)
        module_path = str(Path(file_rel).parent).replace("\\", "/")
        if module_path == ".":
            module_path = ""

        # Module 节点
        if module_path and module_path not in seen_modules:
            seen_modules.add(module_path)
            mod_id = f"module:{module_path}"
            nodes.append({"id": mod_id, "type": "module", "file": ""})
            edges.append({"from": repo_id, "to": mod_id, "type": "contains"})

        # File 节点
        file_id = f"file:{file_rel}"
        nodes.append({"id": file_id, "type": "file", "file": file_rel})
        if module_path:
            edges.append({"from": f"module:{module_path}", "to": file_id, "type": "contains"})
        else:
            edges.append({"from": repo_id, "to": file_id, "type": "contains"})

        # Import 边（file → module）
        for imp in pf.imports:
            imp_mod = imp.module.replace(".", "/").lstrip("/")
            if imp_mod:
                target_id = f"module:{imp_mod}"
                edges.append({"from": file_id, "to": target_id, "type": "imports"})

        # Class 节点
        for cls in pf.classes:
            cls_id = f"class:{module_path}.{cls.name}" if module_path else f"class:{cls.name}"
            nodes.append({
                "id":   cls_id,
                "type": "class",
                "file": file_rel,
            })
            edges.append({"from": file_id, "to": cls_id, "type": "contains"})

            # Method 节点
            for method in cls.methods:
                fn_id = f"function:{module_path}.{cls.name}.{method.name}" if module_path \
                    else f"function:{cls.name}.{method.name}"
                nodes.append({
                    "id":   fn_id,
                    "type": "function",
                    "file": file_rel,
                })
                edges.append({"from": cls_id, "to": fn_id, "type": "contains"})

        # Module-level Function 节点
        for fn in pf.functions:
            fn_id = f"function:{module_path}.{fn.name}" if module_path else f"function:{fn.name}"
            nodes.append({
                "id":   fn_id,
                "type": "function",
                "file": file_rel,
            })
            edges.append({"from": file_id, "to": fn_id, "type": "contains"})

    builder.add_graph({"nodes": nodes, "edges": edges})


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------


def _inject_file_field(
    graph: dict[str, Any],
    file_rel: str,
    language: str,
) -> None:
    """为图中每个缺少 file 字段的节点注入文件路径和语言信息（原地修改）。"""
    for node in graph.get("nodes", []):
        if isinstance(node, dict):
            if not node.get("file"):
                node["file"] = file_rel
            if not node.get("language"):
                node["language"] = language


def _relative(abs_path: str, base: Any) -> str:
    """将绝对路径转为相对于 base 的路径字符串。"""
    try:
        return str(Path(abs_path).relative_to(Path(str(base)))).replace("\\", "/")
    except ValueError:
        return abs_path


def _safe_filename(name: str) -> str:
    """将仓库名转为合法文件名（保留字母数字和 - _）。"""
    s = re.sub(r"[^\w\-]", "_", name.strip())
    return s[:80] or "graph"


def _utc_now() -> str:
    """返回当前 UTC 时间的 ISO 8601 字符串。"""
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def _update_index(
    storage_dir: Path,
    graph_id: str,
    repo_name: str,
    meta: dict[str, Any],
) -> None:
    """更新 index.json（与 GraphRepository 格式兼容）。"""
    index_path = storage_dir / "index.json"
    index: dict[str, Any] = {}
    if index_path.exists():
        try:
            index = json.loads(index_path.read_text(encoding="utf-8"))
        except Exception:
            pass

    index[graph_id] = {
        "graph_id":   graph_id,
        "repo_name":  repo_name,
        "node_count": meta.get("node_count", 0),
        "edge_count": meta.get("edge_count", 0),
        "created_at": meta.get("created_at", ""),
        "pipeline":   "GraphPipeline",
    }
    index_path.write_text(
        json.dumps(index, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


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
        description="GraphPipeline — 代码知识图谱分析（新版）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python -m backend.pipeline.graph_pipeline /path/to/repo
  python -m backend.pipeline.graph_pipeline . --enable-ai
  python -m backend.pipeline.graph_pipeline . --languages python typescript
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
        help="启用 AI 逐文件分析（需配置 LLM API Key）",
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
            enable_ai=args.enable_ai,
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
