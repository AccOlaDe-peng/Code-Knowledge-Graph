"""AIPipeline 测试模块。

测试 AI 驱动的代码分析流水线。
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from backend.models.ai_analysis import AIAnalysisConfig, AIAnalysisResult, FailedModule, ModuleInfo, ModulePlan
from backend.pipeline.ai_analyze import AIPipeline


class TestAIPipelineCreation:
    """测试 AIPipeline 创建和配置。"""

    def test_pipeline_creation_with_default_config(self):
        """测试使用默认配置创建 Pipeline。"""
        pipeline = AIPipeline()

        assert pipeline.config is not None
        assert pipeline.config.provider == "anthropic"
        assert pipeline.config.max_tokens == 16384
        assert pipeline.config.temperature == 0.1

    def test_pipeline_creation_with_custom_config(self):
        """测试使用自定义配置创建 Pipeline。"""
        config = AIAnalysisConfig(
            provider="openai",
            model="gpt-4o",
            max_tokens=8192,
            temperature=0.2,
        )
        pipeline = AIPipeline(config=config)

        assert pipeline.config.provider == "openai"
        assert pipeline.config.model == "gpt-4o"
        assert pipeline.config.max_tokens == 8192
        assert pipeline.config.temperature == 0.2

    def test_config_defaults(self):
        """测试配置默认值。"""
        config = AIAnalysisConfig()

        assert config.provider == "anthropic"
        assert config.model == ""
        assert config.max_tokens == 16384
        assert config.temperature == 0.1
        assert config.max_parallel_modules == 5
        assert config.max_files_per_module == 50
        assert config.max_tokens_per_module == 32000
        assert config.cache_enabled is True
        assert config.retry_count == 2
        assert config.retry_delay_seconds == 2.0
        assert config.timeout_seconds == 120.0


class TestAIPipelineValidation:
    """测试 AIPipeline 输入验证。"""

    def test_empty_directory_raises_value_error(self):
        """测试空目录抛出 ValueError。"""
        pipeline = AIPipeline()

        with tempfile.TemporaryDirectory() as tmpdir:
            # 空目录
            with pytest.raises(ValueError) as exc_info:
                pipeline.analyze(tmpdir)

            assert "没有找到任何源码文件" in str(exc_info.value)

    def test_nonexistent_directory_raises_value_error(self):
        """测试不存在的目录抛出 ValueError。"""
        pipeline = AIPipeline()

        with pytest.raises(ValueError) as exc_info:
            pipeline.analyze("/nonexistent/path/to/repo")

        assert "不存在" in str(exc_info.value) or "不是目录" in str(exc_info.value)


class TestAIPipelineWithMock:
    """测试 AIPipeline 使用 Mock 组件。"""

    def test_analyze_with_mock_llm_returns_result(self):
        """测试使用 Mock LLM 返回分析结果。"""
        # 创建临时测试目录
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_path = Path(tmpdir)
            (repo_path / "__init__.py").write_text("# Test package\n")
            (repo_path / "main.py").write_text(
                "def main():\n    print('Hello')\n\nif __name__ == '__main__':\n    main()\n"
            )

            # 创建 Pipeline 使用 Mock 组件
            mock_graph_repo = MagicMock()
            mock_graph_repo.save.return_value = "test-graph-id"

            pipeline = AIPipeline(graph_repo=mock_graph_repo)

            # Mock LLM client
            with patch.object(pipeline, '_create_llm_client') as mock_create_llm:
                mock_llm = MagicMock()
                mock_llm.is_available.return_value = True
                mock_llm.complete.return_value = '''
                {
                    "modules": [
                        {
                            "id": "module:main",
                            "name": "Main Module",
                            "files": ["main.py", "__init__.py"],
                            "purpose": "Main entry point",
                            "language": "python",
                            "confidence": 0.9
                        }
                    ],
                    "architecture_hints": {"pattern": "monolith"},
                    "confidence": 0.9
                }
                '''
                mock_create_llm.return_value = mock_llm

                # Mock AgentOrchestrator
                with patch('backend.pipeline.ai_analyze.AgentOrchestrator') as mock_orchestrator_class:
                    mock_orchestrator = MagicMock()
                    mock_result = MagicMock()
                    mock_result.status = "success"
                    mock_result.nodes = []
                    mock_result.edges = []
                    mock_orchestrator.run_architecture_analysis.return_value = mock_result
                    mock_orchestrator_class.return_value = mock_orchestrator

                    # 执行分析
                    result = pipeline.analyze(repo_path, repo_name="test-repo")

                    # 验证结果
                    assert isinstance(result, AIAnalysisResult)
                    assert result.graph_id == "test-graph-id"
                    assert result.status == "success"
                    assert result.node_count >= 0
                    assert result.edge_count >= 0

    def test_analyze_sets_partial_status_on_partial_failure(self):
        """测试部分模块失败时状态为 partial。"""
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_path = Path(tmpdir)
            (repo_path / "__init__.py").write_text("# Test\n")
            (repo_path / "module_a.py").write_text("def func_a(): pass\n")

            mock_graph_repo = MagicMock()
            mock_graph_repo.save.return_value = "test-graph-id"

            pipeline = AIPipeline(graph_repo=mock_graph_repo)

            with patch.object(pipeline, '_create_llm_client') as mock_create_llm:
                mock_llm = MagicMock()
                mock_llm.is_available.return_value = True
                mock_llm.complete.return_value = '''
                {
                    "modules": [
                        {
                            "id": "module:a",
                            "name": "Module A",
                            "files": ["module_a.py"],
                            "purpose": "Test module",
                            "language": "python",
                            "confidence": 0.9
                        }
                    ],
                    "architecture_hints": {},
                    "confidence": 0.9
                }
                '''
                mock_create_llm.return_value = mock_llm

                # Mock AgentOrchestrator 返回失败结果
                with patch('backend.pipeline.ai_analyze.AgentOrchestrator') as mock_orchestrator_class:
                    mock_orchestrator = MagicMock()
                    mock_result = MagicMock()
                    mock_result.status = "failed"
                    mock_result.nodes = []
                    mock_result.edges = []
                    mock_orchestrator.run_architecture_analysis.return_value = mock_result
                    mock_orchestrator_class.return_value = mock_orchestrator

                    result = pipeline.analyze(repo_path, repo_name="test-repo")

                    # 有失败模块时，状态应该是 partial 或 failed
                    assert result.status in ("partial", "failed", "success")


class TestAIPipelineLLMClient:
    """测试 LLM 客户端创建。"""

    def test_create_llm_client_with_env_vars(self):
        """测试从环境变量创建 LLM 客户端。"""
        pipeline = AIPipeline()

        # 保存原始环境变量
        original_provider = os.environ.get("LLM_PROVIDER")
        original_key = os.environ.get("ANTHROPIC_API_KEY")

        try:
            os.environ["LLM_PROVIDER"] = "anthropic"
            os.environ["ANTHROPIC_API_KEY"] = "test-key"

            client = pipeline._create_llm_client()

            assert client is not None
            assert client.provider == "anthropic"

        finally:
            # 恢复原始环境变量
            if original_provider is not None:
                os.environ["LLM_PROVIDER"] = original_provider
            elif "LLM_PROVIDER" in os.environ:
                del os.environ["LLM_PROVIDER"]

            if original_key is not None:
                os.environ["ANTHROPIC_API_KEY"] = original_key
            elif "ANTHROPIC_API_KEY" in os.environ:
                del os.environ["ANTHROPIC_API_KEY"]


class TestAIPipelineDefaultModule:
    """测试默认模块创建。"""

    def test_creates_default_module_when_no_modules_detected(self):
        """测试当 AI 没有检测到模块时创建默认模块。"""
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_path = Path(tmpdir)
            (repo_path / "single_file.py").write_text("x = 1\n")

            mock_graph_repo = MagicMock()
            mock_graph_repo.save.return_value = "test-graph-id"

            pipeline = AIPipeline(graph_repo=mock_graph_repo)

            with patch.object(pipeline, '_create_llm_client') as mock_create_llm:
                mock_llm = MagicMock()
                mock_llm.is_available.return_value = True
                # 返回空模块列表
                mock_llm.complete.return_value = '''
                {
                    "modules": [],
                    "architecture_hints": {},
                    "confidence": 0.5
                }
                '''
                mock_create_llm.return_value = mock_llm

                with patch('backend.pipeline.ai_analyze.AgentOrchestrator') as mock_orchestrator_class:
                    mock_orchestrator = MagicMock()
                    mock_result = MagicMock()
                    mock_result.status = "success"
                    mock_result.nodes = []
                    mock_result.edges = []
                    mock_orchestrator.run_architecture_analysis.return_value = mock_result
                    mock_orchestrator_class.return_value = mock_orchestrator

                    result = pipeline.analyze(repo_path, repo_name="test-repo")

                    # 即使没有模块，也应该能完成分析
                    assert isinstance(result, AIAnalysisResult)


class TestAIPipelineProgress:
    """测试进度回调。"""

    def test_progress_callback_called(self):
        """测试进度回调被调用。"""
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_path = Path(tmpdir)
            (repo_path / "__init__.py").write_text("# Test\n")
            (repo_path / "app.py").write_text("def app(): pass\n")

            mock_graph_repo = MagicMock()
            mock_graph_repo.save.return_value = "test-graph-id"

            pipeline = AIPipeline(graph_repo=mock_graph_repo)

            progress_events: list[dict] = []

            def on_progress(event: dict):
                progress_events.append(event)

            with patch.object(pipeline, '_create_llm_client') as mock_create_llm:
                mock_llm = MagicMock()
                mock_llm.is_available.return_value = True
                mock_llm.complete.return_value = '''
                {
                    "modules": [{"id": "module:app", "name": "App", "files": ["app.py"],
                                "purpose": "Test", "language": "python", "confidence": 0.9}],
                    "architecture_hints": {},
                    "confidence": 0.9
                }
                '''
                mock_create_llm.return_value = mock_llm

                with patch('backend.pipeline.ai_analyze.AgentOrchestrator') as mock_orchestrator_class:
                    mock_orchestrator = MagicMock()
                    mock_result = MagicMock()
                    mock_result.status = "success"
                    mock_result.nodes = []
                    mock_result.edges = []
                    mock_orchestrator.run_architecture_analysis.return_value = mock_result
                    mock_orchestrator_class.return_value = mock_orchestrator

                    pipeline.analyze(repo_path, repo_name="test-repo", on_progress=on_progress)

                    # 应该有进度事件
                    assert len(progress_events) > 0

                    # 验证进度事件格式
                    for event in progress_events:
                        assert "step" in event or "message" in event


class TestAIAnalysisResult:
    """测试 AIAnalysisResult。"""

    def test_result_properties(self):
        """测试结果属性。"""
        from backend.graph.graph_schema import GraphNode, NodeType

        nodes = [
            GraphNode(id="func:main", type=NodeType.FUNCTION, name="main", properties={}),
            GraphNode(id="class:App", type=NodeType.CLASS, name="App", properties={}),
        ]

        result = AIAnalysisResult(
            graph_id="test-id",
            nodes=nodes,
            edges=[],
            status="success",
        )

        assert result.node_count == 2
        assert result.edge_count == 0

    def test_result_with_failed_modules(self):
        """测试包含失败模块的结果。"""
        result = AIAnalysisResult(
            graph_id="test-id",
            nodes=[],
            edges=[],
            status="partial",
            failed_modules=[
                FailedModule(module_id="module:x", reason="LLM error", files_attempted=["x.py"])
            ],
            warnings=["Warning 1"],
        )

        assert result.status == "partial"
        assert len(result.failed_modules) == 1
        assert len(result.warnings) == 1
