"""AI 流水线端到端测试。

使用真实 LLM API 测试完整分析流程。
"""

import os
import pytest
from pathlib import Path

from backend.pipeline.ai_analyze import AIPipeline


# Check for available LLM API keys
HAS_LLM_API = any([
    os.environ.get("ANTHROPIC_API_KEY"),
    os.environ.get("OPENAI_API_KEY"),
    os.environ.get("MINIMAX_API_KEY"),
    os.environ.get("OLLAMA_BASE_URL"),
])


@pytest.fixture
def test_repo_path():
    """测试仓库路径（使用项目自身）。"""
    return Path(__file__).parent.parent.parent


@pytest.mark.skipif(not HAS_LLM_API, reason="需要配置 LLM API Key")
class TestAIPipelineE2E:
    """端到端测试类。"""

    def test_analyze_small_repo(self, test_repo_path):
        """测试分析小型仓库（使用真实 LLM）。"""
        pipeline = AIPipeline()
        result = pipeline.analyze(
            test_repo_path,
            repo_name="code-graph-system-e2e-test",
            enable_rag=False,  # Skip vectorization for speed
        )

        # Validate result structure
        assert result.graph_id is not None
        assert result.status in ("success", "partial", "failed")
        assert result.duration_seconds > 0

        # If analysis succeeded, validate content
        if result.status in ("success", "partial"):
            assert result.node_count >= 0
            assert result.edge_count >= 0

        # Print summary for debugging
        print(f"\n分析结果:")
        print(f"  状态: {result.status}")
        print(f"  图谱 ID: {result.graph_id}")
        print(f"  节点数: {result.node_count}")
        print(f"  边数: {result.edge_count}")
        print(f"  耗时: {result.duration_seconds:.2f}s")
        if result.warnings:
            print(f"  警告: {len(result.warnings)}")
        if result.failed_modules:
            print(f"  失败模块: {len(result.failed_modules)}")

    def test_node_id_format(self, test_repo_path):
        """测试节点 ID 格式为 文件路径:名称。"""
        pipeline = AIPipeline()
        result = pipeline.analyze(
            test_repo_path,
            repo_name="code-graph-system-id-test",
            enable_rag=False,
        )

        # Check Function node IDs contain ":"
        for node in result.nodes:
            if node.type == "Function":
                # ID should be in format "path/to/file.py:function_name"
                assert ":" in node.id, f"Function node ID should contain ':', got {node.id}"

    def test_empty_directory(self, tmp_path):
        """测试空目录处理。"""
        # Create empty directory
        empty_dir = tmp_path / "empty_repo"
        empty_dir.mkdir()

        pipeline = AIPipeline()

        # Should raise ValueError with clear message
        with pytest.raises(ValueError, match="未找到可分析的源码文件"):
            pipeline.analyze(empty_dir)

    def test_nonexistent_path(self):
        """测试不存在的路径。"""
        pipeline = AIPipeline()

        with pytest.raises(ValueError, match="仓库路径不存在"):
            pipeline.analyze("/nonexistent/path/to/repo")


class TestAIPipelineMock:
    """使用 Mock 的测试（不需要 API Key）。"""

    def test_config_defaults(self):
        """测试默认配置。"""
        from backend.models.ai_analysis import AIAnalysisConfig

        config = AIAnalysisConfig()
        assert config.provider == "anthropic"
        assert config.max_parallel_modules == 5
        assert config.cache_enabled is True
        assert config.max_tokens == 16384

    def test_result_properties(self):
        """测试结果属性。"""
        from backend.models.ai_analysis import AIAnalysisResult
        from backend.graph.graph_schema import GraphNode, GraphEdge

        result = AIAnalysisResult(
            graph_id="test-123",
            nodes=[
                GraphNode(id="n1", type="Function", name="f1", properties={}),
                GraphNode(id="n2", type="Class", name="c1", properties={}),
            ],
            edges=[
                GraphEdge(from_="n1", to="n2", type="calls", properties={}),
            ],
            status="success",
        )

        assert result.node_count == 2
        assert result.edge_count == 1
