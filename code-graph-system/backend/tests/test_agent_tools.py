import pytest
from pathlib import Path
from backend.analyzer.ai.agent.tools import AgentTools


def test_read_file_basic(tmp_path):
    """Test reading a simple file."""
    test_file = tmp_path / "test.py"
    test_file.write_text("def hello():\n    return 'world'\n")

    tools = AgentTools(repo_path=str(tmp_path), static_graph=None)
    result = tools.read_file(str(test_file))

    assert result["success"] is True
    assert "def hello():" in result["content"]
    assert result["lines"] == 2


def test_read_file_with_line_range(tmp_path):
    """Test reading specific line range."""
    test_file = tmp_path / "test.py"
    lines = "\n".join([f"line {i}" for i in range(1, 11)])
    test_file.write_text(lines)

    tools = AgentTools(repo_path=str(tmp_path), static_graph=None)
    result = tools.read_file(str(test_file), start_line=3, end_line=5)

    assert result["success"] is True
    assert "line 3" in result["content"]
    assert "line 5" in result["content"]
    assert "line 1" not in result["content"]


def test_read_file_truncates_long_files(tmp_path):
    """Test automatic truncation at 200 lines."""
    test_file = tmp_path / "long.py"
    lines = "\n".join([f"line {i}" for i in range(1, 301)])
    test_file.write_text(lines)

    tools = AgentTools(repo_path=str(tmp_path), static_graph=None)
    result = tools.read_file(str(test_file))

    assert result["success"] is True
    assert result["truncated"] is True
    assert result["lines"] == 200
