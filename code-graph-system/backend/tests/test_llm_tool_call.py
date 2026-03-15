# code-graph-system/backend/tests/test_llm_tool_call.py
"""测试 LLM 工具调用循环。"""


def test_tool_call_loop_with_mock():
    """测试 tool_call_loop 可以执行（使用 mock）。"""
    from unittest.mock import MagicMock, patch
    from backend.llm.client import LLMClient
    from backend.llm.types import ToolCallLoopResult

    client = LLMClient(
        provider="anthropic",
        model="claude-sonnet-4-6",
        api_key="test-key"
    )

    # Mock Anthropic 客户端
    with patch.object(client, '_get_client') as mock_get_client:
        mock_anthropic = MagicMock()

        # 模拟第一次响应：工具调用
        mock_tool_use = MagicMock()
        mock_tool_use.type = "tool_use"
        mock_tool_use.id = "tool_123"
        mock_tool_use.name = "read_file"
        mock_tool_use.input = {"path": "main.py"}

        mock_response_1 = MagicMock()
        mock_response_1.stop_reason = "tool_use"
        mock_response_1.content = [mock_tool_use]

        # 模拟第二次响应：最终消息
        mock_text = MagicMock()
        mock_text.type = "text"
        mock_text.text = '{"nodes": [], "edges": []}'

        mock_response_2 = MagicMock()
        mock_response_2.stop_reason = "end_turn"
        mock_response_2.content = [mock_text]

        mock_anthropic.messages.create.side_effect = [
            mock_response_1,
            mock_response_2
        ]

        mock_get_client.return_value = mock_anthropic

        # 执行 tool_call_loop
        result = client.tool_call_loop(
            system="You are a code analyzer.",
            messages=[{"role": "user", "content": "Analyze this repo"}],
            tools=[{
                "name": "read_file",
                "description": "Read a file",
                "input_schema": {"type": "object", "properties": {"path": {"type": "string"}}}
            }],
            max_iterations=5
        )

        assert isinstance(result, ToolCallLoopResult)
        assert result.status == "completed"
        assert len(result.tool_calls) == 1
        assert result.tool_calls[0].tool_name == "read_file"


def test_tool_call_loop_with_executor():
    """测试 tool_call_loop 可以使用执行器。"""
    from unittest.mock import MagicMock, patch
    from backend.llm.client import LLMClient

    client = LLMClient(provider="anthropic", api_key="test")

    # 创建工具执行器
    class MockExecutor:
        def read_file(self, path: str) -> dict:
            return {"content": f"# Content of {path}"}

    executor = MockExecutor()

    with patch.object(client, '_get_client') as mock_get_client:
        mock_anthropic = MagicMock()

        # 模拟工具调用响应
        mock_tool_use = MagicMock()
        mock_tool_use.type = "tool_use"
        mock_tool_use.id = "tool_123"
        mock_tool_use.name = "read_file"
        mock_tool_use.input = {"path": "main.py"}

        mock_response_1 = MagicMock()
        mock_response_1.stop_reason = "tool_use"
        mock_response_1.content = [mock_tool_use]

        # 模拟最终响应
        mock_text = MagicMock()
        mock_text.type = "text"
        mock_text.text = '{"result": "done"}'

        mock_response_2 = MagicMock()
        mock_response_2.stop_reason = "end_turn"
        mock_response_2.content = [mock_text]

        mock_anthropic.messages.create.side_effect = [
            mock_response_1,
            mock_response_2
        ]

        mock_get_client.return_value = mock_anthropic

        result = client.tool_call_loop(
            system="Test",
            messages=[{"role": "user", "content": "Test"}],
            tools=[{
                "name": "read_file",
                "description": "Read file",
                "input_schema": {"type": "object", "properties": {"path": {"type": "string"}}}
            }],
            tool_executor=executor,
            max_iterations=5
        )

        # 验证执行器被调用，工具输出包含正确内容
        assert result.status == "completed"
        assert result.tool_calls[0].tool_output["content"] == "# Content of main.py"
