"""Agent 输出类型定义。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from backend.graph.graph_schema import GraphNode, GraphEdge
from backend.models.discovery import DiscoveryRegistry


@dataclass
class AgentError:
    """Agent 执行错误。"""
    code: str
    message: str
    context: dict[str, Any] = field(default_factory=dict)


@dataclass
class AgentOutput:
    """Agent 执行结果的标准格式。"""

    agent_type: str                    # "module_detector" | "architecture" | "call_graph" | "data_lineage" | "cross_module"
    module_id: str                     # 所属模块 ID
    status: str                        # "success" | "partial" | "failed"
    execution_time_ms: int

    nodes: list[GraphNode] = field(default_factory=list)
    edges: list[GraphEdge] = field(default_factory=list)
    discoveries: DiscoveryRegistry = field(default_factory=DiscoveryRegistry)

    meta: dict[str, Any] = field(default_factory=dict)
    errors: list[AgentError] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


@dataclass
class IntermediateGraph:
    """模块分析的中间图谱结果。"""

    module_id: str
    nodes: list[GraphNode] = field(default_factory=list)
    edges: list[GraphEdge] = field(default_factory=list)
    discoveries: DiscoveryRegistry = field(default_factory=DiscoveryRegistry)
    meta: dict[str, Any] = field(default_factory=dict)

    @property
    def node_count(self) -> int:
        return len(self.nodes)

    @property
    def edge_count(self) -> int:
        return len(self.edges)
