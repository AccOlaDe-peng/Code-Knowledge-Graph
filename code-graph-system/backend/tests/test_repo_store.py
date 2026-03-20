# code-graph-system/backend/tests/test_repo_store.py
import pytest
import tempfile
from backend.store.database import Database
from backend.store.repo_store import RepoStore


@pytest.fixture
def store(tmp_path):
    db = Database(str(tmp_path / "test.db"))
    return RepoStore(db)


def test_create_and_get_repo(store):
    repo = store.create(
        repo_id="repo-001",
        name="my-project",
        path="/path/to/repo",
        source_mode="local",
        language=["python"],
    )
    assert repo["id"] == "repo-001"
    assert repo["name"] == "my-project"

    fetched = store.get("repo-001")
    assert fetched is not None
    assert fetched["path"] == "/path/to/repo"
    assert fetched["language"] == ["python"]


def test_list_repos(store):
    store.create("repo-001", "proj-a", "/a", "local", [])
    store.create("repo-002", "proj-b", "/b", "git", ["java"])
    repos = store.list_all()
    assert len(repos) == 2
    ids = {r["id"] for r in repos}
    assert {"repo-001", "repo-002"} == ids


def test_update_repo(store):
    store.create("repo-001", "old-name", "/path", "local", [])
    updated = store.update("repo-001", name="new-name", branch="main")
    assert updated["name"] == "new-name"
    assert updated["branch"] == "main"

    fetched = store.get("repo-001")
    assert fetched["name"] == "new-name"


def test_delete_repo(store):
    store.create("repo-001", "proj", "/path", "local", [])
    assert store.get("repo-001") is not None
    store.delete("repo-001")
    assert store.get("repo-001") is None


def test_get_by_path(store):
    store.create("repo-001", "proj", "/my/unique/path", "local", [])
    result = store.get_by_path("/my/unique/path")
    assert result is not None
    assert result["id"] == "repo-001"


def test_create_duplicate_path_raises(store):
    store.create("repo-001", "proj-a", "/same/path", "local", [])
    with pytest.raises(ValueError, match="路径已存在"):
        store.create("repo-002", "proj-b", "/same/path", "local", [])
