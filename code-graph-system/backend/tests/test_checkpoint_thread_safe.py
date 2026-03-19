"""CheckpointManager 线程安全测试。"""
from __future__ import annotations

import threading
import pytest
from backend.agent.checkpoint import CheckpointManager, ModuleCheckpoint, CHECKPOINT_STATUS_COMPLETED


class TestCheckpointManagerConcurrent:
    def _make_manager(self, tmp_path) -> CheckpointManager:
        return CheckpointManager("test-repo", storage_dir=str(tmp_path))

    def test_concurrent_save_and_get_aggregated(self, tmp_path):
        """主线程 save + Worker 线程 get_aggregated_knowledge 并发，无异常。"""
        mgr = self._make_manager(tmp_path)
        errors = []
        stop = threading.Event()

        def _reader():
            while not stop.is_set():
                try:
                    mgr.get_aggregated_knowledge()
                except Exception as e:
                    errors.append(e)

        reader_thread = threading.Thread(target=_reader, daemon=True)
        reader_thread.start()

        for i in range(20):
            cp = ModuleCheckpoint(
                module_id=f"m{i}", module_name=f"Module {i}",
                status=CHECKPOINT_STATUS_COMPLETED,
            )
            mgr.save(cp)

        stop.set()
        reader_thread.join(timeout=2)
        assert not errors, f"并发读写异常: {errors}"

    def test_list_completed_thread_safe(self, tmp_path):
        """list_completed_modules 在并发写时不抛异常。"""
        mgr = self._make_manager(tmp_path)
        errors = []

        def _save(i: int):
            cp = ModuleCheckpoint(
                module_id=f"m{i}", module_name=f"M{i}",
                status=CHECKPOINT_STATUS_COMPLETED,
            )
            try:
                mgr.save(cp)
            except Exception as e:
                errors.append(e)

        def _list():
            try:
                mgr.list_completed_modules()
            except Exception as e:
                errors.append(e)

        threads = []
        for i in range(10):
            threads.append(threading.Thread(target=_save, args=(i,), daemon=True))
            threads.append(threading.Thread(target=_list, daemon=True))

        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=3)

        assert not errors

    def test_list_pending_thread_safe(self, tmp_path):
        """list_pending_modules 在并发写时不抛异常。"""
        mgr = self._make_manager(tmp_path)
        all_ids = [f"m{i}" for i in range(10)]
        errors = []

        def _save_random():
            cp = ModuleCheckpoint(
                module_id="m0", module_name="M0",
                status=CHECKPOINT_STATUS_COMPLETED,
            )
            try:
                mgr.save(cp)
            except Exception as e:
                errors.append(e)

        def _list_pending():
            try:
                mgr.list_pending_modules(all_ids)
            except Exception as e:
                errors.append(e)

        threads = [
            threading.Thread(target=(_save_random if i % 2 == 0 else _list_pending), daemon=True)
            for i in range(20)
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=3)

        assert not errors
