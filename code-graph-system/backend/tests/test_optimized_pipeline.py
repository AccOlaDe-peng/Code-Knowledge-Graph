"""OptimizedPipeline 集成测试（使用 mock LLM，不需要真实 API Key）。"""
from __future__ import annotations

import json
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from backend.pipeline.optimized_pipeline import OptimizedPipeline
from backend.pipeline.pipeline_scheduler import SchedulerConfig


@pytest.fixture
def sample_repo(tmp_path: Path) -> Path:
    """创建包含若干 Python 文件的临时仓库。"""
    (tmp_path / "main.py").write_text(
        "def main():\n    pass\n", encoding="utf-8"
    )
    (tmp_path / "utils.py").write_text(
        "class Helper:\n    def run(self): pass\n", encoding="utf-8"
    )
    sub = tmp_path / "api"
    sub.mkdir()
    (sub / "endpoints.py").write_text(
        "def get_users(): pass\n", encoding="utf-8"
    )
    return tmp_path


def make_mock_llm(module_plan_json: str, analysis_json: str) -> MagicMock:
    """构造 mock LLM，第一次返回模块计划，后续返回分析结果。"""
    mock = MagicMock()
    mock.provider = "zhipu"
    call_count = [0]

    def complete_side_effect(*args, **kwargs):
        call_count[0] += 1
        if call_count[0] == 1:
            return module_plan_json
        return analysis_json

    mock.complete.side_effect = complete_side_effect
    return mock


class TestOptimizedPipelineBasic:
    def test_analyze_returns_result_with_graph_id(self, sample_repo):
        module_plan = json.dumps(
            {
                "modules": [
                    {
                        "id": "module:default",
                        "name": "Default",
                        "files": [
                            "main.py",
                            "utils.py",
                            "api/endpoints.py",
                        ],
                        "purpose": "主模块",
                        "language": "python",
                        "confidence": 0.9,
                    }
                ],
                "architecture_hints": {},
            }
        )
        analysis = json.dumps(
            {
                "module:default": {
                    "functions": [
                        {
                            "id": "main.py:main",
                            "name": "main",
                            "file_path": "main.py",
                            "summary": "入口",
                        }
                    ],
                    "classes": [
                        {
                            "id": "utils.py:Helper",
                            "name": "Helper",
                            "file_path": "utils.py",
                            "summary": "助手",
                        }
                    ],
                    "calls": [],
                }
            }
        )
        mock_llm = make_mock_llm(module_plan, analysis)

        with patch(
            "backend.pipeline.optimized_pipeline.LLMClient"
        ) as MockLLM:
            MockLLM.return_value = mock_llm
            pipeline = OptimizedPipeline()
            result = pipeline.analyze(sample_repo, repo_name="test-repo")

        assert result.graph_id
        assert result.status in ("success", "partial")
        assert result.node_count >= 0

    def test_analyze_raises_for_nonexistent_path(self):
        pipeline = OptimizedPipeline()
        with pytest.raises(ValueError, match="不存在"):
            pipeline.analyze(Path("/nonexistent/path"))

    def test_analyze_raises_for_empty_repo(self, tmp_path):
        pipeline = OptimizedPipeline()
        with pytest.raises(ValueError, match="没有找到"):
            pipeline.analyze(tmp_path)

    def test_on_progress_called(self, sample_repo):
        module_plan = json.dumps(
            {
                "modules": [
                    {
                        "id": "m1",
                        "name": "M1",
                        "files": ["main.py"],
                        "purpose": "test",
                        "language": "python",
                        "confidence": 1.0,
                    }
                ],
                "architecture_hints": {},
            }
        )
        analysis = json.dumps(
            {"m1": {"functions": [], "classes": [], "calls": []}}
        )
        mock_llm = make_mock_llm(module_plan, analysis)
        progress_events = []

        with patch(
            "backend.pipeline.optimized_pipeline.LLMClient"
        ) as MockLLM:
            MockLLM.return_value = mock_llm
            pipeline = OptimizedPipeline()
            pipeline.analyze(
                sample_repo,
                repo_name="test",
                on_progress=progress_events.append,
            )

        step_names = {e["step"] for e in progress_events}
        assert "file_index" in step_names
        assert "structure_parse" in step_names


class TestOptimizedPipelineCaching:
    def test_stage_cache_hit_skips_work(self, sample_repo):
        """第二次运行时，Stage 0/1 应命中缓存（同一 pipeline 实例）。"""
        module_plan = json.dumps(
            {
                "modules": [
                    {
                        "id": "m1",
                        "name": "M1",
                        "files": ["main.py"],
                        "purpose": "test",
                        "language": "python",
                        "confidence": 1.0,
                    }
                ],
                "architecture_hints": {},
            }
        )
        analysis = json.dumps(
            {"m1": {"functions": [], "classes": [], "calls": []}}
        )

        # 使用同一个 pipeline 实例，共享内存缓存
        mock_llm = make_mock_llm(module_plan, analysis)
        with patch(
            "backend.pipeline.optimized_pipeline.LLMClient"
        ) as MockLLM:
            MockLLM.return_value = mock_llm
            pipeline = OptimizedPipeline(persist_stage_cache=True)

            # 第一次运行
            pipeline.analyze(sample_repo, repo_name="cache-test")

            # 重置 mock 调用计数
            mock_llm.reset_mock()
            progress_events = []

            # 第二次运行（Stage 0/1/2 应命中内存缓存）
            pipeline.analyze(
                sample_repo,
                repo_name="cache-test",
                on_progress=progress_events.append,
            )

        # 检查是否有缓存命中的进度事件
        cached_steps = [
            e for e in progress_events if e.get("status") == "cached"
        ]
        assert len(cached_steps) >= 2  # 至少 Stage 0/1 缓存命中
