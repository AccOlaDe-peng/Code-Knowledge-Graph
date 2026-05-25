import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

from backend.api.server import app


@pytest.fixture
def client():
    return TestClient(app)


class TestGraphifyAPI:
    def test_post_graphify_returns_task_id(self, client):
        with patch("backend.services.graphify_runner.GraphifyRunner.run") as mock_run:
            mock_run.return_value = MagicMock(success=True, files_written=4, error="", output="{}")
            resp = client.post("/analyze/graphify", json={
                "repo_path": "/tmp/test-repo",
                "repo_name": "test-project",
                "repo_id": "repo-123",
            })
        assert resp.status_code == 200
        data = resp.json()
        assert "task_id" in data
        assert data["status"] == "pending"

    def test_post_graphify_missing_repo_path(self, client):
        resp = client.post("/analyze/graphify", json={
            "repo_name": "test",
        })
        assert resp.status_code == 422

    def test_post_graphify_cli_not_found(self, client):
        with patch("backend.services.graphify_runner.GraphifyRunner.run") as mock_run:
            mock_run.return_value = MagicMock(
                success=False, error="Claude Code CLI not found", files_written=0, output="",
            )
            resp = client.post("/analyze/graphify", json={
                "repo_path": "/tmp/test-repo",
                "repo_name": "test-project",
            })
        # Even if CLI not found, we return task_id (async validation happens later)
        assert resp.status_code == 200
