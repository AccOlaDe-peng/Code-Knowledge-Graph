"""FastAPI 依赖注入函数。"""
from __future__ import annotations

from typing import Optional

from backend.graph.graph_repository import GraphRepository
from backend.rag.graph_rag_engine import GraphRAGEngine
from backend.pipeline.graph_pipeline import GraphPipeline
from backend.rag.vector_store import VectorStore
from backend.storage.graph_storage import GraphStorage

# 全局单例引用（由 server.py lifespan 初始化）
_graph_repo: Optional[GraphRepository] = None
_vector_store: Optional[VectorStore] = None
_rag_engine: Optional[GraphRAGEngine] = None
_graph_pipeline: Optional[GraphPipeline] = None
_graph_storage: Optional[GraphStorage] = None


def init_singletons(
    graph_repo: GraphRepository,
    vector_store: VectorStore,
    rag_engine: GraphRAGEngine,
    graph_pipeline: GraphPipeline,
    graph_storage: GraphStorage,
) -> None:
    """初始化全局单例。"""
    global _graph_repo, _vector_store, _rag_engine, _graph_pipeline, _graph_storage
    _graph_repo = graph_repo
    _vector_store = vector_store
    _rag_engine = rag_engine
    _graph_pipeline = graph_pipeline
    _graph_storage = graph_storage


def get_graph_repo() -> GraphRepository:
    """获取 GraphRepository 单例。"""
    if _graph_repo is None:
        raise RuntimeError("GraphRepository 未初始化，请确保 lifespan 已执行")
    return _graph_repo


def get_rag_engine() -> GraphRAGEngine:
    """获取 GraphRAGEngine 单例。"""
    if _rag_engine is None:
        raise RuntimeError("GraphRAGEngine 未初始化，请确保 lifespan 已执行")
    return _rag_engine


def get_graph_pipeline() -> GraphPipeline:
    """获取 GraphPipeline 单例。"""
    if _graph_pipeline is None:
        raise RuntimeError("GraphPipeline 未初始化，请确保 lifespan 已执行")
    return _graph_pipeline


def get_graph_storage() -> GraphStorage:
    """获取 GraphStorage 单例。"""
    if _graph_storage is None:
        raise RuntimeError("GraphStorage 未初始化，请确保 lifespan 已执行")
    return _graph_storage


def get_vector_store() -> VectorStore:
    """获取 VectorStore 单例。"""
    if _vector_store is None:
        raise RuntimeError("VectorStore 未初始化，请确保 lifespan 已执行")
    return _vector_store
