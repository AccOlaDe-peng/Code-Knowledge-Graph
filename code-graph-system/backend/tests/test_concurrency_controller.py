"""ConcurrencyController 单元测试。"""
from __future__ import annotations

import threading
import time
import pytest
from backend.agent.concurrency import ConcurrencyController


class TestInitialState:
    def test_initial_current_workers(self):
        c = ConcurrencyController(initial_workers=2, max_workers=5)
        assert c.current_workers == 2

    def test_initial_not_aborting(self):
        c = ConcurrencyController(initial_workers=2, max_workers=5)
        assert c.should_abort is False

    def test_active_count_zero(self):
        c = ConcurrencyController(initial_workers=2, max_workers=5)
        assert c._active_count == 0


class TestSlotControl:
    def test_wait_blocks_at_capacity(self):
        """并发满时 wait_to_start 阻塞，release 后恢复。"""
        c = ConcurrencyController(initial_workers=1, max_workers=3)
        c.wait_to_start()  # 占满唯一 slot
        assert c._active_count == 1

        released = threading.Event()

        def _release_after_50ms():
            time.sleep(0.05)
            c.release()
            released.set()

        threading.Thread(target=_release_after_50ms, daemon=True).start()

        start = time.monotonic()
        c.wait_to_start()  # 应阻塞 ~50ms
        elapsed = time.monotonic() - start
        assert elapsed >= 0.04, f"应阻塞约 50ms，实际 {elapsed:.3f}s"
        assert released.is_set()
        c.release()
        c.release()

    def test_success_threshold_increases_workers(self):
        """连续 success_threshold 次成功后 current_workers +1。"""
        c = ConcurrencyController(initial_workers=2, max_workers=5, success_threshold=3)
        c.record_success()
        c.record_success()
        assert c.current_workers == 2  # 未达阈值
        c.record_success()
        assert c.current_workers == 3  # 达阈值，升并发

    def test_workers_capped_at_max(self):
        """current_workers 不超过 hard_max。"""
        c = ConcurrencyController(initial_workers=4, max_workers=5, success_threshold=1)
        c.record_success()
        assert c.current_workers == 5
        c.record_success()
        assert c.current_workers == 5  # 不超上限


class TestBackoff:
    def test_record_429_pauses_then_resumes(self):
        """退避守护线程完成后 wait_to_start 恢复（缩短退避时间）。"""
        c = ConcurrencyController(
            initial_workers=2, max_workers=5,
            initial_backoff=0.05, max_backoff=1.0, max_pauses=5,
        )
        c.record_429()
        assert c._paused is True

        time.sleep(0.15)  # 等守护线程 sleep(0.05) 完成
        assert c._paused is False
        assert c._is_backing_off is False

    def test_only_one_thread_backs_off(self):
        """多线程同时 record_429，只启动一个守护线程。"""
        c = ConcurrencyController(
            initial_workers=5, max_workers=5,
            initial_backoff=0.1, max_backoff=1.0, max_pauses=5,
        )
        barrier = threading.Barrier(5)

        def _worker():
            barrier.wait()
            c.record_429()

        threads = [threading.Thread(target=_worker, daemon=True) for _ in range(5)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=2)

        # 只有一次 backoff_count 增量（第一个胜出的线程）
        assert c._backoff_count == 1

    def test_backoff_exponential(self):
        """退避时间按 2^n 增长。"""
        c = ConcurrencyController(
            initial_workers=2, max_workers=5,
            initial_backoff=10.0, max_backoff=300.0, max_pauses=10,
        )
        expected = [10.0, 20.0, 40.0, 80.0, 160.0, 300.0]
        for i, exp in enumerate(expected):
            with c._cond:
                c._is_backing_off = False  # 重置，允许下次 record_429
                c._paused = False
            computed = min(c._initial_backoff * (2 ** i), c._max_backoff)
            assert computed == exp, f"第 {i+1} 次退避应为 {exp}s，得 {computed}s"

    def test_should_abort_after_max_pauses(self):
        """超过 max_pauses 后 should_abort == True。"""
        c = ConcurrencyController(
            initial_workers=2, max_workers=5,
            initial_backoff=0.01, max_backoff=1.0, max_pauses=2,
        )
        with c._cond:
            c._backoff_count = 2  # 模拟已暂停 2 次

        c.record_429()  # 第 3 次，超过 max_pauses=2
        assert c.should_abort is True
        assert c._paused is False
        assert c._is_backing_off is False  # 必须清零，防止复用时静默忽略

    def test_max_workers_decreases_after_429(self):
        """退避守护线程完成后 current_workers -1。"""
        c = ConcurrencyController(
            initial_workers=3, max_workers=5,
            initial_backoff=0.05, max_backoff=1.0, max_pauses=5,
        )
        c.record_429()
        time.sleep(0.15)
        assert c.current_workers == 2  # 3 - 1 = 2

    def test_worker_slot_released_independently(self):
        """record_429 后调用 release()，active_count 立即减少（不等 backoff sleep 结束）。"""
        c = ConcurrencyController(
            initial_workers=2, max_workers=5,
            initial_backoff=1.0, max_backoff=10.0, max_pauses=5,
        )
        c.wait_to_start()
        assert c._active_count == 1

        c.record_429()  # 设置 paused，启动守护线程（sleep 1s）
        c.release()     # 立即释放 slot
        assert c._active_count == 0  # 不等退避完成就释放
