"""分析任务 API：/analyze/*"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import subprocess
import tempfile
import time as _time
import zipfile
from contextlib import asynccontextmanager
from typing import Any, Optional

import redis as sync_redis
import redis.asyncio as aioredis
from celery.result import AsyncResult
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from backend.scheduler.celery_app import celery_app
from backend.scheduler.tasks import analyze_repository as celery_analyze
from backend.agent.config import AnalysisConfig, AnalysisPreset

logger = logging.getLogger(__name__)
router = APIRouter()

_REDIS_URL = os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0")
_TASK_REGISTRY_PREFIX = "analyze:task:"
_TASK_REGISTRY_TTL_SECONDS = int(os.getenv("ANALYZE_TASK_REGISTRY_TTL", str(60 * 60 * 24)))


# ── Helper Functions ────────────────────────────────────────────────────────


def _task_registry_key(task_id: str) -> str:
    return f"{_TASK_REGISTRY_PREFIX}{task_id}"


def _register_task_id(task_id: str) -> None:
    """登记 task_id，避免队列等待期间被误判为不存在。"""
    try:
        client = sync_redis.Redis.from_url(_REDIS_URL, decode_responses=True, socket_connect_timeout=2)
        client.setex(_task_registry_key(task_id), _TASK_REGISTRY_TTL_SECONDS, "1")
    except Exception as exc:
        logger.warning("任务登记失败 task_id=%s: %s", task_id, exc)


def _is_registered_task_id(task_id: str) -> bool:
    try:
        client = sync_redis.Redis.from_url(_REDIS_URL, decode_responses=True, socket_connect_timeout=2)
        return bool(client.exists(_task_registry_key(task_id)))
    except Exception as exc:
        logger.debug("任务登记查询失败 task_id=%s: %s", task_id, exc)
        return False


def _is_git_url(path: str) -> bool:
    """判断是否为 Git 远程 URL（SSH 或 HTTPS 格式）。"""
    return (
        path.startswith("git@")
        or path.startswith("https://")
        or path.startswith("http://")
        or path.startswith("ssh://")
    )


def _clone_repo(git_url: str, branch: Optional[str], tmp_dir: str) -> str:
    """将远程仓库克隆到临时目录，返回克隆后的路径。"""
    clone_dir = os.path.join(tmp_dir, "repo")
    cmd = ["git", "clone", "--depth=1"]
    if branch:
        cmd += ["--branch", branch]
    cmd += [git_url, clone_dir]
    logger.info("git clone: %s", " ".join(cmd))
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=300)
    except subprocess.CalledProcessError as e:
        raise ValueError(f"Git 克隆失败: {e.stderr.strip()}")
    except subprocess.TimeoutExpired:
        raise ValueError("Git 克隆超时（>5分钟）")
    return clone_dir


def _checkout_branch(repo_path: str, branch: str) -> None:
    """在本地仓库中切换到指定分支。"""
    cmd = ["git", "-C", repo_path, "checkout", branch]
    logger.info("git checkout: %s", " ".join(cmd))
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=30)
    except subprocess.CalledProcessError as e:
        raise ValueError(f"分支切换失败（branch={branch}）: {e.stderr.strip()}")
    except subprocess.TimeoutExpired:
        raise ValueError("git checkout 超时（>30秒）")


# ── Request / Response Models ────────────────────────────────────────────────


class AnalyzeRequest(BaseModel):
    """POST /analyze/repository 请求体。"""
    repo_path:  str            = Field(description="仓库根目录（本地绝对路径）或 Git 仓库 URL（https/ssh）")
    repo_name:  str            = Field(default="", description="图谱名称（空字符串则用目录名）")
    repo_id:    Optional[str]  = Field(default=None, description="前端 repo_store 中的仓库 ID（用于 analysis_store 关联）")
    branch:     Optional[str]  = Field(default=None, description="Git 分支名（仅当 repo_path 为 Git URL 时生效）")
    languages:  Optional[list[str]] = Field(default=None, description="限定分析语言，如 ['python', 'typescript']")
    depth:      str            = Field(default="standard", description="分析深度 (quick | standard | deep)")
    pipeline_mode: str         = Field(default="static_first", description="流水线模式 (static_first | ai_first)")


class AnalyzeAsyncResponse(BaseModel):
    """POST /analyze/repository 异步响应（立即返回 task_id）。"""
    task_id: str
    status:  str = "pending"


class AnalyzeCancelResponse(BaseModel):
    """POST /analyze/cancel/{task_id} 响应。"""
    task_id: str
    status: str
    message: str


class AnalysisStatusResponse(BaseModel):
    """GET /analyze/status/{task_id} 响应。"""
    task_id:         str
    status:          str
    step:            Optional[int]   = None
    total:           Optional[int]   = None
    stage:           Optional[str]   = None
    message:         Optional[str]   = None
    log:             Optional[str]   = None
    elapsed_seconds: Optional[float] = None
    graph_id:        Optional[str]   = None
    node_count:      Optional[int]   = None
    edge_count:      Optional[int]   = None
    error:           Optional[str]   = None


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


class GraphPipelineRequest(BaseModel):
    """POST /analyze/graph 请求体（新版 GraphPipeline）。"""
    repo_path:  str                  = Field(description="仓库根目录（本地绝对路径）")
    repo_name:  str                  = Field(default="", description="图谱名称（空字符串则用目录名）")
    languages:  Optional[list[str]]  = Field(default=None, description="限定分析语言，如 ['python', 'typescript']")
    enable_ai:  bool                 = Field(default=False, description="启用 AI 逐文件分析（需配置 LLM API Key）")


class GraphPipelineResponse(BaseModel):
    """POST /analyze/graph 响应体。"""
    graph_id:         str
    output_path:      str
    node_count:       int
    edge_count:       int
    duration_seconds: float
    step_stats:       dict[str, Any]
    warnings:         list[str]
    graph:            dict[str, Any]


# ── Endpoints ────────────────────────────────────────────────────────────────


@router.post("/analyze/repository", response_model=AnalyzeAsyncResponse, tags=["分析"])
def analyze_repository(req: AnalyzeRequest):
    """
    提交代码仓库分析任务（异步）。立即返回 task_id，分析在后台进行。

    - 通过 GET /analyze/stream/{task_id} 订阅实时进度（SSE）
    - 通过 GET /analyze/status/{task_id} 查询最新状态
    - 默认启用 AI 语义分析和 RAG 向量索引

    Args:
        req: 分析请求，包含:
            - repo_path: 仓库路径（本地路径或 Git URL）
            - repo_name: 仓库名称
            - branch: Git 分支（仅 Git URL 时有效）
            - languages: 限定分析语言
            - depth: 分析深度 (quick | standard | deep)，默认 standard
    """
    # 验证 depth 参数
    valid_depths = ("quick", "standard", "deep")
    if req.depth not in valid_depths:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid depth: {req.depth}. Must be one of: {', '.join(valid_depths)}",
        )

    # 验证 pipeline_mode 参数
    valid_modes = ("static_first", "ai_first")
    if req.pipeline_mode not in valid_modes:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid pipeline_mode: {req.pipeline_mode}. Must be one of: {', '.join(valid_modes)}",
        )

    logger.info("POST /analyze/repository  path=%s  depth=%s  pipeline_mode=%s", req.repo_path, req.depth, req.pipeline_mode)

    # 提交 Celery 任务（git 克隆/缓存检查由任务内部处理，接口立即返回）
    job = celery_analyze.apply_async(
        args=[req.repo_path],
        kwargs={
            "repo_name": req.repo_name,
            "branch": req.branch,
            "languages": req.languages,
            "depth": req.depth,
            "store_repo_id": req.repo_id,
            "pipeline_mode": req.pipeline_mode,
        },
    )
    task_id: str = job.id
    _register_task_id(task_id)

    # 在状态存储中注册分析任务
    from backend.store.repo_status_store import get_repo_status_store
    from backend.store.analysis_store import get_analysis_store
    from pathlib import Path
    legacy_repo_id = req.repo_name or Path(req.repo_path).name.split("?")[0]
    status_store = get_repo_status_store()
    status_store.set_analyzing(
        legacy_repo_id,
        task_id=task_id,
        repo_name=req.repo_name or legacy_repo_id,
        repo_path=req.repo_path,
    )

    # 写入 analysis_store "analyzing" 记录（供 GET /repos 读取当前状态）
    if req.repo_id:
        analysis_store = get_analysis_store()
        analysis_store.write_completed(
            task_id=task_id,
            repo_id=req.repo_id,
            depth=req.depth,
            status="analyzing",
        )

    logger.info("任务已提交  task_id=%s  repo=%s  depth=%s", task_id, req.repo_path, req.depth)

    return AnalyzeAsyncResponse(task_id=task_id, status="pending")


@router.get("/analyze/stream/{task_id}", tags=["分析"])
async def analyze_stream(task_id: str):
    """
    订阅分析任务进度（Server-Sent Events）。

    事件格式: data: {step, total, stage, message, log, status, elapsed_seconds}
    特殊事件: data: {status: "completed", graph_id, node_count, edge_count}
              data: {status: "failed", error}
    心跳:     : heartbeat  （每 15 秒）
    """
    # 若任务未登记且 Celery 中也无任何状态信息，认为 task_id 不存在
    _check = AsyncResult(task_id, app=celery_app)
    if _check.state == "PENDING" and _check.info is None and not _is_registered_task_id(task_id):
        raise HTTPException(status_code=404, detail=f"任务不存在或尚未启动: {task_id}")

    async def event_generator():
        # 先发送当前持久化状态（断线重连恢复用）
        try:
            cur = AsyncResult(task_id, app=celery_app)
            if cur.info:
                # 检查 info 是否为 Exception 对象（任务失败时）
                if isinstance(cur.info, Exception):
                    yield f'data: {json.dumps({"status": "failed", "error": str(cur.info)})}\n\n'
                    return
                yield f"data: {json.dumps(cur.info)}\n\n"
                if cur.info.get("status") in ("completed", "failed"):
                    return
            elif cur.state == "PENDING" and _is_registered_task_id(task_id):
                # 任务仅排队未启动时，主动回传 pending，避免前端空白等待。
                pending_event = {
                    "status": "pending",
                    "step": 0,
                    "total": 13,
                    "stage": "",
                    "message": "任务已提交，等待 Worker 拉取...",
                    "log": "",
                    "elapsed_seconds": 0.0,
                }
                yield f"data: {json.dumps(pending_event)}\n\n"
        except Exception:
            pass

        # 订阅 Redis Pub/Sub channel
        redis_conn = None
        pubsub = None
        try:
            redis_conn = aioredis.from_url(_REDIS_URL, socket_connect_timeout=3)
            pubsub = redis_conn.pubsub()
            await pubsub.subscribe(f"progress:{task_id}")

            last_hb = _time.monotonic()
            while True:
                try:
                    msg = await asyncio.wait_for(
                        pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0),
                        timeout=2.0,
                    )
                except asyncio.TimeoutError:
                    msg = None

                if msg and msg.get("type") == "message":
                    data_str = msg["data"]
                    if isinstance(data_str, bytes):
                        data_str = data_str.decode()
                    event = json.loads(data_str)
                    yield f"data: {data_str}\n\n"
                    if event.get("status") in ("completed", "failed"):
                        break

                # 心跳
                now = _time.monotonic()
                if now - last_hb >= 15:
                    yield ": heartbeat\n\n"
                    last_hb = now

        except (asyncio.CancelledError, GeneratorExit):
            # 客户端断开连接，正常清理
            pass
        except Exception as exc:
            err = json.dumps({"status": "error", "error": "stream_interrupted"})
            yield f"data: {err}\n\n"
            logger.warning("SSE stream error task=%s: %s", task_id, exc)
        finally:
            if pubsub:
                try:
                    await pubsub.unsubscribe(f"progress:{task_id}")
                    await pubsub.aclose()
                except Exception:
                    pass
            if redis_conn:
                try:
                    await redis_conn.aclose()
                except Exception:
                    pass

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/analyze/status/{task_id}", response_model=AnalysisStatusResponse, tags=["分析"])
def analyze_status(task_id: str):
    """查询分析任务的最新状态（轮询 / 断线重连恢复用）。"""
    result = AsyncResult(task_id, app=celery_app)
    if result.info is None and result.state == "PENDING" and not _is_registered_task_id(task_id):
        raise HTTPException(status_code=404, detail=f"任务不存在: {task_id}")

    info = result.info or {}
    if isinstance(info, Exception):
        return AnalysisStatusResponse(task_id=task_id, status="failed", error=str(info))

    if result.state == "REVOKED":
        return AnalysisStatusResponse(
            task_id=task_id,
            status="canceled",
            message="任务已取消",
        )

    return AnalysisStatusResponse(
        task_id=task_id,
        status=info.get("status", result.state.lower()),
        step=info.get("step"),
        total=info.get("total"),
        stage=info.get("stage"),
        message=info.get("message"),
        log=info.get("log"),
        elapsed_seconds=info.get("elapsed_seconds"),
        graph_id=info.get("graph_id"),
        node_count=info.get("node_count"),
        edge_count=info.get("edge_count"),
        error=info.get("error"),
    )


@router.post("/analyze/cancel/{task_id}", response_model=AnalyzeCancelResponse, tags=["分析"])
def analyze_cancel(task_id: str):
    """取消分析任务。"""
    result = AsyncResult(task_id, app=celery_app)
    if result.info is None and result.state == "PENDING" and not _is_registered_task_id(task_id):
        raise HTTPException(status_code=404, detail=f"任务不存在: {task_id}")

    if result.state in ("SUCCESS", "FAILURE", "REVOKED"):
        final_state = "canceled" if result.state == "REVOKED" else result.state.lower()
        return AnalyzeCancelResponse(
            task_id=task_id,
            status=final_state,
            message="任务已结束，无法取消",
        )

    result.revoke(terminate=True)

    # 更新状态存储
    from backend.store.repo_status_store import get_repo_status_store
    status_store = get_repo_status_store()
    repo = status_store.get_by_task_id(task_id)
    if repo:
        status_store.set_canceled(repo["repo_id"])

    try:
        sync_redis.Redis.from_url(_REDIS_URL, decode_responses=True, socket_connect_timeout=2).publish(
            f"progress:{task_id}",
            json.dumps({"status": "canceled", "message": "任务已取消"}),
        )
    except Exception as exc:
        logger.debug("取消任务时发布 canceled 事件失败 task_id=%s: %s", task_id, exc)

    return AnalyzeCancelResponse(
        task_id=task_id,
        status="canceled",
        message="取消请求已发送",
    )


@router.post("/analyze/upload-zip", response_model=AnalyzeResponse, tags=["分析"])
def analyze_upload_zip(
    file:       UploadFile = File(description="ZIP 格式代码压缩包"),
    repo_name:  str        = Form(default="", description="图谱名称（空字符串则用文件名）"),
    languages:  str        = Form(default="", description="逗号分隔的语言列表，如 python,typescript"),
    enable_ai:  bool       = Form(default=False),
    enable_rag: bool       = Form(default=False),
):
    """
    上传 ZIP 压缩包并分析，构建知识图谱。

    - 仅接受 `.zip` 格式
    - 压缩包将解压到临时目录后执行分析，完成后自动清理
    """
    from backend.api.deps import get_graph_repo, get_rag_engine, get_graph_pipeline

    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="仅支持 .zip 格式压缩包")

    lang_list: Optional[list[str]] = (
        [l.strip() for l in languages.split(",") if l.strip()]
        if languages.strip()
        else None
    )
    name = repo_name or (file.filename[:-4] if file.filename else "uploaded")

    tmp_dir: Optional[str] = None
    extracted = ""
    try:
        tmp_dir = tempfile.mkdtemp(prefix="ckg_zip_")
        zip_path = os.path.join(tmp_dir, "upload.zip")

        with open(zip_path, "wb") as f:
            shutil.copyfileobj(file.file, f)

        with zipfile.ZipFile(zip_path, "r") as zf:
            zf.extractall(os.path.join(tmp_dir, "repo"))

        # 若解压后只有一个顶层目录（常见打包格式），直接用该目录
        extracted = os.path.join(tmp_dir, "repo")
        entries = os.listdir(extracted)
        if len(entries) == 1 and os.path.isdir(os.path.join(extracted, entries[0])):
            extracted = os.path.join(extracted, entries[0])

        logger.info("ZIP 解压完成，分析路径: %s", extracted)
        graph_pipeline = get_graph_pipeline()
        result = graph_pipeline.run(
            extracted,
            repo_name=name,
            languages=lang_list,
            enable_ai=enable_ai,
        )
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="文件不是有效的 ZIP 压缩包")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("ZIP 分析失败")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if tmp_dir and os.path.exists(tmp_dir):
            shutil.rmtree(tmp_dir, ignore_errors=True)

    if enable_rag:
        try:
            graph_repo = get_graph_repo()
            rag_engine = get_rag_engine()
            built = graph_repo.load(result.graph_id)
            if built:
                rag_engine.embed_nodes(result.graph_id, built.nodes)
        except Exception as exc:
            logger.warning("RAG 向量化失败（不影响图谱结果）: %s", exc)

    graph_meta = result.step_stats.get("4_build", {})
    return AnalyzeResponse(
        graph_id=result.graph_id,
        repo_name=name,
        repo_path=extracted,
        node_count=result.node_count,
        edge_count=result.edge_count,
        duration_seconds=result.duration_seconds,
        node_types=graph_meta.get("node_types", {}),
        edge_types=graph_meta.get("edge_types", {}),
        circular_deps=0,
        warnings=result.warnings,
        step_stats=result.step_stats,
    )


@router.post("/analyze/graph", response_model=GraphPipelineResponse, tags=["分析"])
def analyze_graph(req: GraphPipelineRequest):
    """
    新版分析流水线：scan -> parse -> AI analyze (per file) -> build graph -> export graph.json

    与 ``POST /analyze/repository`` 的区别：
    - AI 分析以**文件为单位**逐一调用 LLM，每个文件独立返回 JSON Graph 片段
    - 输出直接为标准 ``{"nodes": [], "edges": []}`` 格式，无需二次转换
    - 不依赖 NetworkX / ChromaDB，可在最小依赖环境下运行

    **repo_path** 必须是本地绝对路径（不支持 Git URL）。
    """
    from backend.api.deps import get_graph_pipeline

    logger.info("POST /analyze/graph  path=%s  enable_ai=%s", req.repo_path, req.enable_ai)

    try:
        graph_pipeline = get_graph_pipeline()
        result = graph_pipeline.run(
            req.repo_path,
            repo_name=req.repo_name,
            languages=req.languages,
            enable_ai=req.enable_ai,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("GraphPipeline 分析失败")
        raise HTTPException(status_code=500, detail=str(e))

    return GraphPipelineResponse(
        graph_id=result.graph_id,
        output_path=result.output_path,
        node_count=result.node_count,
        edge_count=result.edge_count,
        duration_seconds=result.duration_seconds,
        step_stats=result.step_stats,
        warnings=result.warnings,
        graph=result.graph,
    )
