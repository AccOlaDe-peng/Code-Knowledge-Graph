"""AI 优先分析数据模型。

定义 AI 优先流水线所需的数据结构，包括实体、字段、关系、血缘等。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: 仓库扫描 - 候选结构
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class EntityCandidate:
    """实体候选（Stage 1 输出）。"""

    class_name: str  # 类名
    file_path: str  # 文件路径
    table_name: str | None = None  # 表名（从 @Table 注解提取）
    primary_key: str | None = None  # 主键字段名
    brief_description: str = ""  # 简要描述


@dataclass
class FlowCandidate:
    """流程候选（Stage 1 输出）。"""

    class_name: str  # 类名
    file_path: str  # 文件路径
    flow_type: str = "flow"  # 流程类型：flow / playbook / workflow
    key: str | None = None  # 流程关键字
    brief_description: str = ""  # 简要描述


@dataclass
class FlowNodeCandidate:
    """流程节点候选（Stage 1 输出）。"""

    class_name: str  # 类名
    file_path: str  # 文件路径
    node_type: str = "node"  # 节点类型
    parent_flow: str | None = None  # 所属流程
    brief_description: str = ""  # 简要描述


@dataclass
class ServiceCandidate:
    """服务候选（Stage 1 输出）。"""

    class_name: str  # 类名
    file_path: str  # 文件路径
    service_type: str = "service"  # 服务类型：service / component / controller
    annotations: list[str] = field(default_factory=list)  # 注解列表
    brief_description: str = ""  # 简要描述


@dataclass
class RepositoryCandidate:
    """Repository 候选（Stage 1 输出）。"""

    class_name: str  # 类名
    file_path: str  # 文件路径
    entity_type: str | None = None  # 关联的实体类型
    brief_description: str = ""  # 简要描述


@dataclass
class TopicCandidate:
    """消息主题候选（Stage 1 输出）。"""

    name: str  # Topic 名称
    source_file: str  # 定义位置
    source_element: str  # 定义元素（类名或方法名）
    topic_type: str = "kafka"  # 消息队列类型：kafka / rabbitmq / rocketmq
    pattern: str = "unknown"  # 模式：produce / consume / unknown
    brief_description: str = ""  # 简要描述


@dataclass
class RepositoryScanResult:
    """Stage 1 输出：仓库扫描结果。"""

    entities: list[EntityCandidate] = field(default_factory=list)
    flows: list[FlowCandidate] = field(default_factory=list)
    flow_nodes: list[FlowNodeCandidate] = field(default_factory=list)
    services: list[ServiceCandidate] = field(default_factory=list)
    repositories: list[RepositoryCandidate] = field(default_factory=list)
    topics: list[TopicCandidate] = field(default_factory=list)

    # 扫描统计
    stats: dict[str, Any] = field(default_factory=dict)


# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: 实体分析 - 字段和关系
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class FieldInfo:
    """字段信息（Stage 2 输出）。"""

    name: str  # 字段名
    type: str  # 字段类型
    column_name: str | None = None  # 数据库列名
    is_primary_key: bool = False  # 是否主键
    is_foreign_key: bool = False  # 是否外键
    is_nullable: bool = True  # 是否可空
    is_unique: bool = False  # 是否唯一
    default_value: str | None = None  # 默认值
    description: str = ""  # 字段描述

    # 外键引用
    references_entity: str | None = None  # 引用的实体名
    references_field: str | None = None  # 引用的字段名

    # 注解信息
    annotations: list[str] = field(default_factory=list)


@dataclass
class RelationshipInfo:
    """关系信息（Stage 2 输出）。"""

    relation_type: str  # 关系类型：one_to_one / one_to_many / many_to_one / many_to_many
    target_entity: str  # 目标实体名
    source_field: str | None = None  # 源字段（外键字段）
    target_field: str | None = None  # 目标字段（被引用字段）
    join_table: str | None = None  # 中间表名（多对多）
    join_column: str | None = None  # join 列名
    inverse_join_column: str | None = None  # 反向 join 列名
    is_bidirectional: bool = False  # 是否双向
    description: str = ""  # 关系描述
    confidence: float = 0.90  # 置信度


@dataclass
class EntityAnalysisResult:
    """Stage 2 输出：实体分析结果。"""

    entity_name: str  # 实体名
    file_path: str  # 文件路径
    table_name: str  # 表名
    primary_key: str  # 主键字段
    fields: list[FieldInfo] = field(default_factory=list)
    relationships: list[RelationshipInfo] = field(default_factory=list)

    # 索引信息
    indexes: list[dict[str, Any]] = field(default_factory=list)

    # 唯一约束
    unique_constraints: list[list[str]] = field(default_factory=list)

    # 描述
    description: str = ""

    # 元数据
    confidence: float = 0.90


# ─────────────────────────────────────────────────────────────────────────────
# Stage 3: 字段血缘
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class FieldLineage:
    """字段级血缘（Stage 3 输出）。"""

    # 源字段
    from_entity: str  # 源实体名
    from_field: str  # 源字段名

    # 目标字段
    to_entity: str  # 目标实体名
    to_field: str  # 目标字段名

    # 流转类型
    flow_type: str = "direct"  # direct / transformed / conditional
    # - direct: 直接传递，值不变
    # - transformed: 经过转换
    # - conditional: 条件性传递

    # 流转模式
    flow_pattern: str = ""  # 策略驱动 / 事件触发 / 定时调度 / 配置关联 / API调用

    # 转换逻辑（flow_type=transformed 时）
    transformation: str | None = None  # 转换逻辑描述

    # 条件（flow_type=conditional 时）
    condition: str | None = None  # 条件描述

    # 中间路径
    intermediate_entities: list[str] = field(default_factory=list)  # 中间经过的实体
    intermediate_methods: list[str] = field(default_factory=list)  # 中间经过的方法

    # 描述
    description: str = ""

    # 置信度
    confidence: float = 0.80


@dataclass
class FieldLineageResult:
    """Stage 3 输出：字段血缘分析结果。"""

    lineages: list[FieldLineage] = field(default_factory=list)

    # 统计信息
    stats: dict[str, Any] = field(default_factory=dict)


# ─────────────────────────────────────────────────────────────────────────────
# Stage 4: 描述生成
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class EntityDescription:
    """实体描述（Stage 4 输出）。"""

    entity_name: str  # 实体名

    # 功能描述
    summary: str  # 功能摘要（50-100字）
    role_in_system: str  # 在系统中的作用

    # 核心字段
    core_fields: list[str] = field(default_factory=list)

    # 重要性评分
    importance_score: int = 5  # 1-10
    importance_reason: str = ""  # 重要性原因

    # 业务语义
    business_domain: str = ""  # 业务领域
    business_value: str = ""  # 业务价值


@dataclass
class FieldDescription:
    """字段描述（Stage 4 输出）。"""

    entity_name: str  # 所属实体
    field_name: str  # 字段名

    # 功能描述
    description: str  # 字段含义描述

    # 业务语义
    business_meaning: str = ""  # 业务含义
    usage_scenario: str = ""  # 使用场景

    # 数据特征
    data_pattern: str = ""  # 数据模式（如 UUID、时间戳、枚举值等）
    example_value: str = ""  # 示例值


@dataclass
class FlowDescription:
    """流程描述（Stage 4 输出）。"""

    flow_name: str  # 流程名

    # 功能描述
    summary: str  # 功能摘要
    execution_logic: str  # 执行逻辑说明

    # 流程特征
    trigger_type: str = ""  # 触发类型：manual / scheduled / event / api
    typical_duration: str = ""  # 典型执行时长

    # 关联信息
    related_entities: list[str] = field(default_factory=list)  # 相关实体
    related_services: list[str] = field(default_factory=list)  # 相关服务


@dataclass
class DescriptionResult:
    """Stage 4 输出：描述生成结果。"""

    entity_descriptions: list[EntityDescription] = field(default_factory=list)
    field_descriptions: list[FieldDescription] = field(default_factory=list)
    flow_descriptions: list[FlowDescription] = field(default_factory=list)

    # 统计信息
    stats: dict[str, Any] = field(default_factory=dict)


# ─────────────────────────────────────────────────────────────────────────────
# 完整分析结果
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class AIFirstAnalysisResult:
    """AI 优先流水线完整分析结果。"""

    # 各 Stage 输出
    scan_result: RepositoryScanResult | None = None
    entity_results: list[EntityAnalysisResult] = field(default_factory=list)
    lineage_result: FieldLineageResult | None = None
    description_result: DescriptionResult | None = None

    # 图谱数据
    nodes: list[Any] = field(default_factory=list)  # GraphNode 列表
    edges: list[Any] = field(default_factory=list)  # GraphEdge 列表

    # 元数据
    graph_id: str = ""
    status: str = "pending"  # pending / success / partial / failed
    duration_seconds: float = 0.0

    # 错误信息
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic 输出模型（用于 LLM 响应解析）
# ─────────────────────────────────────────────────────────────────────────────

try:
    from pydantic import BaseModel, Field
    from typing import Optional

    class EntityCandidateResponse(BaseModel):
        """实体候选响应模型。"""

        class_name: str = Field(description="类名")
        file_path: str = Field(description="文件路径")
        table_name: Optional[str] = Field(default=None, description="表名")
        primary_key: Optional[str] = Field(default=None, description="主键字段名")
        brief_description: str = Field(default="", description="简要描述")

    class FlowCandidateResponse(BaseModel):
        """流程候选响应模型。"""

        class_name: str = Field(description="类名")
        file_path: str = Field(description="文件路径")
        flow_type: str = Field(default="flow", description="流程类型")
        key: Optional[str] = Field(default=None, description="流程关键字")
        brief_description: str = Field(default="", description="简要描述")

    class ServiceCandidateResponse(BaseModel):
        """服务候选响应模型。"""

        class_name: str = Field(description="类名")
        file_path: str = Field(description="文件路径")
        service_type: str = Field(default="service", description="服务类型")
        annotations: list[str] = Field(default_factory=list, description="注解列表")
        brief_description: str = Field(default="", description="简要描述")

    class RepositoryScanResponse(BaseModel):
        """仓库扫描响应模型。"""

        entities: list[EntityCandidateResponse] = Field(default_factory=list, description="实体列表")
        flows: list[FlowCandidateResponse] = Field(default_factory=list, description="流程列表")
        services: list[ServiceCandidateResponse] = Field(default_factory=list, description="服务列表")

    class FieldInfoResponse(BaseModel):
        """字段信息响应模型。"""

        name: str = Field(description="字段名")
        type: str = Field(description="字段类型")
        column_name: Optional[str] = Field(default=None, description="数据库列名")
        is_primary_key: bool = Field(default=False, description="是否主键")
        is_foreign_key: bool = Field(default=False, description="是否外键")
        references_entity: Optional[str] = Field(default=None, description="引用的实体名")
        references_field: Optional[str] = Field(default=None, description="引用的字段名")
        description: str = Field(default="", description="字段描述")

    class RelationshipInfoResponse(BaseModel):
        """关系信息响应模型。"""

        relation_type: str = Field(description="关系类型")
        target_entity: str = Field(description="目标实体名")
        source_field: Optional[str] = Field(default=None, description="源字段")
        target_field: Optional[str] = Field(default=None, description="目标字段")
        join_table: Optional[str] = Field(default=None, description="中间表名")
        description: str = Field(default="", description="关系描述")

    class EntityAnalysisResponse(BaseModel):
        """实体分析响应模型。"""

        entity_name: str = Field(description="实体名")
        table_name: str = Field(description="表名")
        primary_key: str = Field(description="主键字段")
        fields: list[FieldInfoResponse] = Field(default_factory=list, description="字段列表")
        relationships: list[RelationshipInfoResponse] = Field(default_factory=list, description="关系列表")

    class FieldLineageResponse(BaseModel):
        """字段血缘响应模型。"""

        from_entity: str = Field(description="源实体名")
        from_field: str = Field(description="源字段名")
        to_entity: str = Field(description="目标实体名")
        to_field: str = Field(description="目标字段名")
        flow_type: str = Field(default="direct", description="流转类型")
        flow_pattern: str = Field(default="", description="流转模式")
        description: str = Field(default="", description="描述")

    class FieldLineageListResponse(BaseModel):
        """字段血缘列表响应模型。"""

        field_lineages: list[FieldLineageResponse] = Field(default_factory=list, description="血缘列表")

    class EntityDescriptionResponse(BaseModel):
        """实体描述响应模型。"""

        entity_name: str = Field(description="实体名")
        summary: str = Field(description="功能摘要")
        role_in_system: str = Field(description="在系统中的作用")
        core_fields: list[str] = Field(default_factory=list, description="核心字段")
        importance_score: int = Field(default=5, ge=1, le=10, description="重要性评分")
        importance_reason: str = Field(default="", description="重要性原因")

except ImportError:
    # Pydantic 未安装时跳过
    pass
