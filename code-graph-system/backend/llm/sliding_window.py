"""滑动窗口实现，用于在上下文接近超限时截断早期消息历史。"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


class SlidingWindow:
    """滑动窗口，用于裁剪消息历史以控制上下文窗口大小。

    裁剪策略：
    1. 保留最初的 N 条消息（任务说明）
    2. 保留最近的 M 轮对话
    3. 中间部分替换为占位符消息

    "轮"的定义：
    - Anthropic: 1次 assistant 消息 + 1次 user 消息
    - OpenAI: 1次 assistant 消息 + 1次 tool 消息
    """

    PLACEHOLDER_CONTENT = (
        "[Earlier conversation history has been truncated to fit context window. "
        "Key information from earlier messages has been preserved.]"
    )

    def __init__(
        self,
        keep_recent_rounds: int = 5,
        keep_first_messages: int = 1,
    ) -> None:
        """初始化滑动窗口。

        Args:
            keep_recent_rounds: 保留最近的轮数，默认 5 轮。
            keep_first_messages: 保留最初的消息条数，默认 1 条。
        """
        self.keep_recent_rounds = keep_recent_rounds
        self.keep_first_messages = keep_first_messages

    def apply(
        self,
        messages: list[dict[str, Any]],
        provider: str = "anthropic",
    ) -> tuple[list[dict[str, Any]], bool]:
        """应用滑动窗口。

        Args:
            messages: 原始消息列表。
            provider: LLM 提供商，"anthropic" 或 "openai"。

        Returns:
            (裁剪后的消息列表, 是否进行了裁剪)
        """
        if not messages:
            return [], False

        # 计算当前轮数
        total_rounds = self._count_rounds(messages, provider)

        # 如果轮数不超过保留的轮数，不裁剪
        if total_rounds <= self.keep_recent_rounds:
            return messages.copy(), False

        # 计算需要保留的最近消息条数
        # 每轮约2条消息（assistant + user/tool）
        messages_per_round = 2
        recent_message_count = self.keep_recent_rounds * messages_per_round

        # 检查是否有足够消息需要裁剪
        total_messages = len(messages)
        minimum_messages = self.keep_first_messages + recent_message_count

        if total_messages <= minimum_messages:
            return messages.copy(), False

        # 构建裁剪后的消息列表
        result: list[dict[str, Any]] = []

        # 1. 保留首消息
        result.extend(messages[: self.keep_first_messages])

        # 2. 添加占位符
        placeholder = self._create_placeholder(provider)
        result.append(placeholder)

        # 3. 保留最近的消息
        recent_start = total_messages - recent_message_count
        result.extend(messages[recent_start:])

        logger.info(
            "Sliding window applied: %d messages -> %d messages "
            "(kept first %d, recent %d rounds)",
            total_messages,
            len(result),
            self.keep_first_messages,
            self.keep_recent_rounds,
        )

        return result, True

    def _count_rounds(
        self,
        messages: list[dict[str, Any]],
        provider: str,
    ) -> int:
        """计算消息列表中的轮数。

        轮数 = assistant 消息的数量（每轮包含一次 assistant 响应）。

        Args:
            messages: 消息列表。
            provider: LLM 提供商。

        Returns:
            轮数。
        """
        if provider == "openai":
            # OpenAI 格式：assistant + tool 为一轮
            return sum(1 for m in messages if m.get("role") == "assistant")
        else:
            # Anthropic 格式：assistant + user 为一轮
            return sum(1 for m in messages if m.get("role") == "assistant")

    def _create_placeholder(self, provider: str) -> dict[str, Any]:
        """创建占位符消息。

        Args:
            provider: LLM 提供商。

        Returns:
            占位符消息字典。
        """
        return {
            "role": "user",
            "content": self.PLACEHOLDER_CONTENT,
        }
