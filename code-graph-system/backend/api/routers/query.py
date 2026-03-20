"""GraphRAG 查询 API：/query"""
from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.api.deps import get_rag_engine

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Request / Response Models ────────────────────────────────────────────────


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


# ── Endpoints ────────────────────────────────────────────────────────────────


@router.post("/query", response_model=QueryResponse, tags=["查询"])
def rag_query(req: QueryRequest):
    """
    GraphRAG 自然语言查询。

    Pipeline: 向量检索 -> 图展开 -> LLM 生成回答。

    **注意**: 首次查询时，如果向量索引不存在，系统会自动建立索引（可能需要几秒钟）。
    也可以在分析时通过 `POST /analyze/repository?enable_rag=true` 提前建立索引。
    """
    logger.info("POST /query  graph=%s  question=%s", req.graph_id, req.question[:60])
    try:
        rag_engine = get_rag_engine()
        result = rag_engine.rag_query(
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
