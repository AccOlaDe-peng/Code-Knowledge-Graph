"""Multi-Agent 系统模块。

提供领域驱动的多 Agent 协作架构：
- DomainAgent: 领域 Agent 基类
- EntityAgent: 实体分析 Agent
- ServiceAgent: 服务分析 Agent
- FlowAgent: 流程分析 Agent
- LineageAgent: 血缘分析 Agent
- TopicAgent: 主题分析 Agent
"""

from backend.agent_v2.base_agent import (
    DomainAgent,
    AgentPhase,
    AgentResult,
    AgentContext,
)
from backend.agent_v2.entity_agent import EntityAgent
from backend.agent_v2.service_agent import ServiceAgent
from backend.agent_v2.flow_agent import FlowAgent
from backend.agent_v2.lineage_agent import LineageAgent
from backend.agent_v2.topic_agent import TopicAgent

__all__ = [
    # 基类
    "DomainAgent",
    "AgentPhase",
    "AgentResult",
    "AgentContext",
    # 具体 Agent
    "EntityAgent",
    "ServiceAgent",
    "FlowAgent",
    "LineageAgent",
    "TopicAgent",
]
