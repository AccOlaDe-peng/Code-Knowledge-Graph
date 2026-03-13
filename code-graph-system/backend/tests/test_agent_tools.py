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


def test_read_file_blocks_path_traversal(tmp_path):
    """Test that path traversal attacks are blocked."""
    # Create a file inside repo
    repo_file = tmp_path / "allowed.py"
    repo_file.write_text("allowed content")

    # Create a file outside repo
    outside_dir = tmp_path.parent / "outside"
    outside_dir.mkdir(exist_ok=True)
    outside_file = outside_dir / "secret.py"
    outside_file.write_text("secret content")

    tools = AgentTools(repo_path=str(tmp_path), static_graph=None)

    # Try to read file outside repo using relative path with ..
    result = tools.read_file("../outside/secret.py")
    assert result["success"] is False
    assert "Path outside repository" in result["error"]

    # Try to read file outside repo using absolute path
    result = tools.read_file(str(outside_file))
    assert result["success"] is False
    assert "Path outside repository" in result["error"]

    # Verify we can still read files inside repo
    result = tools.read_file(str(repo_file))
    assert result["success"] is True
    assert "allowed content" in result["content"]


def test_list_directory_basic(tmp_path):
    """Test listing directory contents."""
    (tmp_path / "file1.py").write_text("# file 1")
    (tmp_path / "file2.py").write_text("# file 2")
    (tmp_path / "subdir").mkdir()
    (tmp_path / "subdir" / "nested.py").write_text("# nested")

    tools = AgentTools(repo_path=str(tmp_path), static_graph=None)
    result = tools.list_directory(".")

    assert result["success"] is True
    assert len(result["entries"]) == 3

    names = {e["name"] for e in result["entries"]}
    assert "file1.py" in names
    assert "file2.py" in names
    assert "subdir" in names

    # Should not recurse
    assert "nested.py" not in names
