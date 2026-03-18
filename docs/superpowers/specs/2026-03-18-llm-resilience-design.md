# LLM 弹性优化设计文档

**日期**：2026-03-18
**状态**：已批准
**涉及模块**：`backend/llm/client.py`、`backend/agent/orchestrator.py`、`backend/agent/checkpoint.py`（重构）、`backend/scheduler/tasks.py`

---

## 背景与问题

日志分析（`celery-worker-2026-03-18_11-51.log`）揭示以下问题：

1. **429 空转**：`tool_call_loop` 遇到 API 限速后每 1.6 秒盲目重试，持续 20 分钟，共触发 765 次错误，浪费大量时间与配额。
2. **串行无保护**：51 个模块完全串行处理，任意中断导致全部重来，无断点恢复机制（`orchestrator.py` 已有 `CheckpointManager` 但从未调用 `list_pending_modules()` 跳过已完成模块）。
3. **分析质量低**：MiniMax Token Plan 不支持真正的工具调用（`supports_tools` 被排除），Agent 无法执行 `read_file`/`search_code` 等工具，51 个模块仅产出 24 节点/120 边。
4. **无感知等待**：前端无法判断任务是死亡还是在等待限速恢复。

---

## 目标

- 消除 429 空转，通过指数退避节省 API 配额
- 每个模块完成后保存检查点，支持断点续跑
- 持续限速时先等待恢复，等不到则保存部分结果优雅退出
- 等待期间持续向前端发送心跳事件（分段睡眠，不阻塞）
- 接入 GLM-4（智谱 AI），支持原生工具调用，提升分析质量
- `completed_partial` 状态的图谱正确标记，避免增量更新误判为"已完成"

---

## 设计

### 1. 429 指数退避（`backend/llm/client.py`）

**新增异常类**：

```python
class RateLimitExhaustedError(Exception):
    """连续 429 超过退避阈值后抛出，由 Orchestrator 上层处理。"""
    pass
```

**`tool_call_loop` 错误处理**，在 while 循环外初始化计数器。关键点：在 `except Exception as e` 块内，先判断是否为 429，若是则直接 `raise RateLimitExhaustedError`——`raise` 会穿透当前 except 块向上传播，不会被自身吞掉：

```python
consecutive_429 = 0   # while 循环外初始化

while iterations < max_iterations:
    iterations += 1
    try:
        response = self._call_llm(...)
        consecutive_429 = 0   # 成功调用后重置
        ...
    except Exception as e:
        error_msg = str(e)

        # 上下文超限：立即返回，不重试（现有逻辑保留）
        if "context window" in error_msg.lower() or "max_tokens" in error_msg.lower():
            return ToolCallLoopResult(status="error", ...)

        # 429 限速：退避等待，超阈值则 raise 穿透出循环
        if _is_rate_limit_error(e):
            consecutive_429 += 1
            if consecutive_429 > RATE_LIMIT_MAX_CONSECUTIVE:
                raise RateLimitExhaustedError(
                    f"连续 {consecutive_429} 次 429，退出重试"
                )  # ← raise 穿透 except，传播给调用方 Agent
            wait = min(RATE_LIMIT_BASE_WAIT * (2 ** consecutive_429), RATE_LIMIT_MAX_WAIT)
            time.sleep(wait)
            iterations -= 1   # 等待不消耗迭代次数
            continue

        # 其他错误：重置计数器，继续迭代（现有行为）
        consecutive_429 = 0
        errors.append(f"迭代 {iterations} 出错: {error_msg}")
        continue
```

**传播路径**：`RateLimitExhaustedError` 从 `tool_call_loop` → Agent 的 `run()` → `Orchestrator.run_module_analysis()`。Orchestrator 需在 `run_module_analysis` 的 `for module in modules` 循环内，将原有的 `except Exception` 拆分为先捕获 `RateLimitExhaustedError`（见第 5 节）。

**退避等待时间**：

| 第 N 次 429 | 等待秒数 |
|------------|---------|
| 1 | 10s |
| 2 | 20s |
| 3 | 40s |
| 4 | 80s |
| 5 | 120s（上限） |
| > 5 | 抛出 `RateLimitExhaustedError` |

**429 判定函数**：

```python
def _is_rate_limit_error(e: Exception) -> bool:
    msg = str(e).lower()
    return "429" in msg or "rate_limit" in msg or "usage limit exceeded" in msg
```

---

### 2. GLM-4 Provider 支持（`backend/llm/client.py`）

**`_default_model()` 新增**：

```python
"zhipu": "glm-4-plus"
```

**`_get_client()` 新增分支**：

```python
elif self.provider == "zhipu":
    base_url = self.base_url or "https://open.bigmodel.cn/api/paas/v4/"
    self._client = openai.OpenAI(api_key=self.api_key, base_url=base_url)
```

GLM-4 的 `usage` 字段与 OpenAI 格式一致（`prompt_tokens` / `completion_tokens`），`extract_token_usage()` 无需修改。

**`supports_tools` 修正**（`ollama` 排除是因为本地模型通常不支持 function calling，原来代码有遗漏）：

```python
# 修改前
supports_tools = self.provider not in ("minimax",)

# 修改后
supports_tools = self.provider not in ("minimax", "ollama")
```

`zhipu` 支持原生工具调用，不在排除列表中。

**API 密钥环境变量**（`ai_analyze.py` `_create_llm_client` 中的读取顺序）：

```python
api_key = (
    os.environ.get("LLM_API_KEY") or       # 通用优先
    os.environ.get("ZHIPU_API_KEY") or      # 新增：zhipu 专用
    os.environ.get("ANTHROPIC_API_KEY") or
    os.environ.get("OPENAI_API_KEY") or
    os.environ.get("MINIMAX_API_KEY")
)
```

**推荐环境变量**：

```bash
LLM_PROVIDER=zhipu
LLM_MODEL=glm-4-plus
ZHIPU_API_KEY=your-zhipu-api-key
```

**GLM 模型选型**：

| 模型 | 适用场景 | 上下文窗口 |
|------|---------|-----------|
| `glm-4-plus` | 通用分析，均衡速度与质量（推荐） | 128K |
| `glm-4-long` | 大文件/大模块分析 | 1M |
| `glm-z1-flash` | 快速预扫描 | 128K |

---

### 3. CheckpointManager 重构（`backend/agent/checkpoint.py`）

现有 `CheckpointManager` 按模块粒度保存，接口设计已基本正确，需增加以下能力：

**现有接口保留**（按模块操作）：
```python
def save(self, checkpoint: ModuleCheckpoint) -> None
def load(self, module_id: str) -> ModuleCheckpoint | None
def list_completed_modules(self) -> list[str]
def list_pending_modules(self, all_modules: list[str]) -> list[str]
```

**新增仓库级接口**：

```python
def load_partial_results(self) -> tuple[list[GraphNode], list[GraphEdge]]:
    """从所有已完成模块的检查点中合并节点和边，用于 completed_partial 退出时。"""

def clear_all(self) -> None:
    """全部完成后清理所有模块检查点。"""
```

检查点文件路径保持现有设计：`data/checkpoints/{repo_name}/{module_id}.json`。

---

### 4. 断点续跑（`backend/agent/orchestrator.py`）

**改动位置**：`orchestrator.py` 的 `run_module_analysis()` 方法内部（不在 `AIPipeline` 层）。

在循环开始前调用 `list_pending_modules()`，将 `for i, module in enumerate(modules)` 替换为只遍历待完成模块：

```python
# run_module_analysis() 内，循环开始前
all_module_ids = [m.get("id", f"module_{i}") for i, m in enumerate(modules)]
pending_ids = set(self.checkpoint_manager.list_pending_modules(all_module_ids))

completed_count = len(all_module_ids) - len(pending_ids)
if completed_count > 0:
    logger.info("断点续跑：已完成 %d 个模块，从第 %d 个继续",
                completed_count, completed_count + 1)

# 遍历时跳过已完成模块（module_id 格式与 checkpoint 保存时一致：m.get("id", f"module_{i}")）
for i, module in enumerate(modules):
    module_id = module.get("id", f"module_{i}")
    if module_id not in pending_ids:
        continue   # 跳过已完成
    ...
    # 模块完成后保存检查点（现有逻辑已有，无需新增）
    self.checkpoint_manager.save(ModuleCheckpoint(module_id=module_id, ...))
```

全部完成后调用 `checkpoint_manager.clear()`（现有方法，清理当前仓库所有检查点文件，无需新增 `clear_all`）。

---

### 5. 持续限速检测 + 暂停策略（`backend/agent/orchestrator.py`）

**`run_module_analysis` 循环结构调整**（拆分 except，先捕获 `RateLimitExhaustedError`）：

```python
pause_count = 0

for i, module in enumerate(pending_modules):
    try:
        # 运行 ArchitectureAgent，内部调用 tool_call_loop
        output = self._run_agent_for_module(module)
        self.checkpoint_manager.save(ModuleCheckpoint(...))
    except RateLimitExhaustedError:
        pause_count += 1
        if pause_count > RATE_LIMIT_MAX_PAUSES:
            # 超过暂停上限，抛出 PartialResultError 由 tasks.py 处理
            raise PartialResultError(
                completed_count=i,
                total_count=len(modules),
            )
        # 分段睡眠等待
        pause_minutes = RATE_LIMIT_PAUSE_MINUTES * (2 ** (pause_count - 1))
        self._wait_with_heartbeat(pause_minutes)
        # 等待结束后重试同一个模块（i 不递进，通过 continue 重试当前模块）
        # 实现：用 while + 手动递进索引替代 for，或将此模块重新插入队列首部
    except Exception as e:
        logger.warning("模块 %s 分析失败，跳过: %s", module.get("id"), e)
        continue
```

**心跳分段睡眠实现**（不阻塞发送）：

```python
def _wait_with_heartbeat(self, total_minutes: int) -> None:
    interval = 120  # 每 2 分钟一次心跳
    elapsed = 0
    while elapsed < total_minutes * 60:
        time.sleep(min(interval, total_minutes * 60 - elapsed))
        elapsed += interval
        self._emit_progress("orchestrator", "rate_limited",
            f"等待 API 配额恢复，已等待 {elapsed // 60} 分钟...",
            extra={"wait_minutes": elapsed // 60})
```

**进度事件格式**：

```json
// 等待中（每 2 分钟一次）
{
  "status": "rate_limited",
  "stage": "orchestrator",
  "message": "等待 API 配额恢复，已等待 4 分钟...",
  "wait_minutes": 4
}

// 部分完成退出
{
  "status": "completed_partial",
  "stage": "completed",
  "completed_modules": 30,
  "total_modules": 51,
  "message": "已完成 30/51 个模块，因 API 持续限速保存部分结果",
  "graph_id": "adms",
  "node_count": 18,
  "edge_count": 90
}
```

---

### 6. tasks.py 改动（`backend/scheduler/tasks.py`）

**`PartialResultError` 定义**（在 `orchestrator.py` 中）：

```python
class PartialResultError(Exception):
    """持续限速导致提前退出，携带已完成模块数量信息。"""
    def __init__(self, completed_count: int, total_count: int):
        self.completed_count = completed_count
        self.total_count = total_count
        super().__init__(f"部分完成: {completed_count}/{total_count} 个模块")
```

**`tasks.py` 捕获 `PartialResultError`**（必须在通用 `except Exception` 之前）：

```python
from backend.agent.orchestrator import PartialResultError

# 在 except ValueError 之后、except Exception 之前新增：
except PartialResultError as exc:
    duration = round(time.time() - t_start, 3)

    # 从检查点合并已完成模块的节点/边，构建 BuiltGraph
    # checkpoint_manager 通过 pipeline._ai_pipeline.orchestrator 访问，
    # 或由 AnalysisPipeline.analyze() 在 PartialResultError 时返回部分 BuiltGraph
    # 实现方式：AnalysisPipeline.analyze() 捕获 PartialResultError，
    # 调用 checkpoint_manager.load_partial_results() 构建 BuiltGraph，
    # 然后走正常保存流程，最后 re-raise PartialResultError 附带 result
    # （详见第 3 节 CheckpointManager.load_partial_results()）

    # tasks.py 收到的 exc 已携带 result（由 pipeline 层附加）
    result = exc.result   # AnalysisResult，由 AnalysisPipeline 填充后 re-raise
    built = result.built
    built.meta["analysis_status"] = "partial"
    built.meta["completed_modules"] = exc.completed_count
    built.meta["total_modules"] = exc.total_count
    _graph_repo.save(built, repo_name=repo_name)   # 二次保存，写入 partial 标记

    on_progress_callback({
        "status": "completed_partial",
        "graph_id": result.graph_id,
        "node_count": result.node_count,
        "edge_count": result.edge_count,
        "completed_modules": exc.completed_count,
        "total_modules": exc.total_count,
        "elapsed_seconds": duration,
        "message": f"已完成 {exc.completed_count}/{exc.total_count} 个模块",
    })
    status_store.set_completed(repo_id, graph_id=result.graph_id,
                               node_count=result.node_count,
                               edge_count=result.edge_count,
                               duration_seconds=duration)
    return {"task_id": task_id, "status": "completed_partial",
            "graph_id": result.graph_id, "node_count": result.node_count,
            "edge_count": result.edge_count,
            "completed_modules": exc.completed_count,
            "total_modules": exc.total_count}
```

**调用链说明**：`PartialResultError` 在 Orchestrator 抛出 → `AnalysisPipeline.analyze()` 捕获 → 调用 `checkpoint_manager.load_partial_results()` 构建部分 `BuiltGraph` → 保存图谱（第一次 save）→ 将 `AnalysisResult` 附加到 exc → `re-raise PartialResultError` → `tasks.py` 捕获 → 写入 `analysis_status=partial` meta → 二次 save → 返回。

**`incremental_update` 识别不完整图谱**：

```python
prior = graph_repo.load(graph_id)
if prior and prior.meta.get("analysis_status") == "partial":
    logger.info("上次分析不完整（%s/%s 模块），强制重新分析",
                prior.meta.get("completed_modules"), prior.meta.get("total_modules"))
    reason = "incomplete_prior_analysis"
    # 走全量分析流程，不走 no_change 跳过逻辑
```

---

## 数据流

```
LLM 返回 429
  → tool_call_loop 指数退避（最多 5 次）
  → 超阈值 → RateLimitExhaustedError
  → Orchestrator 捕获 → 分段睡眠心跳等待
  → 等待超时（3 次）→ PartialResultError(nodes, edges)
  → tasks.py 捕获 → 保存 partial 图谱（meta.analysis_status=partial）
  → 前端收到 completed_partial 事件

重新提交同一仓库任务
  → CheckpointManager 发现已完成模块检查点
  → list_pending_modules() 过滤
  → 跳过已完成的 N 个模块，续跑剩余
  → 或：incremental_update 检测到 analysis_status=partial → 强制全量
```

---

## 改动文件清单

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `backend/llm/client.py` | 修改 | 429 退避（指数退避 + 计数器）、`RateLimitExhaustedError` 类、`_is_rate_limit_error()`、zhipu provider、`supports_tools` 修正 |
| `backend/agent/orchestrator.py` | 修改 | `run_module_analysis()` 内启用 `list_pending_modules()` 跳过逻辑、`RateLimitExhaustedError` 捕获（拆分 except）、暂停心跳 `_wait_with_heartbeat()`、`PartialResultError` 类定义及抛出 |
| `backend/agent/checkpoint.py` | 修改 | 新增 `load_partial_results()` 方法（合并已完成模块节点/边） |
| `backend/pipeline/ai_analyze.py` | 修改 | 捕获 `PartialResultError`、调用 `load_partial_results()` 构建部分 `BuiltGraph`、保存后 re-raise（附带 result）；新增 `ZHIPU_API_KEY` 读取 |
| `backend/scheduler/tasks.py` | 修改 | 捕获 `PartialResultError`（在 `except ValueError` 后、`except Exception` 前）、写入 `analysis_status=partial` meta、二次 save、`incremental_update` 识别不完整图谱强制重新分析 |

---

## 配置参数

| 环境变量 | 默认值 | 说明 |
|---------|-------|------|
| `RATE_LIMIT_MAX_CONSECUTIVE` | `5` | 连续 429 多少次触发 `RateLimitExhaustedError` |
| `RATE_LIMIT_BASE_WAIT_SECONDS` | `5` | 退避基础等待秒数 |
| `RATE_LIMIT_MAX_WAIT_SECONDS` | `120` | 退避最长等待秒数 |
| `RATE_LIMIT_PAUSE_MINUTES` | `10` | 持续限速时任务级初次暂停分钟数（第 N 次乘以 2）|
| `RATE_LIMIT_MAX_PAUSES` | `3` | 最多暂停次数，超过后保存部分结果退出 |
| `LLM_PROVIDER` | `anthropic` | LLM 提供商，推荐改为 `zhipu` |
| `ZHIPU_API_KEY` | — | 智谱 AI API 密钥 |
| `LLM_MODEL` | provider 默认值 | 模型名，zhipu 默认 `glm-4-plus` |

---

## 测试策略

**新增测试文件**：

| 测试文件 | 覆盖场景 |
|---------|---------|
| `backend/tests/test_llm_429_backoff.py` | mock LLM 返回 429，验证退避等待时间、计数器重置、`RateLimitExhaustedError` 触发 |
| `backend/tests/test_checkpoint_resume.py` | 模拟中途失败后重新提交，验证跳过已完成模块逻辑 |
| `backend/tests/test_partial_result.py` | 验证 `completed_partial` 图谱的 meta 标记、`incremental_update` 强制重分析 |
| `backend/tests/test_zhipu_provider.py` | 验证 zhipu provider 初始化、工具调用支持、token 计数 |

---

## 回滚方案

- **切回 MiniMax**：修改 `LLM_PROVIDER=minimax`，无需改代码
- **禁用退避退出**：将 `RATE_LIMIT_MAX_PAUSES` 设为很大值（如 `999`），任务会持续等待而不保存部分结果退出
- **禁用断点续跑**：删除 `data/checkpoints/{repo_name}/` 目录，下次任务强制全量分析

---

## 不在本期范围内

- 模块并行处理（MiniMax/GLM Token Plan 并发受限，意义不大）
- AST 静态分析降级（可作为后续迭代）
- LLM 调用优先级队列
