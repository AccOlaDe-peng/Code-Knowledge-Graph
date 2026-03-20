"""
Celery 异步任务定义。

任务：
    analyze_repository   — 全量分析代码仓库，构建知识图谱
    incremental_update   — 增量更新：检测 Git 变更后按需重新分析

典型用法::

    # 异步提交
    from backend.scheduler.tasks import analyze_repository, incremental_update

    job = analyze_repository.delay("/path/to/repo", repo_name="my-svc")
    print(job.id)           # Celery task ID
    print(job.get())        # 阻塞等待结果

    # 增量更新（传入已有 graph_id）
    job = incremental_update.delay("my-svc", "/path/to/repo")
    result = job.get()
    print(result["updated"], result["graph_id"])

返回值格式见各任务 docstring。
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import redis as sync_redis
from celery import Task
from celery.result import AsyncResult
from celery.utils.log import get_task_logger

from backend.scheduler.celery_app import celery_app
from backend.store.repo_status_store import get_repo_status_store
from backend.agent.orchestrator import PartialResultError

logger = get_task_logger(__name__)

_REDIS_URL = os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0")
_redis_pool = None


# ---------------------------------------------------------------------------
# Git 缓存辅助
# ---------------------------------------------------------------------------

# 持久化 git 克隆缓存目录
_GIT_CACHE_BASE = Path(__file__).parent.parent.parent / "data" / "git_cache"


def _is_git_url(path: str) -> bool:
    """判断是否为 Git 远程 URL。"""
    return (
        path.startswith("git@")
        or path.startswith("https://")
        or path.startswith("http://")
        or path.startswith("ssh://")
    )


def _git_cache_key(git_url: str, branch: Optional[str]) -> str:
    """根据 git URL + branch 生成唯一缓存目录名。"""
    raw = f"{git_url}#{branch or 'default'}"
    return hashlib.md5(raw.encode()).hexdigest()[:16]


def _get_cached_repo_path(git_url: str, branch: Optional[str]) -> Path:
    """返回对应 git URL + branch 的本地缓存路径（不保证已存在）。"""
    key = _git_cache_key(git_url, branch)
    return _GIT_CACHE_BASE / key


def _is_valid_git_repo(path: Path, expected_url: str) -> bool:
    """检查本地目录是否为有效的 git 仓库且 remote URL 匹配。"""
    if not path.exists() or not (path / ".git").exists():
        return False
    try:
        result = subprocess.run(
            ["git", "-C", str(path), "remote", "get-url", "origin"],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode != 0:
            return False
        actual_url = result.stdout.strip()
        return actual_url == expected_url
    except Exception:
        return False


def _ensure_local_repo(
    git_url: str,
    branch: Optional[str],
    on_progress: Optional[Any] = None,
) -> Path:
    """确保 git 仓库已克隆到本地缓存目录，返回本地路径。

    - 若缓存已存在且 remote URL 匹配，直接复用，跳过克隆。
    - 若缓存不存在或损坏，重新克隆。
    """
    _GIT_CACHE_BASE.mkdir(parents=True, exist_ok=True)
    cache_path = _get_cached_repo_path(git_url, branch)

    if _is_valid_git_repo(cache_path, git_url):
        logger.info("使用本地缓存仓库（跳过克隆）: %s -> %s", git_url, cache_path)
        if on_progress:
            on_progress({
                "status": "running",
                "step": "git_clone",
                "stage": "git_clone",
                "message": f"本地缓存已存在，跳过克隆: {cache_path.name}",
            })
        return cache_path

    # 缓存不存在或损坏，重新克隆
    if cache_path.exists():
        logger.warning("缓存目录损坏，清理后重新克隆: %s", cache_path)
        shutil.rmtree(cache_path, ignore_errors=True)

    if on_progress:
        on_progress({
            "status": "running",
            "step": "git_clone",
            "stage": "git_clone",
            "message": f"正在克隆仓库: {git_url}" + (f" (分支: {branch})" if branch else ""),
        })

    cmd = ["git", "clone", "--depth=1"]
    if branch:
        cmd += ["--branch", branch]
    cmd += [git_url, str(cache_path)]
    logger.info("git clone: %s", " ".join(cmd))

    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=600)
    except subprocess.CalledProcessError as e:
        shutil.rmtree(cache_path, ignore_errors=True)
        raise ValueError(f"Git 克隆失败: {e.stderr.strip()}")
    except subprocess.TimeoutExpired:
        shutil.rmtree(cache_path, ignore_errors=True)
        raise ValueError("Git 克隆超时（>10分钟）")

    logger.info("克隆完成: %s", cache_path)
    return cache_path


# ---------------------------------------------------------------------------
# 内部辅助
# ---------------------------------------------------------------------------


def _get_redis_pool():
    """获取或创建 Redis 连接池（Worker 进程内复用）。"""
    global _redis_pool
    if _redis_pool is None:
        _redis_pool = sync_redis.ConnectionPool.from_url(
            _REDIS_URL, decode_responses=True, socket_connect_timeout=3
        )
    return _redis_pool


def _get_git_head(repo_path: Path) -> Optional[str]:
    """返回仓库当前 HEAD commit SHA；非 Git 仓库或 GitPython 缺失时返回 None。"""
    try:
        import git
        repo = git.Repo(str(repo_path), search_parent_directories=True)
        return repo.head.commit.hexsha
    except Exception:
        return None


def _get_git_commits_since(repo_path: Path, since_iso: str) -> int:
    """返回自 `since_iso`（ISO 8601）以来的新 commit 数量。非 Git 仓库返回 -1。"""
    try:
        import git
        repo = git.Repo(str(repo_path), search_parent_directories=True)
        since_dt = datetime.fromisoformat(since_iso).replace(tzinfo=timezone.utc)
        count = sum(
            1 for c in repo.iter_commits()
            if datetime.fromtimestamp(c.committed_date, tz=timezone.utc) > since_dt
        )
        return count
    except Exception:
        return -1


def _build_pipeline():
    """按需创建 AnalysisPipeline 实例（Worker 进程内复用开销较大的组件）。"""
    from backend.graph.graph_repository import GraphRepository
    from backend.pipeline.analyze_repository import AnalysisPipeline
    from backend.rag.vector_store import VectorStore

    repo   = GraphRepository()
    store  = VectorStore()
    return AnalysisPipeline(repo, store), repo


def publish_progress(task_id: str, event: dict) -> None:
    """发布进度事件到 Redis Pub/Sub channel。

    Args:
        task_id: Celery 任务 ID
        event: 进度事件字典，包含 status, step, total, stage, message, log, elapsed_seconds 等字段

    Note:
        Redis 连接失败时只记录警告，不抛出异常，确保任务继续执行。
        使用连接池避免每次事件创建新连接。
    """
    try:
        client = sync_redis.Redis(connection_pool=_get_redis_pool())
        client.publish(f"progress:{task_id}", json.dumps(event, default=str))
    except Exception as exc:
        logger.warning("Failed to publish progress to Redis: %s", exc)


def _stage_to_step(stage: str) -> int:
    """将阶段名称转换为步骤编号。"""
    stage_map = {
        "pending": 0,
        "scanner": 1,
        "module_scanner": 2,
        "code_analyzer": 3,
        "graph_builder": 4,
        "repository": 5,
        "rag": 6,
        "completed": 6,
    }
    return stage_map.get(stage, 0)


class TaskCanceledError(Exception):
    """任务被取消时抛出的异常。"""
    pass


def _check_cancelled(task: Task, task_id: str) -> None:
    """检查任务是否已被取消，如果已取消则抛出 TaskCanceledError。"""
    from celery.exceptions import TaskRevokedError
    try:
        # 检查任务是否被撤销
        if task.request.stopped():
            raise TaskCanceledError(f"Task {task_id} has been revoked")
        # 也可以通过 AsyncResult 检查状态
        result = AsyncResult(task_id, app=celery_app)
        if result.state in ("REVOKED",):
            raise TaskCanceledError(f"Task {task_id} has been revoked")
    except TaskCanceledError:
        raise
    except Exception:
        # 其他错误（如 Redis 连接问题）忽略，继续执行
        pass


# ---------------------------------------------------------------------------
# Task 1: analyze_repository
# ---------------------------------------------------------------------------


@celery_app.task(
    name="tasks.analyze_repository",
    bind=True,
    max_retries=3,
    default_retry_delay=60,
)
def analyze_repository(
    self: Task,
    repo_path: str,
    *,
    repo_name: str = "",
    branch: Optional[str] = None,
    languages: Optional[list[str]] = None,
    tmp_dir: Optional[str] = None,
    depth: str = "standard",
) -> dict[str, Any]:
    """全量分析代码仓库，构建并持久化知识图谱（默认启用 AI + RAG）。

    Args:
        repo_path:  仓库根目录（本地绝对路径）或 Git 远程 URL（https/ssh）。
        repo_name:  图谱名称，空字符串时使用目录名。
        branch:     Git 分支名（仅当 repo_path 为 Git URL 时生效）。
        languages:  限定语言，如 ``["python", "typescript"]``，None 自动探测。
        tmp_dir:    已废弃，保留仅用于向后兼容，不再使用。
        depth:      分析深度 (quick | standard | deep)，默认 standard。

    Returns::

        {
            "task_id":          "<celery task id>",
            "graph_id":         "<graph id>",
            "repo_name":        "my-service",
            "repo_path":        "/abs/path/to/repo",
            "node_count":       128,
            "edge_count":       214,
            "duration_seconds": 3.14,
            "node_types":       {"Function": 80, "Class": 30, ...},
            "edge_types":       {"calls": 100, "contains": 80, ...},
            "circular_deps":    0,
            "git_commit":       "<sha or null>",
            "warnings":         [...],
            "analyzed_at":      "2026-03-11T12:00:00+00:00",
            "depth":            "standard",
        }

    Raises:
        ValueError: 仓库路径不存在，或未找到可分析文件。
    """
    task_id = self.request.id

    # 验证 depth 参数
    valid_depths = ("quick", "standard", "deep")
    if depth not in valid_depths:
        raise ValueError(f"Invalid depth: {depth}. Must be one of: {', '.join(valid_depths)}")

    logger.info("analyze_repository START  repo=%s  task=%s  depth=%s", repo_path, task_id, depth)

    t_start = time.time()
    status_store = get_repo_status_store()

    # ── 使用 repo_name 或路径名作为 repo_id（提前确定，供进度回调使用）─────
    _initial_repo_id = repo_name or Path(repo_path).name.split("?")[0]

    # ── 如果是 Git URL，在任务内部处理克隆/缓存 ──────────────────────────
    if _is_git_url(repo_path):
        git_url = repo_path

        # 定义早期进度发布（status_store 此时还未 set_analyzing）
        def _early_progress(event: dict) -> None:
            publish_progress(task_id, event)
            try:
                self.update_state(state="PROGRESS", meta=event)
            except Exception:
                pass

        _early_progress({
            "status": "running",
            "step": "git_clone",
            "stage": "git_clone",
            "message": f"准备克隆仓库: {git_url}" + (f" (分支: {branch})" if branch else ""),
        })

        try:
            local_path = _ensure_local_repo(git_url, branch, on_progress=_early_progress)
        except ValueError as exc:
            _early_progress({
                "status": "failed",
                "error": str(exc),
                "elapsed_seconds": round(time.time() - t_start, 3),
            })
            status_store.set_failed(_initial_repo_id, error=str(exc))
            logger.error("analyze_repository FAILED (git clone): %s", exc)
            raise

        path = local_path.resolve()
    else:
        path = Path(repo_path).resolve()

    # 创建分析配置
    from backend.agent.config import AnalysisConfig
    config = AnalysisConfig.from_preset(depth)
    logger.info("分析配置: max_modules=%s, agents=%s", config.max_modules, config.agents)

    # 使用 repo_name 或路径名作为 repo_id
    repo_id = repo_name or path.name
    _initial_repo_id = repo_id  # 覆盖前置定义，确保一致

    # ── 标记为分析中 ──────────────────────────────────────────────
    status_store.set_analyzing(
        repo_id,
        task_id=task_id,
        repo_name=repo_name or path.name,
        repo_path=str(path),
    )

    # ── 创建进度回调闭包 ───────────────────────────────────────────
    def on_progress_callback(event: dict) -> None:
        """包装 publish_progress，同时更新 Celery task state 和状态存储。"""
        # 检查任务是否被取消
        _check_cancelled(self, task_id)

        publish_progress(task_id, event)
        try:
            self.update_state(state="PROGRESS", meta=event)
        except Exception as exc:
            logger.debug("Failed to update Celery state: %s", exc)

        # 更新状态存储
        status_store.update_progress(
            repo_id,
            stage=event.get("step", ""),
            step=_stage_to_step(event.get("step", "")),
            total=6,
            message=event.get("message", ""),
        )

    # ── 发布初始 pending 事件 ──────────────────────────────────────
    on_progress_callback({
        "status": "pending",
        "step": "pending",
        "stage": "pending",
        "message": "任务已排队，等待 Worker...",
    })

    pipeline, _ = _build_pipeline()
    try:
        result = pipeline.analyze(
            path,
            repo_name=repo_name,
            languages=languages,
            enable_ai=True,
            enable_rag=True,
            on_progress=on_progress_callback,
        )
    except TaskCanceledError as exc:
        # 任务被取消，不重试
        duration = round(time.time() - t_start, 3)
        try:
            on_progress_callback({
                "status": "canceled",
                "message": "任务已被取消",
                "elapsed_seconds": duration,
            })
        except Exception:
            pass
        status_store.set_canceled(repo_id)
        logger.info("analyze_repository CANCELED: %s", exc)
        return {"task_id": task_id, "status": "canceled", "message": str(exc)}
    except ValueError as exc:
        # ValueError（如路径不存在）不重试，直接发送 failed 事件
        duration = round(time.time() - t_start, 3)
        on_progress_callback({
            "status": "failed",
            "error": str(exc),
            "elapsed_seconds": duration,
        })
        status_store.set_failed(repo_id, error=str(exc))
        # ── 写入 AnalysisStore 历史记录（失败） ───────────────────────
        from backend.store.analysis_store import get_analysis_store
        _analysis_store = get_analysis_store()
        _analysis_store.write_completed(
            task_id=task_id,
            repo_id=repo_id,
            depth=depth or "standard",
            status="failed",
            error=str(exc),
            started_at=datetime.fromtimestamp(t_start, tz=timezone.utc).isoformat(),
            finished_at=datetime.now(timezone.utc).isoformat(),
        )
        logger.error("analyze_repository FAILED (bad input): %s", exc)
        raise
    except PartialResultError as exc:
        # 部分结果：保存了部分图谱，发送 completed_partial 事件
        duration = round(time.time() - t_start, 3)
        result = exc.result
        if result is None:
            logger.error("PartialResultError 未携带 result，无法保存部分图谱")
            raise

        # 更新图谱 meta 标记为 partial
        from backend.graph.graph_repository import GraphRepository
        graph_repo = GraphRepository()
        built = graph_repo.load(result.graph_id)
        if built is not None:
            built.meta["analysis_status"] = "partial"
            built.meta["completed_modules"] = exc.completed_count
            built.meta["total_modules"] = exc.total_count
            graph_repo.save(built, repo_name=repo_name)

        on_progress_callback({
            "status": "completed_partial",
            "graph_id": result.graph_id,
            "node_count": result.node_count,
            "edge_count": result.edge_count,
            "completed_modules": exc.completed_count,
            "total_modules": exc.total_count,
            "elapsed_seconds": duration,
            "message": f"已完成 {exc.completed_count}/{exc.total_count} 个模块，因 API 持续限速保存部分结果",
        })
        status_store.set_completed(
            repo_id,
            graph_id=result.graph_id,
            node_count=result.node_count,
            edge_count=result.edge_count,
            duration_seconds=duration,
        )
        # ── 写入 AnalysisStore 历史记录（部分完成） ───────────────────────
        from backend.store.analysis_store import get_analysis_store
        _analysis_store = get_analysis_store()
        _analysis_store.write_completed(
            task_id=task_id,
            repo_id=repo_id,
            depth=depth or "standard",
            status="completed_partial",
            graph_id=result.graph_id,
            node_count=result.node_count,
            edge_count=result.edge_count,
            started_at=datetime.fromtimestamp(t_start, tz=timezone.utc).isoformat(),
            finished_at=datetime.now(timezone.utc).isoformat(),
        )
        logger.warning(
            "analyze_repository PARTIAL: graph=%s nodes=%d edges=%d completed=%d/%d",
            result.graph_id, result.node_count, result.edge_count,
            exc.completed_count, exc.total_count,
        )
        return {
            "task_id": task_id,
            "status": "completed_partial",
            "graph_id": result.graph_id,
            "node_count": result.node_count,
            "edge_count": result.edge_count,
            "completed_modules": exc.completed_count,
            "total_modules": exc.total_count,
        }
    except Exception as exc:
        # 其他异常会重试：不发送 failed 事件，让前端等待重试结果
        logger.error("analyze_repository FAILED: %s", exc, exc_info=True)
        raise self.retry(exc=exc)
    finally:
        # 清理 Git 克隆的临时目录
        if tmp_dir and Path(tmp_dir).exists():
            import shutil
            try:
                shutil.rmtree(tmp_dir, ignore_errors=True)
                logger.info("Cleaned up tmp_dir: %s", tmp_dir)
            except Exception as exc:
                logger.warning("Failed to cleanup tmp_dir %s: %s", tmp_dir, exc)

    git_commit = _get_git_head(path)
    built = result.built
    duration = round(time.time() - t_start, 3)

    # ── 标记为完成 ───────────────────────────────────────────────
    status_store.set_completed(
        repo_id,
        graph_id=result.graph_id,
        node_count=result.node_count,
        edge_count=result.edge_count,
        duration_seconds=duration,
    )

    # ── 写入 AnalysisStore 历史记录 ───────────────────────────────────────
    from backend.store.analysis_store import get_analysis_store
    _analysis_store = get_analysis_store()
    _analysis_store.write_completed(
        task_id=task_id,
        repo_id=repo_id,
        depth=depth or "standard",
        status="completed",
        graph_id=result.graph_id,
        node_count=result.node_count,
        edge_count=result.edge_count,
        started_at=datetime.fromtimestamp(t_start, tz=timezone.utc).isoformat(),
        finished_at=datetime.now(timezone.utc).isoformat(),
    )

    # ── 发布完成事件 ───────────────────────────────────────────────
    on_progress_callback({
        "status": "completed",
        "graph_id": result.graph_id,
        "node_count": result.node_count,
        "edge_count": result.edge_count,
        "elapsed_seconds": duration,
    })

    payload: dict[str, Any] = {
        "task_id":          task_id,
        "graph_id":         result.graph_id,
        "repo_name":        result.repo_name,
        "repo_path":        result.repo_path,
        "node_count":       result.node_count,
        "edge_count":       result.edge_count,
        "duration_seconds": duration,
        "node_types":       built.meta.get("node_type_counts", {}),
        "edge_types":       built.meta.get("edge_type_counts", {}),
        "circular_deps":    len(result.circular_deps),
        "git_commit":       git_commit,
        "warnings":         result.warnings,
        "analyzed_at":      datetime.now(timezone.utc).isoformat(),
        "depth":            depth,
    }
    logger.info(
        "analyze_repository DONE  graph=%s  nodes=%d  edges=%d  %.2fs  depth=%s",
        result.graph_id, result.node_count, result.edge_count, duration, depth,
    )
    return payload


# ---------------------------------------------------------------------------
# Task 2: incremental_update
# ---------------------------------------------------------------------------


@celery_app.task(
    name="tasks.incremental_update",
    bind=True,
    max_retries=3,
    default_retry_delay=60,
)
def incremental_update(
    self: Task,
    graph_id: str,
    repo_path: str,
    *,
    repo_name: str = "",
    enable_ai: bool = False,
    enable_rag: bool = False,
) -> dict[str, Any]:
    """增量更新：检测 Git 变更后按需重新分析仓库。

    变更检测策略（按优先级）：
        1. Git 仓库 + 已记录 SHA：对比 HEAD commit SHA，相同则跳过。
        2. Git 仓库 + 无记录 SHA：对比 created_at 之后的 commit 数量。
        3. 非 Git 仓库：对比目录 mtime 与 created_at 时间戳。
        4. 图谱不存在：退化为全量分析（等同于 analyze_repository）。

    Args:
        graph_id:   上次分析生成的图谱 ID。
        repo_path:  仓库根目录（本地绝对路径）。
        repo_name:  图谱名称（空字符串则沿用 graph_id）。
        enable_ai:  启用 LLM 语义增强。
        enable_rag: 启用向量化索引。

    Returns::

        {
            "task_id":          "<celery task id>",
            "graph_id":         "<new or same graph id>",
            "updated":          true,
            "reason":           "git_sha_changed | git_commits_found | mtime_changed | no_prior_graph | no_change",
            "new_commits":      3,             # -1 = 非 Git 仓库
            "node_count":       128,
            "edge_count":       214,
            "duration_seconds": 3.14,          # updated=false 时为 0
            "git_commit":       "<sha or null>",
            "analyzed_at":      "2026-03-11T12:00:00+00:00",
        }
    """
    task_id = self.request.id
    path = Path(repo_path).resolve()
    logger.info(
        "incremental_update START  graph=%s  path=%s  task=%s",
        graph_id, path, task_id,
    )

    # 检查任务是否被取消
    _check_cancelled(self, task_id)

    pipeline, graph_repo = _build_pipeline()

    # ── 加载旧图谱元数据 ───────────────────────────────────────────────
    prior = graph_repo.load(graph_id)
    if prior is None:
        logger.info("incremental_update: 图谱 %s 不存在，执行全量分析", graph_id)
        return _run_full_and_wrap(
            self, pipeline, graph_repo, path,
            repo_name=repo_name or graph_id,
            reason="no_prior_graph",
            new_commits=-1,
            enable_ai=enable_ai,
            enable_rag=enable_rag,
        )

    # 检测上次分析是否不完整（partial 状态）
    if prior.meta.get("analysis_status") == "partial":
        completed = prior.meta.get("completed_modules", "?")
        total = prior.meta.get("total_modules", "?")
        logger.info(
            "incremental_update: 上次分析不完整 (%s/%s 模块)，强制重新分析",
            completed, total
        )
        return _run_full_and_wrap(
            self, pipeline, graph_repo, path,
            repo_name=repo_name or graph_id,
            reason="incomplete_prior_analysis",
            new_commits=-1,
            enable_ai=enable_ai,
            enable_rag=enable_rag,
        )

    prior_created_at: str = prior.meta.get("created_at", "")
    prior_sha:        Optional[str] = prior.meta.get("git_commit")
    current_sha = _get_git_head(path)

    # ── 变更检测 ──────────────────────────────────────────────────────

    # 策略 1：SHA 对比（最精确）
    if current_sha and prior_sha:
        if current_sha == prior_sha:
            logger.info(
                "incremental_update: SHA 未变更 (%s)，跳过", current_sha[:8]
            )
            return _no_change_response(self, graph_id, prior, current_sha)

        new_commits = _get_git_commits_since(path, prior_created_at) if prior_created_at else -1
        logger.info(
            "incremental_update: SHA %s→%s，新 commit=%d，重新分析",
            prior_sha[:8], current_sha[:8], new_commits,
        )
        reason = "git_sha_changed"

    # 策略 2：Git 仓库但无记录 SHA，通过 commit 数量判断
    elif current_sha and prior_created_at:
        new_commits = _get_git_commits_since(path, prior_created_at)
        if new_commits == 0:
            logger.info("incremental_update: 无新 commit（自 %s），跳过", prior_created_at)
            return _no_change_response(self, graph_id, prior, current_sha)
        logger.info(
            "incremental_update: 发现 %d 个新 commit，重新分析", new_commits
        )
        reason = "git_commits_found"

    # 策略 3：非 Git 仓库，通过 mtime 判断
    else:
        new_commits = -1
        if prior_created_at:
            try:
                prior_ts  = datetime.fromisoformat(prior_created_at).timestamp()
                dir_mtime = path.stat().st_mtime
                if dir_mtime <= prior_ts:
                    logger.info(
                        "incremental_update: 目录 mtime 未变更（上次: %s），跳过",
                        prior_created_at,
                    )
                    return _no_change_response(self, graph_id, prior, None)
            except Exception:
                pass
        reason = "mtime_changed"
        logger.info("incremental_update: 检测到目录变更，重新分析")

    # ── 执行重新分析 ──────────────────────────────────────────────────
    return _run_full_and_wrap(
        self, pipeline, graph_repo, path,
        repo_name=repo_name or graph_id,
        reason=reason,
        new_commits=new_commits,
        enable_ai=enable_ai,
        enable_rag=enable_rag,
    )


# ---------------------------------------------------------------------------
# 内部辅助：统一响应构造
# ---------------------------------------------------------------------------


def _no_change_response(
    task: Task,
    graph_id: str,
    prior,
    git_commit: Optional[str],
) -> dict[str, Any]:
    """构造"无变更，跳过分析"的响应字典。"""
    return {
        "task_id":          task.request.id,
        "graph_id":         graph_id,
        "updated":          False,
        "reason":           "no_change",
        "new_commits":      0,
        "node_count":       prior.node_count,
        "edge_count":       prior.edge_count,
        "duration_seconds": 0.0,
        "git_commit":       git_commit,
        "analyzed_at":      datetime.now(timezone.utc).isoformat(),
    }


def _run_full_and_wrap(
    task: Task,
    pipeline,
    graph_repo,
    path: Path,
    *,
    repo_name: str,
    reason: str,
    new_commits: int,
    enable_ai: bool,
    enable_rag: bool,
) -> dict[str, Any]:
    """运行 AnalysisPipeline 并返回统一格式的结果字典。"""
    # 检查任务是否被取消
    _check_cancelled(task, task.request.id)

    try:
        result = pipeline.analyze(
            path,
            repo_name=repo_name,
            enable_ai=enable_ai,
            enable_rag=enable_rag,
        )
    except TaskCanceledError as exc:
        logger.info("_run_full_and_wrap CANCELED: %s", exc)
        raise
    except ValueError as exc:
        logger.error("_run_full_and_wrap FAILED (bad input): %s", exc)
        raise
    except Exception as exc:
        logger.error("_run_full_and_wrap FAILED: %s", exc, exc_info=True)
        raise task.retry(exc=exc)

    # 再次检查是否被取消
    _check_cancelled(task, task.request.id)

    git_commit = _get_git_head(path)

    # 将当前 SHA 写入图谱 meta，供下次 incremental_update 对比
    if git_commit:
        built = graph_repo.load(result.graph_id)
        if built is not None:
            built.meta["git_commit"] = git_commit
            graph_repo.save(built, repo_name=repo_name)

    logger.info(
        "_run_full_and_wrap DONE  graph=%s  nodes=%d  edges=%d  %.2fs",
        result.graph_id, result.node_count, result.edge_count, result.duration_seconds,
    )
    return {
        "task_id":          task.request.id,
        "graph_id":         result.graph_id,
        "updated":          True,
        "reason":           reason,
        "new_commits":      new_commits,
        "node_count":       result.node_count,
        "edge_count":       result.edge_count,
        "duration_seconds": result.duration_seconds,
        "git_commit":       git_commit,
        "analyzed_at":      datetime.now(timezone.utc).isoformat(),
    }
