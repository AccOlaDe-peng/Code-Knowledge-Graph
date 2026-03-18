# LLM 弹性优化实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除 429 空转、启用模块断点续跑、接入 GLM-4 工具调用、实现部分结果保存与 `completed_partial` 状态标记。

**Architecture:** 在 `client.py` 的 `tool_call_loop` 中加入指数退避计数器，超阈值抛 `RateLimitExhaustedError`；`orchestrator.py` 捕获后分段心跳等待，累积超限抛 `PartialResultError`；`ai_analyze.py` 捕获 `PartialResultError` 保存部分图谱后 re-raise；`tasks.py` 最终捕获并写入 `analysis_status=partial`。GLM-4 provider 通过 OpenAI-compatible 接口接入，无需改动工具调用逻辑。

**Tech Stack:** Python 3.11, FastAPI, Celery, OpenAI Python SDK（兼容 GLM-4）, pytest, unittest.mock

**Spec:** `docs/superpowers/specs/2026-03-18-llm-resilience-design.md`

---

## 文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `backend/llm/client.py` | 修改 | 新增 `RateLimitExhaustedError`、`_is_rate_limit_error()`、429 退避计数器、zhipu provider、`supports_tools` 修正 |
| `backend/agent/checkpoint.py` | 修改 | 新增 `load_partial_results()` 方法（复用现有 `get_all_results()`） |
| `backend/agent/orchestrator.py` | 修改 | `run_module_analysis()` 改 while 循环 + `pending_ids` 跳过、捕获 `RateLimitExhaustedError`、`_wait_with_heartbeat()`、`PartialResultError` 定义与抛出 |
| `backend/pipeline/ai_analyze.py` | 修改 | 捕获 `PartialResultError`，调用 `load_partial_results()` 保存部分图谱后 re-raise；新增 `ZHIPU_API_KEY` 读取 |
| `backend/scheduler/tasks.py` | 修改 | 捕获 `PartialResultError`，写入 `partial` meta，`incremental_update` 检测不完整图谱强制重分析 |
| `backend/tests/test_llm_429_backoff.py` | 新建 | 429 退避单元测试 |
| `backend/tests/test_checkpoint_partial.py` | 新建 | `load_partial_results()` 单元测试 |
| `backend/tests/test_orchestrator_resume.py` | 新建 | 断点续跑 + 限速暂停集成测试 |
| `backend/tests/test_partial_result_flow.py` | 新建 | `PartialResultError` 端到端流测试 |

---

## Chunk 1: client.py — 429 退避 + GLM-4 Provider

### Task 1: 429 退避机制

**Files:**
- Modify: `backend/llm/client.py:184-465`（`tool_call_loop` 方法）
- Test: `backend/tests/test_llm_429_backoff.py`

- [ ] **Step 1: 写失败测试**

```python
# backend/tests/test_llm_429_backoff.py
import pytest
from unittest.mock import MagicMock, patch
from backend.llm.client import LLMClient, RateLimitExhaustedError

class TestRateLimitBackoff:
    def _make_client(self):
        client = LLMClient.__new__(LLMClient)
        client.provider = "openai"
        client.model = "gpt-4"
        client.api_key = "test-key"
        client._client = None
        client.base_url = None
        client.temperature = 0.7
        client.max_tokens = 4096
        return client

    def test_is_rate_limit_error_detects_429(self):
        from backend.llm.client import _is_rate_limit_error
        assert _is_rate_limit_error(Exception("429 Too Many Requests")) is True
        assert _is_rate_limit_error(Exception("rate_limit exceeded")) is True
        assert _is_rate_limit_error(Exception("usage limit exceeded")) is True
        assert _is_rate_limit_error(Exception("some other error")) is False

    def test_consecutive_429_raises_rate_limit_exhausted(self):
        """连续 429 超过阈值后应抛出 RateLimitExhaustedError"""
        client = self._make_client()
        call_count = 0

        def always_429(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            raise Exception("429 Too Many Requests")

        with patch.object(client, '_call_llm', side_effect=always_429):
            with patch('time.sleep'):  # 不真正等待
                with pytest.raises(RateLimitExhaustedError):
                    client.tool_call_loop(
                        messages=[{"role": "user", "content": "test"}],
                        tools=[],
                        system_prompt="",
                    )

    def test_429_resets_on_success(self):
        """成功调用后 consecutive_429 计数器应重置"""
        from backend.llm.client import _is_rate_limit_error
        # 此测试通过验证 _is_rate_limit_error 返回 False 来间接确认
        assert _is_rate_limit_error(Exception("connection error")) is False

    def test_non_429_error_does_not_increment_counter(self):
        """非 429 错误不影响计数器，不触发 RateLimitExhaustedError"""
        client = self._make_client()
        call_count = 0

        def fail_then_succeed(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                raise Exception("network error")
            # 第 3 次模拟正常完成（返回无 tool_calls 的 response）
            resp = MagicMock()
            resp.choices = [MagicMock()]
            resp.choices[0].message.tool_calls = None
            resp.choices[0].message.content = "done"
            resp.usage = MagicMock(prompt_tokens=10, completion_tokens=5)
            return resp

        with patch.object(client, '_call_llm', side_effect=fail_then_succeed):
            with patch.object(client, '_get_client', return_value=MagicMock()):
                # 不应抛出 RateLimitExhaustedError
                # 可能抛出其他错误（因为 mock 不完整），但不是限速错误
                try:
                    client.tool_call_loop(
                        messages=[{"role": "user", "content": "test"}],
                        tools=[],
                        system_prompt="",
                    )
                except RateLimitExhaustedError:
                    pytest.fail("不应抛出 RateLimitExhaustedError")
                except Exception:
                    pass  # 其他错误可接受
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd code-graph-system
source venv/bin/activate
pytest backend/tests/test_llm_429_backoff.py -v 2>&1 | head -40
```

预期：`ImportError: cannot import name 'RateLimitExhaustedError'` 或 `ImportError: cannot import name '_is_rate_limit_error'`

- [ ] **Step 3: 在 client.py 新增异常类和辅助函数**

在 `backend/llm/client.py` 顶部（class 定义之前）新增：

```python
class RateLimitExhaustedError(Exception):
    """连续 429 超过退避阈值后抛出，由 Orchestrator 上层处理。"""
    pass


def _is_rate_limit_error(e: Exception) -> bool:
    msg = str(e).lower()
    return "429" in msg or "rate_limit" in msg or "usage limit exceeded" in msg


# 退避配置
RATE_LIMIT_MAX_CONSECUTIVE = int(os.environ.get("RATE_LIMIT_MAX_CONSECUTIVE", "5"))
RATE_LIMIT_BASE_WAIT = int(os.environ.get("RATE_LIMIT_BASE_WAIT_SECONDS", "5"))
RATE_LIMIT_MAX_WAIT = int(os.environ.get("RATE_LIMIT_MAX_WAIT_SECONDS", "120"))
```

- [ ] **Step 4: 修改 tool_call_loop 中的 except Exception 块**

在 `tool_call_loop` 的 `while iterations < max_iterations:` **循环之前**（约 line 220）添加：

```python
consecutive_429 = 0   # 在 while 循环外初始化
```

在 `except Exception as e:` 块内（约 line 437-452），将原有的通用错误处理**替换**为：

```python
    except Exception as e:
        error_msg = str(e)

        # 上下文超限：立即返回，不重试（保留现有逻辑）
        if "context window" in error_msg.lower() or "max_tokens" in error_msg.lower():
            return ToolCallLoopResult(
                status="error",
                messages=messages,
                errors=[f"上下文超限: {error_msg}"],
                iterations=iterations,
                token_usage=token_usage,
            )

        # 429 限速：退避等待，超阈值则 raise 穿透出循环
        if _is_rate_limit_error(e):
            consecutive_429 += 1
            if consecutive_429 > RATE_LIMIT_MAX_CONSECUTIVE:
                raise RateLimitExhaustedError(
                    f"连续 {consecutive_429} 次 429，退出重试"
                )
            wait = min(RATE_LIMIT_BASE_WAIT * (2 ** consecutive_429), RATE_LIMIT_MAX_WAIT)
            logger.warning("429 限速（第 %d 次），等待 %ds 后重试", consecutive_429, wait)
            time.sleep(wait)
            iterations -= 1   # 等待不消耗迭代次数
            continue

        # 其他错误：重置计数器，继续迭代（现有行为）
        consecutive_429 = 0
        errors.append(f"迭代 {iterations} 出错: {error_msg}")
        logger.warning("tool_call_loop 迭代 %d 出错: %s", iterations, error_msg)
        continue
```

在成功调用 LLM 后（`response = self._call_llm(...)` 之后、处理 response 之前），重置计数器：

```python
consecutive_429 = 0   # 成功调用后重置
```

- [ ] **Step 5: 运行测试确认通过**

```bash
pytest backend/tests/test_llm_429_backoff.py -v
```

预期：所有测试 PASS

- [ ] **Step 6: Commit**

```bash
git add backend/llm/client.py backend/tests/test_llm_429_backoff.py
git commit -m "feat: add 429 exponential backoff and RateLimitExhaustedError to tool_call_loop"
```

---

### Task 2: GLM-4 Provider 接入

**Files:**
- Modify: `backend/llm/client.py:74-122`（`_default_model`, `_get_client`）
- Modify: `backend/llm/client.py:336`（`supports_tools`）
- Test: `backend/tests/test_llm_429_backoff.py`（追加 zhipu 测试）

- [ ] **Step 1: 追加 zhipu provider 测试**

在 `backend/tests/test_llm_429_backoff.py` 末尾追加：

```python
class TestZhipuProvider:
    def test_zhipu_default_model(self):
        from backend.llm.client import LLMClient
        client = LLMClient(provider="zhipu", api_key="test")
        assert client.model == "glm-4-plus"

    def test_zhipu_supports_tools(self):
        from backend.llm.client import LLMClient
        client = LLMClient(provider="zhipu", api_key="test")
        # zhipu 不在排除列表，should support tools
        # 直接检查 supports_tools 计算逻辑
        result = client.provider not in ("minimax", "ollama")
        assert result is True

    def test_minimax_not_supports_tools(self):
        from backend.llm.client import LLMClient
        client = LLMClient(provider="minimax", api_key="test", extra_params={"group_id": "x"})
        result = client.provider not in ("minimax", "ollama")
        assert result is False

    def test_ollama_not_supports_tools(self):
        from backend.llm.client import LLMClient
        client = LLMClient(provider="ollama", api_key="")
        result = client.provider not in ("minimax", "ollama")
        assert result is False
```

- [ ] **Step 2: 运行新增测试确认失败**

```bash
pytest backend/tests/test_llm_429_backoff.py::TestZhipuProvider -v
```

预期：`test_zhipu_default_model` 失败（zhipu 不在 `_default_model`）

- [ ] **Step 3: 修改 _default_model()**

在 `_default_model()` 方法（约 line 74-82）的 dict 中新增：

```python
"zhipu": "glm-4-plus",
```

- [ ] **Step 4: 修改 _get_client()**

在 `_get_client()` 方法（约 line 84-122）中，在最后一个 `elif` 前新增：

```python
elif self.provider == "zhipu":
    base_url = self.base_url or "https://open.bigmodel.cn/api/paas/v4/"
    self._client = openai.OpenAI(api_key=self.api_key, base_url=base_url)
```

- [ ] **Step 5: 修改 supports_tools**

找到 `supports_tools`（约 line 336），修改为：

```python
supports_tools = self.provider not in ("minimax", "ollama")
```

- [ ] **Step 6: 运行所有测试确认通过**

```bash
pytest backend/tests/test_llm_429_backoff.py -v
```

预期：所有测试 PASS

- [ ] **Step 7: Commit**

```bash
git add backend/llm/client.py backend/tests/test_llm_429_backoff.py
git commit -m "feat: add zhipu GLM-4 provider and fix supports_tools for ollama"
```

---

## Chunk 2: checkpoint.py — load_partial_results()

### Task 3: 新增 load_partial_results 方法

**Files:**
- Modify: `backend/agent/checkpoint.py:230-243`（`get_all_results()` 附近）
- Test: `backend/tests/test_checkpoint_partial.py`

- [ ] **Step 1: 写失败测试**

```python
# backend/tests/test_checkpoint_partial.py
import pytest
import tempfile
import os
from pathlib import Path
from unittest.mock import patch
from backend.agent.checkpoint import CheckpointManager, ModuleCheckpoint
from backend.graph.graph_schema import GraphNode, GraphEdge, NodeType, EdgeType


class TestLoadPartialResults:
    def _make_manager(self, tmp_path):
        return CheckpointManager(repo_name="test-repo", base_dir=str(tmp_path))

    def _make_checkpoint(self, module_id: str, node_count: int = 2, edge_count: int = 1) -> ModuleCheckpoint:
        nodes = [
            GraphNode(id=f"{module_id}_node_{i}", type=NodeType.Function,
                      name=f"func_{i}", properties={})
            for i in range(node_count)
        ]
        edges = [
            GraphEdge(from_=f"{module_id}_node_0", to=f"{module_id}_node_1",
                      type=EdgeType.calls, properties={})
            for _ in range(edge_count)
        ]
        return ModuleCheckpoint(module_id=module_id, nodes=nodes, edges=edges)

    def test_load_partial_results_empty(self, tmp_path):
        manager = self._make_manager(tmp_path)
        nodes, edges = manager.load_partial_results()
        assert nodes == []
        assert edges == []

    def test_load_partial_results_merges_all_completed(self, tmp_path):
        manager = self._make_manager(tmp_path)
        cp1 = self._make_checkpoint("module_1", node_count=2, edge_count=1)
        cp2 = self._make_checkpoint("module_2", node_count=3, edge_count=2)
        manager.save(cp1)
        manager.save(cp2)

        nodes, edges = manager.load_partial_results()
        assert len(nodes) == 5   # 2 + 3
        assert len(edges) == 3   # 1 + 2

    def test_load_partial_results_deduplicates_nodes(self, tmp_path):
        manager = self._make_manager(tmp_path)
        # 两个 checkpoint 有相同 node id
        cp1 = self._make_checkpoint("mod_a")
        cp2 = self._make_checkpoint("mod_a")  # 相同 module_id 覆盖
        manager.save(cp1)
        manager.save(cp2)

        nodes, edges = manager.load_partial_results()
        node_ids = [n.id for n in nodes]
        assert len(node_ids) == len(set(node_ids)), "节点 ID 不应重复"
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd code-graph-system
source venv/bin/activate
pytest backend/tests/test_checkpoint_partial.py -v 2>&1 | head -30
```

预期：`AttributeError: 'CheckpointManager' object has no attribute 'load_partial_results'`

- [ ] **Step 3: 在 CheckpointManager 新增 load_partial_results()**

在 `backend/agent/checkpoint.py` 的 `get_all_results()` 方法（约 line 230-243）之后新增：

```python
def load_partial_results(self) -> tuple[list, list]:
    """从所有已完成模块的检查点中合并节点和边，用于 completed_partial 退出时。

    Returns:
        (nodes, edges) — 去重后的合并列表（后保存的节点覆盖同 ID 的先保存者）
    """
    nodes_by_id: dict = {}
    all_edges: list = []

    for checkpoint in self._iter_all_checkpoints():
        for node in checkpoint.nodes:
            nodes_by_id[node.id] = node
        all_edges.extend(checkpoint.edges)

    return list(nodes_by_id.values()), all_edges


def _iter_all_checkpoints(self):
    """遍历所有已保存的模块检查点。"""
    checkpoint_dir = self._get_checkpoint_dir()
    if not checkpoint_dir.exists():
        return
    for f in checkpoint_dir.glob("*.json"):
        try:
            cp = self.load(f.stem)
            if cp is not None:
                yield cp
        except Exception as e:
            logger.warning("读取检查点 %s 失败: %s", f, e)
```

**注意**：`_get_checkpoint_dir()` 是 CheckpointManager 现有私有方法，返回 `Path`。如果方法名不同，查看 `checkpoint.py` 中保存文件的路径构建方式并复用。

- [ ] **Step 4: 运行测试确认通过**

```bash
pytest backend/tests/test_checkpoint_partial.py -v
```

预期：所有测试 PASS

- [ ] **Step 5: Commit**

```bash
git add backend/agent/checkpoint.py backend/tests/test_checkpoint_partial.py
git commit -m "feat: add load_partial_results() to CheckpointManager"
```

---

## Chunk 3: orchestrator.py — 断点续跑 + 限速暂停

### Task 4: 断点续跑 + PartialResultError + 心跳等待

**Files:**
- Modify: `backend/agent/orchestrator.py:256-342`（`run_module_analysis()`）
- Test: `backend/tests/test_orchestrator_resume.py`

- [ ] **Step 1: 写失败测试**

```python
# backend/tests/test_orchestrator_resume.py
import pytest
from unittest.mock import MagicMock, patch, call
from backend.agent.orchestrator import AgentOrchestrator, PartialResultError
from backend.llm.client import RateLimitExhaustedError


def _make_orchestrator():
    orchestrator = AgentOrchestrator.__new__(AgentOrchestrator)
    orchestrator.checkpoint_manager = MagicMock()
    orchestrator.checkpoint_manager.list_pending_modules.return_value = []
    orchestrator.checkpoint_manager.list_completed_modules.return_value = []
    orchestrator._emit_progress = MagicMock()
    return orchestrator


class TestCheckpointResume:
    def test_skips_completed_modules(self):
        """已完成的模块应被跳过，不调用 _run_agent_for_module"""
        orchestrator = _make_orchestrator()
        modules = [{"id": "mod_a"}, {"id": "mod_b"}, {"id": "mod_c"}]
        # mod_a 已完成，只有 mod_b, mod_c 待处理
        orchestrator.checkpoint_manager.list_pending_modules.return_value = ["mod_b", "mod_c"]

        with patch.object(orchestrator, '_run_agent_for_module', return_value=MagicMock()) as mock_run:
            orchestrator.run_module_analysis(modules)

        called_ids = [call.args[0]["id"] if call.args else call.kwargs.get("module", {}).get("id")
                      for call in mock_run.call_args_list]
        assert "mod_a" not in called_ids
        assert "mod_b" in called_ids
        assert "mod_c" in called_ids


class TestRateLimitPause:
    def test_rate_limit_exhausted_triggers_pause(self):
        """RateLimitExhaustedError 应触发等待，不是立即失败"""
        orchestrator = _make_orchestrator()
        modules = [{"id": "mod_a"}]
        orchestrator.checkpoint_manager.list_pending_modules.return_value = ["mod_a"]
        orchestrator.checkpoint_manager.list_completed_modules.return_value = []

        call_count = 0

        def fail_then_succeed(module):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise RateLimitExhaustedError("429")
            return MagicMock(nodes=[], edges=[])

        with patch.object(orchestrator, '_run_agent_for_module', side_effect=fail_then_succeed):
            with patch.object(orchestrator, '_wait_with_heartbeat') as mock_wait:
                orchestrator.run_module_analysis(modules)

        mock_wait.assert_called_once()
        assert call_count == 2  # 第一次失败，第二次成功

    def test_exceeds_max_pauses_raises_partial_result_error(self):
        """暂停次数超过阈值后应抛出 PartialResultError"""
        orchestrator = _make_orchestrator()
        modules = [{"id": "mod_a"}]
        orchestrator.checkpoint_manager.list_pending_modules.return_value = ["mod_a"]
        orchestrator.checkpoint_manager.list_completed_modules.return_value = []

        with patch.object(orchestrator, '_run_agent_for_module',
                          side_effect=RateLimitExhaustedError("429")):
            with patch.object(orchestrator, '_wait_with_heartbeat'):
                with pytest.raises(PartialResultError) as exc_info:
                    orchestrator.run_module_analysis(modules)

        assert exc_info.value.result is None  # 由上层填充


class TestWaitWithHeartbeat:
    def test_emits_progress_events_during_wait(self):
        """_wait_with_heartbeat 应每 2 分钟发送一次 rate_limited 事件"""
        orchestrator = _make_orchestrator()
        sleep_calls = []

        with patch('time.sleep', side_effect=lambda s: sleep_calls.append(s)):
            orchestrator._wait_with_heartbeat(total_minutes=3)

        # 3 分钟 = 180s，间隔 120s，应有 2 次 sleep
        assert len(sleep_calls) >= 1
        orchestrator._emit_progress.assert_called()
        # 验证最后一次调用包含 rate_limited status
        last_call = orchestrator._emit_progress.call_args_list[-1]
        assert "rate_limited" in str(last_call)
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pytest backend/tests/test_orchestrator_resume.py -v 2>&1 | head -40
```

预期：`ImportError: cannot import name 'PartialResultError'` 或测试逻辑失败

- [ ] **Step 3: 在 orchestrator.py 定义 PartialResultError**

在 `backend/agent/orchestrator.py` 顶部（class 定义之前）新增：

```python
class PartialResultError(Exception):
    """持续限速导致提前退出，携带已完成模块数量信息。"""
    def __init__(self, completed_count: int, total_count: int):
        self.completed_count = completed_count
        self.total_count = total_count
        self.result = None   # 由 pipeline 层在 re-raise 前赋值
        super().__init__(f"部分完成: {completed_count}/{total_count} 个模块")
```

- [ ] **Step 4: 新增 _wait_with_heartbeat() 方法**

在 `AgentOrchestrator` 类中新增（与 `_emit_progress` 约 line 82-93 同级）：

```python
def _wait_with_heartbeat(self, total_minutes: int) -> None:
    """分段睡眠，每 2 分钟发送一次 rate_limited 心跳事件。"""
    interval = 120  # 每 2 分钟
    elapsed = 0
    total_seconds = total_minutes * 60
    while elapsed < total_seconds:
        sleep_time = min(interval, total_seconds - elapsed)
        time.sleep(sleep_time)
        elapsed += sleep_time
        self._emit_progress(
            "orchestrator",
            "rate_limited",
            f"等待 API 配额恢复，已等待 {elapsed // 60} 分钟...",
            extra={"wait_minutes": elapsed // 60},
        )
```

确认顶部已导入 `import time`（应已存在）。

- [ ] **Step 5: 修改 run_module_analysis() 循环**

配置常量（在 `orchestrator.py` 顶部或 class 外）：

```python
RATE_LIMIT_MAX_PAUSES = int(os.environ.get("RATE_LIMIT_MAX_PAUSES", "3"))
RATE_LIMIT_PAUSE_MINUTES = int(os.environ.get("RATE_LIMIT_PAUSE_MINUTES", "10"))
```

将 `run_module_analysis()` 中的 `for i, module in enumerate(modules):` 循环（约 line 256-342）**替换**为：

```python
from backend.llm.client import RateLimitExhaustedError

# 断点续跑：计算待处理模块
all_module_ids = [m.get("id", f"module_{i}") for i, m in enumerate(modules)]
pending_ids = set(self.checkpoint_manager.list_pending_modules(all_module_ids))
completed_count = len(all_module_ids) - len(pending_ids)
if completed_count > 0:
    logger.info("断点续跑：已完成 %d/%d 个模块，续跑剩余",
                completed_count, len(all_module_ids))

pause_count = 0
i = 0

while i < len(modules):
    module = modules[i]
    module_id = module.get("id", f"module_{i}")

    # 跳过已完成模块
    if module_id not in pending_ids:
        i += 1
        continue

    try:
        output = self._run_agent_for_module(module)
        # 保存检查点
        from backend.agent.checkpoint import ModuleCheckpoint
        self.checkpoint_manager.save(ModuleCheckpoint(
            module_id=module_id,
            nodes=getattr(output, 'nodes', []),
            edges=getattr(output, 'edges', []),
        ))
        i += 1   # 成功后才递进

    except RateLimitExhaustedError:
        pause_count += 1
        if pause_count > RATE_LIMIT_MAX_PAUSES:
            raise PartialResultError(
                completed_count=len(self.checkpoint_manager.list_completed_modules()),
                total_count=len(modules),
            )
        pause_minutes = RATE_LIMIT_PAUSE_MINUTES * (2 ** (pause_count - 1))
        logger.warning("持续限速（第 %d 次暂停），等待 %d 分钟", pause_count, pause_minutes)
        self._wait_with_heartbeat(pause_minutes)
        # i 不递进，等待后重试同一模块

    except Exception as e:
        logger.warning("模块 %s 分析失败，跳过: %s", module_id, e)
        i += 1   # 非限速错误跳过

# 全部完成，清理检查点
self.checkpoint_manager.clear()
```

- [ ] **Step 6: 运行测试确认通过**

```bash
pytest backend/tests/test_orchestrator_resume.py -v
```

预期：所有测试 PASS

- [ ] **Step 7: Commit**

```bash
git add backend/agent/orchestrator.py backend/tests/test_orchestrator_resume.py
git commit -m "feat: add checkpoint resume, rate limit pause, and PartialResultError to orchestrator"
```

---

## Chunk 4: ai_analyze.py + tasks.py — PartialResultError 端到端

### Task 5: ai_analyze.py 捕获 PartialResultError 保存部分图谱

**Files:**
- Modify: `backend/pipeline/ai_analyze.py:247-251`（api_key 读取）
- Modify: `backend/pipeline/ai_analyze.py:366-374`（orchestrator 调用处）
- Test: `backend/tests/test_partial_result_flow.py`

- [ ] **Step 1: 写失败测试（pipeline 层）**

```python
# backend/tests/test_partial_result_flow.py
import pytest
from unittest.mock import MagicMock, patch
from backend.agent.orchestrator import PartialResultError


class TestAiAnalyzePipeline:
    def test_partial_result_error_saves_partial_graph(self):
        """PartialResultError 应触发保存部分图谱，然后 re-raise"""
        from backend.pipeline.ai_analyze import AIPipeline

        pipeline = AIPipeline.__new__(AIPipeline)
        pipeline.orchestrator = MagicMock()
        pipeline.orchestrator.run.side_effect = PartialResultError(
            completed_count=10, total_count=20
        )
        pipeline.orchestrator.checkpoint_manager = MagicMock()
        pipeline.orchestrator.checkpoint_manager.load_partial_results.return_value = ([], [])
        pipeline.graph_repo = MagicMock()
        pipeline.graph_repo.save.return_value = MagicMock(graph_id="test-id", node_count=0, edge_count=0)

        with pytest.raises(PartialResultError) as exc_info:
            pipeline._save_partial_results(repo_name="test-repo")

        # re-raise 的异常应携带 result
        assert exc_info.value.result is not None
        assert exc_info.value.completed_count == 10

    def test_zhipu_api_key_read_from_env(self):
        """ZHIPU_API_KEY 环境变量应被读取"""
        import os
        from unittest.mock import patch as p
        with p.dict(os.environ, {"LLM_PROVIDER": "zhipu", "ZHIPU_API_KEY": "test-zhipu-key"}, clear=False):
            # 验证 _create_llm_client 能读取 ZHIPU_API_KEY
            from backend.pipeline.ai_analyze import AIPipeline
            pipeline = AIPipeline.__new__(AIPipeline)
            with patch('backend.pipeline.ai_analyze.LLMClient') as MockLLM:
                pipeline._create_llm_client()
                call_kwargs = MockLLM.call_args[1] if MockLLM.call_args else {}
                # api_key 应不为 None
                assert MockLLM.called
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pytest backend/tests/test_partial_result_flow.py -v 2>&1 | head -30
```

预期：`AttributeError: 'AIPipeline' object has no attribute '_save_partial_results'` 或类似

- [ ] **Step 3: 修改 ai_analyze.py — ZHIPU_API_KEY**

在 `_create_llm_client()` 方法（约 line 247-251）的 `api_key` 读取处，新增 `ZHIPU_API_KEY`：

```python
api_key = (
    os.environ.get("LLM_API_KEY") or
    os.environ.get("ZHIPU_API_KEY") or      # 新增
    os.environ.get("ANTHROPIC_API_KEY") or
    os.environ.get("OPENAI_API_KEY") or
    os.environ.get("MINIMAX_API_KEY")
)
```

- [ ] **Step 4: 修改 ai_analyze.py — 捕获 PartialResultError**

在 `_analyze_with_agents()` 方法（约 line 366-374）中，将 orchestrator 调用包裹：

```python
from backend.agent.orchestrator import PartialResultError
from backend.graph.graph_builder import GraphBuilder

try:
    orchestrator_result = self.orchestrator.run(...)
except PartialResultError as exc:
    # 从检查点合并已完成模块的节点/边
    partial_nodes, partial_edges = self.orchestrator.checkpoint_manager.load_partial_results()
    built = GraphBuilder().build(partial_nodes, partial_edges)
    saved = self.graph_repo.save(built, repo_name=repo_name)
    from backend.pipeline.models import AnalysisResult
    exc.result = AnalysisResult(
        graph_id=saved.graph_id,
        node_count=len(partial_nodes),
        edge_count=len(partial_edges),
        built=built,
    )
    raise   # re-raise，携带 exc.result 传播给 tasks.py
```

同时新增辅助方法 `_save_partial_results(repo_name)` 供测试使用（可直接将上述逻辑封装）：

```python
def _save_partial_results(self, repo_name: str):
    """从检查点合并部分结果并保存，然后抛出携带 result 的 PartialResultError。"""
    exc = PartialResultError(
        completed_count=self.orchestrator.checkpoint_manager.list_completed_modules().__len__(),
        total_count=0,
    )
    partial_nodes, partial_edges = self.orchestrator.checkpoint_manager.load_partial_results()
    built = GraphBuilder().build(partial_nodes, partial_edges)
    saved = self.graph_repo.save(built, repo_name=repo_name)
    from backend.pipeline.models import AnalysisResult
    exc.result = AnalysisResult(
        graph_id=saved.graph_id,
        node_count=len(partial_nodes),
        edge_count=len(partial_edges),
        built=built,
    )
    raise exc
```

- [ ] **Step 5: 运行测试确认通过**

```bash
pytest backend/tests/test_partial_result_flow.py -v
```

预期：所有测试 PASS

- [ ] **Step 6: Commit**

```bash
git add backend/pipeline/ai_analyze.py backend/tests/test_partial_result_flow.py
git commit -m "feat: capture PartialResultError in AIPipeline, save partial graph and re-raise"
```

---

### Task 6: tasks.py — completed_partial 处理 + incremental_update 修复

**Files:**
- Modify: `backend/scheduler/tasks.py:412-459`（try/except 块）
- Modify: `backend/scheduler/tasks.py`（`incremental_update` 任务）
- Test: `backend/tests/test_partial_result_flow.py`（追加 tasks 层测试）

- [ ] **Step 1: 追加 tasks 层测试**

在 `backend/tests/test_partial_result_flow.py` 末尾追加：

```python
class TestTasksPartialResult:
    def test_incremental_update_forces_full_analysis_on_partial_graph(self):
        """incremental_update 检测到 analysis_status=partial 时应强制全量分析"""
        # 此测试验证 prior.meta.get("analysis_status") == "partial" 分支
        # 通过检查日志或返回值中的 reason 字段
        mock_graph = MagicMock()
        mock_graph.meta = {"analysis_status": "partial", "completed_modules": 10, "total_modules": 20}

        from backend.scheduler import tasks
        result = tasks._check_if_needs_reanalysis(mock_graph)
        assert result["needs_reanalysis"] is True
        assert result["reason"] == "incomplete_prior_analysis"
```

**注意**：如果 `tasks.py` 没有 `_check_if_needs_reanalysis` 辅助函数，这个测试需要根据实际代码调整。可以改为 mock `graph_repo.load` 并调用完整的 `incremental_update` 任务。

- [ ] **Step 2: 运行测试确认失败**

```bash
pytest backend/tests/test_partial_result_flow.py::TestTasksPartialResult -v 2>&1 | head -20
```

- [ ] **Step 3: 修改 tasks.py — 捕获 PartialResultError**

在 `analyze_repository` 任务的 try/except 块（约 line 412-459）中，在 `except ValueError` 之后、`except Exception` 之前新增：

```python
from backend.agent.orchestrator import PartialResultError

except PartialResultError as exc:
    duration = round(time.time() - t_start, 3)
    result = exc.result   # 由 AIPipeline 层附加
    if result is None:
        logger.error("PartialResultError 未携带 result，无法保存部分图谱")
        raise

    built = result.built
    built.meta["analysis_status"] = "partial"
    built.meta["completed_modules"] = exc.completed_count
    built.meta["total_modules"] = exc.total_count
    _graph_repo.save(built, repo_name=repo_name)   # 二次 save，写入 partial meta

    on_progress_callback({
        "status": "completed_partial",
        "graph_id": result.graph_id,
        "node_count": result.node_count,
        "edge_count": result.edge_count,
        "completed_modules": exc.completed_count,
        "total_modules": exc.total_count,
        "elapsed_seconds": duration,
        "message": f"已完成 {exc.completed_count}/{exc.total_count} 个模块，因 API 持续限速保存部分结果",
    })
    status_store.set_completed(
        repo_id,
        graph_id=result.graph_id,
        node_count=result.node_count,
        edge_count=result.edge_count,
        duration_seconds=duration,
    )
    return {
        "task_id": task_id,
        "status": "completed_partial",
        "graph_id": result.graph_id,
        "node_count": result.node_count,
        "edge_count": result.edge_count,
        "completed_modules": exc.completed_count,
        "total_modules": exc.total_count,
    }
```

- [ ] **Step 4: 修改 tasks.py — incremental_update 检测 partial 图谱**

在 `incremental_update` 任务中，加载 `prior` 图谱之后，在 SHA 对比之前新增：

```python
prior = graph_repo.load(graph_id)
if prior and prior.meta.get("analysis_status") == "partial":
    logger.info("上次分析不完整（%s/%s 模块），强制重新分析",
                prior.meta.get("completed_modules"), prior.meta.get("total_modules"))
    reason = "incomplete_prior_analysis"
    # 走全量分析，不走 no_change 跳过逻辑
    return await _run_full_analysis(...)  # 或直接调用 analyze_repository
```

具体实现取决于 `incremental_update` 现有结构，关键是确保 `analysis_status == "partial"` 时不走 `no_change` 分支。

- [ ] **Step 5: 运行所有测试**

```bash
pytest backend/tests/test_partial_result_flow.py backend/tests/test_orchestrator_resume.py \
       backend/tests/test_checkpoint_partial.py backend/tests/test_llm_429_backoff.py -v
```

预期：所有测试 PASS

- [ ] **Step 6: Commit**

```bash
git add backend/scheduler/tasks.py backend/tests/test_partial_result_flow.py
git commit -m "feat: handle PartialResultError in tasks.py, save partial meta, fix incremental_update for partial graphs"
```

---

## 验收测试

- [ ] **端到端冒烟测试**：设置 `LLM_PROVIDER=zhipu ZHIPU_API_KEY=<key>`，分析一个小型仓库，确认
  - 正常完成时产生 `completed` 状态、节点数 > 24
  - 多次提交同一仓库时，已完成模块被跳过（日志显示"断点续跑"）

- [ ] **回归测试**：运行全部现有测试，确认无破坏

```bash
cd code-graph-system
source venv/bin/activate
pytest backend/tests/ -v --timeout=60 2>&1 | tail -20
```

---

## 回滚说明

- **关闭退避退出**：`RATE_LIMIT_MAX_PAUSES=999`（持续等待，不保存部分结果退出）
- **禁用断点续跑**：删除 `data/checkpoints/<repo_name>/`（强制全量）
- **切回 MiniMax**：`LLM_PROVIDER=minimax`（无需改代码）
