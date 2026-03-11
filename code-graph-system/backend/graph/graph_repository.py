"""
图谱存储仓库模块。

提供对 BuiltGraph / graph.json 的持久化与查询接口，支持两种后端：
    - 本地 JSON（默认，零依赖）
    - Neo4j（可选，配置 NEO4J_URI 环境变量后自动启用）

主要操作：
    save(built, repo_name)  —— 持久化 BuiltGraph → {repo_name}.json
    load(graph_id)          —— 读取并反序列化为 BuiltGraph
    list_graphs()           —— 列出所有已存储图谱摘要
    delete(graph_id)        —— 删除指定图谱
    query_nodes(graph_id, type, name_contains, limit)
    query_neighbors(graph_id, node_id, depth, edge_types)
"""

from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from backend.graph.graph_builder import BuiltGraph
from backend.graph.graph_schema import GraphEdge, GraphNode

logger = logging.getLogger(__name__)

_DEFAULT_STORAGE_DIR = "./data/graphs"


# ---------------------------------------------------------------------------
# GraphRepository
# ---------------------------------------------------------------------------


class GraphRepository:
    """
    图谱持久化仓库。

    自动检测 Neo4j 是否可用；不可用时仅使用本地 JSON 存储。

    示例::

        repo = GraphRepository()
        repo.save(built_graph, repo_name="my-project")
        built = repo.load("my-project")
    """

    def __init__(
        self,
        storage_dir: str = _DEFAULT_STORAGE_DIR,
        neo4j_uri: Optional[str] = None,
        neo4j_user: str = "neo4j",
        neo4j_password: str = "password",
    ) -> None:
        self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)

        self._driver = None
        uri = neo4j_uri or os.getenv("NEO4J_URI")
        if uri:
            self._init_neo4j(uri, neo4j_user, neo4j_password)

    # ------------------------------------------------------------------
    # Save
    # ------------------------------------------------------------------

    def save(self, built: BuiltGraph, repo_name: str = "") -> str:
        """将 BuiltGraph 持久化到存储后端。

        Args:
            built:     GraphBuilder.build() 的输出。
            repo_name: 仓库名称，用作文件名和索引键。
                       空字符串时使用 ``graph_<timestamp>``。

        Returns:
            图谱 ID（即文件名 stem，不含扩展名）。
        """
        graph_id = _safe_filename(repo_name) if repo_name else _timestamp_id()
        self._save_json(built, graph_id, repo_name)

        if self._driver:
            try:
                self._save_neo4j(built, graph_id)
            except Exception:
                logger.error("Neo4j 写入失败（已保存到本地）", exc_info=True)

        logger.info("图谱已保存: %s (%d 节点, %d 边)", graph_id,
                    built.node_count, built.edge_count)
        return graph_id

    def _save_json(self, built: BuiltGraph, graph_id: str, repo_name: str) -> None:
        """序列化并写入 JSON 文件，同步更新索引。"""
        data = built.to_dict()
        data["meta"]["graph_id"]   = graph_id
        data["meta"]["repo_name"]  = repo_name

        file_path = self.storage_dir / f"{graph_id}.json"
        file_path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        self._update_index(graph_id, repo_name, built)

    def _update_index(self, graph_id: str, repo_name: str, built: BuiltGraph) -> None:
        index_path = self.storage_dir / "index.json"
        index: dict[str, Any] = {}
        if index_path.exists():
            try:
                index = json.loads(index_path.read_text(encoding="utf-8"))
            except Exception:
                pass
        index[graph_id] = {
            "graph_id":   graph_id,
            "repo_name":  repo_name,
            "node_count": built.node_count,
            "edge_count": built.edge_count,
            "node_types": built.meta.get("node_type_counts", {}),
            "created_at": built.meta.get("created_at", ""),
        }
        index_path.write_text(
            json.dumps(index, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    # ------------------------------------------------------------------
    # Load
    # ------------------------------------------------------------------

    def load(self, graph_id: str) -> Optional[BuiltGraph]:
        """从 JSON 文件加载 BuiltGraph。

        Args:
            graph_id: 图谱 ID（文件名 stem）。

        Returns:
            BuiltGraph，文件不存在或解析失败时返回 None。
        """
        path = self.storage_dir / f"{graph_id}.json"
        if not path.exists():
            logger.warning("图谱文件不存在: %s", graph_id)
            return None
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            return _dict_to_built(data)
        except Exception:
            logger.error("加载图谱失败: %s", graph_id, exc_info=True)
            return None

    # ------------------------------------------------------------------
    # List / Delete
    # ------------------------------------------------------------------

    def list_graphs(self) -> list[dict[str, Any]]:
        """列出所有已存储图谱的摘要信息。"""
        index_path = self.storage_dir / "index.json"
        if not index_path.exists():
            return []
        try:
            index = json.loads(index_path.read_text(encoding="utf-8"))
            return list(index.values())
        except Exception:
            return []

    def delete(self, graph_id: str) -> bool:
        """删除指定图谱（JSON 文件 + 索引条目）。

        Returns:
            True 表示文件已删除，False 表示文件不存在。
        """
        path = self.storage_dir / f"{graph_id}.json"
        deleted = False
        if path.exists():
            path.unlink()
            deleted = True

        index_path = self.storage_dir / "index.json"
        if index_path.exists():
            try:
                index = json.loads(index_path.read_text(encoding="utf-8"))
                index.pop(graph_id, None)
                index_path.write_text(
                    json.dumps(index, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
            except Exception:
                pass

        if self._driver:
            try:
                with self._driver.session() as session:
                    session.run(
                        "MATCH (n {graph_id: $gid}) DETACH DELETE n",
                        gid=graph_id,
                    )
            except Exception:
                logger.warning("Neo4j 删除失败: %s", graph_id, exc_info=True)

        logger.info("图谱已删除: %s", graph_id)
        return deleted

    # ------------------------------------------------------------------
    # Query
    # ------------------------------------------------------------------

    def query_nodes(
        self,
        graph_id: str,
        *,
        node_type: Optional[str] = None,
        name_contains: Optional[str] = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """按条件检索节点（从 JSON 文件加载后过滤）。

        Args:
            graph_id:      图谱 ID。
            node_type:     节点类型过滤（如 ``"Service"``），None 表示不过滤。
            name_contains: 节点名称子串过滤（大小写不敏感），None 表示不过滤。
            limit:         最多返回数量。

        Returns:
            节点字典列表（含 metrics 字段）。
        """
        built = self.load(graph_id)
        if built is None:
            return []

        results: list[dict[str, Any]] = []
        for node in built.nodes:
            if node_type and node.type != node_type:
                continue
            if name_contains and name_contains.lower() not in node.name.lower():
                continue
            nd = node.model_dump()
            m = built.metrics.get(node.id)
            if m:
                nd["metrics"] = m
            results.append(nd)
            if len(results) >= limit:
                break

        return results

    def query_neighbors(
        self,
        graph_id: str,
        node_id: str,
        *,
        depth: int = 1,
        edge_types: Optional[list[str]] = None,
    ) -> dict[str, Any]:
        """BFS 扩展指定节点的邻居子图。

        Args:
            graph_id:   图谱 ID。
            node_id:    起始节点 ID。
            depth:      BFS 深度（默认 1）。
            edge_types: 只遍历指定类型的边，None 表示全部。

        Returns:
            ``{"nodes": [...], "edges": [...]}`` 子图字典。
        """
        built = self.load(graph_id)
        if built is None:
            return {"nodes": [], "edges": []}

        # 构建邻接结构（adjacency sets）
        fwd: dict[str, set[str]] = {}   # node_id → 后继 node_id
        bwd: dict[str, set[str]] = {}   # node_id → 前驱 node_id
        for e in built.edges:
            if edge_types and e.type not in edge_types:
                continue
            fwd.setdefault(e.from_, set()).add(e.to)
            bwd.setdefault(e.to,    set()).add(e.from_)

        visited: set[str] = {node_id}
        frontier: set[str] = {node_id}
        for _ in range(depth):
            nxt: set[str] = set()
            for nid in frontier:
                nxt.update(fwd.get(nid, set()))
                nxt.update(bwd.get(nid, set()))
            frontier = nxt - visited
            visited.update(frontier)

        node_map = {n.id: n for n in built.nodes}
        sub_nodes = [
            node_map[nid].model_dump()
            for nid in visited
            if nid in node_map
        ]
        sub_edges = [
            e.model_dump(by_alias=True)
            for e in built.edges
            if e.from_ in visited and e.to in visited
        ]
        return {"nodes": sub_nodes, "edges": sub_edges}

    # ------------------------------------------------------------------
    # Neo4j — 公开接口
    # ------------------------------------------------------------------

    def connect(
        self,
        uri: str,
        user: str = "neo4j",
        password: str = "password",
    ) -> bool:
        """显式建立 Neo4j 连接，成功后自动创建约束/索引。

        Args:
            uri:      Neo4j Bolt URI，例如 ``"bolt://localhost:7687"``。
            user:     用户名（默认 ``"neo4j"``）。
            password: 密码。

        Returns:
            True 表示连接成功，False 表示连接失败或 neo4j 包未安装。
        """
        self._init_neo4j(uri, user, password)
        return self._driver is not None

    def save_nodes(self, graph_id: str, nodes: list[GraphNode]) -> int:
        """批量写入节点到 Neo4j（MERGE 语义，幂等）。

        使用 ``UNWIND`` + ``MERGE`` 减少网络往返次数。
        节点标签来自 ``node.type``；属性中仅保留标量类型（str/int/float/bool）。

        Args:
            graph_id: 图谱 ID，写入每个节点的 ``graph_id`` 属性。
            nodes:    要写入的 ``GraphNode`` 列表。

        Returns:
            实际写入（MERGE）的节点数量。

        Raises:
            RuntimeError: Neo4j 未连接时抛出。
        """
        if not self._driver:
            raise RuntimeError("Neo4j 未连接，请先调用 connect() 或配置 NEO4J_URI")
        if not nodes:
            return 0

        # 按 node.type 分组，每组用一条 UNWIND 语句写入（标签不能参数化）
        by_type: dict[str, list[dict[str, Any]]] = {}
        for node in nodes:
            props: dict[str, Any] = {
                "graph_id": graph_id,
                "node_id":  node.id,
                "name":     node.name,
            }
            # 只保留标量属性（Neo4j 不支持嵌套 dict/list 作为属性值）
            for k, v in node.properties.items():
                if isinstance(v, (str, int, float, bool)):
                    props[k] = v
            by_type.setdefault(node.type, []).append(props)

        total = 0
        with self._driver.session() as session:
            for node_type, batch in by_type.items():
                result = session.run(
                    f"""
                    UNWIND $batch AS props
                    MERGE (n:`{node_type}` {{node_id: props.node_id, graph_id: props.graph_id}})
                    SET n += props
                    RETURN count(n) AS cnt
                    """,
                    batch=batch,
                )
                record = result.single()
                total += record["cnt"] if record else 0

        logger.debug("Neo4j save_nodes: graph=%s, 写入 %d 节点", graph_id, total)
        return total

    def save_edges(self, graph_id: str, edges: list[GraphEdge]) -> int:
        """批量写入边到 Neo4j（MERGE 语义，幂等）。

        使用 ``UNWIND`` + ``MERGE`` 减少网络往返次数。
        边类型来自 ``edge.type``；属性中仅保留标量类型。

        Args:
            graph_id: 图谱 ID，用于定位源/目标节点。
            edges:    要写入的 ``GraphEdge`` 列表。

        Returns:
            实际写入（MERGE）的边数量。

        Raises:
            RuntimeError: Neo4j 未连接时抛出。
        """
        if not self._driver:
            raise RuntimeError("Neo4j 未连接，请先调用 connect() 或配置 NEO4J_URI")
        if not edges:
            return 0

        # 按 edge.type 分组
        by_type: dict[str, list[dict[str, Any]]] = {}
        for edge in edges:
            props: dict[str, Any] = {}
            for k, v in edge.properties.items():
                if isinstance(v, (str, int, float, bool)):
                    props[k] = v
            by_type.setdefault(edge.type, []).append({
                "src":   edge.from_,
                "tgt":   edge.to,
                "props": props,
            })

        total = 0
        with self._driver.session() as session:
            for edge_type, batch in by_type.items():
                result = session.run(
                    f"""
                    UNWIND $batch AS row
                    MATCH (a {{node_id: row.src, graph_id: $gid}})
                    MATCH (b {{node_id: row.tgt, graph_id: $gid}})
                    MERGE (a)-[r:`{edge_type}`]->(b)
                    SET r += row.props
                    RETURN count(r) AS cnt
                    """,
                    batch=batch,
                    gid=graph_id,
                )
                record = result.single()
                total += record["cnt"] if record else 0

        logger.debug("Neo4j save_edges: graph=%s, 写入 %d 边", graph_id, total)
        return total

    def query(
        self,
        cypher: str,
        params: Optional[dict[str, Any]] = None,
    ) -> list[dict[str, Any]]:
        """执行任意 Cypher 语句，返回结果记录列表。

        Args:
            cypher: Cypher 查询字符串，例如::

                "MATCH (n {graph_id: $gid}) RETURN n.name AS name, labels(n) AS types"

            params: 查询参数字典，例如 ``{"gid": "my-project"}``。

        Returns:
            每条记录转换为普通 Python 字典的列表；查询无结果时返回空列表。

        Raises:
            RuntimeError: Neo4j 未连接时抛出。

        示例::

            rows = repo.query(
                "MATCH (n {graph_id: $gid}) RETURN n.name AS name LIMIT 10",
                {"gid": "my-project"},
            )
            for row in rows:
                print(row["name"])
        """
        if not self._driver:
            raise RuntimeError("Neo4j 未连接，请先调用 connect() 或配置 NEO4J_URI")

        with self._driver.session() as session:
            result = session.run(cypher, **(params or {}))
            return [dict(record) for record in result]

    # ------------------------------------------------------------------
    # Neo4j — 内部实现
    # ------------------------------------------------------------------

    def _init_neo4j(self, uri: str, user: str, password: str) -> None:
        """建立 Neo4j 连接并初始化约束/索引（内部）。"""
        try:
            from neo4j import GraphDatabase

            self._driver = GraphDatabase.driver(uri, auth=(user, password))
            with self._driver.session() as session:
                session.run("RETURN 1")
            logger.info("Neo4j 连接成功: %s", uri)
            self._ensure_constraints()
        except ImportError:
            logger.warning("neo4j 包未安装，使用本地 JSON 存储")
        except Exception:
            logger.warning("Neo4j 连接失败，降级到本地 JSON 存储", exc_info=True)
            self._driver = None

    def _ensure_constraints(self) -> None:
        """创建节点唯一性约束和属性索引（幂等，IF NOT EXISTS）。"""
        ddl_statements = [
            # 通用节点查找索引（graph_id + node_id 组合唯一）
            "CREATE INDEX node_lookup IF NOT EXISTS "
            "FOR (n:__KGNode__) ON (n.graph_id, n.node_id)",
        ]
        with self._driver.session() as session:
            for ddl in ddl_statements:
                try:
                    session.run(ddl)
                except Exception:
                    # 旧版 Neo4j 不支持 IF NOT EXISTS 语法，忽略错误
                    logger.debug("约束创建跳过（可能已存在或版本不支持）", exc_info=True)

    def _save_neo4j(self, built: BuiltGraph, graph_id: str) -> None:
        """将 BuiltGraph 写入 Neo4j（清空旧数据后重建，供 save() 内部调用）。"""
        with self._driver.session() as session:
            session.run(
                "MATCH (n {graph_id: $gid}) DETACH DELETE n",
                gid=graph_id,
            )
        self.save_nodes(graph_id, built.nodes)
        self.save_edges(graph_id, built.edges)

    def close(self) -> None:
        """关闭 Neo4j 连接。"""
        if self._driver:
            self._driver.close()
            self._driver = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _dict_to_built(data: dict[str, Any]) -> BuiltGraph:
    """将 JSON 反序列化为 BuiltGraph。"""
    meta    = data.get("meta", {})
    metrics: dict[str, dict[str, float]] = {}

    nodes: list[GraphNode] = []
    for nd in data.get("nodes", []):
        m = nd.pop("metrics", None)
        node = GraphNode.model_validate(nd)
        nodes.append(node)
        if m:
            metrics[node.id] = m

    edges: list[GraphEdge] = []
    for ed in data.get("edges", []):
        edges.append(GraphEdge.model_validate(ed))

    return BuiltGraph(nodes=nodes, edges=edges, meta=meta, metrics=metrics)


def _safe_filename(name: str) -> str:
    """将仓库名转为合法文件名（保留字母数字和 - _）。"""
    s = re.sub(r"[^\w\-]", "_", name.strip())
    return s[:80] or "graph"


def _timestamp_id() -> str:
    return "graph_" + datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
