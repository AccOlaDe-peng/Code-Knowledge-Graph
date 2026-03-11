"""
GraphRAG 引擎模块。

将向量检索（ChromaDB）与图谱遍历（GraphRepository）结合，
通过 LLM 生成面向代码库的精准问答。

处理管道（rag_query）：
    1. vector_search  — ChromaDB 语义检索，找到最相关的 N 个节点
    2. graph_expand   — BFS 图展开，沿边扩展邻居节点和关系
    3. _build_rag_prompt — 将节点/边信息组装为结构化 Prompt
    4. llm.complete   — LLM 生成自然语言回答

向量化对象（embed_nodes 默认目标）：
    Function / Component / API

依赖：
    - backend.ai.llm_client.LLMClient
    - backend.graph.graph_repository.GraphRepository
    - backend.graph.graph_schema.GraphNode
    - backend.rag.vector_store.VectorStore
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from backend.ai.llm_client import LLMClient, get_default_client
from backend.graph.graph_repository import GraphRepository
from backend.graph.graph_schema import GraphNode
from backend.rag.vector_store import VectorStore

logger = logging.getLogger(__name__)

# 默认参与向量化的节点类型
_EMBED_NODE_TYPES: frozenset[str] = frozenset({"Function", "Component", "API"})

# RAG 系统提示词
_RAG_SYSTEM_PROMPT = """\
你是代码知识图谱助手，基于提供的代码结构（节点和关系）回答用户问题。
回答要求：
- 引用具体的函数名、类名、文件路径
- 说明关键调用链或依赖关系
- 若上下文信息不足，明确说明并给出推断依据
- 使用简洁的技术语言，避免冗余\
"""


class GraphRAGEngine:
    """
    GraphRAG 查询引擎。

    融合 ChromaDB 向量检索和图谱邻居扩展，通过 LLM 生成精准代码问答。

    典型用法::

        engine = GraphRAGEngine(graph_repo, vector_store)

        # 分析完成后，将节点写入向量索引
        engine.embed_nodes(graph_id, built.nodes)

        # 自然语言查询
        result = engine.rag_query(graph_id, "用户登录功能是如何实现的？")
        print(result["answer"])
        print(result["sources"])
    """

    def __init__(
        self,
        graph_repo: GraphRepository,
        vector_store: VectorStore,
        llm_client: Optional[LLMClient] = None,
    ) -> None:
        """
        Args:
            graph_repo:  图谱存储仓库（用于 graph_expand 和加载节点）。
            vector_store: ChromaDB 向量存储（用于 embed_nodes / vector_search）。
            llm_client:  LLM 客户端，None 则使用 get_default_client()。
        """
        self.graph_repo = graph_repo
        self.vector_store = vector_store
        self.llm = llm_client or get_default_client()

    # ------------------------------------------------------------------
    # embed_nodes
    # ------------------------------------------------------------------

    def embed_nodes(
        self,
        graph_id: str,
        nodes: list[GraphNode],
        *,
        node_types: Optional[tuple[str, ...]] = None,
    ) -> int:
        """将指定类型的节点向量化并写入 ChromaDB。

        从节点属性（name / type / description / responsibilities / docstring）
        生成文本，通过 ChromaDB 内置 Embedding 模型转换为向量后存储。

        Args:
            graph_id:   图谱 ID，决定写入哪个 Collection。
            nodes:      候选节点列表（通常来自 ``BuiltGraph.nodes``）。
            node_types: 要嵌入的节点类型白名单，None 使用默认
                        ``{Function, Component, API}``。

        Returns:
            实际写入（upsert）的节点数量。
        """
        target_types = frozenset(node_types) if node_types else _EMBED_NODE_TYPES
        filtered = [n for n in nodes if n.type in target_types]

        if not filtered:
            logger.debug(
                "embed_nodes: graph=%s, 无 %s 类型节点", graph_id, sorted(target_types)
            )
            return 0

        ids: list[str] = []
        documents: list[str] = []
        metadatas: list[dict[str, Any]] = []

        for node in filtered:
            ids.append(node.id)
            documents.append(_node_to_text(node))
            metadatas.append({
                "node_id":     node.id,
                "node_type":   node.type,
                "name":        node.name,
                "source_file": node.properties.get("source_file", ""),
                "domain":      node.properties.get("domain", ""),
                "graph_id":    graph_id,
            })

        count = self.vector_store.upsert(graph_id, ids, documents, metadatas)
        logger.info(
            "embed_nodes: graph=%s 写入 %d/%d 节点 (类型=%s)",
            graph_id, count, len(nodes), sorted(target_types),
        )
        return count

    # ------------------------------------------------------------------
    # vector_search
    # ------------------------------------------------------------------

    def vector_search(
        self,
        graph_id: str,
        query: str,
        *,
        limit: int = 10,
        node_types: Optional[list[str]] = None,
    ) -> list[dict[str, Any]]:
        """在 ChromaDB 中执行向量相似度检索。

        Args:
            graph_id:   图谱 ID。
            query:      自然语言查询文本。
            limit:      最多返回数量（默认 10）。
            node_types: 节点类型白名单过滤，None 表示不过滤。
                        例如 ``["Function", "API"]``。

        Returns:
            检索结果列表，每项格式::

                {
                    "id":       "<node_id>",
                    "metadata": {"node_type": "Function", "name": "...", ...},
                    "document": "<节点嵌入文本>",
                    "distance": 0.12,   # L2 距离，越小越相似
                }
        """
        where: Optional[dict[str, Any]] = None
        if node_types:
            if len(node_types) == 1:
                where = {"node_type": {"$eq": node_types[0]}}
            else:
                where = {"node_type": {"$in": node_types}}

        results = self.vector_store.search(
            graph_id, query, limit=limit, where=where
        )
        logger.debug(
            "vector_search: graph=%s query='%s' → %d 结果",
            graph_id, query[:40], len(results),
        )
        return results

    # ------------------------------------------------------------------
    # graph_expand
    # ------------------------------------------------------------------

    def graph_expand(
        self,
        graph_id: str,
        seed_node_ids: list[str],
        *,
        depth: int = 1,
        edge_types: Optional[list[str]] = None,
    ) -> dict[str, Any]:
        """从种子节点出发做 BFS 图展开，返回合并后的子图。

        对每个种子节点调用 ``GraphRepository.query_neighbors``，
        将结果合并去重后返回。

        Args:
            graph_id:      图谱 ID。
            seed_node_ids: 起始节点 ID 列表（通常来自 vector_search 结果）。
            depth:         BFS 展开深度（默认 1）。
            edge_types:    只沿指定类型边扩展，None 表示全部。
                           例如 ``["calls", "depends_on"]``。

        Returns:
            ``{"nodes": [...], "edges": [...]}`` 合并后的子图字典。
            节点和边均已去重。
        """
        all_nodes: dict[str, dict[str, Any]] = {}
        all_edges: list[dict[str, Any]] = []
        seen_edges: set[tuple[str, str, str]] = set()

        for seed_id in seed_node_ids:
            sub = self.graph_repo.query_neighbors(
                graph_id,
                seed_id,
                depth=depth,
                edge_types=edge_types,
            )
            for n in sub.get("nodes", []):
                all_nodes[n["id"]] = n
            for e in sub.get("edges", []):
                key = (
                    e.get("from", e.get("from_", "")),
                    e.get("to", ""),
                    e.get("type", ""),
                )
                if key not in seen_edges:
                    seen_edges.add(key)
                    all_edges.append(e)

        logger.debug(
            "graph_expand: graph=%s seeds=%d depth=%d → %d 节点 %d 边",
            graph_id, len(seed_node_ids), depth,
            len(all_nodes), len(all_edges),
        )
        return {"nodes": list(all_nodes.values()), "edges": all_edges}

    # ------------------------------------------------------------------
    # rag_query
    # ------------------------------------------------------------------

    def rag_query(
        self,
        graph_id: str,
        question: str,
        *,
        search_limit: int = 5,
        expand_depth: int = 1,
        node_types: Optional[list[str]] = None,
    ) -> dict[str, Any]:
        """完整 RAG 管道：向量检索 → 图展开 → LLM 生成回答。

        Pipeline::

            question
              → vector_search()      找到语义最近的 N 个节点
              → graph_expand()       沿边展开上下文（邻居节点 + 关系）
              → _build_rag_prompt()  构造包含代码结构的 Prompt
              → llm.complete()       生成自然语言回答

        Args:
            graph_id:     图谱 ID。
            question:     用户自然语言问题。
            search_limit: 向量检索候选数量（默认 5）。
            expand_depth: 图展开深度（默认 1）。
            node_types:   向量检索时的节点类型过滤。

        Returns:
            结果字典::

                {
                    "question":   "<原始问题>",
                    "answer":     "<LLM 回答>",
                    "nodes":      [...],    # 参与回答的节点列表
                    "edges":      [...],    # 参与回答的边列表
                    "sources":    [...],    # 涉及的源文件路径
                    "confidence": 0.85,    # 基于 Top-1 向量距离估算（0-1）
                }

            向量存储为空时返回提示性 answer，confidence 为 0.0。
            LLM 不可用时返回错误提示，其余字段正常填充。
        """
        # ── Step 1: 向量检索 ──────────────────────────────────────────
        vector_hits = self.vector_search(
            graph_id, question, limit=search_limit, node_types=node_types
        )

        if not vector_hits:
            return {
                "question":   question,
                "answer":     (
                    "未在向量存储中找到相关节点，"
                    "请先调用 embed_nodes() 建立索引。"
                ),
                "nodes":      [],
                "edges":      [],
                "sources":    [],
                "confidence": 0.0,
            }

        # ── Step 2: 图展开 ────────────────────────────────────────────
        seed_ids = [h["id"] for h in vector_hits]
        subgraph = self.graph_expand(graph_id, seed_ids, depth=expand_depth)

        # 合并向量命中节点（含 distance）与图展开节点
        node_map: dict[str, dict] = {n["id"]: n for n in subgraph["nodes"]}
        for hit in vector_hits:
            if hit["id"] not in node_map:
                node_map[hit["id"]] = hit
        context_nodes = list(node_map.values())
        context_edges = subgraph["edges"]

        # ── Step 3: 构建 Prompt ───────────────────────────────────────
        prompt = _build_rag_prompt(question, context_nodes, context_edges)

        # ── Step 4: LLM 生成 ─────────────────────────────────────────
        try:
            answer = self.llm.complete(prompt, system=_RAG_SYSTEM_PROMPT)
        except Exception:
            logger.error("rag_query: LLM 调用失败", exc_info=True)
            answer = (
                "LLM 服务不可用，无法生成回答。"
                "以下是检索到的相关节点信息，供参考。"
            )

        confidence = _estimate_confidence(vector_hits)

        # 提取来源文件（去重）
        sources: list[str] = []
        seen_src: set[str] = set()
        for n in context_nodes:
            src = (
                n.get("metadata", {}).get("source_file")
                or n.get("properties", {}).get("source_file", "")
            )
            if src and src not in seen_src:
                seen_src.add(src)
                sources.append(src)

        logger.info(
            "rag_query: graph=%s confidence=%.2f nodes=%d edges=%d",
            graph_id, confidence, len(context_nodes), len(context_edges),
        )
        return {
            "question":   question,
            "answer":     answer,
            "nodes":      context_nodes,
            "edges":      context_edges,
            "sources":    sources,
            "confidence": confidence,
        }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _node_to_text(node: GraphNode) -> str:
    """将 GraphNode 转换为用于向量嵌入的文本。

    拼接顺序：name → type → description → domain → responsibilities → docstring → source_file
    """
    props = node.properties
    parts: list[str] = [node.name, node.type]

    if desc := props.get("description"):
        parts.append(str(desc))
    if domain := props.get("domain"):
        parts.append(f"domain:{domain}")
    if resps := props.get("responsibilities"):
        if isinstance(resps, list):
            parts.extend(str(r) for r in resps[:3])
    if docstring := props.get("docstring"):
        parts.append(str(docstring)[:200])
    if src := props.get("source_file"):
        # 只取文件名，减少路径噪音
        parts.append(str(src).rsplit("/", 1)[-1])

    return " ".join(filter(None, parts))


def _build_rag_prompt(
    question: str,
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
) -> str:
    """构造包含代码结构上下文的 RAG Prompt。"""
    # 节点描述（最多 15 个）
    node_lines: list[str] = []
    for n in nodes[:15]:
        # 兼容 vector_search 结果（含 metadata 键）和 graph_expand 结果（含 properties 键）
        meta = n.get("metadata") or n.get("properties") or {}
        name  = meta.get("name")      or n.get("name", "?")
        ntype = meta.get("node_type") or n.get("type", "?")
        doc   = n.get("document", "") or meta.get("description", "")
        src   = meta.get("source_file", "")
        dist  = n.get("distance")

        line = f"  [{ntype}] {name}"
        if src:
            line += f" ({src})"
        if dist is not None:
            line += f" [相似度:{round(1 - dist / 2, 2)}]"
        if doc:
            line += f"\n    {doc[:120]}"
        node_lines.append(line)

    # 边描述（最多 20 条）
    edge_lines: list[str] = []
    for e in edges[:20]:
        src_id = e.get("from", e.get("from_", "?"))
        tgt_id = e.get("to", "?")
        etype  = e.get("type", "?")
        edge_lines.append(f"  {src_id} --[{etype}]--> {tgt_id}")

    nodes_text = "\n".join(node_lines) or "  (无节点)"
    edges_text = "\n".join(edge_lines) or "  (无关系)"

    return f"""用户问题：{question}

相关代码节点：
{nodes_text}

节点关系：
{edges_text}

请基于以上代码结构信息回答用户问题。"""


def _estimate_confidence(vector_results: list[dict[str, Any]]) -> float:
    """根据 Top-1 向量 L2 距离估算置信度（0-1，越高越好）。

    ChromaDB 默认使用 L2 距离，范围约 0-2；距离 0 = 完全相同。
    """
    if not vector_results:
        return 0.0
    distance = vector_results[0].get("distance", 1.0)
    return round(max(0.0, 1.0 - distance / 2.0), 2)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    from backend.graph.graph_repository import GraphRepository
    from backend.rag.vector_store import VectorStore as VS

    repo = GraphRepository()
    store = VS()
    engine = GraphRAGEngine(repo, store)
    print("GraphRAGEngine 初始化完成")
    print(f"LLM 可用: {engine.llm.is_available()}")
