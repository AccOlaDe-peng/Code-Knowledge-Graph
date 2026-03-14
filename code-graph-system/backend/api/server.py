"""
FastAPI 服务器主模块。

API 端点：
    POST   /analyze/repository  — 分析代码仓库（统一走 GraphPipeline，不再生成 Markdown）
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

import asyncio
import json
import logging
import os
import time as _time

from dotenv import load_dotenv

load_dotenv()
import shutil
import subprocess
import tempfile
import zipfile
from contextlib import asynccontextmanager
from typing import Any, Optional

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
import redis.asyncio as aioredis
import redis as sync_redis
from celery.result import AsyncResult

from backend.graph.code_graph import CodeGraph
from backend.graph.graph_repository import GraphRepository
from backend.pipeline.graph_pipeline import GraphPipeline
from backend.rag.graph_rag_engine import GraphRAGEngine
from backend.rag.vector_store import VectorStore
from backend.storage.graph_storage import GraphStorage, RepoNotFoundError
from backend.scheduler.celery_app import celery_app
from backend.scheduler.tasks import analyze_repository as celery_analyze

_REDIS_URL = os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0")
_TASK_REGISTRY_PREFIX = "analyze:task:"
_TASK_REGISTRY_TTL_SECONDS = int(os.getenv("ANALYZE_TASK_REGISTRY_TTL", str(60 * 60 * 24)))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


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

# ---------------------------------------------------------------------------
# 全局单例
# ---------------------------------------------------------------------------

_graph_repo:    GraphRepository
_vector_store:  VectorStore
_rag_engine:    GraphRAGEngine
_graph_pipeline: GraphPipeline
_graph_storage: GraphStorage


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期：启动时初始化全局单例，关闭时释放 Neo4j 连接。"""
    global _graph_repo, _vector_store, _rag_engine, _graph_pipeline, _graph_storage

    logger.info("初始化服务组件...")
    _graph_repo     = GraphRepository()
    _vector_store   = VectorStore()
    _rag_engine     = GraphRAGEngine(_graph_repo, _vector_store)
    # GraphPipeline 共享同一个 GraphRepository 实例，
    # 保证 Step 5 写入的 BuiltGraph 能被旧端点（GET /graph 等）直接读取
    _graph_pipeline = GraphPipeline(graph_repo=_graph_repo)
    _graph_storage  = GraphStorage()
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
    repo_path:  str            = Field(description="仓库根目录（本地绝对路径）或 Git 仓库 URL（https/ssh）")
    repo_name:  str            = Field(default="", description="图谱名称（空字符串则用目录名）")
    branch:     Optional[str]  = Field(default=None, description="Git 分支名（仅当 repo_path 为 Git URL 时生效）")
    languages:  Optional[list[str]] = Field(default=None, description="限定分析语言，如 ['python', 'typescript']")
    # enable_ai 和 enable_rag 已移除，默认全部开启


class AnalyzeAsyncResponse(BaseModel):
    """POST /analyze/repository 异步响应（立即返回 task_id）。"""
    task_id: str
    status:  str = "pending"


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
            "POST   /analyze/repository  (异步分析，返回 task_id)",
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
# POST /analyze/repository
# ---------------------------------------------------------------------------


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


@app.post("/analyze/repository", response_model=AnalyzeAsyncResponse, tags=["分析"])
def analyze_repository(req: AnalyzeRequest):
    """
    提交代码仓库分析任务（异步）。立即返回 task_id，分析在后台进行。

    - 通过 GET /analyze/stream/{task_id} 订阅实时进度（SSE）
    - 通过 GET /analyze/status/{task_id} 查询最新状态
    - 默认启用 AI 语义分析和 RAG 向量索引
    """
    logger.info("POST /analyze/repository  path=%s", req.repo_path)

    analyze_path = req.repo_path
    tmp_dir: Optional[str] = None

    # Git URL 克隆（同步，在提交 Celery 任务前完成）
    if _is_git_url(req.repo_path):
        try:
            tmp_dir = tempfile.mkdtemp(prefix="ckg_git_")
            analyze_path = _clone_repo(req.repo_path, req.branch, tmp_dir)
            logger.info("克隆完成，分析路径: %s", analyze_path)
        except ValueError as e:
            if tmp_dir:
                shutil.rmtree(tmp_dir, ignore_errors=True)
            raise HTTPException(status_code=400, detail=str(e))

    # 提交 Celery 任务（将 tmp_dir 传递给任务，由任务负责清理）
    job = celery_analyze.apply_async(
        args=[analyze_path],
        kwargs={
            "repo_name": req.repo_name,
            "languages": req.languages,
            "tmp_dir": tmp_dir,  # 传递临时目录路径，任务完成后清理
        },
    )
    task_id: str = job.id
    _register_task_id(task_id)
    logger.info("任务已提交  task_id=%s  path=%s  tmp_dir=%s", task_id, analyze_path, tmp_dir)

    return AnalyzeAsyncResponse(task_id=task_id, status="pending")


@app.get("/analyze/stream/{task_id}", tags=["分析"])
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


@app.get("/analyze/status/{task_id}", response_model=AnalysisStatusResponse, tags=["分析"])
def analyze_status(task_id: str):
    """查询分析任务的最新状态（轮询 / 断线重连恢复用）。"""
    result = AsyncResult(task_id, app=celery_app)
    if result.info is None and result.state == "PENDING" and not _is_registered_task_id(task_id):
        raise HTTPException(status_code=404, detail=f"任务不存在: {task_id}")

    info = result.info or {}
    if isinstance(info, Exception):
        return AnalysisStatusResponse(task_id=task_id, status="failed", error=str(info))

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


# ---------------------------------------------------------------------------
# POST /analyze/upload-zip
# ---------------------------------------------------------------------------


@app.post("/analyze/upload-zip", response_model=AnalyzeResponse, tags=["分析"])
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
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="仅支持 .zip 格式压缩包")

    lang_list: Optional[list[str]] = (
        [l.strip() for l in languages.split(",") if l.strip()]
        if languages.strip()
        else None
    )
    name = repo_name or (file.filename[:-4] if file.filename else "uploaded")

    tmp_dir: Optional[str] = None
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
        result = _graph_pipeline.run(
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
            built = _graph_repo.load(result.graph_id)
            if built:
                _rag_engine.embed_nodes(result.graph_id, built.nodes)
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


# ---------------------------------------------------------------------------
# POST /analyze/graph  (GraphPipeline — 新版流水线)
# ---------------------------------------------------------------------------


@app.post("/analyze/graph", response_model=GraphPipelineResponse, tags=["分析"])
def analyze_graph(req: GraphPipelineRequest):
    """
    新版分析流水线：scan → parse → AI analyze (per file) → build graph → export graph.json

    与 ``POST /analyze/repository`` 的区别：
    - AI 分析以**文件为单位**逐一调用 LLM，每个文件独立返回 JSON Graph 片段
    - 输出直接为标准 ``{"nodes": [], "edges": []}`` 格式，无需二次转换
    - 不依赖 NetworkX / ChromaDB，可在最小依赖环境下运行

    **repo_path** 必须是本地绝对路径（不支持 Git URL）。
    """
    logger.info("POST /analyze/graph  path=%s  enable_ai=%s", req.repo_path, req.enable_ai)

    try:
        result = _graph_pipeline.run(
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
        # 补充 git_commit 字段（GraphPipeline 写入的 meta 中含此字段）
        for g in graphs:
            if "git_commit" not in g:
                g["git_commit"] = g.get("git_commit", "")
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
# GET /graph/export
# ---------------------------------------------------------------------------


@app.get("/graph/export", tags=["图谱"])
def export_graph(
    graph_id: str = Query(description="图谱 ID"),
):
    """
    导出标准 JSON Graph，供前端直接消费。

    使用 ``CodeGraph`` schema，只包含核心节点类型和边类型。

    节点类型：``repository / module / file / class / function / api / database / table``

    边类型：``contains / imports / calls / reads / writes``

    返回格式：
    ```json
    {
      "graph_version": "1.0",
      "repo": {"name": "...", "path": "...", "language": "...", "commit": "..."},
      "nodes": [
        {"id": "...", "type": "...", "name": "...",
         "file": "...", "line": 1, "module": "...", "language": "..."}
      ],
      "edges": [
        {"from": "...", "to": "...", "type": "..."}
      ]
    }
    ```
    """
    built = _load_or_404(graph_id)

    meta      = built.meta or {}
    repo_name = meta.get("repo_name", graph_id)
    repo_path = meta.get("repo_path", "")
    commit    = meta.get("git_commit", "")

    code_graph = CodeGraph.from_built(
        built,
        repo_name=repo_name,
        repo_path=repo_path,
        commit=commit,
    )
    return code_graph.to_dict()


# ---------------------------------------------------------------------------
# GET /graph  (GraphStorage — 标准 JSON Graph)
# GET /graph/call
# GET /graph/module
# ---------------------------------------------------------------------------


def _storage_load_or_404(repo_id: str) -> dict[str, Any]:
    """从 GraphStorage 加载完整图谱，不存在时抛出 404。"""
    try:
        return _graph_storage.load_graph(repo_id)
    except RepoNotFoundError:
        raise HTTPException(status_code=404, detail=f"图谱不存在: {repo_id}")
    except Exception as exc:
        logger.exception("GraphStorage 读取失败: %s", repo_id)
        raise HTTPException(status_code=500, detail=str(exc))


class GraphDataResponse(BaseModel):
    """GET /graph, /graph/call, /graph/module 统一响应体。"""
    repo_id:     str
    node_count:  int
    edge_count:  int
    nodes:       list[dict[str, Any]]
    edges:       list[dict[str, Any]]


@app.get("/graph/data", response_model=GraphDataResponse, tags=["图谱数据"])
def get_graph_data(
    repo_id: str = Query(description="仓库 ID（由 POST /analyze/graph 返回的 graph_id）"),
):
    """
    获取完整 JSON Graph 数据。

    从 GraphStorage 读取 ``graph-storage/<repo_id>/graph.json``，
    返回所有节点和边。

    返回格式：
    ```json
    {
      "repo_id": "my-project",
      "node_count": 42,
      "edge_count": 87,
      "nodes": [{"id": "...", "type": "...", "name": "...", ...}],
      "edges": [{"from": "...", "to": "...", "type": "..."}]
    }
    ```
    """
    graph = _storage_load_or_404(repo_id)
    nodes: list[dict[str, Any]] = graph.get("nodes", [])
    edges: list[dict[str, Any]] = graph.get("edges", [])
    logger.info("GET /graph/data  repo=%s  %d nodes / %d edges", repo_id, len(nodes), len(edges))
    return GraphDataResponse(
        repo_id=repo_id,
        node_count=len(nodes),
        edge_count=len(edges),
        nodes=nodes,
        edges=edges,
    )


@app.get("/graph/call", response_model=GraphDataResponse, tags=["图谱数据"])
def get_graph_call(
    repo_id: str = Query(description="仓库 ID"),
):
    """
    获取函数调用子图（``calls`` 边及相关节点）。

    从 GraphStorage 读取预生成的 ``call-graph.json``（若不存在则实时过滤）。

    只包含：
    - 边类型：``calls``
    - 节点：出现在 ``calls`` 边中的 ``function`` / ``api`` 节点

    返回格式同 ``GET /graph/data``。
    """
    try:
        subgraph = _graph_storage.get_subgraph(repo_id, "calls")
    except RepoNotFoundError:
        raise HTTPException(status_code=404, detail=f"图谱不存在: {repo_id}")
    except Exception as exc:
        logger.exception("get_subgraph(calls) 失败: %s", repo_id)
        raise HTTPException(status_code=500, detail=str(exc))

    nodes: list[dict[str, Any]] = subgraph.get("nodes", [])
    edges: list[dict[str, Any]] = subgraph.get("edges", [])
    logger.info("GET /graph/call  repo=%s  %d nodes / %d edges", repo_id, len(nodes), len(edges))
    return GraphDataResponse(
        repo_id=repo_id,
        node_count=len(nodes),
        edge_count=len(edges),
        nodes=nodes,
        edges=edges,
    )


@app.get("/graph/module", response_model=GraphDataResponse, tags=["图谱数据"])
def get_graph_module(
    repo_id: str  = Query(description="仓库 ID"),
    edge_type: str = Query(
        default="contains",
        description="边类型过滤：``contains``（默认）、``imports`` 或 ``all``（contains + imports）",
    ),
):
    """
    获取模块结构子图（``contains`` / ``imports`` 边及相关节点）。

    从 GraphStorage 读取预生成的 ``module-graph.json``（若不存在则实时过滤）。

    - ``edge_type=contains``（默认）：仅返回包含关系（module → file → class/function）
    - ``edge_type=imports``：仅返回导入关系（module → module）
    - ``edge_type=all``：返回 contains + imports 全部

    返回格式同 ``GET /graph/data``。
    """
    # "all" 等价于读取 module-graph.json（contains + imports 共用同一文件）
    query_type = "contains" if edge_type == "all" else edge_type

    try:
        subgraph = _graph_storage.get_subgraph(repo_id, query_type)
    except RepoNotFoundError:
        raise HTTPException(status_code=404, detail=f"图谱不存在: {repo_id}")
    except Exception as exc:
        logger.exception("get_subgraph(%s) 失败: %s", edge_type, repo_id)
        raise HTTPException(status_code=500, detail=str(exc))

    nodes: list[dict[str, Any]] = subgraph.get("nodes", [])
    edges: list[dict[str, Any]] = subgraph.get("edges", [])

    # edge_type=contains 或 edge_type=imports 时，在内存中二次过滤
    if edge_type in ("contains", "imports"):
        edges = [e for e in edges if e.get("type") == edge_type]
        involved: set[str] = set()
        for e in edges:
            if e.get("from"):
                involved.add(e["from"])
            if e.get("to"):
                involved.add(e["to"])
        nodes = [n for n in nodes if n.get("id") in involved]

    logger.info(
        "GET /graph/module  repo=%s  edge_type=%s  %d nodes / %d edges",
        repo_id, edge_type, len(nodes), len(edges),
    )
    return GraphDataResponse(
        repo_id=repo_id,
        node_count=len(nodes),
        edge_count=len(edges),
        nodes=nodes,
        edges=edges,
    )


# ---------------------------------------------------------------------------
# GET /graph/summary
# ---------------------------------------------------------------------------


@app.get("/graph/summary", tags=["图谱"])
def get_graph_summary(
    graph_id: str = Query(description="图谱 ID"),
):
    """
    获取图谱 LOD-0 摘要（仅 Repository + Module 节点）。

    返回顶层 Repository 和 Module 节点及其之间的边，
    同时附带全图节点/边总数供前端进度条使用。
    """
    built = _load_or_404(graph_id)

    summary_types = {"Repository", "Module"}
    summary_nodes = [n.model_dump() for n in built.nodes if n.type in summary_types]
    summary_node_ids = {n["id"] for n in summary_nodes}
    summary_edges = [
        e.model_dump(by_alias=True)
        for e in built.edges
        if e.from_ in summary_node_ids and e.to in summary_node_ids
    ]

    return {
        "graph_id":         graph_id,
        "nodes":            summary_nodes,
        "edges":            summary_edges,
        "total_node_count": built.node_count,
        "total_edge_count": built.edge_count,
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
    # 兼容新格式（小写）和旧格式（PascalCase）
    call_node_types = {"Function", "API", "function", "api"}
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
    # 兼容新格式（imports 也属于血缘关系）
    _LINEAGE_EDGE_TYPES = {"depends_on", "reads", "writes", "produces", "consumes", "imports"}

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
# GET /events
# ---------------------------------------------------------------------------


@app.get("/events", tags=["图谱"])
def get_events(
    graph_id: str = Query(description="图谱 ID"),
    include_edges: bool = Query(default=True, description="是否返回事件关系边"),
):
    """
    获取事件流图。

    返回 `Event`、`Topic` 节点及其 `publishes`、`routes_to`、`consumes` 关系。
    同时返回相关的 `Component` 节点（Producer/Consumer）。
    """
    _EVENT_NODE_TYPES = {"Event", "Topic"}
    _EVENT_EDGE_TYPES = {"publishes", "routes_to", "consumes", "produces", "subscribes"}

    built = _load_or_404(graph_id)

    # 收集所有事件相关的边
    event_edges = []
    if include_edges:
        event_edges = [
            e.model_dump(by_alias=True)
            for e in built.edges
            if e.type in _EVENT_EDGE_TYPES
        ]

    # 收集所有涉及的节点 ID
    involved_node_ids = set()
    for e in built.edges:
        if e.type in _EVENT_EDGE_TYPES:
            involved_node_ids.add(e.from_)
            involved_node_ids.add(e.to)

    # 收集节点：Event/Topic 节点 + 相关的 Component 节点
    node_map = {n.id: n for n in built.nodes}
    event_nodes = []
    for node_id in involved_node_ids:
        if node_id in node_map:
            node = node_map[node_id]
            # 包含 Event/Topic 节点，以及参与事件流的 Component 节点
            if node.type in _EVENT_NODE_TYPES or node.type == "Component":
                event_nodes.append(node.model_dump())

    # 统计：按 node.type 分组
    type_counts: dict[str, int] = {}
    for n in event_nodes:
        type_counts[n["type"]] = type_counts.get(n["type"], 0) + 1

    return {
        "graph_id":    graph_id,
        "node_count":  len(event_nodes),
        "edge_count":  len(event_edges),
        "type_counts": type_counts,
        "nodes":       event_nodes,
        "edges":       event_edges,
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

    **注意**: 首次查询时，如果向量索引不存在，系统会自动建立索引（可能需要几秒钟）。
    也可以在分析时通过 `POST /analyze/repository?enable_rag=true` 提前建立索引。
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
# DELETE /graph/{graph_id}
# ---------------------------------------------------------------------------


@app.delete("/graph/{graph_id}", tags=["图谱"])
def delete_graph(graph_id: str):
    """
    删除指定图谱。

    删除本地 JSON 文件、索引条目，以及 Neo4j 中的数据（如果已配置）。
    """
    logger.info("DELETE /graph/%s", graph_id)

    # 检查图谱是否存在
    built = _graph_repo.load(graph_id)
    if built is None:
        raise HTTPException(status_code=404, detail=f"图谱不存在: {graph_id}")

    # 删除图谱
    try:
        deleted = _graph_repo.delete(graph_id)
        if not deleted:
            raise HTTPException(status_code=404, detail=f"图谱不存在: {graph_id}")

        logger.info("图谱已删除: %s", graph_id)
        return {
            "success": True,
            "graph_id": graph_id,
            "message": "图谱已成功删除"
        }
    except Exception as e:
        logger.exception("删除图谱失败")
        raise HTTPException(status_code=500, detail=str(e))


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
