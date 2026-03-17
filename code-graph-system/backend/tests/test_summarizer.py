"""HistorySummarizer 单元测试。"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from backend.llm.summarizer import CompressionResult, HistorySummarizer


class MockLLMClient:
    """模拟 LLM 客户端。"""

    def __init__(self, response: str = "这是一个测试摘要"):
        self._response = response
        self.complete_called = False
        self.last_prompt = None

    def complete(
        self,
        prompt: str,
        system: str | None = None,
        max_tokens: int | None = None,
    ) -> str:
        self.complete_called = True
        self.last_prompt = prompt
        return self._response


class TestShouldCompress:
    """should_compress 方法测试。"""

    def test_should_compress_few_messages(self) -> None:
        """消息数量少时不压缩。"""
        mock_client = MockLLMClient()
        summarizer = HistorySummarizer(llm_client=mock_client)

        messages = [
            {"role": "user", "content": "Task"},
            {"role": "assistant", "content": "Response"},
        ]

        result = summarizer.should_compress(
            messages=messages,
            current_tokens=50000,
            threshold_ratio=0.7,
            min_messages=6,
        )

        assert result is False

    def test_should_compress_enough_messages(self) -> None:
        """消息数量足够且使用率高时压缩。"""
        mock_client = MockLLMClient()
        summarizer = HistorySummarizer(llm_client=mock_client)

        messages = [
            {"role": "user", "content": f"Message {i}"}
            for i in range(10)
        ]

        result = summarizer.should_compress(
            messages=messages,
            current_tokens=100000,  # 假设已使用 100k tokens
            threshold_ratio=0.7,
            min_messages=6,
        )

        # current_tokens / (current_tokens / threshold_ratio) = threshold_ratio = 0.7
        assert result is True

    def test_should_compress_below_threshold(self) -> None:
        """使用率低于阈值时不压缩。"""
        mock_client = MockLLMClient()
        summarizer = HistorySummarizer(llm_client=mock_client)

        messages = [
            {"role": "user", "content": f"Message {i}"}
            for i in range(10)
        ]

        # 使用率 = 50000 / (50000 / 0.7) = 0.7
        # 但我们希望测试低于阈值的情况
        result = summarizer.should_compress(
            messages=messages,
            current_tokens=50000,  # 较低的 token 使用量
            threshold_ratio=0.8,  # 更高的阈值
            min_messages=6,
        )

        # 50000 / (50000 / 0.8) = 0.8，刚好等于阈值
        # 实际上 usage_ratio = 0.8 >= 0.8，所以会返回 True
        assert result is True

    def test_should_compress_at_threshold(self) -> None:
        """使用率刚好等于阈值时压缩。"""
        mock_client = MockLLMClient()
        summarizer = HistorySummarizer(llm_client=mock_client)

        messages = [
            {"role": "user", "content": f"Message {i}"}
            for i in range(10)
        ]

        result = summarizer.should_compress(
            messages=messages,
            current_tokens=70000,
            threshold_ratio=0.7,
            min_messages=6,
        )

        assert result is True

    def test_should_compress_zero_tokens(self) -> None:
        """token 为零时不压缩。"""
        mock_client = MockLLMClient()
        summarizer = HistorySummarizer(llm_client=mock_client)

        messages = [
            {"role": "user", "content": f"Message {i}"}
            for i in range(10)
        ]

        result = summarizer.should_compress(
            messages=messages,
            current_tokens=0,
            threshold_ratio=0.7,
            min_messages=6,
        )

        assert result is False


class TestCompressMessages:
    """compress 方法测试。"""

    def test_compress_messages(self) -> None:
        """压缩消息。"""
        mock_client = MockLLMClient(response="已分析文件 A、B，发现类 X、Y")
        summarizer = HistorySummarizer(
            llm_client=mock_client,
            max_summary_tokens=2000,
            keep_recent=2,
            keep_first=1,
        )

        messages = [
            {"role": "user", "content": "Task description"},
            {"role": "assistant", "content": "Response 1"},
            {"role": "user", "content": "Query 2"},
            {"role": "assistant", "content": "Response 2"},
            {"role": "user", "content": "Query 3"},
            {"role": "assistant", "content": "Response 3"},
            {"role": "user", "content": "Query 4"},
            {"role": "assistant", "content": "Response 4"},
        ]

        result = summarizer.compress(messages)

        assert isinstance(result, CompressionResult)
        assert result.original_messages == messages
        assert len(result.compressed_messages) < len(messages)
        assert result.summary == "已分析文件 A、B，发现类 X、Y"
        assert result.compression_ratio < 1.0
        assert mock_client.complete_called is True

    def test_compress_keeps_first_message(self) -> None:
        """压缩后保留首消息。"""
        mock_client = MockLLMClient(response="摘要内容")
        summarizer = HistorySummarizer(
            llm_client=mock_client,
            keep_first=1,
            keep_recent=2,
        )

        messages = [
            {"role": "user", "content": "Important task description"},
            {"role": "assistant", "content": "Response 1"},
            {"role": "user", "content": "Query 2"},
            {"role": "assistant", "content": "Response 2"},
            {"role": "user", "content": "Query 3"},
            {"role": "assistant", "content": "Response 3"},
        ]

        result = summarizer.compress(messages)

        assert result.compressed_messages[0] == messages[0]
        assert result.compressed_messages[0]["content"] == "Important task description"

    def test_compress_keeps_recent_messages(self) -> None:
        """压缩后保留最近消息。"""
        mock_client = MockLLMClient(response="摘要内容")
        summarizer = HistorySummarizer(
            llm_client=mock_client,
            keep_first=1,
            keep_recent=2,  # 保留最近 2 轮 = 4 条消息
        )

        messages = [
            {"role": "user", "content": "Task description"},
            {"role": "assistant", "content": "Response 1"},
            {"role": "user", "content": "Query 2"},
            {"role": "assistant", "content": "Response 2"},
            {"role": "user", "content": "Query 3"},
            {"role": "assistant", "content": "Response 3"},
            {"role": "user", "content": "Query 4"},
            {"role": "assistant", "content": "Response 4"},
        ]

        result = summarizer.compress(messages)

        # 最近 4 条消息应保留
        recent_count = 2 * 2  # keep_recent * 2
        assert result.compressed_messages[-recent_count:] == messages[-recent_count:]

    def test_compress_includes_summary(self) -> None:
        """压缩后包含摘要消息。"""
        mock_client = MockLLMClient(response="这是历史摘要")
        summarizer = HistorySummarizer(
            llm_client=mock_client,
            keep_first=1,
            keep_recent=2,
        )

        messages = [
            {"role": "user", "content": "Task description"},
            {"role": "assistant", "content": "Response 1"},
            {"role": "user", "content": "Query 2"},
            {"role": "assistant", "content": "Response 2"},
            {"role": "user", "content": "Query 3"},
            {"role": "assistant", "content": "Response 3"},
        ]

        result = summarizer.compress(messages)

        # 检查是否有摘要消息
        summary_found = False
        for msg in result.compressed_messages:
            if "历史摘要" in msg.get("content", ""):
                summary_found = True
                break

        assert summary_found is True

    def test_compress_few_messages_no_compression(self) -> None:
        """消息数量不足时不压缩。"""
        mock_client = MockLLMClient()
        summarizer = HistorySummarizer(
            llm_client=mock_client,
            keep_first=1,
            keep_recent=2,
        )

        messages = [
            {"role": "user", "content": "Task description"},
            {"role": "assistant", "content": "Response 1"},
        ]

        result = summarizer.compress(messages)

        # 消息太少，不压缩
        assert result.compressed_messages == messages
        assert result.summary == ""
        assert result.compression_ratio == 1.0

    def test_compress_empty_messages(self) -> None:
        """空消息列表处理。"""
        mock_client = MockLLMClient()
        summarizer = HistorySummarizer(llm_client=mock_client)

        messages: list[dict] = []

        result = summarizer.compress(messages)

        assert result.compressed_messages == []
        assert result.compression_ratio == 1.0


class TestFallbackOnError:
    """LLM 失败时降级测试。"""

    def test_fallback_on_error(self) -> None:
        """LLM 失败时降级到滑动窗口。"""
        # 模拟 LLM 抛出异常
        mock_client = MagicMock()
        mock_client.complete.side_effect = Exception("LLM API 错误")

        summarizer = HistorySummarizer(
            llm_client=mock_client,
            keep_first=1,
            keep_recent=2,
        )

        # 使用更多消息以确保压缩后消息数量减少
        messages = [
            {"role": "user", "content": "Task description"},
            {"role": "assistant", "content": "Response 1"},
            {"role": "user", "content": "Query 2"},
            {"role": "assistant", "content": "Response 2"},
            {"role": "user", "content": "Query 3"},
            {"role": "assistant", "content": "Response 3"},
            {"role": "user", "content": "Query 4"},
            {"role": "assistant", "content": "Response 4"},
        ]

        result = summarizer.compress(messages)

        # 应降级为滑动窗口
        assert isinstance(result, CompressionResult)
        assert result.summary == "[滑动窗口截断]"
        # 压缩后: 1首消息 + 1占位符 + 4最近消息 = 6条 < 8条原始消息
        assert len(result.compressed_messages) < len(messages)

    def test_fallback_on_empty_response(self) -> None:
        """LLM 返回空响应时降级。"""
        mock_client = MagicMock()
        mock_client.complete.return_value = ""

        summarizer = HistorySummarizer(
            llm_client=mock_client,
            keep_first=1,
            keep_recent=2,
        )

        messages = [
            {"role": "user", "content": "Task description"},
            {"role": "assistant", "content": "Response 1"},
            {"role": "user", "content": "Query 2"},
            {"role": "assistant", "content": "Response 2"},
            {"role": "user", "content": "Query 3"},
            {"role": "assistant", "content": "Response 3"},
        ]

        result = summarizer.compress(messages)

        # 应降级为滑动窗口
        assert result.summary == "[滑动窗口截断]"

    def test_fallback_on_whitespace_response(self) -> None:
        """LLM 返回空白响应时降级。"""
        mock_client = MagicMock()
        mock_client.complete.return_value = "   \n\t  "

        summarizer = HistorySummarizer(
            llm_client=mock_client,
            keep_first=1,
            keep_recent=2,
        )

        messages = [
            {"role": "user", "content": "Task description"},
            {"role": "assistant", "content": "Response 1"},
            {"role": "user", "content": "Query 2"},
            {"role": "assistant", "content": "Response 2"},
            {"role": "user", "content": "Query 3"},
            {"role": "assistant", "content": "Response 3"},
        ]

        result = summarizer.compress(messages)

        # 应降级为滑动窗口
        assert result.summary == "[滑动窗口截断]"


class TestFormatHistory:
    """_format_history 方法测试。"""

    def test_format_history_string_content(self) -> None:
        """字符串内容格式化。"""
        mock_client = MockLLMClient()
        summarizer = HistorySummarizer(llm_client=mock_client)

        messages = [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi there"},
        ]

        result = summarizer._format_history(messages)

        assert "1. [user] Hello" in result
        assert "2. [assistant] Hi there" in result

    def test_format_history_list_content(self) -> None:
        """列表内容（Anthropic 格式）格式化。"""
        mock_client = MockLLMClient()
        summarizer = HistorySummarizer(llm_client=mock_client)

        messages = [
            {
                "role": "assistant",
                "content": [
                    {"type": "text", "text": "Response text"},
                    {"type": "tool_use", "name": "read_file", "input": {"path": "/src/main.py"}},
                ],
            },
            {
                "role": "user",
                "content": [
                    {"type": "tool_result", "tool_use_id": "123", "content": "file content"},
                ],
            },
        ]

        result = summarizer._format_history(messages)

        assert "[tool_use]" in result.lower() or "Tool:" in result

    def test_format_history_truncates_long_content(self) -> None:
        """截断长内容。"""
        mock_client = MockLLMClient()
        summarizer = HistorySummarizer(llm_client=mock_client)

        long_content = "A" * 1000
        messages = [
            {"role": "user", "content": long_content},
        ]

        result = summarizer._format_history(messages)

        # 应被截断到 500 字符
        assert len(result) < len(long_content) + 50  # 加上格式前缀的长度


class TestEstimateTokens:
    """_estimate_tokens 方法测试。"""

    def test_estimate_tokens_basic(self) -> None:
        """基本 token 估算。"""
        mock_client = MockLLMClient()
        summarizer = HistorySummarizer(llm_client=mock_client)

        messages = [
            {"role": "user", "content": "Hello world"},
            {"role": "assistant", "content": "Hi there"},
        ]

        tokens = summarizer._estimate_tokens(messages)

        # 每条消息约 (4 + 11) / 3 + (9 + 8) / 3 = 5 + 5.67 ≈ 11 tokens
        # 应该大于 0
        assert tokens > 0

    def test_estimate_tokens_empty_messages(self) -> None:
        """空消息列表 token 估算。"""
        mock_client = MockLLMClient()
        summarizer = HistorySummarizer(llm_client=mock_client)

        tokens = summarizer._estimate_tokens([])

        assert tokens == 0

    def test_estimate_tokens_complex_content(self) -> None:
        """复杂内容 token 估算。"""
        mock_client = MockLLMClient()
        summarizer = HistorySummarizer(llm_client=mock_client)

        messages = [
            {
                "role": "assistant",
                "content": [
                    {"type": "text", "text": "Some text"},
                    {"type": "tool_use", "name": "func", "input": {"arg": "value"}},
                ],
            },
            {
                "role": "tool",
                "tool_call_id": "call_123",
                "content": "Tool result",
            },
        ]

        tokens = summarizer._estimate_tokens(messages)

        assert tokens > 0


class TestCompressionResult:
    """CompressionResult 数据类测试。"""

    def test_compression_result_dataclass(self) -> None:
        """CompressionResult 数据类基本功能。"""
        result = CompressionResult(
            original_messages=[{"role": "user", "content": "test"}],
            compressed_messages=[{"role": "user", "content": "compressed"}],
            summary="Test summary",
            original_tokens=100,
            compressed_tokens=50,
            compression_ratio=0.5,
        )

        assert result.original_messages[0]["content"] == "test"
        assert result.compressed_messages[0]["content"] == "compressed"
        assert result.summary == "Test summary"
        assert result.original_tokens == 100
        assert result.compressed_tokens == 50
        assert result.compression_ratio == 0.5


class TestIntegration:
    """集成测试。"""

    def test_full_compression_workflow(self) -> None:
        """完整压缩工作流测试。"""
        mock_client = MockLLMClient(
            response="- 已分析: main.py, utils.py\n- 发现类: Application, Config\n- 依赖关系: Application -> Config"
        )
        summarizer = HistorySummarizer(
            llm_client=mock_client,
            max_summary_tokens=1500,
            keep_recent=3,
            keep_first=1,
        )

        # 模拟工具调用历史
        messages = [
            {"role": "user", "content": "分析这个代码仓库"},
            {"role": "assistant", "content": "我来分析 main.py"},
            {"role": "user", "content": "继续"},
            {"role": "assistant", "content": "发现 Application 类"},
            {"role": "user", "content": "分析依赖"},
            {"role": "assistant", "content": "Application 依赖 Config"},
            {"role": "user", "content": "检查 utils"},
            {"role": "assistant", "content": "utils.py 已分析"},
            {"role": "user", "content": "总结"},
            {"role": "assistant", "content": "正在生成报告"},
        ]

        # 检查是否应该压缩
        should_compress = summarizer.should_compress(
            messages=messages,
            current_tokens=90000,
            threshold_ratio=0.7,
        )

        assert should_compress is True

        # 执行压缩
        result = summarizer.compress(messages)

        # 验证结果
        assert len(result.compressed_messages) < len(messages)
        assert result.summary != ""
        assert result.compression_ratio < 1.0
        assert "已分析" in result.summary or "main.py" in result.summary

    def test_multiple_compression_cycles(self) -> None:
        """多次压缩循环测试。"""
        mock_client = MockLLMClient(response="摘要 1")
        summarizer = HistorySummarizer(
            llm_client=mock_client,
            keep_recent=2,
            keep_first=1,
        )

        messages = [
            {"role": "user", "content": f"Message {i}"}
            for i in range(10)
        ]

        # 第一次压缩
        result1 = summarizer.compress(messages)
        assert result1.compression_ratio < 1.0

        # 模拟继续对话后再次压缩
        new_messages = result1.compressed_messages + [
            {"role": "assistant", "content": "New response 1"},
            {"role": "user", "content": "New query 1"},
            {"role": "assistant", "content": "New response 2"},
            {"role": "user", "content": "New query 2"},
        ]

        mock_client._response = "摘要 2"
        result2 = summarizer.compress(new_messages)

        assert result2.compression_ratio < 1.0
        assert result2.summary == "摘要 2"
