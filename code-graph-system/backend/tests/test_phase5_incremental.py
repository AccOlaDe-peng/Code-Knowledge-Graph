"""Phase 5 增量缓存测试。

测试内容：
- 模块级缓存键生成
- 模块缓存保存/加载
- 增量分析调度逻辑
"""
from __future__ import annotations

import tempfile
from pathlib import Path

import pytest


class TestModuleCache:
    """模块级缓存测试。"""

    def test_module_cache_key_generation(self):
        """测试模块缓存键生成。"""
        from backend.pipeline.stage_cache import StageCacheManager

        manager = StageCacheManager()

        # 有 commit SHA 的情况
        key1 = manager.get_module_cache_key(
            repo_name="my-repo",
            commit_sha="abc123def456",
            module_id="module:user-service",
        )
        assert "my-repo" in key1
        assert "abc123de" in key1  # SHA 前 8 位
        assert "module_user-service" in key1

        # 无 commit SHA 的情况
        key2 = manager.get_module_cache_key(
            repo_name="my-repo",
            commit_sha="",
            module_id="module:order-service",
        )
        assert "my-repo" in key2
        assert "mtime" in key2

    def test_module_cache_save_and_load(self):
        """测试模块缓存保存和加载。"""
        from backend.pipeline.stage_cache import StageCacheManager, ModuleCacheEntry

        with tempfile.TemporaryDirectory() as tmpdir:
            manager = StageCacheManager(cache_dir=Path(tmpdir))

            entry = ModuleCacheEntry(
                module_id="module:user-service",
                repo_name="test-repo",
                commit_sha="abc123def456",
                enhancement={
                    "name": "用户服务",
                    "purpose": "用户管理",
                    "layer": "service",
                },
                nodes=[{"id": "node1", "type": "Class"}],
                edges=[{"from": "node1", "to": "node2"}],
            )

            # 保存到内存
            manager.save_module(entry, persist=False)

            # 从内存加载
            loaded = manager.load_module(
                repo_name="test-repo",
                commit_sha="abc123def456",
                module_id="module:user-service",
            )

            assert loaded is not None
            assert loaded.module_id == "module:user-service"
            assert loaded.enhancement["name"] == "用户服务"
            assert len(loaded.nodes) == 1

    def test_module_cache_persist_to_disk(self):
        """测试模块缓存持久化到磁盘。"""
        from backend.pipeline.stage_cache import StageCacheManager, ModuleCacheEntry

        with tempfile.TemporaryDirectory() as tmpdir:
            cache_dir = Path(tmpdir)

            # 创建第一个 manager 并保存
            manager1 = StageCacheManager(cache_dir=cache_dir)
            entry = ModuleCacheEntry(
                module_id="module:order-service",
                repo_name="test-repo",
                commit_sha="xyz789abc123",
                enhancement={"name": "订单服务"},
                nodes=[],
                edges=[],
            )
            manager1.save_module(entry, persist=True)

            # 创建新的 manager（模拟新进程）并加载
            manager2 = StageCacheManager(cache_dir=cache_dir)
            loaded = manager2.load_module(
                repo_name="test-repo",
                commit_sha="xyz789abc123",
                module_id="module:order-service",
            )

            assert loaded is not None
            assert loaded.enhancement["name"] == "订单服务"

    def test_modules_to_reanalyze(self):
        """测试增量分析调度逻辑。"""
        from backend.pipeline.stage_cache import StageCacheManager, ModuleCacheEntry
        from backend.models.static_analysis import ModuleCandidate

        manager = StageCacheManager()

        # 创建模块候选
        candidates = [
            ModuleCandidate(
                id="module:user",
                name="user-module",
                files=["src/user/service.py", "src/user/repo.py"],
            ),
            ModuleCandidate(
                id="module:order",
                name="order-module",
                files=["src/order/service.py", "src/order/repo.py"],
            ),
            ModuleCandidate(
                id="module:common",
                name="common-module",
                files=["src/common/utils.py"],
            ),
        ]

        # 预先缓存 user 模块
        manager._module_memory["test:abc123de:module_user"] = ModuleCacheEntry(
            module_id="module:user",
            repo_name="test",
            commit_sha="abc123def456",
            enhancement={"name": "用户模块"},
            nodes=[],
            edges=[],
        )

        # 变更文件：只有 order 模块
        changed_files = {"src/order/service.py"}

        to_reanalyze, from_cache = manager.get_modules_to_reanalyze(
            repo_name="test",
            commit_sha="abc123def456",
            module_candidates=candidates,
            changed_files=changed_files,
        )

        # order 模块需要重分析（有变更）
        # common 模块也需要重分析（无缓存）
        assert len(to_reanalyze) == 2
        to_reanalyze_ids = [c.id for c in to_reanalyze]
        assert "module:order" in to_reanalyze_ids
        assert "module:common" in to_reanalyze_ids

        # user 模块从缓存加载（无变更且有缓存）
        assert len(from_cache) == 1
        assert from_cache[0][0].id == "module:user"

    def test_clear_repo_cache(self):
        """测试清除仓库缓存。"""
        from backend.pipeline.stage_cache import StageCacheManager, ModuleCacheEntry

        manager = StageCacheManager()

        # 添加多个模块缓存
        manager._module_memory["repo1:abc123:module_user"] = ModuleCacheEntry(
            module_id="module:user",
            repo_name="repo1",
            commit_sha="abc123",
            enhancement={},
            nodes=[],
            edges=[],
        )
        manager._module_memory["repo1:abc123:module_order"] = ModuleCacheEntry(
            module_id="module:order",
            repo_name="repo1",
            commit_sha="abc123",
            enhancement={},
            nodes=[],
            edges=[],
        )
        manager._module_memory["repo2:xyz789:module_product"] = ModuleCacheEntry(
            module_id="module:product",
            repo_name="repo2",
            commit_sha="xyz789",
            enhancement={},
            nodes=[],
            edges=[],
        )

        # 清除 repo1
        manager.clear("repo1")

        assert len(manager._module_memory) == 1
        assert "repo2:xyz789:module_product" in manager._module_memory


class TestIncrementalAnalysis:
    """增量分析集成测试。"""

    def test_no_changes_full_cache_hit(self):
        """测试无变更时全部命中缓存。"""
        from backend.pipeline.stage_cache import StageCacheManager, ModuleCacheEntry
        from backend.models.static_analysis import ModuleCandidate

        manager = StageCacheManager()

        candidates = [
            ModuleCandidate(
                id="module:svc1",
                name="svc1",
                files=["src/svc1/a.py"],
            ),
            ModuleCandidate(
                id="module:svc2",
                name="svc2",
                files=["src/svc2/b.py"],
            ),
        ]

        # 预先缓存所有模块
        for c in candidates:
            key = manager.get_module_cache_key("test", "abc123", c.id)
            manager._module_memory[key] = ModuleCacheEntry(
                module_id=c.id,
                repo_name="test",
                commit_sha="abc123",
                enhancement={"name": c.name},
                nodes=[],
                edges=[],
            )

        # 无变更文件
        to_reanalyze, from_cache = manager.get_modules_to_reanalyze(
            repo_name="test",
            commit_sha="abc123",
            module_candidates=candidates,
            changed_files=set(),
        )

        # 所有模块从缓存加载
        assert len(to_reanalyze) == 0
        assert len(from_cache) == 2

    def test_all_changed_no_cache_hit(self):
        """测试全部变更时无缓存命中。"""
        from backend.pipeline.stage_cache import StageCacheManager
        from backend.models.static_analysis import ModuleCandidate

        manager = StageCacheManager()

        candidates = [
            ModuleCandidate(
                id="module:svc1",
                name="svc1",
                files=["src/svc1/a.py", "src/svc1/b.py"],
            ),
            ModuleCandidate(
                id="module:svc2",
                name="svc2",
                files=["src/svc2/c.py"],
            ),
        ]

        # 所有文件都变更
        changed_files = {"src/svc1/a.py", "src/svc1/b.py", "src/svc2/c.py"}

        to_reanalyze, from_cache = manager.get_modules_to_reanalyze(
            repo_name="test",
            commit_sha="abc123",
            module_candidates=candidates,
            changed_files=changed_files,
        )

        # 所有模块需要重分析
        assert len(to_reanalyze) == 2
        assert len(from_cache) == 0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
