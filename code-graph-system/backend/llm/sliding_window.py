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

        # 如果轮数不超过保留的轮数，不裁剪（但仍检查孤立 tool_result）
        if total_rounds <= self.keep_recent_rounds:
            result = messages.copy()
            result = self._heal_orphan_tool_results(result)
            return result, False

        # 计算需要保留的最近消息条数
        # 每轮约2条消息（assistant + user/tool）
        messages_per_round = 2
        recent_message_count = self.keep_recent_rounds * messages_per_round

        # 检查是否有足够消息需要裁剪
        total_messages = len(messages)
        minimum_messages = self.keep_first_messages + recent_message_count

        if total_messages <= minimum_messages:
            result = messages.copy()
            result = self._heal_orphan_tool_results(result)
            return result, False

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

        # 自愈检查：移除孤立 tool_result 消息，防止 Anthropic API 返回 400 错误
        result = self._heal_orphan_tool_results(result)

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

    def _heal_orphan_tool_results(
        self,
        messages: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """移除消息列表中孤立的 tool_result 消息。

        孤立 tool_result 是指 user 消息仅包含 tool_result 内容块，
        但在消息列表中找不到对应 tool_use_id 的 assistant tool_use 块。
        此类孤立消息会导致 Anthropic API 返回 400 错误。

        Args:
            messages: 消息列表。

        Returns:
            清理后的消息列表。
        """
        # 收集所有 tool_use id
        tool_use_ids: set[str] = set()
        for msg in messages:
            content = msg.get("content", [])
            if not isinstance(content, list):
                continue
            for block in content:
                if isinstance(block, dict) and block.get("type") == "tool_use":
                    tool_id = block.get("id")
                    if tool_id:
                        tool_use_ids.add(tool_id)

        # 过滤孤立 tool_result 消息
        healed: list[dict[str, Any]] = []
        for msg in messages:
            content = msg.get("content", [])
            if (
                msg.get("role") == "user"
                and isinstance(content, list)
                and content
                # 仅处理"全部 block 均为 tool_result"的 user 消息
                # 混合内容消息（含 tool_result + 文本 block）不处理，有意跳过——
                # 此类消息在当前 agent 工具集中不会出现
                and all(
                    isinstance(b, dict) and b.get("type") == "tool_result"
                    for b in content
                )
            ):
                # 全部都是 tool_result 块 — 检查是否有孤立项
                orphaned = any(
                    b.get("tool_use_id") not in tool_use_ids
                    for b in content
                    if isinstance(b, dict)
                )
                if orphaned:
                    logger.warning(
                        "Sliding window: removed orphan tool_result message to preserve pairing"
                    )
                    continue
            healed.append(msg)

        return healed

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
