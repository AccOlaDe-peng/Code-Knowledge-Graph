"""
图谱存储仓库模块。

提供对 CodeGraph 的持久化操作接口，支持双写策略：
1. Neo4j — 原生图数据库，支持 Cypher 查询
2. SQLite（通过 JSON 序列化）— 轻量级备选存储

同时提供图谱的 CRUD 操作和常见查询方法。
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Optional

from backend.graph.schema import (
    AnyNode,
    CodeGraph,
    EdgeBase,
    GraphQueryRequest,
    GraphQueryResponse,
    NodeType,
)

logger = logging.getLogger(__name__)


class GraphRepository:
    """
    图谱存储仓库。

    提供统一的图谱持久化和查询接口。
    自动检测 Neo4j 是否可用，不可用时降级到本地 JSON 存储。

    示例::

        repo = GraphRepository(neo4j_uri="bolt://localhost:7687")
        await repo.save(code_graph)
        graph = await repo.load(repo_id)
    """

    def __init__(
        self,
        neo4j_uri: Optional[str] = None,
        neo4j_user: str = "neo4j",
        neo4j_password: str = "password",
        storage_dir: str = "./data/graphs",
    ) -> None:
        """
        初始化图谱仓库。

        Args:
            neo4j_uri: Neo4j Bolt URI，None 则仅使用本地存储
            neo4j_user: Neo4j 用户名
            neo4j_password: Neo4j 密码
            storage_dir: 本地 JSON 存储目录
        """
        self.neo4j_uri = neo4j_uri
        self.neo4j_user = neo4j_user
        self.neo4j_password = neo4j_password
        self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)

        self._driver = None
        if neo4j_uri:
            self._init_neo4j()

    def _init_neo4j(self) -> None:
        """初始化 Neo4j 驱动连接。"""
        try:
            from neo4j import GraphDatabase

            self._driver = GraphDatabase.driver(
                self.neo4j_uri,
                auth=(self.neo4j_user, self.neo4j_password),
            )
            # 验证连接
            with self._driver.session() as session:
                session.run("RETURN 1")
            logger.info(f"Neo4j 连接成功: {self.neo4j_uri}")
        except ImportError:
            logger.warning("neo4j 包未安装，跳过 Neo4j 初始化")
            self._driver = None
        except Exception as e:
            logger.warning(f"Neo4j 连接失败，降级到本地存储: {e}")
            self._driver = None

    # ------------------------------------------------------------------
    # 保存
    # ------------------------------------------------------------------

    def save(self, graph: CodeGraph) -> str:
        """
        保存图谱到存储后端。

        Args:
            graph: CodeGraph 对象

        Returns:
            图谱 ID
        """
        # 始终写入本地 JSON（作为备份和快速加载）
        self._save_local(graph)

        # 如果 Neo4j 可用，同步写入
        if self._driver:
            try:
                self._save_neo4j(graph)
            except Exception as e:
                logger.error(f"Neo4j 写入失败（已保存到本地）: {e}")

        logger.info(f"图谱已保存: {graph.id} ({graph.stats.node_count} 节点)")
        return graph.id

    def _save_local(self, graph: CodeGraph) -> None:
        """将图谱序列化为 JSON 文件存储。"""
        file_path = self.storage_dir / f"{graph.id}.json"
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(graph.model_dump(mode="json"), f, ensure_ascii=False, indent=2)
        # 同时更新索引文件
        self._update_index(graph)

    def _update_index(self, graph: CodeGraph) -> None:
        """更新图谱索引文件（用于快速列表查询）。"""
        index_file = self.storage_dir / "index.json"
        index: dict[str, Any] = {}
        if index_file.exists():
            try:
                index = json.loads(index_file.read_text(encoding="utf-8"))
            except Exception:
                pass

        index[graph.id] = {
            "id": graph.id,
            "repo_name": graph.repository.name,
            "repo_path": graph.repository.file_path,
            "node_count": graph.stats.node_count,
            "edge_count": graph.stats.edge_count,
            "created_at": graph.stats.created_at.isoformat(),
            "primary_language": graph.repository.language,
        }
        index_file.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")

    def _save_neo4j(self, graph: CodeGraph) -> None:
        """将图谱写入 Neo4j。"""
        with self._driver.session() as session:
            # 清空旧数据
            session.run(
                "MATCH (n {graph_id: $gid}) DETACH DELETE n",
                gid=graph.id,
            )
            # 批量创建节点
            for node in graph.nodes:
                props = {
                    "graph_id": graph.id,
                    "node_id": node.id,
                    "name": node.name,
                    "file_path": node.file_path or "",
                    "line_start": node.line_start or 0,
                }
                props.update({k: str(v) for k, v in node.metadata.items() if isinstance(v, (str, int, float, bool))})
                session.run(
                    f"CREATE (n:{node.type} $props)",
                    props=props,
                )
            # 批量创建边
            for edge in graph.edges:
                session.run(
                    f"""
                    MATCH (a {{node_id: $src, graph_id: $gid}})
                    MATCH (b {{node_id: $tgt, graph_id: $gid}})
                    CREATE (a)-[r:{edge.type} {{weight: $w}}]->(b)
                    """,
                    src=edge.source_id,
                    tgt=edge.target_id,
                    gid=graph.id,
                    w=edge.weight,
                )

    # ------------------------------------------------------------------
    # 加载
    # ------------------------------------------------------------------

    def load(self, graph_id: str) -> Optional[CodeGraph]:
        """
        按 ID 加载图谱。

        Args:
            graph_id: 图谱唯一标识符

        Returns:
            CodeGraph 对象，不存在时返回 None
        """
        file_path = self.storage_dir / f"{graph_id}.json"
        if not file_path.exists():
            logger.warning(f"图谱文件不存在: {graph_id}")
            return None

        try:
            data = json.loads(file_path.read_text(encoding="utf-8"))
            return CodeGraph.model_validate(data)
        except Exception as e:
            logger.error(f"加载图谱失败 {graph_id}: {e}")
            return None

    def list_graphs(self) -> list[dict[str, Any]]:
        """
        列出所有已存储的图谱摘要信息。

        Returns:
            图谱摘要字典列表
        """
        index_file = self.storage_dir / "index.json"
        if not index_file.exists():
            return []
        try:
            index = json.loads(index_file.read_text(encoding="utf-8"))
            return list(index.values())
        except Exception:
            return []

    def delete(self, graph_id: str) -> bool:
        """
        删除图谱。

        Args:
            graph_id: 图谱 ID

        Returns:
            删除成功返回 True
        """
        file_path = self.storage_dir / f"{graph_id}.json"
        deleted = False
        if file_path.exists():
            file_path.unlink()
            deleted = True

        # 更新索引
        index_file = self.storage_dir / "index.json"
        if index_file.exists():
            try:
                index = json.loads(index_file.read_text(encoding="utf-8"))
                index.pop(graph_id, None)
                index_file.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
            except Exception:
                pass

        if self._driver:
            try:
                with self._driver.session() as session:
                    session.run("MATCH (n {graph_id: $gid}) DETACH DELETE n", gid=graph_id)
            except Exception as e:
                logger.warning(f"Neo4j 删除失败: {e}")

        logger.info(f"图谱已删除: {graph_id}")
        return deleted

    # ------------------------------------------------------------------
    # 查询
    # ------------------------------------------------------------------

    def query_nodes_by_type(
        self, graph_id: str, node_type: NodeType, limit: int = 50
    ) -> list[dict[str, Any]]:
        """
        按节点类型查询。

        Args:
            graph_id: 图谱 ID
            node_type: 节点类型枚举值
            limit: 最大返回数量

        Returns:
            节点字典列表
        """
        graph = self.load(graph_id)
        if not graph:
            return []
        results = [
            n.model_dump(mode="json")
            for n in graph.nodes
            if str(n.type) == str(node_type)
        ]
        return results[:limit]

    def query_neighbors(
        self,
        graph_id: str,
        node_id: str,
        depth: int = 1,
        edge_types: Optional[list[str]] = None,
    ) -> dict[str, Any]:
        """
        查询节点的邻居子图。

        Args:
            graph_id: 图谱 ID
            node_id: 起始节点 ID
            depth: 遍历深度
            edge_types: 只遍历指定类型的边，None 表示全部

        Returns:
            包含 nodes 和 edges 的子图字典
        """
        graph = self.load(graph_id)
        if not graph:
            return {"nodes": [], "edges": []}

        import networkx as nx

        G = nx.DiGraph()
        for n in graph.nodes:
            G.add_node(n.id, **{"name": n.name, "type": str(n.type)})
        for e in graph.edges:
            if edge_types is None or str(e.type) in edge_types:
                G.add_edge(e.source_id, e.target_id, edge_type=str(e.type))

        # BFS 扩展到 depth 深度
        visited: set[str] = {node_id}
        frontier = {node_id}
        for _ in range(depth):
            new_frontier: set[str] = set()
            for nid in frontier:
                new_frontier.update(G.successors(nid))
                new_frontier.update(G.predecessors(nid))
            frontier = new_frontier - visited
            visited.update(frontier)

        node_map = {n.id: n for n in graph.nodes}
        sub_nodes = [node_map[nid].model_dump(mode="json") for nid in visited if nid in node_map]
        sub_edges = [
            e.model_dump(mode="json")
            for e in graph.edges
            if e.source_id in visited and e.target_id in visited
        ]

        return {"nodes": sub_nodes, "edges": sub_edges}

    def cypher_query(self, query: str, params: Optional[dict] = None) -> list[dict[str, Any]]:
        """
        执行 Neo4j Cypher 查询。

        Args:
            query: Cypher 查询语句
            params: 查询参数

        Returns:
            查询结果列表，Neo4j 不可用时返回空列表
        """
        if not self._driver:
            logger.warning("Neo4j 不可用，无法执行 Cypher 查询")
            return []
        try:
            with self._driver.session() as session:
                result = session.run(query, **(params or {}))
                return [dict(record) for record in result]
        except Exception as e:
            logger.error(f"Cypher 查询失败: {e}")
            return []

    def close(self) -> None:
        """关闭数据库连接。"""
        if self._driver:
            self._driver.close()
            self._driver = None


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    repo = GraphRepository()
    graphs = repo.list_graphs()
    print(f"已存储 {len(graphs)} 个图谱:")
    for g in graphs:
        print(f"  - {g['repo_name']}: {g['node_count']} 节点, {g['edge_count']} 边")
