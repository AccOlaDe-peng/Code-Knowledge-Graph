"""Stage 抽象基类。"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class StageBase(ABC):
    """所有流水线阶段的基类。"""

    @property
    @abstractmethod
    def name(self) -> str:
        """阶段名称（用于缓存 key）。"""

    @abstractmethod
    def run(self, **kwargs: Any) -> Any:
        """执行阶段，返回阶段输出。"""
