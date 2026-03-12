"""
AI 服务识别器。

使用 LLM 识别微服务（或模块级服务）边界，补全或新增 Service 节点，
并在服务间建立 DEPENDS_ON 边。

处理逻辑：
    1. 若 summary 中已有来自 InfraAnalyzer 的 Service 节点，
       AI 将尝试 enrich 它们（追加 responsibility / communication 属性）
       而不是重复创建
    2. 若 AI 发现额外的服务边界，新建 Service 节点，
       properties 中注明 source="ai_detected"
    3. 服务间依赖作为 DEPENDS_ON 边输出

降级策略：
    每个顶层模块视为一个独立服务；
    若已有 InfraAnalyzer Service 节点则直接返回空图（避免冗余）。
"""

from __future__ import annotations

import logging
from typing import Any

from backend.analyzer.ai.ai_analyzer_base import AIAnalysisGraph, AIAnalyzerBase
from backend.graph.graph_schema import EdgeType, GraphEdge, GraphNode, NodeType
from backend.pipeline.repo_summary_builder import RepoSummary

logger = logging.getLogger(__name__)


class AIServiceDetector(AIAnalyzerBase):
    """识别微服务边界，补全 Service 节点并建立依赖关系。

    用法::

        detector = AIServiceDetector()
        graph = detector.analyze(summary)
        builder.merge_graph(graph)
    """

    # ------------------------------------------------------------------
    # Public
    # ------------------------------------------------------------------

    def analyze(self, summary: RepoSummary) -> AIAnalysisGraph:
        if not self._use_llm:
            return self._fallback(summary)

        system, user = self._prompt_loader.render(
            "service_detection",
            repo_name=summary.repo_name,
            languages=", ".join(summary.languages),
            modules=_fmt_modules(summary),
            existing_services=_fmt_existing_services(summary),
            apis=_fmt_apis(summary),
            infra=_fmt_infra(summary),
            events=_fmt_events(summary),
            dependencies=_fmt_modules(summary),
        )

        raw = self._call_llm_json(
            system, user, required_keys=["services"]
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

        overall_conf = float(raw.get("overall_confidence", 0.7))

        # Build index of existing service names (from summary) to detect duplicates
        existing_names: set[str] = {s.name.lower() for s in summary.services}
        service_name_to_node: dict[str, GraphNode] = {}

        # ── 1. Service nodes ──────────────────────────────────────────
        for svc_data in raw.get("services", []):
            if not isinstance(svc_data, dict):
                continue
            name = str(svc_data.get("name", "")).strip()
            if not name:
                continue

            confidence = float(svc_data.get("confidence", 0.5))
            responsibility = str(svc_data.get("responsibility", ""))
            communication = svc_data.get("communication", [])
            tech_stack = svc_data.get("tech_stack", [])
            modules = svc_data.get("modules", [])

            # Determine stable node ID
            # If this service already exists in the graph (from InfraAnalyzer),
            # we enrich it by using the same deterministic ID pattern
            is_new = name.lower() not in existing_names
            node_id = f"service:{name.lower().replace(' ', '_')}"

            svc_node = self._make_node(
                NodeType.SERVICE.value,
                name,
                node_id=node_id,
                responsibility=responsibility,
                communication=communication if isinstance(communication, list) else [],
                tech_stack=tech_stack if isinstance(tech_stack, list) else [],
                modules=modules if isinstance(modules, list) else [],
                confidence=confidence,
                source="ai_detected" if is_new else "ai_enriched",
            )
            service_name_to_node[name] = svc_node

            # Only emit new nodes; enriched nodes override existing via same ID
            nodes.append(svc_node)

        # ── 2. DEPENDS_ON edges ───────────────────────────────────────
        for dep in raw.get("dependencies", []):
            if not isinstance(dep, dict):
                continue
            from_name = str(dep.get("from_service", "")).strip()
            to_name = str(dep.get("to_service", "")).strip()
            if not from_name or not to_name or from_name == to_name:
                continue

            from_node = service_name_to_node.get(from_name)
            to_node = service_name_to_node.get(to_name)
            if not from_node or not to_node:
                continue

            confidence = float(dep.get("confidence", 0.5))
            if confidence < 0.5:
                continue

            edges.append(self._make_edge(
                from_node.id,
                to_node.id,
                EdgeType.DEPENDS_ON.value,
                protocol=str(dep.get("protocol", "")),
                direction=str(dep.get("direction", "sync")),
                confidence=confidence,
            ))

        return self._finalize(
            nodes, edges, overall_conf,
            new_services=sum(
                1 for n in nodes
                if n.properties.get("source") == "ai_detected"
            ),
            enriched_services=sum(
                1 for n in nodes
                if n.properties.get("source") == "ai_enriched"
            ),
        )

    # ------------------------------------------------------------------
    # Fallback
    # ------------------------------------------------------------------

    def _fallback(self, summary: RepoSummary) -> AIAnalysisGraph:
        """Each top-level module becomes a service if no services already exist."""
        # If InfraAnalyzer already found services, don't duplicate them
        if summary.services:
            return self._empty_graph(confidence=0.0)

        nodes: list[GraphNode] = []
        svc_nodes: dict[str, GraphNode] = {}

        for mod in summary.modules[:15]:
            node_id = f"service:{mod.name.lower()}"
            svc_node = self._make_node(
                NodeType.SERVICE.value,
                mod.name,
                node_id=node_id,
                responsibility=f"Module-level service for {mod.name}",
                source="heuristic",
                language=mod.language,
            )
            svc_nodes[mod.name] = svc_node
            nodes.append(svc_node)

        graph = self._finalize(
            nodes, [],
            confidence=0.3 if nodes else 0.0,
            fallback=True,
        )
        self._log_result(graph)
        return graph


# ---------------------------------------------------------------------------
# Summary formatters
# ---------------------------------------------------------------------------


def _fmt_modules(summary: RepoSummary) -> str:
    if not summary.modules:
        return "(none)"
    return "\n".join(
        f"- {m.name} ({m.language}): {m.node_count} nodes, path={m.path}"
        for m in summary.modules[:20]
    )


def _fmt_existing_services(summary: RepoSummary) -> str:
    if not summary.services:
        return "(none — no services detected by static analysis)"
    return "\n".join(
        f"- {s.name}: {s.description}" + (f" :{s.port}" if s.port else "")
        for s in summary.services
    )


def _fmt_apis(summary: RepoSummary) -> str:
    if not summary.apis:
        return "(none)"
    return "\n".join(
        f"- [{a.method}] {a.path or a.name} (module: {a.module})"
        for a in summary.apis[:25]
    )


def _fmt_infra(summary: RepoSummary) -> str:
    lines = []
    if summary.databases:
        lines.append("Databases: " + ", ".join(
            f"{d.name}({d.db_type})" for d in summary.databases
        ))
    if summary.events:
        lines.append("Message brokers: " + ", ".join(
            {e.event_type for e in summary.events if e.event_type}
        ))
    return "\n".join(lines) if lines else "(none)"


def _fmt_events(summary: RepoSummary) -> str:
    if not summary.events:
        return "(none)"
    return "\n".join(
        f"- {e.name} ({e.event_type})"
        + (f" pub: {', '.join(e.publishers[:3])}" if e.publishers else "")
        + (f" sub: {', '.join(e.subscribers[:3])}" if e.subscribers else "")
        for e in summary.events[:15]
    )
