"""检查点模块单元测试。"""

import json
import pytest
import tempfile
from datetime import datetime
from pathlib import Path

from backend.agent.checkpoint import (
    ModuleCheckpoint,
    CheckpointManager,
    CHECKPOINT_STATUS_PENDING,
    CHECKPOINT_STATUS_COMPLETED,
    CHECKPOINT_STATUS_PARTIAL,
    CHECKPOINT_STATUS_FAILED,
)


class TestModuleCheckpoint:
    """ModuleCheckpoint 测试用例。"""

    def test_create_checkpoint(self):
        """测试创建检查点。"""
        checkpoint = ModuleCheckpoint(
            module_id="module:backend.api",
            module_name="backend.api",
        )

        assert checkpoint.module_id == "module:backend.api"
        assert checkpoint.module_name == "backend.api"
        assert checkpoint.nodes == []
        assert checkpoint.edges == []
        assert checkpoint.knowledge == {}
        assert checkpoint.status == CHECKPOINT_STATUS_PENDING
        assert checkpoint.created_at != ""
        assert checkpoint.token_usage == {"input": 0, "output": 0}

    def test_to_dict(self):
        """测试转换为字典。"""
        checkpoint = ModuleCheckpoint(
            module_id="repo:my-project",
            module_name="my-project",
            nodes=[{"id": "node1", "type": "Class"}],
            edges=[{"from": "node1", "to": "node2", "type": "calls"}],
            knowledge={"layers": ["api"]},
            status=CHECKPOINT_STATUS_COMPLETED,
            token_usage={"input": 100, "output": 200},
        )

        data = checkpoint.to_dict()

        assert data["module_id"] == "repo:my-project"
        assert data["module_name"] == "my-project"
        assert len(data["nodes"]) == 1
        assert len(data["edges"]) == 1
        assert data["knowledge"] == {"layers": ["api"]}
        assert data["status"] == CHECKPOINT_STATUS_COMPLETED
        assert data["token_usage"] == {"input": 100, "output": 200}

    def test_from_dict(self):
        """测试从字典创建。"""
        data = {
            "module_id": "module:backend.core",
            "module_name": "backend.core",
            "nodes": [{"id": "n1"}, {"id": "n2"}],
            "edges": [{"from": "n1", "to": "n2"}],
            "knowledge": {"modules": ["core"]},
            "status": CHECKPOINT_STATUS_PARTIAL,
            "created_at": "2024-01-01T00:00:00",
            "token_usage": {"input": 500, "output": 300},
        }

        checkpoint = ModuleCheckpoint.from_dict(data)

        assert checkpoint.module_id == "module:backend.core"
        assert checkpoint.module_name == "backend.core"
        assert len(checkpoint.nodes) == 2
        assert len(checkpoint.edges) == 1
        assert checkpoint.knowledge == {"modules": ["core"]}
        assert checkpoint.status == CHECKPOINT_STATUS_PARTIAL
        assert checkpoint.created_at == "2024-01-01T00:00:00"
        assert checkpoint.token_usage == {"input": 500, "output": 300}

    def test_mark_completed(self):
        """测试标记完成。"""
        checkpoint = ModuleCheckpoint(
            module_id="module:test",
            module_name="test",
        )

        nodes = [{"id": "n1"}, {"id": "n2"}]
        edges = [{"from": "n1", "to": "n2"}]

        checkpoint.mark_completed(nodes, edges)

        assert checkpoint.status == CHECKPOINT_STATUS_COMPLETED
        assert checkpoint.nodes == nodes
        assert checkpoint.edges == edges

    def test_mark_partial(self):
        """测试标记部分完成。"""
        checkpoint = ModuleCheckpoint(
            module_id="module:test",
            module_name="test",
        )

        nodes = [{"id": "n1"}]
        edges = []

        checkpoint.mark_partial(nodes, edges)

        assert checkpoint.status == CHECKPOINT_STATUS_PARTIAL
        assert checkpoint.nodes == nodes
        assert checkpoint.edges == edges

    def test_mark_failed(self):
        """测试标记失败。"""
        checkpoint = ModuleCheckpoint(
            module_id="module:test",
            module_name="test",
            status=CHECKPOINT_STATUS_PENDING,
        )

        checkpoint.mark_failed()

        assert checkpoint.status == CHECKPOINT_STATUS_FAILED

    def test_add_token_usage(self):
        """测试累加 Token 使用量。"""
        checkpoint = ModuleCheckpoint(
            module_id="module:test",
            module_name="test",
        )

        checkpoint.add_token_usage(100, 50)
        assert checkpoint.token_usage == {"input": 100, "output": 50}

        checkpoint.add_token_usage(50, 25)
        assert checkpoint.token_usage == {"input": 150, "output": 75}


class TestCheckpointManager:
    """CheckpointManager 测试用例。"""

    @pytest.fixture
    def temp_storage_dir(self):
        """创建临时存储目录。"""
        with tempfile.TemporaryDirectory() as tmpdir:
            yield tmpdir

    def test_init(self, temp_storage_dir):
        """测试初始化。"""
        manager = CheckpointManager(
            repo_name="test-repo",
            storage_dir=temp_storage_dir,
        )

        assert manager.repo_name == "test-repo"
        assert len(manager) == 0

    def test_save_and_load(self, temp_storage_dir):
        """测试保存和加载检查点。"""
        manager = CheckpointManager(
            repo_name="test-repo",
            storage_dir=temp_storage_dir,
        )

        checkpoint = ModuleCheckpoint(
            module_id="module:backend.api",
            module_name="backend.api",
            nodes=[{"id": "node1"}],
            edges=[],
            status=CHECKPOINT_STATUS_COMPLETED,
        )

        # 保存
        saved_path = manager.save(checkpoint)
        assert Path(saved_path).exists()
        assert len(manager) == 1

        # 从内存加载
        loaded = manager.load("module:backend.api")
        assert loaded is not None
        assert loaded.module_id == "module:backend.api"
        assert loaded.module_name == "backend.api"
        assert len(loaded.nodes) == 1
        assert loaded.status == CHECKPOINT_STATUS_COMPLETED

    def test_load_from_disk(self, temp_storage_dir):
        """测试从磁盘加载检查点。"""
        manager1 = CheckpointManager(
            repo_name="test-repo",
            storage_dir=temp_storage_dir,
        )

        # 保存一个检查点
        checkpoint = ModuleCheckpoint(
            module_id="module:backend.core",
            module_name="backend.core",
            nodes=[{"id": "n1"}, {"id": "n2"}],
            edges=[{"from": "n1", "to": "n2"}],
            status=CHECKPOINT_STATUS_COMPLETED,
        )
        manager1.save(checkpoint)

        # 创建新的管理器，应自动加载已有检查点
        manager2 = CheckpointManager(
            repo_name="test-repo",
            storage_dir=temp_storage_dir,
        )

        assert len(manager2) == 1
        loaded = manager2.load("module:backend.core")
        assert loaded is not None
        assert loaded.module_name == "backend.core"

    def test_get_all_results(self, temp_storage_dir):
        """测试合并所有结果。"""
        manager = CheckpointManager(
            repo_name="test-repo",
            storage_dir=temp_storage_dir,
        )

        # 添加多个检查点
        manager.save(ModuleCheckpoint(
            module_id="module:a",
            module_name="a",
            nodes=[{"id": "n1"}, {"id": "n2"}],
            edges=[{"from": "n1", "to": "n2"}],
            status=CHECKPOINT_STATUS_COMPLETED,
        ))

        manager.save(ModuleCheckpoint(
            module_id="module:b",
            module_name="b",
            nodes=[{"id": "n3"}],
            edges=[],
            status=CHECKPOINT_STATUS_COMPLETED,
        ))

        manager.save(ModuleCheckpoint(
            module_id="module:c",
            module_name="c",
            nodes=[],
            edges=[{"from": "n3", "to": "n1"}],
            status=CHECKPOINT_STATUS_PENDING,
        ))

        all_nodes, all_edges = manager.get_all_results()

        assert len(all_nodes) == 3
        assert len(all_edges) == 2

    def test_get_aggregated_knowledge(self, temp_storage_dir):
        """测试聚合共享知识。"""
        manager = CheckpointManager(
            repo_name="test-repo",
            storage_dir=temp_storage_dir,
        )

        # 添加带知识的检查点
        manager.save(ModuleCheckpoint(
            module_id="module:a",
            module_name="a",
            knowledge={
                "layers": [{"name": "api"}, {"name": "service"}],
                "modules": [{"id": "m1"}],
                "services": [{"name": "UserService"}],
            },
            status=CHECKPOINT_STATUS_COMPLETED,
        ))

        manager.save(ModuleCheckpoint(
            module_id="module:b",
            module_name="b",
            knowledge={
                "layers": [{"name": "api"}, {"name": "data"}],  # api 重复
                "modules": [{"id": "m2"}],
                "services": [{"name": "UserService"}],  # 重复
                "entry_points": [{"id": "e1"}],
            },
            status=CHECKPOINT_STATUS_COMPLETED,
        ))

        aggregated = manager.get_aggregated_knowledge()

        # layers 去重
        assert len(aggregated["layers"]) == 3
        layer_names = {l["name"] for l in aggregated["layers"]}
        assert layer_names == {"api", "service", "data"}

        # modules 去重
        assert len(aggregated["modules"]) == 2

        # services 去重
        assert len(aggregated["services"]) == 1
        assert aggregated["services"][0]["name"] == "UserService"

        # entry_points 合并
        assert len(aggregated["entry_points"]) == 1

    def test_list_completed_modules(self, temp_storage_dir):
        """测试列出已完成模块。"""
        manager = CheckpointManager(
            repo_name="test-repo",
            storage_dir=temp_storage_dir,
        )

        manager.save(ModuleCheckpoint(
            module_id="module:completed",
            module_name="completed",
            status=CHECKPOINT_STATUS_COMPLETED,
        ))

        manager.save(ModuleCheckpoint(
            module_id="module:pending",
            module_name="pending",
            status=CHECKPOINT_STATUS_PENDING,
        ))

        manager.save(ModuleCheckpoint(
            module_id="module:partial",
            module_name="partial",
            status=CHECKPOINT_STATUS_PARTIAL,
        ))

        completed = manager.list_completed_modules()

        assert len(completed) == 1
        assert "module:completed" in completed

    def test_list_pending_modules(self, temp_storage_dir):
        """测试列出待分析模块。"""
        manager = CheckpointManager(
            repo_name="test-repo",
            storage_dir=temp_storage_dir,
        )

        manager.save(ModuleCheckpoint(
            module_id="module:completed",
            module_name="completed",
            status=CHECKPOINT_STATUS_COMPLETED,
        ))

        manager.save(ModuleCheckpoint(
            module_id="module:pending",
            module_name="pending",
            status=CHECKPOINT_STATUS_PENDING,
        ))

        manager.save(ModuleCheckpoint(
            module_id="module:failed",
            module_name="failed",
            status=CHECKPOINT_STATUS_FAILED,
        ))

        all_modules = [
            "module:completed",
            "module:pending",
            "module:failed",
            "module:not_started",  # 没有检查点
        ]

        pending = manager.list_pending_modules(all_modules)

        assert len(pending) == 3
        assert "module:pending" in pending
        assert "module:failed" in pending
        assert "module:not_started" in pending
        assert "module:completed" not in pending

    def test_clear(self, temp_storage_dir):
        """测试清理所有检查点。"""
        manager = CheckpointManager(
            repo_name="test-repo",
            storage_dir=temp_storage_dir,
        )

        # 添加检查点
        manager.save(ModuleCheckpoint(
            module_id="module:a",
            module_name="a",
            status=CHECKPOINT_STATUS_COMPLETED,
        ))

        manager.save(ModuleCheckpoint(
            module_id="module:b",
            module_name="b",
            status=CHECKPOINT_STATUS_COMPLETED,
        ))

        assert len(manager) == 2

        # 清理
        manager.clear()

        assert len(manager) == 0
        # 确认磁盘文件也被删除
        assert not list(Path(temp_storage_dir).glob("test-repo_*.json"))

    def test_delete(self, temp_storage_dir):
        """测试删除单个检查点。"""
        manager = CheckpointManager(
            repo_name="test-repo",
            storage_dir=temp_storage_dir,
        )

        manager.save(ModuleCheckpoint(
            module_id="module:a",
            module_name="a",
            status=CHECKPOINT_STATUS_COMPLETED,
        ))

        manager.save(ModuleCheckpoint(
            module_id="module:b",
            module_name="b",
            status=CHECKPOINT_STATUS_COMPLETED,
        ))

        assert len(manager) == 2

        # 删除一个
        result = manager.delete("module:a")

        assert result is True
        assert len(manager) == 1
        assert "module:a" not in manager
        assert "module:b" in manager

    def test_get_statistics(self, temp_storage_dir):
        """测试获取统计信息。"""
        manager = CheckpointManager(
            repo_name="test-repo",
            storage_dir=temp_storage_dir,
        )

        manager.save(ModuleCheckpoint(
            module_id="module:a",
            module_name="a",
            nodes=[{"id": "n1"}, {"id": "n2"}],
            edges=[{"from": "n1", "to": "n2"}],
            status=CHECKPOINT_STATUS_COMPLETED,
            token_usage={"input": 100, "output": 50},
        ))

        manager.save(ModuleCheckpoint(
            module_id="module:b",
            module_name="b",
            nodes=[{"id": "n3"}],
            edges=[],
            status=CHECKPOINT_STATUS_PENDING,
            token_usage={"input": 200, "output": 100},
        ))

        stats = manager.get_statistics()

        assert stats["repo_name"] == "test-repo"
        assert stats["total_checkpoints"] == 2
        assert stats["status_counts"][CHECKPOINT_STATUS_COMPLETED] == 1
        assert stats["status_counts"][CHECKPOINT_STATUS_PENDING] == 1
        assert stats["total_nodes"] == 3
        assert stats["total_edges"] == 1
        assert stats["token_usage"]["input"] == 300
        assert stats["token_usage"]["output"] == 150

    def test_contains(self, temp_storage_dir):
        """测试 __contains__ 方法。"""
        manager = CheckpointManager(
            repo_name="test-repo",
            storage_dir=temp_storage_dir,
        )

        manager.save(ModuleCheckpoint(
            module_id="module:exists",
            module_name="exists",
        ))

        assert "module:exists" in manager
        assert "module:not_exists" not in manager

    def test_get_total_token_usage(self, temp_storage_dir):
        """测试获取总 Token 使用量。"""
        manager = CheckpointManager(
            repo_name="test-repo",
            storage_dir=temp_storage_dir,
        )

        manager.save(ModuleCheckpoint(
            module_id="module:a",
            module_name="a",
            token_usage={"input": 100, "output": 50},
        ))

        manager.save(ModuleCheckpoint(
            module_id="module:b",
            module_name="b",
            token_usage={"input": 200, "output": 100},
        ))

        total = manager.get_total_token_usage()

        assert total["input"] == 300
        assert total["output"] == 150

    def test_different_repos_isolated(self, temp_storage_dir):
        """测试不同仓库的检查点隔离。"""
        manager1 = CheckpointManager(
            repo_name="repo1",
            storage_dir=temp_storage_dir,
        )

        manager2 = CheckpointManager(
            repo_name="repo2",
            storage_dir=temp_storage_dir,
        )

        manager1.save(ModuleCheckpoint(
            module_id="module:shared",
            module_name="shared",
            status=CHECKPOINT_STATUS_COMPLETED,
        ))

        manager2.save(ModuleCheckpoint(
            module_id="module:shared",
            module_name="shared",
            status=CHECKPOINT_STATUS_PENDING,
        ))

        # 各自独立
        assert len(manager1) == 1
        assert len(manager2) == 1

        cp1 = manager1.load("module:shared")
        cp2 = manager2.load("module:shared")

        assert cp1.status == CHECKPOINT_STATUS_COMPLETED
        assert cp2.status == CHECKPOINT_STATUS_PENDING