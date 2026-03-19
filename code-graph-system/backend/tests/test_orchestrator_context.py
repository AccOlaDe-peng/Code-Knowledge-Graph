"""AgentOrchestrator._create_context 单元测试。"""
from __future__ import annotations

from unittest.mock import MagicMock
from backend.agent.orchestrator import AgentOrchestrator
from backend.agent.config import AnalysisConfig, AnalysisPreset
from backend.llm.client import LLMClient


def _make_orchestrator(tmp_path) -> AgentOrchestrator:
    llm = MagicMock(spec=LLMClient)
    config = AnalysisConfig(preset=AnalysisPreset.STANDARD, max_modules=None)
    return AgentOrchestrator(
        repo_path=str(tmp_path),
        llm_client=llm,
        config=config,
    )


class TestCreateContext:
    def test_each_call_creates_independent_context_monitor(self, tmp_path):
        """每次调用 _create_context 应返回不同的 ContextMonitor 实例（并发安全前提）。"""
        orch = _make_orchestrator(tmp_path)
        ctx1 = orch._create_context("m1")
        ctx2 = orch._create_context("m2")
        assert ctx1.context_monitor is not ctx2.context_monitor

    def test_context_monitor_uses_config_context_window(self, tmp_path):
        """新建 ContextMonitor 的 max_tokens 应与 config.context_window 一致。"""
        orch = _make_orchestrator(tmp_path)
        ctx = orch._create_context("m1")
        assert ctx.context_monitor.max_tokens == orch.config.context_window
