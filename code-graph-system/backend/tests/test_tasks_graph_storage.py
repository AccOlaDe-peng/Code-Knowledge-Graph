# code-graph-system/backend/tests/test_tasks_graph_storage.py
from unittest.mock import MagicMock, patch

def test_analyze_repository_writes_to_graph_storage(tmp_path):
    """analyze_repository 成功后应写入 GraphStorage。"""
    # 用 mock 替换 GraphStorage，断言 save_graph 被调用
    mock_storage = MagicMock()

    with patch("backend.storage.graph_storage.GraphStorage") as MockStorage:
        MockStorage.return_value = mock_storage
        # 直接测试写入辅助函数（_write_to_graph_storage 中使用局部 import，
        # patch 目标是类本身，MockStorage.return_value 才是实例）
        from backend.scheduler.tasks import _write_to_graph_storage
        from backend.graph.graph_schema import GraphNode, GraphEdge

        nodes = [GraphNode(id="n1", type="Module", name="auth")]
        edges = [GraphEdge(from_="n1", to="n2", type="depends_on")]
        _write_to_graph_storage("my-repo", nodes, edges)

    mock_storage.save_graph.assert_called_once()
    call_kwargs = mock_storage.save_graph.call_args
    assert call_kwargs.kwargs["repo_id"] == "my-repo"
    assert "nodes" in call_kwargs.kwargs["graph"]
    assert "edges" in call_kwargs.kwargs["graph"]
