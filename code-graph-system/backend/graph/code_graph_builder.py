"""
CodeGraphBuilder — 将多个文件级 AI 分析图合并为一个仓库级图谱。

用途
----
AI 分析器对每个文件（或文件块）独立返回一个小图：

    {
        "nodes": [{"id": "function:UserService.create", "type": "function", "file": "..."}],
        "edges": [{"from": "...", "to": "...", "type": "calls"}]
    }

``CodeGraphBuilder`` 将这些小图逐一累积，然后通过 ``build()``
合并为一个去重后的仓库级图谱，输出格式：

    {
        "nodes": [...],
        "edges": [...]
    }

去重规则
--------
- **节点**：以 ``node.id`` 为键；后加入的同 ID 节点覆盖先前版本
  （允许 AI 在后续文件中补全同一节点的 ``file`` / ``line`` 等字段）。
- **边**：以 ``(from, to, type)`` 三元组为键；严格去重，保留首次出现的边。

典型用法::

    from backend.graph.code_graph_builder import CodeGraphBuilder

    builder = CodeGraphBuilder()

    for file_result in ai_results:          # 每个文件的 AI 返回
        builder.add_graph(file_result)      # dict 或 CodeGraph 均可

    graph = builder.build()                 # {"nodes": [...], "edges": [...]}

    # 也可以逐步检查中间状态
    print(builder.stats)
    # {"node_count": 42, "edge_count": 67, "node_types": {...}, "edge_types": {...}}
"""

from __future__ import annotations

import dataclasses
import json
import logging
from typing import Any, Union

from backend.graph.code_graph import CodeEdge, CodeGraph, CodeNode

logger = logging.getLogger(__name__)

# 接受的输入类型：CodeGraph 实例，或可直接 json.loads 的字典 / JSON 字符串
GraphInput = Union[CodeGraph, dict[str, Any], str]


# ---------------------------------------------------------------------------
# CodeGraphBuilder
# ---------------------------------------------------------------------------


class CodeGraphBuilder:
    """将多个文件级 AI 分析图合并为一个仓库级图谱。

    示例::

        builder = CodeGraphBuilder()
        builder.add_graph({"nodes": [...], "edges": [...]})
        builder.add_graph(another_code_graph)
        result = builder.build()
        # result == {"nodes": [...], "edges": [...]}

    线程安全：否（单线程顺序调用设计）。
    """

    def __init__(self) -> None:
        # 节点存储：id → CodeNode（后加入的同 ID 节点覆盖先前版本）
        self._nodes: dict[str, CodeNode] = {}

        # 边去重集合：(from_, to, type) → True
        self._edge_keys: set[tuple[str, str, str]] = set()

        # 边列表（保持插入顺序）
        self._edges: list[CodeEdge] = []

        # 已调用 add_graph 的次数（用于日志）
        self._graph_count: int = 0

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def add_graph(self, graph: GraphInput) -> "CodeGraphBuilder":
        """将一个文件级图加入累积池。

        Args:
            graph: 以下三种格式之一：
                   - ``CodeGraph`` 实例
                   - ``dict``，含 ``"nodes"`` 和 ``"edges"`` 键
                   - JSON 字符串，解析后含 ``"nodes"`` 和 ``"edges"`` 键

        Returns:
            self（支持链式调用）。

        Raises:
            TypeError:  graph 不是上述三种类型之一。
            ValueError: JSON 字符串解析失败，或 dict 缺少必要键。
        """
        nodes, edges = _extract(graph)
        added_n = added_e = 0

        for node in nodes:
            added_n += self._add_node(node)

        for edge in edges:
            added_e += self._add_edge(edge)

        self._graph_count += 1
        logger.debug(
            "add_graph #%d: +%d nodes / +%d edges  "
            "(total: %d nodes / %d edges)",
            self._graph_count, added_n, added_e,
            len(self._nodes), len(self._edges),
        )
        return self

    def merge_nodes(self) -> list[CodeNode]:
        """返回当前已去重的节点列表（不修改内部状态）。

        Returns:
            按插入顺序排列的 ``CodeNode`` 列表（同 ID 保留最后一次写入版本）。
        """
        return list(self._nodes.values())

    def merge_edges(self) -> list[CodeEdge]:
        """返回当前已去重的边列表（不修改内部状态）。

        Returns:
            按首次插入顺序排列的 ``CodeEdge`` 列表（(from,to,type) 三元组去重）。
        """
        return list(self._edges)

    def build(self) -> dict[str, Any]:
        """合并所有已加入的图，返回去重后的仓库级图谱字典。

        Returns:
            ``{"nodes": [...], "edges": [...]}``，
            其中每个节点和边均为普通字典（可直接 ``json.dumps``）。

        Note:
            ``build()`` 是幂等的：可多次调用，每次都返回当前累积状态的快照，
            不会清空内部状态。如需重置，请创建新实例。
        """
        nodes_out = [n.to_dict() for n in self.merge_nodes()]
        edges_out = [e.to_dict() for e in self.merge_edges()]

        logger.info(
            "CodeGraphBuilder.build(): %d nodes / %d edges  "
            "(from %d source graphs)",
            len(nodes_out), len(edges_out), self._graph_count,
        )
        return {
            "nodes": nodes_out,
            "edges": edges_out,
        }

    # ------------------------------------------------------------------
    # Introspection
    # ------------------------------------------------------------------

    @property
    def stats(self) -> dict[str, Any]:
        """当前累积状态的统计信息（build 前后均可调用）。

        Returns:
            ::

                {
                    "graph_count": 3,
                    "node_count":  42,
                    "edge_count":  67,
                    "node_types":  {"function": 20, "class": 10, ...},
                    "edge_types":  {"calls": 40, "contains": 27},
                }
        """
        node_types: dict[str, int] = {}
        for n in self._nodes.values():
            node_types[n.type] = node_types.get(n.type, 0) + 1

        edge_types: dict[str, int] = {}
        for e in self._edges:
            edge_types[e.type] = edge_types.get(e.type, 0) + 1

        return {
            "graph_count": self._graph_count,
            "node_count":  len(self._nodes),
            "edge_count":  len(self._edges),
            "node_types":  node_types,
            "edge_types":  edge_types,
        }

    def __repr__(self) -> str:
        s = self.stats
        return (
            f"CodeGraphBuilder("
            f"graphs={s['graph_count']}, "
            f"nodes={s['node_count']}, "
            f"edges={s['edge_count']})"
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _add_node(self, node: CodeNode) -> int:
        """添加单个节点。同 ID 后者覆盖前者。

        Returns:
            1 表示新增节点，0 表示覆盖已有节点（用于统计 added_n）。
        """
        is_new = node.id not in self._nodes
        self._nodes[node.id] = node
        return 1 if is_new else 0

    def _add_edge(self, edge: CodeEdge) -> int:
        """添加单条边。(from, to, type) 三元组去重，保留首次出现。

        Returns:
            1 表示新增边，0 表示重复跳过（用于统计 added_e）。
        """
        key = (edge.from_, edge.to, edge.type)
        if key in self._edge_keys:
            return 0
        self._edge_keys.add(key)
        self._edges.append(edge)
        return 1


# ---------------------------------------------------------------------------
# Input normalization
# ---------------------------------------------------------------------------


def _extract(graph: GraphInput) -> tuple[list[CodeNode], list[CodeEdge]]:
    """将任意输入格式规范化为 (nodes, edges) 元组。

    支持：
        - ``CodeGraph`` 实例（直接读取 .nodes / .edges）
        - ``dict``（含 "nodes" / "edges" 键，值为 list[dict]）
        - JSON 字符串（先解析为 dict，再按 dict 路径处理）

    节点和边的解析均容错：
        - 缺少必要字段的条目静默跳过（记录 warning）
        - 字段类型错误时静默跳过

    Returns:
        (list[CodeNode], list[CodeEdge])
    """
    if isinstance(graph, CodeGraph):
        return graph.nodes, graph.edges

    if isinstance(graph, str):
        try:
            graph = json.loads(graph)
        except json.JSONDecodeError as exc:
            raise ValueError(f"CodeGraphBuilder: invalid JSON string: {exc}") from exc

    if not isinstance(graph, dict):
        raise TypeError(
            f"CodeGraphBuilder.add_graph() expects CodeGraph, dict, or JSON str; "
            f"got {type(graph).__name__}"
        )

    raw_nodes: list[Any] = graph.get("nodes") or []
    raw_edges: list[Any] = graph.get("edges") or []

    nodes: list[CodeNode] = []
    for i, raw in enumerate(raw_nodes):
        node = _parse_node(raw, index=i)
        if node is not None:
            nodes.append(node)

    edges: list[CodeEdge] = []
    for i, raw in enumerate(raw_edges):
        edge = _parse_edge(raw, index=i)
        if edge is not None:
            edges.append(edge)

    return nodes, edges


def _parse_node(raw: Any, *, index: int) -> CodeNode | None:
    """将原始字典解析为 CodeNode，失败时返回 None。

    必填字段：``id``、``type``。
    ``name`` 缺失时自动从 ``id`` 推断（取最后一个 ``:`` 后的部分）。
    """
    if not isinstance(raw, dict):
        logger.warning("CodeGraphBuilder: node[%d] is not a dict, skipped", index)
        return None

    node_id: str = raw.get("id", "")
    node_type: str = raw.get("type", "")

    if not node_id:
        logger.warning(
            "CodeGraphBuilder: node[%d] missing 'id', skipped: %s",
            index, _truncate(raw),
        )
        return None
    if not node_type:
        logger.warning(
            "CodeGraphBuilder: node[%d] missing 'type', skipped: %s",
            index, _truncate(raw),
        )
        return None

    # name 可选：缺失时从 id 推断
    name: str = raw.get("name", "") or _name_from_id(node_id)

    line_raw = raw.get("line")
    line: int | None = None
    if line_raw is not None:
        try:
            line = int(line_raw)
        except (TypeError, ValueError):
            pass

    return CodeNode(
        id=node_id,
        type=node_type,
        name=name,
        file=raw.get("file", "") or "",
        line=line,
        module=raw.get("module", "") or "",
        language=raw.get("language", "") or "",
    )


def _parse_edge(raw: Any, *, index: int) -> CodeEdge | None:
    """将原始字典解析为 CodeEdge，失败时返回 None。

    必填字段：``from``、``to``、``type``。
    自环边（from == to）静默跳过。
    """
    if not isinstance(raw, dict):
        logger.warning("CodeGraphBuilder: edge[%d] is not a dict, skipped", index)
        return None

    from_id: str = raw.get("from", "")
    to_id: str   = raw.get("to", "")
    edge_type: str = raw.get("type", "")

    if not from_id:
        logger.warning(
            "CodeGraphBuilder: edge[%d] missing 'from', skipped: %s",
            index, _truncate(raw),
        )
        return None
    if not to_id:
        logger.warning(
            "CodeGraphBuilder: edge[%d] missing 'to', skipped: %s",
            index, _truncate(raw),
        )
        return None
    if not edge_type:
        logger.warning(
            "CodeGraphBuilder: edge[%d] missing 'type', skipped: %s",
            index, _truncate(raw),
        )
        return None
    if from_id == to_id:
        logger.debug(
            "CodeGraphBuilder: edge[%d] is a self-loop (%s), skipped", index, from_id
        )
        return None

    return CodeEdge(from_=from_id, to=to_id, type=edge_type)


# ---------------------------------------------------------------------------
# Tiny utilities
# ---------------------------------------------------------------------------


def _name_from_id(node_id: str) -> str:
    """从节点 ID 推断短名称。

    Examples:
        "function:UserService.create" → "create"
        "class:service.UserService"   → "UserService"
        "module:backend/api"          → "api"
        "layer:Controller"            → "Controller"
    """
    # 取最后一个 ":" 后的部分，再取最后一个 "." 或 "/" 后的部分
    after_colon = node_id.rsplit(":", 1)[-1]
    after_dot   = after_colon.rsplit(".", 1)[-1]
    after_slash = after_dot.rsplit("/", 1)[-1]
    return after_slash or node_id


def _truncate(obj: Any, max_len: int = 120) -> str:
    """将对象转为字符串并截断，用于日志输出。"""
    s = str(obj)
    return s if len(s) <= max_len else s[:max_len] + "…"
