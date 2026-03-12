"""
AI 架构分析器。

使用 LLM 识别代码仓库的架构模式（MVC / 分层 / 六边形 / Clean），
为已有节点生成架构层（Layer）归属关系。

输出节点：
    GraphNode(type=LAYER, name="BusinessLayer", properties={...})

输出边：
    GraphEdge(from_=existing_node_id, to=layer_node_id, type=BELONGS_TO)

降级策略（LLM 不可用时）：
    根据类名/函数名后缀规则推断所属层：
    Controller/Router/View → Presentation
    Service/Manager/Engine → Business
    Repository/DAO/Store   → Data
    Model/Entity/Schema    → Domain
    其余                   → Infrastructure
"""

from __future__ import annotations

import logging
import re
from typing import Any

from backend.analyzer.ai.ai_analyzer_base import AIAnalysisGraph, AIAnalyzerBase
from backend.graph.graph_schema import EdgeType, GraphEdge, GraphNode, NodeType
from backend.pipeline.repo_summary_builder import (
    APISummary,
    FunctionSummary,
    RepoSummary,
    ServiceSummary,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Heuristic layer rules
# ---------------------------------------------------------------------------

_PRESENTATION_HINTS: frozenset[str] = frozenset({
    "controller", "router", "view", "viewset", "handler",
    "endpoint", "resource", "blueprint", "api", "rest",
    "graphql", "grpc", "http",
})
_BUSINESS_HINTS: frozenset[str] = frozenset({
    "service", "manager", "engine", "orchestrator", "coordinator",
    "usecase", "interactor", "command", "query", "saga",
    "workflow", "processor", "executor",
})
_DATA_HINTS: frozenset[str] = frozenset({
    "repository", "repo", "dao", "store", "cache", "storage",
    "database", "db", "client", "gateway", "adapter", "mapper",
})
_DOMAIN_HINTS: frozenset[str] = frozenset({
    "model", "entity", "aggregate", "valueobject", "vo",
    "domain", "schema", "dto",
})

# name_fragment → (layer_name, layer_index)
_HEURISTIC_LAYERS: list[tuple[frozenset[str], str, int]] = [
    (_PRESENTATION_HINTS, "PresentationLayer", 0),
    (_BUSINESS_HINTS,     "BusinessLayer",     1),
    (_DATA_HINTS,         "DataLayer",         2),
    (_DOMAIN_HINTS,       "DomainLayer",       3),
]

# Static descriptions for each layer
_LAYER_DESCRIPTIONS: dict[str, str] = {
    "PresentationLayer": "HTTP/RPC interface layer — controllers, routers, endpoints",
    "BusinessLayer":     "Business logic layer — services, orchestrators, use-cases",
    "DataLayer":         "Data access layer — repositories, DAOs, caches, gateways",
    "DomainLayer":       "Domain model layer — entities, value objects, aggregates",
    "InfrastructureLayer": "Cross-cutting concerns — config, logging, utilities",
}


# ---------------------------------------------------------------------------
# Analyzer
# ---------------------------------------------------------------------------


class AIArchitectureAnalyzer(AIAnalyzerBase):
    """识别代码架构模式并生成 Layer 节点 + BELONGS_TO 边。

    用法::

        analyzer = AIArchitectureAnalyzer()
        graph = analyzer.analyze(summary)
        builder.merge_graph(graph)
    """

    # ------------------------------------------------------------------
    # Public
    # ------------------------------------------------------------------

    def analyze(self, summary: RepoSummary) -> AIAnalysisGraph:
        """执行架构分析。

        Args:
            summary: RepoSummaryBuilder 生成的仓库摘要。

        Returns:
            AIAnalysisGraph — Layer 节点 + BELONGS_TO 边。
        """
        if not self._use_llm:
            return self._fallback(summary)

        system, user = self._prompt_loader.render(
            "architecture",
            repo_name=summary.repo_name,
            languages=", ".join(summary.languages),
            modules=_format_modules(summary),
            apis=_format_apis(summary),
            services=_format_services(summary),
            functions=_format_functions(summary),
        )

        raw = self._call_llm_json(
            system, user, required_keys=["layers", "assignments"]
        )
        if not raw:
            logger.warning("%s: LLM returned no data, using fallback", self.analyzer_name)
            return self._fallback(summary)

        graph = self._build_from_llm(raw, summary)
        self._log_result(graph)
        return graph

    # ------------------------------------------------------------------
    # LLM response → graph
    # ------------------------------------------------------------------

    def _build_from_llm(
        self, raw: dict[str, Any], summary: RepoSummary
    ) -> AIAnalysisGraph:
        nodes: list[GraphNode] = []
        edges: list[GraphEdge] = []

        pattern = raw.get("pattern", "unknown")
        overall_conf = float(raw.get("overall_confidence", 0.7))

        # ── 1. Build Layer nodes ──────────────────────────────────────
        layer_name_to_node: dict[str, GraphNode] = {}
        for layer_data in raw.get("layers", []):
            if not isinstance(layer_data, dict):
                continue
            lname = str(layer_data.get("name", "")).strip()
            if not lname:
                continue
            desc = str(layer_data.get("description", ""))
            idx = int(layer_data.get("layer_index", 99))
            resps = layer_data.get("responsibilities", [])

            layer_node = self._make_node(
                NodeType.LAYER.value,
                lname,
                description=desc,
                layer_index=idx,
                pattern=pattern,
                responsibilities=resps if isinstance(resps, list) else [],
            )
            layer_name_to_node[lname] = layer_node
            nodes.append(layer_node)

        # ── 2. Build BELONGS_TO edges from assignments ────────────────
        # Build a lookup of name → id for all summary nodes
        name_to_id = _build_name_index(summary)

        for assignment in raw.get("assignments", []):
            if not isinstance(assignment, dict):
                continue
            node_name = str(assignment.get("node_name", "")).strip()
            layer_name = str(assignment.get("layer", "")).strip()
            confidence = float(assignment.get("confidence", 0.5))

            if confidence < 0.6:
                continue

            source_id = name_to_id.get(node_name)
            layer_node = layer_name_to_node.get(layer_name)
            if not source_id or not layer_node:
                continue

            edges.append(self._make_edge(
                source_id,
                layer_node.id,
                EdgeType.BELONGS_TO.value,
                confidence=confidence,
                pattern=pattern,
            ))

        return self._finalize(
            nodes, edges, overall_conf,
            pattern=pattern,
            layer_count=len(nodes),
            assignment_count=len(edges),
        )

    # ------------------------------------------------------------------
    # Fallback (heuristic)
    # ------------------------------------------------------------------

    def _fallback(self, summary: RepoSummary) -> AIAnalysisGraph:
        """基于名称关键字推断节点所属架构层。"""
        nodes: list[GraphNode] = []
        edges: list[GraphEdge] = []

        # Create Layer nodes once, on first use
        layer_nodes: dict[str, GraphNode] = {}

        def _get_or_create_layer(layer_name: str, layer_index: int) -> GraphNode:
            if layer_name not in layer_nodes:
                ln = self._make_node(
                    NodeType.LAYER.value,
                    layer_name,
                    node_id=f"layer:{layer_name.lower()}",
                    description=_LAYER_DESCRIPTIONS.get(layer_name, ""),
                    layer_index=layer_index,
                    pattern="heuristic",
                )
                layer_nodes[layer_name] = ln
                nodes.append(ln)
            return layer_nodes[layer_name]

        name_to_id = _build_name_index(summary)
        assigned_count = 0

        for name, node_id in name_to_id.items():
            layer_name, layer_index = _infer_layer(name)
            if layer_name is None:
                continue
            layer_node = _get_or_create_layer(layer_name, layer_index)
            edges.append(self._make_edge(
                node_id,
                layer_node.id,
                EdgeType.BELONGS_TO.value,
                confidence=0.6,
                inferred_by="heuristic",
            ))
            assigned_count += 1

        graph = self._finalize(
            nodes, edges,
            confidence=0.5 if assigned_count > 0 else 0.0,
            fallback=True,
            assigned_count=assigned_count,
        )
        self._log_result(graph)
        return graph


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _infer_layer(name: str) -> tuple[str | None, int]:
    """Infer architecture layer name and index from a node name."""
    name_lower = name.lower()
    for hints, layer_name, layer_index in _HEURISTIC_LAYERS:
        for hint in hints:
            if name_lower.endswith(hint) or hint in name_lower:
                return layer_name, layer_index
    return None, -1


def _build_name_index(summary: RepoSummary) -> dict[str, str]:
    """Build name → node_id lookup from all summary items that have IDs."""
    index: dict[str, str] = {}
    for fn in summary.functions:
        index[fn.name] = fn.id
    for api in summary.apis:
        index[api.name] = api.id
    for svc in summary.services:
        index[svc.name] = svc.id
    return index


def _format_modules(summary: RepoSummary) -> str:
    if not summary.modules:
        return "(none)"
    return "\n".join(
        f"- {m.name} ({m.language}): {m.node_count} nodes, path={m.path}"
        for m in summary.modules[:20]
    )


def _format_apis(summary: RepoSummary) -> str:
    if not summary.apis:
        return "(none)"
    return "\n".join(
        f"- [{a.method}] {a.path or a.name} (module: {a.module})"
        for a in summary.apis[:30]
    )


def _format_services(summary: RepoSummary) -> str:
    if not summary.services:
        return "(none)"
    return "\n".join(
        f"- {s.name}: {s.description}"
        for s in summary.services[:15]
    )


def _format_functions(summary: RepoSummary) -> str:
    if not summary.functions:
        return "(none)"
    return "\n".join(
        f"- {f.name}({f.signature}) [module: {f.module},"
        f" in={f.in_degree}, out={f.out_degree}]"
        for f in summary.functions[:30]
    )
