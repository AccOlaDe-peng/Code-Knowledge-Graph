"""
FastAPI 服务器主模块。

提供 RESTful API 接口：
- POST /analyze - 提交代码仓库分析任务
- GET /graphs - 列出所有图谱
- GET /graphs/{graph_id} - 获取图谱详情
- POST /query - GraphRAG 查询
- GET /health - 健康检查
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Any, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.graph.graph_repository import GraphRepository
from backend.graph.schema import AnalysisRequest, GraphQueryRequest
from backend.pipeline.analyze_repository import AnalysisPipeline
from backend.rag.graph_rag_engine import GraphRAGEngine
from backend.rag.vector_store import VectorStore

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# 全局实例
graph_repo: GraphRepository
vector_store: VectorStore
pipeline: AnalysisPipeline
rag_engine: GraphRAGEngine


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理。"""
    global graph_repo, vector_store, pipeline, rag_engine

    logger.info("初始化服务组件...")
    graph_repo = GraphRepository()
    vector_store = VectorStore()
    pipeline = AnalysisPipeline(graph_repo, vector_store)
    rag_engine = GraphRAGEngine(graph_repo, vector_store)
    logger.info("服务启动完成")

    yield

    logger.info("关闭服务...")
    graph_repo.close()


app = FastAPI(
    title="Code Knowledge Graph API",
    description="AI 代码知识图谱系统 API",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------


@app.get("/")
def root():
    """根路径。"""
    return {
        "service": "Code Knowledge Graph API",
        "version": "1.0.0",
        "status": "running",
    }


@app.get("/health")
def health_check():
    """健康检查。"""
    return {"status": "healthy", "timestamp": "2026-03-11"}


@app.post("/analyze")
def analyze_repository(request: AnalysisRequest):
    """
    提交代码仓库分析任务。

    Args:
        request: 分析请求对象

    Returns:
        分析响应对象
    """
    logger.info(f"收到分析请求: {request.repo_path}")
    try:
        response = pipeline.analyze(request)
        return response
    except Exception as e:
        logger.exception("分析任务失败")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/graphs")
def list_graphs():
    """
    列出所有已构建的图谱。

    Returns:
        图谱摘要列表
    """
    try:
        graphs = graph_repo.list_graphs()
        return {"graphs": graphs, "total": len(graphs)}
    except Exception as e:
        logger.exception("获取图谱列表失败")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/graphs/{graph_id}")
def get_graph(graph_id: str):
    """
    获取指定图谱的详细信息。

    Args:
        graph_id: 图谱 ID

    Returns:
        CodeGraph 对象（JSON 格式）
    """
    try:
        graph = graph_repo.load(graph_id)
        if graph is None:
            raise HTTPException(status_code=404, detail="图谱不存在")
        return graph.model_dump(mode="json")
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"加载图谱失败: {graph_id}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/graphs/{graph_id}")
def delete_graph(graph_id: str):
    """
    删除指定图谱。

    Args:
        graph_id: 图谱 ID

    Returns:
        删除结果
    """
    try:
        success = graph_repo.delete(graph_id)
        if not success:
            raise HTTPException(status_code=404, detail="图谱不存在")
        # 同时删除向量索引
        vector_store.delete_collection(graph_id)
        return {"message": "图谱已删除", "graph_id": graph_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"删除图谱失败: {graph_id}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/query")
def query_graph(request: GraphQueryRequest):
    """
    执行 GraphRAG 查询。

    Args:
        request: 查询请求对象

    Returns:
        查询响应对象
    """
    logger.info(f"收到查询请求: {request.query}")
    try:
        response = rag_engine.query(request)
        return response
    except Exception as e:
        logger.exception("查询失败")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/graphs/{graph_id}/nodes")
def get_nodes(
    graph_id: str,
    node_type: Optional[str] = None,
    limit: int = 50,
):
    """
    获取图谱中的节点列表。

    Args:
        graph_id: 图谱 ID
        node_type: 过滤节点类型（可选）
        limit: 返回数量限制

    Returns:
        节点列表
    """
    try:
        if node_type:
            from backend.graph.schema import NodeType

            nodes = graph_repo.query_nodes_by_type(
                graph_id, NodeType(node_type), limit
            )
        else:
            graph = graph_repo.load(graph_id)
            if graph is None:
                raise HTTPException(status_code=404, detail="图谱不存在")
            nodes = [n.model_dump(mode="json") for n in graph.nodes[:limit]]
        return {"nodes": nodes, "count": len(nodes)}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"获取节点失败: {graph_id}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/graphs/{graph_id}/neighbors/{node_id}")
def get_neighbors(
    graph_id: str,
    node_id: str,
    depth: int = 1,
):
    """
    获取节点的邻居子图。

    Args:
        graph_id: 图谱 ID
        node_id: 节点 ID
        depth: 遍历深度

    Returns:
        子图（包含节点和边）
    """
    try:
        subgraph = graph_repo.query_neighbors(graph_id, node_id, depth)
        return subgraph
    except Exception as e:
        logger.exception(f"获取邻居失败: {graph_id}/{node_id}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/search")
def search_code(
    query: str,
    node_type: Optional[str] = None,
    language: Optional[str] = None,
    limit: int = 10,
):
    """
    向量检索代码节点。

    Args:
        query: 查询文本
        node_type: 过滤节点类型
        language: 过滤编程语言
        limit: 返回数量

    Returns:
        检索结果列表
    """
    try:
        results = rag_engine.search_code(
            query=query,
            node_type=node_type,
            language=language,
            limit=limit,
        )
        return {"results": results, "count": len(results)}
    except Exception as e:
        logger.exception("代码检索失败")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info",
    )
