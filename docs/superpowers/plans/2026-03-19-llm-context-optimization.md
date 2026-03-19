# LLM 上下文优化与结构预索引实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 ContextMonitor 度量错误、引入发送前分级压缩、新增 StructureIndexer 结构预索引工具，将单模块 API 调用次数从 20+ 次降到 3-8 次，彻底消除 context 溢出导致的 400 错误。

**Architecture:** ContextMonitor 改为追踪单次请求 input_tokens（非累计），tool_call_loop 在发送前估算 token 数并按 70/85/95% 三级阈值压缩消息历史。新增 StructureIndexer 在模块分析前静态提取代码骨架（类名/方法签名/行号），注册为 search_structure 工具供 Agent 精准查询，替代大量探索性文件读取。

**Tech Stack:** Python 3.9+, pytest, javalang（可选，Java AST 解析）, ast（stdlib, Python 解析）

---

## 文件变更地图

| 文件 | 操作 | 职责 |
|---|---|---|
| `backend/llm/types.py` | 修改 | 更新 `ContextState` 注释，input/output_tokens 语义改为单次值 |
| `backend/llm/context_monitor.py` | 重写 | 追踪 last_input_tokens，提取 `_calc_status()`，删除旧接口 |
| `backend/llm/sliding_window.py` | 修改 | 在 `apply()` 末尾加配对完整性自愈检查 |
| `backend/llm/client.py` | 修改 | 新增 `_estimate_tokens`、`_apply_compression`、`_compress_large_tool_results`、`_dispatch_tool`；`tool_call_loop` 新增 `tool_executor_map` 参数，替换 `should_apply_sliding_window` 调用 |
| `backend/agent/base.py` | 修改 | `register_tool` 新增 `executor` 参数，维护 `_tool_executors` 映射 |
| `backend/agent/structure_indexer.py` | 新建 | `StructureIndexer` + `FileSkeleton`/`ClassInfo`/`MethodInfo` 数据类，Java/Python 解析 |
| `backend/agent/orchestrator.py` | 修改 | `run_module_analysis` 构建索引，`_run_agent_for_module` 注册 search_structure 工具 |
| `backend/agent/agents/architecture.py` | 修改 | `run()` 传入 `tool_executor_map=self._tool_executors` |
| `backend/tests/test_context_monitor.py` | 修改 | 新增单次语义测试，删除累计测试 |
| `backend/tests/test_sliding_window.py` | 修改 | 新增配对完整性自愈测试 |
| `backend/tests/test_compression.py` | 新建 | Level 1/2/3 压缩、占位符内容、配对完整性 |
| `backend/tests/test_structure_indexer.py` | 新建 | Java/Python 骨架提取、search_structure 查询、输出预算截断 |
| `backend/tests/test_tool_executor_map.py` | 新建 | 多 executor 路由、向后兼容 |

---

## Chunk 1: ContextMonitor 修复 + Types 更新

### Task 1: 更新 ContextState 注释（types.py）

**Files:**
- Modify: `code-graph-system/backend/llm/types.py:44-50`

- [ ] **Step 1: 修改 ContextState 字段注释**

```python
@dataclass
class ContextState:
    """上下文状态。"""
    status: str = "normal"       # "normal" | "warning" | "critical" | "exceeded"
    usage_ratio: float = 0.0     # 当前使用率 (0.0 - 1.0)
    input_tokens: int = 0        # 本次请求的 input tokens（非累计）
    output_tokens: int = 0       # 本次请求的 output tokens（非累计）
    max_context: int = 128000    # 模型的最大上下文窗口
```

- [ ] **Step 2: 提交**

```bash
cd code-graph-system
git add backend/llm/types.py
git commit -m "refactor: update ContextState field comments to reflect per-request semantics"
```

---

### Task 2: 重写 ContextMonitor

**Files:**
- Modify: `code-graph-system/backend/llm/context_monitor.py`
- Modify: `code-graph-system/backend/tests/test_context_monitor.py`

- [ ] **Step 1: 查看现有测试，了解需要调整的测试**

```bash
cd code-graph-system
cat backend/tests/test_context_monitor.py
```

- [ ] **Step 2: 写新测试（先写失败测试）**

在 `backend/tests/test_context_monitor.py` 末尾新增：

```python
class TestContextMonitorNew:
    """验证新的单次 token 语义。"""

    def test_record_usage_tracks_last_input_tokens(self):
        """usage_ratio 应基于本次请求 input_tokens，而非累计值。"""
        monitor = ContextMonitor(max_tokens=100)
        monitor.record_usage(input_tokens=50, output_tokens=10)
        state = monitor.record_usage(input_tokens=60, output_tokens=10)
        # 第二次请求 input=60，ratio=0.6，而非累计 (50+60+20)=130/100=1.3
        assert state.usage_ratio == pytest.approx(0.6)
        assert state.input_tokens == 60
        assert state.status == "normal"  # 60% < 70% warning threshold

    def test_warning_threshold_at_70_percent(self):
        monitor = ContextMonitor(max_tokens=100)
        state = monitor.record_usage(input_tokens=70, output_tokens=0)
        assert state.status == "warning"

    def test_critical_threshold_at_85_percent(self):
        monitor = ContextMonitor(max_tokens=100)
        state = monitor.record_usage(input_tokens=85, output_tokens=0)
        assert state.status == "critical"

    def test_exceeded_threshold_at_100_percent(self):
        monitor = ContextMonitor(max_tokens=100)
        state = monitor.record_usage(input_tokens=100, output_tokens=0)
        assert state.status == "exceeded"

    def test_get_state_does_not_mutate(self):
        """get_state() 不应改变内部状态。"""
        monitor = ContextMonitor(max_tokens=100)
        monitor.record_usage(input_tokens=50, output_tokens=5)
        s1 = monitor.get_state()
        s2 = monitor.get_state()
        assert s1.input_tokens == s2.input_tokens == 50

    def test_reset_clears_last_tokens(self):
        monitor = ContextMonitor(max_tokens=100)
        monitor.record_usage(input_tokens=80, output_tokens=10)
        monitor.reset()
        state = monitor.get_state()
        assert state.input_tokens == 0
        assert state.usage_ratio == 0.0
        assert state.status == "normal"

    def test_no_should_apply_sliding_window_method(self):
        """旧接口 should_apply_sliding_window 应已删除。"""
        monitor = ContextMonitor()
        assert not hasattr(monitor, "should_apply_sliding_window")

    def test_no_total_input_property(self):
        """旧 property total_input/total_output 应已删除。"""
        monitor = ContextMonitor()
        assert not hasattr(monitor, "total_input")
        assert not hasattr(monitor, "total_output")
```

- [ ] **Step 3: 运行新测试，确认失败**

```bash
cd code-graph-system
source venv/bin/activate
pytest backend/tests/test_context_monitor.py::TestContextMonitorNew -v
```

Expected: 多数测试 FAIL（旧实现是累计值）

- [ ] **Step 4: 重写 context_monitor.py**

完整替换 `backend/llm/context_monitor.py` 内容：

```python
"""上下文监控器，用于追踪 LLM token 使用量和上下文状态。"""

from __future__ import annotations

import logging

from backend.llm.types import ContextState

logger = logging.getLogger(__name__)


class ContextMonitor:
    """上下文监控器，追踪最近一次请求的 token 使用量并判断上下文状态。

    状态阈值（基于单次请求 input_tokens / max_tokens）：
    - normal:   < 70%
    - warning:  70% - 85%
    - critical: 85% - 100%
    - exceeded: >= 100%
    """

    def __init__(self, max_tokens: int = 128000) -> None:
        self.max_tokens = max_tokens
        self._last_input_tokens: int = 0
        self._last_output_tokens: int = 0

    def _calc_status(self, usage_ratio: float) -> str:
        """根据使用率返回状态字符串。record_usage 和 get_state 均调用此方法。"""
        if usage_ratio >= 1.0:
            return "exceeded"
        elif usage_ratio >= 0.85:
            return "critical"
        elif usage_ratio >= 0.70:
            return "warning"
        return "normal"

    def record_usage(self, input_tokens: int, output_tokens: int) -> ContextState:
        """记录本次请求的 token 使用量并返回当前状态。

        Args:
            input_tokens: 本次请求的输入 token 数（= 当前 context window 实际占用）。
            output_tokens: 本次请求的输出 token 数。

        Returns:
            当前的 ContextState。
        """
        self._last_input_tokens = input_tokens
        self._last_output_tokens = output_tokens
        usage_ratio = input_tokens / self.max_tokens if self.max_tokens > 0 else 0.0
        status = self._calc_status(usage_ratio)

        if status == "warning":
            logger.warning(
                "Context usage at %.1f%% (%d/%d tokens)",
                usage_ratio * 100, input_tokens, self.max_tokens,
            )
        elif status == "critical":
            logger.warning(
                "Context usage CRITICAL at %.1f%% (%d/%d tokens).",
                usage_ratio * 100, input_tokens, self.max_tokens,
            )
        elif status == "exceeded":
            logger.error(
                "Context window EXCEEDED at %.1f%% (%d/%d tokens).",
                usage_ratio * 100, input_tokens, self.max_tokens,
            )

        return ContextState(
            status=status,
            usage_ratio=usage_ratio,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            max_context=self.max_tokens,
        )

    def get_state(self) -> ContextState:
        """基于最近一次记录的值重新计算状态，不触发副作用。"""
        usage_ratio = (
            self._last_input_tokens / self.max_tokens
            if self.max_tokens > 0 else 0.0
        )
        return ContextState(
            status=self._calc_status(usage_ratio),
            usage_ratio=usage_ratio,
            input_tokens=self._last_input_tokens,
            output_tokens=self._last_output_tokens,
            max_context=self.max_tokens,
        )

    def reset(self) -> None:
        """重置（用于模块间重置），清零峰值记录。"""
        self._last_input_tokens = 0
        self._last_output_tokens = 0
        logger.debug("ContextMonitor reset: token counts cleared")
```

- [ ] **Step 5: 运行所有 ContextMonitor 测试**

```bash
cd code-graph-system
pytest backend/tests/test_context_monitor.py -v
```

Expected: 新测试全部 PASS，旧测试中测累计值的需要删除或更新（搜索 `total_input`、`_total_input`、`should_apply_sliding_window` 关键词，删除相关旧 case）。

- [ ] **Step 6: 提交**

```bash
git add backend/llm/context_monitor.py backend/llm/types.py backend/tests/test_context_monitor.py
git commit -m "fix: rewrite ContextMonitor to track per-request input_tokens instead of cumulative"
```

---

## Chunk 2: SlidingWindow 配对完整性自愈

### Task 3: SlidingWindow 运行时自愈检查

**Files:**
- Modify: `code-graph-system/backend/llm/sliding_window.py:88-101`
- Modify: `code-graph-system/backend/tests/test_sliding_window.py`

- [ ] **Step 1: 写失败测试**

在 `backend/tests/test_sliding_window.py` 末尾新增：

```python
class TestSlidingWindowPairingHeal:
    """验证 apply() 的配对完整性自愈逻辑。"""

    def _make_tool_round(self, tool_use_id: str = "tu_1") -> list[dict]:
        """构造一轮完整的 tool_use / tool_result 消息对。"""
        return [
            {
                "role": "assistant",
                "content": [
                    {"type": "tool_use", "id": tool_use_id, "name": "read_file", "input": {"path": "x.py"}}
                ],
            },
            {
                "role": "user",
                "content": [
                    {"type": "tool_result", "tool_use_id": tool_use_id, "content": "file content"}
                ],
            },
        ]

    def test_heal_orphan_tool_result_after_truncation(self):
        """若截断后第一条非首消息是孤立 tool_result，应自动跳过，避免配对破坏。"""
        # 首条系统消息 + 3 轮工具对话
        first_msg = {"role": "user", "content": "analyze this repo"}
        round1 = self._make_tool_round("tu_1")
        round2 = self._make_tool_round("tu_2")
        round3 = self._make_tool_round("tu_3")
        messages = [first_msg] + round1 + round2 + round3

        # keep_recent_rounds=1 → 只保留最近 1 轮（round3）
        # 如果截断后紧接着是孤立 tool_result，应自愈跳过
        sw = SlidingWindow(keep_recent_rounds=1, keep_first_messages=1)
        result, truncated = sw.apply(messages, "anthropic")

        assert truncated is True
        # 保留首条 + 占位符 + 最近 1 轮（2 条）
        # 结果中不应以 tool_result user 消息开头（跳过占位符后）
        non_first = [m for m in result if m.get("content") != SlidingWindow.PLACEHOLDER_CONTENT
                     and m != first_msg]
        if non_first:
            first_non_placeholder = non_first[0]
            content = first_non_placeholder.get("content", [])
            if isinstance(content, list):
                types = [b.get("type") for b in content if isinstance(b, dict)]
                assert "tool_result" not in types or first_non_placeholder.get("role") != "user" or \
                       any(b.get("type") == "tool_use" for m in result
                           for b in (m.get("content", []) if isinstance(m.get("content"), list) else [])
                           if b.get("id") == (content[0].get("tool_use_id") if content else None))
```

- [ ] **Step 2: 运行，确认通过（现有实现已有按 2 条/轮截取的逻辑，此测试验证边界）**

```bash
cd code-graph-system
pytest backend/tests/test_sliding_window.py::TestSlidingWindowPairingHeal -v
```

- [ ] **Step 3: 在 apply() 末尾添加自愈检查**

在 `sliding_window.py` 的 `apply()` 方法末尾（`return result, True` 之前）添加：

```python
        # 自愈检查：若截断后第一条非 keep_first 消息是孤立 tool_result，跳过它
        if len(result) > self.keep_first_messages + 1:  # +1 for placeholder
            first_after_placeholder_idx = self.keep_first_messages + 1
            if first_after_placeholder_idx < len(result):
                candidate = result[first_after_placeholder_idx]
                content = candidate.get("content", [])
                if (
                    candidate.get("role") == "user"
                    and isinstance(content, list)
                    and any(
                        isinstance(b, dict) and b.get("type") == "tool_result"
                        for b in content
                    )
                ):
                    # 孤立 tool_result：移除这条消息，保留其余
                    result.pop(first_after_placeholder_idx)
                    logger.warning(
                        "Sliding window: removed orphan tool_result message to preserve pairing"
                    )
```

- [ ] **Step 4: 运行测试**

```bash
pytest backend/tests/test_sliding_window.py -v
```

Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add backend/llm/sliding_window.py backend/tests/test_sliding_window.py
git commit -m "fix: add runtime pairing heal in SlidingWindow.apply() for orphan tool_result"
```

---

## Chunk 3: Pre-flight 分级压缩（client.py）

### Task 4: 新增 token 估算 + 压缩函数 + 更新 tool_call_loop

**Files:**
- Modify: `code-graph-system/backend/llm/client.py`
- Create: `code-graph-system/backend/tests/test_compression.py`

- [ ] **Step 1: 写 test_compression.py**

创建 `backend/tests/test_compression.py`：

```python
"""测试 pre-flight token 估算和分级压缩函数。"""

import pytest
from backend.llm.client import (
    _estimate_tokens,
    _apply_compression,
    _compress_large_tool_results,
    _dispatch_tool,
    COMPRESSED_PLACEHOLDER,
)


class TestEstimateTokens:
    def test_empty(self):
        assert _estimate_tokens("", []) == 0

    def test_system_prompt_included(self):
        system = "a" * 400  # 400 bytes UTF-8
        assert _estimate_tokens(system, []) == 100  # 400 // 4

    def test_string_message_content(self):
        messages = [{"role": "user", "content": "a" * 400}]
        assert _estimate_tokens("", messages) == 100

    def test_list_message_content(self):
        messages = [{"role": "user", "content": [{"type": "tool_result", "content": "a" * 400}]}]
        result = _estimate_tokens("", messages)
        assert result > 0  # 有内容即可，精确值依赖 str() 格式

    def test_chinese_text_more_bytes(self):
        # 中文每字 3 字节，4 字节/token → 约 0.75 tokens/字
        chinese = "中" * 100  # 300 bytes
        assert _estimate_tokens(chinese, []) == 75


class TestCompressLargeToolResults:
    def _tool_result_msg(self, content: str, tool_use_id: str = "tu_1") -> dict:
        return {
            "role": "user",
            "content": [
                {"type": "tool_result", "tool_use_id": tool_use_id, "content": content}
            ],
        }

    def test_small_result_not_compressed(self):
        msg = self._tool_result_msg("short content")
        result = _compress_large_tool_results([msg], max_chars=2000)
        assert result[0]["content"][0]["content"] == "short content"

    def test_large_result_replaced_with_placeholder(self):
        large = "x" * 3000
        msg = self._tool_result_msg(large)
        result = _compress_large_tool_results([msg], max_chars=2000)
        assert result[0]["content"][0]["content"] == COMPRESSED_PLACEHOLDER

    def test_tool_use_id_preserved(self):
        """压缩后 tool_use_id 必须保留，确保 Anthropic 配对完整。"""
        large = "x" * 3000
        msg = self._tool_result_msg(large, tool_use_id="my_id_123")
        result = _compress_large_tool_results([msg], max_chars=2000)
        assert result[0]["content"][0]["tool_use_id"] == "my_id_123"

    def test_assistant_message_untouched(self):
        assistant_msg = {
            "role": "assistant",
            "content": [{"type": "tool_use", "id": "tu_1", "name": "read_file", "input": {}}],
        }
        result = _compress_large_tool_results([assistant_msg], max_chars=10)
        assert result[0] == assistant_msg

    def test_skip_first_skips_index_0(self):
        first = self._tool_result_msg("x" * 3000, "tu_0")
        second = self._tool_result_msg("x" * 3000, "tu_1")
        result = _compress_large_tool_results([first, second], max_chars=2000, skip_first=True)
        # 首条不压缩
        assert result[0]["content"][0]["content"] == "x" * 3000
        # 第二条压缩
        assert result[1]["content"][0]["content"] == COMPRESSED_PLACEHOLDER

    def test_list_content_skipped(self):
        """content 为 list 类型（非 str）时不处理，原样保留。"""
        msg = {
            "role": "user",
            "content": [
                {"type": "tool_result", "tool_use_id": "tu_1", "content": [{"type": "text", "text": "x" * 3000}]}
            ],
        }
        result = _compress_large_tool_results([msg], max_chars=2000)
        assert isinstance(result[0]["content"][0]["content"], list)


class TestApplyCompression:
    def _make_messages(self, n_rounds: int = 6) -> list[dict]:
        """构造 n 轮工具调用消息（1 首消息 + n 轮 assistant/user 对）。"""
        msgs = [{"role": "user", "content": "start task"}]
        for i in range(n_rounds):
            msgs.append({
                "role": "assistant",
                "content": [{"type": "tool_use", "id": f"tu_{i}", "name": "read_file", "input": {}}],
            })
            msgs.append({
                "role": "user",
                "content": [
                    {"type": "tool_result", "tool_use_id": f"tu_{i}", "content": "x" * 3000}
                ],
            })
        return msgs

    def test_level1_reduces_message_count(self):
        msgs = self._make_messages(n_rounds=6)
        compressed = _apply_compression(msgs, level=1)
        assert len(compressed) < len(msgs)

    def test_level2_compresses_tool_results(self):
        msgs = self._make_messages(n_rounds=6)
        compressed = _apply_compression(msgs, level=2)
        # 检查保留的 tool_result 是否被压缩
        tool_result_contents = [
            b["content"]
            for m in compressed
            for b in (m.get("content", []) if isinstance(m.get("content"), list) else [])
            if isinstance(b, dict) and b.get("type") == "tool_result"
        ]
        assert all(c == COMPRESSED_PLACEHOLDER for c in tool_result_contents)

    def test_level3_keeps_at_most_first_plus_1_round(self):
        msgs = self._make_messages(n_rounds=6)
        compressed = _apply_compression(msgs, level=3)
        # 1 首消息 + 1 占位符 + 最近 1 轮 (2 条) = 4 条
        assert len(compressed) <= 4

    def test_level3_tool_use_tool_result_paired(self):
        """Level 3 压缩后 tool_use 和 tool_result 必须成对。"""
        msgs = self._make_messages(n_rounds=3)
        compressed = _apply_compression(msgs, level=3)
        tool_use_ids = set()
        tool_result_ids = set()
        for m in compressed:
            content = m.get("content", [])
            if not isinstance(content, list):
                continue
            for b in content:
                if not isinstance(b, dict):
                    continue
                if b.get("type") == "tool_use":
                    tool_use_ids.add(b.get("id"))
                elif b.get("type") == "tool_result":
                    tool_result_ids.add(b.get("tool_use_id"))
        assert tool_use_ids == tool_result_ids


class TestDispatchTool:
    def test_dedicated_executor_takes_priority(self):
        class DedicatedExec:
            def my_tool(self, x): return {"from": "dedicated", "x": x}

        class FallbackExec:
            def my_tool(self, x): return {"from": "fallback", "x": x}

        result = _dispatch_tool("my_tool", {"x": 1}, {"my_tool": DedicatedExec()}, FallbackExec())
        assert result["from"] == "dedicated"

    def test_fallback_to_tool_executor(self):
        class FallbackExec:
            def my_tool(self, x): return {"from": "fallback", "x": x}

        result = _dispatch_tool("my_tool", {"x": 1}, {}, FallbackExec())
        assert result["from"] == "fallback"

    def test_raises_when_no_executor_found(self):
        with pytest.raises(ValueError, match="No executor found"):
            _dispatch_tool("unknown_tool", {}, {}, None)
```

- [ ] **Step 2: 运行，确认 ImportError（函数尚未存在）**

```bash
cd code-graph-system
pytest backend/tests/test_compression.py -v 2>&1 | head -20
```

Expected: `ImportError: cannot import name '_estimate_tokens'`

- [ ] **Step 3: 在 client.py 顶部添加模块级函数**

在 `backend/llm/client.py` 的 `RateLimitExhaustedError` 类定义之前，添加以下代码：

```python
# ── 压缩相关常量 ────────────────────────────────────────────────────────────
COMPRESSED_PLACEHOLDER = (
    "[已压缩] 原始结果已移除以节省上下文。"
    "如需重新查看，请使用 search_structure() 获取结构信息，"
    "或使用指定行号的 read_file() 精准读取。"
)

# 压缩触发阈值
_COMPRESSION_L1 = 0.70   # Level 1: 滑动窗口裁剪旧轮次
_COMPRESSION_L2 = 0.85   # Level 2: 同上 + 压缩保留轮次中的大 tool result
_COMPRESSION_L3 = 0.95   # Level 3: 极简保留，仅首条 + 最近 1 轮


def _estimate_tokens(system: str, messages: list[dict]) -> int:
    """估算 context 大小（UTF-8 字节数 / 4），包含 system prompt。

    对于中英混合代码，UTF-8/4 比 chars/3 更准确。
    """
    total_bytes = len(system.encode("utf-8"))
    for msg in messages:
        content = msg.get("content", "")
        if isinstance(content, str):
            total_bytes += len(content.encode("utf-8"))
        elif isinstance(content, list):
            for block in content:
                if isinstance(block, dict):
                    total_bytes += len(str(block).encode("utf-8"))
    return total_bytes // 4


def _compress_large_tool_results(
    messages: list[dict],
    max_chars: int,
    skip_first: bool = False,
) -> list[dict]:
    """替换超限 tool result content 为占位符，保留 tool_use_id。

    仅处理 content 为 str 的 tool_result block。
    content 为 list[ContentBlock]（如含图片）的情况不做处理，有意跳过。
    """
    result = []
    for i, msg in enumerate(messages):
        if skip_first and i == 0:
            result.append(msg)
            continue
        if msg.get("role") != "user":
            result.append(msg)
            continue
        content = msg.get("content", [])
        if not isinstance(content, list):
            result.append(msg)
            continue
        new_content = []
        for block in content:
            if (
                isinstance(block, dict)
                and block.get("type") == "tool_result"
                and isinstance(block.get("content"), str)
                and len(block["content"]) > max_chars
            ):
                new_content.append({**block, "content": COMPRESSED_PLACEHOLDER})
            else:
                new_content.append(block)
        result.append({**msg, "content": new_content})
    return result


def _apply_compression(
    messages: list[dict],
    level: int,
    provider: str = "anthropic",
) -> list[dict]:
    """按级别压缩消息历史。

    Level 1: 滑动窗口裁剪旧轮次（keep 5 rounds）
    Level 2: Level 1 + 压缩保留轮次中 >2000 chars 的 tool result
    Level 3: 仅保留首条 + 最近 1 轮，压缩 tool result >500 chars
    """
    from backend.llm.sliding_window import SlidingWindow

    if level == 1:
        sw = SlidingWindow(keep_recent_rounds=5, keep_first_messages=1)
        compressed, _ = sw.apply(messages, provider)
        return compressed

    if level == 2:
        compressed = _apply_compression(messages, level=1, provider=provider)
        return _compress_large_tool_results(compressed, max_chars=2000)

    if level == 3:
        sw = SlidingWindow(keep_recent_rounds=1, keep_first_messages=1)
        compressed, _ = sw.apply(messages, provider)
        return _compress_large_tool_results(compressed, max_chars=500, skip_first=True)

    return messages  # 未知级别原样返回


def _dispatch_tool(
    tool_name: str,
    tool_input: dict,
    tool_executor_map: dict | None,
    tool_executor: Any | None,
) -> Any:
    """统一工具路由。Anthropic 和 OpenAI 分支均调用此函数，避免分支遗漏。

    优先从 tool_executor_map 按工具名查找专属 executor，
    回退到通用 tool_executor（向后兼容）。
    """
    executor_map = tool_executor_map or {}
    dedicated = executor_map.get(tool_name)
    if dedicated is not None and hasattr(dedicated, tool_name):
        return getattr(dedicated, tool_name)(**tool_input)
    if tool_executor is not None and hasattr(tool_executor, tool_name):
        return getattr(tool_executor, tool_name)(**tool_input)
    raise ValueError(f"No executor found for tool: {tool_name}")
```

- [ ] **Step 4: 修改 tool_call_loop 签名和内部逻辑**

**4a. 更新函数签名**（在 `def tool_call_loop(` 处）：

```python
def tool_call_loop(
    self,
    system: str,
    messages: list[dict],
    tools: list[dict],
    max_iterations: int = 20,
    tool_executor: Any = None,
    context_monitor: "ContextMonitor | None" = None,
    tool_executor_map: dict[str, Any] | None = None,  # 新增
) -> ToolCallLoopResult:
```

**4b. 替换循环顶部的 should_apply_sliding_window 调用**

将以下旧代码（约第 254-259 行）：
```python
            # 检查是否需要应用滑动窗口
            if context_monitor and context_monitor.should_apply_sliding_window():
                sliding_window = SlidingWindow()
                current_messages, truncated = sliding_window.apply(current_messages, self.provider)
                if truncated:
                    logger.warning("应用滑动窗口，裁剪早期历史")
```

替换为：
```python
            # Pre-flight token check: 发送前估算并按阈值压缩
            context_window = getattr(self, 'context_window', 128000)
            estimated = _estimate_tokens(system, current_messages)
            ratio = estimated / context_window if context_window > 0 else 0.0
            if ratio >= _COMPRESSION_L3:
                current_messages = _apply_compression(current_messages, level=3, provider=self.provider)
                logger.warning("Pre-flight Level 3 压缩（估算 %.0f%%）", ratio * 100)
            elif ratio >= _COMPRESSION_L2:
                current_messages = _apply_compression(current_messages, level=2, provider=self.provider)
                logger.info("Pre-flight Level 2 压缩（估算 %.0f%%）", ratio * 100)
            elif ratio >= _COMPRESSION_L1:
                current_messages = _apply_compression(current_messages, level=1, provider=self.provider)
                logger.info("Pre-flight Level 1 压缩（估算 %.0f%%）", ratio * 100)
```

**4c. 替换 Anthropic 分支的工具分发（约第 331-338 行）**

将：
```python
                        if tool_executor and hasattr(tool_executor, tool_name):
                            try:
                                result = getattr(tool_executor, tool_name)(**tool_input)
                                tool_output = result if isinstance(result, dict) else {"result": result}
                            except Exception as e:
                                success = False
                                error_msg = str(e)
                                tool_output = {"error": error_msg}
```

替换为：
```python
                        try:
                            result = _dispatch_tool(
                                tool_name, tool_input, tool_executor_map, tool_executor
                            )
                            tool_output = result if isinstance(result, dict) else {"result": result}
                        except ValueError:
                            # 没有找到 executor，tool_output 为空
                            pass
                        except Exception as e:
                            success = False
                            error_msg = str(e)
                            tool_output = {"error": error_msg}
```

**4d. 替换 OpenAI 分支的工具分发（约第 441-448 行）**

将：
```python
                        if tool_executor and hasattr(tool_executor, tool_name):
                            try:
                                result = getattr(tool_executor, tool_name)(**tool_input)
                                tool_output = result if isinstance(result, dict) else {"result": result}
                            except Exception as e:
                                success = False
                                error_msg = str(e)
                                tool_output = {"error": error_msg}
```

替换为（与 Anthropic 分支相同）：
```python
                        try:
                            result = _dispatch_tool(
                                tool_name, tool_input, tool_executor_map, tool_executor
                            )
                            tool_output = result if isinstance(result, dict) else {"result": result}
                        except ValueError:
                            pass
                        except Exception as e:
                            success = False
                            error_msg = str(e)
                            tool_output = {"error": error_msg}
```

**4e. 更新 context_monitor.record_usage 后的 debug log**

将 Anthropic 分支（约第 277 行）和 OpenAI 分支（约第 394 行）的：
```python
                        logger.debug(f"Token 使用: {state.input_tokens} ({state.usage_ratio:.1%})")
```
改为：
```python
                        logger.debug(f"本次请求 input tokens: {state.input_tokens} ({state.usage_ratio:.1%})")
```

**4f. 添加 context_window 属性**

在 `LLMClient.__init__` 中新增（在 `self.temperature = temperature` 后）：
```python
        # context_window 用于 pre-flight token check
        self.context_window: int = 128000
```

- [ ] **Step 5: 运行压缩测试**

```bash
cd code-graph-system
pytest backend/tests/test_compression.py -v
```

Expected: 全部 PASS

- [ ] **Step 6: 运行完整 LLM 测试套件，确保无回归**

```bash
pytest backend/tests/test_llm_client.py backend/tests/test_llm_tool_call.py backend/tests/test_client_context_integration.py -v
```

Expected: 全部 PASS

- [ ] **Step 7: 提交**

```bash
git add backend/llm/client.py backend/tests/test_compression.py
git commit -m "feat: add pre-flight token estimation and 3-level compression to tool_call_loop"
```

---

## Chunk 4: BaseAgent 多 executor 支持

### Task 5: register_tool 新增 executor 参数

**Files:**
- Modify: `code-graph-system/backend/agent/base.py`
- Create: `code-graph-system/backend/tests/test_tool_executor_map.py`

- [ ] **Step 1: 写失败测试**

创建 `backend/tests/test_tool_executor_map.py`：

```python
"""测试 BaseAgent._tool_executors 映射和向后兼容性。"""

import pytest
from backend.agent.base import BaseAgent
from backend.agent.context import AgentContext
from backend.llm.client import LLMClient


class ConcreteAgent(BaseAgent):
    """用于测试的最简 Agent 实现。"""
    def get_system_prompt(self): return "test"
    def run(self): return None


def _make_agent() -> ConcreteAgent:
    """创建一个用于测试的 Agent 实例（不依赖真实 LLM）。"""
    import unittest.mock as mock
    context = mock.MagicMock(spec=AgentContext)
    context.module_id = "test_module"
    llm_client = mock.MagicMock(spec=LLMClient)
    return ConcreteAgent(agent_type="test", context=context, llm_client=llm_client)


class TestRegisterToolWithExecutor:
    def test_register_without_executor_backward_compatible(self):
        """不传 executor 时，行为与原来一致。"""
        agent = _make_agent()
        agent.register_tool("my_tool", "desc", {"type": "object"})
        assert len(agent._tools) == 1
        assert not hasattr(agent, "_tool_executors") or "my_tool" not in agent._tool_executors

    def test_register_with_executor_stored_in_map(self):
        """传 executor 时，存储到 _tool_executors。"""
        class MyExecutor:
            def my_tool(self): return {}

        agent = _make_agent()
        executor = MyExecutor()
        agent.register_tool("my_tool", "desc", {"type": "object"}, executor=executor)
        assert "my_tool" in agent._tool_executors
        assert agent._tool_executors["my_tool"] is executor

    def test_tool_definition_always_added(self):
        """无论是否有 executor，工具定义都加入 _tools。"""
        class MyExecutor:
            def my_tool(self): return {}

        agent = _make_agent()
        agent.register_tool("my_tool", "desc", {"type": "object"}, executor=MyExecutor())
        assert any(t["name"] == "my_tool" for t in agent._tools)

    def test_multiple_executors_independent(self):
        """多个工具可有不同 executor。"""
        class ExecA:
            def tool_a(self): return {}

        class ExecB:
            def tool_b(self): return {}

        agent = _make_agent()
        exec_a, exec_b = ExecA(), ExecB()
        agent.register_tool("tool_a", "a", {"type": "object"}, executor=exec_a)
        agent.register_tool("tool_b", "b", {"type": "object"}, executor=exec_b)
        assert agent._tool_executors["tool_a"] is exec_a
        assert agent._tool_executors["tool_b"] is exec_b
```

- [ ] **Step 2: 运行，确认失败**

```bash
cd code-graph-system
pytest backend/tests/test_tool_executor_map.py -v
```

Expected: `AttributeError: '_tool_executors'` 或 `TypeError: register_tool() got unexpected keyword argument 'executor'`

- [ ] **Step 3: 修改 base.py**

```python
class BaseAgent(ABC):
    def __init__(self, agent_type, context, llm_client):
        self.agent_type = agent_type
        self.context = context
        self.llm_client = llm_client
        self._tools: list[dict] = []
        self._tool_executors: dict[str, Any] = {}   # 新增

    def register_tool(
        self,
        name: str,
        description: str,
        input_schema: dict,
        executor: Any = None,   # 新增
    ) -> None:
        """注册工具。executor 可选，用于支持多 executor 路由。"""
        self._tools.append({
            "name": name,
            "description": description,
            "input_schema": input_schema,
        })
        if executor is not None:
            self._tool_executors[name] = executor
```

在文件顶部添加 `from typing import Any`（如尚未存在）。

- [ ] **Step 4: 运行测试**

```bash
pytest backend/tests/test_tool_executor_map.py -v
```

Expected: 全部 PASS

- [ ] **Step 5: 运行 agent 相关测试，确保无回归**

```bash
pytest backend/tests/test_agent_base.py -v
```

Expected: 全部 PASS

- [ ] **Step 6: 提交**

```bash
git add backend/agent/base.py backend/tests/test_tool_executor_map.py
git commit -m "feat: add executor param to register_tool, maintain _tool_executors map in BaseAgent"
```

---

## Chunk 5: StructureIndexer

### Task 6: 新建 StructureIndexer

**Files:**
- Create: `code-graph-system/backend/agent/structure_indexer.py`
- Create: `code-graph-system/backend/tests/test_structure_indexer.py`

- [ ] **Step 1: 写测试（test_structure_indexer.py）**

创建 `backend/tests/test_structure_indexer.py`：

```python
"""测试 StructureIndexer 骨架提取和 search_structure 查询。"""

import textwrap
import tempfile
from pathlib import Path
import pytest
from backend.agent.structure_indexer import StructureIndexer, FileSkeleton


# ── Java 骨架提取 ─────────────────────────────────────────────────────────────

SAMPLE_JAVA = textwrap.dedent("""\
    package com.example.api;

    import org.springframework.web.bind.annotation.RestController;
    import org.springframework.web.bind.annotation.GetMapping;
    import com.example.service.UserService;

    @RestController
    public class UserController {

        private UserService userService;

        @GetMapping("/users")
        public List<User> getUsers() {
            return userService.findAll();
        }

        private void helper() {}
    }
""")


@pytest.fixture
def java_repo(tmp_path: Path) -> Path:
    """创建包含一个 Java 文件的临时仓库。"""
    src = tmp_path / "src" / "main" / "java" / "com" / "example" / "api"
    src.mkdir(parents=True)
    (src / "UserController.java").write_text(SAMPLE_JAVA, encoding="utf-8")
    return tmp_path


class TestJavaScan:
    def test_build_index_finds_java_file(self, java_repo):
        indexer = StructureIndexer(depth="standard")
        indexer.build_index(java_repo)
        keys = list(indexer._index.keys())
        assert any("UserController.java" in k for k in keys)

    def test_skeleton_has_class_info(self, java_repo):
        indexer = StructureIndexer(depth="standard")
        indexer.build_index(java_repo)
        key = next(k for k in indexer._index if "UserController.java" in k)
        skeleton = indexer._index[key]
        assert skeleton.language == "java"
        assert len(skeleton.classes) >= 1
        cls = skeleton.classes[0]
        assert cls.name == "UserController"
        assert "@RestController" in cls.annotations

    def test_standard_depth_includes_public_methods(self, java_repo):
        indexer = StructureIndexer(depth="standard")
        indexer.build_index(java_repo)
        key = next(k for k in indexer._index if "UserController.java" in k)
        cls = indexer._index[key].classes[0]
        method_names = [m.name for m in cls.methods]
        assert "getUsers" in method_names

    def test_quick_depth_excludes_methods(self, java_repo):
        indexer = StructureIndexer(depth="quick")
        indexer.build_index(java_repo)
        key = next(k for k in indexer._index if "UserController.java" in k)
        cls = indexer._index[key].classes[0]
        assert len(cls.methods) == 0  # quick 只要类名+注解

    def test_line_count_correct(self, java_repo):
        indexer = StructureIndexer(depth="standard")
        indexer.build_index(java_repo)
        key = next(k for k in indexer._index if "UserController.java" in k)
        assert indexer._index[key].line_count == len(SAMPLE_JAVA.splitlines())

    def test_imports_captured(self, java_repo):
        indexer = StructureIndexer(depth="standard")
        indexer.build_index(java_repo)
        key = next(k for k in indexer._index if "UserController.java" in k)
        imports = indexer._index[key].top_imports
        assert any("RestController" in imp for imp in imports)


# ── Python 骨架提取 ───────────────────────────────────────────────────────────

SAMPLE_PYTHON = textwrap.dedent("""\
    from typing import List
    import os

    class UserService:
        '''Service for user management.'''

        def get_user(self, user_id: int) -> dict:
            pass

        def _private_helper(self):
            pass
""")


@pytest.fixture
def python_repo(tmp_path: Path) -> Path:
    (tmp_path / "services").mkdir()
    (tmp_path / "services" / "user_service.py").write_text(SAMPLE_PYTHON, encoding="utf-8")
    return tmp_path


class TestPythonScan:
    def test_build_index_finds_python_file(self, python_repo):
        indexer = StructureIndexer(depth="standard")
        indexer.build_index(python_repo)
        keys = list(indexer._index.keys())
        assert any("user_service.py" in k for k in keys)

    def test_skeleton_has_class(self, python_repo):
        indexer = StructureIndexer(depth="standard")
        indexer.build_index(python_repo)
        key = next(k for k in indexer._index if "user_service.py" in k)
        classes = indexer._index[key].classes
        assert any(c.name == "UserService" for c in classes)

    def test_standard_includes_public_methods(self, python_repo):
        indexer = StructureIndexer(depth="standard")
        indexer.build_index(python_repo)
        key = next(k for k in indexer._index if "user_service.py" in k)
        cls = next(c for c in indexer._index[key].classes if c.name == "UserService")
        method_names = [m.name for m in cls.methods]
        assert "get_user" in method_names

    def test_imports_captured(self, python_repo):
        indexer = StructureIndexer(depth="standard")
        indexer.build_index(python_repo)
        key = next(k for k in indexer._index if "user_service.py" in k)
        assert any("typing" in imp or "os" in imp for imp in indexer._index[key].top_imports)


# ── search_structure 查询 ────────────────────────────────────────────────────

class TestSearchStructure:
    @pytest.fixture
    def indexed(self, java_repo) -> StructureIndexer:
        indexer = StructureIndexer(depth="standard")
        indexer.build_index(java_repo)
        return indexer

    def test_search_by_annotation(self, indexed):
        result = indexed.search_structure(annotation="@RestController")
        assert result["count"] >= 1
        assert any("UserController" in str(r) for r in result["results"])

    def test_search_by_keyword(self, indexed):
        result = indexed.search_structure(keyword="UserController")
        assert result["count"] >= 1

    def test_no_match_returns_empty(self, indexed):
        result = indexed.search_structure(keyword="NonExistentXYZ123")
        assert result["count"] == 0
        assert result["results"] == []

    def test_max_results_respected(self, tmp_path):
        """当结果超出 max_results 时应截断并附说明。"""
        # 创建 5 个 Java 文件
        for i in range(5):
            src = tmp_path / f"Ctrl{i}.java"
            src.write_text(f"@RestController\npublic class Ctrl{i} {{}}\n", encoding="utf-8")
        indexer = StructureIndexer(depth="standard")
        indexer.build_index(tmp_path)
        result = indexer.search_structure(annotation="@RestController", max_results=2)
        assert len(result["results"]) <= 2
        if result["total_count"] > 2:
            assert "缩小范围" in result.get("truncation_note", "") or result.get("truncated") is True

    def test_result_contains_line_numbers(self, indexed):
        result = indexed.search_structure(annotation="@RestController")
        if result["count"] > 0:
            first = result["results"][0]
            # 结果应包含行号信息
            assert "line" in str(first).lower() or any(
                isinstance(v, int) for v in (first.values() if isinstance(first, dict) else [])
            )

    def test_output_token_budget_limits_size(self, tmp_path):
        """max_output_tokens 很小时，输出应被截断。"""
        # 创建一个有大量内容的 Java 文件
        big_java = "public class BigClass {\n"
        for i in range(100):
            big_java += f"    public void method{i}() {{}}\n"
        big_java += "}\n"
        (tmp_path / "BigClass.java").write_text(big_java, encoding="utf-8")
        indexer = StructureIndexer(depth="deep")
        indexer.build_index(tmp_path)
        result = indexer.search_structure(keyword="BigClass", max_output_tokens=10)
        output_str = str(result)
        assert len(output_str) <= 10 * 4 * 3  # 给一些余量
```

- [ ] **Step 2: 运行，确认 ImportError**

```bash
cd code-graph-system
pytest backend/tests/test_structure_indexer.py -v 2>&1 | head -10
```

Expected: `ModuleNotFoundError: No module named 'backend.agent.structure_indexer'`

- [ ] **Step 3: 创建 structure_indexer.py**

创建 `backend/agent/structure_indexer.py`：

```python
"""结构预索引器：静态扫描代码仓库，提取类/方法骨架，供 Agent 精准查询。"""

from __future__ import annotations

import ast
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# javalang 为可选依赖
try:
    import javalang
    _JAVALANG_AVAILABLE = True
except ImportError:
    _JAVALANG_AVAILABLE = False
    logger.warning(
        "javalang 未安装，Java 解析将降级为正则模式。"
        "安装命令：pip install javalang"
    )

# 按重要性排序的注解（排在前面的文件优先返回）
_PRIORITY_ANNOTATIONS = {
    "@RestController", "@Controller", "@Service", "@Repository",
    "@Component", "@Configuration", "@SpringBootApplication",
}


@dataclass
class MethodInfo:
    """方法骨架。"""
    name: str
    signature: str           # 含参数类型和返回类型的完整签名
    annotations: list[str]   # 方法级注解
    line_start: int          # 方法首行行号（1-based）
    visibility: str          # "public" | "protected" | "private" | ""


@dataclass
class ClassInfo:
    """类骨架。"""
    name: str
    class_type: str          # "class" | "interface" | "abstract" | "enum"
    annotations: list[str]   # 类级注解
    methods: list[MethodInfo]
    base_classes: list[str]  # extends / implements 的类名
    line_start: int          # 类首行行号（1-based）


@dataclass
class FileSkeleton:
    """文件骨架。"""
    relative_path: str
    language: str
    classes: list[ClassInfo]
    top_imports: list[str]   # 最多 10 个 import 语句
    line_count: int


class StructureIndexer:
    """代码仓库结构预索引器。

    build_index() 扫描整个仓库（无 LLM 调用），将文件骨架存入 self._index。
    search_structure() 按注解/父类/关键词/路径等条件查询索引。
    """

    def __init__(self, depth: str = "standard") -> None:
        """
        Args:
            depth: 骨架详细程度。
                "quick"    – 仅类名 + 注解
                "standard" – 类 + 公共方法签名 + 行号
                "deep"     – 类 + 全部方法 + 依赖 + 行号
        """
        if depth not in ("quick", "standard", "deep"):
            raise ValueError(f"depth 必须是 'quick'/'standard'/'deep'，收到: {depth}")
        self.depth = depth
        self._index: dict[str, FileSkeleton] = {}

    # ── 公共接口 ──────────────────────────────────────────────────────────────

    def build_index(self, repo_path: Path) -> None:
        """扫描 repo_path 下所有源文件，构建骨架索引（存入 self._index）。"""
        repo_path = Path(repo_path).resolve()
        self._index.clear()

        # 忽略常见非源码目录
        ignore_dirs = {
            ".git", "venv", "node_modules", "target", "build",
            ".gradle", "__pycache__", ".idea", ".mvn",
        }

        for file_path in repo_path.rglob("*"):
            if not file_path.is_file():
                continue
            # 跳过忽略目录
            if any(part in ignore_dirs for part in file_path.parts):
                continue

            suffix = file_path.suffix.lower()
            skeleton = None

            if suffix == ".java":
                skeleton = self._scan_java(file_path)
            elif suffix == ".py":
                skeleton = self._scan_python(file_path)
            else:
                skeleton = self._scan_generic(file_path)

            if skeleton is not None:
                rel_path = str(file_path.relative_to(repo_path))
                skeleton.relative_path = rel_path
                self._index[rel_path] = skeleton

        logger.info("StructureIndexer: 索引构建完成，共 %d 个文件", len(self._index))

    def search_structure(
        self,
        annotation: str | None = None,
        base_class: str | None = None,
        keyword: str | None = None,
        file_pattern: str | None = None,
        module_path: str | None = None,
        max_results: int = 30,
        max_output_tokens: int = 4096,
    ) -> dict[str, Any]:
        """查询结构索引，返回匹配骨架 + 精确行号。

        Returns:
            {
                "count": int,               # 匹配文件数（截断前）
                "total_count": int,         # 总匹配文件数
                "truncated": bool,
                "truncation_note": str,     # 截断提示
                "results": list[dict],      # 每个匹配文件的骨架摘要
            }
        """
        matches: list[FileSkeleton] = []

        for rel_path, skeleton in self._index.items():
            # 路径过滤
            if module_path and not rel_path.startswith(module_path):
                continue
            if file_pattern and not self._match_glob(rel_path, file_pattern):
                continue

            # 内容过滤
            if annotation and not self._has_annotation(skeleton, annotation):
                continue
            if base_class and not self._has_base_class(skeleton, base_class):
                continue
            if keyword and not self._has_keyword(skeleton, keyword):
                continue

            matches.append(skeleton)

        # 按重要性排序（优先返回核心 Spring/服务注解）
        matches.sort(key=self._priority_score, reverse=True)

        total_count = len(matches)
        truncated = total_count > max_results
        matches = matches[:max_results]

        # 构建输出，遵守 token 预算
        max_chars = max_output_tokens * 4
        results = []
        used_chars = 0

        for skeleton in matches:
            entry = self._format_skeleton_entry(skeleton)
            entry_str = str(entry)
            if used_chars + len(entry_str) > max_chars:
                break
            results.append(entry)
            used_chars += len(entry_str)

        truncation_note = ""
        if truncated:
            truncation_note = (
                f"... 还有 {total_count - len(results)} 个文件匹配，"
                "请用 file_pattern 或 module_path 缩小范围"
            )

        return {
            "count": len(results),
            "total_count": total_count,
            "truncated": truncated,
            "truncation_note": truncation_note,
            "results": results,
        }

    # ── 私有：Java 解析 ───────────────────────────────────────────────────────

    def _scan_java(self, file_path: Path) -> FileSkeleton | None:
        """Java 文件骨架提取（javalang AST → 正则降级 → 仅行数）。"""
        try:
            source = file_path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return None

        lines = source.splitlines()
        line_count = len(lines)

        # 尝试 javalang AST 解析
        if _JAVALANG_AVAILABLE:
            try:
                return self._scan_java_ast(source, lines, line_count)
            except Exception:
                pass  # 降级到正则

        # 正则降级
        try:
            return self._scan_java_regex(source, lines, line_count)
        except Exception:
            pass

        # 最终降级：仅文件名 + 行数
        return FileSkeleton(
            relative_path="",
            language="java",
            classes=[],
            top_imports=[],
            line_count=line_count,
        )

    def _scan_java_ast(self, source: str, lines: list[str], line_count: int) -> FileSkeleton:
        """用 javalang 做 AST 解析提取 Java 骨架。"""
        tree = javalang.parse.parse(source)

        # 提取 imports
        top_imports = [
            f"import {imp.path}{'.*' if imp.wildcard else ''};"
            for imp in (tree.imports or [])
        ][:10]

        classes: list[ClassInfo] = []
        for path, node in tree:
            if not isinstance(node, (
                javalang.tree.ClassDeclaration,
                javalang.tree.InterfaceDeclaration,
                javalang.tree.EnumDeclaration,
            )):
                continue

            # 类型
            if isinstance(node, javalang.tree.InterfaceDeclaration):
                class_type = "interface"
            elif isinstance(node, javalang.tree.EnumDeclaration):
                class_type = "enum"
            elif node.modifiers and "abstract" in node.modifiers:
                class_type = "abstract"
            else:
                class_type = "class"

            # 注解
            annotations = [f"@{a.name}" for a in (node.annotations or [])]

            # 父类 / 接口
            base_classes: list[str] = []
            if hasattr(node, "extends") and node.extends:
                ext = node.extends
                if isinstance(ext, list):
                    base_classes.extend(e.name for e in ext if hasattr(e, "name"))
                elif hasattr(ext, "name"):
                    base_classes.append(ext.name)
            if hasattr(node, "implements") and node.implements:
                for iface in node.implements:
                    if hasattr(iface, "name"):
                        base_classes.append(iface.name)

            # 行号（javalang 节点有 position 属性）
            line_start = node.position.line if node.position else 1

            # 方法
            methods: list[MethodInfo] = []
            if self.depth in ("standard", "deep"):
                for member in (node.body or []):
                    if not isinstance(member, javalang.tree.MethodDeclaration):
                        continue
                    vis = "public"
                    if member.modifiers:
                        if "private" in member.modifiers:
                            vis = "private"
                        elif "protected" in member.modifiers:
                            vis = "protected"

                    if self.depth == "standard" and vis != "public":
                        continue

                    m_annotations = [f"@{a.name}" for a in (member.annotations or [])]
                    params = ", ".join(
                        f"{p.type.name} {p.name}" for p in (member.parameters or [])
                    )
                    ret = member.return_type.name if member.return_type else "void"
                    sig = f"{ret} {member.name}({params})"
                    m_line = member.position.line if member.position else 0

                    methods.append(MethodInfo(
                        name=member.name,
                        signature=sig,
                        annotations=m_annotations,
                        line_start=m_line,
                        visibility=vis,
                    ))

            classes.append(ClassInfo(
                name=node.name,
                class_type=class_type,
                annotations=annotations,
                methods=methods,
                base_classes=base_classes,
                line_start=line_start,
            ))

        return FileSkeleton(
            relative_path="",
            language="java",
            classes=classes,
            top_imports=top_imports,
            line_count=line_count,
        )

    def _scan_java_regex(self, source: str, lines: list[str], line_count: int) -> FileSkeleton:
        """正则降级：只提取类名和注解，不提取方法签名。"""
        top_imports = re.findall(r"^import\s+[\w.*]+;", source, re.MULTILINE)[:10]

        class_pattern = re.compile(
            r"(?P<annotations>(?:\s*@\w+(?:\([^)]*\))?\s*)*)"
            r"\s*(?:public\s+)?(?P<mod>abstract\s+)?(?P<type>class|interface|enum)\s+"
            r"(?P<name>\w+)",
            re.MULTILINE,
        )
        classes: list[ClassInfo] = []
        for m in class_pattern.finditer(source):
            annotations = re.findall(r"@\w+", m.group("annotations"))
            mod = m.group("mod") or ""
            class_type = "abstract" if "abstract" in mod else m.group("type")
            line_no = source[:m.start()].count("\n") + 1
            classes.append(ClassInfo(
                name=m.group("name"),
                class_type=class_type,
                annotations=annotations,
                methods=[],
                base_classes=[],
                line_start=line_no,
            ))

        return FileSkeleton(
            relative_path="",
            language="java",
            classes=classes,
            top_imports=top_imports,
            line_count=line_count,
        )

    # ── 私有：Python 解析 ─────────────────────────────────────────────────────

    def _scan_python(self, file_path: Path) -> FileSkeleton | None:
        """Python 文件骨架提取（标准库 ast）。"""
        try:
            source = file_path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return None

        try:
            tree = ast.parse(source)
        except SyntaxError:
            return None

        lines = source.splitlines()
        line_count = len(lines)

        top_imports: list[str] = []
        classes: list[ClassInfo] = []

        for node in ast.walk(tree):
            # 收集 import（只取顶层）
            if isinstance(node, (ast.Import, ast.ImportFrom)) and len(top_imports) < 10:
                if isinstance(node, ast.Import):
                    top_imports.append(f"import {', '.join(a.name for a in node.names)}")
                else:
                    mod = node.module or ""
                    top_imports.append(f"from {mod} import ...")

            if not isinstance(node, ast.ClassDef):
                continue

            base_classes = [
                (getattr(b, "id", None) or getattr(b, "attr", None) or "")
                for b in node.bases
            ]

            methods: list[MethodInfo] = []
            if self.depth in ("standard", "deep"):
                for item in node.body:
                    if not isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        continue
                    name = item.name
                    # dunder 方法（__init__ 等）视为 public，单下划线视为 private
                    if name.startswith("__") and name.endswith("__"):
                        vis = "public"   # dunder: __init__, __str__ 等
                    elif name.startswith("_"):
                        vis = "private"
                    else:
                        vis = "public"
                    if self.depth == "standard" and vis != "public":
                        continue

                    # 简化参数列表
                    args = item.args
                    param_names = [a.arg for a in args.args if a.arg != "self"]
                    sig = f"{name}({', '.join(param_names)})"

                    methods.append(MethodInfo(
                        name=name,
                        signature=sig,
                        annotations=[],
                        line_start=item.lineno,
                        visibility=vis,
                    ))

            classes.append(ClassInfo(
                name=node.name,
                class_type="class",
                annotations=[],
                methods=methods,
                base_classes=[b for b in base_classes if b],
                line_start=node.lineno,
            ))

        return FileSkeleton(
            relative_path="",
            language="python",
            classes=classes,
            top_imports=top_imports[:10],
            line_count=line_count,
        )

    # ── 私有：通用解析 ────────────────────────────────────────────────────────

    def _scan_generic(self, file_path: Path) -> FileSkeleton | None:
        """其他语言：仅提取行数，不提取结构。"""
        if file_path.suffix.lower() not in (
            ".ts", ".js", ".go", ".rs", ".kt", ".scala", ".cs",
        ):
            return None
        try:
            source = file_path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return None
        return FileSkeleton(
            relative_path="",
            language=file_path.suffix.lstrip(".").lower(),
            classes=[],
            top_imports=[],
            line_count=len(source.splitlines()),
        )

    # ── 私有：查询辅助 ────────────────────────────────────────────────────────

    def _has_annotation(self, skeleton: FileSkeleton, annotation: str) -> bool:
        ann = annotation if annotation.startswith("@") else f"@{annotation}"
        return any(ann in cls.annotations for cls in skeleton.classes)

    def _has_base_class(self, skeleton: FileSkeleton, base_class: str) -> bool:
        return any(
            base_class in cls.base_classes for cls in skeleton.classes
        )

    def _has_keyword(self, skeleton: FileSkeleton, keyword: str) -> bool:
        kw = keyword.lower()
        for cls in skeleton.classes:
            if kw in cls.name.lower():
                return True
            for m in cls.methods:
                if kw in m.name.lower():
                    return True
        return kw in skeleton.relative_path.lower()

    def _match_glob(self, path: str, pattern: str) -> bool:
        from fnmatch import fnmatch
        return fnmatch(path, pattern) or fnmatch(path.replace("\\", "/"), pattern)

    def _priority_score(self, skeleton: FileSkeleton) -> int:
        score = 0
        for cls in skeleton.classes:
            for ann in cls.annotations:
                if ann in _PRIORITY_ANNOTATIONS:
                    score += 2
        return score

    def _format_skeleton_entry(self, skeleton: FileSkeleton) -> dict[str, Any]:
        """将 FileSkeleton 转换为简洁的字典，供查询结果返回。"""
        classes_info = []
        for cls in skeleton.classes:
            entry: dict[str, Any] = {
                "name": cls.name,
                "type": cls.class_type,
                "annotations": cls.annotations,
                "line": cls.line_start,
            }
            if cls.base_classes:
                entry["extends"] = cls.base_classes
            if cls.methods:
                entry["methods"] = [
                    {
                        "name": m.name,
                        "signature": m.signature,
                        "annotations": m.annotations,
                        "line": m.line_start,
                    }
                    for m in cls.methods
                ]
            classes_info.append(entry)

        return {
            "file": skeleton.relative_path,
            "language": skeleton.language,
            "line_count": skeleton.line_count,
            "imports": skeleton.top_imports[:5],
            "classes": classes_info,
        }
```

- [ ] **Step 4: 运行测试**

```bash
cd code-graph-system
pytest backend/tests/test_structure_indexer.py -v
```

Expected: 核心测试通过。若 javalang 未安装，Java AST 测试将使用正则降级，方法提取测试可能跳过（用 `pytest.mark.skipif` 可选标记 javalang 相关测试）。

- [ ] **Step 5: 安装 javalang（如未安装）**

```bash
cd code-graph-system
pip install javalang
pytest backend/tests/test_structure_indexer.py -v
```

Expected: 全部 PASS（含 javalang AST 路径）

- [ ] **Step 6: 提交**

```bash
git add backend/agent/structure_indexer.py backend/tests/test_structure_indexer.py
git commit -m "feat: add StructureIndexer with Java (javalang/regex) and Python (ast) skeleton extraction"
```

---

## Chunk 6: Orchestrator + ArchitectureAgent 集成

### Task 7: 集成 StructureIndexer 到 Orchestrator

**Files:**
- Modify: `code-graph-system/backend/agent/orchestrator.py`
- Modify: `code-graph-system/backend/agent/agents/architecture.py`

- [ ] **Step 1: 查看 orchestrator 关键方法**

```bash
cd code-graph-system
grep -n "def run_module_analysis\|def _run_agent_for_module\|ArchitectureAgent" backend/agent/orchestrator.py | head -20
```

- [ ] **Step 2: 在 run_module_analysis 开头添加索引构建**

在 `orchestrator.py` 的 `run_module_analysis` 方法，找到 `while i < len(modules):` 循环之前（即 `all_nodes: list[GraphNode] = []` 初始化块之后），添加：

```python
        # [新增] 构建整个仓库的结构索引（零 LLM 调用，一次性）
        from backend.agent.structure_indexer import StructureIndexer
        depth = self.config.preset.value if hasattr(self.config, "preset") else "standard"
        self._structure_indexer = StructureIndexer(depth=depth)
        self._structure_indexer.build_index(self.repo_path)
        logger.info("StructureIndexer 索引构建完成：%d 个文件", len(self._structure_indexer._index))
```

- [ ] **Step 3: 在 _run_agent_for_module 中注册 search_structure 工具**

找到 `_run_agent_for_module` 方法中创建 `agent = ArchitectureAgent(...)` 的那一行，在其后添加：

```python
        # [新增] 注册 search_structure 工具，executor 指向预构建索引
        if hasattr(self, "_structure_indexer"):
            agent.register_tool(
                name="search_structure",
                description=(
                    "查询代码结构索引，获取类/方法骨架和精确行号。"
                    "支持按注解（如 @RestController）、父类、关键词、路径模式过滤。"
                    "优先用此工具了解模块结构，再用 read_file 精准读取具体方法。"
                ),
                input_schema={
                    "type": "object",
                    "properties": {
                        "annotation": {
                            "type": "string",
                            "description": "按注解过滤，如 @RestController、@Service",
                        },
                        "base_class": {
                            "type": "string",
                            "description": "按父类或接口名过滤",
                        },
                        "keyword": {
                            "type": "string",
                            "description": "按类名或方法名关键词搜索",
                        },
                        "file_pattern": {
                            "type": "string",
                            "description": "文件路径 glob 模式，如 */controller/*",
                        },
                        "module_path": {
                            "type": "string",
                            "description": "限定搜索目录范围",
                        },
                    },
                },
                executor=self._structure_indexer,
            )
```

- [ ] **Step 4: 修改 ArchitectureAgent.run() 传入 tool_executor_map**

在 `architecture.py` 的 `run()` 方法中，找到 `tool_call_loop(...)` 调用，添加参数：

```python
        result = self.llm_client.tool_call_loop(
            system=self.get_system_prompt(),
            messages=messages,
            tools=self._tools,
            max_iterations=self.context.max_iterations,
            tool_executor=self._file_tools,
            context_monitor=self.context.context_monitor,
            tool_executor_map=self._tool_executors,   # 新增
        )
```

- [ ] **Step 5: 运行 orchestrator 相关测试**

```bash
cd code-graph-system
pytest backend/tests/test_agent_orchestrator.py backend/tests/test_architecture_agent.py -v
```

Expected: 全部 PASS（确保无回归）

- [ ] **Step 6: 运行完整测试套件**

```bash
cd code-graph-system
pytest backend/tests/ -v --ignore=backend/tests/test_ai_pipeline_e2e.py -x 2>&1 | tail -30
```

Expected: 全部 PASS（e2e 测试需要真实 API 密钥，跳过）

- [ ] **Step 7: 提交**

```bash
git add backend/agent/orchestrator.py backend/agent/agents/architecture.py
git commit -m "feat: integrate StructureIndexer into Orchestrator and register search_structure tool in ArchitectureAgent"
```

---

## Chunk 7: 最终验证

### Task 8: 整体冒烟测试

- [ ] **Step 1: 运行所有新测试**

```bash
cd code-graph-system
pytest backend/tests/test_context_monitor.py \
       backend/tests/test_sliding_window.py \
       backend/tests/test_compression.py \
       backend/tests/test_structure_indexer.py \
       backend/tests/test_tool_executor_map.py \
       -v
```

Expected: 全部 PASS

- [ ] **Step 2: 运行全套单元测试，确认无回归**

```bash
cd code-graph-system
pytest backend/tests/ -v --ignore=backend/tests/test_ai_pipeline_e2e.py 2>&1 | tail -20
```

Expected: 全部 PASS

- [ ] **Step 3: 验证 should_apply_sliding_window 和旧 property 已删除**

```bash
cd code-graph-system
python -c "
from backend.llm.context_monitor import ContextMonitor
m = ContextMonitor()
assert not hasattr(m, 'should_apply_sliding_window'), 'should_apply_sliding_window 未删除'
assert not hasattr(m, 'total_input'), 'total_input 未删除'
assert not hasattr(m, 'total_output'), 'total_output 未删除'
print('OK: 旧接口已全部删除')
"
```

- [ ] **Step 4: 验证 _dispatch_tool 可导入**

```bash
cd code-graph-system
python -c "
from backend.llm.client import _estimate_tokens, _apply_compression, _dispatch_tool, COMPRESSED_PLACEHOLDER
print('OK: 所有压缩函数可导入')
print(f'  _estimate_tokens(\"\", []) = {_estimate_tokens(\"\", [])}')
"
```

- [ ] **Step 5: 验证 StructureIndexer 可导入并基本运行**

```bash
cd code-graph-system
python -c "
from backend.agent.structure_indexer import StructureIndexer
import tempfile, pathlib
with tempfile.TemporaryDirectory() as d:
    p = pathlib.Path(d)
    (p / 'Hello.java').write_text('@Service\npublic class Hello {}')
    idx = StructureIndexer(depth='standard')
    idx.build_index(p)
    result = idx.search_structure(annotation='@Service')
    print(f'OK: 找到 {result[\"count\"]} 个 @Service 类')
    assert result['count'] >= 1
"
```

- [ ] **Step 6: 最终提交**

```bash
git add -A
git commit -m "chore: final verification - all new tests pass, no regressions"
```

---

## 验收标准

1. `pytest backend/tests/test_context_monitor.py::TestContextMonitorNew` — 全 PASS
2. `pytest backend/tests/test_compression.py` — 全 PASS
3. `pytest backend/tests/test_structure_indexer.py` — 全 PASS
4. `pytest backend/tests/test_tool_executor_map.py` — 全 PASS
5. `pytest backend/tests/ --ignore=backend/tests/test_ai_pipeline_e2e.py` — 无新增失败
6. `ContextMonitor` 无 `should_apply_sliding_window`、`total_input`、`total_output`
7. `StructureIndexer` 可正确索引包含 `@Service`/`@RestController` 的 Java 文件
