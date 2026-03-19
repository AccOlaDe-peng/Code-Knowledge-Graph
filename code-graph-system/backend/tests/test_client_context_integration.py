"""测试 ContextMonitor 和 SlidingWindow 集成到 LLMClient。"""

from __future__ import annotations

import pytest
from unittest.mock import MagicMock, patch

from backend.llm.client import LLMClient
from backend.llm.context_monitor import ContextMonitor
from backend.llm.types import ContextState


class TestExtractTokenUsage:
    """测试 extract_token_usage 函数。"""

    def test_extract_token_usage_anthropic(self):
        """测试从 Anthropic API 响应中提取 token 使用量。"""
        from backend.llm.client import extract_token_usage

        # 模拟 Anthropic API 响应
        response = MagicMock()
        response.usage = MagicMock()
        response.usage.input_tokens = 1000
        response.usage.output_tokens = 500

        input_tok, output_tok = extract_token_usage(response, "anthropic")
        assert input_tok == 1000
        assert output_tok == 500

    def test_extract_token_usage_openai(self):
        """测试从 OpenAI API 响应中提取 token 使用量。"""
        from backend.llm.client import extract_token_usage

        # 模拟 OpenAI API 响应
        response = MagicMock()
        response.usage = MagicMock()
        response.usage.prompt_tokens = 2000
        response.usage.completion_tokens = 800

        input_tok, output_tok = extract_token_usage(response, "openai")
        assert input_tok == 2000
        assert output_tok == 800

    def test_extract_token_usage_minimax(self):
        """测试从 MiniMax API 响应中提取 token 使用量。"""
        from backend.llm.client import extract_token_usage

        # MiniMax 使用 OpenAI 兼容接口
        response = MagicMock()
        response.usage = MagicMock()
        response.usage.prompt_tokens = 1500
        response.usage.completion_tokens = 600

        input_tok, output_tok = extract_token_usage(response, "minimax")
        assert input_tok == 1500
        assert output_tok == 600

    def test_extract_token_usage_no_usage(self):
        """测试无 usage 字段时返回 0。"""
        from backend.llm.client import extract_token_usage

        # 无 usage 属性
        response = MagicMock(spec=[])  # 空规格，无 usage 属性
        input_tok, output_tok = extract_token_usage(response, "anthropic")
        assert input_tok == 0
        assert output_tok == 0

    def test_extract_token_usage_none_usage(self):
        """测试 usage 为 None 时返回 0。"""
        from backend.llm.client import extract_token_usage

        response = MagicMock()
        response.usage = None

        input_tok, output_tok = extract_token_usage(response, "openai")
        assert input_tok == 0
        assert output_tok == 0

    def test_extract_token_usage_partial_usage(self):
        """测试 usage 字段部分缺失时返回 0。"""
        from backend.llm.client import extract_token_usage

        # 只有部分 usage 字段
        response = MagicMock()
        response.usage = MagicMock()
        # 不设置任何 token 字段，getattr 会返回默认值 0
        response.usage.input_tokens = None
        response.usage.output_tokens = None

        input_tok, output_tok = extract_token_usage(response, "anthropic")
        # getattr 默认返回 0
        assert input_tok == 0
        assert output_tok == 0


class TestToolCallLoopSignature:
    """测试 tool_call_loop 方法签名。"""

    def test_context_monitor_optional(self):
        """测试 context_monitor 参数可选。"""
        client = LLMClient(provider="anthropic", api_key="test-key")

        # 应该可以调用，不传 context_monitor
        import inspect
        sig = inspect.signature(client.tool_call_loop)
        params = sig.parameters

        assert "context_monitor" in params
        assert params["context_monitor"].default is None

    def test_tool_call_loop_accepts_context_monitor(self):
        """测试 tool_call_loop 接受 context_monitor 参数。"""
        client = LLMClient(provider="anthropic", api_key="test-key")
        monitor = ContextMonitor(max_tokens=100000)

        # 验证方法签名包含 context_monitor 参数
        import inspect
        sig = inspect.signature(client.tool_call_loop)
        params = list(sig.parameters.keys())

        assert "context_monitor" in params


class TestContextMonitorIntegration:
    """测试 ContextMonitor 在 tool_call_loop 中的集成。"""

    def test_context_monitor_records_usage(self):
        """测试 context_monitor 记录最近一次请求的 token 使用量。"""
        monitor = ContextMonitor(max_tokens=100000)

        # 记录第一次使用
        state = monitor.record_usage(5000, 2000)
        assert state.input_tokens == 5000
        assert state.output_tokens == 2000
        assert state.status == "normal"

        # 记录第二次使用（返回最近一次的值，非累计）
        state = monitor.record_usage(3000, 1500)
        assert state.input_tokens == 3000
        assert state.output_tokens == 1500

    def test_context_monitor_warning_threshold(self):
        """测试 context_monitor 警告阈值（70%）。"""
        monitor = ContextMonitor(max_tokens=10000)

        # 使用 70% (warning 阈值)，input_tokens = 7000
        state = monitor.record_usage(7000, 0)
        assert state.status == "warning"
        assert state.usage_ratio >= 0.70

    def test_context_monitor_critical_threshold(self):
        """测试 context_monitor 严重阈值（85%）。"""
        monitor = ContextMonitor(max_tokens=10000)

        # 使用 85% (critical 阈值)，input_tokens = 8500
        state = monitor.record_usage(8500, 0)
        assert state.status == "critical"
        assert state.usage_ratio >= 0.85

    def test_context_monitor_exceeded(self):
        """测试 context_monitor 超限状态（>= 100%）。"""
        monitor = ContextMonitor(max_tokens=10000)

        # 超过 100%，input_tokens = 10000
        state = monitor.record_usage(10000, 0)
        assert state.status == "exceeded"
        assert state.usage_ratio >= 1.0

    def test_should_apply_sliding_window(self):
        """should_apply_sliding_window 接口已删除，验证其不存在。"""
        monitor = ContextMonitor(max_tokens=10000)
        assert not hasattr(monitor, "should_apply_sliding_window")


class TestSlidingWindowApplication:
    """测试滑动窗口在 tool_call_loop 中的应用。"""

    @patch("backend.llm.client.LLMClient._get_client")
    def test_sliding_window_not_applied_when_normal(self, mock_get_client):
        """测试正常状态下不应用滑动窗口。"""
        # 设置 mock
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.stop_reason = "end_turn"
        mock_response.content = [MagicMock(text="完成")]
        mock_response.usage = MagicMock()
        mock_response.usage.input_tokens = 100
        mock_response.usage.output_tokens = 50
        mock_client.messages.create.return_value = mock_response
        mock_get_client.return_value = mock_client

        client = LLMClient(provider="anthropic", api_key="test-key")
        monitor = ContextMonitor(max_tokens=100000)

        result = client.tool_call_loop(
            system="测试系统提示",
            messages=[{"role": "user", "content": "测试"}],
            tools=[],
            context_monitor=monitor,
        )

        assert result.status == "completed"

    @patch("backend.llm.client.LLMClient._get_client")
    def test_preflight_compression_applied_when_over_threshold(self, mock_get_client):
        """测试 pre-flight 压缩在 token 估算超过阈值时被调用。"""
        # 设置 mock
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.stop_reason = "end_turn"
        mock_response.content = [MagicMock(text="完成")]
        mock_response.usage = MagicMock()
        mock_response.usage.input_tokens = 100
        mock_response.usage.output_tokens = 50
        mock_client.messages.create.return_value = mock_response
        mock_get_client.return_value = mock_client

        client = LLMClient(provider="anthropic", api_key="test-key")
        # 设置很小的 context_window 以确保 pre-flight 压缩被触发
        client.context_window = 100

        monitor = ContextMonitor(max_tokens=200)

        # 创建足够多的消息以超过 context_window 阈值
        # 每条消息 "消息 i" 约 10 bytes，20 条约 200 bytes / 4 = 50 tokens，超过 100 * 0.70 = 70
        messages = [{"role": "user", "content": "a" * 400}] + [
            {"role": "user", "content": f"消息 {i}"} for i in range(5)
        ]

        # Mock _apply_compression 验证它被调用
        with patch("backend.llm.client._apply_compression", wraps=lambda msgs, **kw: msgs) as mock_compress:
            result = client.tool_call_loop(
                system="测试系统提示",
                messages=messages,
                tools=[],
                context_monitor=monitor,
            )

            # 验证压缩函数被调用（pre-flight 触发）
            assert mock_compress.call_count >= 1


class TestBackwardCompatibility:
    """测试向后兼容性。"""

    @patch("backend.llm.client.LLMClient._get_client")
    def test_tool_call_loop_works_without_context_monitor(self, mock_get_client):
        """测试不传 context_monitor 时仍能正常工作。"""
        # 设置 mock
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.stop_reason = "end_turn"
        mock_response.content = [MagicMock(text="完成")]
        mock_client.messages.create.return_value = mock_response
        mock_get_client.return_value = mock_client

        client = LLMClient(provider="anthropic", api_key="test-key")

        # 不传 context_monitor
        result = client.tool_call_loop(
            system="测试系统提示",
            messages=[{"role": "user", "content": "测试"}],
            tools=[],
        )

        assert result.status == "completed"

    @patch("backend.llm.client.LLMClient._get_client")
    def test_tool_call_loop_with_none_context_monitor(self, mock_get_client):
        """测试传入 None 作为 context_monitor 时正常工作。"""
        # 设置 mock
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.stop_reason = "end_turn"
        mock_response.content = [MagicMock(text="完成")]
        mock_client.messages.create.return_value = mock_response
        mock_get_client.return_value = mock_client

        client = LLMClient(provider="anthropic", api_key="test-key")

        # 显式传入 None
        result = client.tool_call_loop(
            system="测试系统提示",
            messages=[{"role": "user", "content": "测试"}],
            tools=[],
            context_monitor=None,
        )

        assert result.status == "completed"
