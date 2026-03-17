"""上下文监控器，用于追踪 LLM token 使用量和上下文状态。"""

from __future__ import annotations

import logging

from backend.llm.types import ContextState

logger = logging.getLogger(__name__)


class ContextMonitor:
    """上下文监控器，追踪 token 使用量并判断上下文状态。

    状态阈值：
    - normal: < 60%（正常运行）
    - warning: 60% - 75%（记录日志）
    - critical: 75% - 100%（触发滑动窗口/摘要压缩）
    - exceeded: > 100%（强制滑动窗口）
    """

    WARNING_THRESHOLD = 0.6
    CRITICAL_THRESHOLD = 0.75

    def __init__(self, max_tokens: int = 128000) -> None:
        """初始化上下文监控器。

        Args:
            max_tokens: 模型的最大上下文窗口大小，默认 128000。
        """
        self.max_tokens = max_tokens
        self._total_input = 0
        self._total_output = 0

    @property
    def total_input(self) -> int:
        """累计输入 token 数量。"""
        return self._total_input

    @property
    def total_output(self) -> int:
        """累计输出 token 数量。"""
        return self._total_output

    def record_usage(self, input_tokens: int, output_tokens: int) -> ContextState:
        """记录本次请求的 token 使用量并返回当前状态。

        Args:
            input_tokens: 本次请求的输入 token 数量。
            output_tokens: 本次请求的输出 token 数量。

        Returns:
            当前的 ContextState。
        """
        self._total_input += input_tokens
        self._total_output += output_tokens

        state = self.get_state()

        # 根据状态记录日志
        if state.status == "warning":
            logger.warning(
                "Context usage at %.1f%% (%d/%d tokens)",
                state.usage_ratio * 100,
                self._total_input + self._total_output,
                self.max_tokens,
            )
        elif state.status == "critical":
            logger.warning(
                "Context usage CRITICAL at %.1f%% (%d/%d tokens). "
                "Consider applying sliding window.",
                state.usage_ratio * 100,
                self._total_input + self._total_output,
                self.max_tokens,
            )
        elif state.status == "exceeded":
            logger.error(
                "Context window EXCEEDED at %.1f%% (%d/%d tokens). "
                "Sliding window MUST be applied.",
                state.usage_ratio * 100,
                self._total_input + self._total_output,
                self.max_tokens,
            )

        return state

    def get_state(self) -> ContextState:
        """获取当前上下文状态。

        Returns:
            包含状态、使用率、token 数量的 ContextState。
        """
        total_tokens = self._total_input + self._total_output
        usage_ratio = total_tokens / self.max_tokens if self.max_tokens > 0 else 0.0

        # 判断状态
        if usage_ratio >= 1.0:
            status = "exceeded"
        elif usage_ratio >= self.CRITICAL_THRESHOLD:
            status = "critical"
        elif usage_ratio >= self.WARNING_THRESHOLD:
            status = "warning"
        else:
            status = "normal"

        return ContextState(
            status=status,
            usage_ratio=usage_ratio,
            input_tokens=self._total_input,
            output_tokens=self._total_output,
            max_context=self.max_tokens,
        )

    def should_apply_sliding_window(self) -> bool:
        """判断是否应该应用滑动窗口。

        当状态为 critical 或 exceeded 时应触发滑动窗口。

        Returns:
            True 表示应触发滑动窗口。
        """
        state = self.get_state()
        return state.status in ("critical", "exceeded")

    def reset(self) -> None:
        """重置累计值（用于模块间重置）。"""
        self._total_input = 0
        self._total_output = 0
        logger.debug("ContextMonitor reset: token counts cleared")
