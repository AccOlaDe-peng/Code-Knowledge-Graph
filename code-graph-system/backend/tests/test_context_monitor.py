"""ContextMonitor 单元测试。"""

from __future__ import annotations

import pytest

from backend.llm.context_monitor import ContextMonitor
from backend.llm.types import ContextState


class TestContextMonitor:
    """ContextMonitor 测试用例。"""

    def test_initial_state(self) -> None:
        """初始状态应为 normal。"""
        monitor = ContextMonitor(max_tokens=100000)

        state = monitor.get_state()

        assert state.status == "normal"
        assert state.usage_ratio == 0.0
        assert state.input_tokens == 0
        assert state.output_tokens == 0
        assert state.max_context == 100000

    def test_record_usage(self) -> None:
        """记录 token 使用量。"""
        monitor = ContextMonitor(max_tokens=100000)

        state = monitor.record_usage(input_tokens=1000, output_tokens=500)

        assert state.input_tokens == 1000
        assert state.output_tokens == 500
        assert state.usage_ratio == 1500 / 100000
        assert state.status == "normal"

    def test_cumulative_usage(self) -> None:
        """累计 token 使用量。"""
        monitor = ContextMonitor(max_tokens=100000)

        monitor.record_usage(input_tokens=1000, output_tokens=500)
        state = monitor.record_usage(input_tokens=2000, output_tokens=1000)

        assert state.input_tokens == 3000  # 累计
        assert state.output_tokens == 1500  # 累计
        assert state.usage_ratio == 4500 / 100000
        assert state.status == "normal"

    def test_warning_threshold(self) -> None:
        """达到 60% 时状态变为 warning。"""
        monitor = ContextMonitor(max_tokens=100000)

        # 60% = 60000 tokens
        state = monitor.record_usage(input_tokens=50000, output_tokens=10000)

        assert state.usage_ratio == 0.6
        assert state.status == "warning"

    def test_critical_threshold(self) -> None:
        """达到 75% 时状态变为 critical。"""
        monitor = ContextMonitor(max_tokens=100000)

        # 75% = 75000 tokens
        state = monitor.record_usage(input_tokens=60000, output_tokens=15000)

        assert state.usage_ratio == 0.75
        assert state.status == "critical"

    def test_exceeded_threshold(self) -> None:
        """超过 100% 时状态变为 exceeded。"""
        monitor = ContextMonitor(max_tokens=100000)

        # 超过 100%
        state = monitor.record_usage(input_tokens=90000, output_tokens=20000)

        assert state.usage_ratio == 1.1
        assert state.status == "exceeded"

    def test_should_apply_sliding_window(self) -> None:
        """critical 和 exceeded 状态应触发滑动窗口。"""
        monitor = ContextMonitor(max_tokens=100000)

        # normal 状态不应触发
        monitor.record_usage(input_tokens=10000, output_tokens=5000)
        assert monitor.should_apply_sliding_window() is False

        # warning 状态不应触发
        monitor.record_usage(input_tokens=45000, output_tokens=10000)
        assert monitor.should_apply_sliding_window() is False

        # critical 状态应触发
        monitor.record_usage(input_tokens=10000, output_tokens=5000)
        assert monitor.should_apply_sliding_window() is True

        # 重置后测试 exceeded
        monitor.reset()
        monitor.record_usage(input_tokens=110000, output_tokens=0)
        assert monitor.should_apply_sliding_window() is True

    def test_reset(self) -> None:
        """重置累计值。"""
        monitor = ContextMonitor(max_tokens=100000)

        monitor.record_usage(input_tokens=50000, output_tokens=25000)
        state = monitor.get_state()
        assert state.input_tokens == 50000
        assert state.output_tokens == 25000

        monitor.reset()
        state = monitor.get_state()
        assert state.input_tokens == 0
        assert state.output_tokens == 0
        assert state.usage_ratio == 0.0
        assert state.status == "normal"

    def test_default_max_tokens(self) -> None:
        """默认 max_tokens 应为 128000。"""
        monitor = ContextMonitor()

        assert monitor.max_tokens == 128000
        state = monitor.get_state()
        assert state.max_context == 128000

    def test_warning_threshold_boundary(self) -> None:
        """测试 warning 阈值边界（刚好低于 60% 应为 normal）。"""
        monitor = ContextMonitor(max_tokens=100000)

        # 59.99% - 应为 normal
        state = monitor.record_usage(input_tokens=59990, output_tokens=0)
        assert state.status == "normal"

        # 再加 10 tokens，达到 60% - 应为 warning
        state = monitor.record_usage(input_tokens=10, output_tokens=0)
        assert state.status == "warning"

    def test_critical_threshold_boundary(self) -> None:
        """测试 critical 阈值边界（刚好低于 75% 应为 warning）。"""
        monitor = ContextMonitor(max_tokens=100000)

        # 74.99% - 应为 warning
        state = monitor.record_usage(input_tokens=74990, output_tokens=0)
        assert state.status == "warning"

        # 再加 10 tokens，达到 75% - 应为 critical
        state = monitor.record_usage(input_tokens=10, output_tokens=0)
        assert state.status == "critical"

    def test_usage_ratio_calculation(self) -> None:
        """验证 usage_ratio 计算逻辑（(input + output) / max_tokens）。"""
        monitor = ContextMonitor(max_tokens=200000)

        state = monitor.record_usage(input_tokens=100000, output_tokens=50000)

        expected_ratio = 150000 / 200000  # 0.75
        assert state.usage_ratio == expected_ratio

    def test_get_state_returns_new_instance(self) -> None:
        """get_state 应返回新的 ContextState 实例。"""
        monitor = ContextMonitor(max_tokens=100000)
        monitor.record_usage(input_tokens=1000, output_tokens=500)

        state1 = monitor.get_state()
        state2 = monitor.get_state()

        assert state1 is not state2  # 不同实例
        assert state1.input_tokens == state2.input_tokens  # 但值相同