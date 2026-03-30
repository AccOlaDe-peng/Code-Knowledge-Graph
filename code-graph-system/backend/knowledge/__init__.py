"""知识中枢模块。

管理多 Agent 间的数据共享、事件订阅和置信度传递。
"""

from backend.knowledge.events import KnowledgeEventType, KnowledgeEvent
from backend.knowledge.hub import KnowledgeHub
from backend.knowledge.confidence import (
    calculate_propagated_confidence,
    calculate_dependency_depth,
    build_dependency_chain,
    aggregate_confidence,
)

__all__ = [
    "KnowledgeEventType",
    "KnowledgeEvent",
    "KnowledgeHub",
    "calculate_propagated_confidence",
    "calculate_dependency_depth",
    "build_dependency_chain",
    "aggregate_confidence",
]
