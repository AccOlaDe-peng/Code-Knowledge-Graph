"""SlidingWindow 单元测试。"""

from __future__ import annotations

import pytest

from backend.llm.sliding_window import SlidingWindow


class TestSlidingWindow:
    """SlidingWindow 测试用例。"""

    def test_no_truncation_when_messages_few(self) -> None:
        """消息数量少时不裁剪。"""
        window = SlidingWindow(keep_recent_rounds=5, keep_first_messages=1)
        messages = [
            {"role": "user", "content": "Task description"},
            {"role": "assistant", "content": "Response 1"},
            {"role": "user", "content": "Query 2"},
            {"role": "assistant", "content": "Response 2"},
        ]

        result, truncated = window.apply(messages, provider="anthropic")

        assert truncated is False
        assert result == messages
        assert len(result) == 4

    def test_truncation_applied(self) -> None:
        """消息数量多时进行裁剪。"""
        window = SlidingWindow(keep_recent_rounds=2, keep_first_messages=1)
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

        result, truncated = window.apply(messages, provider="anthropic")

        assert truncated is True
        # 应保留：第一条消息 + 占位符 + 最近2轮（4条消息）= 6条
        assert len(result) == 6

    def test_keeps_first_message(self) -> None:
        """保留第一条消息。"""
        window = SlidingWindow(keep_recent_rounds=2, keep_first_messages=1)
        messages = [
            {"role": "user", "content": "Important task description"},
            {"role": "assistant", "content": "Response 1"},
            {"role": "user", "content": "Query 2"},
            {"role": "assistant", "content": "Response 2"},
            {"role": "user", "content": "Query 3"},
            {"role": "assistant", "content": "Response 3"},
        ]

        result, truncated = window.apply(messages, provider="anthropic")

        assert result[0] == messages[0]
        assert result[0]["content"] == "Important task description"

    def test_keeps_recent_messages(self) -> None:
        """保留最近的消息。"""
        window = SlidingWindow(keep_recent_rounds=2, keep_first_messages=1)
        messages = [
            {"role": "user", "content": "Task description"},
            {"role": "assistant", "content": "Response 1"},
            {"role": "user", "content": "Query 2"},
            {"role": "assistant", "content": "Response 2"},
            {"role": "user", "content": "Query 3"},
            {"role": "assistant", "content": "Response 3"},
        ]

        result, truncated = window.apply(messages, provider="anthropic")

        # 最近的2轮应该是最后4条消息
        assert result[-4] == messages[-4]  # Query 2
        assert result[-3] == messages[-3]  # Response 2
        assert result[-2] == messages[-2]  # Query 3
        assert result[-1] == messages[-1]  # Response 3

    def test_placeholder_message(self) -> None:
        """裁剪后包含占位符消息。"""
        window = SlidingWindow(keep_recent_rounds=2, keep_first_messages=1)
        messages = [
            {"role": "user", "content": "Task description"},
            {"role": "assistant", "content": "Response 1"},
            {"role": "user", "content": "Query 2"},
            {"role": "assistant", "content": "Response 2"},
            {"role": "user", "content": "Query 3"},
            {"role": "assistant", "content": "Response 3"},
        ]

        result, truncated = window.apply(messages, provider="anthropic")

        # 第二条应该是占位符
        assert truncated is True
        assert result[1]["role"] == "user"
        assert "truncated" in result[1]["content"].lower() or "omitted" in result[1]["content"].lower()

    def test_openai_format(self) -> None:
        """OpenAI 格式消息处理。"""
        window = SlidingWindow(keep_recent_rounds=2, keep_first_messages=1)
        messages = [
            {"role": "user", "content": "Task description"},
            {"role": "assistant", "content": "Response 1"},
            {"role": "tool", "content": "Tool result 1", "tool_call_id": "call_1"},
            {"role": "assistant", "content": "Response 2"},
            {"role": "tool", "content": "Tool result 2", "tool_call_id": "call_2"},
            {"role": "assistant", "content": "Response 3"},
            {"role": "tool", "content": "Tool result 3", "tool_call_id": "call_3"},
        ]

        result, truncated = window.apply(messages, provider="openai")

        assert truncated is True
        # 保留第一条 + 占位符 + 最近2轮（assistant + tool 各2条 = 4条）= 6条
        assert len(result) == 6
        assert result[0] == messages[0]

    def test_openai_format_no_truncation(self) -> None:
        """OpenAI 格式消息数量少时不裁剪。"""
        window = SlidingWindow(keep_recent_rounds=5, keep_first_messages=1)
        messages = [
            {"role": "user", "content": "Task description"},
            {"role": "assistant", "content": "Response 1"},
            {"role": "tool", "content": "Tool result 1", "tool_call_id": "call_1"},
        ]

        result, truncated = window.apply(messages, provider="openai")

        assert truncated is False
        assert result == messages

    def test_keep_first_messages_multiple(self) -> None:
        """保留多条首消息。"""
        window = SlidingWindow(keep_recent_rounds=1, keep_first_messages=2)
        messages = [
            {"role": "user", "content": "Task description"},
            {"role": "assistant", "content": "Initial context"},
            {"role": "user", "content": "Query 1"},
            {"role": "assistant", "content": "Response 1"},
            {"role": "user", "content": "Query 2"},
            {"role": "assistant", "content": "Response 2"},
        ]

        result, truncated = window.apply(messages, provider="anthropic")

        assert result[0] == messages[0]
        assert result[1] == messages[1]

    def test_empty_messages(self) -> None:
        """空消息列表处理。"""
        window = SlidingWindow(keep_recent_rounds=5, keep_first_messages=1)
        messages: list[dict] = []

        result, truncated = window.apply(messages, provider="anthropic")

        assert truncated is False
        assert result == []

    def test_single_message(self) -> None:
        """单条消息不裁剪。"""
        window = SlidingWindow(keep_recent_rounds=5, keep_first_messages=1)
        messages = [
            {"role": "user", "content": "Single message"},
        ]

        result, truncated = window.apply(messages, provider="anthropic")

        assert truncated is False
        assert result == messages

    def test_exactly_at_boundary(self) -> None:
        """刚好在边界上不裁剪。"""
        window = SlidingWindow(keep_recent_rounds=2, keep_first_messages=1)
        # 1条首消息 + 2轮（4条）= 5条，刚好等于 keep_recent_rounds * 2 + keep_first_messages
        messages = [
            {"role": "user", "content": "Task description"},
            {"role": "assistant", "content": "Response 1"},
            {"role": "user", "content": "Query 2"},
            {"role": "assistant", "content": "Response 2"},
        ]

        result, truncated = window.apply(messages, provider="anthropic")

        # 4条消息 = 1首消息 + 1.5轮，不超过2轮，不应裁剪
        assert truncated is False
        assert result == messages

    def test_placeholder_in_openai_format(self) -> None:
        """OpenAI 格式占位符消息。"""
        window = SlidingWindow(keep_recent_rounds=1, keep_first_messages=1)
        messages = [
            {"role": "user", "content": "Task description"},
            {"role": "assistant", "content": "Response 1"},
            {"role": "tool", "content": "Tool result 1", "tool_call_id": "call_1"},
            {"role": "assistant", "content": "Response 2"},
            {"role": "tool", "content": "Tool result 2", "tool_call_id": "call_2"},
        ]

        result, truncated = window.apply(messages, provider="openai")

        assert truncated is True
        # 占位符在 OpenAI 格式中应为 user 角色
        assert result[1]["role"] == "user"

    def test_default_parameters(self) -> None:
        """默认参数值。"""
        window = SlidingWindow()

        assert window.keep_recent_rounds == 5
        assert window.keep_first_messages == 1

    def test_count_rounds_anthropic(self) -> None:
        """测试 Anthropic 格式的轮次计算。"""
        window = SlidingWindow()

        messages = [
            {"role": "user", "content": "User 1"},
            {"role": "assistant", "content": "Assistant 1"},
            {"role": "user", "content": "User 2"},
            {"role": "assistant", "content": "Assistant 2"},
        ]

        # 2轮 = 2个 assistant 消息
        rounds = window._count_rounds(messages, "anthropic")
        assert rounds == 2

    def test_count_rounds_openai(self) -> None:
        """测试 OpenAI 格式的轮次计算。"""
        window = SlidingWindow()

        messages = [
            {"role": "user", "content": "User 1"},
            {"role": "assistant", "content": "Assistant 1"},
            {"role": "tool", "content": "Tool 1", "tool_call_id": "call_1"},
            {"role": "assistant", "content": "Assistant 2"},
            {"role": "tool", "content": "Tool 2", "tool_call_id": "call_2"},
        ]

        # 2轮 = 2个 assistant 消息
        rounds = window._count_rounds(messages, "openai")
        assert rounds == 2


class TestSlidingWindowPairingHeal:
    """验证 apply() 的配对完整性自愈逻辑。"""

    def _make_tool_round(self, tool_use_id: str = "tu_1") -> list[dict]:
        """构造一轮完整的 tool_use / tool_result 消息对。"""
        return [
            {
                "role": "assistant",
                "content": [
                    {"type": "tool_use", "id": tool_use_id, "name": "read_file", "input": {"path": "x.py"}}
                ],
            },
            {
                "role": "user",
                "content": [
                    {"type": "tool_result", "tool_use_id": tool_use_id, "content": "file content"}
                ],
            },
        ]

    def test_normal_truncation_keeps_pairs(self):
        """正常截断时，tool_use 和 tool_result 应始终成对。"""
        first_msg = {"role": "user", "content": "analyze this repo"}
        rounds = []
        for i in range(4):
            rounds += self._make_tool_round(f"tu_{i}")
        messages = [first_msg] + rounds

        sw = SlidingWindow(keep_recent_rounds=2, keep_first_messages=1)
        result, truncated = sw.apply(messages, "anthropic")

        assert truncated is True
        # Collect tool_use ids and tool_result ids from result
        tool_use_ids = set()
        tool_result_ids = set()
        for m in result:
            content = m.get("content", [])
            if not isinstance(content, list):
                continue
            for b in content:
                if not isinstance(b, dict):
                    continue
                if b.get("type") == "tool_use":
                    tool_use_ids.add(b.get("id"))
                elif b.get("type") == "tool_result":
                    tool_result_ids.add(b.get("tool_use_id"))
        # All tool_use ids must have matching tool_result ids
        assert tool_use_ids == tool_result_ids, f"Unpaired: tool_use={tool_use_ids}, tool_result={tool_result_ids}"

    def test_heal_removes_orphan_tool_result(self):
        """若截断后第一条非首消息是孤立 tool_result，应自动跳过。"""
        # Construct a scenario where odd-numbered message split would create an orphan
        # We'll create messages where keep_recent_rounds=1 (2 messages) from the end
        # but the first of those 2 is a tool_result (orphan) not a tool_use
        first_msg = {"role": "user", "content": "start task"}
        # Create rounds where after keep_first + placeholder + 2 recent msgs,
        # the boundary falls at a tool_result message
        orphan_tool_result = {
            "role": "user",
            "content": [
                {"type": "tool_result", "tool_use_id": "orphan_id", "content": "some result"}
            ],
        }
        normal_round = self._make_tool_round("normal_tu")
        # messages: [first, orphan_tool_result, normal_assistant, normal_user]
        # With keep_recent_rounds=1 and keep_first=1:
        # keeps first[0:1] + placeholder + last 2 messages = [normal_assistant, normal_user]
        # This should be fine - but test the healing logic
        messages = [first_msg] + [orphan_tool_result] + normal_round

        sw = SlidingWindow(keep_recent_rounds=1, keep_first_messages=1)
        result, _ = sw.apply(messages, "anthropic")

        # Verify no orphaned tool_result at first position after placeholder
        non_first = [m for m in result
                     if m.get("content") != SlidingWindow.PLACEHOLDER_CONTENT
                     and m.get("content") != first_msg.get("content")]
        for m in non_first:
            content = m.get("content", [])
            if not isinstance(content, list):
                continue
            block_types = [b.get("type") for b in content if isinstance(b, dict)]
            # A user message with only tool_result blocks should not be orphaned
            # (i.e., there should be a corresponding tool_use somewhere before it)
            if "tool_result" in block_types and m.get("role") == "user":
                # Find the tool_use_id referenced
                for b in content:
                    if isinstance(b, dict) and b.get("type") == "tool_result":
                        tu_id = b.get("tool_use_id")
                        # Check that a tool_use with this id exists somewhere
                        found = any(
                            isinstance(blk, dict) and blk.get("id") == tu_id
                            for msg in result
                            for blk in (msg.get("content", []) if isinstance(msg.get("content"), list) else [])
                        )
                        assert found, f"Orphan tool_result referencing {tu_id} not paired with tool_use"
