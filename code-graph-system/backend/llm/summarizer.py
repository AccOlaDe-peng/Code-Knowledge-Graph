"""历史摘要压缩器，用于在上下文接近超限时将早期工具调用历史压缩为简洁摘要。"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class CompressionResult:
    """压缩结果。"""

    original_messages: list[dict]  # 原始消息列表
    compressed_messages: list[dict]  # 压缩后的消息列表
    summary: str  # 生成的摘要
    original_tokens: int  # 原始估算 token 数
    compressed_tokens: int  # 压缩后估算 token 数
    compression_ratio: float  # 压缩比例


class HistorySummarizer:
    """历史摘要压缩器。

    当上下文使用率达到阈值时，使用 LLM 将早期工具调用历史压缩为简洁摘要，
    保留关键信息（已分析的文件、发现的类/方法、识别的依赖关系等）。

    压缩策略：
    1. 保留最初的 N 条消息（任务说明）
    2. 保留最近的 M 轮对话
    3. 中间部分使用 LLM 生成摘要替换

    降级策略：
    - 如果 LLM 调用失败，降级为滑动窗口策略（简单截断）
    """

    SUMMARY_PROMPT = """你是一个代码分析助手。请将以下工具调用历史压缩为简洁的摘要。

## 要求
1. 保留关键发现：已分析的文件、发现的类/方法、识别的依赖关系
2. 保留未完成项：待确认的问题、未探索的路径
3. 省略具体代码内容，只保留结构信息
4. 使用简洁的列表格式

## 工具调用历史
{history}

## 输出格式
直接输出摘要文本，不要 JSON 或代码块。"""

    # Token 估算系数（中文约 1.5 字符/token，英文约 4 字符/token）
    AVG_CHARS_PER_TOKEN = 3.0

    def __init__(
        self,
        llm_client: Any,
        max_summary_tokens: int = 2000,
        keep_recent: int = 4,
        keep_first: int = 1,
    ) -> None:
        """初始化历史摘要压缩器。

        Args:
            llm_client: LLM 客户端实例，需支持 complete(prompt, system) 方法。
            max_summary_tokens: 摘要最大 token 数，默认 2000。
            keep_recent: 保留最近的消息轮数，默认 4 轮。
            keep_first: 保留最初的消息条数，默认 1 条。
        """
        self.llm_client = llm_client
        self.max_summary_tokens = max_summary_tokens
        self.keep_recent = keep_recent
        self.keep_first = keep_first

    def should_compress(
        self,
        messages: list[dict],
        current_tokens: int,
        threshold_ratio: float = 0.7,
        min_messages: int = 6,
    ) -> bool:
        """判断是否需要压缩。

        条件：
        1. 消息数量 >= min_messages
        2. 当前 token 使用率 >= threshold_ratio

        Args:
            messages: 消息列表。
            current_tokens: 当前 token 使用量。
            threshold_ratio: 触发压缩的阈值比例，默认 0.7。
            min_messages: 最小消息数量，默认 6。

        Returns:
            True 表示需要压缩。
        """
        if len(messages) < min_messages:
            return False

        # 估算上下文窗口大小（基于当前使用量）
        # 假设 threshold_ratio 对应 70% 的使用量，反推最大上下文
        if threshold_ratio <= 0:
            return False

        max_context = int(current_tokens / threshold_ratio)
        usage_ratio = current_tokens / max_context if max_context > 0 else 0

        return usage_ratio >= threshold_ratio

    def compress(self, messages: list[dict]) -> CompressionResult:
        """压缩消息历史。

        Args:
            messages: 原始消息列表。

        Returns:
            CompressionResult 包含压缩前后的消息和统计信息。
        """
        original_tokens = self._estimate_tokens(messages)

        if len(messages) <= self.keep_first + self.keep_recent * 2:
            # 消息数量不足，无需压缩
            return CompressionResult(
                original_messages=messages,
                compressed_messages=messages.copy(),
                summary="",
                original_tokens=original_tokens,
                compressed_tokens=original_tokens,
                compression_ratio=1.0,
            )

        # 提取需要压缩的中间部分
        first_messages = messages[: self.keep_first]
        recent_count = self.keep_recent * 2  # 每轮约 2 条消息
        recent_messages = messages[-recent_count:]
        middle_messages = messages[self.keep_first : -recent_count]

        # 格式化中间部分为文本
        history_text = self._format_history(middle_messages)

        # 生成摘要
        try:
            summary = self._generate_summary(history_text)
        except Exception as e:
            logger.warning("LLM 摘要生成失败，降级为滑动窗口: %s", e)
            return self._fallback_sliding_window(messages)

        # 构建压缩后的消息列表
        summary_message = {
            "role": "user",
            "content": f"[历史摘要]\n{summary}",
        }
        compressed_messages = [*first_messages, summary_message, *recent_messages]

        compressed_tokens = self._estimate_tokens(compressed_messages)
        compression_ratio = compressed_tokens / original_tokens if original_tokens > 0 else 1.0

        logger.info(
            "历史压缩完成: %d -> %d 条消息, %d -> %d tokens (%.1f%%)",
            len(messages),
            len(compressed_messages),
            original_tokens,
            compressed_tokens,
            compression_ratio * 100,
        )

        return CompressionResult(
            original_messages=messages,
            compressed_messages=compressed_messages,
            summary=summary,
            original_tokens=original_tokens,
            compressed_tokens=compressed_tokens,
            compression_ratio=compression_ratio,
        )

    def _format_history(self, messages: list[dict]) -> str:
        """格式化消息历史为文本。

        Args:
            messages: 消息列表。

        Returns:
            格式化后的文本。
        """
        lines = []
        for i, msg in enumerate(messages, 1):
            role = msg.get("role", "unknown")
            content = msg.get("content", "")

            # 处理不同类型的内容
            if isinstance(content, str):
                text = content[:500]  # 截断长文本
            elif isinstance(content, list):
                # Anthropic 格式的 content blocks
                text_parts = []
                for block in content:
                    if isinstance(block, dict):
                        if block.get("type") == "text":
                            text_parts.append(block.get("text", "")[:200])
                        elif block.get("type") == "tool_use":
                            tool_name = block.get("name", "unknown")
                            tool_input = block.get("input", {})
                            text_parts.append(f"[Tool: {tool_name}]")
                        elif block.get("type") == "tool_result":
                            text_parts.append("[Tool Result]")
                text = " ".join(text_parts)[:500]
            else:
                text = str(content)[:500]

            lines.append(f"{i}. [{role}] {text}")

        return "\n".join(lines)

    def _generate_summary(self, history_text: str) -> str:
        """调用 LLM 生成摘要。

        Args:
            history_text: 格式化后的历史文本。

        Returns:
            生成的摘要。
        """
        prompt = self.SUMMARY_PROMPT.format(history=history_text)

        # 使用 LLM 客户端生成摘要
        summary = self.llm_client.complete(
            prompt=prompt,
            system="你是一个代码分析助手，擅长总结和压缩信息。",
            max_tokens=self.max_summary_tokens,
        )

        if not summary or not summary.strip():
            raise ValueError("LLM 返回空摘要")

        return summary.strip()

    def _fallback_sliding_window(self, messages: list[dict]) -> CompressionResult:
        """摘要失败时降级到滑动窗口。

        Args:
            messages: 原始消息列表。

        Returns:
            使用滑动窗口策略的 CompressionResult。
        """
        original_tokens = self._estimate_tokens(messages)

        # 简单滑动窗口：保留首消息 + 占位符 + 最近消息
        first_messages = messages[: self.keep_first]
        recent_count = self.keep_recent * 2
        recent_messages = messages[-recent_count:]

        placeholder = {
            "role": "user",
            "content": "[早期对话历史已被截断以适应上下文窗口]",
        }

        compressed_messages = [*first_messages, placeholder, *recent_messages]
        compressed_tokens = self._estimate_tokens(compressed_messages)
        compression_ratio = compressed_tokens / original_tokens if original_tokens > 0 else 1.0

        logger.info(
            "降级滑动窗口: %d -> %d 条消息, %d -> %d tokens (%.1f%%)",
            len(messages),
            len(compressed_messages),
            original_tokens,
            compressed_tokens,
            compression_ratio * 100,
        )

        return CompressionResult(
            original_messages=messages,
            compressed_messages=compressed_messages,
            summary="[滑动窗口截断]",
            original_tokens=original_tokens,
            compressed_tokens=compressed_tokens,
            compression_ratio=compression_ratio,
        )

    def _estimate_tokens(self, messages: list[dict]) -> int:
        """估算消息列表的 token 数量。

        使用简单的字符计数估算。

        Args:
            messages: 消息列表。

        Returns:
            估算的 token 数量。
        """
        total_chars = 0

        for msg in messages:
            # 计算角色
            total_chars += len(msg.get("role", ""))

            # 计算内容
            content = msg.get("content", "")
            if isinstance(content, str):
                total_chars += len(content)
            elif isinstance(content, list):
                for block in content:
                    if isinstance(block, dict):
                        total_chars += len(str(block))
                    else:
                        total_chars += len(str(block))
            else:
                total_chars += len(str(content))

            # 计算其他字段（如 tool_call_id 等）
            for key, value in msg.items():
                if key not in ("role", "content"):
                    total_chars += len(str(value))

        return int(total_chars / self.AVG_CHARS_PER_TOKEN)
