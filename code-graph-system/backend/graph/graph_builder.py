"""
图谱构建器模块。

合并各分析器（ComponentDetector / EventAnalyzer / InfraAnalyzer /
SemanticAnalyzer 等）输出的 GraphNode / GraphEdge，构建完整知识图谱。

功能：
    - add_node / add_edge   —— 单条追加（ID 级去重）
    - merge_graph           —— 自动识别并合并任意分析器 Graph 对象
    - build                 —— 整合节点、边、图论指标，返回 BuiltGraph
    - export_json           —— 序列化为 graph.json

图论指标（NetworkX，可选）：
    - in_degree / out_degree —— 节点入度 / 出度
    - pagerank               —— 节点重要性评分

输出 JSON 格式（graph.json）：
    {
      "meta":  { "node_count": N, "edge_count": M, "node_type_counts": {...},
                 "edge_type_counts": {...}, "created_at": "...", ... },
      "nodes": [ { "id": "...", "type": "...", "name": "...",
                   "properties": {...}, "metrics": {...} } ],
      "edges": [ { "from": "...", "to": "...", "type": "...",
                   "properties": {...} } ]
    }
"""

from __future__ import annotations

import dataclasses
import json
import logging
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, Optional

from backend.graph.graph_schema import GraphEdge, GraphNode, GraphSchema

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Output container
# ---------------------------------------------------------------------------


@dataclasses.dataclass
class BuiltGraph:
    """GraphBuilder.build() 的输出，已含图论指标。

    Attributes:
        nodes:   所有去重后的节点列表
        edges:   所有去重后的边列表
        meta:    统计元信息（node_count / edge_count / 耗时等）
        metrics: 节点 ID → {in_degree, out_degree, pagerank}（可为空字典）
    """

    nodes:   list[GraphNode]
    edges:   list[GraphEdge]
    meta:    dict[str, Any]
    metrics: dict[str, dict[str, float]] = dataclasses.field(default_factory=dict)

    @property
    def node_count(self) -> int:
        return len(self.nodes)

    @property
    def edge_count(self) -> int:
        return len(self.edges)

    def validate(self) -> bool:
        """用 GraphSchema 验证整图合法性，返回 True/False。"""
        result = GraphSchema(nodes=self.nodes, edges=self.edges).validate_graph()
        if not result.valid:
            for err in result.errors:
                logger.warning("图谱验证错误 [%s] %s", err.location, err.message)
        return result.valid

    def to_dict(self) -> dict[str, Any]:
        """序列化为可 JSON 持久化的字典（供 export_json 使用）。"""
        nodes_out: list[dict] = []
        for node in self.nodes:
            nd = node.model_dump()
            m = self.metrics.get(node.id)
            if m:
                nd["metrics"] = m
            nodes_out.append(nd)

        edges_out = [e.model_dump(by_alias=True) for e in self.edges]

        return {
            "meta":  self.meta,
            "nodes": nodes_out,
            "edges": edges_out,
        }


# ---------------------------------------------------------------------------
# GraphBuilder
# ---------------------------------------------------------------------------


class GraphBuilder:
    """
    代码知识图谱构建器。

    典型用法::

        builder = GraphBuilder()
        builder.merge_graph(component_graph)
        builder.merge_graph(event_graph)
        builder.merge_graph(infra_graph)
        builder.merge_graph(semantic_graph)
        built = builder.build()
        builder.export_json("data/graphs/graph.json")
    """

    def __init__(self) -> None:
        self._nodes: dict[str, GraphNode] = {}          # id → node
        self._edges: list[GraphEdge] = []
        self._seen_edges: set[tuple[str, str, str]] = set()   # (from, to, type)
        self._t0: float = time.time()

    # ------------------------------------------------------------------
    # Accumulation API
    # ------------------------------------------------------------------

    def add_node(self, node: GraphNode) -> "GraphBuilder":
        """添加单个节点。同 ID 的后者覆盖前者。返回 self（支持链式调用）。"""
        self._nodes[node.id] = node
        return self

    def add_edge(self, edge: GraphEdge) -> "GraphBuilder":
        """添加单条边（(from, to, type) 三元组去重）。返回 self。"""
        key = (edge.from_, edge.to, edge.type)
        if key not in self._seen_edges:
            self._seen_edges.add(key)
            self._edges.append(edge)
        return self

    def merge_graph(self, graph: Any) -> "GraphBuilder":
        """从任意分析器 Graph 对象中提取节点和边并合并。

        支持的输入类型（duck typing，无需显式导入）：
            - ComponentGraph   —— .components / .classes / .functions / .edges
            - EventGraph       —— .events / .topics / .edges
            - InfraGraph       —— .services / .containers / .clusters / .databases / .edges
            - SemanticGraph    —— .all_nodes / .edges
            - GraphSchema      —— .nodes / .edges
            - 任意含 GraphNode list 属性 + .edges 属性的对象

        Args:
            graph: 分析器输出的 Graph 对象，或含节点/边属性的任意对象。

        Returns:
            self（支持链式调用）。
        """
        nodes, edges = _extract_from_graph(graph)
        merged_n = merged_e = 0
        for n in nodes:
            before = len(self._nodes)
            self.add_node(n)
            merged_n += len(self._nodes) - before
        for e in edges:
            before = len(self._edges)
            self.add_edge(e)
            merged_e += len(self._edges) - before

        logger.debug(
            "merge_graph: +%d 节点 / +%d 边 (来自 %s)",
            merged_n, merged_e, type(graph).__name__,
        )
        return self

    def add_nodes(self, nodes: list[GraphNode]) -> "GraphBuilder":
        """批量添加节点。"""
        for n in nodes:
            self.add_node(n)
        return self

    def add_edges(self, edges: list[GraphEdge]) -> "GraphBuilder":
        """批量添加边。"""
        for e in edges:
            self.add_edge(e)
        return self

    # ------------------------------------------------------------------
    # Build + Export
    # ------------------------------------------------------------------

    def build(self) -> BuiltGraph:
        """整合所有节点和边，计算图论指标，返回 BuiltGraph。

        NetworkX 不可用时跳过指标计算（节点仍正常输出）。
        """
        nodes = list(self._nodes.values())
        edges = list(self._edges)

        metrics = _compute_metrics(nodes, edges)

        duration = round(time.time() - self._t0, 3)
        meta: dict[str, Any] = {
            "node_count":       len(nodes),
            "edge_count":       len(edges),
            "node_type_counts": _count_by(n.type for n in nodes),
            "edge_type_counts": _count_by(e.type for e in edges),
            "metrics_available": bool(metrics),
            "analysis_duration_seconds": duration,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }

        logger.info(
            "图谱构建完成: %d 节点, %d 边, 耗时 %.3fs",
            len(nodes), len(edges), duration,
        )
        return BuiltGraph(nodes=nodes, edges=edges, meta=meta, metrics=metrics)

    def export_json(
        self,
        path: str | Path,
        *,
        indent: int = 2,
        validate: bool = True,
    ) -> Path:
        """构建图谱并序列化为 JSON 文件。

        Args:
            path:     输出路径，例如 ``"data/graphs/graph.json"``。
            indent:   JSON 缩进量（默认 2）。
            validate: 写入前执行 GraphSchema 验证（默认 True）。

        Returns:
            实际写入的 Path 对象。
        """
        output = Path(path)
        output.parent.mkdir(parents=True, exist_ok=True)

        built = self.build()

        if validate:
            built.validate()  # 仅记录警告，不中断写入

        data = built.to_dict()
        output.write_text(
            json.dumps(data, ensure_ascii=False, indent=indent),
            encoding="utf-8",
        )

        logger.info(
            "图谱已导出: %s  (%d 节点 / %d 边)",
            output, built.node_count, built.edge_count,
        )
        return output

    # ------------------------------------------------------------------
    # Info
    # ------------------------------------------------------------------

    @property
    def stats(self) -> dict[str, Any]:
        """当前累积状态统计（构建前可用）。"""
        return {
            "nodes":      len(self._nodes),
            "edges":      len(self._edges),
            "node_types": _count_by(n.type for n in self._nodes.values()),
            "edge_types": _count_by(e.type for e in self._edges),
        }

    def __repr__(self) -> str:
        s = self.stats
        return (
            f"GraphBuilder(nodes={s['nodes']}, edges={s['edges']})"
        )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _extract_from_graph(
    graph: Any,
) -> tuple[list[GraphNode], list[GraphEdge]]:
    """从任意分析器 Graph 对象中提取 GraphNode 和 GraphEdge 列表。

    提取策略（按优先级）：
        1. ``graph.nodes``    —— GraphSchema / 普通列表容器
        2. ``graph.all_nodes`` —— SemanticGraph 汇总属性
        3. 逐一检查公开 list 属性，收集所有 GraphNode 实例
    """
    nodes: list[GraphNode] = []
    edges: list[GraphEdge] = []

    # ── 节点提取 ──────────────────────────────────────────────────────

    if hasattr(graph, "nodes"):
        # GraphSchema / 直接含 nodes 属性
        raw = graph.nodes
        if isinstance(raw, list):
            nodes.extend(x for x in raw if isinstance(x, GraphNode))

    if not nodes and hasattr(graph, "all_nodes"):
        raw = graph.all_nodes
        if isinstance(raw, list):
            nodes.extend(x for x in raw if isinstance(x, GraphNode))

    if not nodes:
        # 泛型扫描：收集所有 list[GraphNode] 属性
        for attr_val in _public_list_attrs(graph):
            if attr_val and isinstance(attr_val[0], GraphNode):
                nodes.extend(attr_val)

    # ── 边提取 ────────────────────────────────────────────────────────

    raw_edges = getattr(graph, "edges", [])
    if isinstance(raw_edges, list):
        edges.extend(x for x in raw_edges if isinstance(x, GraphEdge))

    return nodes, edges


def _public_list_attrs(obj: Any) -> Iterator[list]:
    """返回对象所有公开 list 属性的迭代器（跳过 _ 前缀）。"""
    if dataclasses.is_dataclass(obj):
        for f in dataclasses.fields(obj):
            if f.name.startswith("_"):
                continue
            val = getattr(obj, f.name, None)
            if isinstance(val, list):
                yield val
    elif hasattr(obj, "model_fields"):
        # Pydantic v2
        for field_name in obj.model_fields:
            if field_name.startswith("_"):
                continue
            val = getattr(obj, field_name, None)
            if isinstance(val, list):
                yield val
    else:
        for k, v in vars(obj).items():
            if not k.startswith("_") and isinstance(v, list):
                yield v


def _compute_metrics(
    nodes: list[GraphNode],
    edges: list[GraphEdge],
) -> dict[str, dict[str, float]]:
    """用 NetworkX 计算每个节点的 in_degree / out_degree / pagerank。

    NetworkX 不可用时返回空字典，不影响主流程。
    """
    if not nodes:
        return {}
    try:
        import networkx as nx

        G: nx.DiGraph = nx.DiGraph()
        for n in nodes:
            G.add_node(n.id)
        for e in edges:
            if e.from_ in G and e.to in G:
                G.add_edge(e.from_, e.to)

        if G.number_of_nodes() == 0:
            return {}

        try:
            pr = nx.pagerank(G, max_iter=100, tol=1e-4)
        except Exception:
            pr = {nid: 1.0 / G.number_of_nodes() for nid in G.nodes()}

        return {
            n.id: {
                "in_degree":  G.in_degree(n.id),
                "out_degree": G.out_degree(n.id),
                "pagerank":   round(pr.get(n.id, 0.0), 6),
            }
            for n in nodes
        }
    except ImportError:
        logger.debug("networkx 未安装，跳过图论指标计算")
        return {}
    except Exception:
        logger.debug("图论指标计算失败", exc_info=True)
        return {}


def _count_by(values: Iterator[str]) -> dict[str, int]:
    """统计可迭代字符串值的频次。"""
    counts: dict[str, int] = {}
    for v in values:
        counts[v] = counts.get(v, 0) + 1
    return counts
