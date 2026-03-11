"""
向量存储模块。

基于 ChromaDB 实现代码节点的向量化存储和相似度检索。

设计原则：
    - 每个 graph_id 对应独立 Collection（命名为 ``kg_{graph_id}``），互不干扰
    - 使用 ChromaDB 内置 Embedding（sentence-transformers/all-MiniLM-L6-v2），
      无需外部 Embedding API 密钥
    - upsert 语义：幂等，可重复调用

主要接口：
    upsert(graph_id, ids, documents, metadatas)  —— 插入/更新文档
    search(graph_id, query, limit, where)         —— 向量相似度检索
    delete_graph(graph_id)                        —— 删除整个图谱索引
    count(graph_id)                               —— 查询文档数量
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

_DEFAULT_CHROMA_DIR = "./data/chroma"

# ChromaDB Collection 名称最长 63 字符
_MAX_COLLECTION_NAME = 63


class VectorStore:
    """
    ChromaDB 向量存储封装。

    每个 graph_id 对应一个独立 Collection，互相隔离。
    ChromaDB 内置 Embedding（all-MiniLM-L6-v2），无需外部 API。

    示例::

        store = VectorStore()
        store.upsert("my-project", ids, documents, metadatas)
        results = store.search("my-project", "用户认证相关函数", limit=5)
    """

    def __init__(self, persist_dir: str = _DEFAULT_CHROMA_DIR) -> None:
        """
        Args:
            persist_dir: ChromaDB 持久化目录（默认 ``./data/chroma``）。
        """
        self.persist_dir = Path(persist_dir)
        self.persist_dir.mkdir(parents=True, exist_ok=True)
        self._client = None

    # ------------------------------------------------------------------
    # Client / Collection 管理
    # ------------------------------------------------------------------

    def _get_client(self) -> object:
        """懒加载 ChromaDB PersistentClient。"""
        if self._client is not None:
            return self._client
        try:
            import chromadb

            self._client = chromadb.PersistentClient(path=str(self.persist_dir))
            logger.info("ChromaDB 初始化成功: %s", self.persist_dir)
            return self._client
        except ImportError:
            raise RuntimeError(
                "chromadb 包未安装，请运行: pip install chromadb"
            )

    def _collection_name(self, graph_id: str) -> str:
        """将 graph_id 映射为合法 ChromaDB Collection 名称。

        格式：``kg_<graph_id>``，截断至最大长度。
        """
        name = f"kg_{graph_id}"
        # ChromaDB 要求名称只含字母数字和 -_，用下划线替换其他字符
        import re
        name = re.sub(r"[^a-zA-Z0-9_\-]", "_", name)
        return name[:_MAX_COLLECTION_NAME]

    def _get_collection(self, graph_id: str) -> object:
        """获取或创建指定图谱对应的 Collection。"""
        client = self._get_client()
        name = self._collection_name(graph_id)
        return client.get_or_create_collection(
            name=name,
            metadata={"graph_id": graph_id},
        )

    # ------------------------------------------------------------------
    # upsert
    # ------------------------------------------------------------------

    def upsert(
        self,
        graph_id: str,
        ids: list[str],
        documents: list[str],
        metadatas: list[dict[str, Any]],
    ) -> int:
        """插入或更新文档（幂等）。

        ChromaDB 会自动对 ``documents`` 生成 Embedding 向量。

        Args:
            graph_id:  图谱 ID，决定写入哪个 Collection。
            ids:       文档 ID 列表，与节点 ID 对应。
            documents: 节点文本内容列表（用于生成 Embedding）。
            metadatas: 元数据列表（用于过滤检索），值必须为标量。

        Returns:
            实际写入的文档数量；ChromaDB 报错时返回 0。
        """
        if not ids:
            return 0

        collection = self._get_collection(graph_id)
        # ChromaDB 元数据值只支持 str / int / float / bool
        clean_metas = [_clean_metadata(m) for m in metadatas]

        try:
            collection.upsert(ids=ids, documents=documents, metadatas=clean_metas)
            logger.debug(
                "VectorStore.upsert: graph=%s, %d 条文档", graph_id, len(ids)
            )
            return len(ids)
        except Exception:
            logger.error(
                "VectorStore.upsert 失败: graph=%s", graph_id, exc_info=True
            )
            return 0

    # ------------------------------------------------------------------
    # search
    # ------------------------------------------------------------------

    def search(
        self,
        graph_id: str,
        query: str,
        *,
        limit: int = 10,
        where: Optional[dict[str, Any]] = None,
    ) -> list[dict[str, Any]]:
        """向量相似度检索。

        Args:
            graph_id: 图谱 ID。
            query:    自然语言查询文本，ChromaDB 自动转换为 Embedding。
            limit:    最多返回数量（默认 10）。
            where:    元数据过滤条件，使用 ChromaDB ``$eq`` / ``$in`` 语法，
                      例如 ``{"node_type": {"$eq": "Function"}}``。

        Returns:
            结果列表，每项格式::

                {
                    "id":       "<node_id>",
                    "metadata": {"node_type": "Function", "name": "...", ...},
                    "document": "<节点文本>",
                    "distance": 0.23,   # L2 距离，越小越相似
                }

            集合为空或检索失败时返回空列表。
        """
        collection = self._get_collection(graph_id)
        total = collection.count()
        if total == 0:
            logger.debug("VectorStore.search: graph=%s 集合为空", graph_id)
            return []

        n = min(limit, total)
        try:
            kwargs: dict[str, Any] = {"query_texts": [query], "n_results": n}
            if where:
                kwargs["where"] = where

            results = collection.query(**kwargs)
            formatted: list[dict[str, Any]] = []

            if results["ids"] and results["ids"][0]:
                ids_row = results["ids"][0]
                metas_row = (results["metadatas"] or [[]])[0]
                docs_row = (results["documents"] or [[]])[0]
                dists_row = (results["distances"] or [[]])[0]

                for i, node_id in enumerate(ids_row):
                    formatted.append({
                        "id":       node_id,
                        "metadata": metas_row[i] if i < len(metas_row) else {},
                        "document": docs_row[i]  if i < len(docs_row)  else "",
                        "distance": dists_row[i] if i < len(dists_row) else 0.0,
                    })

            return formatted
        except Exception:
            logger.error(
                "VectorStore.search 失败: graph=%s query='%s'",
                graph_id, query[:40], exc_info=True,
            )
            return []

    # ------------------------------------------------------------------
    # delete / count
    # ------------------------------------------------------------------

    def delete_graph(self, graph_id: str) -> bool:
        """删除整个图谱对应的 Collection。

        Returns:
            删除成功返回 True，失败返回 False。
        """
        client = self._get_client()
        name = self._collection_name(graph_id)
        try:
            client.delete_collection(name)
            logger.info("VectorStore: 集合已删除: %s", name)
            return True
        except Exception:
            logger.warning(
                "VectorStore: 删除集合失败: %s", name, exc_info=True
            )
            return False

    def count(self, graph_id: str) -> int:
        """返回指定图谱 Collection 中的文档数量。"""
        try:
            return self._get_collection(graph_id).count()
        except Exception:
            return 0


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _clean_metadata(meta: dict[str, Any]) -> dict[str, Any]:
    """将 metadata 中非标量值转为字符串（ChromaDB 限制）。"""
    cleaned: dict[str, Any] = {}
    for k, v in meta.items():
        if v is None:
            continue
        if isinstance(v, (str, int, float, bool)):
            cleaned[k] = v
        else:
            cleaned[k] = str(v)
    return cleaned


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    store = VectorStore()
    print(f"向量存储路径: {store.persist_dir}")
