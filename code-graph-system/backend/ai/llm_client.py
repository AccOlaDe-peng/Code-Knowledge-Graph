"""
LLM 客户端模块。

提供对多个大语言模型 API 的统一封装，支持：
- Anthropic Claude（默认）
- OpenAI GPT 系列
- 本地 Ollama 模型

实现了自动重试、流式输出、Token 计数等能力。
"""

from __future__ import annotations

import logging
import os
from typing import AsyncIterator, Optional

from tenacity import retry, stop_after_attempt, wait_exponential

logger = logging.getLogger(__name__)

# 默认模型配置
DEFAULT_MODEL = "claude-sonnet-4-6"
DEFAULT_MAX_TOKENS = 4096


class LLMClient:
    """
    统一 LLM 客户端。

    自动根据配置选择 Claude 或 OpenAI 作为后端，
    提供同步和异步调用接口。

    示例::

        client = LLMClient()
        response = await client.complete("解释这个函数的作用...")
    """

    def __init__(
        self,
        provider: str = "anthropic",
        model: Optional[str] = None,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        max_tokens: int = DEFAULT_MAX_TOKENS,
        temperature: float = 0.1,
    ) -> None:
        """
        初始化 LLM 客户端。

        Args:
            provider: LLM 提供商 ("anthropic" | "openai" | "ollama")
            model: 模型名称，None 则使用默认模型
            api_key: API 密钥，None 则从环境变量读取
            base_url: 自定义 API 基础 URL（用于代理或本地部署）
            max_tokens: 最大生成 Token 数
            temperature: 采样温度（0.0-1.0，越低越确定性）
        """
        self.provider = provider
        self.model = model or self._default_model(provider)
        self.api_key = api_key or self._load_api_key(provider)
        self.base_url = base_url
        self.max_tokens = max_tokens
        self.temperature = temperature
        self._client = None

    def _default_model(self, provider: str) -> str:
        """返回各提供商的默认模型。"""
        defaults = {
            "anthropic": "claude-sonnet-4-6",
            "openai": "gpt-4o",
            "ollama": "llama3.2",
        }
        return defaults.get(provider, "claude-sonnet-4-6")

    def _load_api_key(self, provider: str) -> Optional[str]:
        """从环境变量加载 API 密钥。"""
        env_keys = {
            "anthropic": "ANTHROPIC_API_KEY",
            "openai": "OPENAI_API_KEY",
            "ollama": None,  # Ollama 本地部署不需要 Key
        }
        env_name = env_keys.get(provider)
        return os.getenv(env_name) if env_name else None

    def _get_client(self) -> object:
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

        elif self.provider == "openai":
            try:
                import openai

                kwargs = {"api_key": self.api_key}
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

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        reraise=True,
    )
    def complete(
        self,
        prompt: str,
        system: Optional[str] = None,
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
    ) -> str:
        """
        同步调用 LLM 生成文本。

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

        try:
            if self.provider == "anthropic":
                response = client.messages.create(
                    model=self.model,
                    max_tokens=_max_tokens,
                    temperature=_temperature,
                    system=system or "你是一个代码分析专家。",
                    messages=[{"role": "user", "content": prompt}],
                )
                return response.content[0].text

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

        except Exception as e:
            logger.error(f"LLM 调用失败 ({self.provider}/{self.model}): {e}")
            raise

    def complete_with_json(
        self,
        prompt: str,
        system: Optional[str] = None,
    ) -> dict:
        """
        调用 LLM 并期望返回 JSON 格式的响应。

        Args:
            prompt: 用户提示词（应明确要求返回 JSON）
            system: 系统提示词

        Returns:
            解析后的字典，失败时返回空字典
        """
        import json
        import re

        response = self.complete(prompt, system=system)
        # 提取 JSON 代码块
        json_match = re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", response)
        if json_match:
            response = json_match.group(1)
        try:
            return json.loads(response.strip())
        except json.JSONDecodeError:
            logger.warning("LLM 响应不是有效 JSON，尝试宽松解析")
            # 尝试找到第一个 { ... } 对
            brace_match = re.search(r"\{[\s\S]+\}", response)
            if brace_match:
                try:
                    return json.loads(brace_match.group())
                except Exception:
                    pass
            return {}

    def count_tokens(self, text: str) -> int:
        """
        估算文本的 Token 数量。

        Args:
            text: 输入文本

        Returns:
            估算的 Token 数量
        """
        try:
            import tiktoken
            enc = tiktoken.get_encoding("cl100k_base")
            return len(enc.encode(text))
        except ImportError:
            # 粗略估算：英文约 4 字符/token，中文约 1.5 字符/token
            return len(text) // 3

    def is_available(self) -> bool:
        """检查 LLM 服务是否可用。"""
        if self.provider == "anthropic" and not self.api_key:
            return False
        if self.provider == "openai" and not self.api_key:
            return False
        try:
            self._get_client()
            return True
        except Exception:
            return False


# 模块级默认客户端（按需使用）
_default_client: Optional[LLMClient] = None


def get_default_client() -> LLMClient:
    """获取或创建默认 LLM 客户端。"""
    global _default_client
    if _default_client is None:
        provider = os.getenv("LLM_PROVIDER", "anthropic")
        model = os.getenv("LLM_MODEL")
        _default_client = LLMClient(provider=provider, model=model)
    return _default_client


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    client = LLMClient()
    print(f"提供商: {client.provider}")
    print(f"模型: {client.model}")
    print(f"可用: {client.is_available()}")
    token_count = client.count_tokens("Hello, World!")
    print(f"Token 计数: {token_count}")
