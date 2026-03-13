"""OutputParser - 解析 Agent emit_graph 工具输出的 JSON。

将 Agent 输出的 JSON 转换为 GraphNode 和 GraphEdge 对象，
并进行容错处理（过滤非法节点/边）。
"""

import json
import logging
from typing import Any

from backend.graph.graph_schema import (
    GraphNode,
    GraphEdge,
    NodeType,
    EdgeType,
    GraphSchema,
)

logger = logging.getLogger(__name__)


class OutputParser:
    """解析 Agent 输出的图谱 JSON。

    容错策略：
    - 过滤非法节点类型（type 不在 NodeType 枚举中）
    - 过滤非法边类型（type 不在 EdgeType 枚举中）
    - 过滤悬空边（from/to 引用不存在的节点）
    - 记录 warning 但不中断
    - 返回合法子集
    """

    def __init__(self):
        """初始化 parser。"""
        self._valid_node_types = GraphSchema.valid_node_types()
        self._valid_edge_types = GraphSchema.valid_edge_types()

    def parse(self, json_output: str) -> dict[str, Any]:
        """解析 JSON 输出为图谱对象。

        Args:
            json_output: Agent 输出的 JSON 字符串

        Returns:
            包含 nodes, edges, meta 的字典：
            {
                "nodes": [GraphNode],
                "edges": [GraphEdge],
                "meta": {...}
            }

        Raises:
            ValueError: JSON 格式错误
        """
        # 解析 JSON
        try:
            data = json.loads(json_output)
        except json.JSONDecodeError as e:
            raise ValueError(f"无效的 JSON 格式: {e}") from e

        # 提取原始数据
        raw_nodes = data.get("nodes", [])
        raw_edges = data.get("edges", [])

        # 第一步：解析并过滤节点
        valid_nodes: list[GraphNode] = []
        valid_node_ids: set[str] = set()

        for raw_node in raw_nodes:
            try:
                node = self._parse_node(raw_node)
                if node:
                    valid_nodes.append(node)
                    valid_node_ids.add(node.id)
            except Exception as e:
                logger.warning(f"跳过无效节点 {raw_node.get('id', 'unknown')}: {e}")

        # 第二步：解析并过滤边
        valid_edges: list[GraphEdge] = []

        for raw_edge in raw_edges:
            try:
                edge = self._parse_edge(raw_edge, valid_node_ids)
                if edge:
                    valid_edges.append(edge)
            except Exception as e:
                logger.warning(
                    f"跳过无效边 {raw_edge.get('from', '?')}->{raw_edge.get('to', '?')}: {e}"
                )

        # 提取 meta 信息
        meta = {
            k: v
            for k, v in data.items()
            if k not in ("nodes", "edges")
        }

        logger.info(
            f"解析完成: {len(valid_nodes)}/{len(raw_nodes)} 节点, "
            f"{len(valid_edges)}/{len(raw_edges)} 边"
        )

        return {
            "nodes": valid_nodes,
            "edges": valid_edges,
            "meta": meta,
        }

    def _parse_node(self, raw_node: dict[str, Any]) -> GraphNode | None:
        """解析单个节点，返回 None 表示应过滤。

        Args:
            raw_node: 原始节点字典

        Returns:
            GraphNode 或 None（非法节点）
        """
        node_type = raw_node.get("type", "")

        # 检查类型合法性
        if node_type not in self._valid_node_types:
            logger.warning(
                f"过滤非法节点类型: {node_type} (id={raw_node.get('id', 'unknown')})"
            )
            return None

        # 构造 GraphNode
        try:
            node = GraphNode(
                id=raw_node.get("id", ""),
                type=node_type,
                name=raw_node.get("name", ""),
                properties=raw_node.get("properties", {}),
            )
            return node
        except Exception as e:
            logger.warning(f"节点构造失败: {e}")
            return None

    def _parse_edge(
        self,
        raw_edge: dict[str, Any],
        valid_node_ids: set[str],
    ) -> GraphEdge | None:
        """解析单条边，返回 None 表示应过滤。

        Args:
            raw_edge: 原始边字典
            valid_node_ids: 合法节点 ID 集合

        Returns:
            GraphEdge 或 None（非法边）
        """
        edge_type = raw_edge.get("type", "")
        from_id = raw_edge.get("from", "")
        to_id = raw_edge.get("to", "")

        # 检查类型合法性
        if edge_type not in self._valid_edge_types:
            logger.warning(
                f"过滤非法边类型: {edge_type} ({from_id}->{to_id})"
            )
            return None

        # 检查节点引用
        if from_id not in valid_node_ids:
            logger.warning(
                f"过滤悬空边: 源节点 {from_id} 不存在 ({from_id}->{to_id})"
            )
            return None

        if to_id not in valid_node_ids:
            logger.warning(
                f"过滤悬空边: 目标节点 {to_id} 不存在 ({from_id}->{to_id})"
            )
            return None

        # 构造 GraphEdge
        try:
            edge = GraphEdge(
                from_=from_id,
                to=to_id,
                type=edge_type,
                properties=raw_edge.get("properties", {}),
            )
            return edge
        except Exception as e:
            logger.warning(f"边构造失败: {e}")
            return None
