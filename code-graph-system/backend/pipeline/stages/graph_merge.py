"""Stage 4: 图谱合并 — 与现有 GraphBuilder 无缝对接。"""
from __future__ import annotations

import logging
from typing import Callable

from backend.graph.graph_builder import BuiltGraph, GraphBuilder
from backend.graph.graph_schema import GraphEdge, GraphNode
from backend.pipeline.stages.base import StageBase

logger = logging.getLogger(__name__)


class GraphMergeStage(StageBase):
    """Stage 4: 合并所有节点/边，构建 BuiltGraph。"""

    name = "graph_merge"

    def run(
        self,
        nodes: list[GraphNode],
        edges: list[GraphEdge],
        on_progress: Callable | None = None,
    ) -> BuiltGraph:
        if on_progress:
            on_progress(
                {"step": "graph_merge", "status": "start", "message": "构建图谱..."}
            )

        builder = GraphBuilder()
        for node in nodes:
            builder.add_node(node)
        for edge in edges:
            builder.add_edge(edge)

        built = builder.build()
        msg = f"图谱构建完成: {built.node_count} 节点, {built.edge_count} 边"
        logger.info("Stage 4 完成: %s", msg)
        if on_progress:
            on_progress(
                {"step": "graph_merge", "status": "complete", "message": msg}
            )

        return built
