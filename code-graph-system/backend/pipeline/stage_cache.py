"""阶段缓存管理器 — 支持断点续跑。"""
from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class StageCacheEntry:
    """阶段缓存条目。"""

    stage_name: str
    repo_name: str
    commit_sha: str
    data: Any
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())


class StageCacheManager:
    """阶段缓存管理器（内存 + 可选磁盘持久化）。"""

    def __init__(self, cache_dir: Path = Path("data/pipeline_cache")) -> None:
        self.cache_dir = Path(cache_dir)
        self._memory: dict[str, StageCacheEntry] = {}

    def get_cache_key(self, repo_name: str, commit_sha: str, stage: str) -> str:
        if commit_sha:
            sha_part = commit_sha[:8]
        else:
            sha_part = f"mtime{self._dir_mtime_hash(repo_name)}"
        return f"{repo_name}:{sha_part}:{stage}"

    def load(self, repo_name: str, commit_sha: str, stage: str) -> StageCacheEntry | None:
        """加载缓存：先查内存，再查磁盘。"""
        key = self.get_cache_key(repo_name, commit_sha, stage)
        if key in self._memory:
            return self._memory[key]
        # 尝试从磁盘加载
        return self._load_from_disk(repo_name, commit_sha, stage, key)

    def save(self, entry: StageCacheEntry, persist: bool = False) -> None:
        """保存缓存到内存，可选持久化到磁盘。"""
        key = self.get_cache_key(entry.repo_name, entry.commit_sha, entry.stage_name)
        self._memory[key] = entry
        if persist and entry.commit_sha:
            self._save_to_disk(entry)

    def clear(self, repo_name: str) -> None:
        """清除指定仓库的所有内存缓存。"""
        to_delete = [k for k in self._memory if k.startswith(f"{repo_name}:")]
        for k in to_delete:
            del self._memory[k]

    # ── 私有 ──────────────────────────────────────────────────────────────────

    def _save_to_disk(self, entry: StageCacheEntry) -> None:
        try:
            repo_dir = self.cache_dir / entry.repo_name
            repo_dir.mkdir(parents=True, exist_ok=True)
            file_name = f"{entry.commit_sha[:8]}_{entry.stage_name}.json"
            cache_file = repo_dir / file_name
            payload = {
                "stage_name": entry.stage_name,
                "repo_name": entry.repo_name,
                "commit_sha": entry.commit_sha,
                "created_at": entry.created_at,
                "data": entry.data,
            }
            cache_file.write_text(
                json.dumps(payload, ensure_ascii=False, default=str),
                encoding="utf-8",
            )
        except Exception as e:
            logger.warning(
                "阶段缓存持久化失败 %s/%s: %s", entry.repo_name, entry.stage_name, e
            )

    def _load_from_disk(
        self, repo_name: str, commit_sha: str, stage: str, key: str
    ) -> StageCacheEntry | None:
        if not commit_sha:
            return None
        try:
            file_name = f"{commit_sha[:8]}_{stage}.json"
            cache_file = self.cache_dir / repo_name / file_name
            if not cache_file.exists():
                return None
            payload = json.loads(cache_file.read_text(encoding="utf-8"))
            entry = StageCacheEntry(
                stage_name=payload["stage_name"],
                repo_name=payload["repo_name"],
                commit_sha=payload["commit_sha"],
                data=payload["data"],
                created_at=payload.get("created_at", ""),
            )
            self._memory[key] = entry
            return entry
        except Exception as e:
            logger.warning("从磁盘加载阶段缓存失败 %s/%s: %s", repo_name, stage, e)
            return None

    @staticmethod
    def _dir_mtime_hash(repo_name: str) -> str:
        """非 Git 仓库时用 repo_name 的哈希作为替代标识。"""
        return hashlib.md5(repo_name.encode()).hexdigest()[:6]
