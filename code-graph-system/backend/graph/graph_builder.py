"""
图谱构建器模块。

整合所有分析器的输出，将分散的节点和边组装成
完整的 CodeGraph 对象，并使用 NetworkX 进行图论计算：
- PageRank（节点重要性评分）
- 连通分量分析
- 中心性度量
- 社区检测

同时负责节点去重和边合并，确保图的一致性。
"""

from __future__ import annotations

import logging
import time
from typing import Any, Optional, Union

import networkx as nx

from backend.graph.schema import (
    AnyNode,
    CodeGraph,
    ComponentNode,
    DataEntityNode,
    EdgeBase,
    EdgeType,
    EventNode,
    FunctionNode,
    GraphStats,
    InfrastructureNode,
    ModuleNode,
    RepositoryNode,
)

logger = logging.getLogger(__name__)


class GraphBuilder:
    """
    代码知识图谱构建器。

    将来自各分析器的节点和边整合为统一的 CodeGraph，
    并执行图论分析来增强节点的 metadata（重要性、中心性等）。

    示例::

        builder = GraphBuilder()
        builder.add_nodes(module_nodes)
        builder.add_nodes(function_nodes)
        builder.add_edges(call_edges)
        graph = builder.build(repo_node)
    """

    def __init__(self) -> None:
        self._nodes: dict[str, AnyNode] = {}  # id -> node
        self._edges: list[EdgeBase] = []
        self._start_time: float = time.time()

    def add_node(self, node: AnyNode) -> None:
        """
        添加单个节点。

        重复添加同一 ID 的节点时，以后者覆盖前者。

        Args:
            node: 任意类型的图节点
        """
        self._nodes[node.id] = node

    def add_nodes(self, nodes: list[AnyNode]) -> None:
        """
        批量添加节点。

        Args:
            nodes: 节点列表
        """
        for node in nodes:
            self.add_node(node)

    def add_edge(self, edge: EdgeBase) -> None:
        """
        添加单条边。

        如果边两端的节点均存在，才会添加；否则记录警告。

        Args:
            edge: 图边对象
        """
        if edge.source_id not in self._nodes:
            logger.debug(f"边 {edge.type} 源节点不存在: {edge.source_id}")
        if edge.target_id not in self._nodes:
            logger.debug(f"边 {edge.type} 目标节点不存在: {edge.target_id}")
        self._edges.append(edge)

    def add_edges(self, edges: list[EdgeBase]) -> None:
        """
        批量添加边。

        Args:
            edges: 边列表
        """
        for edge in edges:
            self.add_edge(edge)

    def build(self, repo_node: RepositoryNode) -> CodeGraph:
        """
        构建完整的 CodeGraph。

        Args:
            repo_node: 仓库根节点

        Returns:
            完整的 CodeGraph 对象，包含图论分析结果
        """
        # 确保 repo_node 在节点集合中
        self.add_node(repo_node)

        # 去重边
        deduped_edges = self._deduplicate_edges()

        # 构建 NetworkX 图用于分析
        nx_graph = self._build_nx_graph(deduped_edges)

        # 计算图论指标并增强节点 metadata
        self._enrich_with_graph_metrics(nx_graph)

        # 语言分布统计
        lang_dist: dict[str, int] = {}
        for node in self._nodes.values():
            lang = node.metadata.get("language", "")
            if lang:
                lang_dist[lang] = lang_dist.get(lang, 0) + 1

        duration = time.time() - self._start_time
        stats = GraphStats(
            node_count=len(self._nodes),
            edge_count=len(deduped_edges),
            language_distribution=lang_dist,
            analysis_duration_seconds=round(duration, 2),
        )

        nodes_list = list(self._nodes.values())
        graph = CodeGraph(
            repository=repo_node,
            nodes=nodes_list,
            edges=deduped_edges,
            stats=stats,
        )

        logger.info(
            f"图谱构建完成: {stats.node_count} 节点, "
            f"{stats.edge_count} 边, 耗时 {stats.analysis_duration_seconds}s"
        )
        return graph

    def _deduplicate_edges(self) -> list[EdgeBase]:
        """
        去除重复边（相同 source_id + target_id + type 视为重复）。

        当存在重复时，保留 weight 最高的一条，
        并将其余边的 metadata 合并进保留边。
        """
        edge_map: dict[tuple[str, str, str], EdgeBase] = {}

        for edge in self._edges:
            key = (edge.source_id, edge.target_id, str(edge.type))
            existing = edge_map.get(key)
            if existing is None:
                edge_map[key] = edge
            elif edge.weight > existing.weight:
                edge_map[key] = edge

        return list(edge_map.values())

    def _build_nx_graph(self, edges: list[EdgeBase]) -> nx.DiGraph:
        """将图谱边转换为 NetworkX 有向图。"""
        G = nx.DiGraph()
        for node_id in self._nodes:
            G.add_node(node_id)
        for edge in edges:
            G.add_edge(
                edge.source_id,
                edge.target_id,
                weight=edge.weight,
                edge_type=str(edge.type),
            )
        return G

    def _enrich_with_graph_metrics(self, G: nx.DiGraph) -> None:
        """
        计算图论指标并写入各节点的 metadata。

        计算指标：
        - in_degree: 入度（被引用次数）
        - out_degree: 出度（引用他人次数）
        - pagerank: PageRank 重要性分数
        """
        if G.number_of_nodes() == 0:
            return

        try:
            pagerank = nx.pagerank(G, max_iter=100, tol=1e-4)
        except Exception:
            pagerank = {n: 1.0 / G.number_of_nodes() for n in G.nodes()}

        for node_id, node in self._nodes.items():
            node.metadata["in_degree"] = G.in_degree(node_id) if node_id in G else 0
            node.metadata["out_degree"] = G.out_degree(node_id) if node_id in G else 0
            node.metadata["pagerank"] = round(pagerank.get(node_id, 0.0), 6)

    def get_stats(self) -> dict[str, Any]:
        """返回当前构建状态统计。"""
        return {
            "node_count": len(self._nodes),
            "edge_count": len(self._edges),
            "node_types": self._count_node_types(),
        }

    def _count_node_types(self) -> dict[str, int]:
        """统计各类型节点数量。"""
        counts: dict[str, int] = {}
        for node in self._nodes.values():
            t = str(node.type)
            counts[t] = counts.get(t, 0) + 1
        return counts
