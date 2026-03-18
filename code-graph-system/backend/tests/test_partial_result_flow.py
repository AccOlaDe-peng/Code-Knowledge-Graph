"""测试 AIPipeline 中 ZHIPU_API_KEY 读取和 PartialResultError 处理流程。"""

from __future__ import annotations

import os
import importlib
from pathlib import Path
from unittest.mock import MagicMock, patch, PropertyMock

import pytest

from backend.agent.orchestrator import PartialResultError
from backend.graph.graph_schema import GraphNode, GraphEdge
from backend.models.ai_analysis import AIAnalysisResult


# ---------------------------------------------------------------------------
# Test A: ZHIPU_API_KEY 被读取
# ---------------------------------------------------------------------------

class TestZhipuApiKey:
    """ZHIPU_API_KEY 应被 _create_llm_client() 读取。"""

    def test_zhipu_api_key_read_from_env(self):
        """当 LLM_PROVIDER=zhipu 时，ZHIPU_API_KEY 应被读取并传给 LLMClient。"""
        with patch.dict(
            os.environ,
            {
                "LLM_PROVIDER": "zhipu",
                "ZHIPU_API_KEY": "test-zhipu-key",
                # 清除其他 key，避免干扰优先级
                "LLM_API_KEY": "",
                "ANTHROPIC_API_KEY": "",
                "OPENAI_API_KEY": "",
                "MINIMAX_API_KEY": "",
            },
            clear=False,
        ):
            # 重新导入确保环境变量生效
            import backend.pipeline.ai_analyze as module
            importlib.reload(module)
            AIPipeline = module.AIPipeline

            with patch("backend.pipeline.ai_analyze.LLMClient") as mock_llm_cls:
                mock_llm_cls.return_value = MagicMock()
                pipeline = AIPipeline()
                pipeline._create_llm_client()

                # 验证 LLMClient 使用了 ZHIPU_API_KEY
                call_kwargs = mock_llm_cls.call_args
                assert call_kwargs is not None
                # api_key 可能是位置参数或关键字参数
                kwargs = call_kwargs.kwargs if call_kwargs.kwargs else {}
                args = call_kwargs.args if call_kwargs.args else ()
                api_key_passed = kwargs.get("api_key") or (args[2] if len(args) > 2 else None)
                assert api_key_passed == "test-zhipu-key", (
                    f"期望 api_key='test-zhipu-key'，实际得到 '{api_key_passed}'"
                )

    def test_zhipu_api_key_priority_after_llm_api_key(self):
        """LLM_API_KEY 优先级高于 ZHIPU_API_KEY。"""
        with patch.dict(
            os.environ,
            {
                "LLM_PROVIDER": "zhipu",
                "LLM_API_KEY": "master-key",
                "ZHIPU_API_KEY": "zhipu-key",
                "ANTHROPIC_API_KEY": "",
                "OPENAI_API_KEY": "",
                "MINIMAX_API_KEY": "",
            },
            clear=False,
        ):
            import backend.pipeline.ai_analyze as module
            importlib.reload(module)
            AIPipeline = module.AIPipeline

            with patch("backend.pipeline.ai_analyze.LLMClient") as mock_llm_cls:
                mock_llm_cls.return_value = MagicMock()
                pipeline = AIPipeline()
                pipeline._create_llm_client()

                call_kwargs = mock_llm_cls.call_args
                kwargs = call_kwargs.kwargs if call_kwargs.kwargs else {}
                args = call_kwargs.args if call_kwargs.args else ()
                api_key_passed = kwargs.get("api_key") or (args[2] if len(args) > 2 else None)
                assert api_key_passed == "master-key", (
                    f"LLM_API_KEY 应优先于 ZHIPU_API_KEY，实际得到 '{api_key_passed}'"
                )


# ---------------------------------------------------------------------------
# Test B: PartialResultError 触发保存部分图谱并 re-raise
# ---------------------------------------------------------------------------

class TestPartialResultErrorHandling:
    """_analyze_with_agents() 捕获 PartialResultError、保存部分图谱、re-raise。"""

    def _make_pipeline(self):
        """创建 AIPipeline 实例，注入 mock graph_repo。"""
        from backend.pipeline.ai_analyze import AIPipeline
        from backend.models.ai_analysis import AIAnalysisConfig

        mock_repo = MagicMock()
        mock_repo.save.return_value = "partial-graph-001"

        pipeline = AIPipeline(
            config=AIAnalysisConfig(),
            graph_repo=mock_repo,
        )
        return pipeline, mock_repo

    def _make_node_dict(self, node_id: str) -> dict:
        return {
            "id": node_id,
            "type": "Function",
            "name": f"func_{node_id}",
            "properties": {},
        }

    def _make_edge_dict(self, from_id: str, to_id: str) -> dict:
        return {
            "from": from_id,
            "to": to_id,
            "type": "calls",
            "properties": {},
        }

    def test_partial_result_error_is_reraised(self, tmp_path):
        """PartialResultError 应被 re-raise。"""
        from backend.pipeline.ai_analyze import AIPipeline
        from backend.agent.checkpoint import CheckpointManager

        pipeline, mock_repo = self._make_pipeline()

        # 构造 partial 节点/边（dict 格式，和 load_partial_results 一致）
        partial_nodes = [self._make_node_dict("n1"), self._make_node_dict("n2")]
        partial_edges = [self._make_edge_dict("n1", "n2")]

        # mock checkpoint_manager
        mock_ckpt_mgr = MagicMock(spec=CheckpointManager)
        mock_ckpt_mgr.load_partial_results.return_value = (partial_nodes, partial_edges)

        # mock orchestrator 抛出 PartialResultError
        mock_orchestrator = MagicMock()
        exc = PartialResultError(completed_count=2, total_count=5)
        mock_orchestrator.run_architecture_analysis.side_effect = exc
        mock_orchestrator.checkpoint_manager = mock_ckpt_mgr

        from backend.models.ai_analysis import ModuleInfo
        module = ModuleInfo(
            id="module:test",
            name="Test Module",
            files=["a.py"],
            purpose="test",
        )
        mock_llm = MagicMock()

        with patch("backend.pipeline.ai_analyze.AgentOrchestrator", return_value=mock_orchestrator):
            with pytest.raises(PartialResultError):
                pipeline._analyze_with_agents(tmp_path, module, mock_llm)

    def test_partial_result_error_saves_graph(self, tmp_path):
        """PartialResultError 时，graph_repo.save() 应被调用一次。"""
        from backend.pipeline.ai_analyze import AIPipeline
        from backend.agent.checkpoint import CheckpointManager

        pipeline, mock_repo = self._make_pipeline()

        partial_nodes = [self._make_node_dict("n1")]
        partial_edges = [self._make_edge_dict("n1", "n1")]

        mock_ckpt_mgr = MagicMock(spec=CheckpointManager)
        mock_ckpt_mgr.load_partial_results.return_value = (partial_nodes, partial_edges)

        mock_orchestrator = MagicMock()
        exc = PartialResultError(completed_count=1, total_count=3)
        mock_orchestrator.run_architecture_analysis.side_effect = exc
        mock_orchestrator.checkpoint_manager = mock_ckpt_mgr

        from backend.models.ai_analysis import ModuleInfo
        module = ModuleInfo(
            id="module:test",
            name="Test Module",
            files=["a.py"],
            purpose="test",
        )
        mock_llm = MagicMock()

        with patch("backend.pipeline.ai_analyze.AgentOrchestrator", return_value=mock_orchestrator):
            with pytest.raises(PartialResultError):
                pipeline._analyze_with_agents(tmp_path, module, mock_llm)

        mock_repo.save.assert_called_once()

    def test_partial_result_error_exc_result_not_none(self, tmp_path):
        """re-raise 的 PartialResultError.result 不应为 None。"""
        from backend.pipeline.ai_analyze import AIPipeline
        from backend.agent.checkpoint import CheckpointManager

        pipeline, mock_repo = self._make_pipeline()

        partial_nodes = [self._make_node_dict("n1"), self._make_node_dict("n2")]
        partial_edges = [self._make_edge_dict("n1", "n2")]

        mock_ckpt_mgr = MagicMock(spec=CheckpointManager)
        mock_ckpt_mgr.load_partial_results.return_value = (partial_nodes, partial_edges)

        mock_orchestrator = MagicMock()
        exc = PartialResultError(completed_count=2, total_count=5)
        mock_orchestrator.run_architecture_analysis.side_effect = exc
        mock_orchestrator.checkpoint_manager = mock_ckpt_mgr

        from backend.models.ai_analysis import ModuleInfo
        module = ModuleInfo(
            id="module:test",
            name="Test Module",
            files=["a.py"],
            purpose="test",
        )
        mock_llm = MagicMock()

        with patch("backend.pipeline.ai_analyze.AgentOrchestrator", return_value=mock_orchestrator):
            with pytest.raises(PartialResultError) as exc_info:
                pipeline._analyze_with_agents(tmp_path, module, mock_llm)

        caught = exc_info.value
        assert caught.result is not None, "exc.result 不应为 None"

    def test_partial_result_error_result_is_ai_analysis_result(self, tmp_path):
        """exc.result 应为 AIAnalysisResult 实例，包含正确的 graph_id。"""
        from backend.pipeline.ai_analyze import AIPipeline
        from backend.agent.checkpoint import CheckpointManager

        pipeline, mock_repo = self._make_pipeline()

        partial_nodes = [self._make_node_dict("n1"), self._make_node_dict("n2")]
        partial_edges = [self._make_edge_dict("n1", "n2")]

        mock_ckpt_mgr = MagicMock(spec=CheckpointManager)
        mock_ckpt_mgr.load_partial_results.return_value = (partial_nodes, partial_edges)

        mock_orchestrator = MagicMock()
        exc = PartialResultError(completed_count=2, total_count=5)
        mock_orchestrator.run_architecture_analysis.side_effect = exc
        mock_orchestrator.checkpoint_manager = mock_ckpt_mgr

        from backend.models.ai_analysis import ModuleInfo
        module = ModuleInfo(
            id="module:test",
            name="Test Module",
            files=["a.py"],
            purpose="test",
        )
        mock_llm = MagicMock()

        with patch("backend.pipeline.ai_analyze.AgentOrchestrator", return_value=mock_orchestrator):
            with pytest.raises(PartialResultError) as exc_info:
                pipeline._analyze_with_agents(tmp_path, module, mock_llm)

        caught = exc_info.value
        result = caught.result
        assert isinstance(result, AIAnalysisResult), (
            f"exc.result 应为 AIAnalysisResult，实际为 {type(result)}"
        )
        assert result.graph_id == "partial-graph-001"
        assert result.status == "partial"

    def test_partial_result_error_no_checkpoint_manager(self, tmp_path):
        """当 orchestrator.checkpoint_manager 为 None 时，PartialResultError 也应被 re-raise。"""
        from backend.pipeline.ai_analyze import AIPipeline

        pipeline, mock_repo = self._make_pipeline()

        mock_orchestrator = MagicMock()
        exc = PartialResultError(completed_count=0, total_count=3)
        mock_orchestrator.run_architecture_analysis.side_effect = exc
        mock_orchestrator.checkpoint_manager = None  # 无检查点管理器

        from backend.models.ai_analysis import ModuleInfo
        module = ModuleInfo(
            id="module:test",
            name="Test Module",
            files=["a.py"],
            purpose="test",
        )
        mock_llm = MagicMock()

        with patch("backend.pipeline.ai_analyze.AgentOrchestrator", return_value=mock_orchestrator):
            with pytest.raises(PartialResultError) as exc_info:
                pipeline._analyze_with_agents(tmp_path, module, mock_llm)

        # 没有检查点时，不应调用 save
        mock_repo.save.assert_not_called()
        # result 仍应为 None 或者 re-raise（取决于实现）
        caught = exc_info.value
        # 至少应该 re-raise
        assert isinstance(caught, PartialResultError)
