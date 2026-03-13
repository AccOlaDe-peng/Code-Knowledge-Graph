"""
代码知识图谱标准 Schema（dataclass 版本）。

定义面向前端消费的标准 JSON Graph 格式：

    {
        "graph_version": "1.0",
        "repo": {
            "name": "my-project",
            "path": "/path/to/repo",
            "language": "python",
            "commit": "abc1234"
        },
        "nodes": [
            {
                "id":       "module::backend/api",
                "type":     "module",
                "name":     "api",
                "file":     "backend/api/__init__.py",
                "line":     1,
                "module":   "backend/api",
                "language": "python"
            }
        ],
        "edges": [
            {
                "from": "module::backend",
                "to":   "module::backend/api",
                "type": "contains"
            }
        ]
    }

节点类型（NodeKind）：
    repository  — 仓库根节点
    module      — 目录/包
    file        — 源码文件
    class       — 类定义
    function    — 函数/方法定义
    api         — HTTP 路由端点
    database    — 数据库实例
    table       — 数据库表

边类型（EdgeKind）：
    contains    — 父子包含（repo→module, module→file, file→class, class→function）
    imports     — 模块导入（module→module）
    calls       — 函数调用（function→function）
    reads       — 读取数据（function/class→table）
    writes      — 写入数据（function/class→table）

典型用法::

    from backend.graph.code_graph import CodeGraph, CodeNode, CodeEdge, RepoInfo

    graph = CodeGraph.from_built(built_graph, repo_name="my-project")
    payload = graph.to_dict()          # 可直接 json.dumps
    json_str = graph.to_json()         # 格式化 JSON 字符串
"""

from __future__ import annotations

import dataclasses
import json
from typing import Any, Optional

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

GRAPH_VERSION = "1.0"

# 从 BuiltGraph 节点类型映射到标准 NodeKind（大小写规范化）
_NODE_TYPE_MAP: dict[str, str] = {
    "Repository": "repository",
    "Module":     "module",
    "File":       "file",
    "Class":      "class",
    "Function":   "function",
    "API":        "api",
    "Database":   "database",
    "Table":      "table",
}

# 标准边类型白名单（小写）
_EDGE_TYPES: frozenset[str] = frozenset({
    "contains",
    "imports",
    "calls",
    "reads",
    "writes",
})

# 合法的 NodeKind 值集合
NODE_KINDS: frozenset[str] = frozenset(_NODE_TYPE_MAP.values())

# 合法的 EdgeKind 值集合
EDGE_KINDS: frozenset[str] = _EDGE_TYPES


# ---------------------------------------------------------------------------
# RepoInfo
# ---------------------------------------------------------------------------


@dataclasses.dataclass
class RepoInfo:
    """仓库元信息。

    Attributes:
        name:     仓库/图谱名称。
        path:     仓库本地绝对路径（可为空字符串）。
        language: 主要编程语言（如 ``"python"``），无法确定时为空字符串。
        commit:   当前 Git commit SHA（短格式或完整格式），非 Git 仓库时为空字符串。
    """

    name:     str = ""
    path:     str = ""
    language: str = ""
    commit:   str = ""

    def to_dict(self) -> dict[str, str]:
        return dataclasses.asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "RepoInfo":
        return cls(
            name=data.get("name", ""),
            path=data.get("path", ""),
            language=data.get("language", ""),
            commit=data.get("commit", ""),
        )


# ---------------------------------------------------------------------------
# CodeNode
# ---------------------------------------------------------------------------


@dataclasses.dataclass
class CodeNode:
    """图谱节点，代表代码中的一个实体。

    Attributes:
        id:       节点唯一标识，格式建议为 ``"<type>::<qualified_name>"``，
                  例如 ``"function::backend.api.server.health"``。
        type:     节点类型，取值为 :data:`NODE_KINDS` 之一：
                  ``repository / module / file / class / function / api / database / table``。
        name:     实体短名称（不含路径前缀），例如 ``"health"``。
        file:     相对于仓库根目录的源码文件路径，例如 ``"backend/api/server.py"``。
                  对于 repository / module 节点可为空字符串。
        line:     实体在文件中的起始行号（1-based）；未知时为 ``None``。
        module:   所属模块路径（相对仓库根目录的目录路径），例如 ``"backend/api"``。
                  对于 repository 节点可为空字符串。
        language: 编程语言，例如 ``"python"``、``"typescript"``；未知时为空字符串。
    """

    id:       str
    type:     str
    name:     str
    file:     str = ""
    line:     Optional[int] = None
    module:   str = ""
    language: str = ""

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "id":       self.id,
            "type":     self.type,
            "name":     self.name,
            "file":     self.file,
            "line":     self.line,
            "module":   self.module,
            "language": self.language,
        }
        return d

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "CodeNode":
        return cls(
            id=data["id"],
            type=data["type"],
            name=data["name"],
            file=data.get("file", ""),
            line=data.get("line"),
            module=data.get("module", ""),
            language=data.get("language", ""),
        )


# ---------------------------------------------------------------------------
# CodeEdge
# ---------------------------------------------------------------------------


@dataclasses.dataclass
class CodeEdge:
    """图谱边，代表两个节点之间的关系。

    Attributes:
        from_: 源节点 ID（Python 属性名用 ``from_`` 规避保留字，
               序列化时输出为 ``"from"``）。
        to:    目标节点 ID。
        type:  关系类型，取值为 :data:`EDGE_KINDS` 之一：
               ``contains / imports / calls / reads / writes``。
    """

    from_: str
    to:    str
    type:  str

    def to_dict(self) -> dict[str, str]:
        return {
            "from": self.from_,
            "to":   self.to,
            "type": self.type,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "CodeEdge":
        return cls(
            from_=data["from"],
            to=data["to"],
            type=data["type"],
        )


# ---------------------------------------------------------------------------
# CodeGraph
# ---------------------------------------------------------------------------


@dataclasses.dataclass
class CodeGraph:
    """标准代码知识图谱。

    序列化后的 JSON 格式::

        {
            "graph_version": "1.0",
            "repo": {"name": "...", "path": "...", "language": "...", "commit": "..."},
            "nodes": [...],
            "edges": [...]
        }

    Attributes:
        repo:          仓库元信息。
        nodes:         节点列表。
        edges:         边列表。
        graph_version: Schema 版本号，固定为 ``"1.0"``。
    """

    repo:          RepoInfo
    nodes:         list[CodeNode]
    edges:         list[CodeEdge]
    graph_version: str = GRAPH_VERSION

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def node_count(self) -> int:
        return len(self.nodes)

    @property
    def edge_count(self) -> int:
        return len(self.edges)

    # ------------------------------------------------------------------
    # Serialization
    # ------------------------------------------------------------------

    def to_dict(self) -> dict[str, Any]:
        """序列化为可直接 ``json.dumps`` 的字典。"""
        return {
            "graph_version": self.graph_version,
            "repo":          self.repo.to_dict(),
            "nodes":         [n.to_dict() for n in self.nodes],
            "edges":         [e.to_dict() for e in self.edges],
        }

    def to_json(self, *, indent: int = 2, ensure_ascii: bool = False) -> str:
        """序列化为格式化 JSON 字符串。"""
        return json.dumps(self.to_dict(), indent=indent, ensure_ascii=ensure_ascii)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "CodeGraph":
        """从字典反序列化（``json.loads`` 的结果）。"""
        return cls(
            graph_version=data.get("graph_version", GRAPH_VERSION),
            repo=RepoInfo.from_dict(data.get("repo", {})),
            nodes=[CodeNode.from_dict(n) for n in data.get("nodes", [])],
            edges=[CodeEdge.from_dict(e) for e in data.get("edges", [])],
        )

    @classmethod
    def from_json(cls, json_str: str) -> "CodeGraph":
        """从 JSON 字符串反序列化。"""
        return cls.from_dict(json.loads(json_str))

    # ------------------------------------------------------------------
    # Factory: convert from BuiltGraph
    # ------------------------------------------------------------------

    @classmethod
    def from_built(
        cls,
        built: Any,
        *,
        repo_name: str = "",
        repo_path: str = "",
        commit: str = "",
    ) -> "CodeGraph":
        """从 ``BuiltGraph`` 转换为 ``CodeGraph``。

        只保留白名单节点类型和边类型，其余静默丢弃。

        Args:
            built:     ``GraphBuilder.build()`` 的输出（``BuiltGraph`` 实例）。
            repo_name: 仓库名称；空字符串时尝试从 built.meta 读取。
            repo_path: 仓库本地路径；空字符串时尝试从 built.meta 读取。
            commit:    Git commit SHA；空字符串时尝试从 built.meta 读取。

        Returns:
            ``CodeGraph`` 实例。
        """
        meta = getattr(built, "meta", {}) or {}

        # ── RepoInfo ──────────────────────────────────────────────────
        name   = repo_name or meta.get("repo_name", "")
        path   = repo_path or meta.get("repo_path", "")
        sha    = commit    or meta.get("git_commit", "")

        # 推断主要语言：取节点 language 属性中出现最多的值
        language = _infer_language(built.nodes)

        repo = RepoInfo(name=name, path=path, language=language, commit=sha)

        # ── Nodes ─────────────────────────────────────────────────────
        nodes: list[CodeNode] = []
        valid_ids: set[str] = set()

        for gn in built.nodes:
            kind = _NODE_TYPE_MAP.get(gn.type)
            if kind is None:
                continue

            props = gn.properties if isinstance(gn.properties, dict) else {}

            file_path = (
                props.get("file_path")
                or props.get("abs_path")
                or props.get("path")
                or ""
            )
            # 尽量转为相对路径
            if file_path and path and file_path.startswith(path):
                file_path = file_path[len(path):].lstrip("/\\")

            line = props.get("line") or props.get("start_line") or props.get("lineno")
            if line is not None:
                try:
                    line = int(line)
                except (TypeError, ValueError):
                    line = None

            module_path = (
                props.get("module")
                or props.get("module_path")
                or props.get("dir_path")
                or ""
            )
            if module_path and path and module_path.startswith(path):
                module_path = module_path[len(path):].lstrip("/\\")

            lang = (
                props.get("language")
                or props.get("lang")
                or ""
            )

            node = CodeNode(
                id=gn.id,
                type=kind,
                name=gn.name,
                file=file_path,
                line=line,
                module=module_path,
                language=lang,
            )
            nodes.append(node)
            valid_ids.add(gn.id)

        # ── Edges ─────────────────────────────────────────────────────
        edges: list[CodeEdge] = []
        for ge in built.edges:
            if ge.type not in _EDGE_TYPES:
                continue
            if ge.from_ not in valid_ids or ge.to not in valid_ids:
                continue
            edges.append(CodeEdge(from_=ge.from_, to=ge.to, type=ge.type))

        return cls(repo=repo, nodes=nodes, edges=edges)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _infer_language(nodes: list[Any]) -> str:
    """从节点属性中推断仓库的主要编程语言。"""
    counts: dict[str, int] = {}
    for node in nodes:
        props = getattr(node, "properties", {}) or {}
        lang = props.get("language") or props.get("lang") or ""
        if lang:
            counts[lang] = counts.get(lang, 0) + 1
    if not counts:
        return ""
    return max(counts, key=lambda k: counts[k])
