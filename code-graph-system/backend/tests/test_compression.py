"""测试 pre-flight token 估算和分级压缩函数。"""

import pytest
from backend.llm.client import (
    _estimate_tokens,
    _apply_compression,
    _compress_large_tool_results,
    _dispatch_tool,
    COMPRESSED_PLACEHOLDER,
)


class TestEstimateTokens:
    def test_empty(self):
        assert _estimate_tokens("", []) == 0

    def test_system_prompt_included(self):
        system = "a" * 400  # 400 bytes UTF-8
        assert _estimate_tokens(system, []) == 100  # 400 // 4

    def test_string_message_content(self):
        messages = [{"role": "user", "content": "a" * 400}]
        assert _estimate_tokens("", messages) == 100

    def test_list_message_content(self):
        messages = [{"role": "user", "content": [{"type": "tool_result", "content": "a" * 400}]}]
        result = _estimate_tokens("", messages)
        assert result > 0

    def test_chinese_text_more_bytes(self):
        chinese = "中" * 100  # 300 bytes
        assert _estimate_tokens(chinese, []) == 75


class TestCompressLargeToolResults:
    def _tool_result_msg(self, content: str, tool_use_id: str = "tu_1") -> dict:
        return {
            "role": "user",
            "content": [
                {"type": "tool_result", "tool_use_id": tool_use_id, "content": content}
            ],
        }

    def test_small_result_not_compressed(self):
        msg = self._tool_result_msg("short content")
        result = _compress_large_tool_results([msg], max_chars=2000)
        assert result[0]["content"][0]["content"] == "short content"

    def test_large_result_replaced_with_placeholder(self):
        large = "x" * 3000
        msg = self._tool_result_msg(large)
        result = _compress_large_tool_results([msg], max_chars=2000)
        assert result[0]["content"][0]["content"] == COMPRESSED_PLACEHOLDER

    def test_tool_use_id_preserved(self):
        large = "x" * 3000
        msg = self._tool_result_msg(large, tool_use_id="my_id_123")
        result = _compress_large_tool_results([msg], max_chars=2000)
        assert result[0]["content"][0]["tool_use_id"] == "my_id_123"

    def test_assistant_message_untouched(self):
        assistant_msg = {
            "role": "assistant",
            "content": [{"type": "tool_use", "id": "tu_1", "name": "read_file", "input": {}}],
        }
        result = _compress_large_tool_results([assistant_msg], max_chars=10)
        assert result[0] == assistant_msg

    def test_skip_first_skips_index_0(self):
        first = self._tool_result_msg("x" * 3000, "tu_0")
        second = self._tool_result_msg("x" * 3000, "tu_1")
        result = _compress_large_tool_results([first, second], max_chars=2000, skip_first=True)
        assert result[0]["content"][0]["content"] == "x" * 3000
        assert result[1]["content"][0]["content"] == COMPRESSED_PLACEHOLDER

    def test_list_content_skipped(self):
        msg = {
            "role": "user",
            "content": [
                {"type": "tool_result", "tool_use_id": "tu_1", "content": [{"type": "text", "text": "x" * 3000}]}
            ],
        }
        result = _compress_large_tool_results([msg], max_chars=2000)
        assert isinstance(result[0]["content"][0]["content"], list)


class TestApplyCompression:
    def _make_messages(self, n_rounds: int = 6) -> list[dict]:
        msgs = [{"role": "user", "content": "start task"}]
        for i in range(n_rounds):
            msgs.append({
                "role": "assistant",
                "content": [{"type": "tool_use", "id": f"tu_{i}", "name": "read_file", "input": {}}],
            })
            msgs.append({
                "role": "user",
                "content": [
                    {"type": "tool_result", "tool_use_id": f"tu_{i}", "content": "x" * 3000}
                ],
            })
        return msgs

    def test_level1_reduces_message_count(self):
        msgs = self._make_messages(n_rounds=6)
        compressed = _apply_compression(msgs, level=1)
        assert len(compressed) < len(msgs)

    def test_level2_compresses_tool_results(self):
        msgs = self._make_messages(n_rounds=6)
        compressed = _apply_compression(msgs, level=2)
        tool_result_contents = [
            b["content"]
            for m in compressed
            for b in (m.get("content", []) if isinstance(m.get("content"), list) else [])
            if isinstance(b, dict) and b.get("type") == "tool_result"
        ]
        assert all(c == COMPRESSED_PLACEHOLDER for c in tool_result_contents)

    def test_level3_keeps_at_most_first_plus_1_round(self):
        msgs = self._make_messages(n_rounds=6)
        compressed = _apply_compression(msgs, level=3)
        assert len(compressed) <= 4

    def test_level3_tool_use_tool_result_paired(self):
        msgs = self._make_messages(n_rounds=3)
        compressed = _apply_compression(msgs, level=3)
        tool_use_ids = set()
        tool_result_ids = set()
        for m in compressed:
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
        assert tool_use_ids == tool_result_ids


class TestDispatchTool:
    def test_dedicated_executor_takes_priority(self):
        class DedicatedExec:
            def my_tool(self, x): return {"from": "dedicated", "x": x}

        class FallbackExec:
            def my_tool(self, x): return {"from": "fallback", "x": x}

        result = _dispatch_tool("my_tool", {"x": 1}, {"my_tool": DedicatedExec()}, FallbackExec())
        assert result["from"] == "dedicated"

    def test_fallback_to_tool_executor(self):
        class FallbackExec:
            def my_tool(self, x): return {"from": "fallback", "x": x}

        result = _dispatch_tool("my_tool", {"x": 1}, {}, FallbackExec())
        assert result["from"] == "fallback"

    def test_raises_when_no_executor_found(self):
        with pytest.raises(ValueError, match="No executor found"):
            _dispatch_tool("unknown_tool", {}, {}, None)
