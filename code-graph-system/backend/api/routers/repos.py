# code-graph-system/backend/api/routers/repos.py
"""仓库管理 API：/repos/* + /api/pipeline/stages"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.store.repo_store import get_repo_store
from backend.store.analysis_store import get_analysis_store

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Request / Response Models ────────────────────────────────────────────────


class CreateRepoRequest(BaseModel):
    repo_id:     Optional[str]       = Field(default=None)
    repo_name:   str                 = Field(description="仓库名称")
    repo_path:   str                 = Field(description="本地路径或 Git URL")
    branch:      Optional[str]       = Field(default=None)
    source_mode: str                 = Field(default="local")
    language:    Optional[list[str]] = Field(default=None)


class UpdateRepoRequest(BaseModel):
    repo_name:   Optional[str]       = Field(default=None)
    branch:      Optional[str]       = Field(default=None)
    language:    Optional[list[str]] = Field(default=None)


# ── Pipeline Stage Registry ────────────────────────────────────────────────

STAGE_REGISTRY: list[dict] = [
    {
        "key": "file_index",
        "label": "扫描文件",
        "description": "扫描代码仓库文件，Git 增量检测",
    },
    {
        "key": "deep_static_analysis",
        "label": "静态分析",
        "description": "AST 解析 + 框架模式识别",
    },
    {
        "key": "parallel_stage",
        "label": "模块聚类 + DI解析",
        "description": "目录聚类与 Spring DI/Event 静态解析（并行，零 LLM）",
    },
    {
        "key": "ai_semantic_enhance",
        "label": "AI 语义增强",
        "description": "AI 增强模块描述与边界验证",
    },
    {
        "key": "spring_di_event_ai",
        "label": "AI 歧义解析",
        "description": "AI 解析 DI/Event 歧义（无歧义时跳过）",
    },
    {
        "key": "repository",
        "label": "持久化存储",
        "description": "保存图谱到存储",
    },
]


# ── Endpoints ────────────────────────────────────────────────────────────────


@router.get("/repos", tags=["仓库"])
def list_repos():
    """列出所有仓库（含最近一次分析摘要）。"""
    store = get_repo_store()
    analysis_store = get_analysis_store()
    repos = store.list_all()

    result = []
    for repo in repos:
        latest = analysis_store.get_latest(repo["id"])
        # 将 latest_analysis.graph_id 提升到顶层，供前端 graphApi.ts 映射 graphId 用
        graph_id = (latest or {}).get("graph_id")
        result.append({**repo, "latest_analysis": latest, "graph_id": graph_id})

    return {"repos": result}


@router.post("/repos", tags=["仓库"])
def create_repo(req: CreateRepoRequest):
    """创建仓库配置。"""
    store = get_repo_store()

    # 生成 repo_id（前端未提供时服务器生成）
    import time, random, string
    repo_id = req.repo_id or f"repo-{int(time.time())}-{''.join(random.choices(string.ascii_lowercase, k=6))}"

    try:
        repo = store.create(
            repo_id=repo_id,
            name=req.repo_name,
            path=req.repo_path,
            source_mode=req.source_mode,
            language=req.language or [],
            branch=req.branch,
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))

    return repo


@router.put("/repos/{repo_id}", tags=["仓库"])
def update_repo(repo_id: str, req: UpdateRepoRequest):
    """编辑仓库配置（名称、分支、语言）。"""
    store = get_repo_store()
    kwargs = {}
    if req.repo_name is not None:
        kwargs["name"] = req.repo_name
    if req.branch is not None:
        kwargs["branch"] = req.branch
    if req.language is not None:
        kwargs["language"] = req.language

    repo = store.update(repo_id, **kwargs)
    if repo is None:
        raise HTTPException(status_code=404, detail=f"仓库不存在: {repo_id}")
    return repo


@router.delete("/repos/{repo_id}", tags=["仓库"])
def delete_repo(repo_id: str):
    """删除仓库及其所有分析历史、关联图谱 JSON 和 ChromaDB 集合。"""
    from backend.graph.graph_repository import GraphRepository
    from backend.rag.vector_store import VectorStore

    store = get_repo_store()
    analysis_store = get_analysis_store()

    # 获取所有关联图谱 ID，先删图谱
    analyses = analysis_store.list_by_repo(repo_id)
    graph_repo = GraphRepository()
    vector_store = VectorStore()

    for analysis in analyses:
        gid = analysis.get("graph_id")
        if gid:
            try:
                graph_repo.delete(gid)
            except Exception as exc:
                logger.warning("删除图谱失败 graph_id=%s: %s", gid, exc)
            try:
                # VectorStore 实际方法名为 delete_graph()
                vector_store.delete_graph(gid)
            except Exception as exc:
                logger.warning("删除向量集合失败 graph_id=%s: %s", gid, exc)

    # 删除 GraphStorage 中的图谱文件（新体系）
    try:
        from backend.storage.graph_storage import GraphStorage
        GraphStorage().delete_repo(repo_id)
    except Exception as exc:
        logger.warning("删除 GraphStorage 失败 repo_id=%s: %s", repo_id, exc)

    # 删除运行时状态记录
    try:
        from backend.store.repo_status_store import get_repo_status_store
        get_repo_status_store().delete(repo_id)
    except Exception as exc:
        logger.warning("删除 repo_status_store 失败 repo_id=%s: %s", repo_id, exc)

    analysis_store.delete_by_repo(repo_id)
    store.delete(repo_id)
    return {"deleted": repo_id}


@router.get("/repos/{repo_id}/analyses", tags=["仓库"])
def list_repo_analyses(repo_id: str, task_id: Optional[str] = None):
    """获取仓库的分析历史（含当前进行中任务）。"""
    from celery.result import AsyncResult
    from backend.scheduler.celery_app import celery_app

    analysis_store = get_analysis_store()
    records = analysis_store.list_by_repo(repo_id)

    # 若有进行中任务，拼接虚拟记录放在首位
    virtual = None
    if task_id:
        try:
            result = AsyncResult(task_id, app=celery_app)
            info = result.info or {}
            if not isinstance(info, Exception) and result.state not in ("SUCCESS", "FAILURE", "REVOKED"):
                virtual = {
                    "id": task_id,
                    "repo_id": repo_id,
                    "status": "analyzing",
                    "stage_key": info.get("stage", ""),
                    "step": info.get("step", 0),
                    "total": info.get("total", 6),
                    "message": info.get("message", ""),
                    "started_at": None,
                    "finished_at": None,
                }
        except Exception:
            pass

    result_list = ([virtual] if virtual else []) + records
    return {"analyses": result_list}


@router.get("/api/pipeline/stages", tags=["流水线"])
def get_pipeline_stages():
    """返回当前流水线 Stage 定义（前端进度条依赖此数据）。"""
    return {
        "stages": STAGE_REGISTRY,
        "total": len(STAGE_REGISTRY),
    }
