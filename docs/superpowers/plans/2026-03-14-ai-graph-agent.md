# AI Graph Agent Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 4 AI analyzers with a single autonomous agent that explores repositories using tools

**Architecture:** Agent receives static analysis summary as initial context, uses 7 tools (read_file, list_directory, search_code, get_ast_nodes, get_call_graph, get_imports, emit_graph) to explore codebase autonomously, outputs complete knowledge graph with semantic nodes (LAYER, SERVICE, FLOW) and edges

**Tech Stack:** Python 3.10+, Anthropic SDK, existing backend infrastructure (graph_schema, ai_analyzer_base, llm_client)

---

## Chunk 1: Foundation - Tools Infrastructure

### Task 1: Create agent package structure

**Files:**
- Create: `code-graph-system/backend/analyzer/ai/agent/__init__.py`

- [ ] **Step 1: Create agent package directory**

Run: `mkdir -p code-graph-system/backend/analyzer/ai/agent`

- [ ] **Step 2: Create __init__.py with exports**

```python
"""
AI Graph Agent - Autonomous repository exploration for knowledge graph generation.
"""

from .graph_agent import AIGraphAgent
from .tools import AgentTools
from .context_builder import ContextBuilder
from .output_parser import OutputParser

__all__ = [
    "AIGraphAgent",
    "AgentTools",
    "ContextBuilder",
    "OutputParser",
]
```

- [ ] **Step 3: Commit**

```bash
git add code-graph-system/backend/analyzer/ai/agent/
git commit -m "feat(ai): create agent package structure"
```

### Task 2: Implement AgentTools - read_file

**Files:**
- Create: `code-graph-system/backend/analyzer/ai/agent/tools.py`
- Test: `code-graph-system/backend/tests/test_agent_tools.py`

- [ ] **Step 1: Write failing test for read_file**

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd code-graph-system && pytest backend/tests/test_agent_tools.py::test_read_file_basic -v`
Expected: FAIL with "ModuleNotFoundError: No module named 'backend.analyzer.ai.agent.tools'"

- [ ] **Step 3: Write minimal implementation**

```python
"""
Agent tools for autonomous repository exploration.
"""

from pathlib import Path
from typing import Any, Optional
import re


class AgentTools:
    """Tools available to AIGraphAgent for exploring repositories."""

    MAX_FILE_LINES = 200

    def __init__(self, repo_path: str, static_graph: Any):
        """
        Initialize agent tools.

        Args:
            repo_path: Absolute path to repository root
            static_graph: Snapshot of static analysis graph (for get_ast_nodes, get_call_graph)
        """
        self.repo_path = Path(repo_path)
        self.static_graph = static_graph

    def read_file(
        self,
        path: str,
        start_line: int = 1,
        end_line: Optional[int] = None,
    ) -> dict[str, Any]:
        """
        Read source code from a file.

        Args:
            path: File path (absolute or relative to repo_path)
            start_line: Starting line number (1-indexed)
            end_line: Ending line number (inclusive), None = read to end

        Returns:
            {
                "success": bool,
                "content": str,
                "lines": int,
                "truncated": bool,
                "error": str (if success=False)
            }
        """
        try:
            file_path = Path(path)
            if not file_path.is_absolute():
                file_path = self.repo_path / file_path

            if not file_path.exists():
                return {
                    "success": False,
                    "error": f"File not found: {path}",
                }

            with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                all_lines = f.readlines()

            # Apply line range
            start_idx = max(0, start_line - 1)
            if end_line is None:
                end_idx = len(all_lines)
            else:
                end_idx = min(len(all_lines), end_line)

            selected_lines = all_lines[start_idx:end_idx]

            # Truncate if exceeds MAX_FILE_LINES
            truncated = False
            if len(selected_lines) > self.MAX_FILE_LINES:
                selected_lines = selected_lines[:self.MAX_FILE_LINES]
                truncated = True

            content = "".join(selected_lines)

            return {
                "success": True,
                "content": content,
                "lines": len(selected_lines),
                "truncated": truncated,
            }

        except Exception as e:
            return {
                "success": False,
                "error": str(e),
            }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd code-graph-system && pytest backend/tests/test_agent_tools.py::test_read_file_basic backend/tests/test_agent_tools.py::test_read_file_with_line_range backend/tests/test_agent_tools.py::test_read_file_truncates_long_files -v`
Expected: 3 PASSED

- [ ] **Step 5: Commit**

```bash
git add code-graph-system/backend/analyzer/ai/agent/tools.py code-graph-system/backend/tests/test_agent_tools.py
git commit -m "feat(ai): implement read_file tool with truncation"
```

### Task 3: Implement AgentTools - list_directory

**Files:**
- Modify: `code-graph-system/backend/analyzer/ai/agent/tools.py`
- Test: `code-graph-system/backend/tests/test_agent_tools.py`

- [ ] **Step 1: Write failing test**

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd code-graph-system && pytest backend/tests/test_agent_tools.py::test_list_directory_basic -v`
Expected: FAIL with "AttributeError: 'AgentTools' object has no attribute 'list_directory'"

- [ ] **Step 3: Add list_directory method**

```python
    def list_directory(self, path: str) -> dict[str, Any]:
        """
        List files and subdirectories in a directory (non-recursive).

        Args:
            path: Directory path (absolute or relative to repo_path)

        Returns:
            {
                "success": bool,
                "entries": [{"name": str, "type": "file"|"dir", "size": int}],
                "error": str (if success=False)
            }
        """
        try:
            dir_path = Path(path)
            if not dir_path.is_absolute():
                dir_path = self.repo_path / dir_path

            if not dir_path.exists():
                return {
                    "success": False,
                    "error": f"Directory not found: {path}",
                }

            if not dir_path.is_dir():
                return {
                    "success": False,
                    "error": f"Not a directory: {path}",
                }

            entries = []
            for item in sorted(dir_path.iterdir()):
                entry = {
                    "name": item.name,
                    "type": "dir" if item.is_dir() else "file",
                }
                if item.is_file():
                    entry["size"] = item.stat().st_size
                entries.append(entry)

            return {
                "success": True,
                "entries": entries,
            }

        except Exception as e:
            return {
                "success": False,
                "error": str(e),
            }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd code-graph-system && pytest backend/tests/test_agent_tools.py::test_list_directory_basic -v`
Expected: PASSED

- [ ] **Step 5: Commit**

```bash
git add code-graph-system/backend/analyzer/ai/agent/tools.py code-graph-system/backend/tests/test_agent_tools.py
git commit -m "feat(ai): implement list_directory tool"
```

### Task 4: Implement AgentTools - search_code

**Files:**
- Modify: `code-graph-system/backend/analyzer/ai/agent/tools.py`
- Test: `code-graph-system/backend/tests/test_agent_tools.py`

- [ ] **Step 1: Write failing test**

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd code-graph-system && pytest backend/tests/test_agent_tools.py::test_search_code_basic -v`
Expected: FAIL with "AttributeError: 'AgentTools' object has no attribute 'search_code'"

- [ ] **Step 3: Add search_code method**

```python
    MAX_SEARCH_RESULTS = 50

    def search_code(
        self,
        pattern: str,
        file_glob: str = "**/*",
    ) -> dict[str, Any]:
        """
        Search for pattern in repository files.

        Args:
            pattern: Search pattern (regex)
            file_glob: File glob pattern (default: all files)

        Returns:
            {
                "success": bool,
                "matches": [{"file": str, "line": int, "content": str}],
                "truncated": bool,
                "error": str (if success=False)
            }
        """
        try:
            regex = re.compile(pattern, re.IGNORECASE)
            matches = []

            # Simple recursive search (not using ripgrep for simplicity)
            for file_path in self.repo_path.rglob("*"):
                if not file_path.is_file():
                    continue

                # Skip binary files and common ignore patterns
                if file_path.suffix in {".pyc", ".so", ".dll", ".exe"}:
                    continue
                if any(part.startswith(".") for part in file_path.parts):
                    continue

                try:
                    with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                        for line_num, line in enumerate(f, start=1):
                            if regex.search(line):
                                rel_path = file_path.relative_to(self.repo_path)
                                matches.append({
                                    "file": str(rel_path),
                                    "line": line_num,
                                    "content": line.rstrip(),
                                })

                                if len(matches) >= self.MAX_SEARCH_RESULTS:
                                    return {
                                        "success": True,
                                        "matches": matches,
                                        "truncated": True,
                                    }
                except (UnicodeDecodeError, PermissionError):
                    continue

            return {
                "success": True,
                "matches": matches,
                "truncated": False,
            }

        except Exception as e:
            return {
                "success": False,
                "error": str(e),
            }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd code-graph-system && pytest backend/tests/test_agent_tools.py::test_search_code_basic -v`
Expected: PASSED

- [ ] **Step 5: Commit**

```bash
git add code-graph-system/backend/analyzer/ai/agent/tools.py code-graph-system/backend/tests/test_agent_tools.py
git commit -m "feat(ai): implement search_code tool with regex"
```

### Task 5: Implement AgentTools - get_ast_nodes

**Files:**
- Modify: `code-graph-system/backend/analyzer/ai/agent/tools.py`
- Test: `code-graph-system/backend/tests/test_agent_tools.py`

- [ ] **Step 1: Write failing test**

```python
from backend.graph.graph_schema import GraphNode, NodeType


def test_get_ast_nodes_from_static_graph(tmp_path):
    """Test retrieving AST nodes from static analysis."""
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd code-graph-system && pytest backend/tests/test_agent_tools.py::test_get_ast_nodes_from_static_graph -v`
Expected: FAIL with "AttributeError: 'AgentTools' object has no attribute 'get_ast_nodes'"

- [ ] **Step 3: Add get_ast_nodes method**

```python
    def get_ast_nodes(self, path: str) -> dict[str, Any]:
        """
        Get AST nodes (classes, functions) from static analysis for a file.

        Args:
            path: File path (relative to repo_path)

        Returns:
            {
                "success": bool,
                "nodes": [{"id": str, "type": str, "name": str, "line": int}],
                "error": str (if success=False)
            }
        """
        try:
            if self.static_graph is None:
                return {
                    "success": False,
                    "error": "Static graph not available",
                }

            # Normalize path
            norm_path = str(Path(path)).replace("\\", "/")

            # Filter nodes by file
            matching_nodes = []
            for node in self.static_graph.nodes:
                node_file = node.properties.get("file", "")
                if node_file and norm_path in node_file:
                    matching_nodes.append({
                        "id": node.id,
                        "type": node.type,
                        "name": node.name,
                        "line": node.properties.get("line", 0),
                    })

            return {
                "success": True,
                "nodes": matching_nodes,
            }

        except Exception as e:
            return {
                "success": False,
                "error": str(e),
            }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd code-graph-system && pytest backend/tests/test_agent_tools.py::test_get_ast_nodes_from_static_graph -v`
Expected: PASSED

- [ ] **Step 5: Commit**

```bash
git add code-graph-system/backend/analyzer/ai/agent/tools.py code-graph-system/backend/tests/test_agent_tools.py
git commit -m "feat(ai): implement get_ast_nodes tool"
```


### Task 6: Implement AgentTools - get_call_graph

**Files:**
- Modify: `code-graph-system/backend/analyzer/ai/agent/tools.py`
- Test: `code-graph-system/backend/tests/test_agent_tools.py`

- [ ] **Step 1: Write failing test**

```python
from backend.graph.graph_schema import GraphEdge, EdgeType


def test_get_call_graph_depth_1(tmp_path):
    """Test retrieving call graph for a node."""
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd code-graph-system && pytest backend/tests/test_agent_tools.py::test_get_call_graph_depth_1 -v`
Expected: FAIL

- [ ] **Step 3: Add get_call_graph method**

```python
    def get_call_graph(
        self,
        node_id: str,
        depth: int = 1,
    ) -> dict[str, Any]:
        """
        Get call graph edges starting from a node.

        Args:
            node_id: Starting node ID
            depth: Traversal depth (default: 1)

        Returns:
            {
                "success": bool,
                "edges": [{"from": str, "to": str, "type": str}],
                "error": str (if success=False)
            }
        """
        try:
            if self.static_graph is None:
                return {
                    "success": False,
                    "error": "Static graph not available",
                }

            # BFS to collect edges up to depth (with cycle detection)
            visited = set()
            current_level = {node_id}
            all_edges = []
            seen_edges = set()  # Track edges to avoid duplicates in cycles

            for _ in range(depth):
                next_level = set()
                for edge in self.static_graph.edges:
                    edge_key = (edge.from_, edge.to)
                    if edge.from_ in current_level and edge_key not in seen_edges:
                        all_edges.append({
                            "from": edge.from_,
                            "to": edge.to,
                            "type": edge.type,
                        })
                        seen_edges.add(edge_key)
                        if edge.to not in visited:
                            next_level.add(edge.to)

                visited.update(current_level)
                current_level = next_level

                if not current_level:
                    break

            return {
                "success": True,
                "edges": all_edges,
            }

        except Exception as e:
            return {
                "success": False,
                "error": str(e),
            }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd code-graph-system && pytest backend/tests/test_agent_tools.py::test_get_call_graph_depth_1 -v`
Expected: PASSED

- [ ] **Step 5: Commit**

```bash
git add code-graph-system/backend/analyzer/ai/agent/tools.py code-graph-system/backend/tests/test_agent_tools.py
git commit -m "feat(ai): implement get_call_graph tool with BFS"
```

### Task 7: Implement AgentTools - get_imports

**Files:**
- Modify: `code-graph-system/backend/analyzer/ai/agent/tools.py`
- Test: `code-graph-system/backend/tests/test_agent_tools.py`

- [ ] **Step 1: Write failing test**

```python
def test_get_imports_from_static_graph(tmp_path):
    """Test retrieving import dependencies."""
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd code-graph-system && pytest backend/tests/test_agent_tools.py::test_get_imports_from_static_graph -v`
Expected: FAIL

- [ ] **Step 3: Add get_imports method**

```python
    def get_imports(self, path: str) -> dict[str, Any]:
        """
        Get import dependencies for a file from static analysis.

        Args:
            path: File path (relative to repo_path)

        Returns:
            {
                "success": bool,
                "imports": [{"target": str, "type": str}],
                "error": str (if success=False)
            }
        """
        try:
            if self.static_graph is None:
                return {
                    "success": False,
                    "error": "Static graph not available",
                }

            # Normalize path
            norm_path = str(Path(path)).replace("\\", "/")

            # Find file node
            file_node_id = None
            for node in self.static_graph.nodes:
                if node.name and norm_path in node.name:
                    file_node_id = node.id
                    break

            if not file_node_id:
                return {
                    "success": True,
                    "imports": [],
                }

            # Find IMPORTS edges
            imports = []
            for edge in self.static_graph.edges:
                if edge.from_ == file_node_id and edge.type == "IMPORTS":
                    # Find target node name
                    target_name = None
                    for node in self.static_graph.nodes:
                        if node.id == edge.to:
                            target_name = node.name
                            break

                    if target_name:
                        imports.append({
                            "target": target_name,
                            "type": edge.type,
                        })

            return {
                "success": True,
                "imports": imports,
            }

        except Exception as e:
            return {
                "success": False,
                "error": str(e),
            }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd code-graph-system && pytest backend/tests/test_agent_tools.py::test_get_imports_from_static_graph -v`
Expected: PASSED

- [ ] **Step 5: Commit**

```bash
git add code-graph-system/backend/analyzer/ai/agent/tools.py code-graph-system/backend/tests/test_agent_tools.py
git commit -m "feat(ai): implement get_imports tool"
```

### Task 8: Implement ContextBuilder

**Files:**
- Create: `code-graph-system/backend/analyzer/ai/agent/context_builder.py`
- Test: `code-graph-system/backend/tests/test_context_builder.py`

- [ ] **Step 1: Write failing test**

```python
import pytest
from backend.analyzer.ai.agent.context_builder import ContextBuilder
from backend.pipeline.repo_summary import RepoSummary


def test_context_builder_basic():
    """Test building initial context from summary."""
    # Note: Verify RepoSummary schema before running
    summary = RepoSummary(
        repo_name="test-repo",
        repo_path="/path/to/repo",
        languages=["python", "typescript"],
        commit_sha="abc123",
        modules=[],
        functions=[],
        apis=[],
        events=[],
        services=[],
        call_graph_sample=[],
        node_counts={"Function": 100, "Module": 10},
    )

    builder = ContextBuilder()
    context = builder.build(summary, max_tool_calls=20)

    assert "Repository: test-repo" in context
    assert "Languages: python, typescript" in context
    assert "Git commit: abc123" in context
    assert "Budget: 20 tool calls remaining" in context
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd code-graph-system && pytest backend/tests/test_context_builder.py::test_context_builder_basic -v`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation (first 50 lines)**

```python
"""
Context builder for AI Graph Agent initial prompt.
"""

from typing import Any
from backend.pipeline.repo_summary import RepoSummary


class ContextBuilder:
    """Builds initial context for agent from static analysis summary."""

    MAX_TREE_LINES = 100
    MAX_MODULES = 30
    MAX_FUNCTIONS = 50
    MAX_CALL_EDGES = 40
    MAX_APIS = 30
    MAX_EVENTS = 20

    def build(self, summary: RepoSummary, max_tool_calls: int) -> str:
        """
        Build initial context prompt from repository summary.

        Args:
            summary: Static analysis summary
            max_tool_calls: Tool call budget

        Returns:
            Formatted context string for agent
        """
        sections = []

        # Header
        sections.append(f"# Repository: {summary.repo_name}")
        sections.append(f"# Languages: {', '.join(summary.languages)}")
        sections.append(f"# Git commit: {summary.commit_sha or 'N/A'}")
        sections.append("")

        # File tree (if available)
        if hasattr(summary, "directory_tree") and summary.directory_tree:
            sections.append("## File Tree (top 3 levels)")
            tree_lines = summary.directory_tree.split("\n")[:self.MAX_TREE_LINES]
            sections.append("\n".join(tree_lines))
            if len(summary.directory_tree.split("\n")) > self.MAX_TREE_LINES:
                sections.append("... (truncated)")
            sections.append("")

        # Modules
        if summary.modules:
            sections.append(f"## Modules ({len(summary.modules)} total)")
```

- [ ] **Step 4: Continue implementation (remaining lines)**

```python
            for mod in summary.modules[:self.MAX_MODULES]:
                sections.append(f"  - {mod}")
            if len(summary.modules) > self.MAX_MODULES:
                sections.append(f"  ... and {len(summary.modules) - self.MAX_MODULES} more")
            sections.append("")

        # Key functions
        if summary.functions:
            sections.append(f"## Key Functions (top {min(len(summary.functions), self.MAX_FUNCTIONS)})")
            for func in summary.functions[:self.MAX_FUNCTIONS]:
                sections.append(f"  - {func}")
            sections.append("")

        # Call graph sample
        if summary.call_graph_sample:
            sections.append(f"## Call Graph Sample (top {min(len(summary.call_graph_sample), self.MAX_CALL_EDGES)} edges)")
            for edge in summary.call_graph_sample[:self.MAX_CALL_EDGES]:
                sections.append(f"  {edge}")
            sections.append("")

        # APIs
        if summary.apis:
            sections.append(f"## APIs ({len(summary.apis)} endpoints)")
            for api in summary.apis[:self.MAX_APIS]:
                sections.append(f"  - {api}")
            if len(summary.apis) > self.MAX_APIS:
                sections.append(f"  ... and {len(summary.apis) - self.MAX_APIS} more")
            sections.append("")

        # Events/Topics
        if summary.events:
            sections.append(f"## Events/Topics ({len(summary.events)})")
            for event in summary.events[:self.MAX_EVENTS]:
                sections.append(f"  - {event}")
            sections.append("")

        # Existing nodes summary
        if summary.node_counts:
            sections.append("## Existing Nodes from Static Analysis")
            node_summary = ", ".join([f"{k}:{v}" for k, v in summary.node_counts.items()])
            sections.append(node_summary)
            sections.append("")

        # Footer
        sections.append("---")
        sections.append("Your goal: explore this repository and emit a complete knowledge graph.")
        sections.append("Call tools to explore, then call emit_graph() when ready.")
        sections.append(f"Budget: {max_tool_calls} tool calls remaining.")

        return "\n".join(sections)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd code-graph-system && pytest backend/tests/test_context_builder.py::test_context_builder_basic -v`
Expected: PASSED

- [ ] **Step 6: Commit**

```bash
git add code-graph-system/backend/analyzer/ai/agent/context_builder.py code-graph-system/backend/tests/test_context_builder.py
git commit -m "feat(ai): implement ContextBuilder for initial prompt"
```

---

## Chunk 1 Review Checkpoint

Chunk 1 complete. Tasks 1-8 implement the foundation: AgentTools (7 tools) + ContextBuilder.

**Next chunks:**
- Chunk 2: OutputParser + System Prompt
- Chunk 3: AIGraphAgent main loop
- Chunk 4: Pipeline integration
- Chunk 5: Testing

