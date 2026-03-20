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
