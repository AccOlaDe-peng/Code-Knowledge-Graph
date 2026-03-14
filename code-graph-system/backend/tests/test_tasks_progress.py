"""
测试 Celery 任务的 Redis Pub/Sub 进度发布功能。

测试覆盖：
    - publish_progress() 发布到正确的 Redis channel
    - analyze_repository 任务发布初始/进度/完成事件
    - 异常情况下发布失败事件
"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock, Mock, patch

import pytest


@pytest.fixture
def mock_redis():
    """Mock Redis 客户端。"""
    redis_mock = MagicMock()
    redis_mock.from_url.return_value = redis_mock
    redis_mock.ping.return_value = True
    redis_mock.publish.return_value = 1
    return redis_mock


@pytest.fixture
def mock_pipeline():
    """Mock AnalysisPipeline，返回成功结果。"""
    from backend.pipeline.analyze_repository import AnalysisResult
    from backend.graph.graph_builder import BuiltGraph

    mock_result = Mock(spec=AnalysisResult)
    mock_result.graph_id = "test-graph-123"
    mock_result.repo_name = "test-repo"
    mock_result.repo_path = "/test/path"
    mock_result.node_count = 100
    mock_result.edge_count = 200
    mock_result.duration_seconds = 1.5
    mock_result.circular_deps = []
    mock_result.warnings = []

    mock_built = Mock(spec=BuiltGraph)
    mock_built.meta = {
        "node_type_counts": {"Function": 50, "Class": 30},
        "edge_type_counts": {"calls": 100, "contains": 80},
    }
    mock_result.built = mock_built

    return mock_result


def test_publish_progress_publishes_to_correct_channel(mock_redis):
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

    with patch("backend.scheduler.tasks.sync_redis.Redis.from_url", return_value=mock_redis):
        publish_progress(task_id, event)

    # 验证发布到正确的 channel
    expected_channel = f"progress:{task_id}"
    mock_redis.publish.assert_called_once_with(expected_channel, json.dumps(event))
    mock_redis.close.assert_called_once()


def test_publish_progress_handles_redis_failure(mock_redis):
    """测试 Redis 连接失败时不抛出异常。"""
    from backend.scheduler.tasks import publish_progress

    mock_redis.publish.side_effect = Exception("Redis connection failed")

    task_id = "test-task-456"
    event = {"status": "running", "step": 1}

    with patch("backend.scheduler.tasks.sync_redis.Redis.from_url", return_value=mock_redis):
        # 不应抛出异常
        publish_progress(task_id, event)

    mock_redis.close.assert_called_once()


def test_analyze_repository_publishes_initial_event(mock_redis, mock_pipeline):
    """测试 analyze_repository 任务发布初始 pending 事件。"""
    from backend.scheduler.tasks import analyze_repository

    with patch("backend.scheduler.tasks.sync_redis.Redis.from_url", return_value=mock_redis), \
         patch("backend.scheduler.tasks._build_pipeline", return_value=(Mock(analyze=Mock(return_value=mock_pipeline)), Mock())), \
         patch("backend.scheduler.tasks._get_git_head", return_value="abc123"):

        # 使用 apply() 同步调用任务，传入 task_id
        result = analyze_repository.apply(args=["/test/repo"], kwargs={"repo_name": "test"}, task_id="task-789")

        # 验证发布了初始 pending 事件
        calls = mock_redis.publish.call_args_list
        assert len(calls) >= 2  # 至少有 pending 和 completed 事件

        # 检查第一个事件是 pending
        first_call = calls[0]
        channel, message = first_call[0]
        assert channel == "progress:task-789"
        event = json.loads(message)
        assert event["status"] == "pending"
        assert event["step"] == 0
        assert event["total"] == 13


def test_analyze_repository_publishes_progress_events(mock_redis, mock_pipeline):
    """测试 analyze_repository 任务通过 on_progress 回调发布进度事件。"""
    from backend.scheduler.tasks import analyze_repository

    def mock_analyze(*args, **kwargs):
        # 模拟调用 on_progress 回调
        on_progress = kwargs.get("on_progress")
        if on_progress:
            on_progress({"status": "running", "step": 1, "total": 13, "stage": "RepoScanner", "message": "扫描中...", "log": "", "elapsed_seconds": 0.1})
            on_progress({"status": "step_done", "step": 1, "total": 13, "stage": "RepoScanner", "message": "扫描完成", "log": "→ 100 文件", "elapsed_seconds": 0.5})
        return mock_pipeline

    with patch("backend.scheduler.tasks.sync_redis.Redis.from_url", return_value=mock_redis), \
         patch("backend.scheduler.tasks._build_pipeline") as mock_build, \
         patch("backend.scheduler.tasks._get_git_head", return_value="abc123"):

        mock_pipeline_instance = Mock()
        mock_pipeline_instance.analyze = mock_analyze
        mock_build.return_value = (mock_pipeline_instance, Mock())

        # 使用 apply() 同步调用任务
        result = analyze_repository.apply(args=["/test/repo"], kwargs={"repo_name": "test"}, task_id="task-progress-test")

        # 验证发布了进度事件
        calls = mock_redis.publish.call_args_list
        assert len(calls) >= 4  # pending + 2 progress + completed

        # 检查进度事件
        messages = [json.loads(call[0][1]) for call in calls]
        statuses = [msg["status"] for msg in messages]
        assert "pending" in statuses
        assert "running" in statuses
        assert "step_done" in statuses
        assert "completed" in statuses


def test_analyze_repository_publishes_completed_event(mock_redis, mock_pipeline):
    """测试 analyze_repository 任务成功后发布 completed 事件。"""
    from backend.scheduler.tasks import analyze_repository

    with patch("backend.scheduler.tasks.sync_redis.Redis.from_url", return_value=mock_redis), \
         patch("backend.scheduler.tasks._build_pipeline", return_value=(Mock(analyze=Mock(return_value=mock_pipeline)), Mock())), \
         patch("backend.scheduler.tasks._get_git_head", return_value="abc123"):

        # 使用 apply() 同步调用任务
        result = analyze_repository.apply(args=["/test/repo"], kwargs={"repo_name": "test"}, task_id="task-complete-test")

        # 验证返回结果包含必要字段
        task_result = result.get()
        assert task_result["task_id"] == "task-complete-test"
        assert task_result["graph_id"] == "test-graph-123"
        assert task_result["node_count"] == 100
        assert task_result["edge_count"] == 200

        # 验证发布了 completed 事件
        calls = mock_redis.publish.call_args_list
        last_call = calls[-1]
        channel, message = last_call[0]
        event = json.loads(message)
        assert event["status"] == "completed"
        assert event["graph_id"] == "test-graph-123"
        assert event["node_count"] == 100
        assert event["edge_count"] == 200


def test_analyze_repository_publishes_failed_event_on_value_error(mock_redis):
    """测试 analyze_repository 任务遇到 ValueError 时发布 failed 事件。"""
    from backend.scheduler.tasks import analyze_repository

    with patch("backend.scheduler.tasks.sync_redis.Redis.from_url", return_value=mock_redis), \
         patch("backend.scheduler.tasks._build_pipeline") as mock_build:

        mock_pipeline_instance = Mock()
        mock_pipeline_instance.analyze.side_effect = ValueError("仓库路径不存在")
        mock_build.return_value = (mock_pipeline_instance, Mock())

        # 使用 apply() 同步调用任务
        result = analyze_repository.apply(args=["/invalid/path"], kwargs={"repo_name": "test"}, task_id="task-fail-test")

        # 任务应该失败
        with pytest.raises(ValueError):
            result.get()

        # 验证发布了 failed 事件
        calls = mock_redis.publish.call_args_list
        assert len(calls) >= 2  # pending + failed

        last_call = calls[-1]
        channel, message = last_call[0]
        event = json.loads(message)
        assert event["status"] == "failed"
        assert "仓库路径不存在" in event["error"]
