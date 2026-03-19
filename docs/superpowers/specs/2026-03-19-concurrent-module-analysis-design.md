# 并发模块分析设计

**日期**：2026-03-19
**状态**：待实现
**优先级**：高
**背景**：第一期完成上下文压缩和 StructureIndexer 后，分析速度仍受制于串行执行——96 个模块顺序跑约 45 分钟。本期通过批量并发执行，目标将总耗时压缩至 10-15 分钟。

---

## 问题诊断

当前 `run_module_analysis()` 是纯串行的：一个模块的 `tool_call_loop` 跑完（平均 30 秒）才启动下一个。96 个模块 × 30 秒 ≈ 48 分钟，CPU 和网络大部分时间处于等待状态。

LLM API 调用是 I/O 密集型（等待 HTTP 响应），Python GIL 在 I/O 等待期间自动释放，多线程并发效果接近 async，同时无需改动 `LLMClient`、所有 Agent 和 `AIPipeline`。

---

## 设计目标

| 指标 | 当前 | 目标 |
|---|---|---|
| 96 模块总耗时 | ~45 分钟 | ~10-15 分钟 |
| 并发度 | 1（串行）| 2-5（自适应）|
| 429 处理 | 单线程等待重试 | 全局协调退避，防雷群效应 |
| 检查点写入 | Worker 线程写 | 主线程串行写，线程安全 |

---

## 整体架构

```
run_module_analysis(modules)
        │
        ├─ [不变] StructureIndexer.build_index()    ← 只读，天然线程安全
        │
        ├─ ConcurrencyController                     ← 新增，所有 Worker 共享
        │    ├─ 单一 threading.Condition             ← 统一保护所有字段
        │    ├─ _max_workers / _active_count / _paused / _is_backing_off
        │    ├─ wait_to_start()  → 阻塞直到有空闲 slot 且未暂停
        │    ├─ release()        → Worker 完成后释放 slot，notify_all
        │    ├─ record_success() → 连续成功 N 次后升 max_workers
        │    └─ record_429()     → 首个线程触发退避（守护线程 sleep），其余等待
        │
        ├─ ThreadPoolExecutor(max_workers=MAX_POOL=8)   ← 固定线程池
        │    └─ Worker: wait_to_start → _run_agent_for_module → release
        │         （每个 Worker 创建独立的 ContextMonitor 实例）
        │
        └─ 主线程 as_completed 循环
             ├─ 收集 Future 结果
             ├─ 串行写检查点（CheckpointManager 加 RLock）
             └─ 合并 all_nodes / all_edges
```

---

## 详细设计

### 一、ConcurrencyController

**新文件**：`backend/agent/concurrency.py`

#### 1.1 接口

```python
class ConcurrencyController:
    """跨线程并发协调器。所有 Worker 共享同一个实例。

    职责：
    - 动态控制并发度（Condition 统一保护，支持真实升降）
    - 协调 429 退避（守护线程执行 sleep，不阻塞 Worker 槽）
    - 退避次数超限时直接抛出 PartialResultError
    """

    def __init__(
        self,
        initial_workers: int = 2,
        max_workers: int = 5,
        success_threshold: int = 3,      # 连续 N 次成功才升并发
        initial_backoff: float = 10.0,   # 首次 429 等待秒数
        max_backoff: float = 300.0,      # 退避上限（5 分钟）
        max_pauses: int = 3,             # 超过此次数触发 PartialResultError
    ) -> None: ...

    def wait_to_start(self) -> None:
        """Worker 分析模块前调用。有空闲 slot 且未暂停时返回并占一个 slot。"""

    def release(self) -> None:
        """Worker 模块完成后调用（无论成功或失败）。释放 slot，notify_all。"""

    def record_success(self) -> None:
        """Worker 模块成功完成后调用。连续 success_threshold 次则升并发。"""

    def record_429(self) -> None:
        """Worker 收到 429 时调用。
        第一个调用者启动守护退避线程；其余调用者直接返回（wait_to_start 阻塞即可）。
        退避次数超过 max_pauses 时，由守护线程抛出 PartialResultError（设置 flag）。
        """

    @property
    def should_abort(self) -> bool:
        """主线程在 as_completed 循环中检查此 flag，True 时提前退出。"""

    @property
    def current_workers(self) -> int:
        """当前生效的 max_workers 值（仅供日志/监控使用）。"""
```

#### 1.2 单一 Condition 保护所有字段

所有内部字段（`_active_count`、`_paused`、`_is_backing_off`、`_max_workers`）均在同一个 `threading.Condition` 的锁下访问，消除 `_lock` + `_condition` 混用问题：

```python
def wait_to_start(self) -> None:
    with self._cond:
        while self._active_count >= self._max_workers or self._paused:
            self._cond.wait()
        self._active_count += 1

def release(self) -> None:
    with self._cond:
        self._active_count -= 1
        self._cond.notify_all()

# 升并发（在 record_success 内部）：
with self._cond:
    self._max_workers = min(self._max_workers + 1, self._hard_max)
    self._cond.notify_all()

# 降并发（在退避守护线程内部）：
with self._cond:
    self._max_workers = max(self._max_workers - 1, 1)
    self._paused = False
    self._is_backing_off = False
    self._cond.notify_all()
```

#### 1.3 守护线程执行退避（不占 Worker 槽）

Worker 调用 `record_429()` 后立即 `release()` 槽位再抛异常，避免在 `time.sleep` 期间白白占用线程池槽：

```python
def record_429(self) -> None:
    with self._cond:
        if self._is_backing_off:
            return                      # 已有守护线程在退避，直接返回
        self._is_backing_off = True
        self._paused = True
        self._backoff_count += 1
        backoff_sec = min(
            self._initial_backoff * (2 ** (self._backoff_count - 1)),
            self._max_backoff,
        )
        should_abort = self._backoff_count > self._max_pauses
        backoff_count_snapshot = self._backoff_count   # 在锁内捕获，避免闭包无锁读取

    if should_abort:
        with self._cond:
            self._should_abort = True   # 主线程检查此 flag 后触发 PartialResultError
            self._paused = False
            self._is_backing_off = False  # 清零，防止实例复用时静默忽略后续 429
            self._cond.notify_all()
        return

    # 启动守护线程执行 sleep，不阻塞调用方（Worker 线程可以立即 release 并退出）
    def _do_backoff():
        logger.warning("ConcurrencyController: 429 退避 %.0f 秒（第 %d 次）", backoff_sec, backoff_count_snapshot)
        time.sleep(backoff_sec)
        with self._cond:
            self._is_backing_off = False
            self._paused = False
            self._max_workers = max(self._max_workers - 1, 1)
            self._cond.notify_all()

    threading.Thread(target=_do_backoff, daemon=True).start()
```

Worker 调用 `record_429()` 后的完整流程：

```python
# _run_module_worker 内
except RateLimitExhaustedError:
    controller.record_429()   # 设置暂停标志，启动守护退避线程
    return AgentOutput(status="rate_limited", ...)
    # 使用 return 而非 raise，两者均触发 finally，
    # 但 return 语义更清晰（rate limit 已由 controller 处理，不需要向上传播异常）
finally:
    controller.release()      # 无论如何释放槽位，由主线程检查 should_abort 决定是否终止
```

#### 1.4 自适应并发规则

| 事件 | 触发条件 | 动作 |
|---|---|---|
| 升并发 | 连续 `success_threshold`（默认 3）次成功 | `max_workers = min(max_workers + 1, 5)` |
| 降并发 | 任意线程触发退避 | 守护线程退避结束后 `max_workers = max(max_workers - 1, 1)` |
| 终止分析 | `_backoff_count > max_pauses` | `should_abort = True`，主线程触发 `PartialResultError` |

退避序列（initial_backoff=10s）：`10s → 20s → 40s → 80s → 160s → 300s（上限）`

---

### 二、run_module_analysis 并发改造

**修改文件**：`backend/agent/orchestrator.py`

#### 2.1 主循环

```python
def run_module_analysis(self, modules, repo_name=None):
    # --- 不变：检查点初始化 + 断点续跑计算 ---
    ...
    pending_modules = [m for m in modules if m.get("id") in pending_ids]

    # --- 不变：StructureIndexer 构建（只读，线程安全）---
    self._build_structure_index()

    # --- 新增：从检查点批量注入聚合知识（替代原 _run_agent_for_module 内的逐次注入）---
    # 原代码在每个模块启动前赋值 context.shared_knowledge.modules = ...（直接赋值），
    # @property 无 setter，并发下会 AttributeError；改为在此一次性加载，Worker 无需重复注入。
    if self.checkpoint_manager is not None:
        aggregated = self.checkpoint_manager.get_aggregated_knowledge()
        for m in aggregated.get("modules", []):
            self.shared_knowledge.add_module(m)
        for layer in aggregated.get("layers", []):
            self.shared_knowledge.add_layer(layer)

    # --- 新增：初始化并发控制器 ---
    controller = ConcurrencyController(
        initial_workers=int(os.environ.get("CONCURRENT_WORKERS_INIT", "2")),
        max_workers=int(os.environ.get("CONCURRENT_WORKERS_MAX", "5")),
        max_pauses=RATE_LIMIT_MAX_PAUSES,
    )

    all_nodes, all_edges, module_outputs = [], [], {}

    with ThreadPoolExecutor(max_workers=MAX_POOL_SIZE) as executor:
        futures = {
            executor.submit(self._run_module_worker, m, controller): m
            for m in pending_modules
        }

        for future in as_completed(futures):
            # 检查 should_abort（429 次数超限）
            if controller.should_abort:
                completed = sum(1 for o in module_outputs.values() if o.status == "success")
                raise PartialResultError(completed, len(modules))

            module = futures[future]
            module_id = module.get("id")
            try:
                output = future.result()
                module_outputs[module_id] = output

                # 主线程串行写检查点（CheckpointManager 内部已加 RLock，双重保险）
                if self.checkpoint_manager:
                    self._save_checkpoint(module, output)

                if output.status == "success":
                    all_nodes.extend(output.nodes)
                    all_edges.extend(output.edges)
                    self._emit_progress(...)

            except PartialResultError:
                raise   # 透传，不 catch
            except Exception as e:
                logger.error("模块 %s 失败: %s", module_id, e)
                # 并发模式下每个模块有独立 ContextMonitor，不需要调用 _reset_context_monitor()

    # 仅在全部完成时清除检查点（异常退出时保留，供断点续跑）
    if self.checkpoint_manager:
        self.checkpoint_manager.clear()

    ...
```

> **注意**：`with ThreadPoolExecutor(...) as executor:` 的 `__exit__` 会调用 `shutdown(wait=True)`，
> 即 `PartialResultError` 抛出后主线程仍需等待已提交的 Worker 完成。Python 3.9+ 可用
> `executor.shutdown(wait=False, cancel_futures=True)` 提前取消尚未开始的任务，但正在运行的
> LLM 调用（HTTP 请求）无法中断，只能等其自然返回。在可接受等待的场景下直接 `shutdown(wait=True)` 即可。

#### 2.2 Worker 函数

```python
def _run_module_worker(
    self, module: dict, controller: ConcurrencyController
) -> AgentOutput:
    """Worker 线程执行函数。"""
    controller.wait_to_start()
    try:
        output = self._run_agent_for_module(module)
        controller.record_success()
        return output
    except RateLimitExhaustedError:
        controller.record_429()   # 标志暂停，启动守护退避线程
        return AgentOutput(status="rate_limited", nodes=[], edges=[])
    except Exception:
        raise
    finally:
        controller.release()      # 无论如何都释放槽位
```

---

### 三、per-module ContextMonitor

**修改文件**：`backend/agent/orchestrator.py`

`ContextMonitor` 原先是 `AgentOrchestrator` 的**共享单例**，多 Worker 并发写 `_last_input_tokens` 会造成竞态。

**修复**：在 `_create_context()` 内为每个模块创建独立实例：

```python
def _create_context(self, module_id: str = None) -> AgentContext:
    return AgentContext(
        repo_path=str(self.repo_path),
        module_id=module_id or f"repo:{self.repo_path.name}",
        shared_knowledge=self.shared_knowledge,
        max_iterations=self.max_iterations,
        context_monitor=ContextMonitor(max_tokens=self.config.context_window),  # 每次新建
    )
```

`self.context_monitor`（原共享实例）仅保留用于聚合日志（可选），不再注入 Agent。
`_reset_context_monitor()` 方法保留用于向后兼容，但在并发模式下无实际作用（每个模块用独立实例）。

---

### 四、SharedKnowledgeBase 线程安全

**修改文件**：`backend/agent/context.py`、`backend/agent/agents/architecture.py`

当前 `SharedKnowledgeBase` 是 `@dataclass`，字段是裸 list，无任何锁。需改为普通类，读写均加锁。

**读操作必须返回快照（copy），不能暴露原始 list** — 原始 list 在调用方迭代时若有其他线程写入，会抛出 `RuntimeError: list changed size during iteration`：

```python
class SharedKnowledgeBase:
    def __init__(self):
        self._modules: list = []
        self._layers: list = []
        self._services: list = []
        self._entry_points: list = []
        self._lock = threading.Lock()

    # ── 写操作：加锁 append ──────────────────────────────
    def add_module(self, module: dict) -> None:
        with self._lock:
            self._modules.append(module)

    def add_layer(self, layer: dict) -> None:
        with self._lock:
            self._layers.append(layer)

    def add_service(self, service: dict) -> None:
        with self._lock:
            self._services.append(service)

    def add_entry_point(self, entry_point: str) -> None:
        with self._lock:
            self._entry_points.append(entry_point)

    # ── 读操作：返回快照（copy），不暴露原始 list ─────────
    @property
    def modules(self) -> list:
        with self._lock:
            return list(self._modules)

    @property
    def layers(self) -> list:
        with self._lock:
            return list(self._layers)

    @property
    def services(self) -> list:
        with self._lock:
            return list(self._services)

    @property
    def entry_points(self) -> list:
        with self._lock:
            return list(self._entry_points)
```

`modules`、`layers` 等改为 `@property` 后，Agent 中原有的 `shared_knowledge.modules`（只读访问）无需修改；只需改写操作：

- **`backend/agent/agents/architecture.py` 第 261 行**：`self.context.shared_knowledge.layers.append(...)` → `self.context.shared_knowledge.add_layer(...)`
- **其余 Agent**（`call_graph`、`cross_module`、`data_lineage` 等）只写各自的 `context.discoveries`，`discoveries` 是 per-module 对象，无需修改

---

### 五、CheckpointManager 线程安全

**修改文件**：`backend/agent/checkpoint.py`

`get_aggregated_knowledge()` 在 Worker 线程中被调用，而 `save()` 在主线程调用，两者并发访问 `self.checkpoints` dict 需加锁：

```python
class CheckpointManager:
    def __init__(self, repo_name: str):
        ...
        self._rlock = threading.RLock()   # 可重入锁，保护所有 checkpoints 读写

    def save(self, checkpoint: ModuleCheckpoint) -> None:
        with self._rlock:
            self.checkpoints[checkpoint.module_id] = checkpoint
            self._persist()

    def get_aggregated_knowledge(self) -> dict:
        with self._rlock:
            return {...}  # 在锁内遍历 self.checkpoints.values()

    def list_completed_modules(self) -> list[str]:
        with self._rlock:
            return [...]

    def list_pending_modules(self, all_ids: list[str]) -> list[str]:
        with self._rlock:
            return [...]
```

---

## 文件变更地图

| 文件 | 操作 | 核心改动 |
|---|---|---|
| `backend/agent/concurrency.py` | **新建** | `ConcurrencyController`，单一 Condition + 守护退避线程 |
| `backend/agent/orchestrator.py` | 修改 | `run_module_analysis` 并发化；`_create_context` 改为每次 `ContextMonitor(max_tokens=...)` 新建实例；**移除 `_run_agent_for_module` 中 `context.shared_knowledge.modules = ...` 和 `.layers = ...` 两处直接赋值**（`@property` 无 setter，直接赋值会引发 `AttributeError`）；改为在 `run_module_analysis` 开头通过 `add_module()`/`add_layer()` 批量注入检查点聚合知识 |
| `backend/agent/context.py` | 修改 | `SharedKnowledgeBase` 从 dataclass 改为普通类，`_lock` 保护所有字段，读操作返回 list 快照，写操作提供 `add_*` 方法 |
| `backend/agent/agents/architecture.py` | 修改 | 第 261 行：`.layers.append()` → `.add_layer()`（**唯一需改的 Agent**，其余 Agent 只写各自 per-module 的 `context.discoveries`，无需改动） |
| `backend/agent/checkpoint.py` | 修改 | `CheckpointManager` 加 `RLock`，保护 `save`、`get_aggregated_knowledge`、`list_*` 等所有读写操作 |
| `backend/tests/test_concurrency_controller.py` | **新建** | Controller 单元测试 |
| `backend/tests/test_orchestrator_concurrent.py` | **新建** | 并发编排集成测试 |

**不需要改动**：`LLMClient`、所有 Agent（`architecture.py` 除外）、`StructureIndexer`、`AIPipeline`、Celery tasks

---

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `CONCURRENT_WORKERS_INIT` | `2` | 初始并发度 |
| `CONCURRENT_WORKERS_MAX` | `5` | 并发度上限 |
| `RATE_LIMIT_MAX_PAUSES` | `3` | 超过此退避次数触发 PartialResultError |
| `RATE_LIMIT_PAUSE_SECONDS` | `10` | 首次退避秒数（指数增长） |

---

## 测试策略

### 单元测试（`test_concurrency_controller.py`）

| 测试 | 验证内容 |
|---|---|
| `test_initial_state` | current_workers == initial, active_count == 0 |
| `test_wait_blocks_at_capacity` | 并发满时 wait_to_start 阻塞，release 后恢复 |
| `test_success_threshold_increases_workers` | 连续 3 次成功后 current_workers +1 |
| `test_workers_capped_at_max` | current_workers 不超过 hard_max |
| `test_record_429_pauses_then_resumes` | 退避守护线程完成后 wait_to_start 恢复 |
| `test_only_one_thread_backs_off` | 多线程同时 record_429，只一个守护线程启动（用 Barrier 控制时序）|
| `test_backoff_exponential` | 退避时间按 2^n 增长 |
| `test_backoff_capped_at_max` | 退避时间不超过 max_backoff |
| `test_should_abort_after_max_pauses` | 超过 max_pauses 后 should_abort == True |
| `test_max_workers_decreases_after_429` | 退避恢复后 current_workers -1 |
| `test_worker_slot_released_before_backoff` | 调用 record_429 后 active_count 立即减少（不等 sleep 结束）|

### 集成测试（`test_orchestrator_concurrent.py`）

| 测试 | 验证内容 |
|---|---|
| `test_all_modules_complete` | Mock LLM，5 个模块并发跑完，节点数正确合并 |
| `test_per_module_context_monitor` | 多模块并发，各自的 ContextMonitor 互不干扰 |
| `test_checkpoint_written_per_module` | 每个模块完成后主线程串行写检查点，无丢失 |
| `test_429_triggers_backoff_and_continues` | 中途 429，退避后其余模块继续完成 |
| `test_checkpoint_preserved_on_partial` | PartialResultError 退出时检查点文件保留（不调用 clear）|
| `test_checkpoint_cleared_on_success` | 全部成功后 clear 被调用 |
| `test_shared_knowledge_thread_safe` | 多线程并发 add_module，用 Barrier 精确控制竞态，断言无重复 |
| `test_checkpoint_manager_concurrent_rw` | 主线程 save + Worker 线程 get_aggregated_knowledge 并发，无异常 |
| `test_non_rate_limit_error_skips_module` | Worker 抛出非 429 异常时，主循环继续处理其余 Future |

---

## 数据流总览

```
run_module_analysis(modules)
    │
    ├─ StructureIndexer.build_index()        # 主线程，一次性，只读
    ├─ ConcurrencyController 初始化          # max_workers=2
    │
    └─ ThreadPoolExecutor
         │
         ├─ Worker（N 个并发）:
         │    controller.wait_to_start()      # 等 slot（Condition 阻塞）
         │    _create_context()               # 创建 per-module ContextMonitor
         │    _run_agent_for_module()         # LLM 调用（I/O 等待，GIL 释放）
         │    controller.record_success/429()
         │    controller.release()            # 释放 slot，notify_all
         │
         └─ 主线程 as_completed:
              ├─ controller.should_abort?     # 检查 429 超限
              ├─ future.result()             # 收集结果
              ├─ checkpoint_manager.save()   # 串行写，RLock 保护
              └─ all_nodes.extend()         # 合并图谱
```

---

## 第三期（后续）

- **动态模块优先级**：优先分析文件数多/被依赖多的核心模块，让后续模块借用共享知识
- **跨模块知识聚合**：并发完成后增加一轮串行 CrossModuleAgent 综合分析
