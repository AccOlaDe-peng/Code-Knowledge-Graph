"""
Celery 应用实例。

从环境变量读取 Redis 连接配置：

    CELERY_BROKER_URL     — 消息代理（默认 redis://localhost:6379/0）
    CELERY_RESULT_BACKEND — 结果存储（默认 redis://localhost:6379/1）

典型启动命令（在 code-graph-system/ 目录下）：

    # 启动 Worker
    celery -A backend.scheduler.celery_app worker --loglevel=info

    # 启动 Beat（定时任务）
    celery -A backend.scheduler.celery_app beat --loglevel=info

    # 同时启动 Worker + Beat（开发用）
    celery -A backend.scheduler.celery_app worker --beat --loglevel=info
"""

from __future__ import annotations

import os

from celery import Celery

# ---------------------------------------------------------------------------
# 连接配置
# ---------------------------------------------------------------------------

_BROKER  = os.getenv("CELERY_BROKER_URL",     "redis://localhost:6379/0")
_BACKEND = os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/1")

# ---------------------------------------------------------------------------
# Celery App
# ---------------------------------------------------------------------------

celery_app = Celery(
    "code_graph",
    broker=_BROKER,
    backend=_BACKEND,
    include=["backend.scheduler.tasks"],
)

celery_app.conf.update(
    # 序列化
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],

    # 时区
    timezone="Asia/Shanghai",
    enable_utc=True,

    # 结果保留 7 天
    result_expires=60 * 60 * 24 * 7,

    # Worker 并发：单进程内按序执行（避免分析任务相互竞争内存）
    worker_prefetch_multiplier=1,
    task_acks_late=True,

    # 重试策略：最多 3 次，退避 60 秒
    task_max_retries=3,
    task_default_retry_delay=60,

    # Beat 定时任务表（可在此处追加定时触发规则）
    beat_schedule={},
)
