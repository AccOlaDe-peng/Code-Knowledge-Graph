"""SharedKnowledgePool 单元测试。"""
from __future__ import annotations

import threading
from pathlib import Path

import pytest

from backend.cache.shared_knowledge_pool import FileInfo, SharedKnowledgePool


@pytest.fixture
def sample_repo(tmp_path: Path) -> Path:
    """创建包含几个源文件的临时仓库。"""
    (tmp_path / "main.py").write_text("def hello(): pass\n", encoding="utf-8")
    (tmp_path / "utils.py").write_text("def util(): pass\n", encoding="utf-8")
    sub = tmp_path / "sub"
    sub.mkdir()
    (sub / "module.py").write_text("class Foo:\n    pass\n", encoding="utf-8")
    return tmp_path


class TestFileIndex:
    def test_build_file_index(self, sample_repo):
        pool = SharedKnowledgePool(sample_repo)
        pool.build_file_index(["main.py", "utils.py", "sub/module.py"])
        assert "main.py" in pool.file_index
        assert "sub/module.py" in pool.file_index

    def test_file_info_fields(self, sample_repo):
        pool = SharedKnowledgePool(sample_repo)
        pool.build_file_index(["main.py"])
        info = pool.file_index["main.py"]
        assert info.path == "main.py"
        assert info.language == "python"
        assert info.size_bytes > 0
        assert info.line_count == 1

    def test_get_file_info(self, sample_repo):
        pool = SharedKnowledgePool(sample_repo)
        pool.build_file_index(["main.py"])
        assert pool.get_file_info("main.py") is not None
        assert pool.get_file_info("not_exist.py") is None


class TestContentCache:
    def test_get_content_reads_file(self, sample_repo):
        pool = SharedKnowledgePool(sample_repo)
        pool.build_file_index(["main.py"])
        content = pool.get_content("main.py")
        assert content is not None
        assert "hello" in content

    def test_get_content_caches_result(self, sample_repo):
        pool = SharedKnowledgePool(sample_repo)
        pool.build_file_index(["main.py"])
        c1 = pool.get_content("main.py")
        c2 = pool.get_content("main.py")
        assert c1 == c2
        assert pool._content_cache.size == 1  # 只缓存了一次

    def test_get_content_returns_none_for_unknown(self, sample_repo):
        pool = SharedKnowledgePool(sample_repo)
        pool.build_file_index(["main.py"])
        assert pool.get_content("ghost.py") is None

    def test_concurrent_get_content(self, sample_repo):
        pool = SharedKnowledgePool(sample_repo)
        pool.build_file_index(["main.py"])
        results = []
        errors = []

        def worker():
            try:
                results.append(pool.get_content("main.py"))
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=worker) for _ in range(10)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert not errors
        assert all(r is not None for r in results)


class TestTokenEstimation:
    def test_estimate_tokens_english(self, sample_repo):
        pool = SharedKnowledgePool(sample_repo)
        pool.build_file_index(["main.py"])
        tokens = pool.estimate_tokens(["main.py"])
        # "def hello(): pass\n" ≈ 5 tokens
        assert tokens > 0
        assert tokens < 50

    def test_estimate_tokens_empty_paths(self, sample_repo):
        pool = SharedKnowledgePool(sample_repo)
        pool.build_file_index(["main.py"])
        assert pool.estimate_tokens([]) == 0

    def test_estimate_tokens_chinese_content(self, sample_repo):
        # 创建包含中文的文件
        (sample_repo / "chinese.py").write_text(
            "# 这是一个中文注释\nx = '中文内容'\n", encoding="utf-8"
        )
        pool = SharedKnowledgePool(sample_repo)
        pool.build_file_index(["chinese.py"])
        tokens = pool.estimate_tokens(["chinese.py"])
        # 中文 Token 应该比英文更高比例
        assert tokens > 0
