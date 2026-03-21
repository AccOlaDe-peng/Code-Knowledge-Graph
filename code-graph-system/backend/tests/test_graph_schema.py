# code-graph-system/backend/tests/test_graph_schema.py
def test_architecture_node_types_exist():
    from backend.graph.graph_schema import ARCHITECTURE_NODE_TYPES, NodeType
    assert isinstance(ARCHITECTURE_NODE_TYPES, frozenset)
    # 每个值必须是合法的 NodeType
    valid = {t.value for t in NodeType}
    for t in ARCHITECTURE_NODE_TYPES:
        assert t in valid, f"'{t}' 不在 NodeType 枚举中"

def test_architecture_node_types_excludes_code_detail():
    from backend.graph.graph_schema import ARCHITECTURE_NODE_TYPES
    # Class 和 Function 是细粒度代码元素，不应在架构层
    assert "Class" not in ARCHITECTURE_NODE_TYPES
    assert "Function" not in ARCHITECTURE_NODE_TYPES
    assert "File" not in ARCHITECTURE_NODE_TYPES
