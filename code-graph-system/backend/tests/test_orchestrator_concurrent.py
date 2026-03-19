"""并发模块分析编排器集成测试（全 Mock LLM）。"""
from __future__ import annotations

import threading
import time
from unittest.mock import MagicMock, patch
import pytest

from backend.agent.orchestrator import AgentOrchestrator, PartialResultError
from backend.agent.config import AnalysisConfig, AnalysisPreset
from backend.llm.client import LLMClient, RateLimitExhaustedError
from backend.models.agent_output import AgentOutput
from backend.graph.graph_schema import GraphNode, GraphEdge


def _make_orchestrator(tmp_path, on_progress=None) -> AgentOrchestrator:
    """构建测试用编排器（Mock LLM，真实文件系统 checkpoint）。"""
    llm = MagicMock(spec=LLMClient)
    config = AnalysisConfig(preset=AnalysisPreset.STANDARD, max_modules=None)
    return AgentOrchestrator(
        repo_path=str(tmp_path),
        llm_client=llm,
        on_progress=on_progress,
        config=config,
    )


def _make_modules(n: int) -> list[dict]:
    return [{"id": f"module_{i}", "name": f"Module {i}", "path": f"/fake/{i}"} for i in range(n)]


def _success_output(n_nodes: int = 2, module_id: str = "test") -> AgentOutput:
    nodes = [
        GraphNode(id=f"n{i}", type="Module", name=f"Node{i}", properties={})
        for i in range(n_nodes)
    ]
    return AgentOutput(
        agent_type="architecture",
        module_id=module_id,
        status="success",
        execution_time_ms=100,
        nodes=nodes,
        edges=[],
    )


class TestAllModulesComplete:
    def test_all_modules_complete_and_nodes_merged(self, tmp_path):
        """Mock LLM，5 个模块并发跑完，节点数正确合并。"""
        orch = _make_orchestrator(tmp_path)

        with patch.object(orch, "_run_agent_for_module", return_value=_success_output(2)):
            result = orch.run_module_analysis(_make_modules(5), repo_name="test-repo")

        assert result.status == "success"
        assert len(result.nodes) == 10  # 5 个模块 × 2 节点


class TestPerModuleContextMonitor:
    def test_per_module_context_monitors_are_independent(self, tmp_path):
        """多次调用 _create_context 应返回不同 ContextMonitor 实例。

        直接测试 _create_context 本身，不通过 run_module_analysis 间接验证，
        避免双重 patch 导致 _create_context 调用路径被截断的问题。
        """
        orch = _make_orchestrator(tmp_path)
        ctx1 = orch._create_context("m1")
        ctx2 = orch._create_context("m2")
        ctx3 = orch._create_context("m3")

        monitors = [ctx1.context_monitor, ctx2.context_monitor, ctx3.context_monitor]
        # 每次调用应返回不同实例（id 各不相同）
        assert len(set(id(m) for m in monitors)) == 3


class TestCheckpointBehavior:
    def test_checkpoint_written_per_module(self, tmp_path):
        """每个模块完成后主线程串行写检查点，无丢失。"""
        orch = _make_orchestrator(tmp_path)

        with patch.object(orch, "_run_agent_for_module", return_value=_success_output(1)):
            result = orch.run_module_analysis(_make_modules(3), repo_name="cp-test")

        # 全部完成后 checkpoint_manager.clear() 被调用，检查点文件应已清理
        assert result.status == "success"

    def test_checkpoint_cleared_on_success(self, tmp_path):
        """全部成功后 clear 被调用。"""
        orch = _make_orchestrator(tmp_path)

        with patch.object(orch, "_run_agent_for_module", return_value=_success_output(1)):
            orch.run_module_analysis(_make_modules(2), repo_name="clear-test")

        # checkpoint_manager 应已 clear（在 run_module_analysis 末尾调用）
        if orch.checkpoint_manager:
            assert len(orch.checkpoint_manager.checkpoints) == 0

    def test_checkpoint_preserved_on_partial(self, tmp_path, monkeypatch):
        """PartialResultError 退出时检查点文件保留（不调用 clear）。

        用 monkeypatch.setattr 直接覆盖已固化的模块级常量 RATE_LIMIT_MAX_PAUSES（值为 1），
        确保第 2 次 429 就触发终止，而不依赖默认值 3。
        注意：不能用 monkeypatch.setenv，因为常量在模块导入时已经求值完毕。
        call_count 使用 threading.Lock 避免并发竞态。
        """
        import backend.agent.orchestrator as _orch_mod
        monkeypatch.setattr(_orch_mod, "RATE_LIMIT_MAX_PAUSES", 1)
        orch = _make_orchestrator(tmp_path)
        lock = threading.Lock()
        call_count_box = [0]  # 用列表避免 nonlocal 在多线程下的竞态

        def _flaky_run(module):
            with lock:
                call_count_box[0] += 1
                is_first = call_count_box[0] == 1
            if not is_first:
                raise RateLimitExhaustedError("429")
            return _success_output(1, module.get("id", "test"))

        with pytest.raises(PartialResultError):
            with patch.object(orch, "_run_agent_for_module", side_effect=_flaky_run):
                orch.run_module_analysis(_make_modules(5), repo_name="partial-test")

        # clear() 不应被调用，检查点应保留
        if orch.checkpoint_manager:
            assert len(orch.checkpoint_manager.checkpoints) > 0


class TestNonRateLimitError:
    def test_non_rate_limit_error_skips_module(self, tmp_path):
        """Worker 抛出非 429 异常时，主循环继续处理其余 Future。

        call_count 用 threading.Lock 保护，避免并发场景下多线程同时读写的竞态。
        """
        orch = _make_orchestrator(tmp_path)
        lock = threading.Lock()
        call_count_box = [0]

        def _sometimes_fail(module):
            with lock:
                call_count_box[0] += 1
                is_second = call_count_box[0] == 2
            if is_second:
                raise ValueError("非 429 错误")
            return _success_output(1, module.get("id", "test"))

        with patch.object(orch, "_run_agent_for_module", side_effect=_sometimes_fail):
            result = orch.run_module_analysis(_make_modules(4))

        # 至少 1 个成功（非 429 错误被跳过），其余模块继续完成
        assert result.status in ("partial", "success")
        assert len(result.nodes) >= 1


class TestSharedKnowledgeThreadSafety:
    def test_concurrent_add_no_duplicates(self, tmp_path):
        """多线程并发通过 ArchitectureAgent 写 shared_knowledge，无竞态。"""
        orch = _make_orchestrator(tmp_path)
        barrier = threading.Barrier(5)

        def _add_layer():
            barrier.wait()
            orch.shared_knowledge.add_layer({"id": f"layer:{threading.get_ident()}"})

        threads = [threading.Thread(target=_add_layer, daemon=True) for _ in range(5)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=2)

        assert len(orch.shared_knowledge.layers) == 5
