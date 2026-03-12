"""
AI 业务流程分析器。

使用 LLM 从 API 端点 + 调用图中识别端到端的业务流程
（用户注册流、订单创建流、支付结算流等），生成 Flow 节点
和 FLOW_STEP 边将流程节点与具体函数关联。

输出节点：
    GraphNode(type=FLOW, name="UserRegistrationFlow", properties={...})

输出边：
    GraphEdge(from_=flow_node_id, to=function_node_id, type=FLOW_STEP, ...)
    GraphEdge(from_=flow_a_id,    to=flow_b_id,        type=TRIGGERS,  ...)

降级策略：
    每个 API 端点对应一个简单 Flow 节点，将该端点及其
    直接调用的函数（来自 call_graph_sample）作为步骤。
"""

from __future__ import annotations

import logging
import re
from collections import defaultdict
from typing import Any

from backend.analyzer.ai.ai_analyzer_base import AIAnalysisGraph, AIAnalyzerBase
from backend.graph.graph_schema import EdgeType, GraphEdge, GraphNode, NodeType
from backend.pipeline.repo_summary_builder import APISummary, RepoSummary

logger = logging.getLogger(__name__)


class AIBusinessFlowAnalyzer(AIAnalyzerBase):
    """识别业务流程，生成 Flow 节点 + FLOW_STEP / TRIGGERS 边。

    用法::

        analyzer = AIBusinessFlowAnalyzer()
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
            "business_flow",
            repo_name=summary.repo_name,
            languages=", ".join(summary.languages),
            apis=_fmt_apis(summary),
            functions=_fmt_functions(summary),
            call_graph=_fmt_call_graph(summary),
            events=_fmt_events(summary),
            services=_fmt_services(summary),
        )

        raw = self._call_llm_json(system, user, required_keys=["flows"])
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

        # Build function name → id lookup
        fn_name_to_id = {fn.name: fn.id for fn in summary.functions}

        flow_name_to_node: dict[str, GraphNode] = {}

        for flow_data in raw.get("flows", []):
            if not isinstance(flow_data, dict):
                continue
            name = str(flow_data.get("name", "")).strip()
            if not name:
                continue

            trigger = str(flow_data.get("trigger", ""))
            description = str(flow_data.get("description", ""))
            domain = str(flow_data.get("domain", ""))
            steps = flow_data.get("steps", [])
            produces_events = flow_data.get("produces_events", [])
            confidence = float(flow_data.get("confidence", 0.6))

            if not isinstance(steps, list) or len(steps) < 2:
                continue  # Require at least 2 steps to be a meaningful flow

            node_id = f"flow:{_slugify(name)}"
            flow_node = self._make_node(
                NodeType.FLOW.value,
                name,
                node_id=node_id,
                trigger=trigger,
                description=description,
                domain=domain,
                steps_count=len(steps),
                produces_events=(
                    produces_events if isinstance(produces_events, list) else []
                ),
                confidence=confidence,
            )
            flow_name_to_node[name] = flow_node
            nodes.append(flow_node)

            # ── FLOW_STEP edges ───────────────────────────────────────
            for step in steps:
                if not isinstance(step, dict):
                    continue
                fn_name = str(step.get("function_name", "")).strip()
                step_idx = int(step.get("step_index", 0))
                step_desc = str(step.get("description", ""))
                is_critical = bool(step.get("is_critical", False))

                fn_id = fn_name_to_id.get(fn_name)
                if not fn_id:
                    continue  # Can't link without a known ID

                edges.append(self._make_edge(
                    flow_node.id,
                    fn_id,
                    EdgeType.FLOW_STEP.value,
                    step_index=step_idx,
                    description=step_desc,
                    is_critical=is_critical,
                ))

        # ── TRIGGERS edges (flow → flow) ─────────────────────────────
        # (LLM may not always produce these; this is best-effort)
        _add_trigger_edges(raw, flow_name_to_node, edges, self)

        return self._finalize(
            nodes, edges, overall_conf,
            flow_count=len(nodes),
        )

    # ------------------------------------------------------------------
    # Fallback
    # ------------------------------------------------------------------

    def _fallback(self, summary: RepoSummary) -> AIAnalysisGraph:
        """One Flow node per API endpoint; link directly-called functions as steps."""
        if not summary.apis:
            return self._empty_graph()

        nodes: list[GraphNode] = []
        edges: list[GraphEdge] = []

        # Build caller → callee map from call_graph_sample
        caller_to_callees: dict[str, list[str]] = defaultdict(list)
        fn_name_to_id = {fn.name: fn.id for fn in summary.functions}

        for cs in summary.call_graph_sample:
            caller_to_callees[cs.caller].append(cs.callee)

        for api in summary.apis[:20]:
            flow_name = _api_to_flow_name(api)
            node_id = f"flow:{_slugify(flow_name)}"

            flow_node = self._make_node(
                NodeType.FLOW.value,
                flow_name,
                node_id=node_id,
                trigger=f"[{api.method}] {api.path or api.name}",
                description=api.description or f"Flow triggered by {api.name}",
                source="heuristic",
                steps_count=0,
            )
            nodes.append(flow_node)

            # Link API node itself as step 1
            if api.id:
                edges.append(self._make_edge(
                    flow_node.id,
                    api.id,
                    EdgeType.FLOW_STEP.value,
                    step_index=1,
                    description="Entry point",
                    is_critical=True,
                ))

            # Link directly-called functions as subsequent steps
            step_idx = 2
            for callee_name in caller_to_callees.get(api.name, [])[:5]:
                callee_id = fn_name_to_id.get(callee_name)
                if callee_id:
                    edges.append(self._make_edge(
                        flow_node.id,
                        callee_id,
                        EdgeType.FLOW_STEP.value,
                        step_index=step_idx,
                        description=f"Called by {api.name}",
                        is_critical=False,
                    ))
                    step_idx += 1

        graph = self._finalize(
            nodes, edges,
            confidence=0.4 if nodes else 0.0,
            fallback=True,
        )
        self._log_result(graph)
        return graph


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _slugify(name: str) -> str:
    """Convert PascalCase/spaces to snake_case slug."""
    s = re.sub(r"([A-Z])", r"_\1", name).lower().strip("_")
    return re.sub(r"[^a-z0-9]+", "_", s).strip("_")


def _api_to_flow_name(api: APISummary) -> str:
    """Derive a PascalCase flow name from an API endpoint."""
    base = api.name
    # Strip common suffixes
    for suffix in ("_handler", "_view", "_endpoint", "_api", "_controller"):
        if base.lower().endswith(suffix):
            base = base[: -len(suffix)]
            break
    # Convert to PascalCase + "Flow"
    words = re.split(r"[_\-\s]+", base)
    pascal = "".join(w.capitalize() for w in words if w)
    return f"{pascal}Flow"


def _add_trigger_edges(
    raw: dict[str, Any],
    flow_name_to_node: dict[str, GraphNode],
    edges: list[GraphEdge],
    analyzer: AIAnalyzerBase,
) -> None:
    """Add TRIGGERS edges between flows from LLM response if present."""
    for flow_data in raw.get("flows", []):
        if not isinstance(flow_data, dict):
            continue
        name = str(flow_data.get("name", "")).strip()
        triggers = flow_data.get("triggers", [])  # some LLMs add this
        if not name or not isinstance(triggers, list):
            continue
        src_node = flow_name_to_node.get(name)
        if not src_node:
            continue
        for triggered_name in triggers:
            tgt_node = flow_name_to_node.get(str(triggered_name).strip())
            if tgt_node and tgt_node.id != src_node.id:
                edges.append(analyzer._make_edge(
                    src_node.id,
                    tgt_node.id,
                    EdgeType.TRIGGERS.value,
                    condition="on_success",
                ))


def _fmt_apis(summary: RepoSummary) -> str:
    if not summary.apis:
        return "(none)"
    return "\n".join(
        f"- [{a.method}] {a.path or a.name} (module: {a.module})"
        + (f" — {a.description}" if a.description else "")
        for a in summary.apis[:30]
    )


def _fmt_functions(summary: RepoSummary) -> str:
    if not summary.functions:
        return "(none)"
    return "\n".join(
        f"- {f.name}({f.signature}) [module: {f.module}]"
        for f in summary.functions[:35]
    )


def _fmt_call_graph(summary: RepoSummary) -> str:
    if not summary.call_graph_sample:
        return "(none)"
    return "\n".join(
        f"- {c.caller_module}.{c.caller} → {c.callee_module}.{c.callee}"
        for c in summary.call_graph_sample[:40]
    )


def _fmt_events(summary: RepoSummary) -> str:
    if not summary.events:
        return "(none)"
    return "\n".join(
        f"- {e.name} ({e.event_type})"
        for e in summary.events[:15]
    )


def _fmt_services(summary: RepoSummary) -> str:
    if not summary.services:
        return "(none)"
    return "\n".join(
        f"- {s.name}: {s.description}" for s in summary.services[:10]
    )
