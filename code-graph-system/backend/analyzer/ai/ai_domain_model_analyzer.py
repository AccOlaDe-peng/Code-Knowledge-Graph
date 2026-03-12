"""
AI 领域模型分析器。

使用 LLM 从代码结构中识别 DDD（领域驱动设计）概念：
    - 有界上下文（Bounded Context）
    - 聚合根（Aggregate Root）
    - 实体（Entity）
    - 值对象（Value Object）
    - 领域服务（Domain Service）
    - 领域事件（Domain Event）

输出节点：
    GraphNode(type=DOMAIN_ENTITY, name="Order", properties={entity_type="aggregate_root", ...})

输出边：
    PART_OF    — domain_entity → domain_entity (entity belongs to aggregate)
    BELONGS_TO — class/function → domain_entity (source code maps to entity)

降级策略：
    按类名后缀/关键词推断：
        *Repository / *Store / *DAO → 跳过（非领域对象）
        *Service / *Manager          → domain_service
        *Event / *Message            → domain_event
        *VO / *ValueObject / *Dto    → value_object
        其余含 id 字段迹象的类       → entity
"""

from __future__ import annotations

import logging
import re
from typing import Any

from backend.analyzer.ai.ai_analyzer_base import AIAnalysisGraph, AIAnalyzerBase
from backend.graph.graph_schema import EdgeType, GraphEdge, GraphNode, NodeType
from backend.pipeline.repo_summary_builder import RepoSummary

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Heuristic keyword sets for fallback
# ---------------------------------------------------------------------------

_SKIP_SUFFIXES: frozenset[str] = frozenset({
    "repository", "repo", "dao", "store", "cache", "storage",
    "controller", "router", "view", "handler", "endpoint",
    "config", "configuration", "settings", "util", "utils",
    "helper", "mixin", "middleware", "serializer", "validator",
    "test", "mock", "stub", "fixture",
})

_DOMAIN_SERVICE_HINTS: frozenset[str] = frozenset({
    "service", "manager", "engine", "calculator", "processor",
    "orchestrator", "coordinator", "factory", "builder",
})

_DOMAIN_EVENT_HINTS: frozenset[str] = frozenset({
    "event", "message", "notification", "command", "query",
    "request", "response", "payload", "envelope",
})

_VALUE_OBJECT_HINTS: frozenset[str] = frozenset({
    "vo", "valueobject", "value_object", "dto", "record",
    "address", "money", "email", "phone", "amount", "price",
    "quantity", "range", "period", "coordinate", "location",
})


def _infer_entity_type(class_name: str) -> str | None:
    """Infer DDD entity type from class name; returns None to skip."""
    name_lower = class_name.lower()

    # Skip infrastructure / framework classes
    for skip in _SKIP_SUFFIXES:
        if name_lower.endswith(skip) or name_lower.startswith(skip):
            return None

    for hint in _VALUE_OBJECT_HINTS:
        if hint in name_lower:
            return "value_object"

    for hint in _DOMAIN_EVENT_HINTS:
        if name_lower.endswith(hint) or name_lower.startswith(hint):
            return "domain_event"

    for hint in _DOMAIN_SERVICE_HINTS:
        if name_lower.endswith(hint) or name_lower.startswith(hint):
            return "domain_service"

    return "entity"  # default for unclassified classes


# ---------------------------------------------------------------------------
# Analyzer
# ---------------------------------------------------------------------------


class AIDomainModelAnalyzer(AIAnalyzerBase):
    """识别 DDD 领域模型，生成 DomainEntity 节点 + PART_OF / BELONGS_TO 边。

    用法::

        analyzer = AIDomainModelAnalyzer()
        graph = analyzer.analyze(summary)
        builder.merge_graph(graph)
    """

    # ------------------------------------------------------------------
    # Public
    # ------------------------------------------------------------------

    def analyze(self, summary: RepoSummary) -> AIAnalysisGraph:
        if not self._use_llm:
            return self._fallback(summary)

        system, user = self._prompt_loader.render(
            "domain_model",
            repo_name=summary.repo_name,
            languages=", ".join(summary.languages),
            modules=_fmt_modules(summary),
            classes_and_functions=_fmt_classes_and_functions(summary),
            apis=_fmt_apis(summary),
            databases=_fmt_databases(summary),
            events=_fmt_events(summary),
        )

        raw = self._call_llm_json(system, user, required_keys=["entities"])
        if not raw:
            logger.warning(
                "%s: LLM returned no data, using fallback", self.analyzer_name
            )
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
        overall_conf = float(raw.get("overall_confidence", 0.65))

        # Build context lookup
        context_name_to_id: dict[str, str] = {}

        # ── 1. Bounded context nodes ──────────────────────────────────
        for ctx in raw.get("bounded_contexts", []):
            if not isinstance(ctx, dict):
                continue
            ctx_name = str(ctx.get("name", "")).strip()
            if not ctx_name:
                continue
            confidence = float(ctx.get("confidence", 0.5))
            if confidence < 0.4:
                continue

            ctx_id = f"domain_context:{_slugify(ctx_name)}"
            ctx_node = self._make_node(
                NodeType.DOMAIN_ENTITY.value,
                ctx_name,
                node_id=ctx_id,
                entity_type="bounded_context",
                description=str(ctx.get("description", "")),
                confidence=confidence,
            )
            context_name_to_id[ctx_name] = ctx_id
            nodes.append(ctx_node)

        # ── 2. Domain entity nodes ─────────────────────────────────────
        entity_name_to_id: dict[str, str] = {}
        class_name_to_id = {fn.name: fn.id for fn in summary.functions}
        # Also include module names as potential source classes
        for api in summary.apis:
            class_name_to_id[api.name] = api.id

        for ent in raw.get("entities", []):
            if not isinstance(ent, dict):
                continue
            ent_name = str(ent.get("name", "")).strip()
            if not ent_name:
                continue
            confidence = float(ent.get("confidence", 0.5))
            if confidence < 0.4:
                continue

            entity_type = str(ent.get("entity_type", "entity"))
            bounded_context = str(ent.get("bounded_context", ""))
            attributes = ent.get("attributes", [])
            source_class = str(ent.get("source_class", "")).strip()
            description = str(ent.get("description", ""))

            node_id = f"domain_entity:{_slugify(ent_name)}"
            ent_node = self._make_node(
                NodeType.DOMAIN_ENTITY.value,
                ent_name,
                node_id=node_id,
                entity_type=entity_type,
                bounded_context=bounded_context,
                attributes=attributes if isinstance(attributes, list) else [],
                description=description,
                source_class=source_class,
                confidence=confidence,
            )
            entity_name_to_id[ent_name] = node_id
            nodes.append(ent_node)

            # PART_OF edge: entity → bounded context
            if bounded_context and bounded_context in context_name_to_id:
                edges.append(self._make_edge(
                    node_id,
                    context_name_to_id[bounded_context],
                    EdgeType.PART_OF.value,
                    confidence=confidence,
                ))

            # BELONGS_TO edge: source class → domain entity (code mapping)
            if source_class and source_class in class_name_to_id:
                edges.append(self._make_edge(
                    class_name_to_id[source_class],
                    node_id,
                    EdgeType.BELONGS_TO.value,
                    confidence=confidence,
                    mapping="source_to_domain",
                ))

        # ── 3. Relationship edges ──────────────────────────────────────
        rel_type_map = {
            "contains":       EdgeType.PART_OF.value,
            "references":     EdgeType.DEPENDS_ON.value,
            "inherits":       EdgeType.IMPLEMENTS.value,
            "implements":     EdgeType.IMPLEMENTS.value,
            "associated_with": EdgeType.DEPENDS_ON.value,
        }

        for rel in raw.get("relationships", []):
            if not isinstance(rel, dict):
                continue
            from_name = str(rel.get("from_entity", "")).strip()
            to_name = str(rel.get("to_entity", "")).strip()
            rel_type_str = str(rel.get("relation_type", "")).strip()
            confidence = float(rel.get("confidence", 0.5))

            if not from_name or not to_name or confidence < 0.5:
                continue

            from_id = entity_name_to_id.get(from_name)
            to_id = entity_name_to_id.get(to_name)
            if not from_id or not to_id or from_id == to_id:
                continue

            edge_type = rel_type_map.get(rel_type_str, EdgeType.DEPENDS_ON.value)
            edges.append(self._make_edge(
                from_id, to_id, edge_type,
                relation_type=rel_type_str,
                multiplicity=str(rel.get("multiplicity", "")),
                description=str(rel.get("description", "")),
                confidence=confidence,
            ))

        return self._finalize(
            nodes, edges, overall_conf,
            bounded_contexts=len(context_name_to_id),
            entities=len(entity_name_to_id),
        )

    # ------------------------------------------------------------------
    # Fallback (heuristic)
    # ------------------------------------------------------------------

    def _fallback(self, summary: RepoSummary) -> AIAnalysisGraph:
        """Keyword-based domain entity inference from function/class names."""
        nodes: list[GraphNode] = []
        edges: list[GraphEdge] = []

        # Use functions that look like domain classes (have CamelCase names)
        for fn in summary.functions:
            # Only process names that look like class names (CamelCase)
            if not _is_camel_case(fn.name):
                continue

            entity_type = _infer_entity_type(fn.name)
            if entity_type is None:
                continue

            node_id = f"domain_entity:{_slugify(fn.name)}"
            ent_node = self._make_node(
                NodeType.DOMAIN_ENTITY.value,
                fn.name,
                node_id=node_id,
                entity_type=entity_type,
                source="heuristic",
                confidence=0.35,
            )
            nodes.append(ent_node)

            # Link source function to domain entity
            if fn.id != node_id:
                edges.append(self._make_edge(
                    fn.id,
                    node_id,
                    EdgeType.BELONGS_TO.value,
                    confidence=0.35,
                    inferred_by="heuristic",
                ))

        graph = self._finalize(
            nodes, edges,
            confidence=0.3 if nodes else 0.0,
            fallback=True,
        )
        self._log_result(graph)
        return graph


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _slugify(name: str) -> str:
    """Convert any name to a safe lowercase slug."""
    s = re.sub(r"([A-Z])", r"_\1", name).lower().strip("_")
    return re.sub(r"[^a-z0-9]+", "_", s).strip("_")


def _is_camel_case(name: str) -> bool:
    """Return True if name looks like a CamelCase class name."""
    return bool(re.match(r"^[A-Z][a-zA-Z0-9]+$", name))


def _fmt_modules(summary: RepoSummary) -> str:
    if not summary.modules:
        return "(none)"
    return "\n".join(
        f"- {m.name} ({m.language}): {m.node_count} nodes, path={m.path}"
        for m in summary.modules[:20]
    )


def _fmt_classes_and_functions(summary: RepoSummary) -> str:
    """Format top functions/classes; prefer CamelCase (likely class) names first."""
    if not summary.functions:
        return "(none)"
    # Classes first, then functions, total ≤ 40
    classes = [f for f in summary.functions if _is_camel_case(f.name)]
    others = [f for f in summary.functions if not _is_camel_case(f.name)]
    combined = (classes + others)[:40]
    return "\n".join(
        f"- {f.name}({f.signature}) [module: {f.module}]"
        for f in combined
    )


def _fmt_apis(summary: RepoSummary) -> str:
    if not summary.apis:
        return "(none)"
    return "\n".join(
        f"- [{a.method}] {a.path or a.name} (module: {a.module})"
        for a in summary.apis[:20]
    )


def _fmt_databases(summary: RepoSummary) -> str:
    if not summary.databases:
        return "(none)"
    lines = []
    for db in summary.databases:
        tables = ", ".join(db.tables[:6])
        extra = f" (+{len(db.tables)-6} more)" if len(db.tables) > 6 else ""
        lines.append(f"- {db.name} ({db.db_type}): {tables}{extra}")
    return "\n".join(lines)


def _fmt_events(summary: RepoSummary) -> str:
    if not summary.events:
        return "(none)"
    return "\n".join(
        f"- {e.name} ({e.event_type})"
        for e in summary.events[:15]
    )


