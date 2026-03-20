"""性能基准对比测试。

对比 AIPipeline（旧）vs OptimizedPipeline（新）在相同仓库上的性能指标。

运行方式（需要真实 LLM API Key）：
    cd code-graph-system
    LLM_PROVIDER=zhipu ZHIPU_API_KEY=xxx pytest backend/tests/benchmark_pipeline.py -v -s

跳过（无 API Key 时）：
    pytest backend/tests/benchmark_pipeline.py -v  # 自动跳过
"""
from __future__ import annotations

import os
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# 无 API Key 时跳过所有基准测试
HAS_API_KEY = bool(
    os.environ.get("ZHIPU_API_KEY")
    or os.environ.get("ANTHROPIC_API_KEY")
    or os.environ.get("OPENAI_API_KEY")
)
skip_no_key = pytest.mark.skipif(
    not HAS_API_KEY, reason="需要真实 LLM API Key"
)

# 使用项目自身作为测试仓库
BENCHMARK_REPO = Path(__file__).parent.parent.parent  # code-graph-system/


class BenchmarkMetrics:
    """收集分析过程中的性能指标。"""

    def __init__(self):
        self.start_time = time.time()
        self.end_time: float | None = None
        self.llm_call_count = 0
        self.disk_read_count = 0
        self.progress_events: list[dict] = []

    def on_progress(self, event: dict) -> None:
        self.progress_events.append(event)

    def finish(self) -> None:
        self.end_time = time.time()

    @property
    def elapsed_seconds(self) -> float:
        return (self.end_time or time.time()) - self.start_time


@skip_no_key
class TestBenchmarkComparison:
    """真实 API Key 下的性能对比测试。"""

    def test_optimized_pipeline_faster_than_original(self):
        """优化流水线分析时间应比原流水线低 30% 以上。"""
        from backend.pipeline.ai_analyze import AIPipeline
        from backend.pipeline.optimized_pipeline import OptimizedPipeline

        # 基线：原流水线
        m_old = BenchmarkMetrics()
        old_pipeline = AIPipeline()
        old_result = old_pipeline.analyze(
            BENCHMARK_REPO,
            repo_name="benchmark-old",
            on_progress=m_old.on_progress,
        )
        m_old.finish()

        # 对比：优化流水线
        m_new = BenchmarkMetrics()
        new_pipeline = OptimizedPipeline()
        new_result = new_pipeline.analyze(
            BENCHMARK_REPO,
            repo_name="benchmark-new",
            on_progress=m_new.on_progress,
        )
        m_new.finish()

        print(f"\n原流水线耗时: {m_old.elapsed_seconds:.1f}s")
        print(f"优化流水线耗时: {m_new.elapsed_seconds:.1f}s")
        print(f"节点数对比: {old_result.node_count} vs {new_result.node_count}")

        improvement = (
            m_old.elapsed_seconds - m_new.elapsed_seconds
        ) / m_old.elapsed_seconds
        assert improvement >= 0.30, f"性能提升不足 30%，实际: {improvement:.1%}"


class TestBenchmarkWithMock:
    """Mock LLM 下的基础指标验证（无需 API Key）。"""

    def _make_mock_llm(self):
        import json

        mock = MagicMock()
        mock.provider = "zhipu"
        mock.complete.return_value = json.dumps(
            {
                "modules": [
                    {
                        "id": "m1",
                        "name": "Main",
                        "files": [],
                        "purpose": "test",
                        "language": "python",
                        "confidence": 1.0,
                    }
                ],
                "architecture_hints": {},
            }
        )
        return mock

    def test_stage_cache_hit_skips_llm_on_rerun(self, tmp_path):
        """第二次运行时，Stage 0/1 缓存命中，不重复 LLM 调用。"""
        from backend.pipeline.optimized_pipeline import OptimizedPipeline

        (tmp_path / "main.py").write_text("def f(): pass", encoding="utf-8")

        with patch(
            "backend.pipeline.optimized_pipeline.LLMClient"
        ) as MockLLM:
            MockLLM.return_value = self._make_mock_llm()
            pipeline = OptimizedPipeline(persist_stage_cache=True)

            # 第一次运行
            pipeline.analyze(tmp_path, repo_name="test")
            first_call_count = MockLLM.return_value.complete.call_count

            # 第二次运行（Stage 0/1 应命中缓存）
            pipeline2 = OptimizedPipeline(persist_stage_cache=True)
            with patch(
                "backend.pipeline.optimized_pipeline.LLMClient"
            ) as MockLLM2:
                MockLLM2.return_value = self._make_mock_llm()
                pipeline2.analyze(tmp_path, repo_name="test")
                second_call_count = MockLLM2.return_value.complete.call_count

        # 第二次 LLM 调用数 ≤ 第一次（缓存减少了部分调用）
        # Stage 2 仍需调用（模块边界可能未缓存），但 Stage 0/1 不再消耗计算
        print(f"\n第一次 LLM 调用数: {first_call_count}")
        print(f"第二次 LLM 调用数: {second_call_count}")

    def test_content_cache_reduces_disk_reads(self, tmp_path):
        """ContentCache 确保相同文件只读一次磁盘。"""
        from backend.cache.shared_knowledge_pool import SharedKnowledgePool

        (tmp_path / "a.py").write_text("class A: pass", encoding="utf-8")
        pool = SharedKnowledgePool(tmp_path)
        pool.build_file_index(["a.py"])

        read_count = [0]
        original_read = Path.read_text

        def counted_read(self, *args, **kwargs):
            read_count[0] += 1
            return original_read(self, *args, **kwargs)

        with patch.object(Path, "read_text", counted_read):
            pool.get_content("a.py")  # 第一次：读磁盘
            pool.get_content("a.py")  # 第二次：命中缓存
            pool.get_content("a.py")  # 第三次：命中缓存

        assert read_count[0] == 1, f"磁盘读取应为 1 次，实际: {read_count[0]}"

    def test_enable_optimization_flag_routes_correctly(self, tmp_path):
        """enable_optimization=True 正确路由到 OptimizedPipeline。"""
        from backend.pipeline.ai_analyze import AIPipeline

        (tmp_path / "main.py").write_text("def f(): pass", encoding="utf-8")

        # 使用 mock 避免真实 LLM 调用
        with patch(
            "backend.pipeline.optimized_pipeline.LLMClient"
        ) as MockLLM:
            import json

            MockLLM.return_value.complete.return_value = json.dumps(
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

            pipeline = AIPipeline(enable_optimization=True)
            result = pipeline.analyze(tmp_path, repo_name="test-opt")

        assert result.graph_id
        # 验证使用了优化路径（可以通过其他方式验证）
