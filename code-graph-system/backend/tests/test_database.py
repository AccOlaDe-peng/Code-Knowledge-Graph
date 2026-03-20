# code-graph-system/backend/tests/test_database.py
import pytest
import sqlite3
from pathlib import Path
import tempfile
import json
from backend.store.database import Database, migrate_from_json


def test_database_creates_tables(tmp_path):
    db = Database(str(tmp_path / "test.db"))
    conn = sqlite3.connect(str(tmp_path / "test.db"))
    cursor = conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = {row[0] for row in cursor.fetchall()}
    conn.close()
    assert "repo" in tables
    assert "analysis" in tables


def test_database_wal_mode(tmp_path):
    db = Database(str(tmp_path / "test.db"))
    conn = sqlite3.connect(str(tmp_path / "test.db"))
    mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
    conn.close()
    assert mode == "wal"


def test_migrate_from_json_completed(tmp_path):
    status_json = tmp_path / "status.json"
    status_json.write_text(json.dumps({
        "repo-123": {
            "repo_id": "repo-123",
            "repo_name": "test-repo",
            "repo_path": "/path/to/repo",
            "graph_id": "graph-abc",
            "task_id": None,
            "status": "completed",
            "node_count": 100,
            "edge_count": 200,
            "branch": "main",
            "source_mode": "local",
            "language": ["python"],
            "created_at": "2026-03-20T10:00:00Z",
            "updated_at": "2026-03-20T10:05:00Z",
        }
    }), encoding="utf-8")

    db = Database(str(tmp_path / "test.db"))
    migrate_from_json(db, str(status_json))

    conn = sqlite3.connect(str(tmp_path / "test.db"))
    conn.row_factory = sqlite3.Row
    repo = conn.execute("SELECT * FROM repo WHERE id='repo-123'").fetchone()
    analysis = conn.execute("SELECT * FROM analysis WHERE repo_id='repo-123'").fetchone()
    conn.close()

    assert repo is not None
    assert repo["name"] == "test-repo"
    assert analysis is not None
    assert analysis["status"] == "completed"
    assert analysis["graph_id"] == "graph-abc"


def test_migrate_from_json_analyzing_becomes_failed(tmp_path):
    status_json = tmp_path / "status.json"
    status_json.write_text(json.dumps({
        "repo-456": {
            "repo_id": "repo-456",
            "repo_name": "live-repo",
            "repo_path": "/path/to/live",
            "graph_id": "",
            "task_id": "celery-xyz",
            "status": "analyzing",
            "node_count": 0,
            "edge_count": 0,
            "branch": None,
            "source_mode": "git",
            "language": [],
            "created_at": "2026-03-20T10:00:00Z",
            "updated_at": "2026-03-20T10:02:00Z",
        }
    }), encoding="utf-8")

    db = Database(str(tmp_path / "test.db"))
    migrate_from_json(db, str(status_json))

    conn = sqlite3.connect(str(tmp_path / "test.db"))
    conn.row_factory = sqlite3.Row
    analysis = conn.execute("SELECT * FROM analysis WHERE repo_id='repo-456'").fetchone()
    conn.close()

    assert analysis is not None
    assert analysis["status"] == "failed"
    assert "服务重启" in analysis["error"]


def test_migrate_from_json_saved_no_analysis(tmp_path):
    status_json = tmp_path / "status.json"
    status_json.write_text(json.dumps({
        "repo-789": {
            "repo_id": "repo-789",
            "repo_name": "saved-repo",
            "repo_path": "/path/to/saved",
            "graph_id": "",
            "task_id": None,
            "status": "saved",
            "node_count": 0,
            "edge_count": 0,
            "branch": None,
            "source_mode": "local",
            "language": [],
            "created_at": "2026-03-20T10:00:00Z",
            "updated_at": "2026-03-20T10:00:00Z",
        }
    }), encoding="utf-8")

    db = Database(str(tmp_path / "test.db"))
    migrate_from_json(db, str(status_json))

    conn = sqlite3.connect(str(tmp_path / "test.db"))
    conn.row_factory = sqlite3.Row
    repo = conn.execute("SELECT * FROM repo WHERE id='repo-789'").fetchone()
    analysis = conn.execute("SELECT * FROM analysis WHERE repo_id='repo-789'").fetchone()
    conn.close()

    assert repo is not None
    assert analysis is None  # saved 状态不产生 Analysis 记录


def test_migrate_renames_json_file(tmp_path):
    status_json = tmp_path / "status.json"
    status_json.write_text("{}", encoding="utf-8")

    db = Database(str(tmp_path / "test.db"))
    migrate_from_json(db, str(status_json))

    assert not status_json.exists()
    assert (tmp_path / "status.json.migrated").exists()
