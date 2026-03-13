"""
GraphStorage — 图谱持久化存储模块。

目录结构
--------
每个仓库独占一个子目录，目录名即 repo_id：

    graph-storage/
    ├── <repo-id>/
    │   ├── graph.json          — 完整图谱（所有节点 + 所有边）
    │   ├── call-graph.json     — 子图：calls 边 + 相关节点
    │   └── module-graph.json   — 子图：contains / imports 边 + 相关节点
    └── index.json              — 所有仓库的摘要索引

主要接口
--------
    storage = GraphStorage()

    storage.save_graph(repo_id, graph)          # 保存完整图谱 + 自动派生子图
    graph   = storage.load_graph(repo_id)       # 加载完整图谱
    subgraph = storage.get_subgraph(repo_id, "calls")   # 按边类型取子图

graph 格式（输入/输出统一）
--------------------------
    {
        "nodes": [
            {"id": "...", "type": "...", "name": "...", "file": "...", ...}
        ],
        "edges": [
            {"from": "...", "to": "...", "type": "..."}
        ]
    }

子图文件映射
------------
    edge_type 参数      → 文件名
    ─────────────────────────────
    "calls"             → call-graph.json
    "contains"          → module-graph.json
    "imports"           → module-graph.json
    "reads"             → data-graph.json
    "writes"            → data-graph.json
    其他任意类型         → <edge_type>-graph.json（动态生成）

典型用法::

    from backend.storage.graph_storage import GraphStorage

    storage = GraphStorage("./graph-storage")

    # 保存
    storage.save_graph("my-project", {
        "nodes": [...],
        "edges": [...],
    })

    # 加载完整图谱
    graph = storage.load_graph("my-project")

    # 取调用图子图
    call_graph = storage.get_subgraph("my-project", "calls")

    # 取模块图子图（contains + imports）
    module_graph = storage.get_subgraph("my-project", "contains")

    # 列出所有仓库
    repos = storage.list_repos()

    # 删除仓库
    storage.delete_repo("my-project")
"""

from __future__ import annotations

import dataclasses
import json
import logging
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# 默认存储根目录
_DEFAULT_STORAGE_ROOT = "./graph-storage"

# 完整图谱文件名
_GRAPH_FILE = "graph.json"

# 索引文件名（存储根目录下）
_INDEX_FILE = "index.json"

# 边类型 → 子图文件名映射
# 多个边类型可以共享同一个子图文件（例如 contains + imports → module-graph.json）
_EDGE_TYPE_TO_SUBGRAPH: dict[str, str] = {
    "calls":    "call-graph.json",
    "contains": "module-graph.json",
    "imports":  "module-graph.json",
    "reads":    "data-graph.json",
    "writes":   "data-graph.json",
}

# 子图文件 → 包含的边类型集合（_EDGE_TYPE_TO_SUBGRAPH 的反向索引）
_SUBGRAPH_TO_EDGE_TYPES: dict[str, frozenset[str]] = {}
for _et, _fn in _EDGE_TYPE_TO_SUBGRAPH.items():
    _SUBGRAPH_TO_EDGE_TYPES.setdefault(_fn, set()).add(_et)  # type: ignore[arg-type]
_SUBGRAPH_TO_EDGE_TYPES = {
    k: frozenset(v) for k, v in _SUBGRAPH_TO_EDGE_TYPES.items()
}


# ---------------------------------------------------------------------------
# StorageError
# ---------------------------------------------------------------------------


class StorageError(Exception):
    """GraphStorage 操作失败时抛出的基础异常。"""


class RepoNotFoundError(StorageError):
    """指定的 repo_id 不存在时抛出。"""

    def __init__(self, repo_id: str) -> None:
        super().__init__(f"仓库不存在: {repo_id!r}")
        self.repo_id = repo_id


# ---------------------------------------------------------------------------
# RepoMeta — 索引条目
# ---------------------------------------------------------------------------


@dataclasses.dataclass
class RepoMeta:
    """单个仓库的摘要元信息（写入 index.json）。

    Attributes:
        repo_id:     仓库唯一标识（目录名）。
        node_count:  节点总数。
        edge_count:  边总数。
        node_types:  各节点类型的数量统计。
        edge_types:  各边类型的数量统计。
        subgraphs:   已生成的子图文件名列表。
        created_at:  首次保存时间（ISO 8601）。
        updated_at:  最近保存时间（ISO 8601）。
    """

    repo_id:     str
    node_count:  int                = 0
    edge_count:  int                = 0
    node_types:  dict[str, int]     = dataclasses.field(default_factory=dict)
    edge_types:  dict[str, int]     = dataclasses.field(default_factory=dict)
    subgraphs:   list[str]          = dataclasses.field(default_factory=list)
    created_at:  str                = ""
    updated_at:  str                = ""

    def to_dict(self) -> dict[str, Any]:
        return dataclasses.asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "RepoMeta":
        return cls(
            repo_id=data.get("repo_id", ""),
            node_count=data.get("node_count", 0),
            edge_count=data.get("edge_count", 0),
            node_types=data.get("node_types", {}),
            edge_types=data.get("edge_types", {}),
            subgraphs=data.get("subgraphs", []),
            created_at=data.get("created_at", ""),
            updated_at=data.get("updated_at", ""),
        )


# ---------------------------------------------------------------------------
# GraphStorage
# ---------------------------------------------------------------------------


class GraphStorage:
    """图谱持久化存储。

    每个仓库对应 ``<storage_root>/<repo_id>/`` 目录，
    目录内包含 ``graph.json`` 和若干子图文件。

    示例::

        storage = GraphStorage("./graph-storage")

        storage.save_graph("my-project", {"nodes": [...], "edges": [...]})
        graph = storage.load_graph("my-project")
        calls = storage.get_subgraph("my-project", "calls")
    """

    def __init__(self, storage_root: str | Path = _DEFAULT_STORAGE_ROOT) -> None:
        """
        Args:
            storage_root: 存储根目录路径（不存在时自动创建）。
        """
        self._root = Path(storage_root).resolve()
        self._root.mkdir(parents=True, exist_ok=True)
        logger.debug("GraphStorage 初始化: root=%s", self._root)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def save_graph(
        self,
        repo_id: str,
        graph: dict[str, Any],
    ) -> Path:
        """保存完整图谱，并自动派生所有子图文件。

        Args:
            repo_id: 仓库唯一标识（用作子目录名）。
                     只允许字母、数字、``-``、``_``、``.``；
                     其他字符自动替换为 ``_``。
            graph:   图谱字典，必须含 ``"nodes"`` 和 ``"edges"`` 键。
                     节点和边均为普通字典列表。

        Returns:
            写入的 ``graph.json`` 的绝对 Path。

        Raises:
            StorageError: graph 格式不合法（缺少必要键）。
        """
        _validate_graph(graph)
        safe_id = _safe_repo_id(repo_id)
        repo_dir = self._repo_dir(safe_id)
        repo_dir.mkdir(parents=True, exist_ok=True)

        nodes: list[dict[str, Any]] = graph.get("nodes") or []
        edges: list[dict[str, Any]] = graph.get("edges") or []

        # ── 写入 graph.json ───────────────────────────────────────────
        now = _utc_now()
        payload: dict[str, Any] = {
            "meta": {
                "repo_id":    safe_id,
                "node_count": len(nodes),
                "edge_count": len(edges),
                "node_types": _count_by(n.get("type", "") for n in nodes),
                "edge_types": _count_by(e.get("type", "") for e in edges),
                "saved_at":   now,
            },
            "nodes": nodes,
            "edges": edges,
        }
        graph_path = repo_dir / _GRAPH_FILE
        _write_json(graph_path, payload)
        logger.info(
            "save_graph: repo=%s  %d nodes / %d edges → %s",
            safe_id, len(nodes), len(edges), graph_path,
        )

        # ── 派生子图文件 ──────────────────────────────────────────────
        subgraph_files = self._derive_subgraphs(repo_dir, nodes, edges)

        # ── 更新 index.json ───────────────────────────────────────────
        self._update_index(
            safe_id,
            node_count=len(nodes),
            edge_count=len(edges),
            node_types=payload["meta"]["node_types"],
            edge_types=payload["meta"]["edge_types"],
            subgraphs=subgraph_files,
            now=now,
        )

        return graph_path

    def load_graph(self, repo_id: str) -> dict[str, Any]:
        """加载完整图谱。

        Args:
            repo_id: 仓库唯一标识。

        Returns:
            ``{"nodes": [...], "edges": [...]}`` 字典。

        Raises:
            RepoNotFoundError: repo_id 对应的目录或 graph.json 不存在。
            StorageError:      文件损坏或 JSON 解析失败。
        """
        safe_id = _safe_repo_id(repo_id)
        graph_path = self._repo_dir(safe_id) / _GRAPH_FILE

        if not graph_path.exists():
            raise RepoNotFoundError(repo_id)

        try:
            raw = _read_json(graph_path)
        except Exception as exc:
            raise StorageError(f"读取 graph.json 失败 ({repo_id}): {exc}") from exc

        nodes = raw.get("nodes", [])
        edges = raw.get("edges", [])
        logger.debug(
            "load_graph: repo=%s  %d nodes / %d edges",
            safe_id, len(nodes), len(edges),
        )
        return {"nodes": nodes, "edges": edges}

    def get_subgraph(
        self,
        repo_id: str,
        edge_type: str,
    ) -> dict[str, Any]:
        """按边类型返回子图（只含该类型的边及其相关节点）。

        优先从预生成的子图文件读取；若文件不存在，则从完整图谱实时过滤。

        Args:
            repo_id:   仓库唯一标识。
            edge_type: 边类型，例如 ``"calls"``、``"contains"``、``"imports"``。
                       传入 ``"module"`` 等别名时自动映射到对应文件。

        Returns:
            ``{"nodes": [...], "edges": [...]}``，
            nodes 只包含出现在过滤后的边中的节点。

        Raises:
            RepoNotFoundError: repo_id 不存在。
            StorageError:      文件损坏。
        """
        safe_id   = _safe_repo_id(repo_id)
        repo_dir  = self._repo_dir(safe_id)

        if not repo_dir.exists():
            raise RepoNotFoundError(repo_id)

        # 确定子图文件名
        subgraph_file = _edge_type_to_filename(edge_type)
        subgraph_path = repo_dir / subgraph_file

        # ── 优先从子图文件读取 ────────────────────────────────────────
        if subgraph_path.exists():
            try:
                raw = _read_json(subgraph_path)
                nodes = raw.get("nodes", [])
                edges = raw.get("edges", [])
                logger.debug(
                    "get_subgraph: repo=%s  edge_type=%s  "
                    "%d nodes / %d edges  (from %s)",
                    safe_id, edge_type, len(nodes), len(edges), subgraph_file,
                )
                return {"nodes": nodes, "edges": edges}
            except Exception as exc:
                logger.warning(
                    "get_subgraph: 子图文件损坏，回退到实时过滤 (%s): %s",
                    subgraph_path, exc,
                )

        # ── 回退：从完整图谱实时过滤 ─────────────────────────────────
        full = self.load_graph(repo_id)
        return _filter_subgraph(full["nodes"], full["edges"], edge_type)

    # ------------------------------------------------------------------
    # Repo management
    # ------------------------------------------------------------------

    def list_repos(self) -> list[RepoMeta]:
        """列出所有已存储仓库的摘要信息。

        Returns:
            按 repo_id 字母序排列的 ``RepoMeta`` 列表。
        """
        index = self._read_index()
        return sorted(
            (RepoMeta.from_dict(v) for v in index.values()),
            key=lambda m: m.repo_id,
        )

    def repo_exists(self, repo_id: str) -> bool:
        """检查 repo_id 是否已存在。"""
        safe_id = _safe_repo_id(repo_id)
        return (self._repo_dir(safe_id) / _GRAPH_FILE).exists()

    def delete_repo(self, repo_id: str) -> bool:
        """删除指定仓库的所有文件（目录 + 索引条目）。

        Args:
            repo_id: 仓库唯一标识。

        Returns:
            True 表示成功删除，False 表示目录本就不存在。
        """
        safe_id  = _safe_repo_id(repo_id)
        repo_dir = self._repo_dir(safe_id)
        deleted  = False

        if repo_dir.exists():
            shutil.rmtree(repo_dir, ignore_errors=True)
            deleted = True
            logger.info("delete_repo: 已删除 %s", repo_dir)

        # 从索引中移除
        index = self._read_index()
        if safe_id in index:
            del index[safe_id]
            _write_json(self._root / _INDEX_FILE, index)

        return deleted

    def list_files(self, repo_id: str) -> list[str]:
        """列出指定仓库目录下的所有 JSON 文件名。

        Returns:
            文件名列表（不含路径），例如 ``["graph.json", "call-graph.json"]``。

        Raises:
            RepoNotFoundError: repo_id 不存在。
        """
        safe_id  = _safe_repo_id(repo_id)
        repo_dir = self._repo_dir(safe_id)
        if not repo_dir.exists():
            raise RepoNotFoundError(repo_id)
        return sorted(p.name for p in repo_dir.glob("*.json"))

    def get_meta(self, repo_id: str) -> RepoMeta:
        """返回指定仓库的摘要元信息。

        Raises:
            RepoNotFoundError: repo_id 不存在。
        """
        safe_id = _safe_repo_id(repo_id)
        index   = self._read_index()
        if safe_id not in index:
            raise RepoNotFoundError(repo_id)
        return RepoMeta.from_dict(index[safe_id])

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _repo_dir(self, safe_id: str) -> Path:
        """返回仓库子目录路径（不保证存在）。"""
        return self._root / safe_id

    def _derive_subgraphs(
        self,
        repo_dir: Path,
        nodes: list[dict[str, Any]],
        edges: list[dict[str, Any]],
    ) -> list[str]:
        """从完整图谱派生所有子图文件，返回已写入的文件名列表。"""
        # 收集图中实际出现的边类型
        present_types: set[str] = {e.get("type", "") for e in edges if e.get("type")}

        # 确定需要生成哪些子图文件
        files_to_generate: dict[str, set[str]] = {}  # filename → edge_types
        for et in present_types:
            fn = _edge_type_to_filename(et)
            files_to_generate.setdefault(fn, set()).add(et)

        # 为未知边类型也生成子图（动态文件名）
        written: list[str] = []
        node_map: dict[str, dict[str, Any]] = {
            n.get("id", ""): n for n in nodes if n.get("id")
        }

        for filename, edge_types in files_to_generate.items():
            subgraph = _filter_subgraph_multi(nodes, edges, edge_types, node_map)
            if subgraph["edges"]:
                path = repo_dir / filename
                _write_json(path, subgraph)
                written.append(filename)
                logger.debug(
                    "  派生子图: %s  edge_types=%s  %d nodes / %d edges",
                    filename, sorted(edge_types),
                    len(subgraph["nodes"]), len(subgraph["edges"]),
                )

        return written

    def _update_index(
        self,
        repo_id: str,
        *,
        node_count: int,
        edge_count: int,
        node_types: dict[str, int],
        edge_types: dict[str, int],
        subgraphs: list[str],
        now: str,
    ) -> None:
        """更新 index.json 中指定仓库的条目。"""
        index = self._read_index()
        existing = index.get(repo_id, {})
        index[repo_id] = {
            "repo_id":    repo_id,
            "node_count": node_count,
            "edge_count": edge_count,
            "node_types": node_types,
            "edge_types": edge_types,
            "subgraphs":  subgraphs,
            "created_at": existing.get("created_at", now),
            "updated_at": now,
        }
        _write_json(self._root / _INDEX_FILE, index)

    def _read_index(self) -> dict[str, Any]:
        """读取 index.json，不存在时返回空字典。"""
        index_path = self._root / _INDEX_FILE
        if not index_path.exists():
            return {}
        try:
            return _read_json(index_path)
        except Exception as exc:
            logger.warning("index.json 读取失败，返回空索引: %s", exc)
            return {}


# ---------------------------------------------------------------------------
# Subgraph filtering
# ---------------------------------------------------------------------------


def _filter_subgraph(
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    edge_type: str,
) -> dict[str, Any]:
    """从完整图谱中过滤出指定边类型的子图。

    子图的节点集合 = 出现在过滤后的边中的所有 from/to 节点。

    Args:
        nodes:     完整节点列表。
        edges:     完整边列表。
        edge_type: 目标边类型（单个）。

    Returns:
        ``{"nodes": [...], "edges": [...]}``
    """
    # 同一个子图文件可能包含多种边类型（如 contains + imports → module-graph）
    filename = _edge_type_to_filename(edge_type)
    target_types = _SUBGRAPH_TO_EDGE_TYPES.get(filename, frozenset({edge_type}))

    node_map: dict[str, dict[str, Any]] = {
        n.get("id", ""): n for n in nodes if n.get("id")
    }
    return _filter_subgraph_multi(nodes, edges, target_types, node_map)


def _filter_subgraph_multi(
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    edge_types: set[str],
    node_map: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """从完整图谱中过滤出多个边类型的子图（内部共用逻辑）。"""
    filtered_edges = [e for e in edges if e.get("type") in edge_types]

    # 收集涉及的节点 ID
    involved_ids: set[str] = set()
    for e in filtered_edges:
        if e.get("from"):
            involved_ids.add(e["from"])
        if e.get("to"):
            involved_ids.add(e["to"])

    filtered_nodes = [node_map[nid] for nid in involved_ids if nid in node_map]

    return {
        "nodes": filtered_nodes,
        "edges": filtered_edges,
    }


# ---------------------------------------------------------------------------
# Filename mapping
# ---------------------------------------------------------------------------


def _edge_type_to_filename(edge_type: str) -> str:
    """将边类型映射到子图文件名。

    已知类型使用固定映射；未知类型动态生成 ``<edge_type>-graph.json``。

    Examples:
        "calls"    → "call-graph.json"
        "contains" → "module-graph.json"
        "imports"  → "module-graph.json"
        "reads"    → "data-graph.json"
        "writes"   → "data-graph.json"
        "triggers" → "triggers-graph.json"
    """
    return _EDGE_TYPE_TO_SUBGRAPH.get(
        edge_type,
        f"{_safe_repo_id(edge_type)}-graph.json",
    )


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def _validate_graph(graph: Any) -> None:
    """验证 graph 字典格式，不合法时抛出 StorageError。"""
    if not isinstance(graph, dict):
        raise StorageError(
            f"graph 必须是 dict，得到 {type(graph).__name__}"
        )
    if "nodes" not in graph and "edges" not in graph:
        raise StorageError(
            "graph 必须包含 'nodes' 或 'edges' 键"
        )
    nodes = graph.get("nodes")
    edges = graph.get("edges")
    if nodes is not None and not isinstance(nodes, list):
        raise StorageError("graph['nodes'] 必须是 list")
    if edges is not None and not isinstance(edges, list):
        raise StorageError("graph['edges'] 必须是 list")


# ---------------------------------------------------------------------------
# I/O helpers
# ---------------------------------------------------------------------------


def _write_json(path: Path, data: Any) -> None:
    """将数据序列化为 JSON 并写入文件（原子写入：先写临时文件再重命名）。"""
    tmp = path.with_suffix(".tmp")
    try:
        tmp.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        tmp.replace(path)
    except Exception:
        tmp.unlink(missing_ok=True)
        raise


def _read_json(path: Path) -> Any:
    """读取 JSON 文件并返回解析结果。"""
    return json.loads(path.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# Misc utilities
# ---------------------------------------------------------------------------


def _safe_repo_id(repo_id: str) -> str:
    """将 repo_id 转为合法目录名（只保留字母、数字、- _ .）。"""
    s = re.sub(r"[^\w\-.]", "_", repo_id.strip())
    return s[:120] or "repo"


def _utc_now() -> str:
    """返回当前 UTC 时间的 ISO 8601 字符串。"""
    return datetime.now(timezone.utc).isoformat()


def _count_by(values: Any) -> dict[str, int]:
    """统计可迭代字符串值的频次。"""
    counts: dict[str, int] = {}
    for v in values:
        if v:
            counts[v] = counts.get(v, 0) + 1
    return counts
