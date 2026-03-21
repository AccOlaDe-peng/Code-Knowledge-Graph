# code-graph-system/backend/tests/test_repos_delete.py
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient


def test_delete_repo_cleans_graph_storage():
    """DELETE /repos/{repo_id} 应调用 GraphStorage.delete_repo。"""
    mock_storage = MagicMock()
    mock_repo_store = MagicMock()
    mock_analysis_store = MagicMock()
    mock_analysis_store.list_by_repo.return_value = []

    with patch("backend.storage.graph_storage.GraphStorage") as MockGS, \
         patch("backend.store.repo_store.get_repo_store", return_value=mock_repo_store), \
         patch("backend.store.analysis_store.get_analysis_store", return_value=mock_analysis_store):
        MockGS.return_value = mock_storage
        from backend.api.server import app
        client = TestClient(app)
        client.delete("/repos/test-repo")

    mock_storage.delete_repo.assert_called_once_with("test-repo")
