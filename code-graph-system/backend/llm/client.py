"""统一 LLM 客户端。"""

from __future__ import annotations

import logging
import os
from typing import Any, TYPE_CHECKING

from backend.llm.types import ToolCallLoopResult

if TYPE_CHECKING:
    from backend.llm.context_monitor import ContextMonitor

logger = logging.getLogger(__name__)


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
    tool_executor_map: "dict | None",
    tool_executor: "Any | None",
) -> "Any":
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


class RateLimitExhaustedError(Exception):
    """连续 429 超过退避阈值后抛出，由 Orchestrator 上层处理。"""
    pass


def _is_rate_limit_error(e: Exception) -> bool:
    msg = str(e).lower()
    return "429" in msg or "rate_limit" in msg or "usage limit exceeded" in msg


# 退避配置（可通过环境变量覆盖）
RATE_LIMIT_MAX_CONSECUTIVE = int(os.environ.get("RATE_LIMIT_MAX_CONSECUTIVE", "5"))
RATE_LIMIT_BASE_WAIT = int(os.environ.get("RATE_LIMIT_BASE_WAIT_SECONDS", "5"))
RATE_LIMIT_MAX_WAIT = int(os.environ.get("RATE_LIMIT_MAX_WAIT_SECONDS", "120"))


def extract_token_usage(response: Any, provider: str) -> tuple[int, int]:
    """从 API 响应中提取 token 使用量。

    Args:
        response: LLM API 响应对象。
        provider: LLM 提供商 ("anthropic" | "openai" | "minimax" | "ollama")。

    Returns:
        (input_tokens, output_tokens) 元组。
    """
    if not hasattr(response, 'usage') or response.usage is None:
        return 0, 0

    if provider == "anthropic":
        return (
            getattr(response.usage, 'input_tokens', 0) or 0,
            getattr(response.usage, 'output_tokens', 0) or 0,
        )
    else:  # OpenAI 兼容接口 (openai, minimax, ollama)
        return (
            getattr(response.usage, 'prompt_tokens', 0) or 0,
            getattr(response.usage, 'completion_tokens', 0) or 0,
        )


class LLMClient:
    """统一 LLM 客户端接口。

    支持多个 Provider：Anthropic、OpenAI Compatible、本地模型。
    """

    def __init__(
        self,
        provider: str,
        model: str | None = None,
        api_key: str | None = None,
        base_url: str | None = None,
        max_tokens: int = 4096,
        temperature: float = 0.1,
    ):
        """初始化 LLM 客户端。

        Args:
            provider: LLM 提供商 ("anthropic" | "openai" | "ollama" | "minimax")
            model: 模型名称，None 则使用默认模型
            api_key: API 密钥
            base_url: 自定义 API 基础 URL
            max_tokens: 最大生成 Token 数
            temperature: 采样温度
        """
        self.provider = provider
        self.model = model or self._default_model(provider)
        self.api_key = api_key
        self.base_url = base_url
        self.max_tokens = max_tokens
        self.temperature = temperature
        self.context_window: int = 128000
        self._client: Any = None

    def _default_model(self, provider: str) -> str:
        """返回各提供商的默认模型。"""
        defaults = {
            "anthropic": "claude-sonnet-4-6",
            "openai": "gpt-4o",
            "ollama": "llama3.2",
            "minimax": "MiniMax-M2.5",
            "zhipu": "glm-4-plus",
        }
        return defaults.get(provider, "claude-sonnet-4-6")

    def _get_client(self) -> Any:
        """懒加载 LLM 客户端实例。"""
        if self._client is not None:
            return self._client

        if self.provider == "anthropic":
            try:
                import anthropic
                kwargs = {"api_key": self.api_key}
                if self.base_url:
                    kwargs["base_url"] = self.base_url
                self._client = anthropic.Anthropic(**kwargs)
            except ImportError:
                raise RuntimeError("anthropic 包未安装，请运行: pip install anthropic")

        elif self.provider in ("openai", "minimax"):
            try:
                import openai
                kwargs = {"api_key": self.api_key or "dummy"}
                if self.base_url:
                    kwargs["base_url"] = self.base_url
                self._client = openai.OpenAI(**kwargs)
            except ImportError:
                raise RuntimeError("openai 包未安装，请运行: pip install openai")

        elif self.provider == "ollama":
            try:
                import openai
                self._client = openai.OpenAI(
                    api_key="ollama",
                    base_url=self.base_url or "http://localhost:11434/v1",
                )
            except ImportError:
                raise RuntimeError("openai 包未安装（用于 Ollama 兼容接口）")

        elif self.provider == "zhipu":
            try:
                import openai
                base_url = self.base_url or "https://open.bigmodel.cn/api/paas/v4/"
                self._client = openai.OpenAI(api_key=self.api_key, base_url=base_url)
            except ImportError:
                raise RuntimeError("openai 包未安装，请运行: pip install openai")

        else:
            raise ValueError(f"不支持的 LLM 提供商: {self.provider}")

        return self._client

    def is_available(self) -> bool:
        """检查 LLM 服务是否可用。"""
        try:
            self._get_client()
            return True
        except Exception:
            return False

    def complete(
        self,
        prompt: str,
        system: str | None = None,
        max_tokens: int | None = None,
        temperature: float | None = None,
    ) -> str:
        """同步调用 LLM 生成文本。

        Args:
            prompt: 用户提示词
            system: 系统提示词
            max_tokens: 覆盖默认最大 Token 数
            temperature: 覆盖默认温度

        Returns:
            生成的文本内容
        """
        client = self._get_client()
        _max_tokens = max_tokens or self.max_tokens
        _temperature = temperature if temperature is not None else self.temperature

        if self.provider == "anthropic":
            response = client.messages.create(
                model=self.model,
                max_tokens=_max_tokens,
                temperature=_temperature,
                system=system or "你是一个代码分析专家。",
                messages=[{"role": "user", "content": prompt}],
            )
            # 提取文本内容
            text_parts = []
            if response.content:
                for block in response.content:
                    if hasattr(block, 'text'):
                        text_parts.append(block.text)
            return ''.join(text_parts) if text_parts else ""

        else:  # OpenAI 兼容接口
            messages = []
            if system:
                messages.append({"role": "system", "content": system})
            messages.append({"role": "user", "content": prompt})

            response = client.chat.completions.create(
                model=self.model,
                messages=messages,
                max_tokens=_max_tokens,
                temperature=_temperature,
            )
            return response.choices[0].message.content or ""

    def tool_call_loop(
        self,
        system: str,
        messages: list[dict],
        tools: list[dict],
        max_iterations: int = 20,
        tool_executor: Any = None,
        context_monitor: "ContextMonitor | None" = None,
        tool_executor_map: "dict[str, Any] | None" = None,  # 新增
    ) -> ToolCallLoopResult:
        """执行工具调用循环。

        Args:
            system: 系统提示词
            messages: 消息历史
            tools: 工具定义列表
            max_iterations: 最大迭代次数
            tool_executor: 工具执行器（可选），如果提供则执行工具
            context_monitor: 上下文监控器（可选），用于追踪 token 使用和触发滑动窗口

        Returns:
            ToolCallLoopResult
        """
        import json
        import time
        from backend.llm.types import ToolCallRecord

        client = self._get_client()
        tool_calls: list[ToolCallRecord] = []
        iterations = 0
        total_tokens = 0
        errors: list[str] = []

        # 复制消息历史
        current_messages = list(messages)

        consecutive_429 = 0
        while iterations < max_iterations:
            iterations += 1
            iteration_start = time.time()

            # Pre-flight token check: 发送前估算并按阈值压缩
            estimated = _estimate_tokens(system, current_messages)
            ratio = estimated / self.context_window if self.context_window > 0 else 0.0
            if ratio >= _COMPRESSION_L3:
                current_messages = _apply_compression(current_messages, level=3, provider=self.provider)
                logger.warning("Pre-flight Level 3 压缩（估算 %.0f%%）", ratio * 100)
            elif ratio >= _COMPRESSION_L2:
                current_messages = _apply_compression(current_messages, level=2, provider=self.provider)
                logger.info("Pre-flight Level 2 压缩（估算 %.0f%%）", ratio * 100)
            elif ratio >= _COMPRESSION_L1:
                current_messages = _apply_compression(current_messages, level=1, provider=self.provider)
                logger.info("Pre-flight Level 1 压缩（估算 %.0f%%）", ratio * 100)

            try:
                if self.provider == "anthropic":
                    response = client.messages.create(
                        model=self.model,
                        max_tokens=self.max_tokens,
                        temperature=self.temperature,
                        system=system,
                        messages=current_messages,
                        tools=tools,
                    )

                    consecutive_429 = 0  # 成功调用后重置
                    # 记录 token 使用量
                    if context_monitor:
                        input_tok, output_tok = extract_token_usage(response, self.provider)
                        state = context_monitor.record_usage(input_tok, output_tok)
                        logger.debug(f"本次请求 input tokens: {state.input_tokens} ({state.usage_ratio:.1%})")

                    # 检查停止原因
                    if response.stop_reason == "end_turn":
                        # 提取最终消息
                        final_message = None
                        if response.content:
                            for block in response.content:
                                if hasattr(block, 'text'):
                                    final_message = block.text
                                    break

                        return ToolCallLoopResult(
                            status="completed",
                            final_message=final_message,
                            tool_calls=tool_calls,
                            total_tokens=total_tokens,
                            iterations=iterations,
                        )

                    # 提取工具调用
                    tool_uses = []
                    if response.content:
                        tool_uses = [
                            block for block in response.content
                            if hasattr(block, 'type') and block.type == "tool_use"
                        ]

                    if not tool_uses:
                        # 当响应没有工具调用时，检查是否有文本内容
                        text_content = ""
                        if response.content:
                            for block in response.content:
                                if hasattr(block, 'text'):
                                    text_content += block.text
                        if text_content:
                            errors.append(f"LLM 响应没有工具调用，包含文本: {text_content[:200]}")
                        else:
                            errors.append("LLM 响应为空（无工具调用也无文本）")
                        continue

                    # 添加 assistant 消息
                    current_messages.append({"role": "assistant", "content": response.content})

                    # 执行工具
                    tool_results = []
                    for tool_use in tool_uses:
                        tool_name = tool_use.name
                        tool_input = dict(tool_use.input)

                        tool_output = {}
                        success = True
                        error_msg = None

                        try:
                            result = _dispatch_tool(
                                tool_name, tool_input, tool_executor_map, tool_executor
                            )
                            tool_output = result if isinstance(result, dict) else {"result": result}
                        except ValueError:
                            # No executor found for this tool - leave tool_output as empty dict
                            pass
                        except Exception as e:
                            success = False
                            error_msg = str(e)
                            tool_output = {"error": error_msg}

                        tool_calls.append(ToolCallRecord(
                            iteration=iterations,
                            tool_name=tool_name,
                            tool_input=tool_input,
                            tool_output=tool_output,
                            success=success,
                            execution_time_ms=int((time.time() - iteration_start) * 1000),
                            error=error_msg,
                        ))

                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": tool_use.id,
                            "content": json.dumps(tool_output, ensure_ascii=False),
                        })

                    # 添加工具结果
                    current_messages.append({"role": "user", "content": tool_results})

                else:  # OpenAI 兼容接口
                    # OpenAI tool call 实现（简化版）
                    openai_messages = [{"role": "system", "content": system}] + current_messages

                    # 检查是否支持 function calling（MiniMax、Ollama 等某些提供商不完全支持）
                    supports_tools = self.provider not in ("minimax", "ollama")

                    if supports_tools and tools:
                        response = client.chat.completions.create(
                            model=self.model,
                            messages=openai_messages,
                            tools=[{"type": "function", "function": t} for t in tools],
                            tool_choice="auto",
                        )
                    else:
                        # 不支持 tools 的提供商，使用普通对话
                        # 将工具描述添加到系统提示
                        tools_desc = "\n\n可用工具:\n" + "\n".join(
                            f"- {t.get('name', 'unknown')}: {t.get('description', '')}"
                            for t in tools
                        ) if tools else ""
                        enhanced_system = system + tools_desc

                        response = client.chat.completions.create(
                            model=self.model,
                            messages=[{"role": "system", "content": enhanced_system}] + current_messages,
                            max_tokens=self.max_tokens,
                            temperature=self.temperature,
                        )

                    consecutive_429 = 0  # 成功调用后重置
                    # 记录 token 使用量
                    if context_monitor:
                        input_tok, output_tok = extract_token_usage(response, self.provider)
                        state = context_monitor.record_usage(input_tok, output_tok)
                        logger.debug(f"本次请求 input tokens: {state.input_tokens} ({state.usage_ratio:.1%})")

                    # 处理响应
                    if isinstance(response, str):
                        # 某些提供商可能直接返回字符串
                        return ToolCallLoopResult(
                            status="completed",
                            final_message=response,
                            tool_calls=tool_calls,
                            total_tokens=total_tokens,
                            iterations=iterations,
                        )

                    if not hasattr(response, 'choices') or not response.choices:
                        return ToolCallLoopResult(
                            status="completed",
                            final_message=str(response),
                            tool_calls=tool_calls,
                            total_tokens=total_tokens,
                            iterations=iterations,
                        )

                    message = response.choices[0].message

                    if not hasattr(message, 'tool_calls') or not message.tool_calls:
                        return ToolCallLoopResult(
                            status="completed",
                            final_message=message.content,
                            tool_calls=tool_calls,
                            total_tokens=total_tokens,
                            iterations=iterations,
                        )

                    # 处理工具调用
                    current_messages.append({"role": "assistant", "content": message.content or "", "tool_calls": [
                        {"id": tc.id, "type": "function", "function": {"name": tc.function.name, "arguments": tc.function.arguments}}
                        for tc in message.tool_calls
                    ]})

                    for tool_call in message.tool_calls:
                        tool_name = tool_call.function.name
                        tool_input = json.loads(tool_call.function.arguments)

                        tool_output = {}
                        success = True
                        error_msg = None

                        try:
                            result = _dispatch_tool(
                                tool_name, tool_input, tool_executor_map, tool_executor
                            )
                            tool_output = result if isinstance(result, dict) else {"result": result}
                        except ValueError:
                            # No executor found for this tool - leave tool_output as empty dict
                            pass
                        except Exception as e:
                            success = False
                            error_msg = str(e)
                            tool_output = {"error": error_msg}

                        tool_calls.append(ToolCallRecord(
                            iteration=iterations,
                            tool_name=tool_name,
                            tool_input=tool_input,
                            tool_output=tool_output,
                            success=success,
                            execution_time_ms=int((time.time() - iteration_start) * 1000),
                            error=error_msg,
                        ))

                        current_messages.append({
                            "role": "tool",
                            "tool_call_id": tool_call.id,
                            "content": json.dumps(tool_output, ensure_ascii=False),
                        })

            except Exception as e:
                error_msg = str(e)

                # 检查是否是 context window 超限错误（不可重试）
                if "context window" in error_msg.lower() or "max_tokens" in error_msg.lower():
                    errors.append(f"迭代 {iterations} 出错（上下文超限，不重试）: {error_msg}")
                    logger.error(f"tool_call_loop 迭代 {iterations} 出错（上下文超限）: {e}")
                    # 返回错误结果，不再重试
                    return ToolCallLoopResult(
                        status="error",
                        final_message=None,
                        tool_calls=tool_calls,
                        total_tokens=total_tokens,
                        iterations=iterations,
                        errors=errors,
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

                # 其他错误：重置计数器，继续迭代
                consecutive_429 = 0
                errors.append(f"迭代 {iterations} 出错: {error_msg}")
                logger.error(f"tool_call_loop 迭代 {iterations} 出错: {e}", exc_info=True)

        # 达到最大迭代次数
        return ToolCallLoopResult(
            status="max_iterations",
            final_message=None,
            tool_calls=tool_calls,
            total_tokens=total_tokens,
            iterations=iterations,
            errors=errors,
        )
