"""阶段缓存管理器 — 支持断点续跑和模块级增量缓存。"""
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


@dataclass
class ModuleCacheEntry:
    """模块级缓存条目。"""

    module_id: str
    repo_name: str
    commit_sha: str
    enhancement: Any  # ModuleEnhancement 数据
    nodes: list  # 新增节点
    edges: list  # 新增边
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())


class StageCacheManager:
    """阶段缓存管理器（内存 + 可选磁盘持久化）。

    支持两级缓存：
    1. Stage 级：整个 Stage 的结果缓存
    2. Module 级：单个模块的分析结果缓存（用于增量分析）
    """

    def __init__(self, cache_dir: Path = Path("data/pipeline_cache")) -> None:
        self.cache_dir = Path(cache_dir)
        self._memory: dict[str, StageCacheEntry] = {}
        self._module_memory: dict[str, ModuleCacheEntry] = {}

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
        # 清除模块缓存
        module_to_delete = [k for k in self._module_memory if k.startswith(f"{repo_name}:")]
        for k in module_to_delete:
            del self._module_memory[k]

    # ── 模块级缓存 ─────────────────────────────────────────────────────────────

    def get_module_cache_key(
        self,
        repo_name: str,
        commit_sha: str,
        module_id: str,
    ) -> str:
        """生成模块级缓存键。"""
        if commit_sha:
            sha_part = commit_sha[:8]
        else:
            sha_part = f"mtime{self._dir_mtime_hash(repo_name)}"
        # 规范化 module_id（去掉 "module:" 前缀）
        clean_module_id = module_id.replace("module:", "").replace(":", "_")
        return f"{repo_name}:{sha_part}:module_{clean_module_id}"

    def load_module(
        self,
        repo_name: str,
        commit_sha: str,
        module_id: str,
    ) -> ModuleCacheEntry | None:
        """加载模块缓存。"""
        key = self.get_module_cache_key(repo_name, commit_sha, module_id)
        if key in self._module_memory:
            return self._module_memory[key]
        return self._load_module_from_disk(repo_name, commit_sha, module_id, key)

    def save_module(
        self,
        entry: ModuleCacheEntry,
        persist: bool = False,
    ) -> None:
        """保存模块缓存。"""
        key = self.get_module_cache_key(
            entry.repo_name, entry.commit_sha, entry.module_id
        )
        self._module_memory[key] = entry
        if persist and entry.commit_sha:
            self._save_module_to_disk(entry)

    def get_modules_to_reanalyze(
        self,
        repo_name: str,
        commit_sha: str,
        module_candidates: list,
        changed_files: set[str],
    ) -> tuple[list, list]:
        """确定需要重新分析的模块。

        Args:
            repo_name: 仓库名称
            commit_sha: 当前 commit SHA
            module_candidates: 所有模块候选列表
            changed_files: 变更文件集合

        Returns:
            (需要重新分析的模块, 可从缓存加载的模块)
        """
        to_reanalyze = []
        from_cache = []

        for candidate in module_candidates:
            # 检查模块是否有变更文件
            has_changes = any(
                f in changed_files
                for f in candidate.files
            )

            if has_changes:
                to_reanalyze.append(candidate)
            else:
                # 检查是否有缓存
                cached = self.load_module(repo_name, commit_sha, candidate.id)
                if cached:
                    from_cache.append((candidate, cached))
                else:
                    # 无缓存，需要分析
                    to_reanalyze.append(candidate)

        logger.info(
            "增量分析: %d 模块需要重分析, %d 模块可从缓存加载",
            len(to_reanalyze),
            len(from_cache),
        )

        return to_reanalyze, from_cache

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

    def _save_module_to_disk(self, entry: ModuleCacheEntry) -> None:
        """保存模块缓存到磁盘。"""
        try:
            repo_dir = self.cache_dir / entry.repo_name / "modules"
            repo_dir.mkdir(parents=True, exist_ok=True)
            clean_module_id = entry.module_id.replace("module:", "").replace(":", "_")
            file_name = f"{entry.commit_sha[:8]}_{clean_module_id}.json"
            cache_file = repo_dir / file_name
            payload = {
                "module_id": entry.module_id,
                "repo_name": entry.repo_name,
                "commit_sha": entry.commit_sha,
                "created_at": entry.created_at,
                "enhancement": entry.enhancement,
                "nodes": entry.nodes,
                "edges": entry.edges,
            }
            cache_file.write_text(
                json.dumps(payload, ensure_ascii=False, default=str),
                encoding="utf-8",
            )
        except Exception as e:
            logger.warning(
                "模块缓存持久化失败 %s/%s: %s",
                entry.repo_name, entry.module_id, e
            )

    def _load_module_from_disk(
        self,
        repo_name: str,
        commit_sha: str,
        module_id: str,
        key: str,
    ) -> ModuleCacheEntry | None:
        """从磁盘加载模块缓存。"""
        if not commit_sha:
            return None
        try:
            clean_module_id = module_id.replace("module:", "").replace(":", "_")
            file_name = f"{commit_sha[:8]}_{clean_module_id}.json"
            cache_file = self.cache_dir / repo_name / "modules" / file_name
            if not cache_file.exists():
                return None
            payload = json.loads(cache_file.read_text(encoding="utf-8"))
            entry = ModuleCacheEntry(
                module_id=payload["module_id"],
                repo_name=payload["repo_name"],
                commit_sha=payload["commit_sha"],
                enhancement=payload.get("enhancement"),
                nodes=payload.get("nodes", []),
                edges=payload.get("edges", []),
                created_at=payload.get("created_at", ""),
            )
            self._module_memory[key] = entry
            return entry
        except Exception as e:
            logger.warning("从磁盘加载模块缓存失败 %s/%s: %s", repo_name, module_id, e)
            return None

    @staticmethod
    def _dir_mtime_hash(repo_name: str) -> str:
        """非 Git 仓库时用 repo_name 的哈希作为替代标识。"""
        return hashlib.md5(repo_name.encode()).hexdigest()[:6]


# ─────────────────────────────────────────────────────────────────────────────
# 辅助函数
# ─────────────────────────────────────────────────────────────────────────────


def module_cache_key(repo_name: str, commit_sha: str, module_id: str) -> str:
    """生成模块级缓存键（便捷函数）。"""
    manager = StageCacheManager()
    return manager.get_module_cache_key(repo_name, commit_sha, module_id)

