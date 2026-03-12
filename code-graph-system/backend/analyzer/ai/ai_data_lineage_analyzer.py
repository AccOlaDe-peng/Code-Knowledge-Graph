"""
AI 数据血缘分析器。

替代已弃用的静态 DataLineageAnalyzer（Step 7），
使用 LLM 推断函数与数据存储（Table / Topic）之间的读写关系，
以及数据实体之间的转换路径。

输出边：
    READS     — function → table/topic (function reads data from)
    WRITES    — function → table/topic (function writes data to)
    PRODUCES  — function → event/topic (function publishes)
    CONSUMES  — function → event/topic (function subscribes)
    TRANSFORMS — data_object → data_object (transformation)

输出节点（仅当 AI 推断出新的数据实体时）：
    GraphNode(type=DATA_OBJECT, ...)

降级策略：
    按函数名关键字推断：
        get/find/load/fetch/query/read/list → READS
        save/create/insert/update/write/put/delete/remove → WRITES
        publish/emit/send/produce → PRODUCES
        consume/subscribe/receive/handle → CONSUMES
"""

from __future__ import annotations

import logging
import re
from typing import Any

from backend.analyzer.ai.ai_analyzer_base import AIAnalysisGraph, AIAnalyzerBase
from backend.graph.graph_schema import EdgeType, GraphEdge, GraphNode, NodeType
from backend.pipeline.repo_summary_builder import (
    DatabaseSummary,
    EventSummary,
    FunctionSummary,
    RepoSummary,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Heuristic keyword sets for fallback
# ---------------------------------------------------------------------------

_READ_VERBS: frozenset[str] = frozenset({
    "get", "find", "load", "fetch", "query", "read",
    "list", "search", "retrieve", "select", "lookup",
})
_WRITE_VERBS: frozenset[str] = frozenset({
    "save", "create", "insert", "update", "write", "put",
    "delete", "remove", "upsert", "store", "persist", "flush",
})
_PRODUCE_VERBS: frozenset[str] = frozenset({
    "publish", "emit", "send", "produce", "dispatch", "enqueue",
    "fire", "raise", "broadcast",
})
_CONSUME_VERBS: frozenset[str] = frozenset({
    "consume", "subscribe", "receive", "handle", "process",
    "listen", "on_message", "dequeue",
})


def _leading_verb(name: str) -> str:
    """Extract the leading verb from a snake_case or camelCase function name."""
    # snake_case: first segment
    snake_part = name.split("_")[0].lower()
    if snake_part:
        return snake_part
    # camelCase: lowercase prefix
    m = re.match(r"^([a-z]+)", name)
    return m.group(1) if m else name.lower()


# ---------------------------------------------------------------------------
# Analyzer
# ---------------------------------------------------------------------------


class AIDataLineageAnalyzer(AIAnalyzerBase):
    """推断数据血缘，生成 READS / WRITES / PRODUCES / CONSUMES / TRANSFORMS 边。

    用法::

        analyzer = AIDataLineageAnalyzer()
        graph = analyzer.analyze(summary)
        builder.merge_graph(graph)
    """

    # ------------------------------------------------------------------
    # Public
    # ------------------------------------------------------------------

    def analyze(self, summary: RepoSummary) -> AIAnalysisGraph:
        if not self._use_llm:
            return self._fallback(summary)

        # Skip if no data stores or functions to analyze
        if not summary.databases and not summary.events:
            logger.info(
                "%s: no databases/events in summary, using fallback",
                self.analyzer_name,
            )
            return self._fallback(summary)

        system, user = self._prompt_loader.render(
            "data_lineage",
            repo_name=summary.repo_name,
            languages=", ".join(summary.languages),
            functions=_fmt_functions(summary),
            databases=_fmt_databases(summary),
            events=_fmt_events(summary),
            call_graph=_fmt_call_graph(summary),
            services=_fmt_services(summary),
        )

        raw = self._call_llm_json(system, user, required_keys=["lineage"])
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

        fn_name_to_id = {fn.name: fn.id for fn in summary.functions}
        data_name_to_id = _build_data_index(summary)

        # ── lineage entries ───────────────────────────────────────────
        for entry in raw.get("lineage", []):
            if not isinstance(entry, dict):
                continue
            fn_name = str(entry.get("function_name", "")).strip()
            confidence = float(entry.get("confidence", 0.5))
            if confidence < 0.5:
                continue
            fn_id = fn_name_to_id.get(fn_name)
            if not fn_id:
                continue

            # READS edges
            for table_name in entry.get("reads", []):
                target_id = _resolve_data_id(
                    str(table_name), data_name_to_id, nodes, self
                )
                if target_id and target_id != fn_id:
                    edges.append(self._make_edge(
                        fn_id, target_id,
                        EdgeType.READS.value,
                        confidence=confidence,
                    ))

            # WRITES edges
            for table_name in entry.get("writes", []):
                target_id = _resolve_data_id(
                    str(table_name), data_name_to_id, nodes, self
                )
                if target_id and target_id != fn_id:
                    edges.append(self._make_edge(
                        fn_id, target_id,
                        EdgeType.WRITES.value,
                        confidence=confidence,
                    ))

            # TRANSFORMS edges (data_object → data_object)
            for transform in entry.get("transforms", []):
                if not isinstance(transform, dict):
                    continue
                from_ent = str(transform.get("from_entity", "")).strip()
                to_ent = str(transform.get("to_entity", "")).strip()
                t_conf = float(transform.get("confidence", 0.5))
                if not from_ent or not to_ent or t_conf < 0.5:
                    continue
                from_id = _resolve_data_id(from_ent, data_name_to_id, nodes, self)
                to_id = _resolve_data_id(to_ent, data_name_to_id, nodes, self)
                if from_id and to_id and from_id != to_id:
                    edges.append(self._make_edge(
                        from_id, to_id,
                        EdgeType.TRANSFORMS.value,
                        transformer=fn_name,
                        confidence=t_conf,
                    ))

        # ── data_flows (flat list, alternative schema from some LLMs) ─
        for flow in raw.get("data_flows", []):
            if not isinstance(flow, dict):
                continue
            source = str(flow.get("source", "")).strip()
            target = str(flow.get("target", "")).strip()
            flow_type = str(flow.get("flow_type", "")).lower()
            data_entity = str(flow.get("data_entity", "")).strip()
            confidence = float(flow.get("confidence", 0.5))

            if not source or not target or confidence < 0.5:
                continue

            edge_type = _flow_type_to_edge(flow_type)
            if not edge_type:
                continue

            src_id = fn_name_to_id.get(source) or _resolve_data_id(
                source, data_name_to_id, nodes, self
            )
            tgt_id = fn_name_to_id.get(target) or _resolve_data_id(
                target, data_name_to_id, nodes, self
            )
            if src_id and tgt_id and src_id != tgt_id:
                edges.append(self._make_edge(
                    src_id, tgt_id,
                    edge_type,
                    data_entity=data_entity,
                    confidence=confidence,
                ))

        return self._finalize(nodes, edges, overall_conf)

    # ------------------------------------------------------------------
    # Fallback
    # ------------------------------------------------------------------

    def _fallback(self, summary: RepoSummary) -> AIAnalysisGraph:
        """Keyword-based lineage inference from function names."""
        edges: list[GraphEdge] = []
        nodes: list[GraphNode] = []

        data_name_to_id = _build_data_index(summary)
        if not data_name_to_id:
            return self._empty_graph()

        # Pick the "most relevant" data stores for bulk assignment
        all_data_ids = list(data_name_to_id.values())

        for fn in summary.functions:
            verb = _leading_verb(fn.name)
            edge_type: str | None = None

            if verb in _READ_VERBS:
                edge_type = EdgeType.READS.value
            elif verb in _WRITE_VERBS:
                edge_type = EdgeType.WRITES.value
            elif verb in _PRODUCE_VERBS:
                edge_type = EdgeType.PRODUCES.value
            elif verb in _CONSUME_VERBS:
                edge_type = EdgeType.CONSUMES.value

            if not edge_type:
                continue

            # Try to match by name fragment first
            matched = _match_data_by_name(fn.name, data_name_to_id)
            targets = matched if matched else all_data_ids[:2]

            for target_id in targets:
                if target_id != fn.id:
                    edges.append(self._make_edge(
                        fn.id,
                        target_id,
                        edge_type,
                        confidence=0.4,
                        inferred_by="heuristic",
                    ))

        graph = self._finalize(
            nodes, edges,
            confidence=0.35 if edges else 0.0,
            fallback=True,
        )
        self._log_result(graph)
        return graph


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _build_data_index(summary: RepoSummary) -> dict[str, str]:
    """Build entity_name → node_id index from databases, tables, events."""
    index: dict[str, str] = {}
    for db in summary.databases:
        index[db.name.lower()] = db.id
        for tbl in db.tables:
            index[tbl.lower()] = f"table:{tbl.lower()}"
    for ev in summary.events:
        index[ev.name.lower()] = ev.id
    return index


def _resolve_data_id(
    name: str,
    data_name_to_id: dict[str, str],
    new_nodes: list[GraphNode],
    analyzer: AIAnalyzerBase,
) -> str | None:
    """Resolve a data entity name to its node ID.

    If the entity is not in the existing index, creates a new
    DATA_OBJECT node and registers it in the index.
    """
    key = name.lower().strip()
    if not key:
        return None

    # Exact match
    if key in data_name_to_id:
        return data_name_to_id[key]

    # Partial match (entity name is a substring of a known name)
    for known_name, known_id in data_name_to_id.items():
        if key in known_name or known_name in key:
            return known_id

    # Create synthetic DATA_OBJECT node
    node_id = f"data_object:{key.replace(' ', '_')}"
    if node_id not in {n.id for n in new_nodes}:
        new_node = analyzer._make_node(
            NodeType.DATA_OBJECT.value,
            name,
            node_id=node_id,
            source="ai_inferred",
        )
        new_nodes.append(new_node)
        data_name_to_id[key] = node_id

    return node_id


def _match_data_by_name(
    fn_name: str, data_name_to_id: dict[str, str]
) -> list[str]:
    """Try to find data stores whose name appears in the function name."""
    fn_lower = fn_name.lower()
    return [
        node_id
        for entity_name, node_id in data_name_to_id.items()
        if entity_name in fn_lower
    ]


def _flow_type_to_edge(flow_type: str) -> str | None:
    """Map LLM flow_type string to EdgeType value."""
    mapping = {
        "read":      EdgeType.READS.value,
        "write":     EdgeType.WRITES.value,
        "transform": EdgeType.TRANSFORMS.value,
        "produce":   EdgeType.PRODUCES.value,
        "consume":   EdgeType.CONSUMES.value,
    }
    return mapping.get(flow_type)


def _fmt_functions(summary: RepoSummary) -> str:
    if not summary.functions:
        return "(none)"
    return "\n".join(
        f"- {f.name}({f.signature}) [module: {f.module}]"
        for f in summary.functions[:35]
    )


def _fmt_databases(summary: RepoSummary) -> str:
    if not summary.databases:
        return "(none)"
    lines = []
    for db in summary.databases:
        tables = ", ".join(db.tables[:8])
        extra = f" (+{len(db.tables)-8} more)" if len(db.tables) > 8 else ""
        lines.append(f"- {db.name} ({db.db_type}): {tables}{extra}")
    return "\n".join(lines)


def _fmt_events(summary: RepoSummary) -> str:
    if not summary.events:
        return "(none)"
    return "\n".join(
        f"- {e.name} ({e.event_type})"
        for e in summary.events[:15]
    )


def _fmt_call_graph(summary: RepoSummary) -> str:
    if not summary.call_graph_sample:
        return "(none)"
    return "\n".join(
        f"- {c.caller} → {c.callee}"
        for c in summary.call_graph_sample[:30]
    )


def _fmt_services(summary: RepoSummary) -> str:
    if not summary.services:
        return "(none)"
    return "\n".join(f"- {s.name}: {s.description}" for s in summary.services[:10])
