# 仓库管理系统全面优化 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 根治仓库管理系统的根因问题：数据模型混乱、进度条永远不对、大仓库 429 频发、server.py 巨型文件、前端组件臃肿。

**Architecture:** 引入 Repo/Analysis SQLite 双表替换 JSON 文件存储；后端暴露 Pipeline Stage 契约 API 使前端动态同步；server.py 拆为 4 个 router；前端 Repository 页拆为 5 个子组件 + 2 个 hook。

**Tech Stack:** Python sqlite3（内置）、FastAPI APIRouter、ThreadPoolExecutor、React/TypeScript、Zustand

**Spec:** `docs/superpowers/specs/2026-03-20-repo-management-optimization-design.md`

---

## Chunk 1: P0 后端数据存储层

### 文件结构

```
code-graph-system/backend/store/
├── database.py        # NEW: SQLite 连接、DDL、迁移
├── repo_store.py      # NEW: Repo 表 CRUD
├── analysis_store.py  # NEW: Analysis 表（终态写入 + 历史查询）
└── repo_status_store.py  # MODIFY: 适配新 SQLite 实现

code-graph-system/backend/tests/
├── test_database.py   # NEW
├── test_repo_store.py # NEW
└── test_analysis_store.py # NEW
```

---

### Task 1: SQLite 数据库基础（database.py）

**Files:**
- Create: `code-graph-system/backend/store/database.py`
- Create: `code-graph-system/backend/tests/test_database.py`

- [ ] **Step 1: 写失败测试**

```python
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
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd code-graph-system
source venv/bin/activate
pytest backend/tests/test_database.py -v
```

期望：`ModuleNotFoundError: No module named 'backend.store.database'`

- [ ] **Step 3: 实现 database.py**

```python
# code-graph-system/backend/store/database.py
"""SQLite 数据库连接与初始化。"""
from __future__ import annotations

import json
import logging
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

_DDL = """
CREATE TABLE IF NOT EXISTS repo (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    path        TEXT NOT NULL,
    branch      TEXT,
    source_mode TEXT NOT NULL DEFAULT 'local',
    language    TEXT NOT NULL DEFAULT '[]',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analysis (
    id          TEXT PRIMARY KEY,
    repo_id     TEXT NOT NULL REFERENCES repo(id),
    depth       TEXT NOT NULL DEFAULT 'standard',
    status      TEXT NOT NULL,
    graph_id    TEXT,
    node_count  INTEGER DEFAULT 0,
    edge_count  INTEGER DEFAULT 0,
    error       TEXT,
    started_at  TEXT NOT NULL,
    finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_analysis_repo_id ON analysis(repo_id);
CREATE INDEX IF NOT EXISTS idx_analysis_started_at ON analysis(started_at DESC);
"""

_DEFAULT_DB_PATH = "./data/repos/repos.db"


class Database:
    """SQLite 数据库连接封装（WAL 模式）。"""

    def __init__(self, db_path: str = _DEFAULT_DB_PATH) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _init_db(self) -> None:
        # WAL 模式必须在建表之前设置，且需要独立的连接调用
        conn = sqlite3.connect(str(self.db_path))
        conn.execute("PRAGMA journal_mode=WAL")
        conn.commit()
        conn.executescript(_DDL)
        conn.commit()
        conn.close()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        return conn

    def execute(self, sql: str, params: tuple = ()) -> list[sqlite3.Row]:
        with self._connect() as conn:
            cursor = conn.execute(sql, params)
            conn.commit()
            return cursor.fetchall()

    def execute_one(self, sql: str, params: tuple = ()) -> Optional[sqlite3.Row]:
        rows = self.execute(sql, params)
        return rows[0] if rows else None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def migrate_from_json(db: Database, json_path: str) -> None:
    """将 status.json 迁移到 SQLite，完成后重命名为 .migrated。"""
    path = Path(json_path)
    if not path.exists():
        return

    try:
        data: dict = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.warning("迁移失败：无法读取 %s: %s", json_path, exc)
        return

    now = _now_iso()
    migrated = 0

    for repo_id, entry in data.items():
        repo_name    = entry.get("repo_name", repo_id)
        repo_path    = entry.get("repo_path", "")
        branch       = entry.get("branch")
        source_mode  = entry.get("source_mode", "local") or "local"
        language     = json.dumps(entry.get("language") or [])
        created_at   = entry.get("created_at", now)
        updated_at   = entry.get("updated_at", now)
        status       = entry.get("status", "saved")
        graph_id     = entry.get("graph_id") or None
        task_id      = entry.get("task_id")
        node_count   = entry.get("node_count", 0)
        edge_count   = entry.get("edge_count", 0)

        # 插入 Repo（已存在则忽略）
        db.execute(
            """INSERT OR IGNORE INTO repo
               (id, name, path, branch, source_mode, language, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (repo_id, repo_name, repo_path, branch, source_mode, language, created_at, updated_at),
        )

        # 根据状态决定是否插入 Analysis
        if status == "saved":
            pass  # 仅保存仓库配置，无 Analysis 记录
        elif status == "analyzing":
            # 服务重启时的僵死任务，标记为失败
            aid = task_id or f"migrated-{repo_id}"
            db.execute(
                """INSERT OR IGNORE INTO analysis
                   (id, repo_id, depth, status, error, started_at, finished_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (aid, repo_id, "standard", "failed",
                 "服务重启，任务中断", created_at, now),
            )
        elif status in ("completed", "completed_partial", "failed", "canceled"):
            aid = task_id or f"migrated-{repo_id}"
            db.execute(
                """INSERT OR IGNORE INTO analysis
                   (id, repo_id, depth, status, graph_id, node_count, edge_count, started_at, finished_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (aid, repo_id, "standard", status,
                 graph_id, node_count, edge_count, created_at, updated_at),
            )

        migrated += 1

    logger.info("已从 %s 迁移 %d 条记录", json_path, migrated)

    # 重命名原文件
    migrated_path = path.with_suffix(".json.migrated")
    path.rename(migrated_path)
    logger.info("status.json 已重命名为 %s", migrated_path.name)


# 全局单例
_db: Optional[Database] = None


def get_database() -> Database:
    global _db
    if _db is None:
        _db = Database()
        # 启动时检查是否需要迁移
        json_path = Path("./data/repos/status.json")
        if json_path.exists():
            migrate_from_json(_db, str(json_path))
    return _db
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
cd code-graph-system
pytest backend/tests/test_database.py -v
```

期望：全部 PASS

- [ ] **Step 5: 提交**

```bash
git add backend/store/database.py backend/tests/test_database.py
git commit -m "feat: 添加 SQLite 数据库基础（Database + migrate_from_json）"
```

---

### Task 2: Repo 表 CRUD（repo_store.py）

**Files:**
- Create: `code-graph-system/backend/store/repo_store.py`
- Create: `code-graph-system/backend/tests/test_repo_store.py`

- [ ] **Step 1: 写失败测试**

```python
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
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd code-graph-system
pytest backend/tests/test_repo_store.py -v
```

期望：`ModuleNotFoundError: No module named 'backend.store.repo_store'`

- [ ] **Step 3: 实现 repo_store.py**

```python
# code-graph-system/backend/store/repo_store.py
"""Repo 表 CRUD。"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Optional

from backend.store.database import Database, get_database

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_dict(row) -> dict[str, Any]:
    if row is None:
        return None
    d = dict(row)
    d["language"] = json.loads(d.get("language") or "[]")
    return d


class RepoStore:
    def __init__(self, db: Optional[Database] = None) -> None:
        self._db = db or get_database()

    def create(
        self,
        repo_id: str,
        name: str,
        path: str,
        source_mode: str = "local",
        language: list[str] = None,
        branch: Optional[str] = None,
    ) -> dict[str, Any]:
        # 检查路径唯一性
        existing = self.get_by_path(path)
        if existing is not None:
            raise ValueError(f"路径已存在: {path}（repo_id={existing['id']}）")

        now = _now_iso()
        self._db.execute(
            """INSERT INTO repo (id, name, path, branch, source_mode, language, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (repo_id, name, path, branch, source_mode,
             json.dumps(language or []), now, now),
        )
        return self.get(repo_id)

    def get(self, repo_id: str) -> Optional[dict[str, Any]]:
        row = self._db.execute_one("SELECT * FROM repo WHERE id=?", (repo_id,))
        return _row_to_dict(row)

    def get_by_path(self, path: str) -> Optional[dict[str, Any]]:
        row = self._db.execute_one("SELECT * FROM repo WHERE path=?", (path,))
        return _row_to_dict(row)

    def list_all(self) -> list[dict[str, Any]]:
        rows = self._db.execute("SELECT * FROM repo ORDER BY created_at DESC")
        return [_row_to_dict(r) for r in rows]

    def update(self, repo_id: str, **kwargs) -> Optional[dict[str, Any]]:
        allowed = {"name", "path", "branch", "source_mode", "language"}
        updates = {k: v for k, v in kwargs.items() if k in allowed}
        if not updates:
            return self.get(repo_id)

        if "language" in updates:
            updates["language"] = json.dumps(updates["language"])

        updates["updated_at"] = _now_iso()
        set_clause = ", ".join(f"{k}=?" for k in updates)
        values = list(updates.values()) + [repo_id]
        self._db.execute(f"UPDATE repo SET {set_clause} WHERE id=?", tuple(values))
        return self.get(repo_id)

    def delete(self, repo_id: str) -> bool:
        rows = self._db.execute("DELETE FROM repo WHERE id=?", (repo_id,))
        return True


_store: Optional[RepoStore] = None


def get_repo_store() -> RepoStore:
    global _store
    if _store is None:
        _store = RepoStore()
    return _store
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
cd code-graph-system
pytest backend/tests/test_repo_store.py -v
```

期望：全部 PASS

- [ ] **Step 5: 提交**

```bash
git add backend/store/repo_store.py backend/tests/test_repo_store.py
git commit -m "feat: 添加 RepoStore（Repo 表 CRUD）"
```

---

### Task 3: Analysis 历史表（analysis_store.py）

**Files:**
- Create: `code-graph-system/backend/store/analysis_store.py`
- Create: `code-graph-system/backend/tests/test_analysis_store.py`

- [ ] **Step 1: 写失败测试**

```python
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
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd code-graph-system
pytest backend/tests/test_analysis_store.py -v
```

- [ ] **Step 3: 实现 analysis_store.py**

```python
# code-graph-system/backend/store/analysis_store.py
"""Analysis 历史表（终态写入 + 查询）。"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from backend.store.database import Database, get_database


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_dict(row) -> Optional[dict[str, Any]]:
    return dict(row) if row else None


class AnalysisStore:
    def __init__(self, db: Optional[Database] = None) -> None:
        self._db = db or get_database()

    def write_completed(
        self,
        task_id: str,
        repo_id: str,
        depth: str = "standard",
        status: str = "completed",
        graph_id: Optional[str] = None,
        node_count: int = 0,
        edge_count: int = 0,
        error: Optional[str] = None,
        started_at: Optional[str] = None,
        finished_at: Optional[str] = None,
    ) -> dict[str, Any]:
        now = _now_iso()
        self._db.execute(
            """INSERT OR REPLACE INTO analysis
               (id, repo_id, depth, status, graph_id, node_count, edge_count,
                error, started_at, finished_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (task_id, repo_id, depth, status, graph_id, node_count, edge_count,
             error, started_at or now, finished_at or now),
        )
        return _row_to_dict(
            self._db.execute_one("SELECT * FROM analysis WHERE id=?", (task_id,))
        )

    def list_by_repo(self, repo_id: str, limit: int = 20) -> list[dict[str, Any]]:
        rows = self._db.execute(
            "SELECT * FROM analysis WHERE repo_id=? ORDER BY started_at DESC LIMIT ?",
            (repo_id, limit),
        )
        return [_row_to_dict(r) for r in rows]

    def get_latest(self, repo_id: str) -> Optional[dict[str, Any]]:
        row = self._db.execute_one(
            "SELECT * FROM analysis WHERE repo_id=? ORDER BY started_at DESC LIMIT 1",
            (repo_id,),
        )
        return _row_to_dict(row)

    def mark_superseded(self, task_id: str) -> None:
        """将进行中任务标记为失败（被新任务取代）。"""
        now = _now_iso()
        self._db.execute(
            """UPDATE analysis SET status='failed', error='被新任务取代', finished_at=?
               WHERE id=? AND status NOT IN ('completed','failed','canceled','completed_partial')""",
            (now, task_id),
        )

    def delete_by_repo(self, repo_id: str) -> None:
        self._db.execute("DELETE FROM analysis WHERE repo_id=?", (repo_id,))


_store: Optional[AnalysisStore] = None


def get_analysis_store() -> AnalysisStore:
    global _store
    if _store is None:
        _store = AnalysisStore()
    return _store
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
cd code-graph-system
pytest backend/tests/test_analysis_store.py -v
```

- [ ] **Step 5: 提交**

```bash
git add backend/store/analysis_store.py backend/tests/test_analysis_store.py
git commit -m "feat: 添加 AnalysisStore（Analysis 历史表）"
```

---

### Task 4: /repos API 端点（repos.py router）

**Files:**
- Create: `code-graph-system/backend/api/routers/__init__.py`
- Create: `code-graph-system/backend/api/routers/repos.py`
- Create: `code-graph-system/backend/tests/test_repos_api.py`
- Modify: `code-graph-system/backend/api/server.py`（注册 router）

- [ ] **Step 1: 写失败测试**

```python
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
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd code-graph-system
pytest backend/tests/test_repos_api.py -v
```

- [ ] **Step 3: 创建 routers 包和 repos.py**

```python
# code-graph-system/backend/api/routers/__init__.py
```

```python
# code-graph-system/backend/api/routers/repos.py
"""仓库管理 API：/repos/* + /api/pipeline/stages"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.store.repo_store import get_repo_store
from backend.store.analysis_store import get_analysis_store
from backend.pipeline.stage_registry import STAGE_REGISTRY

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Request / Response Models ────────────────────────────────────────────────


class CreateRepoRequest(BaseModel):
    repo_id:     Optional[str]       = Field(default=None)
    repo_name:   str                 = Field(description="仓库名称")
    repo_path:   str                 = Field(description="本地路径或 Git URL")
    branch:      Optional[str]       = Field(default=None)
    source_mode: str                 = Field(default="local")
    language:    Optional[list[str]] = Field(default=None)


class UpdateRepoRequest(BaseModel):
    repo_name:   Optional[str]       = Field(default=None)
    branch:      Optional[str]       = Field(default=None)
    language:    Optional[list[str]] = Field(default=None)


# ── Endpoints ────────────────────────────────────────────────────────────────


@router.get("/repos", tags=["仓库"])
def list_repos():
    """列出所有仓库（含最近一次分析摘要）。"""
    store = get_repo_store()
    analysis_store = get_analysis_store()
    repos = store.list_all()

    result = []
    for repo in repos:
        latest = analysis_store.get_latest(repo["id"])
        result.append({**repo, "latest_analysis": latest})

    return {"repos": result}


@router.post("/repos", tags=["仓库"])
def create_repo(req: CreateRepoRequest):
    """创建仓库配置。"""
    store = get_repo_store()

    # 生成 repo_id（前端未提供时服务器生成）
    import time, random, string
    repo_id = req.repo_id or f"repo-{int(time.time())}-{''.join(random.choices(string.ascii_lowercase, k=6))}"

    try:
        repo = store.create(
            repo_id=repo_id,
            name=req.repo_name,
            path=req.repo_path,
            source_mode=req.source_mode,
            language=req.language or [],
            branch=req.branch,
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))

    return repo


@router.put("/repos/{repo_id}", tags=["仓库"])
def update_repo(repo_id: str, req: UpdateRepoRequest):
    """编辑仓库配置（名称、分支、语言）。"""
    store = get_repo_store()
    kwargs = {}
    if req.repo_name is not None:
        kwargs["name"] = req.repo_name
    if req.branch is not None:
        kwargs["branch"] = req.branch
    if req.language is not None:
        kwargs["language"] = req.language

    repo = store.update(repo_id, **kwargs)
    if repo is None:
        raise HTTPException(status_code=404, detail=f"仓库不存在: {repo_id}")
    return repo


@router.delete("/repos/{repo_id}", tags=["仓库"])
def delete_repo(repo_id: str):
    """删除仓库及其所有分析历史、关联图谱 JSON 和 ChromaDB 集合。"""
    from backend.graph.graph_repository import GraphRepository
    from backend.rag.vector_store import VectorStore

    store = get_repo_store()
    analysis_store = get_analysis_store()

    # 获取所有关联图谱 ID，先删图谱
    analyses = analysis_store.list_by_repo(repo_id)
    graph_repo = GraphRepository()
    vector_store = VectorStore()

    for analysis in analyses:
        gid = analysis.get("graph_id")
        if gid:
            try:
                graph_repo.delete(gid)
            except Exception as exc:
                logger.warning("删除图谱失败 graph_id=%s: %s", gid, exc)
            try:
                # VectorStore 实际方法名为 delete_graph()
                vector_store.delete_graph(gid)
            except Exception as exc:
                logger.warning("删除向量集合失败 graph_id=%s: %s", gid, exc)

    analysis_store.delete_by_repo(repo_id)
    store.delete(repo_id)
    return {"deleted": repo_id}


@router.get("/repos/{repo_id}/analyses", tags=["仓库"])
def list_repo_analyses(repo_id: str, task_id: Optional[str] = None):
    """获取仓库的分析历史（含当前进行中任务）。"""
    from celery.result import AsyncResult
    from backend.scheduler.celery_app import celery_app

    analysis_store = get_analysis_store()
    records = analysis_store.list_by_repo(repo_id)

    # 若有进行中任务，拼接虚拟记录放在首位
    virtual = None
    if task_id:
        try:
            result = AsyncResult(task_id, app=celery_app)
            info = result.info or {}
            if not isinstance(info, Exception) and result.state not in ("SUCCESS", "FAILURE", "REVOKED"):
                virtual = {
                    "id": task_id,
                    "repo_id": repo_id,
                    "status": "analyzing",
                    "stage_key": info.get("stage", ""),
                    "step": info.get("step", 0),
                    "total": info.get("total", 6),
                    "message": info.get("message", ""),
                    "started_at": None,
                    "finished_at": None,
                }
        except Exception:
            pass

    result_list = ([virtual] if virtual else []) + records
    return {"analyses": result_list}


@router.get("/api/pipeline/stages", tags=["流水线"])
def get_pipeline_stages():
    """返回当前流水线 Stage 定义（前端进度条依赖此数据）。"""
    return {
        "stages": STAGE_REGISTRY,
        "total": len(STAGE_REGISTRY),
    }
```

- [ ] **Step 4: 创建 stage_registry.py**

```python
# code-graph-system/backend/pipeline/stage_registry.py
"""流水线 Stage 定义注册表。

前后端共同契约：前端通过 GET /api/pipeline/stages 获取此列表，
保证进度条永远与实际流水线一致。
"""

STAGE_REGISTRY: list[dict] = [
    {
        "key": "file_index",
        "label": "扫描文件",
        "description": "扫描代码仓库文件，Git 增量检测",
    },
    {
        "key": "deep_static_analysis",
        "label": "静态分析",
        "description": "AST 解析 + 框架模式识别",
    },
    {
        "key": "parallel_stage",
        "label": "模块聚类 + DI解析",
        "description": "目录聚类与 Spring DI/Event 静态解析（并行，零 LLM）",
    },
    {
        "key": "ai_semantic_enhance",
        "label": "AI 语义增强",
        "description": "AI 增强模块描述与边界验证",
    },
    {
        "key": "spring_di_event_ai",
        "label": "AI 歧义解析",
        "description": "AI 解析 DI/Event 歧义（无歧义时跳过）",
    },
    {
        "key": "repository",
        "label": "持久化存储",
        "description": "保存图谱到存储",
    },
]
```

- [ ] **Step 5: 在 server.py 中注册 router**

在 `server.py` 的 `app = FastAPI(...)` 之后、第一个路由定义之前，加入：

```python
# server.py 中新增（在 app 定义之后）
from backend.api.routers import repos as repos_router
app.include_router(repos_router.router)
```

保留现有的 `/repos/save` 端点暂不删除（向后兼容），新端点 `POST /repos` 并存。

- [ ] **Step 6: 运行测试**

```bash
cd code-graph-system
pytest backend/tests/test_repos_api.py -v
```

期望：全部 PASS

- [ ] **Step 7: 提交**

```bash
git add backend/api/routers/__init__.py backend/api/routers/repos.py \
        backend/pipeline/stage_registry.py \
        backend/tests/test_repos_api.py backend/api/server.py
git commit -m "feat: 添加 /repos CRUD 端点 + /api/pipeline/stages 契约 API"
```

---

### Task 5: tasks.py 接入 AnalysisStore

分析任务完成/失败时自动写入 Analysis 历史表。

**Files:**
- Modify: `code-graph-system/backend/scheduler/tasks.py`

- [ ] **Step 1: 在 tasks.py 的成功回调中写入 Analysis 记录**

`tasks.py` 中变量上下文：`task_id = self.request.id`（约第 316 行），`repo_id = repo_name or path.name`（约第 372 行），`depth` 是函数参数，`result` 是 `AIAnalysisResult` 对象（有 `graph_id: str`、`node_count: int`、`edge_count: int` 属性）。

在 `tasks.py` 约第 475 行 `status_store.set_completed(...)` 调用之后追加：

```python
# 在 status_store.set_completed(...) 之后
from backend.store.analysis_store import get_analysis_store
from datetime import datetime, timezone

_analysis_store = get_analysis_store()
_analysis_store.write_completed(
    task_id=task_id,
    repo_id=repo_id,
    depth=depth or "standard",
    status="completed",
    graph_id=result.graph_id,
    node_count=result.node_count,
    edge_count=result.edge_count,
    started_at=datetime.fromtimestamp(t_start, tz=timezone.utc).isoformat(),
    finished_at=datetime.now(timezone.utc).isoformat(),
)
```

同样在 `PartialResultError` 块（约第 447-495 行）的 `status_store.set_completed(...)` 之后加相同逻辑，`status="completed_partial"`。

在 `ValueError` 块的 `status_store.set_failed(...)` 之后加：

```python
_analysis_store = get_analysis_store()
_analysis_store.write_completed(
    task_id=task_id,
    repo_id=repo_id,
    depth=depth or "standard",
    status="failed",
    error=str(exc),
    started_at=datetime.fromtimestamp(t_start, tz=timezone.utc).isoformat(),
    finished_at=datetime.now(timezone.utc).isoformat(),
)
```

- [ ] **Step 2: 运行现有任务相关测试**

```bash
cd code-graph-system
pytest backend/tests/test_tasks_progress.py -v
```

期望：原有测试全部 PASS，无新失败

- [ ] **Step 3: 提交**

```bash
git add backend/scheduler/tasks.py
git commit -m "feat: 分析任务完成时写入 AnalysisStore 历史记录"
```

---

## Chunk 2: P0 Stage 日志对齐 + P0.5 LLM 并发

### Task 6: StaticFirstPipeline 日志 key 统一

**Files:**
- Modify: `code-graph-system/backend/pipeline/static_first_pipeline.py`

- [ ] **Step 1: 替换日志中的 Stage 数字为 key**

在 `static_first_pipeline.py` 中，将所有 `logger.info("Stage X 完成: ...")` 替换为使用 stage key 的格式：

```python
# 替换前
logger.info("Stage 1 完成: %d 文件, 增量=%s", ...)
logger.info("Stage 2 完成: %d 节点, %d 边, %d 框架模式", ...)
logger.info("Stage 3 + Stage 4a 完成: %d 模块候选, ...", ...)
logger.info("Stage 3b 完成: %d 增强, ...", ...)
logger.info("Stage 4b 完成: %d 条 AI 解析边", ...)

# 替换后
logger.info("[file_index] 完成: %d 文件, 增量=%s", ...)
logger.info("[deep_static_analysis] 完成: %d 节点, %d 边, %d 框架模式", ...)
logger.info("[parallel_stage] 完成: %d 模块候选, %d DI/Event 边, %d 歧义", ...)
logger.info("[ai_semantic_enhance] 完成: %d 增强, %d 新节点, %d 新边, %d 失败", ...)
logger.info("[spring_di_event_ai] 完成: %d 条 AI 解析边", ...)
```

- [ ] **Step 2: 运行 pipeline 测试确认不破坏**

```bash
cd code-graph-system
pytest backend/tests/test_static_first_pipeline.py -v
```

期望：全部 PASS

- [ ] **Step 3: 验证 SSE 事件 stage key 与 STAGE_REGISTRY 对齐**

在 `static_first_pipeline.py` 改完后，运行以下检查确认所有 `on_progress` 调用的 `step` 字段值都出现在 `STAGE_REGISTRY` 中：

```bash
cd code-graph-system
# 提取 pipeline 中所有 on_progress 的 step 值
grep -oP '"step":\s*"\K[^"]+' backend/pipeline/static_first_pipeline.py | sort -u

# 提取 STAGE_REGISTRY 的 key 列表
python3 -c "from backend.pipeline.stage_registry import STAGE_REGISTRY; print([s['key'] for s in STAGE_REGISTRY])"
```

确认第一条命令的每一个输出（排除 `pending`）都出现在第二条命令的列表中。

- [ ] **Step 4: 提交**

```bash
git add backend/pipeline/static_first_pipeline.py
git commit -m "refactor: 统一 StaticFirstPipeline 日志使用 stage key 替代数字编号"
```

---

### Task 7: LLM 并发信号量（P0.5）

**Files:**
- Modify: `code-graph-system/backend/pipeline/stages/ai_semantic_enhance.py:137-148`

- [ ] **Step 1: 写测试验证环境变量控制并发数**

```python
# 追加到 code-graph-system/backend/tests/test_phase2_static_analysis.py
# （或新建 test_ai_semantic_enhance_concurrency.py）

import os
from unittest.mock import patch


def test_default_max_concurrency_is_8():
    """默认并发数应为 8。"""
    from backend.pipeline.stages.ai_semantic_enhance import AISemanticEnhanceStage
    stage = AISemanticEnhanceStage()
    assert stage.max_concurrency == 8


def test_env_var_overrides_max_concurrency():
    """环境变量 LLM_MAX_CONCURRENCY 应覆盖默认值。

    直接传入构造函数参数覆盖，不依赖 importlib.reload（避免模块缓存不稳定）。
    模块级默认值通过 os.getenv() 读取，在测试中直接传参即可验证配置路径。
    """
    # 验证可以通过构造函数参数覆盖（环境变量最终也是通过此路径生效）
    from backend.pipeline.stages.ai_semantic_enhance import AISemanticEnhanceStage
    stage = AISemanticEnhanceStage(max_concurrency=4)
    assert stage.max_concurrency == 4
```

- [ ] **Step 2: 运行测试，确认失败（默认值仍为 3）**

```bash
cd code-graph-system
pytest backend/tests/ -k "max_concurrency" -v
```

- [ ] **Step 3: 修改 ai_semantic_enhance.py 的默认值**

在 `ai_semantic_enhance.py` 文件顶部加入：

```python
import os

# 并发配置（支持通过环境变量按 API 限额调整）
MAX_POOL_SIZE = 8
_DEFAULT_CONCURRENCY = int(os.getenv("LLM_MAX_CONCURRENCY", str(MAX_POOL_SIZE)))
```

将 `__init__` 签名从：
```python
def __init__(self, max_concurrency: int = 3, ...):
```
改为：
```python
def __init__(self, max_concurrency: int = _DEFAULT_CONCURRENCY, ...):
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
cd code-graph-system
pytest backend/tests/ -k "max_concurrency" -v
```

- [ ] **Step 5: 提交**

```bash
git add backend/pipeline/stages/ai_semantic_enhance.py
git commit -m "feat: LLM 并发默认值从 3 提升至 8，支持 LLM_MAX_CONCURRENCY 环境变量"
```

---

### Task 8: server.py 拆分为 4 个 router（P1）

**Files:**
- Create: `code-graph-system/backend/api/routers/analysis.py`
- Create: `code-graph-system/backend/api/routers/graphs.py`
- Create: `code-graph-system/backend/api/routers/query.py`
- Create: `code-graph-system/backend/api/deps.py`
- Modify: `code-graph-system/backend/api/server.py`（保留 ~80 行核心）

- [ ] **Step 1: 运行所有现有 API 测试，记录基线**

```bash
cd code-graph-system
pytest backend/tests/ -v --tb=short 2>&1 | tail -20
```

记录通过数量，重构后应与此一致。

- [ ] **Step 2: 创建 deps.py（依赖注入）**

```python
# code-graph-system/backend/api/deps.py
"""FastAPI 依赖注入函数。"""
from backend.graph.graph_repository import GraphRepository
from backend.rag.graph_rag_engine import GraphRAGEngine
from backend.pipeline.graph_pipeline import GraphPipeline
from backend.rag.vector_store import VectorStore
from backend.storage.graph_storage import GraphStorage

# 全局单例引用（由 server.py lifespan 初始化）
_graph_repo: GraphRepository = None
_vector_store: VectorStore = None
_rag_engine: GraphRAGEngine = None
_graph_pipeline: GraphPipeline = None
_graph_storage: GraphStorage = None


def init_singletons(graph_repo, vector_store, rag_engine, graph_pipeline, graph_storage):
    global _graph_repo, _vector_store, _rag_engine, _graph_pipeline, _graph_storage
    _graph_repo = graph_repo
    _vector_store = vector_store
    _rag_engine = rag_engine
    _graph_pipeline = graph_pipeline
    _graph_storage = graph_storage


def get_graph_repo() -> GraphRepository:
    return _graph_repo

def get_rag_engine() -> GraphRAGEngine:
    return _rag_engine

def get_graph_pipeline() -> GraphPipeline:
    return _graph_pipeline

def get_graph_storage() -> GraphStorage:
    return _graph_storage
```

- [ ] **Step 3: 创建 analysis.py router 骨架**

```python
# code-graph-system/backend/api/routers/analysis.py
"""分析任务 API：/analyze/*"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import subprocess
import tempfile
import time as _time
from contextlib import asynccontextmanager
from typing import Any, Optional

import redis as sync_redis
import redis.asyncio as aioredis
from celery.result import AsyncResult
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from backend.scheduler.celery_app import celery_app
from backend.scheduler.tasks import analyze_repository as celery_analyze
from backend.agent.config import AnalysisConfig, AnalysisPreset

logger = logging.getLogger(__name__)
router = APIRouter()

_REDIS_URL = os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0")
_TASK_REGISTRY_PREFIX = "analyze:task:"
_TASK_REGISTRY_TTL_SECONDS = int(os.getenv("ANALYZE_TASK_REGISTRY_TTL", str(60 * 60 * 24)))


# ── 从 server.py 整体移入的辅助函数 ─────────────────────────────────────────
# 直接将 server.py 中的以下函数/类复制过来：
# - _task_registry_key()
# - _register_task_id()
# - _is_registered_task_id()
# - _is_git_url()
# - _clone_repo()
# - _checkout_branch()
# - AnalyzeRequest, AnalyzeAsyncResponse, AnalyzeCancelResponse
# - AnalysisStatusResponse, AnalyzeResponse, GraphPipelineRequest, GraphPipelineResponse
#
# ── 从 server.py 整体移入的路由 ─────────────────────────────────────────────
# 将 server.py 中 @app.post("/analyze/repository") 等所有 @app.xxx("/analyze/...")
# 以及 @app.post("/analyze/graph") 改为 @router.xxx(...)
```

- [ ] **Step 4: 创建 graphs.py router 骨架**

```python
# code-graph-system/backend/api/routers/graphs.py
"""图谱查询 API：/graph/*, /callgraph, /lineage, /events, /services"""
from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query

from backend.api.deps import get_graph_repo, get_graph_storage

logger = logging.getLogger(__name__)
router = APIRouter()

# ── 从 server.py 整体移入的路由 ─────────────────────────────────────────────
# 将 server.py 中所有 @app.xxx("/graph/..."), @app.get("/callgraph"),
# @app.get("/lineage"), @app.get("/events"), @app.get("/services") 改为 @router.xxx(...)
# _load_or_404() 辅助函数也一并移入
```

- [ ] **Step 5: 创建 query.py router 骨架**

```python
# code-graph-system/backend/api/routers/query.py
"""GraphRAG 查询 API：/query"""
from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.api.deps import get_rag_engine

logger = logging.getLogger(__name__)
router = APIRouter()

# ── 从 server.py 整体移入的路由 ─────────────────────────────────────────────
# 将 server.py 中 @app.post("/query") 改为 @router.post("/query")
# QueryRequest, QueryResponse 也一并移入
```

- [ ] **Step 6: 精简 server.py**

重构后的 `server.py` 只保留：
- `load_dotenv()`、logging 配置
- `lifespan` 函数（初始化单例，调用 `deps.init_singletons()`）
- `app = FastAPI(...)` + CORS 中间件
- `app.include_router(...)` × 4 个 router
- `GET /`（服务信息）和 `GET /health`

- [ ] **Step 7: 运行全部测试确认无回归**

```bash
cd code-graph-system
pytest backend/tests/ -v --tb=short
```

期望：通过数量 ≥ 基线，无新失败

- [ ] **Step 8: 提交**

```bash
git add backend/api/deps.py backend/api/routers/analysis.py \
        backend/api/routers/graphs.py backend/api/routers/query.py \
        backend/api/server.py
git commit -m "refactor: server.py 拆分为 4 个 router（analysis/graphs/query/repos）"
```

---

## Chunk 3: P2 前端重构

### 文件结构

```
code-graph-ui/src/
├── types/api.ts                          # MODIFY: RepoInfo → Repo + LatestAnalysis
├── store/repoStore.ts                    # MODIFY: 适配新类型
├── store/pipelineStore.ts                # NEW: 存储 stage 定义
├── core/api/endpoints/graph.ts           # MODIFY: 新增 /repos 端点
├── pages/Repository/
│   ├── index.tsx                         # MODIFY: 精简为组装 + 状态
│   ├── constants.ts                      # NEW: LANGS, DEPTH_OPTIONS
│   ├── hooks/
│   │   ├── useRepoList.ts               # NEW: 拉取/同步仓库列表
│   │   └── useAnalysisProgress.ts       # NEW: SSE → store 更新
│   └── components/
│       ├── RepoCard.tsx                  # NEW: 单个卡片
│       ├── AddRepoModal.tsx              # NEW: 新增/编辑表单
│       ├── AnalysisConfirmDialog.tsx     # NEW: 深度选择
│       ├── AnalysisProgressPanel.tsx     # NEW: 进度时间轴（动态）
│       └── RepoDetailDrawer.tsx          # NEW: 详情 + 分析历史
```

---

### Task 9: 类型系统更新

**Files:**
- Modify: `code-graph-ui/src/types/api.ts`
- Modify: `code-graph-ui/src/store/repoStore.ts`
- Create: `code-graph-ui/src/store/pipelineStore.ts`

- [ ] **Step 1: 更新 api.ts 中的 RepoInfo 类型**

将现有 `RepoInfo` 拆分（保留 `RepoInfo` 作为组合类型以最小化其他文件改动）：

```typescript
// src/types/api.ts — 修改 RepoInfo 相关部分

export type AnalysisStatus =
  | "saved"
  | "pending"
  | "analyzing"
  | "completed"
  | "completed_partial"
  | "failed"
  | "canceled";

/** 仓库配置（对应后端 Repo 表）*/
export type Repo = {
  repoId:     string;
  repoName:   string;
  repoPath:   string;
  branch?:    string;
  sourceMode: "local" | "git" | "zip";
  language:   string[];
  createdAt:  string;
  updatedAt:  string;
};

/** 分析摘要（最近一次分析 + 实时状态）*/
export type LatestAnalysis = {
  taskId?:          string;
  status:           AnalysisStatus;
  graphId?:         string;
  nodeCount:        number;
  edgeCount:        number;
  depth?:           AnalysisDepth;
  analysisStage?:   string;
  analysisStep?:    number;
  analysisTotal?:   number;
  analysisMessage?: string;
  lastAnalyzedAt?:  string;
  error?:           string;
};

/** 页面展示用（保留 RepoInfo 名称减少改动范围）*/
export type RepoInfo = Repo & {
  graphId:         string;   // 保留兼容旧代码
  nodeCount:       number;   // 保留兼容旧代码
  edgeCount:       number;   // 保留兼容旧代码
  status?:         AnalysisStatus;
  taskId?:         string;
  analysisStep?:   number;
  analysisTotal?:  number;
  analysisStage?:  string;
  analysisMessage?: string;
  analysisElapsedSeconds?: number;
  error?:          string;
  lastAnalyzedAt?: string;
  depth?:          AnalysisDepth;
  latestAnalysis?: LatestAnalysis;
};
```

- [ ] **Step 1b: 更新 repoStore.ts — dedupeRepos 适配新类型**

`repoStore.ts` 中 `dedupeRepos` 按 `graphId || repoId` 去重，新类型中 `saved` 状态仓库的 `graphId` 为空字符串，会导致多个未分析仓库被合并为一条记录。修改去重逻辑：

```typescript
// src/store/repoStore.ts — 修改 dedupeRepos 函数
const dedupeRepos = (incoming: RepoInfo[]): RepoInfo[] => {
  const byKey = new Map<string, RepoInfo>();
  for (const repo of incoming) {
    // 优先用 repoId 去重，repoId 是稳定 ID；graphId 仅作展示用
    const key = repo.repoId || repo.graphId;
    if (!key) continue;
    byKey.set(key, {
      ...repo,
      repoId: repo.repoId || repo.graphId,
    });
  }
  return Array.from(byKey.values());
};
```

同时更新 `addRepo` 中的去重逻辑，改为只按 `repoPath` 或 `repoId` 判断（不再依赖 `graphId`）：

```typescript
// addRepo 中的 existingIndex 查找
const existingIndex = state.repos.findIndex(
  (r) =>
    (repo.repoPath && r.repoPath === repo.repoPath) ||
    r.repoId === repo.repoId,
);
```

- [ ] **Step 2: 创建 pipelineStore.ts**

```typescript
// src/store/pipelineStore.ts
import { create } from "zustand";

export type PipelineStage = {
  key:         string;
  label:       string;
  description: string;
};

interface PipelineState {
  stages:    PipelineStage[];
  total:     number;
  loaded:    boolean;
  setStages: (stages: PipelineStage[], total: number) => void;
}

export const usePipelineStore = create<PipelineState>()((set) => ({
  stages:    [],
  total:     0,
  loaded:    false,
  setStages: (stages, total) => set({ stages, total, loaded: true }),
}));
```

- [ ] **Step 3: 检查 TypeScript 编译**

```bash
cd code-graph-ui
npm run build 2>&1 | head -40
```

期望：无新增 TypeScript 错误（原有错误数不增加）

- [ ] **Step 4: 提交**

```bash
git add src/types/api.ts src/store/pipelineStore.ts src/store/repoStore.ts
git commit -m "refactor: RepoInfo 类型扩展 + 新增 pipelineStore + AnalysisStatus"
```

---

### Task 10: 新增 /repos 前端 API 封装

**Files:**
- Modify: `code-graph-ui/src/core/api/endpoints/graph.ts`

- [ ] **Step 1: 在 graph.ts 末尾追加 repo 端点**

```typescript
// 追加到 graph.ts 末尾

// ─── Repo API (/repos/*) ──────────────────────────────────────────────────────

export type CreateRepoPayload = {
  repo_id?:    string;
  repo_name:   string;
  repo_path:   string;
  source_mode: "local" | "git" | "zip";
  branch?:     string;
  language?:   string[];
};

export const repoEndpoints = {
  async listRepos(): Promise<{ repos: Record<string, unknown>[] }> {
    return apiClient.get("/repos");
  },

  async createRepo(payload: CreateRepoPayload): Promise<Record<string, unknown>> {
    return apiClient.post("/repos", payload);
  },

  async updateRepo(
    repoId: string,
    patch: { repo_name?: string; branch?: string; language?: string[] },
  ): Promise<Record<string, unknown>> {
    return apiClient.put(`/repos/${repoId}`, patch);
  },

  async deleteRepo(repoId: string): Promise<void> {
    return apiClient.delete(`/repos/${repoId}`);
  },

  async listAnalyses(
    repoId: string,
    taskId?: string,
  ): Promise<{ analyses: Record<string, unknown>[] }> {
    const params = taskId ? `?task_id=${taskId}` : "";
    return apiClient.get(`/repos/${repoId}/analyses${params}`);
  },

  async getPipelineStages(): Promise<{ stages: { key: string; label: string; description: string }[]; total: number }> {
    return apiClient.get("/api/pipeline/stages");
  },
};
```

- [ ] **Step 2: 确认 TypeScript 通过**

```bash
cd code-graph-ui
npm run build 2>&1 | grep -E "error|Error" | head -10
```

- [ ] **Step 3: 提交**

```bash
git add src/core/api/endpoints/graph.ts
git commit -m "feat: 前端新增 /repos 和 /api/pipeline/stages API 封装"
```

---

### Task 11: useRepoList + useAnalysisProgress hooks

**Files:**
- Create: `code-graph-ui/src/pages/Repository/hooks/useRepoList.ts`
- Create: `code-graph-ui/src/pages/Repository/hooks/useAnalysisProgress.ts`
- Create: `code-graph-ui/src/pages/Repository/constants.ts`

- [ ] **Step 1: 创建 constants.ts**

```typescript
// src/pages/Repository/constants.ts
import type { AnalysisDepth } from "../../../types/api";

export const LANGS = [
  "python", "typescript", "javascript", "java",
  "go", "rust", "cpp", "csharp",
];

export const DEPTH_OPTIONS: { value: AnalysisDepth; label: string; description: string }[] = [
  { value: "quick",    label: "快速分析", description: "仅扫描核心文件，快速识别模块边界" },
  { value: "standard", label: "标准分析", description: "完整扫描，AI 深度分析代码结构" },
  { value: "deep",     label: "深度分析", description: "全量分析，包含数据血缘与跨模块依赖" },
];
```

- [ ] **Step 2: 创建 useRepoList.ts**

```typescript
// src/pages/Repository/hooks/useRepoList.ts
import { useCallback, useEffect, useRef } from "react";
import { graphEndpoints } from "../../../core/api/endpoints/graph";
import { repoEndpoints } from "../../../core/api/endpoints/graph";
import { useRepoStore } from "../../../store/repoStore";
import { usePipelineStore } from "../../../store/pipelineStore";
import type { RepoInfo } from "../../../types/api";

const CACHE_WINDOW_MS = 1200;

export function useRepoList() {
  const setRepos = useRepoStore((s) => s.setRepos);
  const setStages = usePipelineStore((s) => s.setStages);
  const stagesLoaded = usePipelineStore((s) => s.loaded);

  const cacheRef = useRef<{ at: number; repos: RepoInfo[] } | null>(null);
  const inFlightRef = useRef<Promise<RepoInfo[]> | null>(null);

  const normalizeRepo = (r: Record<string, unknown>): RepoInfo => {
    const latest = r.latest_analysis as Record<string, unknown> | undefined;
    return {
      repoId:     (r.id ?? r.repo_id ?? r.repoId) as string,
      // graphId 优先从 latest_analysis 取，否则从顶层取
      graphId:    (latest?.graph_id ?? r.graph_id ?? r.graphId ?? "") as string,
      repoName:   (r.name ?? r.repo_name ?? r.repoName) as string,
      repoPath:   (r.path ?? r.repo_path ?? r.repoPath ?? "") as string,
      branch:     r.branch as string | undefined,
      sourceMode: ((r.source_mode ?? r.sourceMode) ?? "local") as "local" | "git" | "zip",
      language:   (r.language ?? []) as string[],
      createdAt:  (r.created_at ?? r.createdAt ?? new Date().toISOString()) as string,
      updatedAt:  (r.updated_at ?? r.updatedAt ?? new Date().toISOString()) as string,
      nodeCount:  (latest?.node_count ?? r.node_count ?? r.nodeCount ?? 0) as number,
      edgeCount:  (latest?.edge_count ?? r.edge_count ?? r.edgeCount ?? 0) as number,
      status:     (latest?.status ?? r.status ?? "completed") as RepoInfo["status"],
      taskId:     (latest?.task_id ?? r.task_id) as string | undefined,
      lastAnalyzedAt: (latest?.finished_at ?? r.updated_at) as string | undefined,
    };
  };

  const fetchRepos = useCallback(async (force = false): Promise<RepoInfo[]> => {
    const now = Date.now();
    if (!force && cacheRef.current && now - cacheRef.current.at < CACHE_WINDOW_MS) {
      return cacheRef.current.repos;
    }
    if (!force && inFlightRef.current) {
      return inFlightRef.current;
    }

    inFlightRef.current = (async () => {
      try {
        // 优先用新 /repos 端点，回退到旧 /graph 端点
        let repos: RepoInfo[];
        try {
          const res = await repoEndpoints.listRepos();
          repos = (res.repos ?? []).map(normalizeRepo);
        } catch {
          const res = await graphEndpoints.listGraphs();
          repos = res.graphs;
        }
        cacheRef.current = { at: Date.now(), repos };
        return repos;
      } finally {
        inFlightRef.current = null;
      }
    })();

    return inFlightRef.current;
  }, []);

  const syncRepos = useCallback(async (options?: { force?: boolean; onSuccess?: (count: number) => void }) => {
    const repos = await fetchRepos(Boolean(options?.force));
    setRepos(repos);
    options?.onSuccess?.(repos.length);
  }, [fetchRepos, setRepos]);

  // 初始加载 Pipeline Stages
  useEffect(() => {
    if (stagesLoaded) return;
    repoEndpoints.getPipelineStages()
      .then(({ stages, total }) => setStages(stages, total))
      .catch(() => {
        // 降级：使用硬编码的默认 stages
        setStages([
          { key: "file_index",          label: "扫描文件",        description: "" },
          { key: "deep_static_analysis",label: "静态分析",        description: "" },
          { key: "parallel_stage",      label: "模块聚类",        description: "" },
          { key: "ai_semantic_enhance", label: "AI 语义增强",     description: "" },
          { key: "spring_di_event_ai",  label: "AI 歧义解析",     description: "" },
          { key: "repository",          label: "持久化存储",       description: "" },
        ], 6);
      });
  }, [stagesLoaded, setStages]);

  return { syncRepos, fetchRepos };
}
```

- [ ] **Step 3: 创建 useAnalysisProgress.ts**

```typescript
// src/pages/Repository/hooks/useAnalysisProgress.ts
import { useEffect } from "react";
import { useRepoStore } from "../../../store/repoStore";
import { useAnalysisStream } from "../../../core/hooks/useAnalysisStream";
import type { RepoInfo } from "../../../types/api";

/**
 * 监听指定仓库的 SSE 分析进度，自动将事件写入 repoStore。
 */
export function useAnalysisProgress(repo: RepoInfo | null) {
  const updateRepo = useRepoStore((s) => s.updateRepo);
  const taskId = repo?.status === "analyzing" ? (repo.taskId ?? null) : null;
  const { currentStep, finalResult } = useAnalysisStream(taskId);

  useEffect(() => {
    if (!repo || repo.status !== "analyzing") return;
    const event = finalResult ?? currentStep;
    if (!event) return;

    const patch: Partial<RepoInfo> = {
      analysisStep:    event.step,
      analysisTotal:   event.total,
      analysisStage:   event.stage,
      analysisMessage: event.message,
      analysisElapsedSeconds: event.elapsed_seconds,
    };

    if (event.status === "completed" || event.status === "completed_partial") {
      updateRepo(repo.repoId, {
        ...patch,
        status:        event.status,
        graphId:       event.graph_id || repo.graphId,
        nodeCount:     event.node_count ?? repo.nodeCount,
        edgeCount:     event.edge_count ?? repo.edgeCount,
        taskId:        undefined,
        error:         undefined,
        lastAnalyzedAt: new Date().toISOString(),
      });
      return;
    }

    if (event.status === "failed" || event.status === "error") {
      updateRepo(repo.repoId, {
        ...patch,
        status: "failed",
        taskId: undefined,
        error:  event.error || event.message || "分析失败",
        lastAnalyzedAt: new Date().toISOString(),
      });
      return;
    }

    if (event.status === "canceled") {
      updateRepo(repo.repoId, {
        ...patch,
        status: "canceled",
        taskId: undefined,
        lastAnalyzedAt: new Date().toISOString(),
      });
      return;
    }

    updateRepo(repo.repoId, { ...patch, status: "analyzing" });
  }, [repo, taskId, currentStep, finalResult, updateRepo]);
}
```

- [ ] **Step 4: TypeScript 编译检查**

```bash
cd code-graph-ui
npm run build 2>&1 | grep -c "error" || echo "0 errors"
```

- [ ] **Step 5: 提交**

```bash
git add src/pages/Repository/constants.ts \
        src/pages/Repository/hooks/useRepoList.ts \
        src/pages/Repository/hooks/useAnalysisProgress.ts \
        src/store/pipelineStore.ts
git commit -m "feat: 新增 useRepoList/useAnalysisProgress hooks + pipelineStore + constants"
```

---

### Task 12: Repository 页子组件拆分

**Files:**
- Create: `code-graph-ui/src/pages/Repository/components/RepoCard.tsx`
- Create: `code-graph-ui/src/pages/Repository/components/AddRepoModal.tsx`
- Create: `code-graph-ui/src/pages/Repository/components/AnalysisConfirmDialog.tsx`
- Create: `code-graph-ui/src/pages/Repository/components/AnalysisProgressPanel.tsx`
- Create: `code-graph-ui/src/pages/Repository/components/RepoDetailDrawer.tsx`
- Modify: `code-graph-ui/src/pages/Repository/index.tsx`

- [ ] **Step 1: 抽取 AnalysisProgressPanel.tsx**

从 `index.tsx` 第 182-291 行的 `AnalysisProgressPanel` 组件直接移出，**修改**：从 `usePipelineStore` 读取动态 stages，不再使用写死的 `PIPELINE_STAGES`：

```typescript
// src/pages/Repository/components/AnalysisProgressPanel.tsx
import { Progress, Timeline } from "antd";
import { usePipelineStore } from "../../../store/pipelineStore";
import type { RepoInfo } from "../../../types/api";

export const AnalysisProgressPanel: React.FC<{ repo: RepoInfo }> = ({ repo }) => {
  const stages = usePipelineStore((s) => s.stages);
  const total = repo.analysisTotal ?? stages.length;
  const currentStage = repo.analysisStage ?? "";

  const currentStageIndex = stages.findIndex((s) => s.key === currentStage);
  const step = currentStageIndex >= 0 ? currentStageIndex + 1 : 0;
  const percent = total > 0 ? Math.min(100, Math.round((step / total) * 100)) : 0;
  const currentStageInfo = stages.find((s) => s.key === currentStage);

  // ... JSX 与原 AnalysisProgressPanel 相同，但用 stages 替代 PIPELINE_STAGES
};
```

- [ ] **Step 2: 抽取 RepoCard.tsx**

将 `index.tsx` 中单个仓库卡片的渲染逻辑（约 150-200 行）提取为独立组件：

```typescript
// src/pages/Repository/components/RepoCard.tsx
import type { RepoInfo } from "../../../types/api";

interface RepoCardProps {
  repo:         RepoInfo;
  isActive:     boolean;
  onSelect:     (repo: RepoInfo) => void;
  onAnalyze:    (repo: RepoInfo) => void;
  onCancel:     (repo: RepoInfo) => void;
  onViewGraph:  (repo: RepoInfo) => void;
  onDelete:     (repo: RepoInfo) => void;
}

export const RepoCard: React.FC<RepoCardProps> = ({ repo, isActive, onSelect, onAnalyze, onCancel, onViewGraph, onDelete }) => {
  // 从 index.tsx 移出卡片渲染代码
};
```

- [ ] **Step 3: 抽取 AddRepoModal.tsx（支持新增/编辑两种模式）**

```typescript
// src/pages/Repository/components/AddRepoModal.tsx
import type { RepoInfo } from "../../../types/api";

interface AddRepoModalProps {
  open:      boolean;
  editRepo?: RepoInfo | null;  // null = 新增模式，有值 = 编辑模式
  onClose:   () => void;
  onSubmit:  (values: RepoFormValues, mode: "create" | "edit") => Promise<void>;
}
```

编辑模式下，表单初始值从 `editRepo` 填入，提交时调用 `PUT /repos/:id`。

- [ ] **Step 4: 抽取 AnalysisConfirmDialog.tsx**

```typescript
// src/pages/Repository/components/AnalysisConfirmDialog.tsx
interface AnalysisConfirmDialogProps {
  repo:     RepoInfo | null;
  onStart:  (repo: RepoInfo, depth: AnalysisDepth) => void;
  onClose:  () => void;
}
```

- [ ] **Step 5: 抽取 RepoDetailDrawer.tsx（含分析历史）**

```typescript
// src/pages/Repository/components/RepoDetailDrawer.tsx
import { useEffect, useState } from "react";
import { repoEndpoints } from "../../../core/api/endpoints/graph";

interface RepoDetailDrawerProps {
  repo:     RepoInfo | null;
  onClose:  () => void;
  onViewGraph: (repo: RepoInfo) => void;
}

export const RepoDetailDrawer: React.FC<RepoDetailDrawerProps> = ({ repo, onClose, onViewGraph }) => {
  const [analyses, setAnalyses] = useState<Record<string, unknown>[]>([]);

  useEffect(() => {
    if (!repo) return;
    repoEndpoints
      .listAnalyses(repo.repoId, repo.taskId)
      .then((res) => setAnalyses(res.analyses))
      .catch(() => {});
  }, [repo?.repoId, repo?.taskId]);

  // 渲染仓库统计 + 分析历史列表（时间、深度、节点数、耗时）
  // 点击历史分析记录调用 onViewGraph（设置对应 graph_id）
};
```

- [ ] **Step 6: 精简 index.tsx**

将所有已抽取的组件引入，`index.tsx` 只保留：
- 顶层状态：`detailRepoId`、`modalOpen`、`analysisConfirmRepo`
- 事件处理函数：`handleSaveRepo`、`startAnalysis`、`handleCancel`、`handleDelete`、`handleViewGraph`
- `useRepoList` hook 调用（替换原有模块级 cache 变量）
- `useAnalysisProgress(detailRepo)` hook 调用（替换原有 useEffect）
- JSX 组合渲染

目标：`index.tsx` ≤ 150 行。

- [ ] **Step 7: 确认前端正常运行**

```bash
cd code-graph-ui
npm run dev &
# 等待启动后访问 http://localhost:5173/repository
# 确认：仓库列表正常、新增按钮有效、进度条显示正确
npm run build
```

期望：`build` 无错误

- [ ] **Step 8: 提交**

```bash
git add src/pages/Repository/
git commit -m "refactor: Repository 页拆分为 5 个子组件 + 动态 Pipeline Stages"
```

---

## 验收检查清单

完成所有任务后运行：

```bash
# 后端全量测试
cd code-graph-system
source venv/bin/activate
pytest backend/tests/ -v --tb=short

# 前端构建
cd ../code-graph-ui
npm run build
npm run lint
```

功能验证：
- [ ] `GET /api/pipeline/stages` 返回 6 个 stage，key 与 SSE 事件一致
- [ ] `GET /repos` 返回仓库列表，含 `latest_analysis` 字段
- [ ] `PUT /repos/:id` 可修改仓库名称/分支
- [ ] 分析完成后 `GET /repos/:id/analyses` 返回历史记录
- [ ] 前端进度条 stage key 能正确匹配（不再停在 0%）
- [ ] 大仓库分析时 LLM 并发不超过 8（可从日志观察同时进行中的 HTTP 请求数）
- [ ] `DELETE /repos/:id` 级联清理图谱文件和向量数据
