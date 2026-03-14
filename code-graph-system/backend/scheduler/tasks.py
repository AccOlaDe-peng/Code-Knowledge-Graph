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

import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import redis as sync_redis
from celery import Task
from celery.utils.log import get_task_logger

from backend.scheduler.celery_app import celery_app

logger = get_task_logger(__name__)

_REDIS_URL = os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0")


# ---------------------------------------------------------------------------
# 内部辅助
# ---------------------------------------------------------------------------


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
    """
    redis_client = None
    try:
        redis_client = sync_redis.Redis.from_url(_REDIS_URL, decode_responses=True)
        channel = f"progress:{task_id}"
        redis_client.publish(channel, json.dumps(event))
    except Exception as exc:
        logger.warning("Failed to publish progress to Redis: %s", exc)
    finally:
        if redis_client is not None:
            try:
                redis_client.close()
            except Exception:
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
    languages: Optional[list[str]] = None,
    enable_ai: bool = True,
    enable_rag: bool = True,
) -> dict[str, Any]:
    """全量分析代码仓库，构建并持久化知识图谱（默认启用 AI + RAG）。

    Args:
        repo_path:  仓库根目录（本地绝对路径）。
        repo_name:  图谱名称，空字符串时使用目录名。
        languages:  限定语言，如 ``["python", "typescript"]``，None 自动探测。
        enable_ai:  启用 LLM 语义增强（需 ANTHROPIC_API_KEY），默认 True。
        enable_rag: 启用向量化索引（需安装 chromadb），默认 True。

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
        }

    Raises:
        ValueError: 仓库路径不存在，或未找到可分析文件。
    """
    task_id = self.request.id
    path = Path(repo_path).resolve()
    logger.info("analyze_repository START  path=%s  task=%s", path, task_id)

    t_start = time.time()

    # ── 发布初始 pending 事件 ──────────────────────────────────────
    publish_progress(task_id, {
        "status": "pending",
        "step": 0,
        "total": 13,
        "stage": "",
        "message": "任务已排队，等待 Worker...",
        "log": "",
        "elapsed_seconds": 0.0,
    })

    # ── 创建进度回调闭包 ───────────────────────────────────────────
    def on_progress_callback(event: dict) -> None:
        """包装 publish_progress，同时更新 Celery task state。"""
        publish_progress(task_id, event)
        try:
            self.update_state(state="PROGRESS", meta=event)
        except Exception:
            pass

    pipeline, _ = _build_pipeline()
    try:
        result = pipeline.analyze(
            path,
            repo_name=repo_name,
            languages=languages,
            enable_ai=enable_ai,
            enable_rag=enable_rag,
            on_progress=on_progress_callback,
        )
    except ValueError as exc:
        # ValueError（如路径不存在）不重试，直接发送 failed 事件
        duration = round(time.time() - t_start, 3)
        publish_progress(task_id, {
            "status": "failed",
            "error": str(exc),
            "elapsed_seconds": duration,
        })
        logger.error("analyze_repository FAILED (bad input): %s", exc)
        raise
    except Exception as exc:
        # 其他异常会重试：不发送 failed 事件，让前端等待重试结果
        logger.error("analyze_repository FAILED: %s", exc, exc_info=True)
        raise self.retry(exc=exc)

    git_commit = _get_git_head(path)
    built = result.built
    duration = round(time.time() - t_start, 3)

    # ── 发布完成事件 ───────────────────────────────────────────────
    publish_progress(task_id, {
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
    }
    logger.info(
        "analyze_repository DONE  graph=%s  nodes=%d  edges=%d  %.2fs",
        result.graph_id, result.node_count, result.edge_count, duration,
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
    path = Path(repo_path).resolve()
    logger.info(
        "incremental_update START  graph=%s  path=%s  task=%s",
        graph_id, path, self.request.id,
    )

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
    try:
        result = pipeline.analyze(
            path,
            repo_name=repo_name,
            enable_ai=enable_ai,
            enable_rag=enable_rag,
        )
    except ValueError as exc:
        logger.error("_run_full_and_wrap FAILED (bad input): %s", exc)
        raise
    except Exception as exc:
        logger.error("_run_full_and_wrap FAILED: %s", exc, exc_info=True)
        raise task.retry(exc=exc)

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
