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
            tool_executor: 工具执行器（可选）

        Returns:
            ToolCallLoopResult
        """
        # 具体实现在 Task 6 中完成
        raise NotImplementedError("tool_call_loop 将在后续实现")
