"""测试 FileTools 的输出限制功能。"""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

from backend.agent.tools.file_tools import FileTools


class TestReadFileLinesLimit:
    """测试 read_file 方法的行数限制。"""

    def test_read_file_lines_limit(self, tmp_path: Path):
        """读取文件行数限制测试。

        创建一个超过 500 行的文件，验证 read_file 只返回前 500 行。
        """
        # 创建测试文件（600 行）
        test_file = tmp_path / "large_file.py"
        lines = [f"line_{i}: some content here" for i in range(600)]
        test_file.write_text("\n".join(lines), encoding="utf-8")

        tools = FileTools(str(tmp_path))
        result = tools.read_file("large_file.py")

        assert result["success"] is True
        assert result["line_count"] == 500  # 限制为 500 行
        assert result["total_lines"] == 600  # 原始总行数
        assert result["truncated"] is True  # 标记为截断

        # 验证内容是前 500 行
        content_lines = result["content"].split("\n")
        assert len(content_lines) == 500
        assert "line_0:" in content_lines[0]
        assert "line_499:" in content_lines[499]

    def test_read_file_with_explicit_range(self, tmp_path: Path):
        """显式指定范围时仍受限制测试。

        即使显式指定了超过限制的范围，也应该被截断。
        """
        # 创建测试文件（600 行）
        test_file = tmp_path / "large_file.py"
        lines = [f"line_{i}: some content here" for i in range(600)]
        test_file.write_text("\n".join(lines), encoding="utf-8")

        tools = FileTools(str(tmp_path))

        # 显式请求读取 600 行（超过限制）
        result = tools.read_file("large_file.py", start_line=0, end_line=600)

        assert result["success"] is True
        assert result["line_count"] == 500  # 仍然被限制为 500 行
        assert result["total_lines"] == 600
        assert result["truncated"] is True

    def test_read_file_within_limit(self, tmp_path: Path):
        """读取文件行数在限制内时不应截断。"""
        # 创建测试文件（100 行）
        test_file = tmp_path / "small_file.py"
        lines = [f"line_{i}: some content here" for i in range(100)]
        test_file.write_text("\n".join(lines), encoding="utf-8")

        tools = FileTools(str(tmp_path))
        result = tools.read_file("small_file.py")

        assert result["success"] is True
        assert result["line_count"] == 100  # 全部返回
        assert result["total_lines"] == 100
        assert result["truncated"] is False  # 未被截断


class TestLongLineTruncation:
    """测试超长行截断功能。"""

    def test_long_line_truncation(self, tmp_path: Path):
        """超长行截断测试。

        创建包含超过 500 字符行的文件，验证行被截断。
        """
        test_file = tmp_path / "long_line.py"
        # 创建一个有短行和超长行的文件
        short_line = "short line"
        long_line = "x" * 1000  # 1000 字符的行
        content = f"{short_line}\n{long_line}\n{short_line}"
        test_file.write_text(content, encoding="utf-8")

        tools = FileTools(str(tmp_path))
        result = tools.read_file("long_line.py")

        assert result["success"] is True
        assert result["line_count"] == 3

        content_lines = result["content"].split("\n")
        assert content_lines[0] == short_line
        assert len(content_lines[1]) == 500  # 被截断为 500 字符
        assert content_lines[1].endswith("...")  # 末尾有截断标记
        assert content_lines[2] == short_line

    def test_line_at_exactly_max_length(self, tmp_path: Path):
        """刚好 500 字符的行不应被截断。"""
        test_file = tmp_path / "exact_length.py"
        exact_line = "x" * 500  # 刚好 500 字符
        test_file.write_text(exact_line, encoding="utf-8")

        tools = FileTools(str(tmp_path))
        result = tools.read_file("exact_length.py")

        assert result["success"] is True
        assert result["content"] == exact_line
        assert "..." not in result["content"]


class TestSearchCodeResultsLimit:
    """测试 search_code 方法的结果数量限制。"""

    def test_search_code_results_limit(self, tmp_path: Path):
        """搜索结果数量限制测试。

        创建多个文件包含大量匹配项，验证返回结果被限制为 50 条。
        """
        # 创建 10 个文件，每个文件有 10 个匹配项（共 100 个）
        for i in range(10):
            test_file = tmp_path / f"file_{i}.py"
            lines = [f"TODO: match pattern here - item {j}" for j in range(10)]
            test_file.write_text("\n".join(lines), encoding="utf-8")

        tools = FileTools(str(tmp_path))
        result = tools.search_code("TODO")

        assert result["success"] is True
        assert result["count"] == 50  # 限制为 50 条
        assert result["total_count"] == 100  # 原始匹配总数
        assert result["truncated"] is True  # 标记为截断
        assert len(result["matches"]) == 50

    def test_search_code_within_limit(self, tmp_path: Path):
        """搜索结果在限制内时不应截断。"""
        # 创建 3 个文件，每个文件有 5 个匹配项（共 15 个）
        for i in range(3):
            test_file = tmp_path / f"file_{i}.py"
            lines = [f"TODO: match pattern here - item {j}" for j in range(5)]
            test_file.write_text("\n".join(lines), encoding="utf-8")

        tools = FileTools(str(tmp_path))
        result = tools.search_code("TODO")

        assert result["success"] is True
        assert result["count"] == 15  # 全部返回
        assert result["total_count"] == 15
        assert result["truncated"] is False  # 未被截断

    def test_search_code_with_long_line_truncation(self, tmp_path: Path):
        """搜索结果中的超长行也应该被截断。"""
        test_file = tmp_path / "long_match.py"
        # 创建一个包含超长匹配行的文件
        long_line = "TODO: " + "x" * 600
        test_file.write_text(long_line, encoding="utf-8")

        tools = FileTools(str(tmp_path))
        result = tools.search_code("TODO")

        assert result["success"] is True
        assert result["count"] == 1
        # 匹配行的内容应该被截断
        match_content = result["matches"][0]["content"]
        assert len(match_content) <= 500


class TestConfigurationConstants:
    """测试配置常量是否正确定义。"""

    def test_max_file_lines_constant(self):
        """验证 MAX_FILE_LINES 常量存在且默认值为 500。"""
        assert hasattr(FileTools, "MAX_FILE_LINES")
        assert FileTools.MAX_FILE_LINES == 500

    def test_max_search_results_constant(self):
        """验证 MAX_SEARCH_RESULTS 常量存在且默认值为 50。"""
        assert hasattr(FileTools, "MAX_SEARCH_RESULTS")
        assert FileTools.MAX_SEARCH_RESULTS == 50

    def test_max_line_length_constant(self):
        """验证 MAX_LINE_LENGTH 常量存在且默认值为 500。"""
        assert hasattr(FileTools, "MAX_LINE_LENGTH")
        assert FileTools.MAX_LINE_LENGTH == 500