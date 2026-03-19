"""SharedKnowledgeBase 线程安全测试。"""
from __future__ import annotations

import threading
import pytest
from backend.agent.context import SharedKnowledgeBase


class TestSharedKnowledgeSafety:
    def test_modules_returns_copy(self):
        """modules 属性返回快照，不暴露原始 list。"""
        kb = SharedKnowledgeBase()
        kb.add_module({"id": "m1"})
        snap = kb.modules
        snap.append({"id": "extra"})  # 修改快照
        assert len(kb.modules) == 1   # 原始 list 不受影响

    def test_add_module_thread_safe(self):
        """多线程并发 add_module，无丢失无竞态。"""
        kb = SharedKnowledgeBase()
        barrier = threading.Barrier(20)

        def _add(i: int):
            barrier.wait()
            kb.add_module({"id": f"m{i}"})

        threads = [threading.Thread(target=_add, args=(i,), daemon=True) for i in range(20)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=3)

        assert len(kb.modules) == 20

    def test_add_layer(self):
        kb = SharedKnowledgeBase()
        kb.add_layer({"id": "layer:presentation"})
        assert len(kb.layers) == 1
        assert kb.layers[0]["id"] == "layer:presentation"

    def test_add_service(self):
        kb = SharedKnowledgeBase()
        kb.add_service({"name": "UserService"})
        assert len(kb.services) == 1

    def test_add_entry_point(self):
        kb = SharedKnowledgeBase()
        kb.add_entry_point("main.py")
        assert len(kb.entry_points) == 1

    def test_no_direct_assignment(self):
        """modules 是 @property，直接赋值应抛出 AttributeError。"""
        kb = SharedKnowledgeBase()
        with pytest.raises(AttributeError):
            kb.modules = []  # type: ignore[misc]
