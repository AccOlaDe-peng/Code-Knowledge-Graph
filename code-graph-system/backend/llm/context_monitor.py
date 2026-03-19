"""上下文监控器，用于追踪 LLM token 使用量和上下文状态。"""

from __future__ import annotations

import logging

from backend.llm.types import ContextState

logger = logging.getLogger(__name__)


class ContextMonitor:
    """上下文监控器，追踪最近一次请求的 token 使用量并判断上下文状态。

    状态阈值（基于单次请求 input_tokens / max_tokens）：
    - normal:   < 70%
    - warning:  70% - 85%
    - critical: 85% - 100%
    - exceeded: >= 100%
    """

    def __init__(self, max_tokens: int = 128000) -> None:
        self.max_tokens = max_tokens
        self._last_input_tokens: int = 0
        self._last_output_tokens: int = 0

    def _calc_status(self, usage_ratio: float) -> str:
        """根据使用率返回状态字符串。record_usage 和 get_state 均调用此方法。"""
        if usage_ratio >= 1.0:
            return "exceeded"
        elif usage_ratio >= 0.85:
            return "critical"
        elif usage_ratio >= 0.70:
            return "warning"
        return "normal"

    def record_usage(self, input_tokens: int, output_tokens: int) -> ContextState:
        """记录本次请求的 token 使用量并返回当前状态。

        Args:
            input_tokens: 本次请求的输入 token 数（= 当前 context window 实际占用）。
            output_tokens: 本次请求的输出 token 数。

        Returns:
            当前的 ContextState。
        """
        self._last_input_tokens = input_tokens
        self._last_output_tokens = output_tokens
        usage_ratio = input_tokens / self.max_tokens if self.max_tokens > 0 else 0.0
        status = self._calc_status(usage_ratio)

        if status == "warning":
            logger.warning(
                "Context usage at %.1f%% (%d/%d tokens)",
                usage_ratio * 100, input_tokens, self.max_tokens,
            )
        elif status == "critical":
            logger.warning(
                "Context usage CRITICAL at %.1f%% (%d/%d tokens).",
                usage_ratio * 100, input_tokens, self.max_tokens,
            )
        elif status == "exceeded":
            logger.error(
                "Context window EXCEEDED at %.1f%% (%d/%d tokens).",
                usage_ratio * 100, input_tokens, self.max_tokens,
            )

        return ContextState(
            status=status,
            usage_ratio=usage_ratio,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            max_context=self.max_tokens,
        )

    def get_state(self) -> ContextState:
        """基于最近一次记录的值重新计算状态，不触发副作用。"""
        usage_ratio = (
            self._last_input_tokens / self.max_tokens
            if self.max_tokens > 0 else 0.0
        )
        return ContextState(
            status=self._calc_status(usage_ratio),
            usage_ratio=usage_ratio,
            input_tokens=self._last_input_tokens,
            output_tokens=self._last_output_tokens,
            max_context=self.max_tokens,
        )

    def reset(self) -> None:
        """重置（用于模块间重置），清零峰值记录。"""
        self._last_input_tokens = 0
        self._last_output_tokens = 0
        logger.debug("ContextMonitor reset: token counts cleared")
