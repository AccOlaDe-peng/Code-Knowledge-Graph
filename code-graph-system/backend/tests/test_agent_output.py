# code-graph-system/backend/tests/test_agent_output.py
"""测试 Agent 输出类型。"""


def test_agent_output_creation():
    """测试 AgentOutput 可以创建。"""
    from backend.models.agent_output import AgentOutput
    from backend.graph.graph_schema import GraphNode

    output = AgentOutput(
        agent_type="architecture",
        module_id="module:test",
        status="success",
        execution_time_ms=1500,
        nodes=[
            GraphNode(id="layer:presentation", type="Layer", name="Presentation Layer")
        ],
        edges=[],
        meta={"token_count": 5000}
    )

    assert output.agent_type == "architecture"
    assert output.status == "success"
    assert len(output.nodes) == 1


def test_intermediate_graph():
    """测试 IntermediateGraph 可以创建。"""
    from backend.models.agent_output import IntermediateGraph
    from backend.graph.graph_schema import GraphNode

    graph = IntermediateGraph(
        module_id="module:test",
        nodes=[
            GraphNode(id="func:main", type="Function", name="main")
        ],
        edges=[]
    )

    assert graph.module_id == "module:test"
    assert graph.node_count == 1
    assert graph.edge_count == 0


def test_agent_error():
    """测试 AgentError 可以创建。"""
    from backend.models.agent_output import AgentError

    error = AgentError(
        code="PARSE_ERROR",
        message="Failed to parse JSON response",
        context={"raw_response": "invalid json"}
    )

    assert error.code == "PARSE_ERROR"
    assert "parse" in error.message.lower()
