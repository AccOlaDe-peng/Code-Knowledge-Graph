"""AI 分析数据模型。

定义 AI 驱动的代码分析所需的数据结构。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from backend.graph.graph_schema import GraphNode, GraphEdge


@dataclass
class ModuleInfo:
    """模块信息。"""

    id: str                    # 模块 ID，格式: "module:{name}"
    name: str                  # 模块名称
    files: list[str]           # 包含的文件路径列表
    purpose: str               # AI 推断的模块职责
    language: str = ""         # 主要编程语言
    confidence: float = 1.0    # AI 识别置信度


@dataclass
class ModulePlan:
    """AI 生成的模块划分计划。"""

    modules: list[ModuleInfo]
    architecture_hints: dict[str, Any] = field(default_factory=dict)
    confidence: float = 1.0


@dataclass
class AIAnalysisConfig:
    """AI 分析配置。"""

    provider: str = "anthropic"
    model: str = ""
    max_tokens: int = 16384
    temperature: float = 0.1
    max_parallel_modules: int = 5
    max_files_per_module: int = 50
    max_tokens_per_module: int = 32000
    cache_enabled: bool = True
    cache_dir: str = "data/ai_cache"
    retry_count: int = 2
    retry_delay_seconds: float = 2.0
    timeout_seconds: float = 120.0
    enable_ai_description: bool = True  # 启用 AI 描述生成


@dataclass
class FailedModule:
    """分析失败的模块记录。"""

    module_id: str
    reason: str
    files_attempted: list[str] = field(default_factory=list)


@dataclass
class AIAnalysisResult:
    """AI 分析结果。"""

    graph_id: str
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    status: str  # "success" | "partial" | "failed"
    failed_modules: list[FailedModule] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    duration_seconds: float = 0.0

    @property
    def node_count(self) -> int:
        return len(self.nodes)

    @property
    def edge_count(self) -> int:
        return len(self.edges)
