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
        """记录 token 使用量（基于 input_tokens）。"""
        monitor = ContextMonitor(max_tokens=100000)

        state = monitor.record_usage(input_tokens=1000, output_tokens=500)

        assert state.input_tokens == 1000
        assert state.output_tokens == 500
        assert state.usage_ratio == 1000 / 100000  # 仅基于 input_tokens
        assert state.status == "normal"

    def test_last_request_usage(self) -> None:
        """记录的是最近一次请求 token，而非累计值。"""
        monitor = ContextMonitor(max_tokens=100000)

        monitor.record_usage(input_tokens=1000, output_tokens=500)
        state = monitor.record_usage(input_tokens=2000, output_tokens=1000)

        assert state.input_tokens == 2000   # 最近一次请求的 input
        assert state.output_tokens == 1000  # 最近一次请求的 output
        assert state.usage_ratio == 2000 / 100000
        assert state.status == "normal"

    def test_warning_threshold(self) -> None:
        """达到 70% 时状态变为 warning。"""
        monitor = ContextMonitor(max_tokens=100000)

        # 70% = 70000 input tokens
        state = monitor.record_usage(input_tokens=70000, output_tokens=0)

        assert state.usage_ratio == 0.7
        assert state.status == "warning"

    def test_critical_threshold(self) -> None:
        """达到 85% 时状态变为 critical。"""
        monitor = ContextMonitor(max_tokens=100000)

        # 85% = 85000 input tokens
        state = monitor.record_usage(input_tokens=85000, output_tokens=0)

        assert state.usage_ratio == 0.85
        assert state.status == "critical"

    def test_exceeded_threshold(self) -> None:
        """超过 100% 时状态变为 exceeded。"""
        monitor = ContextMonitor(max_tokens=100000)

        # 超过 100%
        state = monitor.record_usage(input_tokens=110000, output_tokens=0)

        assert state.usage_ratio == pytest.approx(1.1)
        assert state.status == "exceeded"

    def test_no_should_apply_sliding_window(self) -> None:
        """should_apply_sliding_window 接口已删除。"""
        monitor = ContextMonitor(max_tokens=100000)
        assert not hasattr(monitor, "should_apply_sliding_window")

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
        """测试 warning 阈值边界（刚好低于 70% 应为 normal）。"""
        monitor = ContextMonitor(max_tokens=100000)

        # 69.99% - 应为 normal
        state = monitor.record_usage(input_tokens=69990, output_tokens=0)
        assert state.status == "normal"

        # 直接传入 70000，达到 70% - 应为 warning
        state = monitor.record_usage(input_tokens=70000, output_tokens=0)
        assert state.status == "warning"

    def test_critical_threshold_boundary(self) -> None:
        """测试 critical 阈值边界（刚好低于 85% 应为 warning）。"""
        monitor = ContextMonitor(max_tokens=100000)

        # 84.99% - 应为 warning
        state = monitor.record_usage(input_tokens=84990, output_tokens=0)
        assert state.status == "warning"

        # 直接传入 85000，达到 85% - 应为 critical
        state = monitor.record_usage(input_tokens=85000, output_tokens=0)
        assert state.status == "critical"

    def test_usage_ratio_calculation(self) -> None:
        """验证 usage_ratio 计算逻辑（input_tokens / max_tokens）。"""
        monitor = ContextMonitor(max_tokens=200000)

        state = monitor.record_usage(input_tokens=100000, output_tokens=50000)

        expected_ratio = 100000 / 200000  # 0.5（仅基于 input_tokens）
        assert state.usage_ratio == expected_ratio

    def test_get_state_returns_new_instance(self) -> None:
        """get_state 应返回新的 ContextState 实例。"""
        monitor = ContextMonitor(max_tokens=100000)
        monitor.record_usage(input_tokens=1000, output_tokens=500)

        state1 = monitor.get_state()
        state2 = monitor.get_state()

        assert state1 is not state2  # 不同实例
        assert state1.input_tokens == state2.input_tokens  # 但值相同


class TestContextMonitorNew:
    """验证新的单次 token 语义。"""

    def test_record_usage_tracks_last_input_tokens(self):
        """usage_ratio 应基于本次请求 input_tokens，而非累计值。"""
        monitor = ContextMonitor(max_tokens=100)
        monitor.record_usage(input_tokens=50, output_tokens=10)
        state = monitor.record_usage(input_tokens=60, output_tokens=10)
        # 第二次请求 input=60，ratio=0.6，而非累计 (50+60+20)=130/100=1.3
        assert state.usage_ratio == pytest.approx(0.6)
        assert state.input_tokens == 60
        assert state.status == "normal"  # 60% < 70% warning threshold

    def test_warning_threshold_at_70_percent(self):
        monitor = ContextMonitor(max_tokens=100)
        state = monitor.record_usage(input_tokens=70, output_tokens=0)
        assert state.status == "warning"

    def test_critical_threshold_at_85_percent(self):
        monitor = ContextMonitor(max_tokens=100)
        state = monitor.record_usage(input_tokens=85, output_tokens=0)
        assert state.status == "critical"

    def test_exceeded_threshold_at_100_percent(self):
        monitor = ContextMonitor(max_tokens=100)
        state = monitor.record_usage(input_tokens=100, output_tokens=0)
        assert state.status == "exceeded"

    def test_get_state_does_not_mutate(self):
        """get_state() 不应改变内部状态。"""
        monitor = ContextMonitor(max_tokens=100)
        monitor.record_usage(input_tokens=50, output_tokens=5)
        s1 = monitor.get_state()
        s2 = monitor.get_state()
        assert s1.input_tokens == s2.input_tokens == 50

    def test_reset_clears_last_tokens(self):
        monitor = ContextMonitor(max_tokens=100)
        monitor.record_usage(input_tokens=80, output_tokens=10)
        monitor.reset()
        state = monitor.get_state()
        assert state.input_tokens == 0
        assert state.usage_ratio == 0.0
        assert state.status == "normal"

    def test_no_should_apply_sliding_window_method(self):
        """旧接口 should_apply_sliding_window 应已删除。"""
        monitor = ContextMonitor()
        assert not hasattr(monitor, "should_apply_sliding_window")

    def test_no_total_input_property(self):
        """旧 property total_input/total_output 应已删除。"""
        monitor = ContextMonitor()
        assert not hasattr(monitor, "total_input")
        assert not hasattr(monitor, "total_output")