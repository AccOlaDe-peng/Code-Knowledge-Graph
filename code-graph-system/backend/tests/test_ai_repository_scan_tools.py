"""测试 AIRepositoryScanStage 工具执行器注入和日志改进。

测试场景：
1. 验证工具执行器被正确注入
2. 验证工具执行失败时产生警告日志
3. 验证扫描结果为空时产生详细警告
"""
from __future__ import annotations

import logging
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from backend.pipeline.stages.ai_repository_scan import AIRepositoryScanStage
from backend.llm.types import ToolCallLoopResult, ToolCallRecord


class TestToolExecutorInjection:
    """测试工具执行器注入。"""

    def test_file_tools_injected_to_tool_call_loop(self, tmp_path: Path):
        """验证 FileTools 被正确传入 tool_call_loop。"""
        stage = AIRepositoryScanStage()

        # 创建模拟的 LLM 客户端
        mock_llm = MagicMock()
        mock_llm.tool_call_loop.return_value = ToolCallLoopResult(
            status="completed",
            final_message='{"entities": [], "flows": [], "flow_nodes": [], "services": [], "repositories": [], "topics": []}',
            tool_calls=[],
            total_tokens=100,
            iterations=1,
        )

        # 执行
        stage._call_llm_with_tools(
            llm_client=mock_llm,
            repo_path=tmp_path,
            user_prompt="test prompt",
        )

        # 验证 tool_call_loop 被调用，且传入了 tool_executor_map
        mock_llm.tool_call_loop.assert_called_once()
        call_kwargs = mock_llm.tool_call_loop.call_args.kwargs

        assert "tool_executor_map" in call_kwargs
        tool_executor_map = call_kwargs["tool_executor_map"]

        # 验证三个工具都被注册
        assert "list_directory" in tool_executor_map
        assert "search_code" in tool_executor_map
        assert "read_file" in tool_executor_map

        # 验证执行器有对应的方法
        executor = tool_executor_map["list_directory"]
        assert hasattr(executor, "list_directory")
        assert hasattr(executor, "search_code")
        assert hasattr(executor, "read_file")

    def test_tool_call_stats_logged(self, tmp_path: Path, caplog: pytest.LogCaptureFixture):
        """验证工具调用统计被记录到日志。"""
        stage = AIRepositoryScanStage()

        mock_llm = MagicMock()
        mock_llm.tool_call_loop.return_value = ToolCallLoopResult(
            status="completed",
            final_message='{"entities": [], "flows": [], "flow_nodes": [], "services": [], "repositories": [], "topics": []}',
            tool_calls=[
                ToolCallRecord(
                    iteration=1,
                    tool_name="list_directory",
                    tool_input={"path": ""},
                    tool_output={"entries": []},
                    success=True,
                    execution_time_ms=100,
                    error=None,
                ),
                ToolCallRecord(
                    iteration=2,
                    tool_name="search_code",
                    tool_input={"pattern": "@Entity"},
                    tool_output={"matches": []},
                    success=True,
                    execution_time_ms=150,
                    error=None,
                ),
            ],
            total_tokens=500,
            iterations=2,
        )

        with caplog.at_level(logging.INFO):
            stage._call_llm_with_tools(
                llm_client=mock_llm,
                repo_path=tmp_path,
                user_prompt="test prompt",
            )

        # 验证日志包含工具调用统计
        log_messages = [r.message for r in caplog.records]
        stats_log = next((m for m in log_messages if "tool_calls=" in m), None)
        assert stats_log is not None
        assert "list_directory" in stats_log
        assert "search_code" in stats_log


class TestToolExecutionLogging:
    """测试工具执行日志。"""

    def test_warning_logged_when_executor_not_found(self, caplog: pytest.LogCaptureFixture):
        """验证工具执行器未找到时产生警告日志。"""
        from backend.llm.client import _dispatch_tool

        with caplog.at_level(logging.WARNING):
            with pytest.raises(ValueError, match="No executor found for tool"):
                _dispatch_tool(
                    tool_name="unknown_tool",
                    tool_input={},
                    tool_executor_map=None,
                    tool_executor=None,
                )

        # 验证警告日志
        assert any("工具执行器未找到" in r.message for r in caplog.records)

    def test_warning_shows_available_executors(self, caplog: pytest.LogCaptureFixture):
        """验证警告日志包含可用的执行器列表。"""
        from backend.llm.client import _dispatch_tool

        mock_executor = MagicMock()
        mock_executor.has_method = False  # 没有 unknown_tool 方法

        with caplog.at_level(logging.WARNING):
            with pytest.raises(ValueError):
                _dispatch_tool(
                    tool_name="unknown_tool",
                    tool_input={},
                    tool_executor_map={"known_tool": mock_executor},
                    tool_executor=None,
                )

        # 验证日志包含 available_executors
        log_records = [r for r in caplog.records if "工具执行器未找到" in r.message]
        assert len(log_records) == 1
        assert "known_tool" in log_records[0].message


class TestEmptyResultWarning:
    """测试扫描结果为空时的详细警告。"""

    def test_detailed_warning_includes_stats(self, tmp_path: Path, caplog: pytest.LogCaptureFixture):
        """验证空结果警告包含统计信息。"""
        from backend.pipeline.ai_first_pipeline import AIFirstPipeline
        from backend.models.ai_first_analysis import RepositoryScanResult

        pipeline = AIFirstPipeline()

        # 模拟 AIRepositoryScanStage 返回空结果
        mock_scan_result = RepositoryScanResult()
        mock_scan_result.stats = {"elapsed_ms": 5000, "entity_count": 0}

        with patch.object(
            AIRepositoryScanStage, "run", return_value=mock_scan_result
        ):
            with caplog.at_level(logging.WARNING):
                result = pipeline.analyze(
                    repo_path=tmp_path,
                    repo_name="test-repo",
                )

        # 验证返回失败状态
        assert result.status == "failed"
        assert "未识别到任何实体" in result.warnings[0]

        # 验证日志包含统计信息
        log_messages = [r.message for r in caplog.records]
        stats_log = next((m for m in log_messages if "扫描结果为空" in m), None)
        assert stats_log is not None
        assert "entities=0" in stats_log
