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
    """节点类型。

    静态分析产生的类型（步骤 1–8）：
        REPOSITORY, MODULE, FILE, CLASS, FUNCTION, COMPONENT,
        SERVICE, API, DATA_OBJECT, TABLE, EVENT, TOPIC,
        PIPELINE, CLUSTER, DATABASE

    AI 分析产生的类型（步骤 10–13，enable_ai=True）：
        LAYER           — 架构层（Presentation / Business / Data / Domain）
        FLOW            — 泛用业务流 / 用例路径
        BUSINESS_FLOW   — 明确的端到端业务流程（AIBusinessFlowAnalyzer 生成）
        DOMAIN          — 顶层业务领域区域（如 OrderManagement / UserManagement）
        BOUNDED_CONTEXT — DDD 有界上下文，包含若干 DOMAIN_ENTITY
        DOMAIN_ENTITY   — DDD 具体实体：aggregate_root / entity / value_object 等
    """

    # ── 静态分析类型 ──────────────────────────────────────────────────
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

    # ── V2 AI 分析类型 ────────────────────────────────────────────────
    LAYER = "Layer"                    # Architecture layer
    FLOW = "Flow"                      # Generic flow / use-case path (kept for compat)
    BUSINESS_FLOW = "BusinessFlow"     # Explicit end-to-end business process
    DOMAIN = "Domain"                  # Top-level business domain area
    BOUNDED_CONTEXT = "BoundedContext" # DDD bounded context
    DOMAIN_ENTITY = "DomainEntity"     # DDD entity / aggregate root / value object


class EdgeType(str, Enum):
    """边（关系）类型。

    静态分析产生的关系（步骤 1–8）：
        contains, defines, calls, depends_on, implements,
        reads, writes, produces, consumes, publishes, subscribes,
        deployed_on, uses, routes_to, triggers

    AI 分析产生的关系（步骤 10–13，enable_ai=True）：
        belongs_to  — 节点归属于架构层或领域
        flow_step   — 业务流程的执行步骤
        implements  — 类/服务实现某个接口或契约（与静态共用）
        transforms  — 数据实体间的转换关系
        part_of     — 实体归属于聚合或有界上下文
        contains    — 父子包含关系（与静态共用）
    """

    # ── 静态分析关系 ──────────────────────────────────────────────────
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

    # ── V2 AI 分析关系 ────────────────────────────────────────────────
    BELONGS_TO = "belongs_to"  # Node belongs to an architecture layer or domain
    FLOW_STEP = "flow_step"    # Step within a business / use-case flow
    TRANSFORMS = "transforms"  # Data transformation between entities
    PART_OF = "part_of"        # Entity is part of an aggregate or bounded context


# ---------------------------------------------------------------------------
# Core Data Models
# ---------------------------------------------------------------------------

_VALID_NODE_TYPES: frozenset[str] = frozenset(t.value for t in NodeType)
_VALID_EDGE_TYPES: frozenset[str] = frozenset(t.value for t in EdgeType)

# Expected property keys for each AI-generated node type.
# Used by validate_graph() to emit targeted warnings.
# Values are (required_props, recommended_props).
_NODE_EXPECTED_PROPS: dict[str, tuple[frozenset[str], frozenset[str]]] = {
    NodeType.LAYER.value: (
        frozenset({"layer_index"}),
        frozenset({"description", "pattern"}),
    ),
    NodeType.BUSINESS_FLOW.value: (
        frozenset({"trigger"}),
        frozenset({"description", "domain", "steps_count"}),
    ),
    NodeType.FLOW.value: (
        frozenset(),
        frozenset({"trigger", "description"}),
    ),
    NodeType.DOMAIN.value: (
        frozenset(),
        frozenset({"description", "bounded_contexts"}),
    ),
    NodeType.BOUNDED_CONTEXT.value: (
        frozenset(),
        frozenset({"description"}),
    ),
    NodeType.DOMAIN_ENTITY.value: (
        frozenset({"entity_type"}),
        frozenset({"bounded_context", "description"}),
    ),
    NodeType.SERVICE.value: (
        frozenset(),
        frozenset({"responsibility"}),
    ),
}


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
    severity: str = "error"  # "error" | "warning"


class ValidationResult(NamedTuple):
    """图谱验证结果。

    Attributes:
        valid:    True 当且仅当没有 severity="error" 的条目。
        errors:   所有条目（含 error 和 warning）。
    """

    valid: bool
    errors: list[ValidationError]

    @property
    def hard_errors(self) -> list[ValidationError]:
        """仅返回 severity="error" 的条目。"""
        return [e for e in self.errors if e.severity == "error"]

    @property
    def warnings(self) -> list[ValidationError]:
        """仅返回 severity="warning" 的条目。"""
        return [e for e in self.errors if e.severity == "warning"]

    def __str__(self) -> str:
        if self.valid and not self.warnings:
            return "Graph is valid."
        lines = []
        hard = self.hard_errors
        soft = self.warnings
        if hard:
            lines.append(f"Graph has {len(hard)} error(s):")
            lines.extend(f"  [ERROR][{e.location}] {e.message}" for e in hard)
        if soft:
            lines.append(f"Graph has {len(soft)} warning(s):")
            lines.extend(f"  [WARN] [{e.location}] {e.message}" for e in soft)
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
        """验证单个节点结构，返回错误列表（空列表表示合法）。

        检查项（所有类型通用）：
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

    # ---------- validate_node_semantics ----------

    @staticmethod
    def validate_node_semantics(node: GraphNode) -> list[ValidationError]:
        """验证节点的类型专属属性，返回 warning 级别的条目。

        对于 AI 生成节点（LAYER / BUSINESS_FLOW / DOMAIN / BOUNDED_CONTEXT /
        DOMAIN_ENTITY / SERVICE）检查必要属性是否存在。
        其他类型直接通过。

        返回的条目 severity 均为 "warning"，不影响 valid 标志。
        """
        expectations = _NODE_EXPECTED_PROPS.get(node.type)
        if not expectations or not isinstance(node.properties, dict):
            return []

        required_props, _ = expectations
        loc = f"node:{node.id}"
        return [
            ValidationError(
                loc,
                f"[{node.type}] 节点缺少推荐属性 '{prop}'",
                severity="warning",
            )
            for prop in sorted(required_props)
            if prop not in node.properties
        ]

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

    def validate_graph(
        self,
        *,
        check_semantics: bool = True,
    ) -> ValidationResult:
        """验证整个图谱，三层结构检查 + 可选的语义属性检查。

        Args:
            check_semantics: 若为 True（默认），额外调用
                             ``validate_node_semantics`` 对 AI 生成节点
                             发出 warning 级别的属性提示。

        检查层：
        - 第 1 层：节点结构（id/name/type/properties 合法性 + ID 去重）
        - 第 2 层：边结构（from/to/type 合法性 + 悬空引用）
        - 第 3 层：语义属性（AI 节点必要 properties，severity=warning）

        valid=True 当且仅当第 1、2 层无 error；第 3 层 warning 不影响 valid。
        """
        all_issues: list[ValidationError] = []

        # ── Layer 1: node structure + duplicate IDs ────────────────────
        seen_ids: set[str] = set()
        node_ids: set[str] = set()
        for node in self.nodes:
            all_issues.extend(self.validate_node(node))
            if node.id in seen_ids:
                all_issues.append(ValidationError(f"node:{node.id}", "节点 ID 重复"))
            else:
                seen_ids.add(node.id)
                node_ids.add(node.id)

        # ── Layer 2: edge structure + dangling references ──────────────
        for edge in self.edges:
            all_issues.extend(self.validate_edge(edge, node_ids=node_ids))

        # ── Layer 3: semantic property hints (warnings only) ──────────
        if check_semantics:
            for node in self.nodes:
                all_issues.extend(self.validate_node_semantics(node))

        hard_error_count = sum(
            1 for e in all_issues if e.severity == "error"
        )
        return ValidationResult(valid=hard_error_count == 0, errors=all_issues)
