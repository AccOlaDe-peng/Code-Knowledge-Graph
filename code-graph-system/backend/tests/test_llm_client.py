# code-graph-system/backend/tests/test_llm_client.py
"""测试 LLM 客户端。"""


def test_llm_client_initialization():
    """测试 LLMClient 可以初始化。"""
    from backend.llm.client import LLMClient

    client = LLMClient(
        provider="anthropic",
        model="claude-sonnet-4-6",
        api_key="test-key"
    )

    assert client.provider == "anthropic"
    assert client.model == "claude-sonnet-4-6"


def test_llm_client_default_model():
    """测试 LLMClient 默认模型选择。"""
    from backend.llm.client import LLMClient

    # Anthropic 默认
    client = LLMClient(provider="anthropic", api_key="test")
    assert client.model == "claude-sonnet-4-6"

    # OpenAI 默认
    client = LLMClient(provider="openai", api_key="test")
    assert client.model == "gpt-4o"


def test_tool_call_result_creation():
    """测试 ToolCallLoopResult 可以创建。"""
    from backend.llm.types import ToolCallLoopResult, ToolCallRecord

    result = ToolCallLoopResult(
        status="completed",
        final_message='{"nodes": [], "edges": []}',
        tool_calls=[
            ToolCallRecord(
                iteration=1,
                tool_name="read_file",
                tool_input={"path": "main.py"},
                tool_output={"content": "# main file"},
                success=True,
                execution_time_ms=100
            )
        ],
        total_tokens=1000,
        iterations=1
    )

    assert result.status == "completed"
    assert len(result.tool_calls) == 1
    assert result.tool_calls[0].tool_name == "read_file"
