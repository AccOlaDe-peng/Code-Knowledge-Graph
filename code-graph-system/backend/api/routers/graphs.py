"""图谱视图 API：三个语义清晰的只读视图接口 + services 保留接口。

路由：
  GET /graph/framework  — 架构图（高层节点，可过滤类型）
  GET /graph/call       — 调用图（calls 边 + 相关节点，可 BFS 展开）
  GET /graph/lineage    — 血缘图（depends_on/reads/writes 等边，可 BFS 展开）
  GET /services         — 基础设施服务图（保留，使用 GraphRepository）
"""
from __future__ import annotations

import json
import logging
from collections import deque
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from backend.api.deps import get_graph_repo, get_graph_storage
from backend.config import DEFAULT_FOCUS_DEPTH, LARGE_GRAPH_THRESHOLD
from backend.graph.graph_schema import (
    ARCHITECTURE_NODE_TYPES,
    STRUCTURAL_EDGE_TYPES,
    LINEAGE_EDGE_TYPES,
)
from backend.storage.graph_storage import RepoNotFoundError, _safe_repo_id

logger = logging.getLogger(__name__)
router = APIRouter()

# 使用 graph_schema 中定义的血缘边类型
_LINEAGE_EDGE_TYPES = LINEAGE_EDGE_TYPES

# 架构图存储路径
_ARCHITECTURE_STORAGE_DIR = Path("./data/graphs")


# ── Helpers ───────────────────────────────────────────────────────────────────


def _resolve_graph_id(repo_id: str) -> str:
    """将前端 repo_id 解析为实际的 graph_id。

    查找顺序：
    1. 直接在 GraphStorage 中查找 repo_id（兼容旧逻辑）
    2. 从 analysis_store 获取最新 graph_id

    Returns:
        实际的 graph_id（用于 GraphStorage 查询）

    Raises:
        RepoNotFoundError: 找不到对应图谱时抛出
    """
    storage = get_graph_storage()

    # 1. 直接用 repo_id 查找（兼容 graph_id == repo_id 的情况）
    if storage.repo_exists(repo_id):
        return repo_id

    # 2. 从 analysis_store 获取最新 graph_id
    from backend.store.analysis_store import get_analysis_store
    analysis_store = get_analysis_store()
    latest = analysis_store.get_latest(repo_id)

    if latest and latest.get("graph_id"):
        graph_id = latest["graph_id"]
        if storage.repo_exists(graph_id):
            logger.debug("resolve_graph_id: repo_id=%s -> graph_id=%s", repo_id, graph_id)
            return graph_id

    # 找不到
    raise RepoNotFoundError(repo_id)


def _storage_load_or_404(repo_id: str) -> dict[str, Any]:
    try:
        # 解析实际的 graph_id
        graph_id = _resolve_graph_id(repo_id)
        return get_graph_storage().load_graph(graph_id)
    except HTTPException:
        raise
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


def _bfs_lineage_subgraph(
    nodes: list[dict],
    edges: list[dict],
    root_id: str,
    edge_types: frozenset[str],
    depth: int,
    direction: str = "downstream",
) -> dict[str, Any]:
    """从 root_id 出发，方向感知的 BFS 展开血缘子图。

    Args:
        nodes: 所有节点
        edges: 所有边
        root_id: 起始节点 ID
        edge_types: 边类型过滤
        depth: 最大深度
        direction: 追踪方向
            - "downstream": 追踪下游影响（数据去向），沿 from → to 方向
            - "upstream": 追溯上游来源（数据来源），沿 to → from 方向
            - "both": 双向展开

    Returns:
        {"nodes": [...], "edges": [...]}
    """
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
            edge_from = edge.get("from")
            edge_to = edge.get("to")

            if direction == "downstream":
                # 追踪下游：沿 from → to 方向
                if edge_from == current_id and edge_to:
                    neighbor = edge_to
            elif direction == "upstream":
                # 追溯上游：沿 to → from 方向（反向）
                if edge_to == current_id and edge_from:
                    neighbor = edge_from
            else:
                # 双向展开
                if edge_from == current_id and edge_to:
                    neighbor = edge_to
                elif edge_to == current_id and edge_from:
                    neighbor = edge_from

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


def _get_module_class_level_graph(
    all_nodes: list[dict],
    all_edges: list[dict],
    module_name: str,
) -> dict[str, Any]:
    """获取模块内的 Class 级血缘图。

    聚合 Function 级 calls 边为 Class 级 calls 边，
    同时保留 reads/writes 等血缘边。

    Args:
        all_nodes: 原始节点列表
        all_edges: 原始边列表
        module_name: 模块名

    Returns:
        {nodes: Class 级节点, edges: Class 级边}
    """
    # 1. 收集模块内的 Class 级节点
    class_nodes = []
    class_node_ids = set()
    function_to_class: dict[str, str] = {}  # function ID -> class ID

    for node in all_nodes:
        node_id = node.get("id", "")
        node_type = node.get("type", "")

        # 检查是否在模块内
        extracted_module = _extract_module_from_id(node_id)
        if extracted_module != module_name:
            continue

        # 过滤掉测试类
        if "/test/" in node_id or "/Test" in node_id or node_id.endswith("Test"):
            continue

        if node_type == "Class":
            class_nodes.append(node)
            class_node_ids.add(node_id)

        elif node_type == "Service":
            class_nodes.append(node)
            class_node_ids.add(node_id)

        elif node_type == "Component":
            # 检查是否是 Controller
            annotations = node.get("properties", {}).get("annotations", [])
            if "@RestController" in annotations or "@Controller" in annotations:
                class_nodes.append(node)
                class_node_ids.add(node_id)

        elif node_type == "Function":
            # 构建 function -> class 映射
            # function:adms-api/src/.../UserService.java:UserService.getUser
            # -> class:adms-api/src/.../UserService.java:UserService
            if node_id.startswith("function:"):
                parts = node_id.rsplit(".", 1)
                if len(parts) == 2:
                    class_id = f"class:{parts[0][9:]}"  # 移除 "function:" 前缀
                    function_to_class[node_id] = class_id

    # 2. 收集模块内涉及的其他节点（Database 等）
    other_nodes = []
    for node in all_nodes:
        node_id = node.get("id", "")
        node_type = node.get("type", "")
        if node_type in ("Database",) and node_id.startswith(("datasource:", "database:")):
            other_nodes.append(node)

    # 3. 聚合 Function 级 calls 边为 Class 级 calls 边
    class_edge_map: dict[tuple[str, str, str], dict] = {}  # (from, to, type) -> edge

    def extract_class_id(node_id: str) -> str | None:
        """从节点 ID 提取 Class ID。

        支持：
        - function:adms-api/src/.../UserService.java:UserService.method -> class:adms-api/src/.../UserService.java:UserService
        - class:adms-api/src/.../UserService.java:UserService -> class:adms-api/src/.../UserService.java:UserService
        """
        if node_id.startswith("function:"):
            parts = node_id.rsplit(".", 1)
            if len(parts) == 2:
                return f"class:{parts[0][9:]}"  # 移除 "function:" 前缀
        elif node_id.startswith("class:"):
            return node_id
        return None

    for edge in all_edges:
        edge_type = edge.get("type", "")
        from_id = edge.get("from", "")
        to_id = edge.get("to", "")

        if edge_type == "calls":
            # 聚合 Function 级 calls 边
            from_class = function_to_class.get(from_id) or extract_class_id(from_id)
            to_class = function_to_class.get(to_id) or extract_class_id(to_id)

            if not from_class or not to_class:
                continue

            # 只保留至少一端在模块内的边
            if from_class not in class_node_ids and to_class not in class_node_ids:
                continue

            key = (from_class, to_class, "calls")
            if key not in class_edge_map:
                class_edge_map[key] = {
                    "from": from_class,
                    "to": to_class,
                    "type": "calls",
                    "properties": {
                        "call_count": 0,
                        "source": "aggregated_from_functions",
                    },
                }
            class_edge_map[key]["properties"]["call_count"] += 1

        elif edge_type in ("reads", "writes"):
            # 保留 reads/writes 边（Repository -> Database）
            # from_id 是 Class，to_id 是 Database
            if from_id in class_node_ids:
                key = (from_id, to_id, edge_type)
                if key not in class_edge_map:
                    class_edge_map[key] = {
                        "from": from_id,
                        "to": to_id,
                        "type": edge_type,
                        "properties": edge.get("properties", {}),
                    }

    class_edges = list(class_edge_map.values())

    # 4. 添加 Database 节点（如果被边引用）
    involved_db_ids = set()
    for edge in class_edges:
        to_id = edge.get("to", "")
        if to_id.startswith(("datasource:", "database:")):
            involved_db_ids.add(to_id)

    for node in other_nodes:
        if node.get("id") in involved_db_ids:
            class_nodes.append(node)

    return {"nodes": class_nodes, "edges": class_edges}


def _infer_lineage_from_graph(
    nodes: list[dict],
    edges: list[dict],
) -> dict[str, Any]:
    """动态推断数据血缘关系（当图谱中没有预计算的血缘边时）。

    策略：
    1. 识别 Service 节点，从 calls 边推断 Service → Service flow_to
    2. 识别 Repository 节点，推断 Repository → Database reads/writes
    3. 识别 Class 节点的命名模式（XxxService, XxxRepository）
    """
    import re

    inferred_nodes: list[dict] = []
    inferred_edges: list[dict] = []

    # 构建 ID → node 映射
    node_map = {n["id"]: n for n in nodes if n.get("id")}

    def extract_class_id(node_id: str) -> str | None:
        """从 Function ID 提取所属 Class ID。"""
        # function:path/to/File.java:ClassName.methodName -> class:path/to/File.java:ClassName
        if node_id.startswith("function:"):
            parts = node_id[len("function:"):].rsplit(".", 1)
            if len(parts) == 2:
                return f"class:{parts[0]}"
        return None

    def is_service_class(node_id: str) -> bool:
        """判断 Class ID 是否是 Service。"""
        node = node_map.get(node_id)
        if not node:
            return False
        if node.get("type") == "Service":
            return True
        name = node.get("name", "")
        return bool(re.match(r".*Service(?:Impl)?$", name))

    def is_repository_class(node_id: str) -> bool:
        """判断 Class ID 是否是 Repository。"""
        node = node_map.get(node_id)
        if not node:
            return False
        name = node.get("name", "")
        return bool(re.match(r".*(?:Repository|Repo|DAO|Dao|Mapper)$", name))

    # 识别 Service 和 Repository 节点
    service_nodes = []
    repository_nodes = []

    for node in nodes:
        node_type = node.get("type", "")
        node_id = node.get("id", "")
        name = node.get("name", "")

        # Service 识别
        if node_type == "Service":
            service_nodes.append(node)
        elif node_type == "Class":
            if re.match(r".*Service(?:Impl)?$", name):
                service_nodes.append(node)
            elif re.match(r".*(?:Repository|Repo|DAO|Dao|Mapper)$", name):
                repository_nodes.append(node)

    # 从 Function 级 calls 边推断 Class 级 Service → Service flow_to
    service_ids = {n["id"] for n in service_nodes}
    class_flow_edges: set[tuple[str, str]] = set()  # (from_class, to_class)

    for edge in edges:
        if edge.get("type") != "calls":
            continue
        from_id = edge.get("from", "")
        to_id = edge.get("to", "")

        # 提取 Class ID
        from_class = extract_class_id(from_id)
        to_class = extract_class_id(to_id)

        if not from_class or not to_class:
            continue

        # 检查是否是 Service -> Service
        if from_class in service_ids and to_class in service_ids:
            if from_class != to_class:  # 排除自引用
                class_flow_edges.add((from_class, to_class))

    # 生成 flow_to 边
    for from_class, to_class in class_flow_edges:
        inferred_edges.append({
            "from": from_class,
            "to": to_class,
            "type": "flow_to",
            "properties": {
                "source": "dynamic_inference",
                "confidence": 0.7,
                "inferred_from": "function_calls",
            },
        })

    # 推断 Repository → Database
    if repository_nodes:
        # 创建默认 Database 节点
        db_node = {
            "id": "datasource:primary",
            "type": "Database",
            "name": "PrimaryDB",
            "properties": {"inferred": True, "source": "dynamic_inference"},
        }
        inferred_nodes.append(db_node)

        for repo_node in repository_nodes:
            # reads 边
            inferred_edges.append({
                "from": repo_node["id"],
                "to": db_node["id"],
                "type": "reads",
                "properties": {"source": "dynamic_inference", "confidence": 0.8},
            })
            # writes 边
            inferred_edges.append({
                "from": repo_node["id"],
                "to": db_node["id"],
                "type": "writes",
                "properties": {"source": "dynamic_inference", "confidence": 0.8},
            })

    # 收集涉及的原始节点
    involved_ids: set[str] = set()
    for e in inferred_edges:
        involved_ids.add(e["from"])
        involved_ids.add(e["to"])

    # 添加涉及的原始节点（排除动态创建的 Database 节点）
    result_nodes = [node_map[nid] for nid in involved_ids if nid in node_map]
    # 添加动态创建的节点
    for node in inferred_nodes:
        if node["id"] not in {n["id"] for n in result_nodes}:
            result_nodes.append(node)

    return {"nodes": result_nodes, "edges": inferred_edges, "inferred": True}


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

    - 不传 ``node_id``：
      - 大图谱：返回预生成的核心子图（最高度数节点 + 2 层 BFS）
      - 小图谱：返回全量 call-graph.json
    - 传入 ``node_id``：从该节点 BFS 展开调用子图
    """
    storage = get_graph_storage()

    # 用户指定起点：运行时 BFS
    if node_id is not None:
        graph = _storage_load_or_404(repo_id)
        result = _bfs_subgraph(
            graph.get("nodes", []),
            graph.get("edges", []),
            node_id,
            frozenset({"calls"}),
            depth,
        )
        return {
            "repo_id": repo_id,
            "node_count": len(result["nodes"]),
            "edge_count": len(result["edges"]),
            "nodes": result["nodes"],
            "edges": result["edges"],
        }

    # 无指定起点：智能加载
    try:
        # 解析实际的 graph_id
        graph_id = _resolve_graph_id(repo_id)

        # 获取仓库目录路径
        repo_dir = storage._repo_dir(_safe_repo_id(graph_id))
        core_path = repo_dir / "call-graph-core.json"

        # 优先返回核心子图（最快路径）
        if core_path.exists():
            try:
                with open(core_path, encoding="utf-8") as f:
                    core_data = json.load(f)
                return {
                    "repo_id": repo_id,
                    "node_count": len(core_data.get("nodes", [])),
                    "edge_count": len(core_data.get("edges", [])),
                    "nodes": core_data.get("nodes", []),
                    "edges": core_data.get("edges", []),
                    "meta": core_data.get("meta", {}),
                }
            except Exception as exc:
                logger.warning("读取 call-graph-core.json 失败，降级: %s", exc)

        # 回退：读取 call-graph.json
        subgraph = storage.get_subgraph(graph_id, "calls")
        nodes = subgraph.get("nodes", [])
        edges = subgraph.get("edges", [])
        meta = subgraph.get("meta", {})

        # 大图谱但无 core 文件：运行时 BFS（兼容旧数据）
        if len(nodes) > LARGE_GRAPH_THRESHOLD:
            entry_node_id = meta.get("entry_node_id")
            if entry_node_id:
                graph = _storage_load_or_404(repo_id)
                result = _bfs_subgraph(
                    graph.get("nodes", []),
                    graph.get("edges", []),
                    entry_node_id,
                    frozenset({"calls"}),
                    DEFAULT_FOCUS_DEPTH,
                )
                return {
                    "repo_id": repo_id,
                    "node_count": len(result["nodes"]),
                    "edge_count": len(result["edges"]),
                    "nodes": result["nodes"],
                    "edges": result["edges"],
                    "meta": {
                        "auto_focus": True,
                        "focus_node_id": entry_node_id,
                        "focus_depth": DEFAULT_FOCUS_DEPTH,
                        "total_nodes": len(nodes),
                        "total_edges": len(edges),
                    },
                }

        # 小图谱或无入口：返回全量
        return {
            "repo_id": repo_id,
            "node_count": len(nodes),
            "edge_count": len(edges),
            "nodes": nodes,
            "edges": edges,
        }

    except RepoNotFoundError:
        raise HTTPException(status_code=404, detail=f"repo not found: {repo_id}")
    except Exception as exc:
        logger.exception("get_call 失败: %s", repo_id)
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/graph/lineage", tags=["图谱视图"])
def get_lineage(
    repo_id: str = Query(description="仓库 ID"),
    edge_types: Optional[str] = Query(
        default=None,
        description="逗号分隔的边类型，默认全部血缘边类型",
    ),
    node_id: Optional[str] = Query(default=None, description="起点节点 ID；指定后 BFS 展开血缘子图"),
    depth: int = Query(default=3, ge=1, le=5, description="BFS 深度（仅 node_id 有效时生效）"),
    direction: str = Query(
        default="downstream",
        description="追踪方向: downstream(下游影响) | upstream(上游来源) | both(双向)",
    ),
    module_id: Optional[str] = Query(
        default=None,
        description="模块 ID（如 adms-api）；指定后只返回该模块内的节点和边",
    ),
    include_calls: bool = Query(
        default=True,
        description="是否包含 calls 边（用于展示 Controller → Service → Repository 链路）",
    ),
) -> dict[str, Any]:
    """
    数据血缘视图。

    追踪血缘边类型：reads / writes / produces / consumes / queries / flow_to / transforms / depends_on / imports。

    Args:
        repo_id: 仓库 ID
        edge_types: 边类型过滤，默认全部血缘边类型
        node_id: 起点节点 ID
        depth: BFS 深度（1-5）
        direction: 追踪方向
            - downstream: 追踪下游影响（数据去向）
            - upstream: 追溯上游来源（数据来源）
            - both: 双向展开
        module_id: 模块 ID，指定后只返回该模块内的节点和边（聚合为 Class 级）
        include_calls: 是否包含 calls 边

    Returns:
        血缘图数据（nodes + edges）
    """
    # 验证 direction 参数
    if direction not in ("downstream", "upstream", "both"):
        raise HTTPException(
            status_code=400,
            detail=f"无效的 direction 参数: {direction}，可选值: downstream, upstream, both",
        )

    # 构建目标边类型集合
    target_types = (
        frozenset(t.strip() for t in edge_types.split(",") if t.strip())
        if edge_types
        else _LINEAGE_EDGE_TYPES
    )

    # 如果需要包含 calls 边，添加到目标类型
    if include_calls and "calls" not in target_types:
        target_types = target_types | {"calls"}

    graph = _storage_load_or_404(repo_id)
    all_nodes = graph.get("nodes", [])
    all_edges = graph.get("edges", [])

    # 如果指定了 module_id，使用专门的模块级聚合逻辑
    if module_id:
        module_name = module_id.replace("module:", "")
        result = _get_module_class_level_graph(all_nodes, all_edges, module_name)
        return {
            "repo_id":    repo_id,
            "module_id":  module_id,
            "edge_types": sorted(target_types),
            "direction":  direction,
            "node_count": len(result["nodes"]),
            "edge_count": len(result["edges"]),
            "nodes":      result["nodes"],
            "edges":      result["edges"],
            "inferred":   False,
        }

    # 检查图谱中是否有预计算的血缘边
    has_lineage_edges = any(
        e.get("type") in target_types for e in all_edges
    )

    inferred = False
    effective_edges = all_edges

    # 如果没有预计算血缘边，动态推断
    if not has_lineage_edges:
        logger.info("[lineage] 无预计算血缘边，尝试动态推断: repo_id=%s", repo_id)
        inferred_result = _infer_lineage_from_graph(all_nodes, all_edges)
        if inferred_result["edges"]:
            # 合并推断的边和原始边（保留原始边用于其他类型）
            effective_edges = list(all_edges) + inferred_result["edges"]
            # 添加推断的节点
            inferred_node_ids = {n["id"] for n in all_nodes}
            additional_nodes = [n for n in inferred_result["nodes"] if n["id"] not in inferred_node_ids]
            all_nodes = list(all_nodes) + additional_nodes
            inferred = True
            logger.info(
                "[lineage] 动态推断完成: %d 新节点, %d 新边",
                len(additional_nodes),
                len(inferred_result["edges"]),
            )

    # 在有效边上执行 BFS 或过滤
    if node_id is not None:
        result = _bfs_lineage_subgraph(
            all_nodes, effective_edges, node_id, target_types, depth, direction
        )
    else:
        result = _filter_by_edge_types(all_nodes, effective_edges, target_types)

    return {
        "repo_id":    repo_id,
        "module_id":  module_id,
        "edge_types": sorted(target_types),
        "direction":  direction,
        "node_count": len(result["nodes"]),
        "edge_count": len(result["edges"]),
        "nodes":      result["nodes"],
        "edges":      result["edges"],
        "inferred":   inferred,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 模块级血缘视图 API
# ─────────────────────────────────────────────────────────────────────────────


def _extract_module_from_id(node_id: str) -> str | None:
    """从节点 ID 中提取模块名。

    支持的 ID 格式：
    - class:adms-api/src/main/java/... -> adms-api
    - function:adms-api/src/main/java/... -> adms-api
    - datasource:primary -> None (非模块节点)

    Returns:
        模块名，如果无法提取则返回 None
    """
    if not node_id:
        return None

    # 过滤掉特殊节点类型
    SPECIAL_PREFIXES = ("datasource:", "database:", "topic:", "external:", "module:")
    if any(node_id.startswith(prefix) for prefix in SPECIAL_PREFIXES):
        return None

    # 移除前缀 (class:, function:, etc.)
    id_body = node_id.split(":", 1)[-1] if ":" in node_id else node_id

    # 取第一个路径段作为模块名
    parts = id_body.split("/")
    if len(parts) >= 1 and parts[0]:
        return parts[0]

    return None


def _aggregate_class_to_module_edges(
    nodes: list[dict],
    edges: list[dict],
) -> tuple[dict[str, dict], list[dict]]:
    """将 Class 级 calls 边聚合为 Module 级 flow_to 边。

    Args:
        nodes: 原始节点列表
        edges: 原始边列表

    Returns:
        (modules_dict, module_edges)
        - modules_dict: {module_id: {name, services, controllers, repositories, databases}}
        - module_edges: [{from, to, type, service_pairs, call_count}]
    """
    # 1. 构建 Class ID → Module 映射
    class_to_module: dict[str, str] = {}
    modules: dict[str, dict[str, Any]] = {}

    # 需要关注的节点类型
    TARGET_NODE_TYPES = {"Service", "Component", "Class"}
    # Controller 识别：Component 类型 + @RestController/@Controller 注解
    # Repository 识别：命名约定

    for node in nodes:
        node_type = node.get("type", "")
        node_id = node.get("id", "")
        node_name = node.get("name", "")

        if node_type not in TARGET_NODE_TYPES and node_type != "Database":
            continue

        module_name = _extract_module_from_id(node_id)
        if not module_name:
            continue

        module_id = f"module:{module_name}"

        # 初始化模块
        if module_id not in modules:
            modules[module_id] = {
                "id": module_id,
                "name": module_name,
                "services": [],
                "controllers": [],
                "repositories": [],
                "databases": [],
            }

        # 分类节点
        if node_type == "Service":
            modules[module_id]["services"].append({
                "id": node_id,
                "name": node_name,
            })
            class_to_module[node_id] = module_id

        elif node_type == "Component":
            # 检查是否是 Controller
            annotations = node.get("properties", {}).get("annotations", [])
            if "@RestController" in annotations or "@Controller" in annotations:
                modules[module_id]["controllers"].append({
                    "id": node_id,
                    "name": node_name,
                })
                class_to_module[node_id] = module_id

        elif node_type == "Class":
            # 检查是否是 Repository/Mapper
            if any(p in node_name for p in ["Repository", "Mapper", "Dao", "DAO"]):
                modules[module_id]["repositories"].append({
                    "id": node_id,
                    "name": node_name,
                })
                class_to_module[node_id] = module_id

        elif node_type == "Database":
            modules[module_id]["databases"].append({
                "id": node_id,
                "name": node.get("name", "Database"),
            })

    # 2. 聚合 calls 边为 module flow_to 边
    # key: (from_module, to_module), value: {service_pairs: [], call_count: 0}
    module_edge_map: dict[tuple[str, str], dict[str, Any]] = {}

    for edge in edges:
        if edge.get("type") != "calls":
            continue

        from_id = edge.get("from", "")
        to_id = edge.get("to", "")

        # 从 Function ID 提取 Class ID
        from_class = None
        to_class = None

        if from_id.startswith("function:"):
            parts = from_id.rsplit(".", 1)
            if len(parts) == 2:
                from_class = f"class:{parts[0][9:]}"  # 移除 "function:" 前缀
        elif from_id.startswith("class:"):
            from_class = from_id

        if to_id.startswith("function:"):
            parts = to_id.rsplit(".", 1)
            if len(parts) == 2:
                to_class = f"class:{parts[0][9:]}"
        elif to_id.startswith("class:"):
            to_class = to_id

        if not from_class or not to_class:
            continue

        from_module = class_to_module.get(from_class)
        to_module = class_to_module.get(to_class)

        # 只处理跨模块调用
        if not from_module or not to_module or from_module == to_module:
            continue

        key = (from_module, to_module)
        if key not in module_edge_map:
            module_edge_map[key] = {
                "from": from_module,
                "to": to_module,
                "type": "flow_to",
                "service_pairs": [],
                "call_count": 0,
            }

        # 提取类名用于展示
        from_name = from_class.split(":")[-1].split("/")[-1]
        to_name = to_class.split(":")[-1].split("/")[-1]

        pair = [from_name, to_name]
        if pair not in module_edge_map[key]["service_pairs"]:
            module_edge_map[key]["service_pairs"].append(pair)
        module_edge_map[key]["call_count"] += 1

    # 3. 聚合 reads/writes 边为 module → database 边
    # 先构建 Database ID -> Node 映射
    db_node_map = {n.get("id"): n for n in nodes if n.get("type") == "Database"}

    for edge in edges:
        if edge.get("type") not in ("reads", "writes"):
            continue

        from_id = edge.get("from", "")
        to_id = edge.get("to", "")

        # from_id 是 Class，to_id 是 Database
        from_module = class_to_module.get(from_id)
        if not from_module:
            continue

        # 添加 Database 到模块的 databases 列表
        if from_module in modules:
            db_ids = {db["id"] for db in modules[from_module]["databases"]}
            if to_id not in db_ids:
                # 从原始节点中查找 Database 名称
                db_node = db_node_map.get(to_id)
                db_name = db_node.get("name", to_id.split(":")[-1]) if db_node else to_id.split(":")[-1]
                modules[from_module]["databases"].append({
                    "id": to_id,
                    "name": db_name,
                })

        # 创建 module → database 边
        module_edge_key = (from_module, to_id, edge["type"])
        if module_edge_key not in module_edge_map:
            module_edge_map[(from_module, to_id, edge["type"])] = {
                "from": from_module,
                "to": to_id,
                "type": edge["type"],
                "call_count": 1,
            }

    module_edges = list(module_edge_map.values())

    return modules, module_edges


@router.get("/graph/lineage/modules", tags=["图谱视图"])
def get_lineage_modules(
    repo_id: str = Query(description="仓库 ID"),
) -> dict[str, Any]:
    """
    模块级血缘视图。

    将 Class 级血缘数据聚合为 Module 级视图，展示：
    - 各模块的 Service/Controller/Repository 数量
    - 模块间的数据流向（flow_to 边）
    - 模块访问的数据库（reads/writes 边）

    Returns:
        {
            "repo_id": "xxx",
            "modules": [
                {
                    "id": "module:adms-api",
                    "name": "adms-api",
                    "service_count": 142,
                    "services": [{"id": "...", "name": "..."}, ...],
                    "controllers": [...],
                    "repositories": [...],
                    "databases": [...],
                    "cross_module_calls": 15
                }
            ],
            "edges": [
                {
                    "from": "module:adms-api",
                    "to": "module:adms-repository",
                    "type": "flow_to",
                    "service_pairs": [["UserService", "UserRepository"]],
                    "call_count": 12
                }
            ]
        }
    """
    graph = _storage_load_or_404(repo_id)
    all_nodes = graph.get("nodes", [])
    all_edges = graph.get("edges", [])

    # 聚合为模块级
    modules, module_edges = _aggregate_class_to_module_edges(all_nodes, all_edges)

    # 计算每个模块的跨模块调用数
    for module_id, module_data in modules.items():
        cross_calls = sum(
            e["call_count"] for e in module_edges
            if e["from"] == module_id and e["type"] == "flow_to"
        )
        module_data["cross_module_calls"] = cross_calls
        module_data["service_count"] = len(module_data["services"])
        module_data["controller_count"] = len(module_data["controllers"])
        module_data["repository_count"] = len(module_data["repositories"])

    # 按 Service 数量排序
    sorted_modules = sorted(
        modules.values(),
        key=lambda m: m["service_count"],
        reverse=True,
    )

    return {
        "repo_id": repo_id,
        "module_count": len(sorted_modules),
        "edge_count": len(module_edges),
        "modules": sorted_modules,
        "edges": module_edges,
    }


_DEFAULT_EXPAND_EDGE_TYPES = ",".join(sorted(STRUCTURAL_EDGE_TYPES))

@router.get("/graph/expand", tags=["图谱视图"])
def get_expand(
    repo_id:    str = Query(description="仓库 ID"),
    node_id:    str = Query(description="要展开的节点 ID"),
    depth:      int = Query(default=1, ge=1, le=3, description="BFS 深度，最大 3"),
    edge_types: str = Query(
        default=_DEFAULT_EXPAND_EDGE_TYPES,
        description="逗号分隔的边类型，框架图不传 calls",
    ),
) -> dict[str, Any]:
    """
    节点展开：返回指定节点的邻居和子节点（结构性边）。

    - 单次最多返回 50 个节点；超出时优先保留架构层节点，has_more=true 表示截断。
    - 响应中不包含 root 节点本身（调用方已有）。
    """
    graph = _storage_load_or_404(repo_id)
    all_nodes: list[dict] = graph.get("nodes", [])
    all_edges: list[dict] = graph.get("edges", [])

    # 节点 ID 不存在时返回 404
    node_ids = {n["id"] for n in all_nodes if n.get("id")}
    if node_id not in node_ids:
        raise HTTPException(status_code=404, detail=f"节点不存在: {node_id}")

    target_edge_types = frozenset(t.strip() for t in edge_types.split(",") if t.strip())
    result = _bfs_subgraph(all_nodes, all_edges, node_id, target_edge_types, depth)

    expanded_nodes: list[dict] = result.get("nodes", [])
    expanded_edges: list[dict] = result.get("edges", [])

    # 移除 root 节点本身
    expanded_nodes = [n for n in expanded_nodes if n.get("id") != node_id]

    # 单次上限 50 个节点；优先保留架构层节点
    NODE_LIMIT = 50
    has_more = False
    if len(expanded_nodes) > NODE_LIMIT:
        has_more = True
        arch_nodes  = [n for n in expanded_nodes if n.get("type") in ARCHITECTURE_NODE_TYPES]
        other_nodes = [n for n in expanded_nodes if n.get("type") not in ARCHITECTURE_NODE_TYPES]
        expanded_nodes = (arch_nodes + other_nodes)[:NODE_LIMIT]
        kept_ids = {n["id"] for n in expanded_nodes} | {node_id}
        expanded_edges = [
            e for e in expanded_edges
            if e.get("from") in kept_ids and e.get("to") in kept_ids
        ]

    return {
        "node_id":    node_id,
        "nodes":      expanded_nodes,
        "edges":      expanded_edges,
        "node_count": len(expanded_nodes),
        "edge_count": len(expanded_edges),
        "has_more":   has_more,
    }


# ── Legacy Endpoints (GraphRepository / graph_id) — preserved ────────────────


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


@router.get("/meta/node-types", tags=["元数据"])
def get_node_types() -> dict[str, Any]:
    """返回节点类型和边类型的元数据，供前端动态获取替代硬编码。"""
    return {
        "architecture_types":    sorted(ARCHITECTURE_NODE_TYPES),
        "structural_edge_types": sorted(STRUCTURAL_EDGE_TYPES),
        "call_edge_types":       ["calls"],
        "lineage_edge_types":    sorted(LINEAGE_EDGE_TYPES),
        "version":               "2",
    }


# ─────────────────────────────────────────────────────────────────────────────
# 数据血缘分析 API（P1）
# ─────────────────────────────────────────────────────────────────────────────


class ImpactAnalysisRequest(BaseModel):
    """变更影响评估请求。"""

    repo_id: str = Field(description="仓库 ID")
    node_id: str = Field(description="变更的节点 ID")
    change_type: str = Field(
        default="modify",
        description="变更类型: modify(修改) | delete(删除) | rename(重命名)",
    )


class TraceLineageRequest(BaseModel):
    """根因追溯请求。"""

    repo_id: str = Field(description="仓库 ID")
    node_id: str = Field(description="问题节点 ID")
    trace_type: str = Field(
        default="source",
        description="追溯类型: source(仅数据源) | transformation(转换链) | full(完整链路)",
    )


def _calculate_risk_level(
    affected_count: int,
    has_api_impact: bool,
    has_database_impact: bool,
) -> str:
    """计算风险等级。"""
    score = 0

    # 节点数量影响
    if affected_count > 20:
        score += 3
    elif affected_count > 10:
        score += 2
    elif affected_count > 5:
        score += 1

    # API 影响加成
    if has_api_impact:
        score += 2

    # 数据库影响加成
    if has_database_impact:
        score += 2

    if score >= 6:
        return "high"
    elif score >= 3:
        return "medium"
    else:
        return "low"


@router.post("/lineage/impact", tags=["数据血缘"])
def analyze_impact(request: ImpactAnalysisRequest) -> dict[str, Any]:
    """
    变更影响评估。

    分析修改/删除指定节点后的下游影响范围，返回：
    - affected_nodes: 受影响的下游节点列表
    - affected_apis: 受影响的 API 端点
    - affected_databases: 涉及的数据库
    - risk_level: 风险等级（low/medium/high）
    - impact_summary: 影响统计摘要

    Example:
        POST /lineage/impact
        {
            "repo_id": "my-service",
            "node_id": "service:UserService",
            "change_type": "modify"
        }
    """
    # 验证 change_type
    if request.change_type not in ("modify", "delete", "rename"):
        raise HTTPException(
            status_code=400,
            detail=f"无效的 change_type: {request.change_type}，可选值: modify, delete, rename",
        )

    # 加载图谱
    graph = _storage_load_or_404(request.repo_id)
    all_nodes = graph.get("nodes", [])
    all_edges = graph.get("edges", [])

    # 检查是否需要动态推断血缘
    has_lineage_edges = any(
        e.get("type") in _LINEAGE_EDGE_TYPES for e in all_edges
    )
    if not has_lineage_edges:
        inferred_result = _infer_lineage_from_graph(all_nodes, all_edges)
        if inferred_result["edges"]:
            all_edges = list(all_edges) + inferred_result["edges"]
            inferred_node_ids = {n["id"] for n in all_nodes}
            additional_nodes = [n for n in inferred_result["nodes"] if n["id"] not in inferred_node_ids]
            all_nodes = list(all_nodes) + additional_nodes

    # 查找下游影响（沿 from → to 方向）
    try:
        result = _bfs_lineage_subgraph(
            all_nodes,
            all_edges,
            request.node_id,
            _LINEAGE_EDGE_TYPES,
            depth=5,  # 最大深度
            direction="downstream",
        )
    except HTTPException as e:
        if "node not found" in str(e.detail):
            raise HTTPException(
                status_code=404,
                detail=f"节点不存在: {request.node_id}",
            )
        raise

    affected_nodes = result["nodes"]
    affected_edges = result["edges"]

    # 分类统计
    affected_apis = [
        n for n in affected_nodes
        if n.get("type") == "APIEndpoint"
    ]
    affected_databases = [
        n for n in affected_nodes
        if n.get("type") in ("Database", "DataSource")
    ]
    affected_services = [
        n for n in affected_nodes
        if n.get("type") == "Service"
    ]
    affected_topics = [
        n for n in affected_nodes
        if n.get("type") == "Topic"
    ]

    # 计算风险等级
    risk_level = _calculate_risk_level(
        affected_count=len(affected_nodes),
        has_api_impact=len(affected_apis) > 0,
        has_database_impact=len(affected_databases) > 0,
    )

    # 构建影响摘要
    impact_summary = {
        "total_affected": len(affected_nodes),
        "services": len(affected_services),
        "api_endpoints": len(affected_apis),
        "databases": len(affected_databases),
        "topics": len(affected_topics),
        "change_type": request.change_type,
    }

    # 删除操作风险升级
    if request.change_type == "delete":
        if risk_level == "low":
            risk_level = "medium"
        elif risk_level == "medium":
            risk_level = "high"

    return {
        "repo_id": request.repo_id,
        "changed_node_id": request.node_id,
        "change_type": request.change_type,
        "risk_level": risk_level,
        "impact_summary": impact_summary,
        "affected_nodes": affected_nodes,
        "affected_edges": affected_edges,
        "affected_apis": [
            {"id": n["id"], "name": n.get("name", ""), "path": n.get("properties", {}).get("path", "")}
            for n in affected_apis
        ],
        "affected_databases": [
            {"id": n["id"], "name": n.get("name", "")}
            for n in affected_databases
        ],
        "recommendations": _generate_recommendations(
            request.change_type,
            risk_level,
            impact_summary,
        ),
    }


def _generate_recommendations(
    change_type: str,
    risk_level: str,
    summary: dict,
) -> list[str]:
    """生成变更建议。"""
    recommendations = []

    if risk_level == "high":
        recommendations.append("⚠️ 高风险变更，建议先在测试环境验证")

    if summary["api_endpoints"] > 0:
        recommendations.append(
            f"影响 {summary['api_endpoints']} 个 API 端点，建议通知相关前端/调用方"
        )

    if summary["databases"] > 0:
        recommendations.append(
            f"涉及 {summary['databases']} 个数据库，建议检查数据迁移脚本"
        )

    if change_type == "delete":
        recommendations.append("删除操作不可逆，建议确认无依赖后再执行")

    if change_type == "rename":
        recommendations.append("重命名后需更新所有引用，建议使用 IDE 重构功能")

    if not recommendations:
        recommendations.append("✅ 低风险变更，可按计划执行")

    return recommendations


@router.post("/lineage/trace", tags=["数据血缘"])
def trace_lineage(request: TraceLineageRequest) -> dict[str, Any]:
    """
    根因追溯。

    追溯数据问题的源头，返回：
    - source_nodes: 数据源头节点列表
    - transformation_chain: 数据转换链路
    - confidence: 追溯置信度

    Example:
        POST /lineage/trace
        {
            "repo_id": "my-service",
            "node_id": "service:ReportService",
            "trace_type": "full"
        }
    """
    # 验证 trace_type
    if request.trace_type not in ("source", "transformation", "full"):
        raise HTTPException(
            status_code=400,
            detail=f"无效的 trace_type: {request.trace_type}，可选值: source, transformation, full",
        )

    # 加载图谱
    graph = _storage_load_or_404(request.repo_id)
    all_nodes = graph.get("nodes", [])
    all_edges = graph.get("edges", [])

    # 检查是否需要动态推断血缘
    has_lineage_edges = any(
        e.get("type") in _LINEAGE_EDGE_TYPES for e in all_edges
    )
    if not has_lineage_edges:
        inferred_result = _infer_lineage_from_graph(all_nodes, all_edges)
        if inferred_result["edges"]:
            all_edges = list(all_edges) + inferred_result["edges"]
            inferred_node_ids = {n["id"] for n in all_nodes}
            additional_nodes = [n for n in inferred_result["nodes"] if n["id"] not in inferred_node_ids]
            all_nodes = list(all_nodes) + additional_nodes

    # 查找上游来源（沿 to → from 方向，反向追溯）
    try:
        result = _bfs_lineage_subgraph(
            all_nodes,
            all_edges,
            request.node_id,
            _LINEAGE_EDGE_TYPES,
            depth=5,  # 最大深度
            direction="upstream",
        )
    except HTTPException as e:
        if "node not found" in str(e.detail):
            raise HTTPException(
                status_code=404,
                detail=f"节点不存在: {request.node_id}",
            )
        raise

    upstream_nodes = result["nodes"]
    upstream_edges = result["edges"]

    # 识别数据源头
    source_nodes = [
        n for n in upstream_nodes
        if n.get("type") in ("Database", "DataSource", "ExternalAPI", "MessageQueue")
    ]

    # 构建转换链路
    transformation_chain = _build_transformation_chain(
        request.node_id,
        upstream_nodes,
        upstream_edges,
    )

    # 计算置信度
    confidence = _calculate_trace_confidence(upstream_nodes, upstream_edges)

    # 根据 trace_type 过滤返回内容
    if request.trace_type == "source":
        # 仅返回数据源
        return {
            "repo_id": request.repo_id,
            "target_node_id": request.node_id,
            "trace_type": request.trace_type,
            "source_nodes": [
                {"id": n["id"], "name": n.get("name", ""), "type": n.get("type", "")}
                for n in source_nodes
            ],
            "confidence": confidence,
        }

    elif request.trace_type == "transformation":
        # 仅返回转换链
        return {
            "repo_id": request.repo_id,
            "target_node_id": request.node_id,
            "trace_type": request.trace_type,
            "transformation_chain": transformation_chain,
            "confidence": confidence,
        }

    else:
        # full: 返回完整链路
        return {
            "repo_id": request.repo_id,
            "target_node_id": request.node_id,
            "trace_type": request.trace_type,
            "source_nodes": [
                {"id": n["id"], "name": n.get("name", ""), "type": n.get("type", "")}
                for n in source_nodes
            ],
            "transformation_chain": transformation_chain,
            "upstream_nodes": upstream_nodes,
            "upstream_edges": upstream_edges,
            "confidence": confidence,
        }


def _build_transformation_chain(
    target_node_id: str,
    nodes: list[dict],
    edges: list[dict],
) -> list[dict]:
    """构建数据转换链路。

    从目标节点回溯到源头，按顺序列出中间转换节点。
    """
    node_map = {n["id"]: n for n in nodes}

    # 找到目标节点
    target_node = node_map.get(target_node_id)
    if not target_node:
        return []

    # BFS 回溯构建链路
    chain: list[dict] = []
    visited: set[str] = {target_node_id}
    queue: deque[tuple[str, int]] = deque([(target_node_id, 0)])

    # 构建反向边映射（to -> [from]）
    reverse_edges: dict[str, list[tuple[dict, str]]] = {}
    for edge in edges:
        edge_to = edge.get("to")
        edge_from = edge.get("from")
        if edge_to and edge_from:
            if edge_to not in reverse_edges:
                reverse_edges[edge_to] = []
            reverse_edges[edge_to].append((edge, edge_from))

    while queue:
        current_id, depth = queue.popleft()
        current_node = node_map.get(current_id)
        if not current_node:
            continue

        # 记录转换节点
        if current_node.get("type") in ("Service", "Repository", "Component"):
            chain.append({
                "id": current_id,
                "name": current_node.get("name", ""),
                "type": current_node.get("type", ""),
                "depth": depth,
            })

        # 继续回溯
        for edge, from_id in reverse_edges.get(current_id, []):
            if from_id not in visited:
                visited.add(from_id)
                queue.append((from_id, depth + 1))

    # 按深度排序（从源头到目标）
    chain.sort(key=lambda x: x["depth"], reverse=True)

    return chain


def _calculate_trace_confidence(
    nodes: list[dict],
    edges: list[dict],
) -> float:
    """计算追溯置信度。

    基于以下因素：
    - 边的平均置信度
    - 是否找到明确的数据源
    - 链路完整性
    """
    if not edges:
        return 0.5

    # 边置信度平均值
    edge_confidences = [
        e.get("properties", {}).get("confidence", 0.8)
        for e in edges
    ]
    avg_confidence = sum(edge_confidences) / len(edge_confidences) if edge_confidences else 0.8

    # 是否找到数据源
    has_source = any(
        n.get("type") in ("Database", "DataSource", "ExternalAPI", "MessageQueue")
        for n in nodes
    )
    if has_source:
        avg_confidence = min(1.0, avg_confidence + 0.1)

    # 链路完整性（节点数/边数比例）
    node_edge_ratio = len(nodes) / (len(edges) + 1)
    if node_edge_ratio > 1.5:
        avg_confidence = min(1.0, avg_confidence + 0.05)

    return round(avg_confidence, 2)


# ─────────────────────────────────────────────────────────────────────────────
# 分层架构图 API
# ─────────────────────────────────────────────────────────────────────────────


@router.get("/graph/architecture/{repo_id}", tags=["图谱视图"])
def get_architecture(repo_id: str) -> dict[str, Any]:
    """
    获取分层架构图数据。

    从 `data/graphs/{repo_id}-architecture.json` 或 `data/graphs/{repo_name}-architecture.json` 加载自定义分层架构数据。
    如果文件不存在，返回 404。

    返回格式：
    {
        "name": "ADMS",
        "fullName": "ActiveIO Data Management System",
        "layers": [
            {
                "id": "presentation",
                "name": "表现层",
                "nodes": [...]
            }
        ],
        "dataFlow": { ... },
        "moduleDependencies": { ... }
    }
    """
    # 尝试多种命名方式查找架构文件
    # 1. 直接用 repo_id
    # 2. 从 repo_id 中提取可能的名称（如 "repo-xxx-adms" -> "adms"）
    # 3. 从 repo_store 获取 repo_name 和 graph_id

    candidate_names = [repo_id]

    # 从 repo_id 中提取 name（格式：repo-timestamp-name）
    if repo_id.startswith("repo-"):
        parts = repo_id.split("-", 2)
        if len(parts) >= 3:
            candidate_names.append(parts[2])

    # 从 repo_store 获取 repo_name 和 graph_id
    try:
        from backend.store.repo_store import get_repo_store
        from backend.store.analysis_store import get_analysis_store

        repo_store = get_repo_store()
        repo_info = repo_store.get(repo_id)

        if repo_info:
            # 添加 repo_name
            if repo_info.get("name"):
                candidate_names.append(repo_info["name"])

            # 从 latest_analysis 获取 graph_id
            analysis_store = get_analysis_store()
            latest = analysis_store.get_latest(repo_id)
            if latest and latest.get("graph_id"):
                candidate_names.append(latest["graph_id"])
    except Exception:
        pass

    # 按优先级查找文件
    for name in candidate_names:
        arch_file = _ARCHITECTURE_STORAGE_DIR / f"{name}-architecture.json"
        if arch_file.exists():
            try:
                with open(arch_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                logger.info(f"加载架构图: {arch_file}")
                return data
            except json.JSONDecodeError as e:
                logger.exception("架构图 JSON 解析失败: %s", arch_file)
                raise HTTPException(
                    status_code=500,
                    detail=f"架构图 JSON 解析失败: {e}",
                )
            except Exception as e:
                logger.exception("读取架构图文件失败: %s", arch_file)
                raise HTTPException(
                    status_code=500,
                    detail=f"读取架构图文件失败: {e}",
                )

    # 所有候选文件都不存在
    raise HTTPException(
        status_code=404,
        detail=f"架构图文件不存在: {repo_id}-architecture.json",
    )

