"""Agent 上下文和共享知识库。"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Optional

from backend.models.discovery import DiscoveryRegistry

if TYPE_CHECKING:
    from backend.llm.context_monitor import ContextMonitor
    from backend.agent.structure_indexer import StructureIndexer


class SharedKnowledgeBase:
    """Agent 间共享的知识库（线程安全）。

    读操作返回列表快照（copy），防止迭代期间其他线程修改原始列表。
    写操作通过 add_* 方法，均在 _lock 保护下执行。
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._modules: list[dict[str, Any]] = []
        self._layers: list[dict[str, Any]] = []
        self._services: list[dict[str, Any]] = []
        self._entry_points: list[Any] = []

    # ── 写操作：加锁 append ──────────────────────────────
    def add_module(self, module: dict[str, Any]) -> None:
        with self._lock:
            self._modules.append(module)

    def add_layer(self, layer: dict[str, Any]) -> None:
        with self._lock:
            self._layers.append(layer)

    def add_service(self, service: dict[str, Any]) -> None:
        with self._lock:
            self._services.append(service)

    def add_entry_point(self, entry_point: Any) -> None:
        with self._lock:
            self._entry_points.append(entry_point)

    # ── 读操作：返回快照（copy），不暴露原始 list ─────────
    @property
    def modules(self) -> list[dict[str, Any]]:
        with self._lock:
            return list(self._modules)

    @property
    def layers(self) -> list[dict[str, Any]]:
        with self._lock:
            return list(self._layers)

    @property
    def services(self) -> list[dict[str, Any]]:
        with self._lock:
            return list(self._services)

    @property
    def entry_points(self) -> list[Any]:
        with self._lock:
            return list(self._entry_points)


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
    structure_indexer: Optional["StructureIndexer"] = None   # 预构建索引（可选）
