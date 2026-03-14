"""
测试 Celery 任务的 Redis Pub/Sub 进度发布功能。

测试覆盖：
    - publish_progress() 发布到正确的 Redis channel
    - publish_progress() 使用 json.dumps(default=str) 处理非序列化对象
    - publish_progress() 使用连接池避免重复创建连接
    - 异常情况下的容错处理
"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock, Mock, patch

import pytest


def test_publish_progress_publishes_to_correct_channel():
    """测试 publish_progress 发布到正确的 Redis channel。"""
    from backend.scheduler.tasks import publish_progress

    task_id = "test-task-123"
    event = {
        "status": "running",
        "step": 1,
        "total": 13,
        "stage": "RepoScanner",
        "message": "扫描代码文件...",
        "log": "",
        "elapsed_seconds": 0.1,
    }

    mock_redis_client = MagicMock()
    mock_pool = MagicMock()

    with patch("backend.scheduler.tasks._get_redis_pool", return_value=mock_pool), \
         patch("backend.scheduler.tasks.sync_redis.Redis", return_value=mock_redis_client):
        publish_progress(task_id, event)

    # 验证发布到正确的 channel
    expected_channel = f"progress:{task_id}"
    mock_redis_client.publish.assert_called_once_with(expected_channel, json.dumps(event, default=str))


def test_publish_progress_handles_redis_failure():
    """测试 Redis 连接失败时不抛出异常。"""
    from backend.scheduler.tasks import publish_progress

    task_id = "test-task-456"
    event = {"status": "running", "step": 1}

    mock_redis_client = MagicMock()
    mock_redis_client.publish.side_effect = Exception("Redis connection failed")
    mock_pool = MagicMock()

    with patch("backend.scheduler.tasks._get_redis_pool", return_value=mock_pool), \
         patch("backend.scheduler.tasks.sync_redis.Redis", return_value=mock_redis_client):
        # 不应抛出异常
        publish_progress(task_id, event)


def test_publish_progress_uses_connection_pool():
    """测试 publish_progress 使用连接池而不是每次创建新连接。"""
    from backend.scheduler.tasks import publish_progress

    task_id = "test-task-789"
    event1 = {"status": "running", "step": 1}
    event2 = {"status": "step_done", "step": 1}

    mock_redis_client = MagicMock()
    mock_pool = MagicMock()
    mock_get_pool = Mock(return_value=mock_pool)

    with patch("backend.scheduler.tasks._get_redis_pool", mock_get_pool), \
         patch("backend.scheduler.tasks.sync_redis.Redis", return_value=mock_redis_client):
        publish_progress(task_id, event1)
        publish_progress(task_id, event2)

    # 验证连接池被复用（只调用一次 _get_redis_pool）
    assert mock_get_pool.call_count == 2
    # 验证两次都使用同一个连接池创建客户端
    assert mock_redis_client.publish.call_count == 2


def test_publish_progress_serializes_non_json_types():
    """测试 publish_progress 使用 default=str 处理非 JSON 序列化类型。"""
    from backend.scheduler.tasks import publish_progress
    from datetime import datetime
    from pathlib import Path

    task_id = "test-task-serialization"
    event = {
        "status": "running",
        "step": 1,
        "path": Path("/test/path"),  # Path 对象
        "timestamp": datetime(2026, 3, 14, 12, 0, 0),  # datetime 对象
    }

    mock_redis_client = MagicMock()
    mock_pool = MagicMock()

    with patch("backend.scheduler.tasks._get_redis_pool", return_value=mock_pool), \
         patch("backend.scheduler.tasks.sync_redis.Redis", return_value=mock_redis_client):
        # 不应抛出 TypeError
        publish_progress(task_id, event)

    # 验证调用了 publish，且消息可以被序列化
    assert mock_redis_client.publish.called
    call_args = mock_redis_client.publish.call_args[0]
    channel, message = call_args
    # 验证消息是有效的 JSON 字符串
    parsed = json.loads(message)
    assert parsed["status"] == "running"
    assert "test" in parsed["path"] and "path" in parsed["path"]  # Path 被转换为字符串（兼容 Windows/Unix）
    assert "2026" in parsed["timestamp"]  # datetime 被转换为字符串


def test_redis_pool_is_reused_across_calls():
    """测试 Redis 连接池在多次调用间被复用。"""
    from backend.scheduler.tasks import _get_redis_pool

    # 重置全局连接池
    import backend.scheduler.tasks as tasks_module
    tasks_module._redis_pool = None

    with patch("backend.scheduler.tasks.sync_redis.ConnectionPool.from_url") as mock_from_url:
        mock_pool1 = MagicMock()
        mock_from_url.return_value = mock_pool1

        pool1 = _get_redis_pool()
        pool2 = _get_redis_pool()

        # 验证只创建了一次连接池
        assert mock_from_url.call_count == 1
        # 验证返回的是同一个连接池实例
        assert pool1 is pool2
        assert pool1 is mock_pool1

    # 清理
    tasks_module._redis_pool = None
