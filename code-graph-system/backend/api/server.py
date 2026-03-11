"""
FastAPI 服务器主模块。

API 端点：
    POST /analyze/repository  — 提交代码仓库分析任务
    GET  /graph               — 列出所有图谱 / 获取指定图谱
    GET  /callgraph           — 获取函数调用图（Function 节点 + calls 边）
    GET  /lineage             — 获取依赖血缘图（Module/Service 节点 + depends_on 边）
    GET  /services            — 获取基础设施图（Service/Cluster/Database 节点）
    POST /query               — GraphRAG 自然语言查询

辅助端点：
    GET  /health              — 健康检查
    GET  /                    — 服务信息
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from backend.graph.graph_repository import GraphRepository
from backend.pipeline.analyze_repository import AnalysisPipeline
from backend.rag.graph_rag_engine import GraphRAGEngine
from backend.rag.vector_store import VectorStore

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# 全局单例
# ---------------------------------------------------------------------------

_graph_repo: GraphRepository
_vector_store: VectorStore
_pipeline: AnalysisPipeline
_rag_engine: GraphRAGEngine


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期：启动时初始化全局单例，关闭时释放 Neo4j 连接。"""
    global _graph_repo, _vector_store, _pipeline, _rag_engine

    logger.info("初始化服务组件...")
    _graph_repo   = GraphRepository()
    _vector_store = VectorStore()
    _pipeline     = AnalysisPipeline(_graph_repo, _vector_store)
    _rag_engine   = GraphRAGEngine(_graph_repo, _vector_store)
    logger.info("服务启动完成")

    yield

    logger.info("关闭服务...")
    _graph_repo.close()


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
# Request / Response Models
# ---------------------------------------------------------------------------


class AnalyzeRequest(BaseModel):
    """POST /analyze/repository 请求体。"""
    repo_path:  str            = Field(description="仓库根目录（本地绝对路径）")
    repo_name:  str            = Field(default="", description="图谱名称（空字符串则用目录名）")
    languages:  Optional[list[str]] = Field(default=None, description="限定分析语言，如 ['python', 'typescript']")
    enable_ai:  bool           = Field(default=False, description="启用 SemanticAnalyzer（需 ANTHROPIC_API_KEY）")
    enable_rag: bool           = Field(default=False, description="启用向量化索引（需安装 chromadb）")


class AnalyzeResponse(BaseModel):
    """POST /analyze/repository 响应体。"""
    graph_id:         str
    repo_name:        str
    repo_path:        str
    node_count:       int
    edge_count:       int
    duration_seconds: float
    node_types:       dict[str, int]
    edge_types:       dict[str, int]
    circular_deps:    int
    warnings:         list[str]
    step_stats:       dict[str, Any]


class QueryRequest(BaseModel):
    """POST /query 请求体。"""
    graph_id:     str  = Field(description="图谱 ID")
    question:     str  = Field(description="自然语言问题")
    search_limit: int  = Field(default=5,  ge=1, le=20, description="向量检索候选数量")
    expand_depth: int  = Field(default=1,  ge=1, le=3,  description="图展开深度")
    node_types:   Optional[list[str]] = Field(default=None, description="向量检索时过滤节点类型")


class QueryResponse(BaseModel):
    """POST /query 响应体。"""
    question:   str
    answer:     str
    nodes:      list[dict[str, Any]]
    edges:      list[dict[str, Any]]
    sources:    list[str]
    confidence: float


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------


def _load_or_404(graph_id: str):
    """加载 BuiltGraph，不存在时抛出 404。"""
    built = _graph_repo.load(graph_id)
    if built is None:
        raise HTTPException(status_code=404, detail=f"图谱不存在: {graph_id}")
    return built


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
            "POST /analyze/repository",
            "GET  /graph",
            "GET  /callgraph",
            "GET  /lineage",
            "GET  /services",
            "POST /query",
        ],
    }


@app.get("/health", tags=["基础"])
def health():
    """健康检查。"""
    return {"status": "healthy"}


# ---------------------------------------------------------------------------
# POST /analyze/repository
# ---------------------------------------------------------------------------


@app.post("/analyze/repository", response_model=AnalyzeResponse, tags=["分析"])
def analyze_repository(req: AnalyzeRequest):
    """
    分析代码仓库，构建知识图谱并持久化。

    - **repo_path**: 仓库根目录（本地路径，服务器可访问）
    - **enable_ai**: 启用 LLM 语义增强（慢，需 API Key）
    - **enable_rag**: 启用向量索引（需 chromadb）
    """
    logger.info("POST /analyze/repository  path=%s", req.repo_path)
    try:
        result = _pipeline.analyze(
            req.repo_path,
            repo_name=req.repo_name,
            languages=req.languages,
            enable_ai=req.enable_ai,
            enable_rag=req.enable_rag,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("分析失败")
        raise HTTPException(status_code=500, detail=str(e))

    built = result.built
    return AnalyzeResponse(
        graph_id=result.graph_id,
        repo_name=result.repo_name,
        repo_path=result.repo_path,
        node_count=result.node_count,
        edge_count=result.edge_count,
        duration_seconds=result.duration_seconds,
        node_types=built.meta.get("node_type_counts", {}),
        edge_types=built.meta.get("edge_type_counts", {}),
        circular_deps=len(result.circular_deps),
        warnings=result.warnings,
        step_stats=result.step_stats,
    )


# ---------------------------------------------------------------------------
# GET /graph
# ---------------------------------------------------------------------------


@app.get("/graph", tags=["图谱"])
def get_graph(
    graph_id: Optional[str] = Query(default=None, description="图谱 ID；不传则返回所有图谱摘要列表"),
    node_type: Optional[str] = Query(default=None, description="按节点类型过滤（仅在指定 graph_id 时生效）"),
    limit: int = Query(default=200, ge=1, le=5000, description="返回节点/边的最大数量"),
):
    """
    获取图谱信息。

    - 不传 `graph_id`：返回所有图谱摘要列表
    - 传入 `graph_id`：返回该图谱的节点和边（可按 `node_type` 过滤）
    """
    if graph_id is None:
        graphs = _graph_repo.list_graphs()
        return {"graphs": graphs, "total": len(graphs)}

    built = _load_or_404(graph_id)

    nodes = built.nodes
    if node_type:
        nodes = [n for n in nodes if n.type == node_type]

    node_list = []
    for n in nodes[:limit]:
        nd = n.model_dump()
        m = built.metrics.get(n.id)
        if m:
            nd["metrics"] = m
        node_list.append(nd)

    edge_list = [
        e.model_dump(by_alias=True)
        for e in built.edges[:limit]
    ]

    return {
        "graph_id":   graph_id,
        "node_count": built.node_count,
        "edge_count": built.edge_count,
        "node_types": built.meta.get("node_type_counts", {}),
        "edge_types": built.meta.get("edge_type_counts", {}),
        "nodes":      node_list,
        "edges":      edge_list,
    }


# ---------------------------------------------------------------------------
# GET /callgraph
# ---------------------------------------------------------------------------


@app.get("/callgraph", tags=["图谱"])
def get_callgraph(
    graph_id: str  = Query(description="图谱 ID"),
    node_id:  Optional[str] = Query(default=None, description="起始函数节点 ID；不传则返回全图调用关系"),
    depth:    int  = Query(default=1, ge=1, le=5, description="从指定节点 BFS 展开的深度"),
):
    """
    获取函数调用图。

    - 不传 `node_id`：返回图中所有 Function 节点和 `calls` 类型边
    - 传入 `node_id`：从该函数节点出发做 BFS，返回调用子图
    """
    built = _load_or_404(graph_id)

    if node_id:
        subgraph = _graph_repo.query_neighbors(
            graph_id, node_id, depth=depth, edge_types=["calls"]
        )
        return {
            "graph_id": graph_id,
            "root":     node_id,
            "depth":    depth,
            "nodes":    subgraph["nodes"],
            "edges":    subgraph["edges"],
        }

    # 全图调用关系：仅 Function/API 节点 + calls 边
    call_node_types = {"Function", "API"}
    func_nodes = [
        n.model_dump()
        for n in built.nodes
        if n.type in call_node_types
    ]
    call_edges = [
        e.model_dump(by_alias=True)
        for e in built.edges
        if e.type == "calls"
    ]
    return {
        "graph_id":   graph_id,
        "node_count": len(func_nodes),
        "edge_count": len(call_edges),
        "nodes":      func_nodes,
        "edges":      call_edges,
    }


# ---------------------------------------------------------------------------
# GET /lineage
# ---------------------------------------------------------------------------


@app.get("/lineage", tags=["图谱"])
def get_lineage(
    graph_id:  str = Query(description="图谱 ID"),
    node_id:   Optional[str] = Query(default=None, description="起始节点 ID；不传则返回全图依赖血缘"),
    edge_types: Optional[str] = Query(
        default=None,
        description="逗号分隔的边类型，如 depends_on,reads,writes；不传则使用默认依赖类型",
    ),
):
    """
    获取依赖血缘图。

    默认追踪以下关系：`depends_on`、`reads`、`writes`、`produces`、`consumes`。

    - 不传 `node_id`：返回整图中所有血缘相关节点和边
    - 传入 `node_id`：从该节点出发 BFS 展开血缘路径
    """
    _LINEAGE_EDGE_TYPES = {"depends_on", "reads", "writes", "produces", "consumes"}

    if edge_types:
        target_types = {t.strip() for t in edge_types.split(",") if t.strip()}
    else:
        target_types = _LINEAGE_EDGE_TYPES

    built = _load_or_404(graph_id)

    if node_id:
        subgraph = _graph_repo.query_neighbors(
            graph_id, node_id, depth=2, edge_types=list(target_types)
        )
        return {
            "graph_id":   graph_id,
            "root":       node_id,
            "edge_types": sorted(target_types),
            "nodes":      subgraph["nodes"],
            "edges":      subgraph["edges"],
        }

    lineage_edges = [
        e.model_dump(by_alias=True)
        for e in built.edges
        if e.type in target_types
    ]
    # 只返回出现在血缘边中的节点
    involved_ids: set[str] = set()
    for e in built.edges:
        if e.type in target_types:
            involved_ids.add(e.from_)
            involved_ids.add(e.to)

    node_map = {n.id: n for n in built.nodes}
    lineage_nodes = [
        node_map[nid].model_dump()
        for nid in involved_ids
        if nid in node_map
    ]

    return {
        "graph_id":   graph_id,
        "edge_types": sorted(target_types),
        "node_count": len(lineage_nodes),
        "edge_count": len(lineage_edges),
        "nodes":      lineage_nodes,
        "edges":      lineage_edges,
    }


# ---------------------------------------------------------------------------
# GET /services
# ---------------------------------------------------------------------------


@app.get("/services", tags=["图谱"])
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

    built = _load_or_404(graph_id)

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


# ---------------------------------------------------------------------------
# POST /query
# ---------------------------------------------------------------------------


@app.post("/query", response_model=QueryResponse, tags=["查询"])
def rag_query(req: QueryRequest):
    """
    GraphRAG 自然语言查询。

    Pipeline: 向量检索 → 图展开 → LLM 生成回答。

    **注意**: 需要先调用 `POST /analyze/repository?enable_rag=true` 建立向量索引。
    """
    logger.info("POST /query  graph=%s  question=%s", req.graph_id, req.question[:60])
    try:
        result = _rag_engine.rag_query(
            req.graph_id,
            req.question,
            search_limit=req.search_limit,
            expand_depth=req.expand_depth,
            node_types=req.node_types,
        )
    except Exception as e:
        logger.exception("RAG 查询失败")
        raise HTTPException(status_code=500, detail=str(e))

    return QueryResponse(
        question=result["question"],
        answer=result["answer"],
        nodes=result["nodes"],
        edges=result["edges"],
        sources=result["sources"],
        confidence=result["confidence"],
    )


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
