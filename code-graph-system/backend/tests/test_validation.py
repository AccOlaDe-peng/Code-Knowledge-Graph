# code-graph-system/backend/tests/test_validation.py
"""测试图谱验证。"""


def test_schema_validator_validates_nodes():
    """测试 SchemaValidator 可以验证节点。"""
    from backend.validation.schema_validator import SchemaValidator
    from backend.graph.graph_schema import GraphNode

    validator = SchemaValidator()

    # 有效节点
    node = GraphNode(id="func:main", type="Function", name="main")
    errors = validator.validate_node(node)
    assert len(errors) == 0

    # 无效节点类型
    node_invalid = GraphNode(id="func:x", type="InvalidType", name="x")
    errors = validator.validate_node(node_invalid)
    assert len(errors) > 0


def test_schema_validator_validates_edges():
    """测试 SchemaValidator 可以验证边。"""
    from backend.validation.schema_validator import SchemaValidator
    from backend.graph.graph_schema import GraphEdge

    validator = SchemaValidator()

    # 有效边
    edge = GraphEdge(from_="func:a", to="func:b", type="calls")
    errors = validator.validate_edge(edge)
    assert len(errors) == 0

    # 自环边
    edge_self = GraphEdge(from_="func:a", to="func:a", type="calls")
    errors = validator.validate_edge(edge_self)
    assert len(errors) > 0


def test_schema_validator_validates_graph():
    """测试 SchemaValidator 可以验证整个图谱。"""
    from backend.validation.schema_validator import SchemaValidator
    from backend.graph.graph_schema import GraphNode, GraphEdge

    validator = SchemaValidator()

    nodes = [
        GraphNode(id="func:a", type="Function", name="a"),
        GraphNode(id="func:b", type="Function", name="b"),
    ]
    edges = [
        GraphEdge(from_="func:a", to="func:b", type="calls"),
    ]

    result = validator.validate_graph(nodes, edges)
    assert result.valid == True