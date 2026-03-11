"""
图谱数据模型定义模块。

使用 Pydantic v2 定义所有图谱节点、边和查询响应的数据结构，
与 graph_schema.json 保持一致。
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Optional, Union
from uuid import uuid4

from pydantic import BaseModel, Field, model_validator


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class NodeType(str, Enum):
    """节点类型枚举。"""

    REPOSITORY = "Repository"
    MODULE = "Module"
    COMPONENT = "Component"
    FUNCTION = "Function"
    DATA_ENTITY = "DataEntity"
    EVENT = "Event"
    INFRASTRUCTURE = "Infrastructure"


class EdgeType(str, Enum):
    """边（关系）类型枚举。"""

    CONTAINS = "CONTAINS"
    IMPORTS = "IMPORTS"
    CALLS = "CALLS"
    INHERITS = "INHERITS"
    IMPLEMENTS = "IMPLEMENTS"
    USES = "USES"
    READS = "READS"
    WRITES = "WRITES"
    EMITS = "EMITS"
    LISTENS = "LISTENS"
    DEPENDS_ON = "DEPENDS_ON"
    DEPLOYED_ON = "DEPLOYED_ON"
    TRIGGERS = "TRIGGERS"
    TRANSFORMS = "TRANSFORMS"


class ComponentType(str, Enum):
    """组件类型枚举。"""

    CLASS = "class"
    INTERFACE = "interface"
    STRUCT = "struct"
    ENUM = "enum"
    TRAIT = "trait"
    MIXIN = "mixin"


class EntityType(str, Enum):
    """数据实体类型枚举。"""

    TABLE = "table"
    MODEL = "model"
    SCHEMA = "schema"
    COLLECTION = "collection"
    QUEUE = "queue"
    TOPIC = "topic"


class EventType(str, Enum):
    """事件类型枚举。"""

    EMIT = "emit"
    LISTEN = "listen"
    PUBLISH = "publish"
    SUBSCRIBE = "subscribe"
    WEBHOOK = "webhook"
    SIGNAL = "signal"


class InfraType(str, Enum):
    """基础设施类型枚举。"""

    DATABASE = "database"
    CACHE = "cache"
    QUEUE = "queue"
    STORAGE = "storage"
    API = "api"
    SERVICE = "service"
    CONTAINER = "container"


# ---------------------------------------------------------------------------
# Base Models
# ---------------------------------------------------------------------------


class NodeBase(BaseModel):
    """所有图节点的基础模型。"""

    id: str = Field(default_factory=lambda: str(uuid4()), description="节点唯一标识符")
    type: NodeType = Field(description="节点类型")
    name: str = Field(description="节点名称")
    file_path: Optional[str] = Field(default=None, description="所在文件路径")
    line_start: Optional[int] = Field(default=None, ge=1, description="起始行号")
    line_end: Optional[int] = Field(default=None, ge=1, description="结束行号")
    metadata: dict[str, Any] = Field(default_factory=dict, description="扩展元数据")
    embedding: Optional[list[float]] = Field(default=None, description="语义嵌入向量")
    created_at: datetime = Field(default_factory=lambda: datetime.now())
    updated_at: datetime = Field(default_factory=lambda: datetime.now())

    model_config = {"use_enum_values": True}


class EdgeBase(BaseModel):
    """所有图边的基础模型。"""

    id: str = Field(default_factory=lambda: str(uuid4()), description="边唯一标识符")
    type: EdgeType = Field(description="关系类型")
    source_id: str = Field(description="源节点ID")
    target_id: str = Field(description="目标节点ID")
    weight: float = Field(default=1.0, ge=0.0, le=1.0, description="关系权重")
    metadata: dict[str, Any] = Field(default_factory=dict, description="扩展元数据")
    created_at: datetime = Field(default_factory=datetime.utcnow)

    model_config = {"use_enum_values": True}


# ---------------------------------------------------------------------------
# Node Models
# ---------------------------------------------------------------------------


class RepositoryNode(NodeBase):
    """代码仓库节点，作为图谱的根节点。"""

    type: NodeType = Field(default=NodeType.REPOSITORY)
    url: Optional[str] = Field(default=None, description="仓库URL")
    language: Optional[str] = Field(default=None, description="主要编程语言")
    branch: str = Field(default="main", description="分支名称")
    commit_hash: Optional[str] = Field(default=None, description="当前提交哈希")
    description: Optional[str] = Field(default=None, description="仓库描述")


class ModuleNode(NodeBase):
    """模块/包节点，对应一个文件或目录包。"""

    type: NodeType = Field(default=NodeType.MODULE)
    package: Optional[str] = Field(default=None, description="所属包路径")
    is_package: bool = Field(default=False, description="是否为包（目录）")
    exports: list[str] = Field(default_factory=list, description="导出的符号列表")
    imports: list[str] = Field(default_factory=list, description="导入的模块列表")


class FunctionParameter(BaseModel):
    """函数参数模型。"""

    name: str = Field(description="参数名称")
    type: Optional[str] = Field(default=None, description="参数类型注解")
    default: Optional[str] = Field(default=None, description="默认值")


class ComponentNode(NodeBase):
    """类/接口/结构体等组件节点。"""

    type: NodeType = Field(default=NodeType.COMPONENT)
    component_type: ComponentType = Field(default=ComponentType.CLASS, description="组件类型")
    is_abstract: bool = Field(default=False, description="是否为抽象类")
    methods: list[str] = Field(default_factory=list, description="方法名称列表")
    attributes: list[str] = Field(default_factory=list, description="属性名称列表")
    base_classes: list[str] = Field(default_factory=list, description="父类名称列表")


class FunctionNode(NodeBase):
    """函数/方法节点。"""

    type: NodeType = Field(default=NodeType.FUNCTION)
    signature: Optional[str] = Field(default=None, description="函数签名")
    parameters: list[FunctionParameter] = Field(default_factory=list, description="参数列表")
    return_type: Optional[str] = Field(default=None, description="返回类型")
    is_async: bool = Field(default=False, description="是否为异步函数")
    is_generator: bool = Field(default=False, description="是否为生成器")
    decorators: list[str] = Field(default_factory=list, description="装饰器列表")
    complexity: int = Field(default=1, ge=1, description="圈复杂度")
    docstring: Optional[str] = Field(default=None, description="函数文档字符串")


class DataField(BaseModel):
    """数据字段模型。"""

    name: str = Field(description="字段名称")
    type: Optional[str] = Field(default=None, description="字段类型")
    nullable: bool = Field(default=True, description="是否可为空")
    primary_key: bool = Field(default=False, description="是否为主键")


class DataEntityNode(NodeBase):
    """数据实体节点（数据库表、ORM模型等）。"""

    type: NodeType = Field(default=NodeType.DATA_ENTITY)
    entity_type: EntityType = Field(default=EntityType.MODEL, description="实体类型")
    fields: list[DataField] = Field(default_factory=list, description="字段列表")
    database: Optional[str] = Field(default=None, description="所属数据库名")
    schema_name: Optional[str] = Field(default=None, description="Schema名称")


class EventNode(NodeBase):
    """事件节点（消息发布/订阅、事件触发等）。"""

    type: NodeType = Field(default=NodeType.EVENT)
    event_type: EventType = Field(default=EventType.EMIT, description="事件类型")
    channel: Optional[str] = Field(default=None, description="事件频道/主题")
    payload_schema: Optional[dict[str, Any]] = Field(default=None, description="事件载荷Schema")


class InfrastructureNode(NodeBase):
    """基础设施节点（数据库、缓存、消息队列等）。"""

    type: NodeType = Field(default=NodeType.INFRASTRUCTURE)
    infra_type: InfraType = Field(default=InfraType.SERVICE, description="基础设施类型")
    technology: Optional[str] = Field(default=None, description="使用的技术（如 PostgreSQL）")
    host: Optional[str] = Field(default=None, description="主机地址")
    port: Optional[int] = Field(default=None, description="端口号")
    config: dict[str, Any] = Field(default_factory=dict, description="配置信息")


# ---------------------------------------------------------------------------
# Graph Stats & Result
# ---------------------------------------------------------------------------


class GraphStats(BaseModel):
    """图谱统计信息。"""

    node_count: int = Field(default=0, description="节点总数")
    edge_count: int = Field(default=0, description="边总数")
    language_distribution: dict[str, int] = Field(
        default_factory=dict, description="编程语言分布"
    )
    created_at: datetime = Field(default_factory=datetime.utcnow)
    analysis_duration_seconds: float = Field(default=0.0, description="分析耗时（秒）")


AnyNode = Union[
    RepositoryNode,
    ModuleNode,
    ComponentNode,
    FunctionNode,
    DataEntityNode,
    EventNode,
    InfrastructureNode,
]


class CodeGraph(BaseModel):
    """完整代码知识图谱模型。"""

    id: str = Field(default_factory=lambda: str(uuid4()), description="图谱唯一标识符")
    repository: RepositoryNode = Field(description="根仓库节点")
    nodes: list[AnyNode] = Field(default_factory=list, description="所有节点")
    edges: list[EdgeBase] = Field(default_factory=list, description="所有边")
    stats: GraphStats = Field(default_factory=GraphStats, description="图谱统计")

    @model_validator(mode="after")
    def update_stats(self) -> "CodeGraph":
        """自动更新统计信息。"""
        self.stats.node_count = len(self.nodes)
        self.stats.edge_count = len(self.edges)
        return self


# ---------------------------------------------------------------------------
# Query / Response Models
# ---------------------------------------------------------------------------


class GraphQueryRequest(BaseModel):
    """图谱查询请求模型。"""

    query: str = Field(description="自然语言查询或 Cypher/Gremlin 查询")
    mode: str = Field(default="natural", description="查询模式: natural | cypher | traversal")
    repo_id: Optional[str] = Field(default=None, description="限定仓库范围")
    limit: int = Field(default=20, ge=1, le=100, description="返回结果数量限制")
    include_context: bool = Field(default=True, description="是否包含图谱上下文")


class GraphQueryResponse(BaseModel):
    """图谱查询响应模型。"""

    query: str = Field(description="原始查询")
    answer: str = Field(description="AI生成的回答")
    nodes: list[dict[str, Any]] = Field(default_factory=list, description="相关节点")
    edges: list[dict[str, Any]] = Field(default_factory=list, description="相关边")
    subgraph: Optional[dict[str, Any]] = Field(default=None, description="子图数据")
    confidence: float = Field(default=0.0, ge=0.0, le=1.0, description="置信度")
    sources: list[str] = Field(default_factory=list, description="引用来源")


class AnalysisRequest(BaseModel):
    """代码仓库分析请求。"""

    repo_path: str = Field(description="本地仓库路径或 Git URL")
    repo_id: Optional[str] = Field(default=None, description="仓库ID（增量更新时使用）")
    languages: list[str] = Field(
        default_factory=list, description="指定分析的编程语言，空表示全部"
    )
    exclude_patterns: list[str] = Field(
        default_factory=lambda: ["*.pyc", "__pycache__", ".git", "node_modules"],
        description="排除的文件模式",
    )
    enable_ai: bool = Field(default=True, description="是否启用AI语义分析")
    incremental: bool = Field(default=False, description="是否增量更新")


class AnalysisResponse(BaseModel):
    """代码仓库分析响应。"""

    task_id: str = Field(description="分析任务ID")
    status: str = Field(description="任务状态: pending | running | completed | failed")
    repo_id: Optional[str] = Field(default=None, description="生成的仓库图谱ID")
    message: str = Field(default="", description="状态消息")
    stats: Optional[GraphStats] = Field(default=None, description="分析统计信息")
