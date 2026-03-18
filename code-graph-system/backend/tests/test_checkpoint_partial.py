# backend/tests/test_checkpoint_partial.py
"""TDD 测试：CheckpointManager.load_partial_results() 方法。

注意：ModuleCheckpoint.nodes / .edges 存储的是 dict（不是 GraphNode/GraphEdge 对象），
因此测试中直接构造符合序列化格式的 dict。
"""

import pytest
from backend.agent.checkpoint import CheckpointManager, ModuleCheckpoint, CHECKPOINT_STATUS_COMPLETED


def _make_manager(tmp_path):
    """创建使用临时目录的 CheckpointManager 实例。"""
    # 实际签名：CheckpointManager(repo_name, storage_dir)
    return CheckpointManager(repo_name="test-repo", storage_dir=str(tmp_path))


def _make_node_dict(module_id: str, index: int) -> dict:
    return {
        "id": f"{module_id}_node_{index}",
        "type": "Function",
        "name": f"func_{index}",
        "properties": {},
    }


def _make_edge_dict(module_id: str) -> dict:
    return {
        "from": f"{module_id}_node_0",
        "to": f"{module_id}_node_1",
        "type": "calls",
        "properties": {},
    }


def _make_checkpoint(module_id: str, node_count: int = 2, edge_count: int = 1) -> ModuleCheckpoint:
    nodes = [_make_node_dict(module_id, i) for i in range(node_count)]
    edges = [_make_edge_dict(module_id) for _ in range(edge_count)]
    cp = ModuleCheckpoint(
        module_id=module_id,
        module_name=f"Module {module_id}",
        nodes=nodes,
        edges=edges,
        status=CHECKPOINT_STATUS_COMPLETED,
    )
    return cp


class TestLoadPartialResults:
    def test_load_partial_results_empty(self, tmp_path):
        """没有任何检查点时返回空列表。"""
        manager = _make_manager(tmp_path)
        nodes, edges = manager.load_partial_results()
        assert nodes == []
        assert edges == []

    def test_load_partial_results_merges_all_completed(self, tmp_path):
        """合并两个模块的节点和边。"""
        manager = _make_manager(tmp_path)
        cp1 = _make_checkpoint("module_1", node_count=2, edge_count=1)
        cp2 = _make_checkpoint("module_2", node_count=3, edge_count=2)
        manager.save(cp1)
        manager.save(cp2)

        nodes, edges = manager.load_partial_results()
        assert len(nodes) == 5   # 2 + 3
        assert len(edges) == 3   # 1 + 2

    def test_load_partial_results_deduplicates_nodes(self, tmp_path):
        """同一 module_id 保存两次后节点 ID 不应重复（后保存覆盖先保存）。"""
        manager = _make_manager(tmp_path)
        # 保存相同 module_id 两次（第二次覆盖第一次）
        cp1 = _make_checkpoint("mod_a")
        manager.save(cp1)
        cp2 = _make_checkpoint("mod_a")
        manager.save(cp2)

        nodes, edges = manager.load_partial_results()
        node_ids = [n["id"] for n in nodes]
        assert len(node_ids) == len(set(node_ids)), "节点 ID 不应重复"

    def test_load_partial_results_only_completed(self, tmp_path):
        """只合并已完成（completed）的检查点，忽略 pending/partial/failed。"""
        from backend.agent.checkpoint import (
            CHECKPOINT_STATUS_PENDING,
            CHECKPOINT_STATUS_PARTIAL,
            CHECKPOINT_STATUS_FAILED,
        )
        manager = _make_manager(tmp_path)

        # completed 模块
        cp_done = _make_checkpoint("mod_done", node_count=2, edge_count=1)
        manager.save(cp_done)

        # pending 模块（不应被合并）
        cp_pending = _make_checkpoint("mod_pending", node_count=5, edge_count=4)
        cp_pending.status = CHECKPOINT_STATUS_PENDING
        manager.save(cp_pending)

        # partial 模块（不应被合并）
        cp_partial = _make_checkpoint("mod_partial", node_count=3, edge_count=2)
        cp_partial.status = CHECKPOINT_STATUS_PARTIAL
        manager.save(cp_partial)

        nodes, edges = manager.load_partial_results()
        assert len(nodes) == 2
        assert len(edges) == 1

    def test_load_partial_results_node_dedup_across_modules(self, tmp_path):
        """跨模块出现相同节点 ID 时，后加载的覆盖先加载的。"""
        manager = _make_manager(tmp_path)

        # 两个模块共用同一节点 ID（模拟跨模块节点重复场景）
        shared_node = {"id": "shared_node", "type": "Function", "name": "shared", "properties": {}}
        cp1 = ModuleCheckpoint(
            module_id="mod_x",
            module_name="Mod X",
            nodes=[shared_node],
            edges=[],
            status=CHECKPOINT_STATUS_COMPLETED,
        )
        cp2 = ModuleCheckpoint(
            module_id="mod_y",
            module_name="Mod Y",
            nodes=[shared_node],
            edges=[],
            status=CHECKPOINT_STATUS_COMPLETED,
        )
        manager.save(cp1)
        manager.save(cp2)

        nodes, edges = manager.load_partial_results()
        node_ids = [n["id"] for n in nodes]
        # 只应出现一个 shared_node
        assert node_ids.count("shared_node") == 1
