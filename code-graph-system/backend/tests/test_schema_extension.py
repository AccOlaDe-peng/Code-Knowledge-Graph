# code-graph-system/backend/tests/test_schema_extension.py
"""测试 Schema 扩展（新节点类型和边类型）。"""


def test_new_node_types_exist():
    """测试新增节点类型已添加到 NodeType 枚举。"""
    from backend.graph.graph_schema import NodeType

    # 新增节点类型
    assert hasattr(NodeType, 'API_ENDPOINT')
    assert hasattr(NodeType, 'EVENT_HANDLER')
    assert hasattr(NodeType, 'DATA_SOURCE')
    assert hasattr(NodeType, 'DATA_SINK')
    assert hasattr(NodeType, 'EXTERNAL_API')
    assert hasattr(NodeType, 'MESSAGE_QUEUE')

    # 验证值
    assert NodeType.API_ENDPOINT.value == "APIEndpoint"
    assert NodeType.EVENT_HANDLER.value == "EventHandler"
    assert NodeType.DATA_SOURCE.value == "DataSource"
    assert NodeType.DATA_SINK.value == "DataSink"
    assert NodeType.EXTERNAL_API.value == "ExternalAPI"
    assert NodeType.MESSAGE_QUEUE.value == "MessageQueue"


def test_new_edge_types_exist():
    """测试新增边类型已添加到 EdgeType 枚举。"""
    from backend.graph.graph_schema import EdgeType

    # 新增边类型
    assert hasattr(EdgeType, 'ASYNC_CALLS')
    assert hasattr(EdgeType, 'HANDLES')

    # 验证值
    assert EdgeType.ASYNC_CALLS.value == "async_calls"
    assert EdgeType.HANDLES.value == "handles"
