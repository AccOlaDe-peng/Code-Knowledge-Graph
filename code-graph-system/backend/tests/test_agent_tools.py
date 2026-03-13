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


def test_list_directory_blocks_path_traversal(tmp_path):
    """Test that path traversal attacks are blocked."""
    # Create directory inside repo
    repo_dir = tmp_path / "subdir"
    repo_dir.mkdir()
    (repo_dir / "file.py").write_text("content")

    # Create directory outside repo
    outside_dir = tmp_path.parent / "outside"
    outside_dir.mkdir(exist_ok=True)
    (outside_dir / "secret.py").write_text("secret")

    tools = AgentTools(repo_path=str(tmp_path), static_graph=None)

    # Try to list directory outside repo using relative path
    result = tools.list_directory("../outside")
    assert result["success"] is False
    assert "Path outside repository" in result["error"]

    # Try to list directory outside repo using absolute path
    result = tools.list_directory(str(outside_dir))
    assert result["success"] is False
    assert "Path outside repository" in result["error"]

    # Verify we can still list directories inside repo
    result = tools.list_directory("subdir")
    assert result["success"] is True


def test_search_code_basic(tmp_path):
    """Test code search with pattern."""
    (tmp_path / "file1.py").write_text("def authenticate():\n    pass\n")
    (tmp_path / "file2.py").write_text("def login():\n    authenticate()\n")

    tools = AgentTools(repo_path=str(tmp_path), static_graph=None)
    result = tools.search_code("authenticate")

    assert result["success"] is True
    assert len(result["matches"]) == 2

    # Check match structure
    match = result["matches"][0]
    assert "file" in match
    assert "line" in match
    assert "content" in match


def test_search_code_with_file_glob(tmp_path):
    """Test search with file glob pattern."""
    (tmp_path / "file1.py").write_text("def authenticate():\n    pass\n")
    (tmp_path / "file2.txt").write_text("authenticate\n")

    tools = AgentTools(repo_path=str(tmp_path), static_graph=None)

    # Search only .py files
    result = tools.search_code("authenticate", file_glob="**/*.py")
    assert result["success"] is True
    assert len(result["matches"]) == 1
    assert result["matches"][0]["file"].endswith(".py")


def test_search_code_blocks_symlink_traversal(tmp_path):
    """Test that symlinks outside repo are skipped."""
    import os

    # Create file inside repo
    (tmp_path / "inside.py").write_text("secret_inside\n")

    # Create directory outside repo
    outside_dir = tmp_path.parent / "outside"
    outside_dir.mkdir(exist_ok=True)
    (outside_dir / "outside.py").write_text("secret_outside\n")

    # Create symlink pointing outside (skip on Windows if no admin)
    try:
        symlink = tmp_path / "link_to_outside.py"
        symlink.symlink_to(outside_dir / "outside.py")
    except OSError:
        pytest.skip("Cannot create symlinks (need admin on Windows)")

    tools = AgentTools(repo_path=str(tmp_path), static_graph=None)
    result = tools.search_code("secret")

    assert result["success"] is True
    # Should only find inside.py, not outside.py via symlink
    assert len(result["matches"]) == 1
    assert "inside.py" in result["matches"][0]["file"]
    assert "outside.py" not in result["matches"][0]["file"]


def test_get_ast_nodes_from_static_graph(tmp_path):
    """Test retrieving AST nodes from static analysis."""
    from backend.graph.graph_schema import GraphNode, NodeType

    # Mock static graph with nodes
    class MockGraph:
        def __init__(self):
            self.nodes = [
                GraphNode(
                    id="func1",
                    type=NodeType.FUNCTION,
                    name="authenticate",
                    properties={"file": "auth.py", "line": 10}
                ),
                GraphNode(
                    id="func2",
                    type=NodeType.FUNCTION,
                    name="login",
                    properties={"file": "auth.py", "line": 20}
                ),
                GraphNode(
                    id="class1",
                    type=NodeType.CLASS,
                    name="User",
                    properties={"file": "models.py", "line": 5}
                ),
            ]

    tools = AgentTools(repo_path=str(tmp_path), static_graph=MockGraph())
    result = tools.get_ast_nodes("auth.py")

    assert result["success"] is True
    assert len(result["nodes"]) == 2
    assert result["nodes"][0]["name"] == "authenticate"
    assert result["nodes"][1]["name"] == "login"


def test_get_ast_nodes_path_matching(tmp_path):
    """Test precise path matching (not substring matching)."""
    from backend.graph.graph_schema import GraphNode, NodeType

    class MockGraph:
        def __init__(self):
            self.nodes = [
                GraphNode(
                    id="func1",
                    type=NodeType.FUNCTION,
                    name="func_in_file",
                    properties={"file": "src/file.py", "line": 10}
                ),
                GraphNode(
                    id="func2",
                    type=NodeType.FUNCTION,
                    name="func_in_myfile",
                    properties={"file": "src/myfile.py", "line": 20}
                ),
                GraphNode(
                    id="func3",
                    type=NodeType.FUNCTION,
                    name="func_in_nested",
                    properties={"file": "src/module/file.py", "line": 30}
                ),
            ]

    tools = AgentTools(repo_path=str(tmp_path), static_graph=MockGraph())

    # Query "file.py" should match both src/file.py and src/module/file.py
    # but NOT src/myfile.py (which contains "file" as substring)
    result = tools.get_ast_nodes("file.py")
    assert result["success"] is True
    assert len(result["nodes"]) == 2
    names = {n["name"] for n in result["nodes"]}
    assert "func_in_file" in names
    assert "func_in_nested" in names
    assert "func_in_myfile" not in names  # Should NOT match


def test_get_ast_nodes_no_static_graph(tmp_path):
    """Test graceful handling when static_graph is None."""
    tools = AgentTools(repo_path=str(tmp_path), static_graph=None)
    result = tools.get_ast_nodes("test.py")
    assert result["success"] is False
    assert "not available" in result["error"]


def test_get_call_graph_depth_1(tmp_path):
    """Test retrieving call graph for a node."""
    from backend.graph.graph_schema import GraphNode, GraphEdge, NodeType, EdgeType

    class MockGraph:
        def __init__(self):
            self.nodes = [
                GraphNode(id="func1", type=NodeType.FUNCTION, name="main", properties={}),
                GraphNode(id="func2", type=NodeType.FUNCTION, name="helper", properties={}),
                GraphNode(id="func3", type=NodeType.FUNCTION, name="util", properties={}),
            ]
            self.edges = [
                GraphEdge(from_="func1", to="func2", type=EdgeType.CALLS, properties={}),
                GraphEdge(from_="func2", to="func3", type=EdgeType.CALLS, properties={}),
            ]

    tools = AgentTools(repo_path=str(tmp_path), static_graph=MockGraph())
    result = tools.get_call_graph("func1", depth=1)

    assert result["success"] is True
    assert len(result["edges"]) == 1
    assert result["edges"][0]["from"] == "func1"
    assert result["edges"][0]["to"] == "func2"


def test_get_imports_from_static_graph(tmp_path):
    """Test retrieving import dependencies."""
    from backend.graph.graph_schema import GraphNode, GraphEdge, NodeType, EdgeType

    class MockGraph:
        def __init__(self):
            self.nodes = [
                GraphNode(id="file1", type=NodeType.FILE, name="main.py", properties={}),
                GraphNode(id="file2", type=NodeType.FILE, name="utils.py", properties={}),
            ]
            self.edges = [
                GraphEdge(from_="file1", to="file2", type=EdgeType.IMPORTS, properties={}),
            ]

    tools = AgentTools(repo_path=str(tmp_path), static_graph=MockGraph())
    result = tools.get_imports("main.py")

    assert result["success"] is True
    assert len(result["imports"]) == 1
    assert result["imports"][0]["target"] == "utils.py"
