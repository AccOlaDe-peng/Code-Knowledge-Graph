"""LLM 类型定义。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class ToolCallRecord:
    """单次工具调用记录。"""

    iteration: int                     # 所属迭代
    tool_name: str                     # 工具名称
    tool_input: dict[str, Any]         # 输入参数
    tool_output: dict[str, Any]        # 输出结果
    success: bool                      # 是否成功
    execution_time_ms: int = 0         # 执行时间
    error: str | None = None           # 错误信息


@dataclass
class ToolCallLoopResult:
    """tool_call_loop 的返回结果。"""

    status: str                        # "completed" | "max_iterations" | "error"
    final_message: str | None          # 最终 LLM 消息（JSON 格式）
    tool_calls: list[ToolCallRecord] = field(default_factory=list)
    total_tokens: int = 0              # 总 Token 消耗
    iterations: int = 0                # 实际迭代次数
    errors: list[str] = field(default_factory=list)


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
    input_tokens: int = 0        # 本次请求的 input tokens（非累计）
    output_tokens: int = 0       # 本次请求的 output tokens（非累计）
    max_context: int = 128000    # 模型的最大上下文窗口
