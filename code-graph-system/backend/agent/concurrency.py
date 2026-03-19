"""并发控制器模块。

提供 ConcurrencyController，协调 Worker 线程的并发度、429 退避和终止逻辑。
"""
from __future__ import annotations

import logging
import threading
import time

logger = logging.getLogger(__name__)

# 线程池物理上限（不受 ConcurrencyController 动态控制）
MAX_POOL_SIZE = 8


class ConcurrencyController:
    """跨线程并发协调器。所有 Worker 共享同一个实例。

    职责：
    - 动态控制并发度（Condition 统一保护，支持真实升降）
    - 协调 429 退避（守护线程执行 sleep，不阻塞 Worker 槽）
    - 退避次数超限时设置 should_abort 标志
    """

    def __init__(
        self,
        initial_workers: int = 2,
        max_workers: int = 5,
        success_threshold: int = 3,
        initial_backoff: float = 10.0,
        max_backoff: float = 300.0,
        max_pauses: int = 3,
    ) -> None:
        self._cond = threading.Condition()
        self._active_count: int = 0
        self._max_workers: int = initial_workers
        self._hard_max: int = max_workers
        self._paused: bool = False
        self._is_backing_off: bool = False
        self._backoff_count: int = 0
        self._consecutive_successes: int = 0
        self._should_abort: bool = False

        self._success_threshold = success_threshold
        self._initial_backoff = initial_backoff
        self._max_backoff = max_backoff
        self._max_pauses = max_pauses

    # ──────────────── 公共接口 ────────────────

    def wait_to_start(self) -> None:
        """Worker 分析模块前调用。有空闲 slot 且未暂停时返回并占一个 slot。"""
        with self._cond:
            while self._active_count >= self._max_workers or self._paused:
                self._cond.wait()
            self._active_count += 1

    def release(self) -> None:
        """Worker 模块完成后调用（无论成功或失败）。释放 slot，notify_all。"""
        with self._cond:
            self._active_count -= 1
            self._cond.notify_all()

    def record_success(self) -> None:
        """Worker 模块成功完成后调用。连续 success_threshold 次则升并发。"""
        with self._cond:
            self._consecutive_successes += 1
            if self._consecutive_successes >= self._success_threshold:
                self._consecutive_successes = 0
                self._max_workers = min(self._max_workers + 1, self._hard_max)
                self._cond.notify_all()

    def record_429(self) -> None:
        """Worker 收到 429 时调用。
        第一个调用者启动守护退避线程；其余调用者直接返回（wait_to_start 会阻塞）。
        退避次数超过 max_pauses 时，直接设置 should_abort 标志。
        """
        with self._cond:
            if self._is_backing_off:
                return  # 已有守护线程在退避，直接返回
            self._is_backing_off = True
            self._paused = True
            self._consecutive_successes = 0
            self._backoff_count += 1
            backoff_sec = min(
                self._initial_backoff * (2 ** (self._backoff_count - 1)),
                self._max_backoff,
            )
            should_abort = self._backoff_count > self._max_pauses
            backoff_count_snapshot = self._backoff_count  # 锁内捕获

        if should_abort:
            with self._cond:
                self._should_abort = True
                self._paused = False
                self._is_backing_off = False  # 清零，防止实例复用时静默忽略
                self._cond.notify_all()
            return

        # 启动守护线程执行 sleep，不阻塞调用方
        def _do_backoff() -> None:
            logger.warning(
                "ConcurrencyController: 429 退避 %.0f 秒（第 %d 次）",
                backoff_sec,
                backoff_count_snapshot,
            )
            time.sleep(backoff_sec)
            with self._cond:
                self._is_backing_off = False
                self._paused = False
                self._max_workers = max(self._max_workers - 1, 1)
                self._cond.notify_all()

        threading.Thread(target=_do_backoff, daemon=True).start()

    @property
    def should_abort(self) -> bool:
        """主线程在 as_completed 循环中检查此 flag，True 时提前退出。"""
        with self._cond:
            return self._should_abort

    @property
    def current_workers(self) -> int:
        """当前生效的 max_workers 值（仅供日志/监控使用）。"""
        with self._cond:
            return self._max_workers
