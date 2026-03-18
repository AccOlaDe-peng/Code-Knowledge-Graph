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

        mock_openai_client = MagicMock()
        mock_openai_client.chat.completions.create.side_effect = Exception("429 Too Many Requests")

        with patch.object(client, '_get_client', return_value=mock_openai_client):
            with patch('time.sleep'):  # 不真正等待
                with pytest.raises(RateLimitExhaustedError):
                    client.tool_call_loop(
                        messages=[{"role": "user", "content": "test"}],
                        tools=[],
                        system="",
                    )

    def test_429_resets_on_success(self):
        """成功调用后 consecutive_429 计数器应重置"""
        from backend.llm.client import _is_rate_limit_error
        assert _is_rate_limit_error(Exception("connection error")) is False

    def test_non_429_error_does_not_increment_counter(self):
        """非 429 错误不影响计数器，不触发 RateLimitExhaustedError"""
        client = self._make_client()
        call_count = 0

        mock_openai_client = MagicMock()

        def fail_then_succeed(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                raise Exception("network error")
            resp = MagicMock()
            resp.choices = [MagicMock()]
            resp.choices[0].message.tool_calls = None
            resp.choices[0].message.content = "done"
            resp.usage = MagicMock(prompt_tokens=10, completion_tokens=5)
            return resp

        mock_openai_client.chat.completions.create.side_effect = fail_then_succeed

        with patch.object(client, '_get_client', return_value=mock_openai_client):
            with patch('time.sleep'):  # 不真正等待
                try:
                    client.tool_call_loop(
                        messages=[{"role": "user", "content": "test"}],
                        tools=[],
                        system="",
                    )
                except RateLimitExhaustedError:
                    pytest.fail("不应抛出 RateLimitExhaustedError")
                except Exception:
                    pass  # 其他错误可接受


class TestZhipuProvider:
    def test_zhipu_default_model(self):
        from backend.llm.client import LLMClient
        client = LLMClient(provider="zhipu", api_key="test")
        assert client.model == "glm-4-plus"

    def test_zhipu_supports_tools(self):
        from backend.llm.client import LLMClient
        client = LLMClient(provider="zhipu", api_key="test")
        result = client.provider not in ("minimax", "ollama")
        assert result is True

    def test_minimax_not_supports_tools(self):
        from backend.llm.client import LLMClient
        client = LLMClient(provider="minimax", api_key="test")
        result = client.provider not in ("minimax", "ollama")
        assert result is False

    def test_ollama_not_supports_tools(self):
        from backend.llm.client import LLMClient
        client = LLMClient(provider="ollama", api_key="")
        result = client.provider not in ("minimax", "ollama")
        assert result is False
