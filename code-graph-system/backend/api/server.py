"""
FastAPI 服务器主模块。

API 端点：
    POST   /analyze/repository  — 分析代码仓库（异步，返回 task_id）
    POST   /analyze/upload-zip  — 上传 ZIP 压缩包分析
    GET    /graph               — 列出所有图谱 / 获取指定图谱
    DELETE /graph/{graph_id}    — 删除指定图谱
    GET    /graph/export        — 导出标准 JSON Graph（CodeGraph 格式）
    GET    /graph/data          — 获取完整 JSON Graph（GraphStorage 格式）
    GET    /graph/call          — 获取调用子图（calls 边）
    GET    /graph/module        — 获取模块结构子图（contains/imports 边）
    GET    /graph/summary       — 获取图谱 LOD-0 摘要
    GET    /callgraph           — 获取函数调用图（Function 节点 + calls 边）
    GET    /lineage             — 获取依赖血缘图（depends_on/reads/writes 边）
    GET    /events              — 获取事件流图（Event/Topic 节点）
    GET    /services            — 获取基础设施图（Service/Cluster/Database 节点）
    POST   /query               — GraphRAG 自然语言查询

辅助端点：
    GET  /health              — 健康检查
    GET  /                    — 服务信息
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from typing import Optional

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from backend.graph.graph_repository import GraphRepository
from backend.pipeline.graph_pipeline import GraphPipeline
from backend.rag.graph_rag_engine import GraphRAGEngine
from backend.rag.vector_store import VectorStore
from backend.storage.graph_storage import GraphStorage
from backend.api import deps

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期：启动时初始化全局单例，关闭时释放 Neo4j 连接。"""
    logger.info("初始化服务组件...")

    graph_repo = GraphRepository()
    vector_store = VectorStore()
    rag_engine = GraphRAGEngine(graph_repo, vector_store)
    # GraphPipeline 共享同一个 GraphRepository 实例，
    # 保证 Step 5 写入的 BuiltGraph 能被旧端点（GET /graph 等）直接读取
    graph_pipeline = GraphPipeline(graph_repo=graph_repo)
    graph_storage = GraphStorage()

    # 初始化 deps 模块中的全局单例
    deps.init_singletons(
        graph_repo=graph_repo,
        vector_store=vector_store,
        rag_engine=rag_engine,
        graph_pipeline=graph_pipeline,
        graph_storage=graph_storage,
    )

    # 同步已有图谱到仓库状态存储
    from backend.store.repo_status_store import get_repo_status_store
    status_store = get_repo_status_store()
    graphs = graph_repo.list_graphs()
    status_store.sync_from_graphs(graphs)
    logger.info("服务启动完成")

    yield

    logger.info("关闭服务...")
    graph_repo.close()


# ---------------------------------------------------------------------------
# FastAPI App
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Code Knowledge Graph API",
    description="AI 代码知识图谱系统 REST API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# 注册 Routers
# ---------------------------------------------------------------------------

from backend.api.routers import repos as repos_router
from backend.api.routers import analysis as analysis_router
from backend.api.routers import graphs as graphs_router
from backend.api.routers import query as query_router
from backend.api.routers import domains as domains_router
from backend.api.routers import data_lineage as data_lineage_router

app.include_router(repos_router.router)
app.include_router(analysis_router.router)
app.include_router(graphs_router.router)
app.include_router(query_router.router)
app.include_router(domains_router.router)
app.include_router(data_lineage_router.router)


# ---------------------------------------------------------------------------
# Request / Response Models（仅用于遗留端点）
# ---------------------------------------------------------------------------


class SaveRepoRequest(BaseModel):
    """POST /repos/save 请求体：保存仓库配置（不触发分析）。"""
    repo_id:     str                     = Field(description="前端生成的仓库 ID")
    repo_name:   str                     = Field(description="仓库名称")
    repo_path:   str                     = Field(description="本地路径或 Git URL")
    branch:      Optional[str]           = Field(default=None, description="Git 分支")
    source_mode: Optional[str]           = Field(default=None, description="local | git | zip")
    language:    Optional[list[str]]     = Field(default=None, description="分析语言列表")


# ---------------------------------------------------------------------------
# 基础端点
# ---------------------------------------------------------------------------


@app.get("/", tags=["基础"])
def root():
    """服务信息。"""
    return {
        "service": "Code Knowledge Graph API",
        "version": "1.0.0",
        "docs":    "/docs",
        "endpoints": [
            "POST   /analyze/repository  (异步分析，返回 task_id)",
            "POST   /analyze/cancel/{task_id}  (取消分析任务)",
            "GET    /analyze/stream/{task_id}  (SSE 实时进度)",
            "GET    /analyze/status/{task_id}  (查询任务状态)",
            "POST   /analyze/upload-zip  (ZIP 上传分析)",
            "POST   /analyze/graph       (GraphPipeline 直接调用，返回完整 graph)",
            "GET    /graph               (列表 / 详情)",
            "GET    /graph/export        (标准 CodeGraph JSON)",
            "GET    /graph/data          (完整 JSON Graph)",
            "GET    /graph/call          (调用子图)",
            "GET    /graph/module        (模块结构子图)",
            "GET    /graph/summary       (LOD-0 摘要)",
            "DELETE /graph/{graph_id}",
            "GET    /callgraph",
            "GET    /lineage",
            "GET    /events",
            "GET    /services",
            "POST   /query",
        ],
    }


@app.get("/health", tags=["基础"])
def health():
    """健康检查。"""
    return {"status": "healthy"}


# ---------------------------------------------------------------------------
# POST /repos/save（遗留端点，保留向后兼容）
# ---------------------------------------------------------------------------


@app.post("/repos/save", tags=["仓库"])
def save_repo(req: SaveRepoRequest):
    """保存仓库配置到持久化存储（不触发分析）。

    前端新建仓库时调用，使仓库在刷新后仍可见。
    """
    from backend.store.repo_status_store import get_repo_status_store
    status_store = get_repo_status_store()
    status_store.set_status(
        req.repo_id,
        repo_name=req.repo_name,
        repo_path=req.repo_path,
        status="saved",
        branch=req.branch,
        source_mode=req.source_mode,
        language=req.language or [],
    )
    logger.info("仓库已保存: %s (%s)", req.repo_name, req.repo_id)
    return {"repo_id": req.repo_id, "status": "saved"}


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "backend.api.server:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info",
    )
