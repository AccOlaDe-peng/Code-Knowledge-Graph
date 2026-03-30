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

        # 插入 Repo（已存在则忽略；同时按 path 或 name 去重，避免与 POST /repos 创建的记录重复）
        # 优先按 path 检查，path 为空时按 name 检查
        existing = None
        if repo_path:
            existing = db.execute_one("SELECT id FROM repo WHERE path=?", (repo_path,))
        if existing is None and repo_name:
            existing = db.execute_one("SELECT id FROM repo WHERE name=?", (repo_name,))
        if existing:
            logger.debug("迁移跳过 repo_id=%s，已存在（id=%s, path=%s, name=%s）",
                         repo_id, existing["id"], repo_path, repo_name)
            migrated += 1
            continue
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

    # 重命名原文件（Windows 上 rename 不覆盖已存在文件，用 replace 代替）
    migrated_path = path.with_suffix(".json.migrated")
    path.replace(migrated_path)
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
