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
