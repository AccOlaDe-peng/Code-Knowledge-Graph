# code-graph-system/backend/tests/test_repos_api.py
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock


@pytest.fixture
def client():
    from backend.api.server import app
    return TestClient(app)


def test_get_repos_empty(client):
    with patch("backend.api.routers.repos.get_repo_store") as mock_store:
        mock_store.return_value.list_all.return_value = []
        resp = client.get("/repos")
    assert resp.status_code == 200
    assert resp.json()["repos"] == []


def test_post_repo_creates(client):
    with patch("backend.api.routers.repos.get_repo_store") as mock_store:
        mock_instance = MagicMock()
        mock_instance.get_by_path.return_value = None
        mock_instance.create.return_value = {
            "id": "repo-001", "name": "proj", "path": "/path",
            "branch": None, "source_mode": "local", "language": [],
            "created_at": "2026-03-20T10:00:00Z", "updated_at": "2026-03-20T10:00:00Z",
        }
        mock_store.return_value = mock_instance
        resp = client.post("/repos", json={
            "repo_name": "proj",
            "repo_path": "/path",
            "source_mode": "local",
        })
    assert resp.status_code == 200
    assert resp.json()["id"] == "repo-001"


def test_put_repo_updates(client):
    with patch("backend.api.routers.repos.get_repo_store") as mock_store:
        mock_instance = MagicMock()
        mock_instance.update.return_value = {
            "id": "repo-001", "name": "new-name", "path": "/path",
            "branch": "main", "source_mode": "local", "language": [],
            "created_at": "2026-03-20T10:00:00Z", "updated_at": "2026-03-20T10:01:00Z",
        }
        mock_store.return_value = mock_instance
        resp = client.put("/repos/repo-001", json={"repo_name": "new-name", "branch": "main"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "new-name"


def test_get_pipeline_stages(client):
    resp = client.get("/api/pipeline/stages")
    assert resp.status_code == 200
    data = resp.json()
    assert "stages" in data
    assert "total" in data
    keys = [s["key"] for s in data["stages"]]
    assert "file_index" in keys
    assert "ai_semantic_enhance" in keys
