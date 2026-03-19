# 并发模块分析设计

**日期**：2026-03-19
**状态**：待实现
**优先级**：高
**背景**：第一期完成上下文压缩和 StructureIndexer 后，分析速度仍受制于串行执行——96 个模块顺序跑约 45 分钟。本期通过批量并发执行，目标将总耗时压缩至 10-15 分钟。

---

## 问题诊断

当前 `run_module_analysis()` 是纯串行的：一个模块的 `tool_call_loop` 跑完（平均 30 秒）才启动下一个。96 个模块 × 30 秒 ≈ 48 分钟，CPU 和网络大部分时间处于等待状态。

LLM API 调用是 I/O 密集型（等待 HTTP 响应），Python GIL 在 I/O 等待期间自动释放，多线程并发可以接近 async 的效果，同时无需改动 `LLMClient`、所有 Agent 和 `AIPipeline`。

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
        ├─ [不变] StructureIndexer.build_index()   ← 只读，天然线程安全
        │
        ├─ ConcurrencyController                    ← 新增，所有 Worker 共享
        │    ├─ _max_workers: int (初始=2，上限=5)
        │    ├─ _active_count: int                  ← 当前活跃 Worker 数
        │    ├─ _condition: threading.Condition     ← 替代 Semaphore，支持动态调整
        │    ├─ _is_backing_off: bool               ← 防多线程重复退避
        │    ├─ wait_to_start() → 阻塞直到有空闲 slot 且未暂停
        │    ├─ release()       → Worker 完成后释放 slot
        │    ├─ record_success() → 连续成功 N 次后升 max_workers
        │    └─ record_429()    → 只第一个线程执行退避，其余等待恢复
        │
        ├─ ThreadPoolExecutor(max_workers=MAX_POOL=8)  ← 固定大小线程池
        │    ├─ Worker-1: _run_agent_for_module(module_A)
        │    ├─ Worker-2: _run_agent_for_module(module_B)
        │    └─ ...（实际并发由 Controller 的 Condition 控制）
        │
        └─ 主线程 as_completed 循环
             ├─ 收集 Future 结果
             ├─ 串行写检查点（线程安全）
             └─ 扩展 all_nodes / all_edges
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
    - 控制实际并发度（动态升降 max_workers）
    - 协调 429 退避（防止多线程同时退避放大问题）
    - 提供 wait_to_start/release 替代 Semaphore
    """

    def __init__(
        self,
        initial_workers: int = 2,
        max_workers: int = 5,
        success_threshold: int = 3,    # 连续 N 次成功才升并发
        initial_backoff: float = 10.0, # 首次 429 等待秒数
        max_backoff: float = 300.0,    # 退避上限（5 分钟）
    ) -> None: ...

    def wait_to_start(self) -> None:
        """Worker 分析模块前调用。
        暂停期间或并发已满时阻塞，有空闲 slot 且未暂停时返回并占用一个 slot。
        """

    def release(self) -> None:
        """Worker 模块完成后调用（无论成功或失败）。释放 slot。"""

    def record_success(self) -> None:
        """Worker 模块成功完成后调用。连续成功 success_threshold 次则升并发。"""

    def record_429(self) -> None:
        """Worker 收到 429 时调用。
        第一个调用者执行退避逻辑；后续调用者直接返回（等 wait_to_start 阻塞即可）。
        """

    @property
    def current_workers(self) -> int:
        """当前生效的 max_workers 值（仅供日志/监控使用）。"""
```

#### 1.2 并发度动态调整（Condition 替代 Semaphore）

用 `threading.Condition + _active_count` 替代 `Semaphore`，使升降并发度真实生效：

```python
def wait_to_start(self) -> None:
    with self._condition:
        while self._active_count >= self._max_workers or self._paused:
            self._condition.wait()
        self._active_count += 1

def release(self) -> None:
    with self._condition:
        self._active_count -= 1
        self._condition.notify_all()   # 唤醒所有等待线程重新判断

# 升并发时：
with self._condition:
    self._max_workers = min(self._max_workers + 1, self._hard_max)
    self._condition.notify_all()       # 可能有等待线程能启动了

# 降并发时：
with self._condition:
    self._max_workers = max(self._max_workers - 1, 1)
    # 不需要 notify，下次 release 时自然生效
```

#### 1.3 429 退避防重入

`_is_backing_off` flag 确保只有第一个调用 `record_429()` 的线程执行退避，其余线程直接返回并在 `wait_to_start()` 中等待：

```python
def record_429(self) -> None:
    with self._lock:
        if self._is_backing_off:
            return                     # 已有线程在退避，我等着就好
        self._is_backing_off = True
        self._paused = True
        self._backoff_count += 1

    # 只有一个线程走到这里
    backoff_seconds = min(
        self._initial_backoff * (2 ** (self._backoff_count - 1)),
        self._max_backoff,
    )
    logger.warning("ConcurrencyController: 429 退避 %.0f 秒（第 %d 次）", backoff_seconds, self._backoff_count)
    time.sleep(backoff_seconds)

    with self._condition:
        self._is_backing_off = False
        self._paused = False
        self._max_workers = max(self._max_workers - 1, 1)
        self._condition.notify_all()   # 恢复，唤醒所有等待线程
```

#### 1.4 自适应并发规则

| 事件 | 触发条件 | 动作 |
|---|---|---|
| 升并发 | 连续 `success_threshold`（默认 3）次模块完成 | `max_workers = min(max_workers + 1, 5)` |
| 降并发 | 任意线程 record_429 | `max_workers = max(max_workers - 1, 1)` |
| 终止分析 | `max_workers == 1` 且退避次数 ≥ `RATE_LIMIT_MAX_PAUSES` | 触发 `PartialResultError` |

退避序列（initial_backoff=10s）：`10s → 20s → 40s → 80s → 160s → 300s（上限）`

---

### 二、run_module_analysis 并发改造

**修改文件**：`backend/agent/orchestrator.py`

#### 2.1 主循环改造（伪代码）

```python
def run_module_analysis(self, modules, repo_name=None):
    # --- 不变：StructureIndexer 构建（只读，线程安全）---
    self._build_structure_index()

    # --- 新增：初始化并发控制器 ---
    controller = ConcurrencyController(
        initial_workers=int(os.environ.get("CONCURRENT_WORKERS_INIT", "2")),
        max_workers=int(os.environ.get("CONCURRENT_WORKERS_MAX", "5")),
    )

    all_nodes, all_edges = [], []
    module_outputs = {}
    pending_modules = [m for m in modules if m.get("id") in pending_ids]

    with ThreadPoolExecutor(max_workers=MAX_POOL_SIZE) as executor:
        futures: dict[Future, dict] = {}

        for module in pending_modules:
            futures[executor.submit(self._run_module_worker, module, controller)] = module

        for future in as_completed(futures):
            module = futures[future]
            module_id = module.get("id")
            try:
                output = future.result()
                module_outputs[module_id] = output

                # 主线程串行写检查点（线程安全）
                if self.checkpoint_manager:
                    self._save_checkpoint(module, output)

                if output.status == "success":
                    all_nodes.extend(output.nodes)
                    all_edges.extend(output.edges)

            except RateLimitExhaustedError:
                # controller 已在 Worker 内处理退避
                # 达到退避次数上限时 Worker 抛出此异常
                raise PartialResultError(...)
            except Exception as e:
                logger.error("模块 %s 失败: %s", module_id, e)
```

#### 2.2 Worker 函数

```python
def _run_module_worker(self, module: dict, controller: ConcurrencyController) -> AgentOutput:
    """Worker 线程执行函数。"""
    controller.wait_to_start()    # 等待空闲 slot（并发已满时阻塞）
    try:
        output = self._run_agent_for_module(module)
        controller.record_success()
        return output
    except RateLimitExhaustedError:
        controller.record_429()   # 触发全局退避协调
        raise
    finally:
        controller.release()      # 释放 slot（无论成功或失败）
```

---

### 三、SharedKnowledgeBase 线程安全

**修改文件**：`backend/agent/context.py`

改动极小，新增两个写操作方法，加锁保护：

```python
class SharedKnowledgeBase:
    def __init__(self):
        self.modules: list = []
        self.layers: list = []
        self._lock = threading.Lock()   # 新增

    def add_module(self, module: dict) -> None:
        """线程安全地添加模块信息。"""
        with self._lock:
            self.modules.append(module)

    def add_layer(self, layer: dict) -> None:
        """线程安全地添加层信息。"""
        with self._lock:
            self.layers.append(layer)
```

读操作（Agent 分析时读取 `shared_knowledge.modules`）不加锁——并发下读到"部分已完成的模块列表"是可接受的，不影响正确性。

Agent 内部原有的直接 `.modules.append()` 调用需同步改为 `.add_module()`。

---

## 文件变更地图

| 文件 | 操作 | 核心改动 |
|---|---|---|
| `backend/agent/concurrency.py` | **新建** | `ConcurrencyController`，Condition + 防重入退避 |
| `backend/agent/orchestrator.py` | 修改 | `run_module_analysis` 改为 ThreadPoolExecutor + as_completed，主线程写检查点 |
| `backend/agent/context.py` | 修改 | `SharedKnowledgeBase` 新增 `add_module`/`add_layer`，加锁 |
| `backend/tests/test_concurrency_controller.py` | **新建** | Controller 单元测试（见下方） |
| `backend/tests/test_orchestrator_concurrent.py` | **新建** | 并发编排集成测试 |

**不需要改动**：`LLMClient`、所有 Agent（ArchitectureAgent 等）、`StructureIndexer`、`AIPipeline`、Celery tasks

---

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `CONCURRENT_WORKERS_INIT` | `2` | 初始并发度 |
| `CONCURRENT_WORKERS_MAX` | `5` | 并发度上限 |
| `RATE_LIMIT_MAX_PAUSES` | `3` | 最大退避次数，超过后触发 PartialResultError |
| `RATE_LIMIT_PAUSE_SECONDS` | `10` | 首次退避秒数（指数增长） |

---

## 测试策略

### 单元测试（`test_concurrency_controller.py`）

| 测试 | 验证内容 |
|---|---|
| `test_initial_state` | current_workers == initial_workers，active_count == 0 |
| `test_wait_to_start_blocks_at_capacity` | 并发已满时 wait_to_start 阻塞 |
| `test_release_unblocks_waiting_thread` | release 后阻塞的线程恢复 |
| `test_record_success_increases_workers_at_threshold` | 连续 3 次成功后 current_workers +1 |
| `test_workers_capped_at_max` | current_workers 不超过 hard_max |
| `test_record_429_pauses_all_threads` | record_429 后 wait_to_start 阻塞 |
| `test_record_429_only_one_thread_backs_off` | 多线程同时 record_429，只一个执行 sleep |
| `test_backoff_resumes_after_sleep` | 退避结束后 wait_to_start 恢复 |
| `test_max_workers_decreases_after_429` | 退避后 current_workers -1 |
| `test_backoff_exponential` | 退避时间按 2^n 增长 |
| `test_backoff_capped_at_max` | 退避时间不超过 max_backoff |

### 集成测试（`test_orchestrator_concurrent.py`）

| 测试 | 验证内容 |
|---|---|
| `test_all_modules_complete` | Mock LLM，5 个模块并发跑完，节点数正确合并 |
| `test_checkpoint_written_per_module` | 每个模块完成后主线程写检查点，顺序正确 |
| `test_429_triggers_backoff_and_continues` | 中途 429，退避后其余模块继续完成 |
| `test_shared_knowledge_thread_safe` | 多线程并发 add_module，无竞态，列表长度正确 |
| `test_partial_result_on_exhausted_429` | 超过最大退避次数触发 PartialResultError |

---

## 数据流总览

```
run_module_analysis(modules)
    │
    ├─ StructureIndexer.build_index()    # 主线程，一次性，只读
    │
    ├─ ConcurrencyController 初始化      # max_workers=2
    │
    └─ ThreadPoolExecutor
         ├─ Worker 1:
         │    controller.wait_to_start() # 等 slot
         │    _run_agent_for_module()    # LLM 调用
         │    controller.record_success() / record_429()
         │    controller.release()
         │
         ├─ Worker 2: （同上）
         │
         └─ 主线程 as_completed:
              ├─ future.result()         # 收集结果
              ├─ checkpoint_manager.save() # 串行写
              └─ all_nodes.extend()      # 合并图谱
```

---

## 第三期（后续）

- **跨模块知识聚合**：并发模式下模块间共享知识有限（各自跑 ArchitectureAgent），可在并发完成后增加一轮 CrossModuleAgent 串行聚合
- **动态模块优先级**：先跑"核心模块"（文件数多、被引用多的），让后续模块能借用共享知识
