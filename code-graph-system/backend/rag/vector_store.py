"""
向量存储模块。

基于 ChromaDB 实现代码节点的向量化存储和相似度检索，
支持混合检索（向量相似度 + 元数据过滤）。
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)


class VectorStore:
    """
    向量存储管理器。

    封装 ChromaDB 操作，为代码节点提供高效的语义检索能力。

    示例::

        store = VectorStore()
        store.add_nodes(graph.nodes)
        results = store.search("用户认证相关的函数", limit=5)
    """

    def __init__(self, persist_dir: str = "./data/chroma") -> None:
        """
        初始化向量存储。

        Args:
            persist_dir: ChromaDB 持久化目录
        """
        self.persist_dir = Path(persist_dir)
        self.persist_dir.mkdir(parents=True, exist_ok=True)
        self._client = None
        self._collection = None

    def _get_client(self) -> object:
        """懒加载 ChromaDB 客户端。"""
        if self._client is not None:
            return self._client
        try:
            import chromadb

            self._client = chromadb.PersistentClient(path=str(self.persist_dir))
            logger.info(f"ChromaDB 初始化成功: {self.persist_dir}")
            return self._client
        except ImportError:
            raise RuntimeError("chromadb 包未安装，请运行: pip install chromadb")

    def get_collection(self, name: str = "code_nodes") -> object:
        """
        获取或创建集合。

        Args:
            name: 集合名称

        Returns:
            ChromaDB Collection 对象
        """
        client = self._get_client()
        try:
            collection = client.get_or_create_collection(
                name=name,
                metadata={"description": "代码知识图谱节点向量存储"},
            )
            self._collection = collection
            return collection
        except Exception as e:
            logger.error(f"获取集合失败: {e}")
            raise

    def add_nodes(
        self,
        nodes: list[Any],
        collection_name: str = "code_nodes",
    ) -> int:
        """
        批量添加节点到向量存储。

        Args:
            nodes: 图节点列表（需包含 embedding 字段）
            collection_name: 目标集合名称

        Returns:
            成功添加的节点数量
        """
        collection = self.get_collection(collection_name)
        ids: list[str] = []
        embeddings: list[list[float]] = []
        metadatas: list[dict] = []
        documents: list[str] = []

        for node in nodes:
            if not node.embedding:
                continue  # 跳过无嵌入的节点
            ids.append(node.id)
            embeddings.append(node.embedding)
            # 构建文档文本（用于全文检索）
            doc_text = f"{node.name} {node.metadata.get('semantic_summary', '')} {node.metadata.get('docstring', '')}"
            documents.append(doc_text[:1000])
            # 元数据（用于过滤）
            meta = {
                "node_type": str(node.type),
                "name": node.name,
                "file_path": node.file_path or "",
                "language": node.metadata.get("language", ""),
            }
            metadatas.append(meta)

        if not ids:
            logger.warning("没有可添加的节点（缺少嵌入向量）")
            return 0

        try:
            collection.add(
                ids=ids,
                embeddings=embeddings,
                metadatas=metadatas,
                documents=documents,
            )
            logger.info(f"向量存储添加 {len(ids)} 个节点")
            return len(ids)
        except Exception as e:
            logger.error(f"向量存储添加失败: {e}")
            return 0

    def search(
        self,
        query: str,
        limit: int = 10,
        node_type: Optional[str] = None,
        language: Optional[str] = None,
        collection_name: str = "code_nodes",
    ) -> list[dict[str, Any]]:
        """
        语义检索节点。

        Args:
            query: 查询文本
            limit: 返回结果数量
            node_type: 过滤节点类型（如 "Function"）
            language: 过滤编程语言（如 "python"）
            collection_name: 集合名称

        Returns:
            检索结果列表，每项包含 id、metadata、distance
        """
        collection = self.get_collection(collection_name)

        # 构建过滤条件
        where: Optional[dict] = None
        if node_type or language:
            where = {}
            if node_type:
                where["node_type"] = node_type
            if language:
                where["language"] = language

        try:
            # 使用查询文本直接检索（ChromaDB 会自动生成嵌入）
            results = collection.query(
                query_texts=[query],
                n_results=limit,
                where=where,
            )
            # 格式化结果
            formatted: list[dict[str, Any]] = []
            if results["ids"] and results["ids"][0]:
                for i, node_id in enumerate(results["ids"][0]):
                    formatted.append({
                        "id": node_id,
                        "metadata": results["metadatas"][0][i] if results["metadatas"] else {},
                        "document": results["documents"][0][i] if results["documents"] else "",
                        "distance": results["distances"][0][i] if results["distances"] else 0.0,
                    })
            return formatted
        except Exception as e:
            logger.error(f"向量检索失败: {e}")
            return []

    def delete_collection(self, name: str = "code_nodes") -> bool:
        """
        删除集合。

        Args:
            name: 集合名称

        Returns:
            删除成功返回 True
        """
        client = self._get_client()
        try:
            client.delete_collection(name)
            logger.info(f"集合已删除: {name}")
            return True
        except Exception as e:
            logger.warning(f"删除集合失败: {e}")
            return False

    def count(self, collection_name: str = "code_nodes") -> int:
        """返回集合中的节点数量。"""
        collection = self.get_collection(collection_name)
        try:
            return collection.count()
        except Exception:
            return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    store = VectorStore()
    print(f"向量存储路径: {store.persist_dir}")
    count = store.count()
    print(f"当前节点数: {count}")
