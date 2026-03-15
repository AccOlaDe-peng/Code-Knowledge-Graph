"""
仓库摘要数据模型。

定义 AI 分析器共享的仓库压缩摘要数据结构。
这些类型用于在 AI 分析过程中传递代码仓库的结构化信息。

注意：RepoSummaryBuilder 类已被移除，因为静态分析流水线已弃用。
新的 AIPipeline 使用 Agent 系统直接探索代码仓库。
"""

from __future__ import annotations

import dataclasses
from typing import Any


# ---------------------------------------------------------------------------
# Section dataclasses
# ---------------------------------------------------------------------------


@dataclasses.dataclass
class ModuleSummary:
    """模块摘要。"""
    name: str
    path: str
    language: str
    node_count: int    # 模块内子节点总数（classes + functions + etc.）
    file_count: int


@dataclasses.dataclass
class ServiceSummary:
    """服务摘要。"""
    id: str
    name: str
    description: str
    port: str


@dataclasses.dataclass
class APISummary:
    """API 端点摘要。"""
    id: str
    name: str
    module: str
    method: str    # GET / POST / PUT / DELETE / ""
    path: str      # URL path（如 /api/users）
    description: str


@dataclasses.dataclass
class FunctionSummary:
    """关键函数摘要。"""
    id: str
    name: str
    module: str
    signature: str    # 简化签名（仅参数名）
    pagerank: float
    in_degree: int
    out_degree: int
    language: str


@dataclasses.dataclass
class CallSample:
    """调用关系样本。"""
    caller: str           # 调用方函数名
    callee: str           # 被调用函数名
    caller_module: str    # 调用方所属模块
    callee_module: str    # 被调用方所属模块


@dataclasses.dataclass
class DatabaseSummary:
    """数据库摘要（含关联表列表）。"""
    id: str
    name: str
    db_type: str           # postgres / mysql / redis / mongo / ""
    tables: list[str]      # 关联 Table 节点名称列表


@dataclasses.dataclass
class EventSummary:
    """事件 / Topic 摘要。"""
    id: str
    name: str
    event_type: str        # kafka / rabbitmq / eventbus / ""
    publishers: list[str]  # 发布方名称
    subscribers: list[str] # 订阅方名称


@dataclasses.dataclass
class RepoTreeNode:
    """目录树节点（展示到限定深度）。"""
    name: str
    path: str
    node_type: str         # "module" | "directory"
    file_count: int
    children: list["RepoTreeNode"] = dataclasses.field(default_factory=list)


# ---------------------------------------------------------------------------
# Top-level summary
# ---------------------------------------------------------------------------


@dataclasses.dataclass
class RepoSummary:
    """AI 分析器共享的仓库压缩摘要。

    注意：此类主要由旧的 RepoSummaryBuilder 构建。
    新的 AIPipeline 使用 Agent 系统直接探索代码仓库，
    但保留此类定义以供向后兼容和类型检查。
    """

    # 基本信息
    repo_name:     str
    repo_path:     str
    git_commit:    str
    languages:     list[str]
    total_files:   int
    total_nodes:   int
    total_edges:   int

    # 各类摘要（按 pipeline 顺序排列）
    repo_tree:          list[RepoTreeNode]
    modules:            list[ModuleSummary]
    services:           list[ServiceSummary]
    apis:               list[APISummary]
    functions:          list[FunctionSummary]
    call_graph_sample:  list[CallSample]
    databases:          list[DatabaseSummary]
    events:             list[EventSummary]

    # 元信息
    token_estimate: int           # 预估 prompt token 数
    truncated:      bool          # 是否因 token 预算而截断
    limits_used:    dict[str, int] = dataclasses.field(default_factory=dict)

    def to_prompt_text(self) -> str:
        """将摘要格式化为 LLM 可消费的 Markdown 风格纯文本。

        注意：此方法提供基本实现，用于向后兼容。
        新的 AIPipeline 使用 Agent 系统生成 prompt。
        """
        lines: list[str] = []

        # Header
        lines.append(f"# Repository: {self.repo_name}")
        lines.append(
            f"Languages: {', '.join(self.languages) or 'unknown'} | "
            f"Files: {self.total_files} | "
            f"Nodes: {self.total_nodes} | "
            f"Edges: {self.total_edges}"
        )
        lines.append(f"Git Commit: {self.git_commit or 'unknown'}")
        lines.append("")

        # Modules
        if self.modules:
            lines.append("## Modules")
            for m in self.modules[:10]:  # Limit to 10
                lines.append(f"- {m.name} ({m.language}): {m.node_count} nodes, {m.file_count} files")
            if len(self.modules) > 10:
                lines.append(f"  ... and {len(self.modules) - 10} more")
            lines.append("")

        # Services
        if self.services:
            lines.append("## Services")
            for s in self.services[:10]:
                lines.append(f"- {s.name}: {s.description or 'no description'}")
            if len(self.services) > 10:
                lines.append(f"  ... and {len(self.services) - 10} more")
            lines.append("")

        # APIs
        if self.apis:
            lines.append("## APIs")
            for a in self.apis[:15]:
                lines.append(f"- {a.method} {a.path}: {a.name}")
            if len(self.apis) > 15:
                lines.append(f"  ... and {len(self.apis) - 15} more")
            lines.append("")

        # Functions
        if self.functions:
            lines.append("## Key Functions")
            for f in self.functions[:20]:
                lines.append(f"- {f.name} (PageRank: {f.pagerank:.4f})")
            if len(self.functions) > 20:
                lines.append(f"  ... and {len(self.functions) - 20} more")
            lines.append("")

        # Call Graph Sample
        if self.call_graph_sample:
            lines.append("## Call Graph Sample")
            for c in self.call_graph_sample[:20]:
                lines.append(f"- {c.caller} -> {c.callee}")
            if len(self.call_graph_sample) > 20:
                lines.append(f"  ... and {len(self.call_graph_sample) - 20} more")
            lines.append("")

        # Databases
        if self.databases:
            lines.append("## Databases")
            for d in self.databases[:10]:
                tables_str = ", ".join(d.tables[:5])
                if len(d.tables) > 5:
                    tables_str += f" ... ({len(d.tables) - 5} more)"
                lines.append(f"- {d.name} ({d.db_type}): {tables_str}")
            lines.append("")

        # Events
        if self.events:
            lines.append("## Events")
            for e in self.events[:10]:
                lines.append(f"- {e.name} ({e.event_type})")
            if len(self.events) > 10:
                lines.append(f"  ... and {len(self.events) - 10} more")
            lines.append("")

        # Footer
        if self.truncated:
            lines.append(f"_Summary truncated due to token budget (~{self.token_estimate} tokens)_")

        return "\n".join(lines)


__all__ = [
    # Data classes
    "ModuleSummary",
    "ServiceSummary",
    "APISummary",
    "FunctionSummary",
    "CallSample",
    "DatabaseSummary",
    "EventSummary",
    "RepoTreeNode",
    "RepoSummary",
]
