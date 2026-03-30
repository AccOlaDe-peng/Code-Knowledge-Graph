"""知识中枢事件定义。"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class KnowledgeEventType(Enum):
    """知识中枢事件类型。"""

    # Agent 完成事件
    ENTITY_ANALYZED = "entity_analyzed"          # EntityAgent 完成实体分析
    SERVICE_ANALYZED = "service_analyzed"        # ServiceAgent 完成服务分析
    FLOW_ANALYZED = "flow_analyzed"              # FlowAgent 完成流程分析
    LINEAGE_TRACED = "lineage_traced"            # LineageAgent 完成血缘追踪
    TOPIC_DISCOVERED = "topic_discovered"        # TopicAgent 发现新的消息主题

    # 数据更新事件
    ENTITY_UPDATED = "entity_updated"            # 实体数据更新
    SERVICE_UPDATED = "service_updated"          # 服务数据更新
    LINEAGE_UPDATED = "lineage_updated"          # 血缘数据更新

    # 发现事件
    RELATIONSHIP_FOUND = "relationship_found"    # 发现新的实体关系
    FIELD_DISCOVERED = "field_discovered"        # 发现新字段


@dataclass
class KnowledgeEvent:
    """知识事件。"""

    event_type: KnowledgeEventType
    agent_name: str                              # 发布事件的 Agent 名称
    data: Any                                    # 事件数据
    timestamp: float = 0.0                       # 事件时间戳
    version: int = 1                             # 数据版本
    metadata: dict = field(default_factory=dict) # 额外元数据

    def __post_init__(self):
        """初始化时间戳。"""
        if self.timestamp == 0.0:
            import time
            self.timestamp = time.time()
