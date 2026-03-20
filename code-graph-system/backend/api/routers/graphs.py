"""图谱查询 API：/graph/*, /callgraph, /lineage, /events, /services"""
from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from backend.api.deps import get_graph_repo, get_graph_storage
from backend.graph.code_graph import CodeGraph
from backend.storage.graph_storage import RepoNotFoundError

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Helper Functions ────────────────────────────────────────────────────────


def _load_or_404(graph_id: str):
    """加载 BuiltGraph，不存在时抛出 404。"""
    graph_repo = get_graph_repo()
    built = graph_repo.load(graph_id)
    if built is None:
        raise HTTPException(status_code=404, detail=f"图谱不存在: {graph_id}")
    return built


def _storage_load_or_404(repo_id: str) -> dict[str, Any]:
    """从 GraphStorage 加载完整图谱，不存在时抛出 404。"""
    graph_storage = get_graph_storage()
    try:
        return graph_storage.load_graph(repo_id)
    except RepoNotFoundError:
        raise HTTPException(status_code=404, detail=f"图谱不存在: {repo_id}")
    except Exception as exc:
        logger.exception("GraphStorage 读取失败: %s", repo_id)
        raise HTTPException(status_code=500, detail=str(exc))


# ── Response Models ────────────────────────────────────────────────────────


class GraphDataResponse(BaseModel):
    """GET /graph, /graph/call, /graph/module 统一响应体。"""
    repo_id:     str
    node_count:  int
    edge_count:  int
    nodes:       list[dict[str, Any]]
    edges:       list[dict[str, Any]]


# ── Endpoints ────────────────────────────────────────────────────────────────


@router.get("/graph", tags=["图谱"])
def get_graph(
    graph_id: Optional[str] = Query(default=None, description="图谱 ID；不传则返回所有图谱摘要列表"),
    node_type: Optional[str] = Query(default=None, description="按节点类型过滤（仅在指定 graph_id 时生效）"),
    limit: int = Query(default=200, ge=1, le=5000, description="返回节点/边的最大数量"),
):
    """
    获取图谱信息。

    - 不传 `graph_id`：返回所有图谱摘要列表（包含正在分析的仓库）
    - 传入 `graph_id`：返回该图谱的节点和边（可按 `node_type` 过滤）
    """
    if graph_id is None:
        from backend.store.repo_status_store import get_repo_status_store

        # 从状态存储获取所有仓库（包括正在分析的）
        status_store = get_repo_status_store()
        all_repos = status_store.list_all()

        # 转换为前端期望的格式
        graphs = []
        for repo in all_repos:
            graph_info = {
                "graph_id": repo.get("graph_id", "") or repo.get("repo_id", ""),
                "repo_name": repo.get("repo_name", ""),
                "node_count": repo.get("node_count", 0),
                "edge_count": repo.get("edge_count", 0),
                "created_at": repo.get("created_at", ""),
                "status": repo.get("status", "completed"),
                "task_id": repo.get("task_id"),
                "stage": repo.get("stage", ""),
                "step": repo.get("step", 0),
                "total": repo.get("total", 6),
                "message": repo.get("message", ""),
                "error": repo.get("error"),
                "repo_path": repo.get("repo_path", ""),
                "branch": repo.get("branch"),
                "source_mode": repo.get("source_mode"),
                "language": repo.get("language", []),
                "repo_id": repo.get("repo_id", ""),
            }
            graphs.append(graph_info)

        return {"graphs": graphs, "total": len(graphs)}

    built = _load_or_404(graph_id)

    nodes = built.nodes
    if node_type:
        nodes = [n for n in nodes if n.type == node_type]

    node_list = []
    for n in nodes[:limit]:
        nd = n.model_dump()
        m = built.metrics.get(n.id)
        if m:
            nd["metrics"] = m
        node_list.append(nd)

    edge_list = [
        e.model_dump(by_alias=True)
        for e in built.edges[:limit]
    ]

    return {
        "graph_id":   graph_id,
        "node_count": built.node_count,
        "edge_count": built.edge_count,
        "node_types": built.meta.get("node_type_counts", {}),
        "edge_types": built.meta.get("edge_type_counts", {}),
        "nodes":      node_list,
        "edges":      edge_list,
    }


@router.get("/graph/export", tags=["图谱"])
def export_graph(
    graph_id: str = Query(description="图谱 ID"),
):
    """
    导出标准 JSON Graph，供前端直接消费。

    使用 ``CodeGraph`` schema，只包含核心节点类型和边类型。

    节点类型：``repository / module / file / class / function / api / database / table``

    边类型：``contains / imports / calls / reads / writes``

    返回格式：
    ```json
    {
      "graph_version": "1.0",
      "repo": {"name": "...", "path": "...", "language": "...", "commit": "..."},
      "nodes": [
        {"id": "...", "type": "...", "name": "...",
         "file": "...", "line": 1, "module": "...", "language": "..."}
      ],
      "edges": [
        {"from": "...", "to": "...", "type": "..."}
      ]
    }
    ```
    """
    built = _load_or_404(graph_id)

    meta      = built.meta or {}
    repo_name = meta.get("repo_name", graph_id)
    repo_path = meta.get("repo_path", "")
    commit    = meta.get("git_commit", "")

    code_graph = CodeGraph.from_built(
        built,
        repo_name=repo_name,
        repo_path=repo_path,
        commit=commit,
    )
    return code_graph.to_dict()


@router.get("/graph/data", response_model=GraphDataResponse, tags=["图谱数据"])
def get_graph_data(
    repo_id: str = Query(description="仓库 ID（由 POST /analyze/graph 返回的 graph_id）"),
):
    """
    获取完整 JSON Graph 数据。

    从 GraphStorage 读取 ``graph-storage/<repo_id>/graph.json``，
    返回所有节点和边。

    返回格式：
    ```json
    {
      "repo_id": "my-project",
      "node_count": 42,
      "edge_count": 87,
      "nodes": [{"id 端点：
    ```json
    {
      "repo_id": "my-project",
      "node_count": 42,
      "edge_count": 87,
      "nodes": [{"id": "...", "type": "...", "name": "...", ...}],
      "edges": [{"from": "...", "to": "...", "type": "..."}]
    }
    ```
    """
    graph = _storage_load_or_404(repo_id)
    nodes: list[dict[str, Any]] = graph.get("nodes", [])
    edges: list[dict[str, Any]] = graph.get("edges", [])
    logger.info("GET /graph/data  repo=%s  %d nodes / %d edges", repo_id, len(nodes), len(edges))
    return GraphDataResponse(
        repo_id=repo_id,
        node_count=len(nodes),
        edge_count=len(edges),
        nodes=nodes,
        edges=edges,
    )


@router.get("/graph/call", response_model=GraphDataResponse, tags=["图谱数据"])
def get_graph_call(
    repo_id: str = Query(description="仓库 ID"),
):
    """
    获取函数调用子图（``calls`` 边及相关节点）。

    从 GraphStorage 读取预生成的 ``call-graph.json``（若不存在则实时过滤）。

    只包含：
    - 边类型：``calls``
    - 节点：出现在 ``calls`` 边中的 ``function`` / ``api`` 节点

    返回格式同 ``GET /graph/data``。
    """
    graph_storage = get_graph_storage()
    try:
        subgraph = graph_storage.get_subgraph(repo_id, "calls")
    except RepoNotFoundError:
        raise HTTPException(status_code=404, detail=f"图谱不存在: {repo_id}")
    except Exception as exc:
        logger.exception("get_subgraph(calls) 失败: %s", repo_id)
        raise HTTPException(status_code=500, detail=str(exc))

    nodes: list[dict[str, Any]] = subgraph.get("nodes", [])
    edges: list[dict[str, Any]] = subgraph.get("edges", [])
    logger.info("GET /graph/call  repo=%s  %d nodes / %d edges", repo_id, len(nodes), len(edges))
    return GraphDataResponse(
        repo_id=repo_id,
        node_count=len(nodes),
        edge_count=len(edges),
        nodes=nodes,
        edges=edges,
    )


@router.get("/graph/module", response_model=GraphDataResponse, tags=["图谱数据"])
def get_graph_module(
    repo_id: str  = Query(description="仓库 ID"),
    edge_type: str = Query(
        default="contains",
        description="边类型过滤：``contains``（默认）、``imports`` 或 ``all``（contains + imports）",
    ),
):
    """
    获取模块结构子图（``contains`` / ``imports`` 边及相关节点）。

    从 GraphStorage 读取预生成的 ``module-graph.json``（若不存在则实时过滤）。

    - ``edge_type=contains``（默认）：仅返回包含关系（module -> file -> class/function）
    - ``edge_type=imports``：仅返回导入关系（module -> module）
    - ``edge_type=all``：返回 contains + imports 全部

    返回格式同 ``GET /graph/data``。
    """
    graph_storage = get_graph_storage()
    # "all" 等价于读取 module-graph.json（contains + imports 共用同一文件）
    query_type = "contains" if edge_type == "all" else edge_type

    try:
        subgraph = graph_storage.get_subgraph(repo_id, query_type)
    except RepoNotFoundError:
        raise HTTPException(status_code=404, detail=f"图谱不存在: {repo_id}")
    except Exception as exc:
        logger.exception("get_subgraph(%s) 失败: %s", edge_type, repo_id)
        raise HTTPException(status_code=500, detail=str(exc))

    nodes: list[dict[str, Any]] = subgraph.get("nodes", [])
    edges: list[dict[str, Any]] = subgraph.get("edges", [])

    # edge_type=contains 或 edge_type=imports 时，在内存中二次过滤
    if edge_type in ("contains", "imports"):
        edges = [e for e in edges if e.get("type") == edge_type]
        involved: set[str] = set()
        for e in edges:
            if e.get("from"):
                involved.add(e["from"])
            if e.get("to"):
                involved.add(e["to"])
        nodes = [n for n in nodes if n.get("id") in involved]

    logger.info(
        "GET /graph/module  repo=%s  edge_type=%s  %d nodes / %d edges",
        repo_id, edge_type, len(nodes), len(edges),
    )
    return GraphDataResponse(
        repo_id=repo_id,
        node_count=len(nodes),
        edge_count=len(edges),
        nodes=nodes,
        edges=edges,
    )


@router.get("/graph/summary", tags=["图谱"])
def get_graph_summary(
    graph_id: str = Query(description="图谱 ID"),
):
    """
    获取图谱 LOD-0 摘要（仅 Repository + Module 节点）。

    返回顶层 Repository 和 Module 节点及其之间的边，
    同时附带全图节点/边总数供前端进度条使用。
    """
    built = _load_or_404(graph_id)

    summary_types = {"Repository", "Module"}
    summary_nodes = [n.model_dump() for n in built.nodes if n.type in summary_types]

    # 若图谱中没有 Repository/Module 节点（如纯 Layer/Service 图），退化为返回全图
    if not summary_nodes:
        summary_nodes = [n.model_dump() for n in built.nodes]
        summary_edges = [e.model_dump(by_alias=True) for e in built.edges]
    else:
        summary_node_ids = {n["id"] for n in summary_nodes}
        summary_edges = [
            e.model_dump(by_alias=True)
            for e in built.edges
            if e.from_ in summary_node_ids and e.to in summary_node_ids
        ]

    return {
        "graph_id":         graph_id,
        "nodes":            summary_nodes,
        "edges":            summary_edges,
        "total_node_count": built.node_count,
        "total_edge_count": built.edge_count,
    }


@router.get("/callgraph", tags=["图谱"])
def get_callgraph(
    graph_id: str  = Query(description="图谱 ID"),
    node_id:  Optional[str] = Query(default=None, description="起始函数节点 ID；不传则返回全图调用关系"),
    depth:    int  = Query(default=1, ge=1, le=5, description="从指定节点 BFS 展开的深度"),
):
    """
    获取函数调用图。

    - 不传 `node_id`：返回图中所有 Function 节点和 `calls` 类型边
    - 传入 `node_id`：从该函数节点出发做 BFS，返回调用子图
    """
    graph_repo = get_graph_repo()
    built = _load_or_404(graph_id)

    if node_id:
        subgraph = graph_repo.query_neighbors(
            graph_id, node_id, depth=depth, edge_types=["calls"]
        )
        return {
            "graph_id": graph_id,
            "root":     node_id,
            "depth":    depth,
            "nodes":    subgraph["nodes"],
            "edges":    subgraph["edges"],
        }

    # 全图调用关系：仅 Function/API 节点 + calls 边
    # 兼容新格式（小写）和旧格式（PascalCase）
    call_node_types = {"Function", "API", "function", "api"}
    func_nodes = [
        n.model_dump()
        for n in built.nodes
        if n.type in call_node_types
    ]
    call_edges = [
        e.model_dump(by_alias=True)
        for e in built.edges
        if e.type == "calls"
    ]
    return {
        "graph_id":   graph_id,
        "node_count": len(func_nodes),
        "edge_count": len(call_edges),
        "nodes":      func_nodes,
        "edges":      call_edges,
    }


@router.get("/lineage", tags=["图谱"])
def get_lineage(
    graph_id:  str = Query(description="图谱 ID"),
    node_id:   Optional[str] = Query(default=None, description="起始节点 ID；不传则返回全图依赖血缘"),
    edge_types: Optional[str] = Query(
        default=None,
        description="逗号分隔的边类型，如 depends_on,reads,writes；不传则使用默认依赖类型",
    ),
):
    """
    获取依赖血缘图。

    默认追踪以下关系：`depends_on`、`reads`、`writes`、`produces`、`consumes`。

    - 不传 `node_id`：返回整图中所有血缘相关节点和边
    - 传入 `node_id`：从该节点出发 BFS 展开血缘路径
    """
    graph_repo = get_graph_repo()
    # 兼容新格式（imports 也属于血缘关系）
    _LINEAGE_EDGE_TYPES = {"depends_on", "reads", "writes", "produces", "consumes", "imports"}

    if edge_types:
        target_types = {t.strip() for t in edge_types.split(",") if t.strip()}
    else:
        target_types = _LINEAGE_EDGE_TYPES

    built = _load_or_404(graph_id)

    if node_id:
        subgraph = graph_repo.query_neighbors(
            graph_id, node_id, depth=2, edge_types=list(target_types)
        )
        return {
            "graph_id":   graph_id,
            "root":       node_id,
            "edge_types": sorted(target_types),
            "nodes":      subgraph["nodes"],
            "edges":      subgraph["edges"],
        }

    lineage_edges = [
        e.model_dump(by_alias=True)
        for e in built.edges
        if e.type in target_types
    ]
    # 只返回出现在血缘边中的节点
    involved_ids: set[str] = set()
    for e in built.edges:
        if e.type in target_types:
            involved_ids.add(e.from_)
            involved_ids.add(e.to)

    node_map = {n.id: n for n in built.nodes}
    lineage_nodes = [
        node_map[nid].model_dump()
        for nid in involved_ids
        if nid in node_map
    ]

    return {
        "graph_id":   graph_id,
        "edge_types": sorted(target_types),
        "node_count": len(lineage_nodes),
        "edge_count": len(lineage_edges),
        "nodes":      lineage_nodes,
        "edges":      lineage_edges,
    }


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

    built = _load_or_404(graph_id)

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

    built = _load_or_404(graph_id)

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


@router.delete("/graph/{graph_id}", tags=["图谱"])
def delete_graph(graph_id: str):
    """
    删除指定图谱。

    删除本地 JSON 文件、索引条目，以及 Neo4j 中的数据（如果已配置）。
    """
    logger.info("DELETE /graph/%s", graph_id)

    graph_repo = get_graph_repo()

    # 检查图谱是否存在
    built = graph_repo.load(graph_id)
    if built is None:
        raise HTTPException(status_code=404, detail=f"图谱不存在: {graph_id}")

    # 删除图谱
    try:
        deleted = graph_repo.delete(graph_id)
        if not deleted:
            raise HTTPException(status_code=404, detail=f"图谱不存在: {graph_id}")

        # 同步删除 repo_status_store 中的记录
        from backend.store.repo_status_store import get_repo_status_store
        status_store = get_repo_status_store()
        # repo_id 可能等于 graph_id，也可能不同，遍历找到匹配的记录
        for repo in status_store.list_all():
            if repo.get("graph_id") == graph_id or repo.get("repo_id") == graph_id:
                status_store.delete(repo["repo_id"])
                break

        logger.info("图谱已删除: %s", graph_id)
        return {
            "success": True,
            "graph_id": graph_id,
            "message": "图谱已成功删除"
        }
    except Exception as e:
        logger.exception("删除图谱失败")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/repo/{repo_id}", tags=["仓库"])
def delete_repo(repo_id: str):
    """
    删除仓库状态记录（用于删除尚未完成分析、没有 graph_id 的仓库）。

    - 若该仓库有关联的 graph_id，同时删除图谱数据。
    - 若仓库正在分析中，仅删除状态记录（不影响正在运行的 Celery 任务）。
    """
    logger.info("DELETE /repo/%s", repo_id)

    from backend.store.repo_status_store import get_repo_status_store
    from backend.api.deps import get_graph_repo

    status_store = get_repo_status_store()
    repo = status_store.get_status(repo_id)

    if repo is None:
        raise HTTPException(status_code=404, detail=f"仓库不存在: {repo_id}")

    # 若有关联 graph_id，一并删除图谱数据
    graph_id = repo.get("graph_id")
    if graph_id:
        try:
            graph_repo = get_graph_repo()
            graph_repo.delete(graph_id)
        except Exception:
            pass  # 图谱文件可能已不存在，忽略

    status_store.delete(repo_id)
    logger.info("仓库已删除: %s (graph_id=%s)", repo_id, graph_id)
    return {
        "success": True,
        "repo_id": repo_id,
        "graph_id": graph_id,
        "message": "仓库已成功删除",
    }
