"""Agent 上下文和共享知识库。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Optional

from backend.models.discovery import DiscoveryRegistry

if TYPE_CHECKING:
    from backend.llm.context_monitor import ContextMonitor


@dataclass
class SharedKnowledgeBase:
    """Agent 间共享的知识库。"""
    layers: list[dict[str, Any]] = field(default_factory=list)
    modules: list[dict[str, Any]] = field(default_factory=list)
    services: list[dict[str, Any]] = field(default_factory=list)
    entry_points: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class AgentContext:
    """Agent 执行上下文。"""
    repo_path: str
    module_id: str
    shared_knowledge: SharedKnowledgeBase = field(default_factory=SharedKnowledgeBase)
    discoveries: DiscoveryRegistry = field(default_factory=DiscoveryRegistry)
    max_iterations: int = 20
    timeout_seconds: int = 300
    context_monitor: Optional["ContextMonitor"] = None