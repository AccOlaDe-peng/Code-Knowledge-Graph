"""AgentOrchestrator 断点续跑 + 限速暂停 + 心跳等待 测试套件。"""

import pytest
from unittest.mock import MagicMock, patch
from backend.agent.orchestrator import AgentOrchestrator, PartialResultError
from backend.llm.client import RateLimitExhaustedError


def _make_orchestrator():
    """创建最小化的 orchestrator，所有依赖都 mock 掉。"""
    orchestrator = AgentOrchestrator.__new__(AgentOrchestrator)
    orchestrator.checkpoint_manager = MagicMock()
    orchestrator.checkpoint_manager.list_pending_modules.return_value = []
    orchestrator.checkpoint_manager.list_completed_modules.return_value = []
    orchestrator.checkpoint_manager.clear.return_value = None
    orchestrator._emit_progress = MagicMock()
    # config mock — max_modules=None 表示不限制
    config_mock = MagicMock()
    config_mock.max_modules = None
    orchestrator.config = config_mock
    # context_monitor mock（_reset_context_monitor 用到）
    orchestrator.context_monitor = MagicMock()
    return orchestrator


class TestCheckpointResume:
    def test_skips_completed_modules(self):
        """已完成的模块应被跳过，不调用 _run_agent_for_module。"""
        orchestrator = _make_orchestrator()
        modules = [{"id": "mod_a"}, {"id": "mod_b"}, {"id": "mod_c"}]
        # mod_a 已完成，只有 mod_b, mod_c 待处理
        orchestrator.checkpoint_manager.list_pending_modules.return_value = ["mod_b", "mod_c"]

        mock_output = MagicMock()
        mock_output.nodes = []
        mock_output.edges = []
        mock_output.status = "success"

        with patch.object(orchestrator, '_run_agent_for_module', return_value=mock_output) as mock_run:
            orchestrator.run_module_analysis(modules)

        called_modules = [call.args[0] for call in mock_run.call_args_list]
        called_ids = [m.get("id") for m in called_modules]
        assert "mod_a" not in called_ids
        assert "mod_b" in called_ids
        assert "mod_c" in called_ids


class TestRateLimitPause:
    def test_rate_limit_exhausted_triggers_pause_and_retry(self):
        """RateLimitExhaustedError 应触发等待，然后重试同一模块。"""
        orchestrator = _make_orchestrator()
        modules = [{"id": "mod_a"}]
        orchestrator.checkpoint_manager.list_pending_modules.return_value = ["mod_a"]
        orchestrator.checkpoint_manager.list_completed_modules.return_value = []

        call_count = 0

        def fail_then_succeed(module):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise RateLimitExhaustedError("429")
            mock_output = MagicMock()
            mock_output.nodes = []
            mock_output.edges = []
            mock_output.status = "success"
            return mock_output

        with patch.object(orchestrator, '_run_agent_for_module', side_effect=fail_then_succeed):
            with patch.object(orchestrator, '_wait_with_heartbeat') as mock_wait:
                orchestrator.run_module_analysis(modules)

        mock_wait.assert_called_once()
        assert call_count == 2  # 第一次失败后重试

    def test_exceeds_max_pauses_raises_partial_result_error(self):
        """暂停次数超过阈值后应抛出 PartialResultError。"""
        orchestrator = _make_orchestrator()
        modules = [{"id": "mod_a"}]
        orchestrator.checkpoint_manager.list_pending_modules.return_value = ["mod_a"]
        orchestrator.checkpoint_manager.list_completed_modules.return_value = []

        with patch.object(orchestrator, '_run_agent_for_module',
                          side_effect=RateLimitExhaustedError("429")):
            with patch.object(orchestrator, '_wait_with_heartbeat'):
                with pytest.raises(PartialResultError) as exc_info:
                    orchestrator.run_module_analysis(modules)

        assert exc_info.value.result is None  # 由上层填充
        assert exc_info.value.completed_count >= 0


class TestWaitWithHeartbeat:
    def test_emits_progress_events_during_wait(self):
        """_wait_with_heartbeat 应定期发送 rate_limited 事件。"""
        orchestrator = _make_orchestrator()
        sleep_calls = []

        with patch('time.sleep', side_effect=lambda s: sleep_calls.append(s)):
            orchestrator._wait_with_heartbeat(total_minutes=3)

        assert len(sleep_calls) >= 1
        orchestrator._emit_progress.assert_called()
        # 验证包含 rate_limited status
        all_calls_str = str(orchestrator._emit_progress.call_args_list)
        assert "rate_limited" in all_calls_str
