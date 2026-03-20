# code-graph-system/backend/tests/test_analysis_store.py
import pytest
from backend.store.database import Database
from backend.store.repo_store import RepoStore
from backend.store.analysis_store import AnalysisStore


@pytest.fixture
def stores(tmp_path):
    db = Database(str(tmp_path / "test.db"))
    repo_store = RepoStore(db)
    analysis_store = AnalysisStore(db)
    repo_store.create("repo-001", "proj", "/path", "local", [])
    return repo_store, analysis_store


def test_write_completed_analysis(stores):
    _, analysis_store = stores
    record = analysis_store.write_completed(
        task_id="task-abc",
        repo_id="repo-001",
        depth="standard",
        status="completed",
        graph_id="graph-xyz",
        node_count=100,
        edge_count=200,
        started_at="2026-03-20T10:00:00Z",
        finished_at="2026-03-20T10:05:00Z",
    )
    assert record["id"] == "task-abc"
    assert record["status"] == "completed"
    assert record["graph_id"] == "graph-xyz"


def test_list_by_repo(stores):
    _, analysis_store = stores
    analysis_store.write_completed("task-1", "repo-001", "quick", "completed", started_at="2026-03-20T10:00:00Z")
    analysis_store.write_completed("task-2", "repo-001", "deep", "failed", error="LLM error", started_at="2026-03-20T11:00:00Z")

    records = analysis_store.list_by_repo("repo-001")
    assert len(records) == 2
    # 按 started_at 降序
    assert records[0]["id"] == "task-2"


def test_list_by_repo_empty(stores):
    _, analysis_store = stores
    records = analysis_store.list_by_repo("repo-999")
    assert records == []


def test_get_latest(stores):
    _, analysis_store = stores
    analysis_store.write_completed("task-1", "repo-001", "quick", "completed", started_at="2026-03-20T10:00:00Z")
    analysis_store.write_completed("task-2", "repo-001", "deep", "completed", graph_id="graph-latest", started_at="2026-03-20T11:00:00Z")

    latest = analysis_store.get_latest("repo-001")
    assert latest["id"] == "task-2"
    assert latest["graph_id"] == "graph-latest"
