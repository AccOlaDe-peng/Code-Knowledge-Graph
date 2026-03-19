"""测试 StructureIndexer 骨架提取和 search_structure 查询。"""

import textwrap
import tempfile
from pathlib import Path
import pytest
from backend.agent.structure_indexer import StructureIndexer, FileSkeleton


# ── Java 骨架提取 ─────────────────────────────────────────────────────────────

SAMPLE_JAVA = textwrap.dedent("""\
    package com.example.api;

    import org.springframework.web.bind.annotation.RestController;
    import org.springframework.web.bind.annotation.GetMapping;
    import com.example.service.UserService;

    @RestController
    public class UserController {

        private UserService userService;

        @GetMapping("/users")
        public List<User> getUsers() {
            return userService.findAll();
        }

        private void helper() {}
    }
""")


@pytest.fixture
def java_repo(tmp_path: Path) -> Path:
    """创建包含一个 Java 文件的临时仓库。"""
    src = tmp_path / "src" / "main" / "java" / "com" / "example" / "api"
    src.mkdir(parents=True)
    (src / "UserController.java").write_text(SAMPLE_JAVA, encoding="utf-8")
    return tmp_path


class TestJavaScan:
    def test_build_index_finds_java_file(self, java_repo):
        indexer = StructureIndexer(depth="standard")
        indexer.build_index(java_repo)
        keys = list(indexer._index.keys())
        assert any("UserController.java" in k for k in keys)

    def test_skeleton_has_class_info(self, java_repo):
        indexer = StructureIndexer(depth="standard")
        indexer.build_index(java_repo)
        key = next(k for k in indexer._index if "UserController.java" in k)
        skeleton = indexer._index[key]
        assert skeleton.language == "java"
        assert len(skeleton.classes) >= 1
        cls = skeleton.classes[0]
        assert cls.name == "UserController"
        assert "@RestController" in cls.annotations

    def test_standard_depth_includes_public_methods(self, java_repo):
        indexer = StructureIndexer(depth="standard")
        indexer.build_index(java_repo)
        key = next(k for k in indexer._index if "UserController.java" in k)
        cls = indexer._index[key].classes[0]
        method_names = [m.name for m in cls.methods]
        assert "getUsers" in method_names

    def test_quick_depth_excludes_methods(self, java_repo):
        indexer = StructureIndexer(depth="quick")
        indexer.build_index(java_repo)
        key = next(k for k in indexer._index if "UserController.java" in k)
        cls = indexer._index[key].classes[0]
        assert len(cls.methods) == 0  # quick 只要类名+注解

    def test_line_count_correct(self, java_repo):
        indexer = StructureIndexer(depth="standard")
        indexer.build_index(java_repo)
        key = next(k for k in indexer._index if "UserController.java" in k)
        assert indexer._index[key].line_count == len(SAMPLE_JAVA.splitlines())

    def test_imports_captured(self, java_repo):
        indexer = StructureIndexer(depth="standard")
        indexer.build_index(java_repo)
        key = next(k for k in indexer._index if "UserController.java" in k)
        imports = indexer._index[key].top_imports
        assert any("RestController" in imp for imp in imports)


# ── Python 骨架提取 ───────────────────────────────────────────────────────────

SAMPLE_PYTHON = textwrap.dedent("""\
    from typing import List
    import os

    class UserService:
        '''Service for user management.'''

        def get_user(self, user_id: int) -> dict:
            pass

        def _private_helper(self):
            pass
""")


@pytest.fixture
def python_repo(tmp_path: Path) -> Path:
    (tmp_path / "services").mkdir()
    (tmp_path / "services" / "user_service.py").write_text(SAMPLE_PYTHON, encoding="utf-8")
    return tmp_path


class TestPythonScan:
    def test_build_index_finds_python_file(self, python_repo):
        indexer = StructureIndexer(depth="standard")
        indexer.build_index(python_repo)
        keys = list(indexer._index.keys())
        assert any("user_service.py" in k for k in keys)

    def test_skeleton_has_class(self, python_repo):
        indexer = StructureIndexer(depth="standard")
        indexer.build_index(python_repo)
        key = next(k for k in indexer._index if "user_service.py" in k)
        classes = indexer._index[key].classes
        assert any(c.name == "UserService" for c in classes)

    def test_standard_includes_public_methods(self, python_repo):
        indexer = StructureIndexer(depth="standard")
        indexer.build_index(python_repo)
        key = next(k for k in indexer._index if "user_service.py" in k)
        cls = next(c for c in indexer._index[key].classes if c.name == "UserService")
        method_names = [m.name for m in cls.methods]
        assert "get_user" in method_names

    def test_imports_captured(self, python_repo):
        indexer = StructureIndexer(depth="standard")
        indexer.build_index(python_repo)
        key = next(k for k in indexer._index if "user_service.py" in k)
        assert any("typing" in imp or "os" in imp for imp in indexer._index[key].top_imports)


# ── search_structure 查询 ────────────────────────────────────────────────────

class TestSearchStructure:
    @pytest.fixture
    def indexed(self, java_repo) -> StructureIndexer:
        indexer = StructureIndexer(depth="standard")
        indexer.build_index(java_repo)
        return indexer

    def test_search_by_annotation(self, indexed):
        result = indexed.search_structure(annotation="@RestController")
        assert result["count"] >= 1
        assert any("UserController" in str(r) for r in result["results"])

    def test_search_by_keyword(self, indexed):
        result = indexed.search_structure(keyword="UserController")
        assert result["count"] >= 1

    def test_no_match_returns_empty(self, indexed):
        result = indexed.search_structure(keyword="NonExistentXYZ123")
        assert result["count"] == 0
        assert result["results"] == []

    def test_max_results_respected(self, tmp_path):
        """当结果超出 max_results 时应截断并附说明。"""
        for i in range(5):
            src = tmp_path / f"Ctrl{i}.java"
            src.write_text(f"@RestController\npublic class Ctrl{i} {{}}\n", encoding="utf-8")
        indexer = StructureIndexer(depth="standard")
        indexer.build_index(tmp_path)
        result = indexer.search_structure(annotation="@RestController", max_results=2)
        assert len(result["results"]) <= 2
        if result["total_count"] > 2:
            assert result.get("truncated") is True

    def test_result_contains_line_numbers(self, indexed):
        result = indexed.search_structure(annotation="@RestController")
        if result["count"] > 0:
            first = result["results"][0]
            classes = first.get("classes", [])
            if classes:
                assert "line" in classes[0]
