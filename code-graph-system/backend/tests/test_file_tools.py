# code-graph-system/backend/tests/test_file_tools.py
"""测试文件工具。"""
import tempfile
from pathlib import Path


def test_file_tools_read_file():
    """测试 FileTools 可以读取文件。"""
    from backend.agent.tools.file_tools import FileTools

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        test_file = tmp_path / "main.py"
        test_file.write_text("def main():\n    pass\n")

        tools = FileTools(str(tmp_path))
        result = tools.read_file("main.py")

        assert result["success"] == True
        assert "def main()" in result["content"]
        assert result["line_count"] == 2


def test_file_tools_search_code():
    """测试 FileTools 可以搜索代码。"""
    from backend.agent.tools.file_tools import FileTools

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        (tmp_path / "a.py").write_text("def foo(): pass\n")
        (tmp_path / "b.py").write_text("def bar(): pass\n")

        tools = FileTools(str(tmp_path))
        result = tools.search_code("def foo")

        assert result["success"] == True
        assert len(result["matches"]) == 1


def test_file_tools_list_directory():
    """测试 FileTools 可以列出目录。"""
    from backend.agent.tools.file_tools import FileTools

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        (tmp_path / "main.py").write_text("# main")
        (tmp_path / "subdir").mkdir()
        (tmp_path / "subdir" / "utils.py").write_text("# utils")

        tools = FileTools(str(tmp_path))
        result = tools.list_directory(max_depth=2)

        assert result["success"] == True
        # 应该有 main.py, subdir, subdir/utils.py
        assert result["count"] >= 2
