"""统一 LLM 客户端。"""

from __future__ import annotations

import logging
from typing import Any

from backend.llm.types import ToolCallLoopResult

logger = logging.getLogger(__name__)


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
        self._client: Any = None

    def _default_model(self, provider: str) -> str:
        """返回各提供商的默认模型。"""
        defaults = {
            "anthropic": "claude-sonnet-4-6",
            "openai": "gpt-4o",
            "ollama": "llama3.2",
            "minimax": "MiniMax-M2.5",
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
    ) -> ToolCallLoopResult:
        """执行工具调用循环。

        Args:
            system: 系统提示词
            messages: 消息历史
            tools: 工具定义列表
            max_iterations: 最大迭代次数
            tool_executor: 工具执行器（可选），如果提供则执行工具

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

        while iterations < max_iterations:
            iterations += 1
            iteration_start = time.time()

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

                    # 检查停止原因
                    if response.stop_reason == "end_turn":
                        # 提取最终消息
                        final_message = None
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
                    tool_uses = [
                        block for block in response.content
                        if hasattr(block, 'type') and block.type == "tool_use"
                    ]

                    if not tool_uses:
                        errors.append("LLM 响应中没有工具调用")
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

                        if tool_executor and hasattr(tool_executor, tool_name):
                            try:
                                result = getattr(tool_executor, tool_name)(**tool_input)
                                tool_output = result if isinstance(result, dict) else {"result": result}
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

                    # 检查是否支持 function calling（MiniMax 等某些提供商不完全支持）
                    supports_tools = self.provider not in ("minimax",)

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

                        if tool_executor and hasattr(tool_executor, tool_name):
                            try:
                                result = getattr(tool_executor, tool_name)(**tool_input)
                                tool_output = result if isinstance(result, dict) else {"result": result}
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
                errors.append(f"迭代 {iterations} 出错: {str(e)}")
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
