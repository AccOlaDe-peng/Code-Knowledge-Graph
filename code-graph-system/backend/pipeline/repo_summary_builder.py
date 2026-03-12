"""
仓库摘要构建器。

将 BuiltGraph（可能包含数千节点）压缩为结构化的 RepoSummary，
供 AI 分析器（AIArchitectureAnalyzer 等）共享使用，避免超出
LLM context window。

压缩策略：
    - 按 PageRank / 度指标选取关键函数（Top-N）
    - 调用图限制 BFS 深度（默认从高 PageRank 节点出发，广度 2 层）
    - 各类节点按重要性排序后截断
    - token 预算自适应：大仓库自动缩减 Top-N

典型用法::

    from backend.pipeline.repo_summary_builder import RepoSummaryBuilder

    builder = RepoSummaryBuilder()
    summary = builder.build_summary(built_graph)
    print(summary.to_prompt_text())          # 传给 AI 分析器
    print(f"~{summary.token_estimate} tokens")
"""

from __future__ import annotations

import dataclasses
import logging
from collections import defaultdict, deque
from typing import Any, Optional

from backend.graph.graph_builder import BuiltGraph
from backend.graph.graph_schema import EdgeType, GraphEdge, GraphNode, NodeType

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Budget & limit constants
# ---------------------------------------------------------------------------

# 默认 token 预算（粗估：4 chars ≈ 1 token）
DEFAULT_TOKEN_BUDGET: int = 8_000
CHARS_PER_TOKEN: int = 4

# 各部分默认 Top-N 上限
DEFAULT_LIMITS: dict[str, int] = {
    "modules":         20,   # 最多展示的模块数
    "services":        15,   # 最多展示的服务数
    "apis":            30,   # 最多展示的 API 端点数
    "functions":       40,   # 最多展示的关键函数数
    "call_samples":    60,   # 调用图采样边数
    "databases":       20,   # 最多展示的数据库/表数
    "events":          20,   # 最多展示的事件/Topic 数
    "tree_depth":       3,   # 目录树最大展示深度
    "tree_children":    8,   # 每层最多展示子节点数
    "table_per_db":    10,   # 每个 DB 最多展示的表数
    "pub_sub_per_ev":   5,   # 每个事件最多展示的 pub/sub 数
}

# 大仓库阈值：节点数超过此值时自动缩减 Top-N
_LARGE_REPO_THRESHOLD: int = 2_000


# ---------------------------------------------------------------------------
# Section dataclasses
# ---------------------------------------------------------------------------


@dataclasses.dataclass
class ModuleSummary:
    """模块摘要。"""
    name: str
    path: str
    language: str
    node_count: int    # 模块内子节点总数（classes + functions + etc.）
    file_count: int


@dataclasses.dataclass
class ServiceSummary:
    """服务摘要。"""
    id: str
    name: str
    description: str
    port: str


@dataclasses.dataclass
class APISummary:
    """API 端点摘要。"""
    id: str
    name: str
    module: str
    method: str    # GET / POST / PUT / DELETE / ""
    path: str      # URL path（如 /api/users）
    description: str


@dataclasses.dataclass
class FunctionSummary:
    """关键函数摘要。"""
    id: str
    name: str
    module: str
    signature: str    # 简化签名（仅参数名）
    pagerank: float
    in_degree: int
    out_degree: int
    language: str


@dataclasses.dataclass
class CallSample:
    """调用关系样本。"""
    caller: str           # 调用方函数名
    callee: str           # 被调用函数名
    caller_module: str    # 调用方所属模块
    callee_module: str    # 被调用方所属模块


@dataclasses.dataclass
class DatabaseSummary:
    """数据库摘要（含关联表列表）。"""
    id: str
    name: str
    db_type: str           # postgres / mysql / redis / mongo / ""
    tables: list[str]      # 关联 Table 节点名称列表


@dataclasses.dataclass
class EventSummary:
    """事件 / Topic 摘要。"""
    id: str
    name: str
    event_type: str        # kafka / rabbitmq / eventbus / ""
    publishers: list[str]  # 发布方名称
    subscribers: list[str] # 订阅方名称


@dataclasses.dataclass
class RepoTreeNode:
    """目录树节点（展示到限定深度）。"""
    name: str
    path: str
    node_type: str         # "module" | "directory"
    file_count: int
    children: list["RepoTreeNode"] = dataclasses.field(default_factory=list)


# ---------------------------------------------------------------------------
# Top-level summary
# ---------------------------------------------------------------------------


@dataclasses.dataclass
class RepoSummary:
    """AI 分析器共享的仓库压缩摘要。

    由 RepoSummaryBuilder.build_summary() 构建，
    可通过 to_prompt_text() 转换为 LLM prompt 字符串。
    """

    # 基本信息
    repo_name:     str
    repo_path:     str
    git_commit:    str
    languages:     list[str]
    total_files:   int
    total_nodes:   int
    total_edges:   int

    # 各类摘要（按 pipeline 顺序排列）
    repo_tree:          list[RepoTreeNode]
    modules:            list[ModuleSummary]
    services:           list[ServiceSummary]
    apis:               list[APISummary]
    functions:          list[FunctionSummary]
    call_graph_sample:  list[CallSample]
    databases:          list[DatabaseSummary]
    events:             list[EventSummary]

    # 元信息
    token_estimate: int           # 预估 prompt token 数（build 后填充）
    truncated:      bool          # 是否因 token 预算而截断
    limits_used:    dict[str, int] = dataclasses.field(default_factory=dict)

    # ------------------------------------------------------------------
    # Rendering
    # ------------------------------------------------------------------

    def to_prompt_text(self) -> str:
        """将摘要格式化为 LLM 可消费的 Markdown 风格纯文本。"""
        lines: list[str] = []

        # ── Header ────────────────────────────────────────────────────
        lines.append(f"# Repository: {self.repo_name}")
        lines.append(
            f"Languages: {', '.join(self.languages) or 'unknown'} | "
            f"Files: {self.total_files} | "
            f"Nodes: {self.total_nodes} | "
            f"Edges: {self.total_edges}"
        )
        if self.git_commit:
            lines.append(f"Git commit: {self.git_commit[:12]}")
        lines.append("")

        # ── Directory Structure ────────────────────────────────────────
        if self.repo_tree:
            lines.append("## Directory Structure")
            for node in self.repo_tree:
                lines.extend(_render_tree_node(node, indent=0))
            lines.append("")

        # ── Modules ───────────────────────────────────────────────────
        if self.modules:
            lines.append("## Modules")
            for m in self.modules:
                lines.append(
                    f"- {m.name} ({m.language})"
                    f" — {m.node_count} nodes, {m.file_count} files"
                    f" | path: {m.path}"
                )
            lines.append("")

        # ── Services ──────────────────────────────────────────────────
        if self.services:
            lines.append("## Services")
            for s in self.services:
                port_info = f" :{s.port}" if s.port else ""
                desc = f" — {s.description}" if s.description else ""
                lines.append(f"- {s.name}{port_info}{desc}")
            lines.append("")

        # ── API Endpoints ─────────────────────────────────────────────
        if self.apis:
            lines.append("## API Endpoints")
            for api in self.apis:
                method = f"[{api.method}] " if api.method else ""
                path_str = api.path if api.path else api.name
                lines.append(
                    f"- {method}{path_str}"
                    f" → {api.name}"
                    f" (module: {api.module})"
                )
                if api.description:
                    lines.append(f"  {api.description}")
            lines.append("")

        # ── Key Functions ─────────────────────────────────────────────
        if self.functions:
            lines.append("## Key Functions (ranked by importance)")
            for fn in self.functions:
                sig = f"({fn.signature})" if fn.signature else "()"
                lines.append(
                    f"- {fn.name}{sig}"
                    f" [module: {fn.module}"
                    f", in: {fn.in_degree}"
                    f", out: {fn.out_degree}"
                    f", pagerank: {fn.pagerank:.5f}]"
                )
            lines.append("")

        # ── Call Graph Sample ─────────────────────────────────────────
        if self.call_graph_sample:
            lines.append("## Call Graph Sample")
            for c in self.call_graph_sample:
                caller = (
                    f"{c.caller_module}.{c.caller}"
                    if c.caller_module
                    else c.caller
                )
                callee = (
                    f"{c.callee_module}.{c.callee}"
                    if c.callee_module
                    else c.callee
                )
                lines.append(f"- {caller} → {callee}")
            lines.append("")

        # ── Databases & Tables ────────────────────────────────────────
        if self.databases:
            lines.append("## Databases & Tables")
            for db in self.databases:
                if db.tables:
                    tables_str = ", ".join(db.tables[:10])
                    if len(db.tables) > 10:
                        tables_str += f" ... (+{len(db.tables) - 10} more)"
                    lines.append(f"- {db.name} ({db.db_type}): {tables_str}")
                else:
                    lines.append(f"- {db.name} ({db.db_type})")
            lines.append("")

        # ── Events & Topics ───────────────────────────────────────────
        if self.events:
            lines.append("## Events & Topics")
            for ev in self.events:
                type_str = f" ({ev.event_type})" if ev.event_type else ""
                lines.append(f"- {ev.name}{type_str}")
                if ev.publishers:
                    lines.append(f"  publishers: {', '.join(ev.publishers)}")
                if ev.subscribers:
                    lines.append(f"  subscribers: {', '.join(ev.subscribers)}")
            lines.append("")

        return "\n".join(lines)

    def to_dict(self) -> dict[str, Any]:
        """序列化为普通字典（供缓存/日志使用）。"""
        return dataclasses.asdict(self)


# ---------------------------------------------------------------------------
# Builder
# ---------------------------------------------------------------------------


class RepoSummaryBuilder:
    """将 BuiltGraph 压缩为 RepoSummary。

    Args:
        token_budget: AI prompt 的目标 token 上限（默认 8000）。
                      超出时 truncated=True，各 Top-N 会自动缩减。
        limits:       覆盖部分默认 Top-N 上限（合并，非替换）。

    示例::

        builder = RepoSummaryBuilder(token_budget=6000)
        summary = builder.build_summary(built)
        prompt_text = summary.to_prompt_text()
    """

    def __init__(
        self,
        token_budget: int = DEFAULT_TOKEN_BUDGET,
        limits: Optional[dict[str, int]] = None,
    ) -> None:
        self._budget = token_budget
        self._base_limits: dict[str, int] = {**DEFAULT_LIMITS, **(limits or {})}

    # ------------------------------------------------------------------
    # Public
    # ------------------------------------------------------------------

    def build_summary(self, built: BuiltGraph) -> RepoSummary:
        """从 BuiltGraph 构建 RepoSummary。

        Args:
            built: ``GraphBuilder.build()`` 的输出。

        Returns:
            RepoSummary — 结构化摘要，可通过 ``to_prompt_text()`` 转为
            LLM prompt。
        """
        # ── 建立内部索引 ───────────────────────────────────────────────
        nodes_by_id: dict[str, GraphNode] = {n.id: n for n in built.nodes}
        nodes_by_type: dict[str, list[GraphNode]] = _group_by_type(built.nodes)
        edges_by_from: dict[str, list[GraphEdge]] = _group_edges_by_from(built.edges)
        edges_by_to: dict[str, list[GraphEdge]] = _group_edges_by_to(built.edges)
        metrics: dict[str, dict[str, float]] = built.metrics or {}

        # ── 动态调整 limits（大仓库自动缩减）──────────────────────────
        limits = self._adapt_limits(built)

        # ── 提取各部分 ─────────────────────────────────────────────────
        repo_node = _find_repo_node(nodes_by_type)
        repo_name = (
            (repo_node.name if repo_node else None)
            or built.meta.get("repo_name", "unknown")
        )
        repo_path = (repo_node.properties.get("path", "") if repo_node else "")
        git_commit = built.meta.get("git_commit", "")

        languages = _extract_languages(built, nodes_by_type)

        repo_tree = self._build_repo_tree(
            nodes_by_type, edges_by_from, limits
        )
        modules = self._extract_modules(
            nodes_by_type, edges_by_from, metrics, limits
        )
        services = self._extract_services(nodes_by_type, limits)
        apis = self._extract_apis(
            nodes_by_type, edges_by_from, nodes_by_id, limits
        )
        functions = self._extract_functions(
            nodes_by_type, metrics, nodes_by_id, edges_by_from, limits
        )
        call_samples = self._extract_call_graph(
            built.edges, nodes_by_id, metrics, limits
        )
        databases = self._extract_databases(
            nodes_by_type, edges_by_to, nodes_by_id, limits
        )
        events = self._extract_events(
            nodes_by_type, built.edges, nodes_by_id, limits
        )

        file_count = (
            built.meta.get("node_type_counts", {}).get(NodeType.FILE.value, 0)
            or len(nodes_by_type.get(NodeType.FILE.value, []))
        )

        summary = RepoSummary(
            repo_name=repo_name,
            repo_path=repo_path,
            git_commit=git_commit,
            languages=languages,
            total_files=file_count,
            total_nodes=built.node_count,
            total_edges=built.edge_count,
            repo_tree=repo_tree,
            modules=modules,
            services=services,
            apis=apis,
            functions=functions,
            call_graph_sample=call_samples,
            databases=databases,
            events=events,
            token_estimate=0,
            truncated=False,
            limits_used=limits,
        )

        # ── 估算 token 数并标记是否超出预算 ───────────────────────────
        text = summary.to_prompt_text()
        token_est = max(1, len(text) // CHARS_PER_TOKEN)
        summary.token_estimate = token_est
        summary.truncated = token_est > self._budget

        logger.info(
            "RepoSummary 构建完成: modules=%d apis=%d functions=%d "
            "call_samples=%d databases=%d events=%d ~%d tokens%s",
            len(modules),
            len(apis),
            len(functions),
            len(call_samples),
            len(databases),
            len(events),
            token_est,
            " [TRUNCATED]" if summary.truncated else "",
        )
        return summary

    # ------------------------------------------------------------------
    # Private – per-section extractors
    # ------------------------------------------------------------------

    def _adapt_limits(self, built: BuiltGraph) -> dict[str, int]:
        """根据图规模动态缩减 Top-N 上限。"""
        limits = dict(self._base_limits)
        n = built.node_count
        if n > _LARGE_REPO_THRESHOLD * 5:         # > 10 000 节点
            scale = 0.4
        elif n > _LARGE_REPO_THRESHOLD * 2:       # > 4 000 节点
            scale = 0.6
        elif n > _LARGE_REPO_THRESHOLD:           # > 2 000 节点
            scale = 0.8
        else:
            scale = 1.0

        if scale < 1.0:
            for key in ("modules", "services", "apis", "functions",
                        "call_samples", "databases", "events"):
                limits[key] = max(5, int(limits[key] * scale))
            logger.debug(
                "大仓库 (%d 节点)：Top-N 缩减至 %.0f%%", n, scale * 100
            )
        return limits

    # ── Repo Tree ──────────────────────────────────────────────────────

    def _build_repo_tree(
        self,
        nodes_by_type: dict[str, list[GraphNode]],
        edges_by_from: dict[str, list[GraphEdge]],
        limits: dict[str, int],
    ) -> list[RepoTreeNode]:
        """构建目录树（基于 MODULE 节点的路径层级）。"""
        modules = nodes_by_type.get(NodeType.MODULE.value, [])
        if not modules:
            return []

        max_depth = limits["tree_depth"]
        max_children = limits["tree_children"]

        # 按路径深度排序，shallow first
        def _depth(n: GraphNode) -> int:
            p = n.properties.get("path", n.name)
            return p.count("/") + p.count("\\")

        modules_sorted = sorted(modules, key=_depth)

        # 构建 path → node 索引（取路径最短的前 N 个作为树根）
        root_nodes: list[RepoTreeNode] = []
        seen_paths: set[str] = set()

        for mod in modules_sorted:
            mod_path = mod.properties.get("path", mod.name)
            depth = _depth(mod)
            if depth >= max_depth:
                continue
            if mod_path in seen_paths:
                continue
            seen_paths.add(mod_path)

            # 统计该模块的直接子节点（CONTAINS 边）
            child_edges = [
                e for e in edges_by_from.get(mod.id, [])
                if e.type == EdgeType.CONTAINS.value
            ]
            file_edges = [
                e for e in child_edges
                # 只统计 FILE 类型子节点
            ]

            tree_node = RepoTreeNode(
                name=mod.name,
                path=mod_path,
                node_type="module",
                file_count=len(file_edges),
            )

            if depth == 0:
                root_nodes.append(tree_node)

            if len(root_nodes) >= max_children:
                break

        return root_nodes[:max_children]

    # ── Modules ────────────────────────────────────────────────────────

    def _extract_modules(
        self,
        nodes_by_type: dict[str, list[GraphNode]],
        edges_by_from: dict[str, list[GraphEdge]],
        metrics: dict[str, dict[str, float]],
        limits: dict[str, int],
    ) -> list[ModuleSummary]:
        """提取顶层模块摘要，按内部节点数量排序。"""
        raw = nodes_by_type.get(NodeType.MODULE.value, [])
        if not raw:
            return []

        results: list[tuple[int, ModuleSummary]] = []
        for mod in raw:
            child_count = sum(
                1
                for e in edges_by_from.get(mod.id, [])
                if e.type == EdgeType.CONTAINS.value
            )
            # 仅统计直接 FILE 子节点作为 file_count
            file_count = sum(
                1
                for e in edges_by_from.get(mod.id, [])
                if e.type == EdgeType.CONTAINS.value
            )
            ms = ModuleSummary(
                name=mod.name,
                path=mod.properties.get("path", mod.name),
                language=mod.properties.get("language", ""),
                node_count=child_count,
                file_count=file_count,
            )
            results.append((child_count, ms))

        results.sort(key=lambda x: x[0], reverse=True)
        return [ms for _, ms in results[: limits["modules"]]]

    # ── Services ──────────────────────────────────────────────────────

    def _extract_services(
        self,
        nodes_by_type: dict[str, list[GraphNode]],
        limits: dict[str, int],
    ) -> list[ServiceSummary]:
        """提取 SERVICE 节点。"""
        raw = nodes_by_type.get(NodeType.SERVICE.value, [])
        result: list[ServiceSummary] = []
        for svc in raw[: limits["services"]]:
            p = svc.properties
            result.append(
                ServiceSummary(
                    id=svc.id,
                    name=svc.name,
                    description=str(p.get("description", p.get("role", ""))),
                    port=str(p.get("port", p.get("ports", ""))),
                )
            )
        return result

    # ── APIs ──────────────────────────────────────────────────────────

    def _extract_apis(
        self,
        nodes_by_type: dict[str, list[GraphNode]],
        edges_by_from: dict[str, list[GraphEdge]],
        nodes_by_id: dict[str, GraphNode],
        limits: dict[str, int],
    ) -> list[APISummary]:
        """提取 API 节点，补全 HTTP method / path 信息。"""
        raw = nodes_by_type.get(NodeType.API.value, [])
        result: list[APISummary] = []
        for api in raw[: limits["apis"]]:
            p = api.properties
            # 推断所属模块（via DEFINES / CONTAINS 入边）
            module_name = p.get("module", p.get("file", ""))
            result.append(
                APISummary(
                    id=api.id,
                    name=api.name,
                    module=module_name,
                    method=str(p.get("method", p.get("http_method", ""))).upper(),
                    path=str(p.get("path", p.get("endpoint", p.get("route", "")))),
                    description=str(p.get("description", p.get("docstring", ""))),
                )
            )
        return result

    # ── Functions ─────────────────────────────────────────────────────

    def _extract_functions(
        self,
        nodes_by_type: dict[str, list[GraphNode]],
        metrics: dict[str, dict[str, float]],
        nodes_by_id: dict[str, GraphNode],
        edges_by_from: dict[str, list[GraphEdge]],
        limits: dict[str, int],
    ) -> list[FunctionSummary]:
        """提取最重要的函数节点（PageRank 优先，fallback in_degree）。"""
        raw = nodes_by_type.get(NodeType.FUNCTION.value, [])
        if not raw:
            return []

        def _score(node: GraphNode) -> float:
            m = metrics.get(node.id, {})
            # 综合评分：PageRank 权重高，in_degree 作为补充
            pr = float(m.get("pagerank", 0.0))
            ind = int(m.get("in_degree", 0))
            outd = int(m.get("out_degree", 0))
            return pr * 1000 + ind * 2 + outd

        ranked = sorted(raw, key=_score, reverse=True)
        result: list[FunctionSummary] = []

        for fn in ranked[: limits["functions"]]:
            m = metrics.get(fn.id, {})
            p = fn.properties
            # 简化签名：只取参数名，不要类型注解
            params = p.get("parameters", p.get("params", p.get("args", "")))
            sig = _simplify_signature(params)
            module_name = p.get("module", p.get("file", ""))

            result.append(
                FunctionSummary(
                    id=fn.id,
                    name=fn.name,
                    module=module_name,
                    signature=sig,
                    pagerank=round(float(m.get("pagerank", 0.0)), 6),
                    in_degree=int(m.get("in_degree", 0)),
                    out_degree=int(m.get("out_degree", 0)),
                    language=p.get("language", ""),
                )
            )
        return result

    # ── Call Graph ────────────────────────────────────────────────────

    def _extract_call_graph(
        self,
        all_edges: list[GraphEdge],
        nodes_by_id: dict[str, GraphNode],
        metrics: dict[str, dict[str, float]],
        limits: dict[str, int],
    ) -> list[CallSample]:
        """从 CALLS 边中采样最有价值的调用关系。

        选取策略：优先保留被调用方（callee）PageRank 较高的调用边，
        同时限制同一 callee 最多出现 3 次（避免热点函数主导）。
        """
        call_edges = [
            e for e in all_edges if e.type == EdgeType.CALLS.value
        ]
        if not call_edges:
            return []

        # 按 callee PageRank 排序
        def _callee_score(edge: GraphEdge) -> float:
            m = metrics.get(edge.to, {})
            return float(m.get("pagerank", 0.0)) * 1000 + float(
                m.get("in_degree", 0)
            )

        call_edges_sorted = sorted(call_edges, key=_callee_score, reverse=True)

        result: list[CallSample] = []
        callee_count: dict[str, int] = defaultdict(int)
        max_per_callee = 3

        for edge in call_edges_sorted:
            if len(result) >= limits["call_samples"]:
                break
            callee_id = edge.to
            if callee_count[callee_id] >= max_per_callee:
                continue

            caller_node = nodes_by_id.get(edge.from_)
            callee_node = nodes_by_id.get(callee_id)
            if caller_node is None or callee_node is None:
                continue

            result.append(
                CallSample(
                    caller=caller_node.name,
                    callee=callee_node.name,
                    caller_module=_node_module(caller_node),
                    callee_module=_node_module(callee_node),
                )
            )
            callee_count[callee_id] += 1

        return result

    # ── Databases ─────────────────────────────────────────────────────

    def _extract_databases(
        self,
        nodes_by_type: dict[str, list[GraphNode]],
        edges_by_to: dict[str, list[GraphEdge]],
        nodes_by_id: dict[str, GraphNode],
        limits: dict[str, int],
    ) -> list[DatabaseSummary]:
        """提取 DATABASE 节点，并关联同名 TABLE 节点。"""
        db_nodes = nodes_by_type.get(NodeType.DATABASE.value, [])
        table_nodes = nodes_by_type.get(NodeType.TABLE.value, [])

        # 构建 db_name → table_names 映射
        # 优先使用 TABLE 节点上记录的 database 属性，其次按名称前缀匹配
        db_to_tables: dict[str, list[str]] = defaultdict(list)
        for tbl in table_nodes:
            db_ref = tbl.properties.get("database", tbl.properties.get("db", ""))
            if db_ref:
                db_to_tables[db_ref].append(tbl.name)

        result: list[DatabaseSummary] = []
        seen_db_names: set[str] = set()

        # 已有 DATABASE 节点
        for db in db_nodes[: limits["databases"]]:
            p = db.properties
            db_name = db.name
            seen_db_names.add(db_name)

            tables = db_to_tables.get(db_name, db_to_tables.get(db.id, []))
            result.append(
                DatabaseSummary(
                    id=db.id,
                    name=db_name,
                    db_type=str(p.get("db_type", p.get("type", p.get("technology", "")))),
                    tables=tables[: limits["table_per_db"]],
                )
            )

        # 若没有 DATABASE 节点但有 TABLE 节点，从 TABLE 反推 DB
        if not result and table_nodes:
            synthetic_dbs: dict[str, list[str]] = defaultdict(list)
            for tbl in table_nodes:
                db_ref = tbl.properties.get(
                    "database", tbl.properties.get("db", "default")
                )
                synthetic_dbs[db_ref].append(tbl.name)

            for db_name, tables in list(synthetic_dbs.items())[
                : limits["databases"]
            ]:
                result.append(
                    DatabaseSummary(
                        id=f"synthetic:{db_name}",
                        name=db_name,
                        db_type="",
                        tables=tables[: limits["table_per_db"]],
                    )
                )

        return result

    # ── Events ────────────────────────────────────────────────────────

    def _extract_events(
        self,
        nodes_by_type: dict[str, list[GraphNode]],
        all_edges: list[GraphEdge],
        nodes_by_id: dict[str, GraphNode],
        limits: dict[str, int],
    ) -> list[EventSummary]:
        """提取 EVENT / TOPIC 节点，并关联发布方与订阅方。"""
        event_nodes = (
            nodes_by_type.get(NodeType.EVENT.value, [])
            + nodes_by_type.get(NodeType.TOPIC.value, [])
        )
        if not event_nodes:
            return []

        # 建立 event_id → publishers / subscribers 映射
        publishers: dict[str, list[str]] = defaultdict(list)
        subscribers: dict[str, list[str]] = defaultdict(list)

        for edge in all_edges:
            if edge.type == EdgeType.PUBLISHES.value:
                # from_ publishes to event
                pub_node = nodes_by_id.get(edge.from_)
                if pub_node:
                    publishers[edge.to].append(pub_node.name)
            elif edge.type == EdgeType.SUBSCRIBES.value:
                # from_ subscribes to event
                sub_node = nodes_by_id.get(edge.from_)
                if sub_node:
                    subscribers[edge.to].append(sub_node.name)
            elif edge.type == EdgeType.PRODUCES.value:
                # from_ produces event
                prod_node = nodes_by_id.get(edge.from_)
                if prod_node:
                    publishers[edge.to].append(prod_node.name)
            elif edge.type == EdgeType.CONSUMES.value:
                # from_ consumes event
                cons_node = nodes_by_id.get(edge.from_)
                if cons_node:
                    subscribers[edge.to].append(cons_node.name)

        result: list[EventSummary] = []
        max_ps = limits["pub_sub_per_ev"]

        for ev in event_nodes[: limits["events"]]:
            p = ev.properties
            result.append(
                EventSummary(
                    id=ev.id,
                    name=ev.name,
                    event_type=str(
                        p.get("event_type", p.get("broker", p.get("type", "")))
                    ),
                    publishers=publishers.get(ev.id, [])[:max_ps],
                    subscribers=subscribers.get(ev.id, [])[:max_ps],
                )
            )

        return result


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _group_by_type(nodes: list[GraphNode]) -> dict[str, list[GraphNode]]:
    """按 node.type 分组节点。"""
    groups: dict[str, list[GraphNode]] = defaultdict(list)
    for n in nodes:
        groups[n.type].append(n)
    return dict(groups)


def _group_edges_by_from(edges: list[GraphEdge]) -> dict[str, list[GraphEdge]]:
    """按 edge.from_ 分组边。"""
    groups: dict[str, list[GraphEdge]] = defaultdict(list)
    for e in edges:
        groups[e.from_].append(e)
    return dict(groups)


def _group_edges_by_to(edges: list[GraphEdge]) -> dict[str, list[GraphEdge]]:
    """按 edge.to 分组边。"""
    groups: dict[str, list[GraphEdge]] = defaultdict(list)
    for e in edges:
        groups[e.to].append(e)
    return dict(groups)


def _find_repo_node(
    nodes_by_type: dict[str, list[GraphNode]],
) -> Optional[GraphNode]:
    """返回 REPOSITORY 类型节点（通常只有一个）。"""
    repos = nodes_by_type.get(NodeType.REPOSITORY.value, [])
    return repos[0] if repos else None


def _extract_languages(
    built: BuiltGraph,
    nodes_by_type: dict[str, list[GraphNode]],
) -> list[str]:
    """从 meta 或节点属性中提取使用的语言列表。"""
    # 优先从 meta 读取（scan step 会写入 language_stats）
    meta_langs: Any = built.meta.get(
        "languages", built.meta.get("language_stats", {})
    )
    if isinstance(meta_langs, dict) and meta_langs:
        return sorted(meta_langs.keys())
    if isinstance(meta_langs, list) and meta_langs:
        return sorted(meta_langs)

    # Fallback：从节点属性推断
    lang_set: set[str] = set()
    for type_key in (NodeType.FUNCTION.value, NodeType.CLASS.value, NodeType.FILE.value):
        for node in nodes_by_type.get(type_key, []):
            lang = node.properties.get("language", "")
            if lang:
                lang_set.add(lang)
    return sorted(lang_set) or ["unknown"]


def _node_module(node: GraphNode) -> str:
    """从节点 properties 中提取所属模块名。"""
    p = node.properties
    return str(
        p.get("module", p.get("package", p.get("namespace", p.get("file", ""))))
    )


def _simplify_signature(params: Any) -> str:
    """将参数信息简化为仅含参数名的字符串（去除类型注解和默认值）。

    输入可能是：
        - 字符串 "self, user_id: int, name: str = ''"
        - 列表   ["self", "user_id", "name"]
        - None / ""
    """
    if not params:
        return ""
    if isinstance(params, list):
        names = [str(p).split(":")[0].split("=")[0].strip() for p in params]
        return ", ".join(n for n in names if n and n != "self")
    if isinstance(params, str):
        parts = params.split(",")
        names = [p.split(":")[0].split("=")[0].strip() for p in parts]
        return ", ".join(n for n in names if n and n not in ("self", "cls"))
    return str(params)[:60]


def _render_tree_node(node: RepoTreeNode, indent: int) -> list[str]:
    """递归渲染目录树节点为文本行。"""
    prefix = "  " * indent + ("└─ " if indent > 0 else "")
    lines = [f"{prefix}{node.name}/ ({node.file_count} files)"]
    for child in node.children:
        lines.extend(_render_tree_node(child, indent + 1))
    return lines
