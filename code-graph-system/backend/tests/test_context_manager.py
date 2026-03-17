"""ContextManager 单元测试。"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from backend.llm.context_manager import ContextConfig, ContextManager
from backend.llm.summarizer import CompressionResult
from backend.llm.types import ContextState


class TestContextManager:
    """ContextManager 测试类。"""

    def test_initialization(self) -> None:
        """测试初始化正确。"""
        # 默认配置
        manager = ContextManager()
        assert manager.config.max_tokens == 128000
        assert manager.config.warning_threshold == 0.6
        assert manager.config.sliding_window_threshold == 0.75
        assert manager.config.summary_threshold == 0.85
        assert manager.config.keep_recent_messages == 6
        assert manager.config.keep_first_messages == 1
        assert manager.config.enable_summary is True
        assert manager.monitor is not None
        assert manager.sliding_window is not None
        assert manager.summarizer is None  # 无 LLM 客户端

        # 自定义配置
        config = ContextConfig(
            max_tokens=200000,
            warning_threshold=0.5,
            enable_summary=False,
        )
        manager = ContextManager(config=config)
        assert manager.config.max_tokens == 200000
        assert manager.config.warning_threshold == 0.5
        assert manager.config.enable_summary is False

    def test_initialization_with_llm_client(self) -> None:
        """测试带 LLM 客户端初始化。"""
        mock_client = MagicMock()
        manager = ContextManager(llm_client=mock_client)
        assert manager.summarizer is not None
        assert manager.summarizer.llm_client == mock_client

    def test_record_usage(self) -> None:
        """测试记录 token 使用。"""
        manager = ContextManager()

        # 记录第一次使用
        state = manager.record_usage(1000, 500)
        assert state.input_tokens == 1000
        assert state.output_tokens == 500
        assert state.status == "normal"
        assert state.usage_ratio == pytest.approx(1500 / 128000, rel=0.01)

        # 记录第二次使用
        state = manager.record_usage(2000, 1000)
        assert state.input_tokens == 3000
        assert state.output_tokens == 1500

        # 验证 monitor 的累计值
        assert manager.monitor.total_input == 3000
        assert manager.monitor.total_output == 1500

    def test_get_state(self) -> None:
        """测试获取当前状态。"""
        manager = ContextManager()

        # 初始状态
        state = manager.get_state()
        assert state.status == "normal"
        assert state.usage_ratio == 0.0

        # 记录大量使用（达到 warning）
        manager.record_usage(40000, 40000)  # 80k tokens, ~62.5%
        state = manager.get_state()
        assert state.status == "warning"
        assert state.usage_ratio == pytest.approx(80000 / 128000, rel=0.01)

    def test_process_messages_normal(self) -> None:
        """测试 normal 状态不处理消息。"""
        manager = ContextManager()
        messages = [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi"},
        ]

        result, strategy = manager.process_messages(messages)

        assert strategy == "none"
        assert result == messages
        assert result is not messages  # 是副本，不是同一对象

    def test_process_messages_warning(self) -> None:
        """测试 warning 状态仅记录日志，不处理消息。"""
        manager = ContextManager()

        # 设置到 warning 状态
        manager.record_usage(50000, 30000)  # 80k / 128k = 62.5%

        messages = [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi"},
        ]

        result, strategy = manager.process_messages(messages)

        # warning 状态也应该返回 none（仅记录日志）
        assert strategy == "none"
        assert result == messages

    def test_process_messages_exceeded(self) -> None:
        """测试 exceeded 状态强制滑动窗口。"""
        manager = ContextManager()

        # 设置到 exceeded 状态
        manager.record_usage(70000, 70000)  # 140k / 128k > 100%

        messages = [
            {"role": "user", "content": "First"},
            {"role": "assistant", "content": "Response 1"},
            {"role": "user", "content": "Second"},
            {"role": "assistant", "content": "Response 2"},
            {"role": "user", "content": "Third"},
            {"role": "assistant", "content": "Response 3"},
            {"role": "user", "content": "Fourth"},
            {"role": "assistant", "content": "Response 4"},
            {"role": "user", "content": "Fifth"},
            {"role": "assistant", "content": "Response 5"},
            {"role": "user", "content": "Sixth"},
            {"role": "assistant", "content": "Response 6"},
        ]

        result, strategy = manager.process_messages(messages)

        assert strategy == "sliding_window"
        # 滑动窗口应该减少消息数量
        assert len(result) < len(messages)
        # 应该保留第一条消息
        assert result[0] == messages[0]

    def test_process_messages_critical_without_summarizer(self) -> None:
        """测试 critical 状态无 summarizer 时使用滑动窗口。"""
        manager = ContextManager()  # 无 LLM 客户端

        # 设置到 critical 状态
        manager.record_usage(50000, 50000)  # 100k / 128k = 78%

        messages = [
            {"role": "user", "content": "First"},
            {"role": "assistant", "content": "Response 1"},
            {"role": "user", "content": "Second"},
            {"role": "assistant", "content": "Response 2"},
            {"role": "user", "content": "Third"},
            {"role": "assistant", "content": "Response 3"},
            {"role": "user", "content": "Fourth"},
            {"role": "assistant", "content": "Response 4"},
            {"role": "user", "content": "Fifth"},
            {"role": "assistant", "content": "Response 5"},
            {"role": "user", "content": "Sixth"},
            {"role": "assistant", "content": "Response 6"},
        ]

        result, strategy = manager.process_messages(messages)

        # 无 summarizer 时应该降级为滑动窗口
        assert strategy == "sliding_window"
        assert len(result) < len(messages)

    def test_process_messages_critical_with_summarizer_success(self) -> None:
        """测试 critical 状态使用 summarizer 成功压缩。"""
        mock_client = MagicMock()
        mock_client.complete.return_value = "Summary of earlier conversation"

        manager = ContextManager(llm_client=mock_client)

        # 设置到 critical 状态
        manager.record_usage(50000, 50000)  # 100k / 128k = 78%

        messages = [
            {"role": "user", "content": "First"},
            {"role": "assistant", "content": "Response 1"},
            {"role": "user", "content": "Second"},
            {"role": "assistant", "content": "Response 2"},
            {"role": "user", "content": "Third"},
            {"role": "assistant", "content": "Response 3"},
            {"role": "user", "content": "Fourth"},
            {"role": "assistant", "content": "Response 4"},
            {"role": "user", "content": "Fifth"},
            {"role": "assistant", "content": "Response 5"},
            {"role": "user", "content": "Sixth"},
            {"role": "assistant", "content": "Response 6"},
        ]

        result, strategy = manager.process_messages(messages)

        assert strategy == "summary"
        # 压缩后应该有摘要消息
        summary_messages = [m for m in result if "[历史摘要]" in m.get("content", "")]
        assert len(summary_messages) > 0

    def test_process_messages_critical_summarizer_fallback(self) -> None:
        """测试 critical 状态 summarizer 失败时降级为滑动窗口。"""
        mock_client = MagicMock()
        mock_client.complete.side_effect = Exception("LLM error")

        manager = ContextManager(llm_client=mock_client)

        # 设置到 critical 状态
        manager.record_usage(50000, 50000)  # 100k / 128k = 78%

        messages = [
            {"role": "user", "content": "First"},
            {"role": "assistant", "content": "Response 1"},
            {"role": "user", "content": "Second"},
            {"role": "assistant", "content": "Response 2"},
            {"role": "user", "content": "Third"},
            {"role": "assistant", "content": "Response 3"},
            {"role": "user", "content": "Fourth"},
            {"role": "assistant", "content": "Response 4"},
            {"role": "user", "content": "Fifth"},
            {"role": "assistant", "content": "Response 5"},
            {"role": "user", "content": "Sixth"},
            {"role": "assistant", "content": "Response 6"},
        ]

        result, strategy = manager.process_messages(messages)

        # 摘要失败后应该降级为滑动窗口
        assert strategy == "sliding_window"

    def test_reset(self) -> None:
        """测试重置功能。"""
        manager = ContextManager()

        # 记录一些使用
        manager.record_usage(10000, 5000)
        assert manager.monitor.total_input == 10000

        # 重置
        manager.reset()

        # 验证重置后状态
        state = manager.get_state()
        assert state.input_tokens == 0
        assert state.output_tokens == 0
        assert state.status == "normal"

    def test_custom_config(self) -> None:
        """测试自定义配置。"""
        config = ContextConfig(
            max_tokens=200000,
            warning_threshold=0.5,
            sliding_window_threshold=0.7,
            summary_threshold=0.8,
            keep_recent_messages=10,
            keep_first_messages=2,
            enable_summary=True,
        )

        manager = ContextManager(config=config)

        assert manager.config.max_tokens == 200000
        assert manager.config.warning_threshold == 0.5
        assert manager.sliding_window.keep_recent_rounds == 5  # 10 // 2
        assert manager.sliding_window.keep_first_messages == 2

    def test_process_messages_preserves_original(self) -> None:
        """测试处理消息不修改原始列表。"""
        manager = ContextManager()
        messages = [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi"},
        ]
        original_len = len(messages)

        result, _ = manager.process_messages(messages)

        # 原始列表不应被修改
        assert len(messages) == original_len
        assert result is not messages

    def test_process_messages_openai_provider(self) -> None:
        """测试 OpenAI 提供商的消息处理。"""
        manager = ContextManager()

        # 设置到 exceeded 状态
        manager.record_usage(70000, 70000)

        messages = [
            {"role": "user", "content": "First"},
            {"role": "assistant", "content": "Response 1"},
            {"role": "user", "content": "Second"},
            {"role": "assistant", "content": "Response 2"},
            {"role": "user", "content": "Third"},
            {"role": "assistant", "content": "Response 3"},
            {"role": "user", "content": "Fourth"},
            {"role": "assistant", "content": "Response 4"},
            {"role": "user", "content": "Fifth"},
            {"role": "assistant", "content": "Response 5"},
            {"role": "user", "content": "Sixth"},
            {"role": "assistant", "content": "Response 6"},
        ]

        result, strategy = manager.process_messages(messages, provider="openai")

        assert strategy == "sliding_window"
        assert len(result) < len(messages)
