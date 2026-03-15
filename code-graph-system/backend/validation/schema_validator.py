"""图谱 Schema 验证器。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from backend.graph.graph_schema import (
    GraphNode,
    GraphEdge,
    NodeType,
    EdgeType,
    GraphSchema,
)


@dataclass
class ValidationError:
    """验证错误。"""
    location: str
    message: str
    severity: str = "error"  # "error" | "warning"


@dataclass
class ValidationResult:
    """验证结果。"""
    valid: bool
    errors: list[ValidationError] = field(default_factory=list)

    @property
    def warnings(self) -> list[ValidationError]:
        return [e for e in self.errors if e.severity == "warning"]

    @property
    def hard_errors(self) -> list[ValidationError]:
        return [e for e in self.errors if e.severity == "error"]


class SchemaValidator:
    """图谱 Schema 验证器。

    封装 GraphSchema 的验证功能，提供更友好的 API。
    """

    def __init__(self):
        self._valid_node_types = frozenset(t.value for t in NodeType)
        self._valid_edge_types = frozenset(t.value for t in EdgeType)

    def validate_node(self, node: GraphNode) -> list[ValidationError]:
        """验证单个节点。"""
        errors = []
        loc = f"node:{node.id}"

        if not node.id:
            errors.append(ValidationError(loc, "节点 ID 不能为空"))

        if not node.name or not node.name.strip():
            errors.append(ValidationError(loc, "节点名称不能为空"))

        if node.type not in self._valid_node_types:
            errors.append(ValidationError(
                loc,
                f"未知节点类型 '{node.type}'，合法值: {sorted(self._valid_node_types)}"
            ))

        if not isinstance(node.properties, dict):
            errors.append(ValidationError(loc, "properties 必须为 dict"))

        return errors

    def validate_edge(
        self,
        edge: GraphEdge,
        node_ids: set[str] | None = None
    ) -> list[ValidationError]:
        """验证单条边。"""
        errors = []
        loc = f"edge:{edge.from_}->{edge.to}"

        if not edge.from_:
            errors.append(ValidationError(loc, "from 不能为空"))

        if not edge.to:
            errors.append(ValidationError(loc, "to 不能为空"))

        if edge.from_ and edge.to and edge.from_ == edge.to:
            errors.append(ValidationError(loc, "自环边：from 与 to 相同"))

        if edge.type not in self._valid_edge_types:
            errors.append(ValidationError(
                loc,
                f"未知边类型 '{edge.type}'，合法值: {sorted(self._valid_edge_types)}"
            ))

        if not isinstance(edge.properties, dict):
            errors.append(ValidationError(loc, "properties 必须为 dict"))

        # 检查悬空引用
        if node_ids is not None:
            if edge.from_ and edge.from_ not in node_ids:
                errors.append(ValidationError(loc, f"源节点 '{edge.from_}' 不存在"))
            if edge.to and edge.to not in node_ids:
                errors.append(ValidationError(loc, f"目标节点 '{edge.to}' 不存在"))

        return errors

    def validate_graph(
        self,
        nodes: list[GraphNode],
        edges: list[GraphEdge],
        check_duplicates: bool = True,
    ) -> ValidationResult:
        """验证整个图谱。"""
        all_errors: list[ValidationError] = []
        seen_ids: set[str] = set()
        node_ids: set[str] = set()

        # 验证节点
        for node in nodes:
            all_errors.extend(self.validate_node(node))

            if check_duplicates:
                if node.id in seen_ids:
                    all_errors.append(ValidationError(
                        f"node:{node.id}",
                        "节点 ID 重复"
                    ))
                else:
                    seen_ids.add(node.id)
                node_ids.add(node.id)

        # 验证边
        for edge in edges:
            all_errors.extend(self.validate_edge(edge, node_ids))

        # 判断是否有效
        valid = all(e.severity == "warning" for e in all_errors)

        return ValidationResult(valid=valid, errors=all_errors)