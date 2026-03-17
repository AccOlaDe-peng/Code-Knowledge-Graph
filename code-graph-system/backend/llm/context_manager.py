"""统一上下文管理器，整合 ContextMonitor + SlidingWindow + Summarizer。"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from backend.llm.context_monitor import ContextMonitor
from backend.llm.sliding_window import SlidingWindow
from backend.llm.summarizer import HistorySummarizer
from backend.llm.types import ContextState

logger = logging.getLogger(__name__)


@dataclass
class ContextConfig:
    """上下文管理配置。"""

    max_tokens: int = 128000
    warning_threshold: float = 0.6
    sliding_window_threshold: float = 0.75
    summary_threshold: float = 0.85
    keep_recent_messages: int = 6
    keep_first_messages: int = 1
    enable_summary: bool = True


class ContextManager:
    """统一上下文管理器。

    整合 ContextMonitor、SlidingWindow 和 HistorySummarizer，
    根据上下文状态自动选择处理策略。

    策略选择逻辑：
    | 状态     | 策略                                      |
    |----------|-------------------------------------------|
    | normal   | 无处理                                    |
    | warning  | 记录日志                                  |
    | critical | 尝试摘要压缩 → 失败时降级为滑动窗口       |
    | exceeded | 强制滑动窗口                              |
    """

    def __init__(
        self,
        config: ContextConfig | None = None,
        llm_client: Any = None,
    ) -> None:
        """初始化上下文管理器。

        Args:
            config: 配置对象，如果为 None 则使用默认配置。
            llm_client: LLM 客户端实例，用于摘要压缩。如果为 None 则禁用摘要功能。
        """
        self.config = config or ContextConfig()
        self.monitor = ContextMonitor(max_tokens=self.config.max_tokens)

        # 滑动窗口（keep_recent_rounds = keep_recent_messages / 2）
        self.sliding_window = SlidingWindow(
            keep_recent_rounds=self.config.keep_recent_messages // 2,
            keep_first_messages=self.config.keep_first_messages,
        )

        # 摘要压缩器（需要 LLM 客户端）
        self.summarizer: HistorySummarizer | None = None
        if llm_client and self.config.enable_summary:
            self.summarizer = HistorySummarizer(
                llm_client=llm_client,
                keep_recent=self.config.keep_recent_messages // 2,
                keep_first=self.config.keep_first_messages,
            )

    def record_usage(self, input_tokens: int, output_tokens: int) -> ContextState:
        """记录 token 使用并返回当前状态。

        Args:
            input_tokens: 本次请求的输入 token 数量。
            output_tokens: 本次请求的输出 token 数量。

        Returns:
            当前的 ContextState。
        """
        return self.monitor.record_usage(input_tokens, output_tokens)

    def get_state(self) -> ContextState:
        """获取当前上下文状态。

        Returns:
            当前的 ContextState。
        """
        return self.monitor.get_state()

    def process_messages(
        self,
        messages: list[dict],
        provider: str = "anthropic",
    ) -> tuple[list[dict], str]:
        """根据上下文状态处理消息。

        根据当前状态选择合适的策略：
        - normal: 无处理，返回原消息
        - warning: 仅记录日志，返回原消息
        - critical: 尝试摘要压缩，失败则降级为滑动窗口
        - exceeded: 强制滑动窗口

        Args:
            messages: 原始消息列表。
            provider: LLM 提供商，"anthropic" 或 "openai"。

        Returns:
            (处理后的消息列表, 采取的策略)
            策略值: "none" | "warning" | "summary" | "sliding_window"
        """
        state = self.get_state()

        # normal 状态：无处理
        if state.status == "normal":
            return messages.copy(), "none"

        # warning 状态：仅记录日志
        if state.status == "warning":
            logger.warning(
                "Context usage at %.1f%% (%d/%d tokens), no action taken",
                state.usage_ratio * 100,
                state.input_tokens + state.output_tokens,
                state.max_context,
            )
            return messages.copy(), "none"

        # exceeded 状态：强制滑动窗口
        if state.status == "exceeded":
            logger.warning(
                "Context exceeded at %.1f%%, forcing sliding window",
                state.usage_ratio * 100,
            )
            result_messages, _ = self.sliding_window.apply(messages, provider)
            return result_messages, "sliding_window"

        # critical 状态：尝试摘要压缩，失败则降级为滑动窗口
        if state.status == "critical":
            # 尝试使用摘要压缩
            if self.summarizer:
                try:
                    logger.info(
                        "Context critical at %.1f%%, attempting summary compression",
                        state.usage_ratio * 100,
                    )
                    compression_result = self.summarizer.compress(messages)

                    # 检查是否是真正的摘要压缩（非降级）
                    # 降级滑动窗口的 summary 是 "[滑动窗口截断]"
                    if compression_result.summary == "[滑动窗口截断]":
                        logger.info("Summarizer fell back to sliding window")
                        return compression_result.compressed_messages, "sliding_window"

                    if compression_result.compression_ratio < 1.0:
                        logger.info(
                            "Summary compression successful: %.1f%% reduction",
                            (1 - compression_result.compression_ratio) * 100,
                        )
                        return compression_result.compressed_messages, "summary"
                except Exception as e:
                    logger.warning(
                        "Summary compression failed: %s, falling back to sliding window",
                        e,
                    )

            # 降级为滑动窗口
            logger.info("Using sliding window as fallback")
            result_messages, _ = self.sliding_window.apply(messages, provider)
            return result_messages, "sliding_window"

        # 未知状态（不应该发生）
        return messages.copy(), "none"

    def reset(self) -> None:
        """重置上下文监控器。"""
        self.monitor.reset()
        logger.debug("ContextManager reset: all state cleared")