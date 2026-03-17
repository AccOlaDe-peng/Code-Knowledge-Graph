# 上下文管理优化实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 解决大型代码仓库分析时 LLM 上下文超限崩溃问题，实现三阶段渐进式上下文管理优化。

**Architecture:** 通过 Token 监控器追踪上下文使用量，在达到阈值时依次触发滑动窗口裁剪和模块级检查点重置，最终通过 LLM 摘要压缩最大化保留关键信息。

**Tech Stack:** Python 3.9+, Pydantic, pytest

**Design Doc:** [2026-03-17-context-management-optimization-design.md](../specs/2026-03-17-context-management-optimization-design.md)

---

## File Structure

### 新增文件
| 文件 | 职责 |
|------|------|
| `backend/llm/context_monitor.py` | Token 使用量追踪和状态判断 |
| `backend/llm/sliding_window.py` | 滑动窗口消息裁剪 |
| `backend/agent/checkpoint.py` | 模块级检查点保存/恢复 |
| `backend/agent/config.py` | 分析预设配置 |

### 修改文件
| 文件 | 修改内容 |
|------|----------|
| `backend/llm/client.py` | 集成 ContextMonitor 和 SlidingWindow |
| `backend/agent/tools/file_tools.py` | 添加输出限制 |
| `backend/agent/orchestrator.py` | 集成 CheckpointManager |
| `backend/llm/types.py` | 新增 TokenUsage 类型 |

---

## Chunk 1: Phase 1 - Token 监控 + 工具输出限制 + 滑动窗口

### Task 1.1: 创建 TokenUsage 和 ContextState 数据类型

**Files:**
- Modify: `backend/llm/types.py`

- [ ] **Step 1: 检查现有 types.py 内容**

Run: `cat backend/llm/types.py`
Expected: 显示现有类型定义

- [ ] **Step 2: 添加 TokenUsage 和 ContextState 数据类**

```python
# 在 backend/llm/types.py 末尾添加

from dataclasses import dataclass
from typing import Optional


@dataclass
class TokenUsage:
    """Token 使用记录。"""
    request_input: int = 0       # 本次请求输入 token
    request_output: int = 0      # 本次请求输出 token
    cumulative_input: int = 0    # 累计输入 token
    cumulative_output: int = 0   # 累计输出 token


@dataclass
class ContextState:
    """上下文状态。"""
    status: str = "normal"       # "normal" | "warning" | "critical" | "exceeded"
    usage_ratio: float = 0.0     # 当前使用率 (0.0 - 1.0)
    input_tokens: int = 0        # 累计输入 token
    output_tokens: int = 0       # 累计输出 token
    max_context: int = 128000    # 模型的最大上下文窗口
```

- [ ] **Step 3: 验证语法正确**

Run: `cd code-graph-system && python -c "from backend.llm.types import TokenUsage, ContextState; print('OK')"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/llm/types.py
git commit -m "feat(llm): add TokenUsage and ContextState data types"
```

---

### Task 1.2: 创建 ContextMonitor 组件

**Files:**
- Create: `backend/llm/context_monitor.py`
- Create: `backend/tests/test_context_monitor.py`

- [ ] **Step 1: 编写 ContextMonitor 测试**

```python
# backend/tests/test_context_monitor.py

import pytest
from backend.llm.context_monitor import ContextMonitor, ContextState


class TestContextMonitor:
    """ContextMonitor 单元测试。"""

    def test_initial_state(self):
        """初始状态应为 normal。"""
        monitor = ContextMonitor(max_tokens=1000)
        state = monitor.get_state()

        assert state.status == "normal"
        assert state.usage_ratio == 0.0
        assert state.input_tokens == 0

    def test_record_usage(self):
        """记录 token 使用量。"""
        monitor = ContextMonitor(max_tokens=1000)
        state = monitor.record_usage(100, 50)

        assert state.input_tokens == 100
        assert state.output_tokens == 50
        assert state.usage_ratio == 0.1

    def test_cumulative_usage(self):
        """累计 token 使用量。"""
        monitor = ContextMonitor(max_tokens=1000)
        monitor.record_usage(100, 50)
        state = monitor.record_usage(200, 100)

        assert state.input_tokens == 300
        assert state.output_tokens == 150
        assert state.usage_ratio == 0.3

    def test_warning_threshold(self):
        """达到 60% 时状态变为 warning。"""
        monitor = ContextMonitor(max_tokens=1000)
        state = monitor.record_usage(600, 0)

        assert state.status == "warning"

    def test_critical_threshold(self):
        """达到 75% 时状态变为 critical。"""
        monitor = ContextMonitor(max_tokens=1000)
        state = monitor.record_usage(750, 0)

        assert state.status == "critical"

    def test_exceeded_threshold(self):
        """超过 100% 时状态变为 exceeded。"""
        monitor = ContextMonitor(max_tokens=1000)
        state = monitor.record_usage(1001, 0)

        assert state.status == "exceeded"

    def test_should_apply_sliding_window(self):
        """critical 和 exceeded 状态应触发滑动窗口。"""
        monitor = ContextMonitor(max_tokens=1000)

        # normal 状态不触发
        monitor.record_usage(500, 0)
        assert not monitor.should_apply_sliding_window()

        # critical 状态触发
        monitor.record_usage(300, 0)
        assert monitor.should_apply_sliding_window()

    def test_reset(self):
        """重置累计值。"""
        monitor = ContextMonitor(max_tokens=1000)
        monitor.record_usage(500, 100)
        monitor.reset()

        state = monitor.get_state()
        assert state.input_tokens == 0
        assert state.output_tokens == 0
        assert state.status == "normal"
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd code-graph-system && python -m pytest backend/tests/test_context_monitor.py -v`
Expected: FAIL (模块不存在)

- [ ] **Step 3: 实现 ContextMonitor**

```python
# backend/llm/context_monitor.py

"""上下文监控器。

追踪 LLM 调用的 token 使用量，判断上下文状态。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from backend.llm.types import ContextState

logger = logging.getLogger(__name__)


class ContextMonitor:
    """上下文监控器。

    追踪每次 LLM 调用的 token 使用量，判断当前上下文状态：
    - normal: < 60%
    - warning: 60% - 75%
    - critical: 75% - 100%
    - exceeded: > 100%
    """

    # 阈值配置
    WARNING_THRESHOLD = 0.6
    CRITICAL_THRESHOLD = 0.75

    def __init__(self, max_tokens: int = 128000):
        """初始化监控器。

        Args:
            max_tokens: 模型的最大上下文窗口
        """
        self.max_tokens = max_tokens
        self.total_input = 0
        self.total_output = 0

    def record_usage(self, input_tokens: int, output_tokens: int) -> ContextState:
        """记录本次请求的 token 使用量。

        Args:
            input_tokens: 本次请求输入 token
            output_tokens: 本次请求输出 token

        Returns:
            更新后的上下文状态
        """
        self.total_input += input_tokens
        self.total_output += output_tokens

        state = self.get_state()
        logger.debug(
            f"Token 使用: input={self.total_input}, output={self.total_output}, "
            f"ratio={state.usage_ratio:.1%}, status={state.status}"
        )
        return state

    def get_state(self) -> ContextState:
        """获取当前上下文状态。"""
        ratio = self.total_input / self.max_tokens if self.max_tokens > 0 else 0.0

        if ratio >= 1.0:
            status = "exceeded"
        elif ratio >= self.CRITICAL_THRESHOLD:
            status = "critical"
        elif ratio >= self.WARNING_THRESHOLD:
            status = "warning"
        else:
            status = "normal"

        return ContextState(
            status=status,
            usage_ratio=ratio,
            input_tokens=self.total_input,
            output_tokens=self.total_output,
            max_context=self.max_tokens,
        )

    def should_apply_sliding_window(self) -> bool:
        """判断是否应该应用滑动窗口。"""
        return self.get_state().status in ("critical", "exceeded")

    def reset(self) -> None:
        """重置累计值（用于模块间重置）。"""
        self.total_input = 0
        self.total_output = 0
        logger.debug("ContextMonitor 已重置")
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd code-graph-system && python -m pytest backend/tests/test_context_monitor.py -v`
Expected: 所有测试 PASS

- [ ] **Step 5: Commit**

```bash
git add backend/llm/context_monitor.py backend/tests/test_context_monitor.py
git commit -m "feat(llm): add ContextMonitor for token usage tracking"
```

---

### Task 1.3: 创建 SlidingWindow 组件

**Files:**
- Create: `backend/llm/sliding_window.py`
- Create: `backend/tests/test_sliding_window.py`

- [ ] **Step 1: 编写 SlidingWindow 测试**

```python
# backend/tests/test_sliding_window.py

import pytest
from backend.llm.sliding_window import SlidingWindow


class TestSlidingWindow:
    """SlidingWindow 单元测试。"""

    def create_anthropic_messages(self, count: int) -> list[dict]:
        """创建 Anthropic 格式的测试消息。"""
        messages = [{"role": "user", "content": "Initial task"}]
        for i in range(count):
            messages.append({"role": "assistant", "content": f"Response {i}"})
            messages.append({"role": "user", "content": f"Tool result {i}"})
        return messages

    def test_no_truncation_when_messages_few(self):
        """消息数量少时不裁剪。"""
        window = SlidingWindow(keep_recent_rounds=3, keep_first_messages=1)
        messages = self.create_anthropic_messages(2)

        result, truncated = window.apply(messages, provider="anthropic")

        assert not truncated
        assert len(result) == len(messages)

    def test_truncation_applied(self):
        """消息数量多时进行裁剪。"""
        window = SlidingWindow(keep_recent_rounds=2, keep_first_messages=1)
        messages = self.create_anthropic_messages(10)  # 21 条消息

        result, truncated = window.apply(messages, provider="anthropic")

        assert truncated
        # 1 (first) + 1 (placeholder) + 2*2 (recent) = 6
        assert len(result) == 6

    def test_keeps_first_message(self):
        """保留第一条消息。"""
        window = SlidingWindow(keep_recent_rounds=2, keep_first_messages=1)
        messages = self.create_anthropic_messages(10)

        result, _ = window.apply(messages, provider="anthropic")

        assert result[0] == messages[0]

    def test_keeps_recent_messages(self):
        """保留最近的消息。"""
        window = SlidingWindow(keep_recent_rounds=2, keep_first_messages=1)
        messages = self.create_anthropic_messages(10)

        result, _ = window.apply(messages, provider="anthropic")

        # 最后 4 条消息应保留
        assert result[-4:] == messages[-4:]

    def test_placeholder_message(self):
        """裁剪后包含占位符消息。"""
        window = SlidingWindow(keep_recent_rounds=2, keep_first_messages=1)
        messages = self.create_anthropic_messages(10)

        result, truncated = window.apply(messages, provider="anthropic")

        assert truncated
        # 检查占位符
        placeholder = result[1]
        assert placeholder["role"] == "user"
        assert "裁剪" in placeholder["content"] or "truncated" in placeholder["content"].lower()

    def test_openai_format(self):
        """OpenAI 格式消息处理。"""
        window = SlidingWindow(keep_recent_rounds=2, keep_first_messages=1)
        messages = [{"role": "user", "content": "Task"}]
        for i in range(10):
            messages.append({"role": "assistant", "content": f"Response {i}", "tool_calls": []})
            messages.append({"role": "tool", "tool_call_id": f"id_{i}", "content": f"Result {i}"})

        result, truncated = window.apply(messages, provider="openai")

        assert truncated
        assert result[0] == messages[0]
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd code-graph-system && python -m pytest backend/tests/test_sliding_window.py -v`
Expected: FAIL (模块不存在)

- [ ] **Step 3: 实现 SlidingWindow**

```python
# backend/llm/sliding_window.py

"""滑动窗口上下文管理。

当上下文接近超限时，截断早期历史。
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


class SlidingWindow:
    """滑动窗口上下文管理器。

    裁剪策略：
    - 保留最初的 N 条消息（任务说明）
    - 保留最近的 M 轮对话
    - 中间部分替换为占位符

    "轮"的定义：
    - 1 轮 = 1 次 assistant 消息 + 1 次 user/tool 消息
    """

    def __init__(
        self,
        keep_recent_rounds: int = 5,
        keep_first_messages: int = 1,
    ):
        """初始化滑动窗口。

        Args:
            keep_recent_rounds: 保留最近的轮数
            keep_first_messages: 保留最初的消息数
        """
        self.keep_recent_rounds = keep_recent_rounds
        self.keep_first_messages = keep_first_messages

    def apply(
        self,
        messages: list[dict[str, Any]],
        provider: str = "anthropic",
    ) -> tuple[list[dict[str, Any]], bool]:
        """应用滑动窗口。

        Args:
            messages: 消息列表
            provider: LLM 提供商 ("anthropic" | "openai")

        Returns:
            (裁剪后的消息列表, 是否进行了裁剪)
        """
        # 每轮包含 2 条消息 (assistant + user/tool)
        keep_recent_count = self.keep_recent_rounds * 2
        min_messages = self.keep_first_messages + keep_recent_count

        if len(messages) <= min_messages:
            return messages, False

        # 保留最初的消息
        first_part = messages[:self.keep_first_messages]

        # 保留最近的消息
        recent_part = messages[-keep_recent_count:]

        # 计算裁剪的消息数量
        truncated_count = len(messages) - len(first_part) - len(recent_part)

        # 创建占位符消息
        placeholder = {
            "role": "user",
            "content": f"[系统] 已裁剪 {truncated_count} 条早期历史以节省上下文空间。",
        }

        result = first_part + [placeholder] + recent_part

        logger.info(f"滑动窗口裁剪: {len(messages)} -> {len(result)} 条消息")

        return result, True
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd code-graph-system && python -m pytest backend/tests/test_sliding_window.py -v`
Expected: 所有测试 PASS

- [ ] **Step 5: Commit**

```bash
git add backend/llm/sliding_window.py backend/tests/test_sliding_window.py
git commit -m "feat(llm): add SlidingWindow for message history truncation"
```

---

### Task 1.4: 修改 FileTools 添加输出限制

**Files:**
- Modify: `backend/agent/tools/file_tools.py`
- Create: `backend/tests/test_file_tools_limits.py`

- [ ] **Step 1: 编写输出限制测试**

```python
# backend/tests/test_file_tools_limits.py

import pytest
import tempfile
from pathlib import Path

from backend.agent.tools.file_tools import FileTools


class TestFileToolsLimits:
    """FileTools 输出限制测试。"""

    def test_read_file_lines_limit(self):
        """读取文件行数限制。"""
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = Path(tmpdir) / "test.py"
            # 创建 1000 行文件
            lines = [f"# Line {i}" for i in range(1000)]
            file_path.write_text("\n".join(lines))

            tools = FileTools(tmpdir)
            result = tools.read_file("test.py")

            assert result["success"]
            assert result["line_count"] <= 500  # MAX_FILE_LINES
            assert result["truncated"] is True
            assert result["total_lines"] == 1000

    def test_read_file_with_explicit_range(self):
        """显式指定范围时仍受限制。"""
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = Path(tmpdir) / "test.py"
            lines = [f"# Line {i}" for i in range(1000)]
            file_path.write_text("\n".join(lines))

            tools = FileTools(tmpdir)
            # 请求 800 行，但限制为 500
            result = tools.read_file("test.py", start_line=0, end_line=800)

            assert result["success"]
            assert result["line_count"] <= 500

    def test_search_code_results_limit(self):
        """搜索结果数量限制。"""
        with tempfile.TemporaryDirectory() as tmpdir:
            # 创建多个文件
            for i in range(100):
                file_path = Path(tmpdir) / f"file_{i}.py"
                file_path.write_text("# TODO: fix this\n")

            tools = FileTools(tmpdir)
            result = tools.search_code("TODO", file_pattern="*.py")

            assert result["success"]
            assert result["count"] <= 50  # MAX_SEARCH_RESULTS
            assert result["truncated"] is True
            assert result["total_count"] == 100

    def test_long_line_truncation(self):
        """超长行截断。"""
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = Path(tmpdir) / "test.py"
            # 创建一行超长代码
            long_line = "x = " + ", ".join(str(i) for i in range(1000))
            file_path.write_text(long_line)

            tools = FileTools(tmpdir)
            result = tools.read_file("test.py")

            assert result["success"]
            # 检查行是否被截断
            content_lines = result["content"].split("\n")
            assert len(content_lines[0]) <= 510  # MAX_LINE_LENGTH + "... (truncated)"
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd code-graph-system && python -m pytest backend/tests/test_file_tools_limits.py -v`
Expected: FAIL (限制未实现)

- [ ] **Step 3: 修改 FileTools 添加限制**

在 `backend/agent/tools/file_tools.py` 中修改：

```python
# 在 FileTools 类开头添加类常量
class FileTools:
    """文件操作工具集。"""

    # 输出限制配置
    MAX_FILE_LINES = 500        # 单次读取最大行数
    MAX_SEARCH_RESULTS = 50     # 搜索结果最大数量
    MAX_LINE_LENGTH = 500       # 单行最大长度

    def __init__(self, repo_path: str):
        self.repo_path = Path(repo_path)

    def read_file(self, path: str, start_line: int = 0, end_line: int = None) -> dict[str, Any]:
        """读取文件内容（带行数限制）。

        Args:
            path: 相对于仓库的文件路径
            start_line: 起始行号（0-indexed）
            end_line: 结束行号（不包含）

        Returns:
            {"success": bool, "content": str, "line_count": int, "total_lines": int,
             "truncated": bool, "error": str}
        """
        try:
            file_path = self.repo_path / path
            if not file_path.exists():
                return {"success": False, "error": f"文件不存在: {path}"}

            lines = file_path.read_text(encoding="utf-8").splitlines()
            total_lines = len(lines)

            # 限制读取范围
            if end_line is None:
                end_line = min(start_line + self.MAX_FILE_LINES, total_lines)
            else:
                end_line = min(end_line, start_line + self.MAX_FILE_LINES)

            selected = []
            for line in lines[start_line:end_line]:
                # 截断超长行
                if len(line) > self.MAX_LINE_LENGTH:
                    line = line[:self.MAX_LINE_LENGTH] + "... (truncated)"
                selected.append(line)

            return {
                "success": True,
                "content": "\n".join(selected),
                "line_count": len(selected),
                "total_lines": total_lines,
                "truncated": end_line < total_lines,
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    def search_code(self, pattern: str, file_pattern: str = "*.py") -> dict[str, Any]:
        """搜索代码模式（带结果数量限制）。

        Args:
            pattern: 搜索模式
            file_pattern: 文件通配符

        Returns:
            {"success": bool, "matches": list, "count": int, "total_count": int,
             "truncated": bool, "error": str}
        """
        try:
            matches = []
            for file_path in self.repo_path.rglob(file_pattern):
                if file_path.is_file():
                    try:
                        lines = file_path.read_text(encoding="utf-8").splitlines()
                        for i, line in enumerate(lines):
                            if pattern in line:
                                matches.append({
                                    "file": str(file_path.relative_to(self.repo_path)),
                                    "line": i + 1,
                                    "content": line.strip()[:200],  # 限制内容长度
                                })
                    except:
                        continue

            original_count = len(matches)

            # 限制返回结果数量
            if len(matches) > self.MAX_SEARCH_RESULTS:
                matches = matches[:self.MAX_SEARCH_RESULTS]
                truncated = True
            else:
                truncated = False

            return {
                "success": True,
                "matches": matches,
                "count": len(matches),
                "total_count": original_count,
                "truncated": truncated,
            }
        except Exception as e:
            return {"success": False, "error": str(e)}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd code-graph-system && python -m pytest backend/tests/test_file_tools_limits.py -v`
Expected: 所有测试 PASS

- [ ] **Step 5: Commit**

```bash
git add backend/agent/tools/file_tools.py backend/tests/test_file_tools_limits.py
git commit -m "feat(tools): add output limits to FileTools (max 500 lines, 50 results)"
```

---

### Task 1.5: 集成 ContextMonitor 和 SlidingWindow 到 client.py

**Files:**
- Modify: `backend/llm/client.py`
- Create: `backend/tests/test_client_context_integration.py`

- [ ] **Step 1: 添加 token 提取函数**

在 `backend/llm/client.py` 中添加：

```python
# 在文件开头，import 之后添加

from backend.llm.context_monitor import ContextMonitor
from backend.llm.sliding_window import SlidingWindow


def extract_token_usage(response, provider: str) -> tuple[int, int]:
    """从 API 响应中提取 token 使用量。

    Args:
        response: API 响应对象
        provider: LLM 提供商

    Returns:
        (input_tokens, output_tokens)
    """
    if not hasattr(response, 'usage') or response.usage is None:
        return 0, 0

    if provider == "anthropic":
        return (
            getattr(response.usage, 'input_tokens', 0),
            getattr(response.usage, 'output_tokens', 0),
        )
    else:  # OpenAI 兼容接口
        return (
            getattr(response.usage, 'prompt_tokens', 0),
            getattr(response.usage, 'completion_tokens', 0),
        )
```

- [ ] **Step 2: 修改 tool_call_loop 方法签名**

```python
# 修改 tool_call_loop 方法签名，添加可选参数

def tool_call_loop(
    self,
    system: str,
    messages: list[dict],
    tools: list[dict],
    max_iterations: int = 20,
    tool_executor: Any = None,
    context_monitor: ContextMonitor = None,  # 新增：可选的上下文监控器
) -> ToolCallLoopResult:
    """执行工具调用循环。

    Args:
        system: 系统提示词
        messages: 消息历史
        tools: 工具定义列表
        max_iterations: 最大迭代次数
        tool_executor: 工具执行器（可选）
        context_monitor: 上下文监控器（可选）

    Returns:
        ToolCallLoopResult
    """
    # ... 现有代码 ...
```

- [ ] **Step 3: 在 tool_call_loop 中集成监控和滑动窗口**

在 `tool_call_loop` 方法中，在 `while iterations < max_iterations:` 循环内添加：

```python
# 在 while 循环开始处添加（在 try 之前）

# 检查是否需要应用滑动窗口
if context_monitor and context_monitor.should_apply_sliding_window():
    sliding_window = SlidingWindow()
    current_messages, truncated = sliding_window.apply(current_messages, self.provider)
    if truncated:
        logger.warning(f"应用滑动窗口，裁剪早期历史")
```

- [ ] **Step 4: 在 API 调用后记录 token 使用**

在 Anthropic 响应处理部分（约第 205 行附近），添加 token 记录：

```python
# 在 response = client.messages.create(...) 之后

# 记录 token 使用量
if context_monitor:
    input_tok, output_tok = extract_token_usage(response, self.provider)
    state = context_monitor.record_usage(input_tok, output_tok)
    logger.debug(f"Token 使用: {state.input_tokens} ({state.usage_ratio:.1%})")
```

同样在 OpenAI 兼容接口部分添加类似的 token 记录逻辑。

- [ ] **Step 5: 编写集成测试**

```python
# backend/tests/test_client_context_integration.py

import pytest
from unittest.mock import MagicMock, patch

from backend.llm.client import LLMClient, extract_token_usage
from backend.llm.context_monitor import ContextMonitor


class TestExtractTokenUsage:
    """token 提取函数测试。"""

    def test_anthropic_response(self):
        """Anthropic API 响应提取。"""
        response = MagicMock()
        response.usage.input_tokens = 100
        response.usage.output_tokens = 50

        input_tok, output_tok = extract_token_usage(response, "anthropic")

        assert input_tok == 100
        assert output_tok == 50

    def test_openai_response(self):
        """OpenAI API 响应提取。"""
        response = MagicMock()
        response.usage.prompt_tokens = 100
        response.usage.completion_tokens = 50

        input_tok, output_tok = extract_token_usage(response, "openai")

        assert input_tok == 100
        assert output_tok == 50

    def test_no_usage_field(self):
        """无 usage 字段时返回 0。"""
        response = MagicMock()
        response.usage = None

        input_tok, output_tok = extract_token_usage(response, "anthropic")

        assert input_tok == 0
        assert output_tok == 0


class TestClientContextIntegration:
    """client.py 上下文集成测试。"""

    def test_context_monitor_optional(self):
        """context_monitor 参数可选。"""
        # 无 context_monitor 时正常工作
        client = LLMClient(provider="anthropic", api_key="test")
        # 验证方法签名包含参数
        import inspect
        sig = inspect.signature(client.tool_call_loop)
        assert "context_monitor" in sig.parameters
```

- [ ] **Step 6: 运行测试验证**

Run: `cd code-graph-system && python -m pytest backend/tests/test_client_context_integration.py -v`
Expected: 所有测试 PASS

- [ ] **Step 7: Commit**

```bash
git add backend/llm/client.py backend/tests/test_client_context_integration.py
git commit -m "feat(llm): integrate ContextMonitor and SlidingWindow into tool_call_loop"
```

---

### Task 1.6: 更新 Agent 使用 ContextMonitor

**Files:**
- Modify: `backend/agent/agents/architecture.py`（示例 Agent）
- Modify: `backend/agent/orchestrator.py`

- [ ] **Step 1: 在 AgentOrchestrator 中创建 ContextMonitor**

在 `backend/agent/orchestrator.py` 的 `__init__` 方法中：

```python
from backend.llm.context_monitor import ContextMonitor

class AgentOrchestrator:
    def __init__(
        self,
        repo_path: str,
        llm_client: LLMClient,
        max_iterations: int = 20,
        on_progress: Optional[Callable[[dict], None]] = None,
        context_window: int = 128000,  # 新增参数
    ):
        self.repo_path = Path(repo_path).resolve()
        self.llm_client = llm_client
        self.max_iterations = max_iterations
        self.on_progress = on_progress

        self.shared_knowledge = SharedKnowledgeBase()
        self.context_monitor = ContextMonitor(max_tokens=context_window)
```

- [ ] **Step 2: 在 Agent 中传递 context_monitor**

在 Agent 的 `run` 方法中调用 `tool_call_loop` 时传递监控器：

```python
# 在 architecture.py 的 run 方法中

result = self.llm_client.tool_call_loop(
    system=self.get_system_prompt(),
    messages=messages,
    tools=self._tools,
    max_iterations=self.context.max_iterations,
    tool_executor=self._file_tools,
    context_monitor=self.context.context_monitor,  # 新增
)
```

- [ ] **Step 3: 在 AgentContext 中添加 context_monitor**

在 `backend/agent/context.py` 的 `AgentContext` 中添加字段：

```python
@dataclass
class AgentContext:
    repo_path: str
    module_id: str
    shared_knowledge: SharedKnowledgeBase
    max_iterations: int = 20
    context_monitor: Optional[ContextMonitor] = None  # 新增
```

- [ ] **Step 4: Commit**

```bash
git add backend/agent/orchestrator.py backend/agent/context.py backend/agent/agents/architecture.py
git commit -m "feat(agent): pass ContextMonitor through AgentContext"
```

---

### Task 1.7: Phase 1 验收测试

**Files:**
- Create: `backend/tests/test_phase1_acceptance.py`

- [ ] **Step 1: 编写验收测试**

```python
# backend/tests/test_phase1_acceptance.py

"""Phase 1 验收测试。

验证：
1. ContextMonitor 正确追踪 token
2. SlidingWindow 正确裁剪消息
3. FileTools 输出被限制
4. 组件正确集成
"""

import pytest
from backend.llm.context_monitor import ContextMonitor
from backend.llm.sliding_window import SlidingWindow


class TestPhase1Acceptance:
    """Phase 1 验收测试。"""

    def test_token_monitoring_workflow(self):
        """完整 token 监控流程。"""
        monitor = ContextMonitor(max_tokens=1000)

        # 模拟多次 LLM 调用
        for i in range(10):
            state = monitor.record_usage(100, 50)
            if i < 5:
                assert state.status == "normal"
            elif i < 7:
                assert state.status in ("normal", "warning")
            else:
                assert state.status in ("warning", "critical", "exceeded")

    def test_sliding_window_integration(self):
        """滑动窗口集成测试。"""
        monitor = ContextMonitor(max_tokens=1000)
        window = SlidingWindow(keep_recent_rounds=3, keep_first_messages=1)

        # 模拟消息累积
        messages = [{"role": "user", "content": "Task"}]
        for i in range(20):
            messages.append({"role": "assistant", "content": f"Response {i}"})
            messages.append({"role": "user", "content": f"Result {i}"})

        # 模拟达到 critical 状态
        monitor.record_usage(800, 0)
        assert monitor.should_apply_sliding_window()

        # 应用滑动窗口
        result, truncated = window.apply(messages, "anthropic")
        assert truncated
        assert len(result) < len(messages)

    def test_components_work_together(self):
        """组件协同工作测试。"""
        monitor = ContextMonitor(max_tokens=1000)
        window = SlidingWindow(keep_recent_rounds=2, keep_first_messages=1)

        messages = [{"role": "user", "content": "Task"}]
        for i in range(10):
            messages.append({"role": "assistant", "content": f"R{i}"})
            messages.append({"role": "user", "content": f"T{i}"})

        # 模拟达到阈值
        monitor.record_usage(800, 0)

        if monitor.should_apply_sliding_window():
            result, _ = window.apply(messages, "anthropic")
            assert len(result) < len(messages)
```

- [ ] **Step 2: 运行验收测试**

Run: `cd code-graph-system && python -m pytest backend/tests/test_phase1_acceptance.py -v`
Expected: 所有测试 PASS

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_phase1_acceptance.py
git commit -m "test: add Phase 1 acceptance tests"
```

---

## Phase 1 完成检查点

- [ ] 所有测试通过
- [ ] 代码已提交
- [ ] 可以继续 Phase 2

---

## Chunk 2: Phase 2 - 模块级检查点 + 用户可配置分析深度

### Task 2.1: 创建 ModuleCheckpoint 和 CheckpointManager

**Files:**
- Create: `backend/agent/checkpoint.py`
- Create: `backend/tests/test_checkpoint.py`

- [ ] **Step 1: 编写 CheckpointManager 测试**

```python
# backend/tests/test_checkpoint.py

import pytest
import tempfile
import json
from pathlib import Path

from backend.agent.checkpoint import ModuleCheckpoint, CheckpointManager


class TestModuleCheckpoint:
    """ModuleCheckpoint 测试。"""

    def test_create_checkpoint(self):
        """创建检查点。"""
        checkpoint = ModuleCheckpoint(
            module_id="module:api",
            module_name="API Module",
            nodes=[{"id": "node:1", "type": "Class"}],
            edges=[{"from": "node:1", "to": "node:2", "type": "calls"}],
            knowledge={"modules": [{"id": "module:api"}]},
            status="completed",
            created_at="2026-03-17T10:00:00",
            token_usage={"input": 1000, "output": 500},
        )

        assert checkpoint.module_id == "module:api"
        assert checkpoint.status == "completed"
        assert len(checkpoint.nodes) == 1

    def test_to_dict(self):
        """转换为字典。"""
        checkpoint = ModuleCheckpoint(
            module_id="module:api",
            module_name="API Module",
            nodes=[],
            edges=[],
            knowledge={},
            status="completed",
            created_at="2026-03-17T10:00:00",
            token_usage={},
        )

        data = checkpoint.to_dict()
        assert isinstance(data, dict)
        assert data["module_id"] == "module:api"


class TestCheckpointManager:
    """CheckpointManager 测试。"""

    def test_save_and_load(self):
        """保存和加载检查点。"""
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = CheckpointManager(repo_name="test-repo", storage_dir=tmpdir)

            checkpoint = ModuleCheckpoint(
                module_id="module:api",
                module_name="API Module",
                nodes=[{"id": "node:1"}],
                edges=[],
                knowledge={},
                status="completed",
                created_at="2026-03-17T10:00:00",
                token_usage={},
            )

            # 保存
            filepath = manager.save(checkpoint)
            assert Path(filepath).exists()

            # 加载
            loaded = manager.load("module:api")
            assert loaded is not None
            assert loaded.module_id == "module:api"
            assert loaded.module_name == "API Module"

    def test_get_all_results(self):
        """合并所有检查点结果。"""
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = CheckpointManager(repo_name="test-repo", storage_dir=tmpdir)

            # 保存多个检查点
            for i in range(3):
                checkpoint = ModuleCheckpoint(
                    module_id=f"module:{i}",
                    module_name=f"Module {i}",
                    nodes=[{"id": f"node:{i}"}],
                    edges=[{"from": f"node:{i}", "to": f"node:{i+1}", "type": "calls"}],
                    knowledge={},
                    status="completed",
                    created_at="2026-03-17T10:00:00",
                    token_usage={},
                )
                manager.save(checkpoint)

            # 获取所有结果
            nodes, edges = manager.get_all_results()
            assert len(nodes) == 3
            assert len(edges) == 3

    def test_list_pending_modules(self):
        """列出待分析的模块。"""
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = CheckpointManager(repo_name="test-repo", storage_dir=tmpdir)

            # 保存已完成的检查点
            checkpoint = ModuleCheckpoint(
                module_id="module:api",
                module_name="API Module",
                nodes=[],
                edges=[],
                knowledge={},
                status="completed",
                created_at="2026-03-17T10:00:00",
                token_usage={},
            )
            manager.save(checkpoint)

            # 列出待分析模块
            all_modules = ["module:api", "module:core", "module:db"]
            pending = manager.list_pending_modules(all_modules)

            assert "module:api" not in pending
            assert "module:core" in pending
            assert "module:db" in pending

    def test_clear(self):
        """清理检查点。"""
        with tempfile.TemporaryDirectory() as tmpdir:
            manager = CheckpointManager(repo_name="test-repo", storage_dir=tmpdir)

            checkpoint = ModuleCheckpoint(
                module_id="module:api",
                module_name="API Module",
                nodes=[],
                edges=[],
                knowledge={},
                status="completed",
                created_at="2026-03-17T10:00:00",
                token_usage={},
            )
            manager.save(checkpoint)

            # 清理
            manager.clear()

            # 验证已清理
            assert manager.load("module:api") is None
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd code-graph-system && python -m pytest backend/tests/test_checkpoint.py -v`
Expected: FAIL (模块不存在)

- [ ] **Step 3: 实现 Checkpoint 模块**

```python
# backend/agent/checkpoint.py

"""模块级检查点管理。

保存和恢复模块分析状态，支持大型仓库的分段分析。
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field, asdict
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)


@dataclass
class ModuleCheckpoint:
    """模块分析检查点。"""

    module_id: str
    module_name: str
    nodes: list[dict] = field(default_factory=list)
    edges: list[dict] = field(default_factory=list)
    knowledge: dict = field(default_factory=dict)
    status: str = "pending"  # "pending" | "completed" | "partial" | "failed"
    created_at: str = ""
    token_usage: dict = field(default_factory=dict)

    def __post_init__(self):
        if not self.created_at:
            self.created_at = datetime.now().isoformat()

    def to_dict(self) -> dict:
        """转换为字典。"""
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> "ModuleCheckpoint":
        """从字典创建。"""
        return cls(**data)


class CheckpointManager:
    """检查点管理器。

    职责：
    - 保存/加载检查点
    - 合并所有检查点的结果
    - 聚合共享知识
    """

    def __init__(self, repo_name: str, storage_dir: str = "data/checkpoints"):
        """初始化检查点管理器。

        Args:
            repo_name: 仓库名称
            storage_dir: 存储目录
        """
        self.repo_name = repo_name
        self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self.checkpoints: dict[str, ModuleCheckpoint] = {}

    def save(self, checkpoint: ModuleCheckpoint) -> str:
        """保存检查点。

        Args:
            checkpoint: 检查点对象

        Returns:
            保存的文件路径
        """
        self.checkpoints[checkpoint.module_id] = checkpoint

        # 持久化到磁盘
        checkpoint_file = self.storage_dir / f"{self.repo_name}_{checkpoint.module_id.replace(':', '_')}.json"
        with open(checkpoint_file, 'w', encoding='utf-8') as f:
            json.dump(checkpoint.to_dict(), f, ensure_ascii=False, indent=2)

        logger.info(f"检查点已保存: {checkpoint.module_id}")
        return str(checkpoint_file)

    def load(self, module_id: str) -> Optional[ModuleCheckpoint]:
        """加载检查点。

        Args:
            module_id: 模块 ID

        Returns:
            检查点对象，不存在则返回 None
        """
        if module_id in self.checkpoints:
            return self.checkpoints[module_id]

        # 尝试从磁盘加载
        checkpoint_file = self.storage_dir / f"{self.repo_name}_{module_id.replace(':', '_')}.json"
        if checkpoint_file.exists():
            with open(checkpoint_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
            checkpoint = ModuleCheckpoint.from_dict(data)
            self.checkpoints[module_id] = checkpoint
            return checkpoint

        return None

    def get_all_results(self) -> tuple[list[dict], list[dict]]:
        """合并所有检查点的结果。

        Returns:
            (所有节点列表, 所有边列表)
        """
        all_nodes = []
        all_edges = []
        for checkpoint in self.checkpoints.values():
            all_nodes.extend(checkpoint.nodes)
            all_edges.extend(checkpoint.edges)
        return all_nodes, all_edges

    def get_aggregated_knowledge(self) -> dict:
        """聚合所有检查点的共享知识。

        Returns:
            聚合的知识字典
        """
        aggregated = {
            "modules": [],
            "layers": [],
            "services": [],
            "api_endpoints": [],
        }
        for checkpoint in self.checkpoints.values():
            for key in aggregated:
                if key in checkpoint.knowledge:
                    existing_ids = {item.get("id") for item in aggregated[key]}
                    for item in checkpoint.knowledge.get(key, []):
                        if item.get("id") not in existing_ids:
                            aggregated[key].append(item)
        return aggregated

    def list_completed_modules(self) -> list[str]:
        """列出已完成的模块 ID。"""
        return [
            cp.module_id
            for cp in self.checkpoints.values()
            if cp.status == "completed"
        ]

    def list_pending_modules(self, all_modules: list[str]) -> list[str]:
        """列出待分析的模块 ID。

        Args:
            all_modules: 所有模块 ID 列表

        Returns:
            待分析的模块 ID 列表
        """
        completed = set(self.list_completed_modules())
        return [m for m in all_modules if m not in completed]

    def clear(self) -> None:
        """清理所有检查点。"""
        # 清理内存
        self.checkpoints.clear()

        # 清理磁盘
        for file in self.storage_dir.glob(f"{self.repo_name}_*.json"):
            file.unlink()

        logger.info(f"检查点已清理: {self.repo_name}")
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd code-graph-system && python -m pytest backend/tests/test_checkpoint.py -v`
Expected: 所有测试 PASS

- [ ] **Step 5: Commit**

```bash
git add backend/agent/checkpoint.py backend/tests/test_checkpoint.py
git commit -m "feat(agent): add ModuleCheckpoint and CheckpointManager"
```

---

### Task 2.2: 创建分析预设配置

**Files:**
- Create: `backend/agent/config.py`
- Create: `backend/tests/test_agent_config.py`

- [ ] **Step 1: 编写配置测试**

```python
# backend/tests/test_agent_config.py

import pytest
from backend.agent.config import AnalysisConfig, AnalysisPreset, ANALYSIS_PRESETS


class TestAnalysisConfig:
    """AnalysisConfig 测试。"""

    def test_default_preset(self):
        """默认使用 standard 预设。"""
        config = AnalysisConfig()
        assert config.preset == AnalysisPreset.STANDARD

    def test_preset_values(self):
        """预设值正确。"""
        quick_config = AnalysisConfig(preset=AnalysisPreset.QUICK)
        assert quick_config.max_modules == 10
        assert quick_config.max_iterations_per_module == 5

        deep_config = AnalysisConfig(preset=AnalysisPreset.DEEP)
        assert deep_config.max_modules is None
        assert deep_config.max_iterations_per_module == 20

    def test_custom_values(self):
        """自定义值覆盖预设。"""
        config = AnalysisConfig(
            preset=AnalysisPreset.STANDARD,
            max_modules=100,
        )
        assert config.max_modules == 100

    def test_context_management_config(self):
        """上下文管理配置。"""
        config = AnalysisConfig(preset=AnalysisPreset.DEEP)
        assert config.enable_summary is True
        assert config.sliding_window_threshold == 0.75


class TestAnalysisPresets:
    """预设定义测试。"""

    def test_all_presets_defined(self):
        """所有预设都已定义。"""
        for preset in AnalysisPreset:
            assert preset.value in ANALYSIS_PRESETS

    def test_preset_structure(self):
        """预设结构正确。"""
        for preset_name, preset_config in ANALYSIS_PRESETS.items():
            assert "max_modules" in preset_config
            assert "max_iterations_per_module" in preset_config
            assert "agents" in preset_config
            assert "context_management" in preset_config
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd code-graph-system && python -m pytest backend/tests/test_agent_config.py -v`
Expected: FAIL (模块不存在)

- [ ] **Step 3: 实现配置模块**

```python
# backend/agent/config.py

"""分析配置和预设。

定义快速、标准、深度三种分析预设。
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional, List


class AnalysisPreset(str, Enum):
    """分析预设。"""
    QUICK = "quick"
    STANDARD = "standard"
    DEEP = "deep"


# 预设配置定义
ANALYSIS_PRESETS = {
    "quick": {
        "description": "快速扫描，仅分析核心模块",
        "max_modules": 10,
        "max_iterations_per_module": 5,
        "agents": ["module_detector", "architecture"],
        "checkpoint_interval": 5,
        "context_management": {
            "enable_summary": False,
            "sliding_window_threshold": 0.9,
        },
    },
    "standard": {
        "description": "标准分析，平衡速度和深度",
        "max_modules": 50,
        "max_iterations_per_module": 15,
        "agents": ["module_detector", "architecture", "call_graph", "api_endpoint"],
        "checkpoint_interval": 3,
        "context_management": {
            "enable_summary": True,
            "sliding_window_threshold": 0.75,
        },
    },
    "deep": {
        "description": "深度分析，完整扫描所有模块",
        "max_modules": None,  # 无限制
        "max_iterations_per_module": 20,
        "agents": "all",
        "checkpoint_interval": 1,
        "context_management": {
            "enable_summary": True,
            "sliding_window_threshold": 0.75,
            "summary_threshold": 0.85,
        },
    },
}


@dataclass
class AnalysisConfig:
    """分析配置。"""

    preset: AnalysisPreset = AnalysisPreset.STANDARD
    max_modules: Optional[int] = None
    max_iterations_per_module: int = 15
    agents: List[str] = field(default_factory=list)
    checkpoint_interval: int = 3
    enable_summary: bool = True
    sliding_window_threshold: float = 0.75
    summary_threshold: float = 0.85
    context_window: int = 128000

    def __post_init__(self):
        """从预设加载默认值。"""
        preset_config = ANALYSIS_PRESETS.get(self.preset.value, {})

        # 只在未显式设置时使用预设值
        if self.max_modules is None:
            self.max_modules = preset_config.get("max_modules")
        if not self.agents:
            self.agents = preset_config.get("agents", [])

        # 加载上下文管理配置
        context_config = preset_config.get("context_management", {})
        self.enable_summary = context_config.get("enable_summary", True)
        self.sliding_window_threshold = context_config.get(
            "sliding_window_threshold", 0.75
        )
        self.summary_threshold = context_config.get("summary_threshold", 0.85)

    @classmethod
    def from_preset(cls, preset: str) -> "AnalysisConfig":
        """从预设名称创建配置。

        Args:
            preset: 预设名称 ("quick" | "standard" | "deep")

        Returns:
            AnalysisConfig
        """
        return cls(preset=AnalysisPreset(preset))
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd code-graph-system && python -m pytest backend/tests/test_agent_config.py -v`
Expected: 所有测试 PASS

- [ ] **Step 5: Commit**

```bash
git add backend/agent/config.py backend/tests/test_agent_config.py
git commit -m "feat(agent): add AnalysisConfig with quick/standard/deep presets"
```

---

### Task 2.3: 集成 CheckpointManager 到 AgentOrchestrator

**Files:**
- Modify: `backend/agent/orchestrator.py`
- Create: `backend/tests/test_orchestrator_checkpoint.py`

- [ ] **Step 1: 编写集成测试**

```python
# backend/tests/test_orchestrator_checkpoint.py

import pytest
from unittest.mock import MagicMock, patch
import tempfile

from backend.agent.orchestrator import AgentOrchestrator
from backend.agent.config import AnalysisConfig, AnalysisPreset
from backend.llm.client import LLMClient


class TestOrchestratorCheckpoint:
    """Orchestrator 检查点集成测试。"""

    @pytest.fixture
    def mock_llm_client(self):
        """创建模拟 LLM 客户端。"""
        client = MagicMock(spec=LLMClient)
        client.provider = "anthropic"
        return client

    def test_orchestrator_with_checkpoint_enabled(self, mock_llm_client):
        """检查点功能启用。"""
        with tempfile.TemporaryDirectory() as tmpdir:
            orchestrator = AgentOrchestrator(
                repo_path=tmpdir,
                llm_client=mock_llm_client,
                config=AnalysisConfig(preset=AnalysisPreset.STANDARD),
            )
            assert orchestrator.checkpoint_manager is not None

    def test_orchestrator_respects_max_modules(self, mock_llm_client):
        """遵守 max_modules 限制。"""
        with tempfile.TemporaryDirectory() as tmpdir:
            config = AnalysisConfig(preset=AnalysisPreset.QUICK)
            orchestrator = AgentOrchestrator(
                repo_path=tmpdir,
                llm_client=mock_llm_client,
                config=config,
            )
            assert orchestrator.config.max_modules == 10

    def test_context_monitor_reset_between_modules(self, mock_llm_client):
        """模块间重置上下文监控器。"""
        with tempfile.TemporaryDirectory() as tmpdir:
            orchestrator = AgentOrchestrator(
                repo_path=tmpdir,
                llm_client=mock_llm_client,
                config=AnalysisConfig(),
            )

            # 模拟 token 使用
            orchestrator.context_monitor.record_usage(1000, 500)
            assert orchestrator.context_monitor.total_input == 1000

            # 重置
            orchestrator._reset_context_monitor()
            assert orchestrator.context_monitor.total_input == 0
```

- [ ] **Step 2: 修改 Orchestrator**

在 `backend/agent/orchestrator.py` 中：

```python
# 添加导入
from backend.agent.checkpoint import CheckpointManager, ModuleCheckpoint
from backend.agent.config import AnalysisConfig, AnalysisPreset

# 修改 __init__
class AgentOrchestrator:
    def __init__(
        self,
        repo_path: str,
        llm_client: LLMClient,
        max_iterations: int = 20,
        on_progress: Optional[Callable[[dict], None]] = None,
        config: AnalysisConfig = None,
    ):
        self.repo_path = Path(repo_path).resolve()
        self.llm_client = llm_client
        self.config = config or AnalysisConfig()
        self.max_iterations = self.config.max_iterations_per_module
        self.on_progress = on_progress

        self.shared_knowledge = SharedKnowledgeBase()
        self.context_monitor = ContextMonitor(max_tokens=self.config.context_window)
        self.checkpoint_manager: Optional[CheckpointManager] = None

    def _reset_context_monitor(self) -> None:
        """重置上下文监控器。"""
        self.context_monitor.reset()

    def run_module_analysis(
        self,
        modules: list[dict],
        repo_name: str = None,
    ) -> OrchestratorResult:
        """运行模块级分析（带检查点）。"""
        if repo_name:
            self.checkpoint_manager = CheckpointManager(repo_name)

        # 应用 max_modules 限制
        if self.config.max_modules:
            modules = modules[:self.config.max_modules]

        all_nodes = []
        all_edges = []
        module_outputs = {}

        for i, module in enumerate(modules):
            module_id = module.get("id", f"module_{i}")
            module_name = module.get("name", f"Module {i}")

            logger.info(f"分析模块 {i+1}/{len(modules)}: {module_name}")

            # 创建新的上下文
            context = self._create_context(module_id)
            context.context_monitor = self.context_monitor

            # 注入聚合的共享知识
            if self.checkpoint_manager:
                aggregated = self.checkpoint_manager.get_aggregated_knowledge()
                context.shared_knowledge.modules = aggregated.get("modules", [])
                context.shared_knowledge.layers = aggregated.get("layers", [])

            # 运行 Agent（示例：ArchitectureAgent）
            agent = ArchitectureAgent(context=context, llm_client=self.llm_client)
            output = agent.run()
            module_outputs[module_id] = output

            # 保存检查点
            if self.checkpoint_manager:
                checkpoint = ModuleCheckpoint(
                    module_id=module_id,
                    module_name=module_name,
                    nodes=[{"id": n.id, "type": n.type, "name": n.name} for n in output.nodes],
                    edges=[{"from": e.from_, "to": e.to, "type": e.type} for e in output.edges],
                    knowledge={
                        "modules": context.shared_knowledge.modules,
                        "layers": context.shared_knowledge.layers,
                    },
                    status=output.status,
                    token_usage={
                        "input": self.context_monitor.total_input,
                        "output": self.context_monitor.total_output,
                    },
                )
                self.checkpoint_manager.save(checkpoint)

            # 模块间重置上下文监控器
            self._reset_context_monitor()

            if output.status == "success":
                all_nodes.extend(output.nodes)
                all_edges.extend(output.edges)

        return OrchestratorResult(
            status="success" if all_nodes else "partial",
            nodes=all_nodes,
            edges=all_edges,
            agent_outputs=module_outputs,
            meta={"checkpoint_enabled": self.checkpoint_manager is not None},
        )
```

- [ ] **Step 3: 运行测试验证通过**

Run: `cd code-graph-system && python -m pytest backend/tests/test_orchestrator_checkpoint.py -v`
Expected: 所有测试 PASS

- [ ] **Step 4: Commit**

```bash
git add backend/agent/orchestrator.py backend/tests/test_orchestrator_checkpoint.py
git commit -m "feat(agent): integrate CheckpointManager into AgentOrchestrator"
```

---

### Task 2.4: API 支持深度参数

**Files:**
- Modify: `backend/api/server.py`

- [ ] **Step 1: 修改 API 端点**

在 `/analyze/repository` 端点添加 `depth` 参数：

```python
# 在 server.py 中修改 analyze_repository 端点

from backend.agent.config import AnalysisConfig, AnalysisPreset

@app.post("/analyze/repository")
async def analyze_repository(
    path: str,
    name: Optional[str] = None,
    depth: str = "standard",  # 新增：quick | standard | deep
    enable_rag: bool = False,
):
    """分析代码仓库。

    Args:
        path: 仓库路径
        name: 仓库名称
        depth: 分析深度 (quick | standard | deep)
        enable_rag: 是否启用 RAG
    """
    config = AnalysisConfig.from_preset(depth)

    # 使用 config 进行分析
    # ...
```

- [ ] **Step 2: 测试 API**

Run: `curl -X POST "http://localhost:8000/analyze/repository?path=/tmp/test&depth=quick"`
Expected: 返回分析结果

- [ ] **Step 3: Commit**

```bash
git add backend/api/server.py
git commit -m "feat(api): add depth parameter to /analyze/repository endpoint"
```

---

## Phase 2 完成检查点

- [ ] 所有测试通过
- [ ] 代码已提交
- [ ] 可以继续 Phase 3

---

## Chunk 3: Phase 3 - 智能摘要压缩（可选）

### Task 3.1: 创建 HistorySummarizer

**Files:**
- Create: `backend/llm/summarizer.py`
- Create: `backend/tests/test_summarizer.py`

- [ ] **Step 1: 编写 Summarizer 测试**

```python
# backend/tests/test_summarizer.py

import pytest
from unittest.mock import MagicMock

from backend.llm.summarizer import HistorySummarizer, CompressionResult


class TestHistorySummarizer:
    """HistorySummarizer 测试。"""

    @pytest.fixture
    def mock_llm_client(self):
        """创建模拟 LLM 客户端。"""
        client = MagicMock()
        client.complete.return_value = "已分析 UserService.java，发现 UserService 类。"
        return client

    def test_should_compress_few_messages(self, mock_llm_client):
        """消息数量少时不压缩。"""
        summarizer = HistorySummarizer(mock_llm_client)
        messages = [{"role": "user", "content": "Task"}]

        assert not summarizer.should_compress(messages, current_tokens=1000)

    def test_should_compress_enough_messages(self, mock_llm_client):
        """消息数量足够时压缩。"""
        summarizer = HistorySummarizer(mock_llm_client)
        messages = [{"role": "user", "content": "Task"}]
        for i in range(10):
            messages.append({"role": "assistant", "content": f"R{i}"})
            messages.append({"role": "user", "content": f"T{i}"})

        assert summarizer.should_compress(messages, current_tokens=100000)

    def test_compress_messages(self, mock_llm_client):
        """压缩消息。"""
        summarizer = HistorySummarizer(mock_llm_client)
        messages = [{"role": "user", "content": "Task"}]
        for i in range(10):
            messages.append({"role": "assistant", "content": f"R{i}"})
            messages.append({"role": "user", "content": f"T{i}"})

        result = summarizer.compress(messages)

        assert isinstance(result, CompressionResult)
        assert len(result.compressed_messages) < len(messages)
        assert result.compression_ratio < 1.0

    def test_fallback_on_error(self, mock_llm_client):
        """LLM 失败时降级。"""
        mock_llm_client.complete.side_effect = Exception("API Error")
        summarizer = HistorySummarizer(mock_llm_client)
        messages = [{"role": "user", "content": "Task"}]
        for i in range(10):
            messages.append({"role": "assistant", "content": f"R{i}"})
            messages.append({"role": "user", "content": f"T{i}"})

        result = summarizer.compress(messages)

        # 应该降级到滑动窗口
        assert len(result.compressed_messages) < len(messages)
```

- [ ] **Step 2: 实现 Summarizer**

```python
# backend/llm/summarizer.py

"""历史摘要压缩器。

使用 LLM 将早期工具调用历史压缩为简洁摘要。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Optional

logger = logging.getLogger(__name__)


@dataclass
class CompressionResult:
    """压缩结果。"""
    original_messages: list[dict]
    compressed_messages: list[dict]
    summary: str
    original_tokens: int
    compressed_tokens: int
    compression_ratio: float


class HistorySummarizer:
    """历史摘要压缩器。"""

    SUMMARY_PROMPT = """你是一个代码分析助手。请将以下工具调用历史压缩为简洁的摘要。

## 要求
1. 保留关键发现：已分析的文件、发现的类/方法、识别的依赖关系
2. 保留未完成项：待确认的问题、未探索的路径
3. 省略具体代码内容，只保留结构信息
4. 使用简洁的列表格式

## 工具调用历史
{history}

## 输出格式
直接输出摘要文本，不要 JSON 或代码块。"""

    def __init__(
        self,
        llm_client: Any,
        max_summary_tokens: int = 2000,
        keep_recent: int = 4,
        keep_first: int = 1,
    ):
        self.llm_client = llm_client
        self.max_summary_tokens = max_summary_tokens
        self.keep_recent = keep_recent
        self.keep_first = keep_first

    def should_compress(
        self,
        messages: list[dict],
        current_tokens: int,
        threshold_ratio: float = 0.7,
        min_messages: int = 6,
    ) -> bool:
        """判断是否需要压缩。"""
        if len(messages) < min_messages:
            return False
        compressible = len(messages) - self.keep_recent - self.keep_first
        return compressible > 0

    def compress(self, messages: list[dict]) -> CompressionResult:
        """压缩消息历史。"""
        first_part = messages[:self.keep_first]
        to_compress = messages[self.keep_first:-self.keep_recent]
        recent_part = messages[-self.keep_recent:]

        if not to_compress:
            return CompressionResult(
                original_messages=messages,
                compressed_messages=messages,
                summary="",
                original_tokens=0,
                compressed_tokens=0,
                compression_ratio=1.0,
            )

        # 尝试生成摘要
        try:
            history_text = self._format_history(to_compress)
            summary = self._generate_summary(history_text)
        except Exception as e:
            logger.warning(f"摘要生成失败，降级到滑动窗口: {e}")
            return self._fallback_sliding_window(messages)

        # 构建压缩后的消息
        summary_message = {
            "role": "user",
            "content": f"[历史摘要]\n{summary}",
        }

        compressed = first_part + [summary_message] + recent_part

        return CompressionResult(
            original_messages=messages,
            compressed_messages=compressed,
            summary=summary,
            original_tokens=self._estimate_tokens(messages),
            compressed_tokens=self._estimate_tokens(compressed),
            compression_ratio=len(compressed) / len(messages) if messages else 1.0,
        )

    def _format_history(self, messages: list[dict]) -> str:
        """格式化消息历史为文本。"""
        lines = []
        for msg in messages:
            role = msg.get("role", "unknown")
            content = msg.get("content", "")

            if isinstance(content, str):
                if len(content) > 500:
                    content = content[:500] + "...(truncated)"
                lines.append(f"[{role}] {content}")
            elif isinstance(content, list):
                for item in content:
                    if isinstance(item, dict) and item.get("type") == "tool_result":
                        tool_content = item.get("content", "")
                        if len(tool_content) > 300:
                            tool_content = tool_content[:300] + "..."
                        lines.append(f"[tool_result] {tool_content}")

        return "\n".join(lines)

    def _generate_summary(self, history_text: str) -> str:
        """调用 LLM 生成摘要。"""
        prompt = self.SUMMARY_PROMPT.format(history=history_text)

        summary = self.llm_client.complete(
            prompt=prompt,
            system="你是一个简洁的摘要生成器。",
            max_tokens=self.max_summary_tokens,
            temperature=0.3,
        )
        return summary.strip()

    def _fallback_sliding_window(self, messages: list[dict]) -> CompressionResult:
        """滑动窗口降级。"""
        from backend.llm.sliding_window import SlidingWindow

        window = SlidingWindow(
            keep_recent=self.keep_recent // 2,
            keep_first=self.keep_first,
        )
        compressed, _ = window.apply(messages, "anthropic")

        return CompressionResult(
            original_messages=messages,
            compressed_messages=compressed,
            summary="[摘要生成失败，已使用滑动窗口裁剪]",
            original_tokens=self._estimate_tokens(messages),
            compressed_tokens=self._estimate_tokens(compressed),
            compression_ratio=len(compressed) / len(messages) if messages else 1.0,
        )

    def _estimate_tokens(self, messages: list[dict]) -> int:
        """估算 token 数量。"""
        total_chars = 0
        for msg in messages:
            content = msg.get("content", "")
            if isinstance(content, str):
                total_chars += len(content)
            elif isinstance(content, list):
                for item in content:
                    if isinstance(item, dict):
                        total_chars += len(str(item.get("content", "")))
        return total_chars // 4
```

- [ ] **Step 3: 运行测试验证通过**

Run: `cd code-graph-system && python -m pytest backend/tests/test_summarizer.py -v`
Expected: 所有测试 PASS

- [ ] **Step 4: Commit**

```bash
git add backend/llm/summarizer.py backend/tests/test_summarizer.py
git commit -m "feat(llm): add HistorySummarizer for context compression"
```

---

### Task 3.2: 创建 ContextManager 统一入口

**Files:**
- Create: `backend/llm/context_manager.py`
- Create: `backend/tests/test_context_manager.py`

- [ ] **Step 1: 编写 ContextManager 测试**

```python
# backend/tests/test_context_manager.py

import pytest
from unittest.mock import MagicMock

from backend.llm.context_manager import ContextManager, ContextConfig
from backend.llm.context_monitor import ContextMonitor


class TestContextManager:
    """ContextManager 测试。"""

    @pytest.fixture
    def mock_llm_client(self):
        """创建模拟 LLM 客户端。"""
        return MagicMock()

    def test_initialization(self, mock_llm_client):
        """初始化正确。"""
        manager = ContextManager(llm_client=mock_llm_client)

        assert manager.monitor is not None
        assert manager.sliding_window is not None
        assert manager.summarizer is not None

    def test_record_usage(self, mock_llm_client):
        """记录 token 使用。"""
        manager = ContextManager(llm_client=mock_llm_client)
        state = manager.record_usage(100, 50)

        assert state.input_tokens == 100
        assert state.output_tokens == 50

    def test_process_messages_normal(self, mock_llm_client):
        """normal 状态不处理消息。"""
        manager = ContextManager(llm_client=mock_llm_client)
        messages = [{"role": "user", "content": "Task"}]

        result, strategy = manager.process_messages(messages, "anthropic")

        assert strategy == "none"
        assert result == messages

    def test_process_messages_critical(self, mock_llm_client):
        """critical 状态尝试压缩。"""
        manager = ContextManager(
            llm_client=mock_llm_client,
            config=ContextConfig(sliding_window_threshold=0.5),
        )

        # 模拟达到 critical 状态
        manager.monitor.record_usage(800, 0)

        messages = [{"role": "user", "content": "Task"}]
        for i in range(10):
            messages.append({"role": "assistant", "content": f"R{i}"})
            messages.append({"role": "user", "content": f"T{i}"})

        result, strategy = manager.process_messages(messages, "anthropic")

        assert strategy in ("summary", "sliding_window")
        assert len(result) < len(messages)
```

- [ ] **Step 2: 实现 ContextManager**

```python
# backend/llm/context_manager.py

"""统一上下文管理器。

整合 Monitor + SlidingWindow + Summarizer，提供统一入口。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Optional

from backend.llm.context_monitor import ContextMonitor, ContextState
from backend.llm.sliding_window import SlidingWindow

logger = logging.getLogger(__name__)


@dataclass
class ContextConfig:
    """上下文管理配置。"""
    max_tokens: int = 128000
    warning_threshold: float = 0.6
    sliding_window_threshold: float = 0.75
    summary_threshold: float = 0.85
    keep_recent_messages: int = 6
    keep_first_messages: int = 1
    enable_summary: bool = True


class ContextManager:
    """统一上下文管理器。"""

    def __init__(
        self,
        config: ContextConfig = None,
        llm_client: Any = None,
    ):
        self.config = config or ContextConfig()
        self.monitor = ContextMonitor(max_tokens=self.config.max_tokens)
        self.sliding_window = SlidingWindow(
            keep_recent=self.config.keep_recent_messages // 2,
            keep_first=self.config.keep_first_messages,
        )

        # 延迟导入避免循环依赖
        self.summarizer = None
        if llm_client and self.config.enable_summary:
            from backend.llm.summarizer import HistorySummarizer
            self.summarizer = HistorySummarizer(
                llm_client=llm_client,
                keep_recent=self.config.keep_recent_messages,
                keep_first=self.config.keep_first_messages,
            )

    def record_usage(self, input_tokens: int, output_tokens: int) -> ContextState:
        """记录 token 使用。"""
        return self.monitor.record_usage(input_tokens, output_tokens)

    def get_state(self) -> ContextState:
        """获取当前状态。"""
        return self.monitor.get_state()

    def process_messages(
        self,
        messages: list[dict],
        provider: str,
    ) -> tuple[list[dict], str]:
        """根据上下文状态处理消息。

        Returns:
            (处理后的消息列表, 采取的策略)
        """
        state = self.monitor.get_state()

        if state.status == "normal":
            return messages, "none"

        if state.status == "warning":
            logger.info(f"上下文使用率: {state.usage_ratio:.1%}")
            return messages, "none"

        if state.status in ("critical", "exceeded"):
            # 尝试摘要压缩
            if self.summarizer and state.status == "critical":
                if self.summarizer.should_compress(messages, state.input_tokens):
                    result = self.summarizer.compress(messages)
                    if result.compression_ratio < 0.7:
                        logger.info(f"应用摘要压缩: {result.original_tokens} -> {result.compressed_tokens}")
                        return result.compressed_messages, "summary"

            # 降级到滑动窗口
            compressed, truncated = self.sliding_window.apply(messages, provider)
            if truncated:
                logger.info(f"应用滑动窗口: {len(messages)} -> {len(compressed)} 条消息")
                return compressed, "sliding_window"

        return messages, "none"

    def reset(self) -> None:
        """重置上下文监控器。"""
        self.monitor.reset()
```

- [ ] **Step 3: 运行测试验证通过**

Run: `cd code-graph-system && python -m pytest backend/tests/test_context_manager.py -v`
Expected: 所有测试 PASS

- [ ] **Step 4: Commit**

```bash
git add backend/llm/context_manager.py backend/tests/test_context_manager.py
git commit -m "feat(llm): add ContextManager as unified context management entry"
```

---

## Phase 3 完成检查点

- [ ] 所有测试通过
- [ ] 代码已提交

---

## 最终验收

### 运行所有测试

```bash
cd code-graph-system
python -m pytest backend/tests/test_context_monitor.py \
                   backend/tests/test_sliding_window.py \
                   backend/tests/test_file_tools_limits.py \
                   backend/tests/test_client_context_integration.py \
                   backend/tests/test_checkpoint.py \
                   backend/tests/test_agent_config.py \
                   backend/tests/test_orchestrator_checkpoint.py \
                   backend/tests/test_summarizer.py \
                   backend/tests/test_context_manager.py \
                   backend/tests/test_phase1_acceptance.py \
                   -v
```

Expected: 所有测试 PASS

### 验收标准

1. **Phase 1**:
   - [ ] 2714 文件的仓库分析不再崩溃
   - [ ] 日志显示 token 使用监控信息
   - [ ] 工具输出被正确限制

2. **Phase 2**:
   - [ ] 模块间上下文正确重置
   - [ ] 检查点文件正确生成
   - [ ] `depth=quick` 参数生效

3. **Phase 3**:
   - [ ] 摘要压缩正确触发
   - [ ] 压缩后分析可继续进行
   - [ ] 分析质量无明显下降
