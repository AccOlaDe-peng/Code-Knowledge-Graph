"""代码知识图谱 Schema 定义。

定义通用节点类型、边类型，以及 GraphNode、GraphEdge、GraphSchema
数据结构，并提供完整的图谱验证能力。
"""

from __future__ import annotations

from enum import Enum
from typing import Any, NamedTuple
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class NodeType(str, Enum):
    """节点类型。"""

    REPOSITORY = "Repository"
    MODULE = "Module"
    FILE = "File"
    CLASS = "Class"
    FUNCTION = "Function"
    COMPONENT = "Component"
    SERVICE = "Service"
    API = "API"
    DATA_OBJECT = "DataObject"
    TABLE = "Table"
    EVENT = "Event"
    TOPIC = "Topic"
    PIPELINE = "Pipeline"
    CLUSTER = "Cluster"
    DATABASE = "Database"


class EdgeType(str, Enum):
    """边（关系）类型。"""

    CONTAINS = "contains"
    DEFINES = "defines"
    CALLS = "calls"
    DEPENDS_ON = "depends_on"
    IMPLEMENTS = "implements"
    READS = "reads"
    WRITES = "writes"
    PRODUCES = "produces"
    CONSUMES = "consumes"
    PUBLISHES = "publishes"
    SUBSCRIBES = "subscribes"
    DEPLOYED_ON = "deployed_on"
    USES = "uses"
    ROUTES_TO = "routes_to"
    TRIGGERS = "triggers"


# ---------------------------------------------------------------------------
# Core Data Models
# ---------------------------------------------------------------------------

_VALID_NODE_TYPES: frozenset[str] = frozenset(t.value for t in NodeType)
_VALID_EDGE_TYPES: frozenset[str] = frozenset(t.value for t in EdgeType)


class GraphNode(BaseModel):
    """图谱节点。"""

    model_config = ConfigDict(use_enum_values=True)

    id: str = Field(default_factory=lambda: str(uuid4()), description="节点唯一标识")
    type: str = Field(description="节点类型")
    name: str = Field(description="节点名称")
    properties: dict[str, Any] = Field(default_factory=dict, description="节点属性")


class GraphEdge(BaseModel):
    """图谱边（关系）。

    Note:
        因 ``from`` 是 Python 保留字，Python 侧使用 ``from_`` 访问，
        序列化 / 反序列化时仍使用 ``"from"``。
    """

    model_config = ConfigDict(use_enum_values=True, populate_by_name=True)

    from_: str = Field(alias="from", description="源节点 ID")
    to: str = Field(description="目标节点 ID")
    type: str = Field(description="关系类型")
    properties: dict[str, Any] = Field(default_factory=dict, description="边属性")


# ---------------------------------------------------------------------------
# Validation Result
# ---------------------------------------------------------------------------


class ValidationError(NamedTuple):
    """单条验证错误。"""

    location: str   # 格式: "node:<id>" 或 "edge:<from>-><to>"
    message: str


class ValidationResult(NamedTuple):
    """图谱验证结果。"""

    valid: bool
    errors: list[ValidationError]

    def __str__(self) -> str:
        if self.valid:
            return "Graph is valid."
        lines = [f"Graph has {len(self.errors)} error(s):"]
        lines.extend(f"  [{e.location}] {e.message}" for e in self.errors)
        return "\n".join(lines)


# ---------------------------------------------------------------------------
# GraphSchema
# ---------------------------------------------------------------------------


class GraphSchema(BaseModel):
    """代码知识图谱，持有所有节点与边，并提供三层验证方法。

    Usage::

        schema = GraphSchema(nodes=[...], edges=[...])
        result = schema.validate_graph()
        if not result.valid:
            print(result)
    """

    nodes: list[GraphNode] = Field(default_factory=list, description="图谱节点列表")
    edges: list[GraphEdge] = Field(default_factory=list, description="图谱边列表")

    # ---------- type registry ----------

    @staticmethod
    def valid_node_types() -> frozenset[str]:
        """返回所有合法节点类型值。"""
        return _VALID_NODE_TYPES

    @staticmethod
    def valid_edge_types() -> frozenset[str]:
        """返回所有合法边类型值。"""
        return _VALID_EDGE_TYPES

    # ---------- validate_node ----------

    @staticmethod
    def validate_node(node: GraphNode) -> list[ValidationError]:
        """验证单个节点，返回错误列表（空列表表示合法）。

        检查项：
        - id 非空
        - name 非空
        - type 属于已知节点类型
        - properties 为 dict
        """
        errors: list[ValidationError] = []
        loc = f"node:{node.id}"

        if not node.id:
            errors.append(ValidationError(loc, "id 不能为空"))
        if not node.name or not node.name.strip():
            errors.append(ValidationError(loc, "name 不能为空"))
        if node.type not in _VALID_NODE_TYPES:
            errors.append(
                ValidationError(
                    loc,
                    f"未知节点类型 '{node.type}'，合法值: {sorted(_VALID_NODE_TYPES)}",
                )
            )
        if not isinstance(node.properties, dict):
            errors.append(ValidationError(loc, "properties 必须为 dict"))

        return errors

    # ---------- validate_edge ----------

    @staticmethod
    def validate_edge(
        edge: GraphEdge,
        node_ids: set[str] | None = None,
    ) -> list[ValidationError]:
        """验证单条边，返回错误列表。

        Args:
            edge: 待验证的边。
            node_ids: 图中已知节点 ID 集合；若提供则额外检查悬空引用。

        检查项：
        - from / to 非空
        - 非自环
        - type 属于已知边类型
        - properties 为 dict
        - （可选）from / to 节点存在于图中
        """
        errors: list[ValidationError] = []
        loc = f"edge:{edge.from_}->{edge.to}"

        if not edge.from_:
            errors.append(ValidationError(loc, "from 不能为空"))
        if not edge.to:
            errors.append(ValidationError(loc, "to 不能为空"))
        if edge.from_ and edge.to and edge.from_ == edge.to:
            errors.append(ValidationError(loc, "自环边：from 与 to 相同"))
        if edge.type not in _VALID_EDGE_TYPES:
            errors.append(
                ValidationError(
                    loc,
                    f"未知边类型 '{edge.type}'，合法值: {sorted(_VALID_EDGE_TYPES)}",
                )
            )
        if not isinstance(edge.properties, dict):
            errors.append(ValidationError(loc, "properties 必须为 dict"))

        if node_ids is not None:
            if edge.from_ and edge.from_ not in node_ids:
                errors.append(ValidationError(loc, f"源节点 '{edge.from_}' 不存在于图中"))
            if edge.to and edge.to not in node_ids:
                errors.append(ValidationError(loc, f"目标节点 '{edge.to}' 不存在于图中"))

        return errors

    # ---------- validate_graph ----------

    def validate_graph(self) -> ValidationResult:
        """验证整个图谱，包含节点合法性、边合法性和引用完整性三层检查。

        检查项：
        - 每个节点通过 validate_node
        - 节点 ID 不重复
        - 每条边通过 validate_edge（含悬空引用检查）
        """
        errors: list[ValidationError] = []

        # 1. 节点验证 + 重复 ID 检查
        seen_ids: set[str] = set()
        node_ids: set[str] = set()
        for node in self.nodes:
            errors.extend(self.validate_node(node))
            if node.id in seen_ids:
                errors.append(ValidationError(f"node:{node.id}", "节点 ID 重复"))
            else:
                seen_ids.add(node.id)
                node_ids.add(node.id)

        # 2. 边验证（含引用完整性）
        for edge in self.edges:
            errors.extend(self.validate_edge(edge, node_ids=node_ids))

        return ValidationResult(valid=len(errors) == 0, errors=errors)
