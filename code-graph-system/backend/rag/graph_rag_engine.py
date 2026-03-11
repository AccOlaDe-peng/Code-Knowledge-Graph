"""
GraphRAG 引擎模块。

结合图谱结构和向量检索实现增强检索生成（RAG）：
1. 向量检索找到相关节点
2. 图遍历扩展上下文（邻居节点、调用链）
3. 构建结构化 Prompt
4. LLM 生成回答

支持多种查询模式：
- 自然语言查询
- 代码搜索
- 依赖分析
- 影响范围分析
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from backend.ai.llm_client import LLMClient, get_default_client
from backend.graph.graph_repository import GraphRepository
from backend.graph.schema import CodeGraph, GraphQueryRequest, GraphQueryResponse
from backend.rag.vector_store import VectorStore

logger = logging.getLogger(__name__)


class GraphRAGEngine:
    """
    GraphRAG 查询引擎。

    融合向量检索和图遍历，为用户提供精准的代码问答能力。

    示例::

        engine = GraphRAGEngine(graph_repo, vector_store)
        response = await engine.query("用户登录功能是如何实现的？", graph_id)
    """

    def __init__(
        self,
        graph_repo: GraphRepository,
        vector_store: VectorStore,
        llm_client: Optional[LLMClient] = None,
    ) -> None:
        """
        初始化 GraphRAG 引擎。

        Args:
            graph_repo: 图谱存储仓库
            vector_store: 向量存储
            llm_client: LLM 客户端
        """
        self.graph_repo = graph_repo
        self.vector_store = vector_store
        self.llm = llm_client or get_default_client()

    def query(
        self,
        request: GraphQueryRequest,
    ) -> GraphQueryResponse:
        """
        执行 GraphRAG 查询。

        Args:
            request: 查询请求对象

        Returns:
            查询响应对象
        """
        query_text = request.query
        graph_id = request.repo_id
        limit = request.limit

        # 1. 向量检索相关节点
        vector_results = self.vector_store.search(
            query=query_text,
            limit=limit,
            collection_name=graph_id or "code_nodes",
        )

        if not vector_results:
            return GraphQueryResponse(
                query=query_text,
                answer="未找到相关代码节点，请检查查询关键词或图谱是否已构建。",
                confidence=0.0,
            )

        # 2. 加载完整图谱（用于上下文扩展）
        graph: Optional[CodeGraph] = None
        if graph_id:
            graph = self.graph_repo.load(graph_id)

        # 3. 扩展上下文：获取相关节点的邻居
        context_nodes: list[dict[str, Any]] = []
        context_edges: list[dict[str, Any]] = []

        for vr in vector_results[:5]:  # 取 Top-5
            node_id = vr["id"]
            context_nodes.append(vr)
            if graph and request.include_context:
                subgraph = self.graph_repo.query_neighbors(
                    graph_id=graph_id,
                    node_id=node_id,
                    depth=1,
                )
                context_nodes.extend(subgraph.get("nodes", []))
                context_edges.extend(subgraph.get("edges", []))

        # 去重
        seen_ids = set()
        unique_nodes = []
        for n in context_nodes:
            if n["id"] not in seen_ids:
                seen_ids.add(n["id"])
                unique_nodes.append(n)

        # 4. 构建 Prompt
        prompt = self._build_prompt(query_text, unique_nodes, context_edges)

        # 5. LLM 生成回答
        try:
            answer = self.llm.complete(
                prompt,
                system="你是代码知识图谱助手，基于提供的代码结构和上下文回答用户问题。",
            )
            confidence = self._estimate_confidence(vector_results)
        except Exception as e:
            logger.error(f"LLM 生成失败: {e}")
            answer = f"生成回答时出错: {e}"
            confidence = 0.0

        return GraphQueryResponse(
            query=query_text,
            answer=answer,
            nodes=unique_nodes[:request.limit],
            edges=context_edges[:request.limit * 2],
            confidence=confidence,
            sources=[n.get("metadata", {}).get("file_path", "") for n in unique_nodes[:5]],
        )

    def _build_prompt(
        self,
        query: str,
        nodes: list[dict[str, Any]],
        edges: list[dict[str, Any]],
    ) -> str:
        """构建 RAG Prompt。"""
        node_desc = "\n".join([
            f"- {n.get('metadata', {}).get('name', 'N/A')} "
            f"({n.get('metadata', {}).get('node_type', 'N/A')}): "
            f"{n.get('document', '')[:200]}"
            for n in nodes[:10]
        ])

        edge_desc = "\n".join([
            f"- {e.get('type', 'N/A')}: {e.get('source_id', '')} -> {e.get('target_id', '')}"
            for e in edges[:20]
        ])

        prompt = f"""用户问题: {query}

相关代码节点:
{node_desc}

节点关系:
{edge_desc}

请基于以上代码结构信息，用简洁清晰的语言回答用户问题。
如果信息不足，请说明需要更多上下文。
"""
        return prompt

    def _estimate_confidence(self, vector_results: list[dict]) -> float:
        """
        根据向量检索结果估算置信度。

        Args:
            vector_results: 向量检索结果列表

        Returns:
            置信度分数 (0.0-1.0)
        """
        if not vector_results:
            return 0.0
        # 使用 Top-1 的距离作为置信度指标（距离越小，置信度越高）
        top_distance = vector_results[0].get("distance", 1.0)
        # 距离通常在 0-2 之间，转换为置信度
        confidence = max(0.0, 1.0 - top_distance / 2.0)
        return round(confidence, 2)

    def search_code(
        self,
        query: str,
        node_type: Optional[str] = None,
        language: Optional[str] = None,
        limit: int = 10,
    ) -> list[dict[str, Any]]:
        """
        纯向量检索代码节点（不生成回答）。

        Args:
            query: 查询文本
            node_type: 过滤节点类型
            language: 过滤编程语言
            limit: 返回数量

        Returns:
            节点列表
        """
        return self.vector_store.search(
            query=query,
            limit=limit,
            node_type=node_type,
            language=language,
        )

    def analyze_impact(
        self,
        graph_id: str,
        node_id: str,
        depth: int = 2,
    ) -> dict[str, Any]:
        """
        分析节点的影响范围（依赖它的节点）。

        Args:
            graph_id: 图谱 ID
            node_id: 起始节点 ID
            depth: 遍历深度

        Returns:
            包含影响节点和边的字典
        """
        return self.graph_repo.query_neighbors(
            graph_id=graph_id,
            node_id=node_id,
            depth=depth,
            edge_types=["CALLS", "USES", "DEPENDS_ON"],
        )


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    repo = GraphRepository()
    store = VectorStore()
    engine = GraphRAGEngine(repo, store)
    print("GraphRAG 引擎初始化完成")
