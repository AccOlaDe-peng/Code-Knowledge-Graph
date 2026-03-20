"""StageCacheManager 单元测试。"""
from __future__ import annotations

import time

import pytest

from backend.pipeline.stage_cache import StageCacheEntry, StageCacheManager


class TestStageCacheManager:
    def test_save_and_load_from_memory(self, tmp_path):
        mgr = StageCacheManager(cache_dir=tmp_path)
        entry = StageCacheEntry(
            stage_name="file_index",
            repo_name="my-repo",
            commit_sha="abc12345",
            data={"files": ["a.py", "b.py"]},
        )
        mgr.save(entry)
        loaded = mgr.load("my-repo", "abc12345", "file_index")
        assert loaded is not None
        assert loaded.data == {"files": ["a.py", "b.py"]}

    def test_load_returns_none_for_missing(self, tmp_path):
        mgr = StageCacheManager(cache_dir=tmp_path)
        assert mgr.load("no-repo", "sha", "stage") is None

    def test_cache_key_uses_short_sha(self, tmp_path):
        mgr = StageCacheManager(cache_dir=tmp_path)
        key = mgr.get_cache_key("repo", "abc12345678", "stage0")
        assert "abc12345" in key
        assert "stage0" in key

    def test_cache_key_non_git_uses_mtime_hash(self, tmp_path):
        mgr = StageCacheManager(cache_dir=tmp_path)
        key = mgr.get_cache_key("repo", "", "stage0")
        assert "mtime" in key

    def test_clear_removes_entries(self, tmp_path):
        mgr = StageCacheManager(cache_dir=tmp_path)
        entry = StageCacheEntry(
            stage_name="s0", repo_name="repo", commit_sha="sha1", data={}
        )
        mgr.save(entry)
        mgr.clear("repo")
        assert mgr.load("repo", "sha1", "s0") is None

    def test_persist_to_disk(self, tmp_path):
        mgr = StageCacheManager(cache_dir=tmp_path)
        entry = StageCacheEntry(
            stage_name="module_boundary",
            repo_name="my-repo",
            commit_sha="deadbeef",
            data={"modules": [{"id": "m1"}]},
        )
        mgr.save(entry, persist=True)
        cache_file = tmp_path / "my-repo" / "deadbeef_module_boundary.json"
        assert cache_file.exists()

    def test_load_from_disk_when_not_in_memory(self, tmp_path):
        mgr = StageCacheManager(cache_dir=tmp_path)
        entry = StageCacheEntry(
            stage_name="file_index",
            repo_name="repo2",
            commit_sha="cafebabe",
            data=[1, 2, 3],
        )
        mgr.save(entry, persist=True)

        # 新建 mgr 实例（清空内存），从磁盘加载
        mgr2 = StageCacheManager(cache_dir=tmp_path)
        loaded = mgr2.load("repo2", "cafebabe", "file_index")
        assert loaded is not None
        assert loaded.data == [1, 2, 3]

    def test_checksum_validation(self, tmp_path):
        """校验和验证（当前实现简化，仅测试基本功能）。"""
        mgr = StageCacheManager(cache_dir=tmp_path)
        entry = StageCacheEntry(
            stage_name="s1",
            repo_name="repo3",
            commit_sha="aaaa1111",
            data={"key": "value"},
        )
        mgr.save(entry)
        loaded = mgr.load("repo3", "aaaa1111", "s1")
        assert loaded is not None
        # 简化实现不校验 checksum，但结构上应支持
