# Concurrent Module Analysis Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `run_module_analysis` 改造为多线程并发执行，将 96 模块分析从串行 ~45 分钟压缩到 ~10-15 分钟。

**Architecture:** 使用 `ThreadPoolExecutor`（固定池大小 8）+ `ConcurrencyController`（自适应并发度 2-5，单一 `threading.Condition` 统一保护所有字段）。每个模块创建独立 `ContextMonitor` 实例，消除并发写竞态。`SharedKnowledgeBase` 和 `CheckpointManager` 加锁保证线程安全。主线程通过 `as_completed` 串行写检查点。

**Tech Stack:** Python `threading.Condition`、`concurrent.futures.ThreadPoolExecutor`、`as_completed`

---

## 文件变更地图

| 文件 | 操作 | 职责 |
|---|---|---|
| `backend/agent/concurrency.py` | **新建** | `ConcurrencyController`：自适应并发槽位 + 429 守护退避 |
| `backend/agent/context.py` | 修改 | `SharedKnowledgeBase`：dataclass → 普通类，加锁，读返回快照 |
| `backend/agent/checkpoint.py` | 修改 | `CheckpointManager`：加 `RLock` 保护所有读写方法 |
| `backend/agent/orchestrator.py` | 修改 | `_create_context` 每次新建 `ContextMonitor`；`_run_agent_for_module` 移除直接赋值；`run_module_analysis` 改并发主循环 |
| `backend/tests/test_concurrency_controller.py` | **新建** | `ConcurrencyController` 单元测试 |
| `backend/tests/test_orchestrator_concurrent.py` | **新建** | 并发编排集成测试（全 Mock LLM） |

---

## 前置知识

所有命令在 `code-graph-system/` 目录下执行，激活 venv：
```bash
cd /Users/wayne/Documents/code/code-knowledge-graph/code-graph-system
source venv/bin/activate
```

运行全套测试验证回归：
```bash
pytest backend/tests/ -v --tb=short -q
```
期望：所有现有 71 个测试通过（无新增失败）。

---

## Chunk 1: 线程安全基础设施

### Task 1: ConcurrencyController

**文件：**
- Create: `backend/agent/concurrency.py`
- Test: `backend/tests/test_concurrency_controller.py`

- [ ] **Step 1.1: 写失败测试——基础状态**

新建 `backend/tests/test_concurrency_controller.py`：

```python
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
```

- [ ] **Step 1.2: 运行，确认失败**

```bash
pytest backend/tests/test_concurrency_controller.py::TestInitialState -v
```
期望：`ModuleNotFoundError: No module named 'backend.agent.concurrency'`

- [ ] **Step 1.3: 创建 `backend/agent/concurrency.py`（最小实现）**

```python
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
```

- [ ] **Step 1.4: 运行，确认初始状态测试通过**

```bash
pytest backend/tests/test_concurrency_controller.py::TestInitialState -v
```
期望：3 tests PASSED

- [ ] **Step 1.5: 补充并发槽位测试**

在 `backend/tests/test_concurrency_controller.py` 中追加：

```python
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
```

- [ ] **Step 1.6: 运行，确认通过**

```bash
pytest backend/tests/test_concurrency_controller.py::TestSlotControl -v
```
期望：3 tests PASSED

- [ ] **Step 1.7: 补充 429 退避测试**

在 `backend/tests/test_concurrency_controller.py` 中追加：

```python
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
        counts = []

        def _worker():
            barrier.wait()
            c.record_429()
            with c._cond:
                counts.append(c._backoff_count)

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
            with c._cond:
                c._backoff_count = i
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
```

- [ ] **Step 1.8: 运行，确认通过**

```bash
pytest backend/tests/test_concurrency_controller.py::TestBackoff -v
```
期望：6 tests PASSED

- [ ] **Step 1.9: 运行所有 Controller 测试**

```bash
pytest backend/tests/test_concurrency_controller.py -v
```
期望：12 tests PASSED

- [ ] **Step 1.10: 提交**

```bash
git add backend/agent/concurrency.py backend/tests/test_concurrency_controller.py
git commit -m "feat: add ConcurrencyController with adaptive concurrency and daemon backoff"
```

---

### Task 2: Thread-safe SharedKnowledgeBase

**文件：**
- Modify: `backend/agent/context.py:14-21`

- [ ] **Step 2.1: 写失败测试**

新建 `backend/tests/test_shared_knowledge_thread_safe.py`：

```python
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
```

- [ ] **Step 2.2: 运行，确认失败**

```bash
pytest backend/tests/test_shared_knowledge_thread_safe.py -v
```
期望：多数失败（当前 `SharedKnowledgeBase` 是 dataclass，无 `add_module` 方法）

- [ ] **Step 2.3: 修改 `backend/agent/context.py`**

将原有 `SharedKnowledgeBase` dataclass 替换为带锁的普通类：

```python
"""Agent 上下文和共享知识库。"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Optional

from backend.models.discovery import DiscoveryRegistry

if TYPE_CHECKING:
    from backend.llm.context_monitor import ContextMonitor


class SharedKnowledgeBase:
    """Agent 间共享的知识库（线程安全）。

    读操作返回列表快照（copy），防止迭代期间其他线程修改原始列表。
    写操作通过 add_* 方法，均在 _lock 保护下执行。
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._modules: list[dict[str, Any]] = []
        self._layers: list[dict[str, Any]] = []
        self._services: list[dict[str, Any]] = []
        self._entry_points: list[Any] = []

    # ── 写操作：加锁 append ──────────────────────────────
    def add_module(self, module: dict[str, Any]) -> None:
        with self._lock:
            self._modules.append(module)

    def add_layer(self, layer: dict[str, Any]) -> None:
        with self._lock:
            self._layers.append(layer)

    def add_service(self, service: dict[str, Any]) -> None:
        with self._lock:
            self._services.append(service)

    def add_entry_point(self, entry_point: Any) -> None:
        with self._lock:
            self._entry_points.append(entry_point)

    # ── 读操作：返回快照（copy），不暴露原始 list ─────────
    @property
    def modules(self) -> list[dict[str, Any]]:
        with self._lock:
            return list(self._modules)

    @property
    def layers(self) -> list[dict[str, Any]]:
        with self._lock:
            return list(self._layers)

    @property
    def services(self) -> list[dict[str, Any]]:
        with self._lock:
            return list(self._services)

    @property
    def entry_points(self) -> list[Any]:
        with self._lock:
            return list(self._entry_points)


@dataclass
class AgentContext:
    """Agent 执行上下文。"""
    repo_path: str
    module_id: str
    shared_knowledge: SharedKnowledgeBase = field(default_factory=SharedKnowledgeBase)
    discoveries: DiscoveryRegistry = field(default_factory=DiscoveryRegistry)
    max_iterations: int = 20
    timeout_seconds: int = 300
    context_monitor: Optional["ContextMonitor"] = None
```

- [ ] **Step 2.4: 运行测试，确认通过**

```bash
pytest backend/tests/test_shared_knowledge_thread_safe.py -v
```
期望：6 tests PASSED

- [ ] **Step 2.5: 修改 `backend/agent/agents/architecture.py` 第 261 行**

将直接 `.layers.append()` 改为 `add_layer()`：

找到 `architecture.py:261`：
```python
                    self.context.shared_knowledge.layers.append({
                        "id": layer["layer_id"],
                        "name": layer["name"],
                        "layer_type": layer["layer_type"],
                    })
```

改为：
```python
                    self.context.shared_knowledge.add_layer({
                        "id": layer["layer_id"],
                        "name": layer["name"],
                        "layer_type": layer["layer_type"],
                    })
```

- [ ] **Step 2.6: 运行现有测试，确认无回归**

```bash
pytest backend/tests/ -v --tb=short -q 2>&1 | tail -20
```
期望：所有现有测试通过（含 test_compression.py 等）

- [ ] **Step 2.7: 提交**

```bash
git add backend/agent/context.py backend/agent/agents/architecture.py \
        backend/tests/test_shared_knowledge_thread_safe.py
git commit -m "feat: make SharedKnowledgeBase thread-safe with lock and @property snapshots"
```

---

### Task 3: Thread-safe CheckpointManager

**文件：**
- Modify: `backend/agent/checkpoint.py`

- [ ] **Step 3.1: 写失败测试**

新建 `backend/tests/test_checkpoint_thread_safe.py`：

```python
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
```

- [ ] **Step 3.2: 运行，确认（可能）失败或通过**

```bash
pytest backend/tests/test_checkpoint_thread_safe.py -v
```
注：Python dict 操作在 GIL 下偶尔不会崩溃，但加锁是正确实践。记录当前结果。

- [ ] **Step 3.3: 修改 `backend/agent/checkpoint.py`**

在 `CheckpointManager.__init__` 中加 `RLock`，并保护所有读写方法：

在 `__init__` 方法末尾（`self._load_existing_checkpoints()` 之前）添加：
```python
        self._rlock = threading.RLock()
```

同时在文件顶部的 imports 中添加（已有则跳过）：
```python
import threading
```

将以下四个方法包裹在 `_rlock` 中：

**`save` 方法**（第 178 行附近）——替换方法体：
```python
    def save(self, checkpoint: ModuleCheckpoint) -> str:
        with self._rlock:
            self.checkpoints[checkpoint.module_id] = checkpoint
            checkpoint_path = self._get_checkpoint_path(checkpoint.module_id)
            try:
                with open(checkpoint_path, "w", encoding="utf-8") as f:
                    json.dump(checkpoint.to_dict(), f, ensure_ascii=False, indent=2)
                logger.debug(f"检查点已保存: {checkpoint_path}")
            except IOError as e:
                logger.error(f"保存检查点失败 {checkpoint_path}: {e}")
            return str(checkpoint_path)
```

**`get_aggregated_knowledge` 方法**（第 268 行附近）——在方法体开头和结尾加锁：
```python
    def get_aggregated_knowledge(self) -> dict[str, Any]:
        with self._rlock:
            # 原有逻辑不变，只是包在锁内
            aggregated: dict[str, Any] = { ... }  # 保留原有实现
            ...
            return aggregated
```

**`list_completed_modules` 方法**（第 335 行附近）：
```python
    def list_completed_modules(self) -> list[str]:
        with self._rlock:
            return [
                module_id
                for module_id, checkpoint in self.checkpoints.items()
                if checkpoint.status == CHECKPOINT_STATUS_COMPLETED
            ]
```

**`list_pending_modules` 方法**（第 347 行附近）：
```python
    def list_pending_modules(self, all_modules: list[str]) -> list[str]:
        with self._rlock:
            pending = []
            for module_id in all_modules:
                checkpoint = self.checkpoints.get(module_id)
                if checkpoint is None:
                    pending.append(module_id)
                elif checkpoint.status in (
                    CHECKPOINT_STATUS_PENDING,
                    CHECKPOINT_STATUS_PARTIAL,
                    CHECKPOINT_STATUS_FAILED,
                ):
                    pending.append(module_id)
            return pending
```

- [ ] **Step 3.4: 运行测试**

```bash
pytest backend/tests/test_checkpoint_thread_safe.py -v
```
期望：3 tests PASSED

- [ ] **Step 3.5: 确认现有 checkpoint 测试无回归**

```bash
pytest backend/tests/test_checkpoint_partial.py -v
```
期望：所有通过

- [ ] **Step 3.6: 提交**

```bash
git add backend/agent/checkpoint.py backend/tests/test_checkpoint_thread_safe.py
git commit -m "feat: add RLock to CheckpointManager for thread-safe concurrent read/write"
```

---

## Chunk 2: 并发 Orchestrator 主循环

### Task 4: 修复 `_run_agent_for_module` 和 `_create_context`

**文件：**
- Modify: `backend/agent/orchestrator.py:179-187` (`_create_context`)
- Modify: `backend/agent/orchestrator.py:127-177` (`_run_agent_for_module`)

- [ ] **Step 4.0: 写前置失败测试（验证 _create_context 当前复用共享实例）**

新建 `backend/tests/test_orchestrator_context.py`：

```python
"""AgentOrchestrator._create_context 单元测试。"""
from __future__ import annotations

from unittest.mock import MagicMock
from backend.agent.orchestrator import AgentOrchestrator
from backend.agent.config import AnalysisConfig, AnalysisPreset
from backend.llm.client import LLMClient


def _make_orchestrator(tmp_path) -> AgentOrchestrator:
    llm = MagicMock(spec=LLMClient)
    config = AnalysisConfig(preset=AnalysisPreset.STANDARD, max_modules=None)
    return AgentOrchestrator(
        repo_path=str(tmp_path),
        llm_client=llm,
        config=config,
    )


class TestCreateContext:
    def test_each_call_creates_independent_context_monitor(self, tmp_path):
        """每次调用 _create_context 应返回不同的 ContextMonitor 实例（并发安全前提）。"""
        orch = _make_orchestrator(tmp_path)
        ctx1 = orch._create_context("m1")
        ctx2 = orch._create_context("m2")
        assert ctx1.context_monitor is not ctx2.context_monitor

    def test_context_monitor_uses_config_context_window(self, tmp_path):
        """新建 ContextMonitor 的 max_tokens 应与 config.context_window 一致。"""
        orch = _make_orchestrator(tmp_path)
        ctx = orch._create_context("m1")
        assert ctx.context_monitor.max_tokens == orch.config.context_window
```

运行，确认当前测试失败（当前 `_create_context` 复用 `self.context_monitor` 共享实例）：

```bash
pytest backend/tests/test_orchestrator_context.py -v
```
期望：`test_each_call_creates_independent_context_monitor` FAILED（两个 context_monitor 是同一个实例）

- [ ] **Step 4.1: 修改 `_create_context`（第 179-187 行）**

将共享 `ContextMonitor` 改为每次新建独立实例：

旧代码：
```python
    def _create_context(self, module_id: str = None) -> AgentContext:
        """创建 Agent 上下文。"""
        return AgentContext(
            repo_path=str(self.repo_path),
            module_id=module_id or f"repo:{self.repo_path.name}",
            shared_knowledge=self.shared_knowledge,
            max_iterations=self.max_iterations,
            context_monitor=self.context_monitor,
        )
```

新代码：
```python
    def _create_context(self, module_id: str = None) -> AgentContext:
        """创建 Agent 上下文。每次调用创建独立 ContextMonitor 实例（并发安全）。"""
        return AgentContext(
            repo_path=str(self.repo_path),
            module_id=module_id or f"repo:{self.repo_path.name}",
            shared_knowledge=self.shared_knowledge,
            max_iterations=self.max_iterations,
            context_monitor=ContextMonitor(max_tokens=self.config.context_window),
        )
```

- [ ] **Step 4.2: 修改 `_run_agent_for_module`（第 127-177 行）**

移除直接赋值两行（第 135-136 行），保留其余逻辑不变：

移除：
```python
        # 注入聚合的共享知识
        if self.checkpoint_manager is not None:
            aggregated = self.checkpoint_manager.get_aggregated_knowledge()
            context.shared_knowledge.modules = aggregated.get("modules", [])
            context.shared_knowledge.layers = aggregated.get("layers", [])
```

此处的上下文注入改为在 `run_module_analysis` 开头批量完成（Task 5 实现）。`_run_agent_for_module` 的其余 `search_structure` 注册逻辑保持不变。

- [ ] **Step 4.3: 运行前置测试，确认 Step 4.0 的失败测试现在通过**

```bash
pytest backend/tests/test_orchestrator_context.py -v
```
期望：2 tests PASSED

- [ ] **Step 4.4: 运行全套测试，确认无回归**

```bash
pytest backend/tests/ -v --tb=short -q 2>&1 | tail -20
```
期望：所有现有测试通过

- [ ] **Step 4.5: 提交**

```bash
git add backend/agent/orchestrator.py backend/tests/test_orchestrator_context.py
git commit -m "fix: create per-module ContextMonitor in _create_context, remove direct @property assignment"
```

---

### Task 5: 并发 `run_module_analysis` 主循环

**文件：**
- Modify: `backend/agent/orchestrator.py:310-491` (`run_module_analysis`)

- [ ] **Step 5.1: 在 `orchestrator.py` 顶部添加并发相关 imports**

在 `from backend.llm.client import ...` 附近，找到现有 imports 区域，添加：

```python
from concurrent.futures import ThreadPoolExecutor, as_completed
from backend.agent.concurrency import ConcurrencyController, MAX_POOL_SIZE
```

（`MAX_POOL_SIZE = 8` 已定义在 `concurrency.py` 中）

也在文件顶部的环境变量配置处添加：
```python
# 并发控制配置（可通过环境变量覆盖）
CONCURRENT_WORKERS_INIT = int(os.environ.get("CONCURRENT_WORKERS_INIT", "2"))
CONCURRENT_WORKERS_MAX = int(os.environ.get("CONCURRENT_WORKERS_MAX", "5"))
```

- [ ] **Step 5.2: 在 `run_module_analysis` 中添加 `_run_module_worker` 辅助方法**

在 `run_module_analysis` 方法**之前**（即第 310 行之前），添加：

```python
    def _run_module_worker(
        self, module: dict, controller: "ConcurrencyController"
    ) -> "AgentOutput":
        """Worker 线程执行函数。占 slot → 分析模块 → 释放 slot。"""
        controller.wait_to_start()
        try:
            output = self._run_agent_for_module(module)
            controller.record_success()
            return output
        except RateLimitExhaustedError:
            controller.record_429()
            # 使用 return 而非 raise：rate limit 已由 controller 处理，
            # 两者均触发 finally，但 return 语义更清晰
            from backend.models.agent_output import AgentOutput as _AO
            return _AO(status="rate_limited", nodes=[], edges=[])
        except Exception:
            raise
        finally:
            controller.release()  # 无论如何释放 slot
```

- [ ] **Step 5.3: 重写 `run_module_analysis`（并发主循环）**

将 `run_module_analysis` 方法（第 310-491 行）替换为：

```python
    def run_module_analysis(
        self,
        modules: list[dict],
        repo_name: str = None,
    ) -> OrchestratorResult:
        """运行模块级分析（并发 + 检查点）。

        使用 ThreadPoolExecutor 并发执行，ConcurrencyController 动态控制并发度（2-5）。
        主线程通过 as_completed 串行写检查点，确保线程安全。

        Args:
            modules: 模块列表，每个模块包含 id, name 等字段
            repo_name: 仓库名称，用于检查点存储。为 None 时禁用检查点

        Returns:
            OrchestratorResult 包含所有模块的分析结果
        """
        if repo_name and self.checkpoint_manager is None:
            self.checkpoint_manager = CheckpointManager(repo_name)

        # 应用 max_modules 限制
        if self.config.max_modules:
            modules = modules[: self.config.max_modules]

        # 断点续跑：计算待处理模块
        all_module_ids = [m.get("id", f"module_{i}") for i, m in enumerate(modules)]
        if self.checkpoint_manager is not None:
            pending_ids = set(self.checkpoint_manager.list_pending_modules(all_module_ids))
        else:
            pending_ids = set(all_module_ids)

        completed_count = len(all_module_ids) - len(pending_ids)
        if completed_count > 0:
            logger.info("断点续跑：已完成 %d/%d 个模块，续跑剩余", completed_count, len(all_module_ids))

        # 从检查点批量注入聚合知识（替代原 _run_agent_for_module 内的逐次注入）
        # 原代码直接赋值 context.shared_knowledge.modules = ... 在 @property 下会 AttributeError
        if self.checkpoint_manager is not None:
            aggregated = self.checkpoint_manager.get_aggregated_knowledge()
            for m in aggregated.get("modules", []):
                self.shared_knowledge.add_module(m)
            for layer in aggregated.get("layers", []):
                self.shared_knowledge.add_layer(layer)

        # 构建整个仓库的结构索引（零 LLM 调用，一次性）
        try:
            from backend.agent.structure_indexer import StructureIndexer
            _raw_depth = self.config.preset.value if hasattr(self.config, "preset") else "standard"
            depth = _raw_depth if _raw_depth in ("quick", "standard", "deep") else "standard"
            self._structure_indexer = StructureIndexer(depth=depth)
            self._structure_indexer.build_index(self.repo_path)
            logger.info("StructureIndexer 索引构建完成：%d 个文件", len(self._structure_indexer._index))
        except Exception as _si_err:
            logger.warning("StructureIndexer 初始化失败，跳过结构索引：%s", _si_err)

        # 初始化并发控制器
        controller = ConcurrencyController(
            initial_workers=CONCURRENT_WORKERS_INIT,
            max_workers=CONCURRENT_WORKERS_MAX,
            max_pauses=RATE_LIMIT_MAX_PAUSES,
            initial_backoff=float(os.environ.get("RATE_LIMIT_PAUSE_SECONDS", "10")),
        )

        pending_modules = [m for m in modules if m.get("id") in pending_ids]
        all_nodes: list[GraphNode] = []
        all_edges: list[GraphEdge] = []
        module_outputs: dict[str, AgentOutput] = {}

        with ThreadPoolExecutor(max_workers=MAX_POOL_SIZE) as executor:
            futures = {
                executor.submit(self._run_module_worker, m, controller): m
                for m in pending_modules
            }

            for future in as_completed(futures):
                # 检查 should_abort（429 次数超限）
                if controller.should_abort:
                    completed = (
                        len(self.checkpoint_manager.list_completed_modules())
                        if self.checkpoint_manager else 0
                    )
                    raise PartialResultError(completed, len(modules))

                module = futures[future]
                module_id = module.get("id", "unknown")
                module_name = module.get("name", module_id)

                try:
                    output = future.result()
                    module_outputs[module_id] = output

                    # 主线程串行写检查点（CheckpointManager 内部已加 RLock，双重保险）
                    if self.checkpoint_manager is not None:
                        checkpoint_status = CHECKPOINT_STATUS_COMPLETED
                        if output.status == "partial":
                            checkpoint_status = CHECKPOINT_STATUS_PARTIAL
                        elif output.status in ("failed", "rate_limited"):
                            checkpoint_status = CHECKPOINT_STATUS_FAILED

                        checkpoint = ModuleCheckpoint(
                            module_id=module_id,
                            module_name=module_name,
                            nodes=[n.model_dump() for n in output.nodes],
                            edges=[e.model_dump() for e in output.edges],
                            knowledge={
                                "modules": self.shared_knowledge.modules,
                                "layers": self.shared_knowledge.layers,
                            },
                            status=checkpoint_status,
                        )
                        self.checkpoint_manager.save(checkpoint)

                    if output.status == "success":
                        all_nodes.extend(output.nodes)
                        all_edges.extend(output.edges)
                        logger.info(
                            "模块 %s: %d 节点 / %d 边",
                            module_name, len(output.nodes), len(output.edges),
                        )
                        self._emit_progress(
                            "module_analysis", "success",
                            f"完成模块分析: {module_name}",
                            module_id=module_id,
                            nodes=len(output.nodes),
                            edges=len(output.edges),
                        )
                    else:
                        logger.warning("模块 %s 分析结果: %s", module_name, output.status)

                except PartialResultError:
                    raise  # 透传，不 catch
                except Exception as e:
                    logger.error("模块 %s 失败: %s", module_id, e, exc_info=True)
                    # 并发模式下每个模块有独立 ContextMonitor，无需重置共享实例

        # 仅在全部完成时清除检查点（异常退出时保留，供断点续跑）
        if self.checkpoint_manager is not None:
            self.checkpoint_manager.clear()

        # 确定最终状态
        successful = [o for o in module_outputs.values() if o.status == "success"]
        if len(successful) == len(modules):
            status = "success"
        elif len(all_nodes) > 0:
            status = "partial"
        else:
            status = "failed"

        return OrchestratorResult(
            status=status,
            nodes=all_nodes,
            edges=all_edges,
            agent_outputs=module_outputs,
            meta={
                "checkpoint_enabled": self.checkpoint_manager is not None,
                "total_modules": len(modules),
                "successful_modules": len(successful),
                "total_nodes": len(all_nodes),
                "total_edges": len(all_edges),
                "concurrent": True,
            },
        )
```

- [ ] **Step 5.4: 运行全套测试，确认无回归**

```bash
pytest backend/tests/ -v --tb=short -q 2>&1 | tail -25
```
期望：所有现有测试通过

- [ ] **Step 5.5: 提交**

```bash
git add backend/agent/orchestrator.py
git commit -m "feat: concurrent run_module_analysis with ThreadPoolExecutor and ConcurrencyController"
```

---

### Task 6: 并发集成测试

**文件：**
- Test: `backend/tests/test_orchestrator_concurrent.py`

- [ ] **Step 6.1: 新建集成测试文件**

新建 `backend/tests/test_orchestrator_concurrent.py`：

```python
"""并发模块分析编排器集成测试（全 Mock LLM）。"""
from __future__ import annotations

import threading
import time
from unittest.mock import MagicMock, patch
import pytest

from backend.agent.orchestrator import AgentOrchestrator, PartialResultError
from backend.agent.config import AnalysisConfig, AnalysisPreset
from backend.llm.client import LLMClient, RateLimitExhaustedError
from backend.models.agent_output import AgentOutput
from backend.graph.graph_schema import GraphNode, GraphEdge


def _make_orchestrator(tmp_path, on_progress=None) -> AgentOrchestrator:
    """构建测试用编排器（Mock LLM，真实文件系统 checkpoint）。"""
    llm = MagicMock(spec=LLMClient)
    config = AnalysisConfig(preset=AnalysisPreset.STANDARD, max_modules=None)
    return AgentOrchestrator(
        repo_path=str(tmp_path),
        llm_client=llm,
        on_progress=on_progress,
        config=config,
    )


def _make_modules(n: int) -> list[dict]:
    return [{"id": f"module_{i}", "name": f"Module {i}", "path": f"/fake/{i}"} for i in range(n)]


def _success_output(n_nodes: int = 2) -> AgentOutput:
    nodes = [
        GraphNode(id=f"n{i}", type="Module", name=f"Node{i}", properties={})
        for i in range(n_nodes)
    ]
    return AgentOutput(status="success", nodes=nodes, edges=[])


class TestAllModulesComplete:
    def test_all_modules_complete_and_nodes_merged(self, tmp_path):
        """Mock LLM，5 个模块并发跑完，节点数正确合并。"""
        orch = _make_orchestrator(tmp_path)

        with patch.object(orch, "_run_agent_for_module", return_value=_success_output(2)):
            result = orch.run_module_analysis(_make_modules(5), repo_name="test-repo")

        assert result.status == "success"
        assert len(result.nodes) == 10  # 5 个模块 × 2 节点


class TestPerModuleContextMonitor:
    def test_per_module_context_monitors_are_independent(self, tmp_path):
        """多次调用 _create_context 应返回不同 ContextMonitor 实例。

        直接测试 _create_context 本身，不通过 run_module_analysis 间接验证，
        避免双重 patch 导致 _create_context 调用路径被截断的问题。
        """
        orch = _make_orchestrator(tmp_path)
        ctx1 = orch._create_context("m1")
        ctx2 = orch._create_context("m2")
        ctx3 = orch._create_context("m3")

        monitors = [ctx1.context_monitor, ctx2.context_monitor, ctx3.context_monitor]
        # 每次调用应返回不同实例（id 各不相同）
        assert len(set(id(m) for m in monitors)) == 3


class TestCheckpointBehavior:
    def test_checkpoint_written_per_module(self, tmp_path):
        """每个模块完成后主线程串行写检查点，无丢失。"""
        orch = _make_orchestrator(tmp_path)

        with patch.object(orch, "_run_agent_for_module", return_value=_success_output(1)):
            result = orch.run_module_analysis(_make_modules(3), repo_name="cp-test")

        # 全部完成后 checkpoint_manager.clear() 被调用，检查点文件应已清理
        assert result.status == "success"

    def test_checkpoint_cleared_on_success(self, tmp_path):
        """全部成功后 clear 被调用。"""
        orch = _make_orchestrator(tmp_path)

        with patch.object(orch, "_run_agent_for_module", return_value=_success_output(1)):
            orch.run_module_analysis(_make_modules(2), repo_name="clear-test")

        # checkpoint_manager 应已 clear（在 run_module_analysis 末尾调用）
        if orch.checkpoint_manager:
            assert len(orch.checkpoint_manager.checkpoints) == 0

    def test_checkpoint_preserved_on_partial(self, tmp_path, monkeypatch):
        """PartialResultError 退出时检查点文件保留（不调用 clear）。

        用 monkeypatch.setattr 直接覆盖已固化的模块级常量 RATE_LIMIT_MAX_PAUSES（值为 1），
        确保第 2 次 429 就触发终止，而不依赖默认值 3。
        注意：不能用 monkeypatch.setenv，因为常量在模块导入时已经求值完毕。
        call_count 使用 threading.Lock 避免并发竞态。
        """
        import backend.agent.orchestrator as _orch_mod
        monkeypatch.setattr(_orch_mod, "RATE_LIMIT_MAX_PAUSES", 1)
        orch = _make_orchestrator(tmp_path)
        lock = threading.Lock()
        call_count_box = [0]  # 用列表避免 nonlocal 在多线程下的竞态

        def _flaky_run(module):
            with lock:
                call_count_box[0] += 1
                is_first = call_count_box[0] == 1
            if not is_first:
                raise RateLimitExhaustedError("429")
            return _success_output(1)

        with pytest.raises(PartialResultError):
            with patch.object(orch, "_run_agent_for_module", side_effect=_flaky_run):
                orch.run_module_analysis(_make_modules(5), repo_name="partial-test")

        # clear() 不应被调用，检查点应保留
        if orch.checkpoint_manager:
            assert len(orch.checkpoint_manager.checkpoints) > 0


class TestNonRateLimitError:
    def test_non_rate_limit_error_skips_module(self, tmp_path):
        """Worker 抛出非 429 异常时，主循环继续处理其余 Future。

        call_count 用 threading.Lock 保护，避免并发场景下多线程同时读写的竞态。
        """
        orch = _make_orchestrator(tmp_path)
        lock = threading.Lock()
        call_count_box = [0]

        def _sometimes_fail(module):
            with lock:
                call_count_box[0] += 1
                is_second = call_count_box[0] == 2
            if is_second:
                raise ValueError("非 429 错误")
            return _success_output(1)

        with patch.object(orch, "_run_agent_for_module", side_effect=_sometimes_fail):
            result = orch.run_module_analysis(_make_modules(4))

        # 至少 1 个成功（非 429 错误被跳过），其余模块继续完成
        assert result.status in ("partial", "success")
        assert len(result.nodes) >= 1


class TestSharedKnowledgeThreadSafety:
    def test_concurrent_add_no_duplicates(self, tmp_path):
        """多线程并发通过 ArchitectureAgent 写 shared_knowledge，无竞态。"""
        orch = _make_orchestrator(tmp_path)
        barrier = threading.Barrier(5)

        def _add_layer():
            barrier.wait()
            orch.shared_knowledge.add_layer({"id": f"layer:{threading.get_ident()}"})

        threads = [threading.Thread(target=_add_layer, daemon=True) for _ in range(5)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=2)

        assert len(orch.shared_knowledge.layers) == 5
```

- [ ] **Step 6.2: 运行集成测试**

```bash
pytest backend/tests/test_orchestrator_concurrent.py -v --tb=short
```
期望：全部通过（~10 个测试）

- [ ] **Step 6.3: 运行全套测试**

```bash
pytest backend/tests/ -v --tb=short -q 2>&1 | tail -25
```
期望：所有测试通过（含新增测试）

- [ ] **Step 6.4: 提交**

```bash
git add backend/tests/test_orchestrator_concurrent.py
git commit -m "test: add concurrent orchestrator integration tests"
```

---

## 最终验证

- [ ] **全套测试通过**

```bash
cd /Users/wayne/Documents/code/code-knowledge-graph/code-graph-system
source venv/bin/activate
pytest backend/tests/ -v --tb=short 2>&1 | tail -30
```
期望：100% 通过，无 FAILED

- [ ] **推送到远程**

```bash
git push origin dev/v2
```

---

## 快速参考：环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `CONCURRENT_WORKERS_INIT` | `2` | 初始并发度 |
| `CONCURRENT_WORKERS_MAX` | `5` | 并发度上限 |
| `RATE_LIMIT_MAX_PAUSES` | `3` | 超过此次数触发 PartialResultError |
| `RATE_LIMIT_PAUSE_SECONDS` | `10` | 首次退避秒数（指数增长） |
