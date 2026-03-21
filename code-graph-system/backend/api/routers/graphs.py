"""图谱视图 API：三个语义清晰的只读视图接口 + events/services 保留接口。

路由：
  GET /graph/framework  — 架构图（高层节点，可过滤类型）
  GET /graph/call       — 调用图（calls 边 + 相关节点，可 BFS 展开）
  GET /graph/lineage    — 血缘图（depends_on/reads/writes 等边，可 BFS 展开）
  GET /events           — 事件流图（保留，使用 GraphRepository）
  GET /services         — 基础设施服务图（保留，使用 GraphRepository）
"""
from __future__ import annotations

import logging
from collections import deque
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query

from backend.api.deps import get_graph_repo, get_graph_storage
from backend.graph.graph_schema import ARCHITECTURE_NODE_TYPES
from backend.storage.graph_storage import RepoNotFoundError

logger = logging.getLogger(__name__)
router = APIRouter()

_LINEAGE_EDGE_TYPES = frozenset({
    "depends_on", "reads", "writes", "produces", "consumes", "imports",
})


# ── Helpers ───────────────────────────────────────────────────────────────────


def _storage_load_or_404(repo_id: str) -> dict[str, Any]:
    try:
        return get_graph_storage().load_graph(repo_id)
    except RepoNotFoundError:
        raise HTTPException(status_code=404, detail=f"repo not found: {repo_id}")
    except Exception as exc:
        logger.exception("GraphStorage 读取失败: %s", repo_id)
        raise HTTPException(status_code=500, detail=str(exc))


def _load_built_or_404(graph_id: str):
    """加载 BuiltGraph（用于 /events 和 /services）。"""
    graph_repo = get_graph_repo()
    built = graph_repo.load(graph_id)
    if built is None:
        raise HTTPException(status_code=404, detail=f"图谱不存在: {graph_id}")
    return built


def _bfs_subgraph(
    nodes: list[dict],
    edges: list[dict],
    root_id: str,
    edge_types: frozenset[str],
    depth: int,
) -> dict[str, Any]:
    """从 root_id 出发，BFS 展开指定边类型的子图，最多 depth 层。"""
    node_map = {n["id"]: n for n in nodes if n.get("id")}
    if root_id not in node_map:
        raise HTTPException(status_code=404, detail=f"node not found: {root_id}")

    visited: set[str] = {root_id}
    queue: deque[tuple[str, int]] = deque([(root_id, 0)])
    result_edges: list[dict] = []

    while queue:
        current_id, current_depth = queue.popleft()
        if current_depth >= depth:
            continue
        for edge in edges:
            if edge.get("type") not in edge_types:
                continue
            neighbor = None
            if edge.get("from") == current_id:
                neighbor = edge.get("to")
            elif edge.get("to") == current_id:
                neighbor = edge.get("from")
            if neighbor and neighbor not in visited:
                visited.add(neighbor)
                result_edges.append(edge)
                queue.append((neighbor, current_depth + 1))
            elif neighbor and edge not in result_edges:
                result_edges.append(edge)

    result_nodes = [node_map[nid] for nid in visited if nid in node_map]
    return {"nodes": result_nodes, "edges": result_edges}


def _filter_by_edge_types(
    nodes: list[dict],
    edges: list[dict],
    edge_types: frozenset[str],
) -> dict[str, Any]:
    """返回指定边类型的边及其涉及的节点。"""
    filtered_edges = [e for e in edges if e.get("type") in edge_types]
    involved_ids: set[str] = set()
    for e in filtered_edges:
        if e.get("from"):
            involved_ids.add(e["from"])
        if e.get("to"):
            involved_ids.add(e["to"])
    node_map = {n["id"]: n for n in nodes if n.get("id")}
    filtered_nodes = [node_map[nid] for nid in involved_ids if nid in node_map]
    return {"nodes": filtered_nodes, "edges": filtered_edges}


# ── New Endpoints (GraphStorage / repo_id) ────────────────────────────────────


@router.get("/graph/framework", tags=["图谱视图"])
def get_framework(
    repo_id: str = Query(description="仓库 ID"),
    node_types: Optional[str] = Query(
        default=None,
        description="逗号分隔的节点类型（PascalCase）；不传使用架构层默认集合；传 'all' 返回全部节点",
    ),
) -> dict[str, Any]:
    """
    架构图视图。

    返回高层架构节点及其连接关系。默认过滤掉 Class/Function 等细粒度节点。
    edges 只包含两端节点都在结果集内的边。

    - ``node_types`` 不传：返回 ARCHITECTURE_NODE_TYPES 定义的架构层节点
    - ``node_types=all``：返回全部节点（替代旧 /graph/data）
    - ``node_types=Module,File``：只返回指定类型（替代旧 /graph/module）
    """
    graph = _storage_load_or_404(repo_id)
    all_nodes: list[dict] = graph.get("nodes", [])
    all_edges: list[dict] = graph.get("edges", [])

    if node_types == "all":
        result_nodes = all_nodes
    else:
        target_types = (
            {t.strip() for t in node_types.split(",") if t.strip()}
            if node_types
            else ARCHITECTURE_NODE_TYPES
        )
        result_nodes = [n for n in all_nodes if n.get("type") in target_types]

    result_node_ids = {n["id"] for n in result_nodes if n.get("id")}
    result_edges = [
        e for e in all_edges
        if e.get("from") in result_node_ids and e.get("to") in result_node_ids
    ]

    return {
        "repo_id": repo_id,
        "node_count": len(result_nodes),
        "edge_count": len(result_edges),
        "nodes": result_nodes,
        "edges": result_edges,
    }


@router.get("/graph/call", tags=["图谱视图"])
def get_call(
    repo_id: str = Query(description="仓库 ID"),
    node_id: Optional[str] = Query(default=None, description="起点节点 ID；指定后 BFS 展开调用子图"),
    depth: int = Query(default=2, ge=1, le=5, description="BFS 深度（仅 node_id 有效时生效）"),
) -> dict[str, Any]:
    """
    调用图视图。

    - 不传 ``node_id``：返回全图 calls 边及相关节点（读预生成 call-graph.json）
    - 传入 ``node_id``：从该节点 BFS 展开调用子图
    """
    storage = get_graph_storage()

    if node_id is None:
        try:
            subgraph = storage.get_subgraph(repo_id, "calls")
        except RepoNotFoundError:
            raise HTTPException(status_code=404, detail=f"repo not found: {repo_id}")
        except Exception as exc:
            logger.exception("get_subgraph(calls) 失败: %s", repo_id)
            raise HTTPException(status_code=500, detail=str(exc))
        nodes = subgraph.get("nodes", [])
        edges = subgraph.get("edges", [])
    else:
        graph = _storage_load_or_404(repo_id)
        result = _bfs_subgraph(
            graph.get("nodes", []),
            graph.get("edges", []),
            node_id,
            frozenset({"calls"}),
            depth,
        )
        nodes = result["nodes"]
        edges = result["edges"]

    return {
        "repo_id": repo_id,
        "node_count": len(nodes),
        "edge_count": len(edges),
        "nodes": nodes,
        "edges": edges,
    }


@router.get("/graph/lineage", tags=["图谱视图"])
def get_lineage(
    repo_id: str = Query(description="仓库 ID"),
    edge_types: Optional[str] = Query(
        default=None,
        description="逗号分隔的边类型，默认全部血缘边类型",
    ),
    node_id: Optional[str] = Query(default=None, description="起点节点 ID；指定后 BFS 展开血缘子图"),
    depth: int = Query(default=2, ge=1, le=5, description="BFS 深度（仅 node_id 有效时生效）"),
) -> dict[str, Any]:
    """
    数据血缘视图。

    默认追踪：depends_on / reads / writes / produces / consumes / imports。

    - 不传 ``node_id``：返回全图血缘边及相关节点
    - 传入 ``node_id``：从该节点 BFS 展开血缘路径
    """
    target_types = (
        frozenset(t.strip() for t in edge_types.split(",") if t.strip())
        if edge_types
        else _LINEAGE_EDGE_TYPES
    )

    graph = _storage_load_or_404(repo_id)
    all_nodes = graph.get("nodes", [])
    all_edges = graph.get("edges", [])

    if node_id is not None:
        result = _bfs_subgraph(all_nodes, all_edges, node_id, target_types, depth)
    else:
        result = _filter_by_edge_types(all_nodes, all_edges, target_types)

    return {
        "repo_id":    repo_id,
        "edge_types": sorted(target_types),
        "node_count": len(result["nodes"]),
        "edge_count": len(result["edges"]),
        "nodes":      result["nodes"],
        "edges":      result["edges"],
    }


# ── Legacy Endpoints (GraphRepository / graph_id) — preserved ────────────────


@router.get("/events", tags=["图谱"])
def get_events(
    graph_id: str = Query(description="图谱 ID"),
    include_edges: bool = Query(default=True, description="是否返回事件关系边"),
):
    """
    获取事件流图。

    返回 `Event`、`Topic` 节点及其 `publishes`、`routes_to`、`consumes` 关系。
    同时返回相关的 `Component` 节点（Producer/Consumer）。
    """
    _EVENT_NODE_TYPES = {"Event", "Topic"}
    _EVENT_EDGE_TYPES = {"publishes", "routes_to", "consumes", "produces", "subscribes"}

    built = _load_built_or_404(graph_id)

    # 收集所有事件相关的边
    event_edges = []
    if include_edges:
        event_edges = [
            e.model_dump(by_alias=True)
            for e in built.edges
            if e.type in _EVENT_EDGE_TYPES
        ]

    # 收集所有涉及的节点 ID
    involved_node_ids = set()
    for e in built.edges:
        if e.type in _EVENT_EDGE_TYPES:
            involved_node_ids.add(e.from_)
            involved_node_ids.add(e.to)

    # 收集节点：Event/Topic 节点 + 相关的 Component 节点
    node_map = {n.id: n for n in built.nodes}
    event_nodes = []
    for node_id in involved_node_ids:
        if node_id in node_map:
            node = node_map[node_id]
            # 包含 Event/Topic 节点，以及参与事件流的 Component 节点
            if node.type in _EVENT_NODE_TYPES or node.type == "Component":
                event_nodes.append(node.model_dump())

    # 统计：按 node.type 分组
    type_counts: dict[str, int] = {}
    for n in event_nodes:
        type_counts[n["type"]] = type_counts.get(n["type"], 0) + 1

    return {
        "graph_id":    graph_id,
        "node_count":  len(event_nodes),
        "edge_count":  len(event_edges),
        "type_counts": type_counts,
        "nodes":       event_nodes,
        "edges":       event_edges,
    }


@router.get("/services", tags=["图谱"])
def get_services(
    graph_id: str = Query(description="图谱 ID"),
    include_edges: bool = Query(default=True, description="是否返回服务间关系边"),
):
    """
    获取基础设施服务图。

    返回 `Service`、`Cluster`、`Database` 节点及其 `deployed_on`、`uses`、`depends_on` 关系。
    """
    _SERVICE_NODE_TYPES = {"Service", "Cluster", "Database"}
    _SERVICE_EDGE_TYPES = {"deployed_on", "uses", "depends_on"}

    built = _load_built_or_404(graph_id)

    svc_nodes = [
        n.model_dump()
        for n in built.nodes
        if n.type in _SERVICE_NODE_TYPES
    ]
    svc_node_ids = {n["id"] for n in svc_nodes}

    if include_edges:
        svc_edges = [
            e.model_dump(by_alias=True)
            for e in built.edges
            if e.type in _SERVICE_EDGE_TYPES
            and e.from_ in svc_node_ids
            and e.to   in svc_node_ids
        ]
    else:
        svc_edges = []

    # 统计：按 node.type 分组
    type_counts: dict[str, int] = {}
    for n in svc_nodes:
        type_counts[n["type"]] = type_counts.get(n["type"], 0) + 1

    return {
        "graph_id":    graph_id,
        "node_count":  len(svc_nodes),
        "edge_count":  len(svc_edges),
        "type_counts": type_counts,
        "nodes":       svc_nodes,
        "edges":       svc_edges,
    }
