"""
测试 AIGraphAgent 核心工具调用循环。
"""

import json
from unittest.mock import MagicMock, Mock

import pytest

from backend.analyzer.ai.agent.graph_agent import AIGraphAgent
from backend.graph.graph_builder import BuiltGraph
from backend.graph.graph_schema import GraphNode, GraphEdge, NodeType, EdgeType
from backend.pipeline.repo_summary_builder import RepoSummary


@pytest.fixture
def mock_llm_client():
    """创建 mock LLM 客户端。"""
    return MagicMock()


@pytest.fixture
def sample_static_graph():
    """创建示例静态图谱。"""
    nodes = [
        GraphNode(
            id="file:main.py",
            type=NodeType.FILE,
            name="main.py",
            properties={"path": "main.py"},
        ),
        GraphNode(
            id="func:main",
            type=NodeType.FUNCTION,
            name="main",
            properties={"file": "main.py", "line": 10},
        ),
    ]
    edges = []
    return BuiltGraph(nodes=nodes, edges=edges, meta={})


@pytest.fixture
def sample_repo_summary():
    """创建示例仓库摘要。"""
    return RepoSummary(
        repo_name="test-repo",
        repo_path="/tmp/test-repo",
        git_commit="abc123",
        languages=["python"],
        total_files=10,
        total_nodes=50,
        total_edges=30,
        repo_tree=[],
        modules=[],
        services=[],
        apis=[],
        functions=[],
        call_graph_sample=[],
        databases=[],
        events=[],
        token_estimate=1000,
        truncated=False,
    )


def test_agent_initialization(mock_llm_client, sample_static_graph):
    """测试 Agent 初始化。"""
    agent = AIGraphAgent(
        llm_client=mock_llm_client,
        repo_path="/tmp/test-repo",
        static_graph=sample_static_graph,
        max_tool_calls=20,
    )

    assert agent.llm_client == mock_llm_client
    assert agent.max_tool_calls == 20
    assert agent.tools is not None
    assert agent.context_builder is not None
    assert agent.output_parser is not None


def test_emit_graph_terminates_loop(mock_llm_client, sample_static_graph, sample_repo_summary):
    """测试 emit_graph 调用终止循环。"""
    # 模拟 LLM 直接返回 emit_graph 调用
    emit_output = {
        "nodes": [
            {
                "id": "layer:presentation",
                "type": "Layer",  # 使用正确的 NodeType 值
                "name": "Presentation Layer",
                "properties": {"confidence": 0.9},
            }
        ],
        "edges": [],
        "exploration_summary": "Found presentation layer",
    }

    # 创建 tool_use mock，使用 configure_mock 设置属性
    tool_use_mock = Mock()
    tool_use_mock.configure_mock(
        type="tool_use",
        id="tool_1",
        name="emit_graph",
        input={"graph_json": json.dumps(emit_output)},
    )

    mock_response = Mock()
    mock_response.content = [tool_use_mock]
    mock_response.stop_reason = "tool_use"

    mock_llm_client.messages.create.return_value = mock_response

    agent = AIGraphAgent(
        llm_client=mock_llm_client,
        repo_path="/tmp/test-repo",
        static_graph=sample_static_graph,
        max_tool_calls=20,
    )

    result = agent.analyze(sample_repo_summary)

    # 验证返回结果
    assert "nodes" in result
    assert "edges" in result
    assert len(result["nodes"]) == 1
    assert result["nodes"][0].type == "Layer"

    # 验证只调用了一次 LLM
    assert mock_llm_client.messages.create.call_count == 1


def test_budget_exhaustion(mock_llm_client, sample_static_graph, sample_repo_summary):
    """测试预算耗尽时的处理。"""
    # 模拟 LLM 持续调用工具但不调用 emit_graph
    def mock_create(*args, **kwargs):
        response = Mock()
        tool_use_mock = Mock()
        tool_use_mock.configure_mock(
            type="tool_use",
            id="tool_1",
            name="list_directory",
            input={"path": "/"},
        )
        response.content = [tool_use_mock]
        response.stop_reason = "tool_use"
        return response

    mock_llm_client.messages.create.side_effect = mock_create

    agent = AIGraphAgent(
        llm_client=mock_llm_client,
        repo_path="/tmp/test-repo",
        static_graph=sample_static_graph,
        max_tool_calls=3,  # 设置较小的预算
    )

    result = agent.analyze(sample_repo_summary)

    # 验证达到预算上限
    assert mock_llm_client.messages.create.call_count == 3

    # 验证返回了结果（即使是空的）
    assert "nodes" in result
    assert "edges" in result


def test_tool_execution_error_handling(mock_llm_client, sample_static_graph, sample_repo_summary):
    """测试工具执行错误处理。"""
    # 第一次调用：工具调用失败
    # 第二次调用：emit_graph
    call_count = [0]

    def mock_create(*args, **kwargs):
        call_count[0] += 1
        response = Mock()

        if call_count[0] == 1:
            # 第一次：调用不存在的工具
            tool_use_mock = Mock()
            tool_use_mock.configure_mock(
                type="tool_use",
                id="tool_1",
                name="invalid_tool",
                input={},
            )
            response.content = [tool_use_mock]
        else:
            # 第二次：emit_graph
            emit_output = {
                "nodes": [],
                "edges": [],
                "exploration_summary": "Error recovery",
            }
            tool_use_mock = Mock()
            tool_use_mock.configure_mock(
                type="tool_use",
                id="tool_2",
                name="emit_graph",
                input={"graph_json": json.dumps(emit_output)},
            )
            response.content = [tool_use_mock]

        response.stop_reason = "tool_use"
        return response

    mock_llm_client.messages.create.side_effect = mock_create

    agent = AIGraphAgent(
        llm_client=mock_llm_client,
        repo_path="/tmp/test-repo",
        static_graph=sample_static_graph,
        max_tool_calls=20,
    )

    result = agent.analyze(sample_repo_summary)

    # 验证能够从错误中恢复
    assert "nodes" in result
    assert "edges" in result
    assert call_count[0] == 2
