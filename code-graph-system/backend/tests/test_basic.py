"""
基础测试示例。

运行方式:
    pytest backend/tests/test_basic.py -v
"""

import pytest
from pathlib import Path


def test_imports():
    """测试核心模块是否可以正常导入。"""
    from backend.parser.language_loader import LanguageLoader
    from backend.parser.code_parser import CodeParser
    from backend.scanner.repo_scanner import RepoScanner
    from backend.graph.schema import CodeGraph, FunctionNode
    from backend.graph.graph_builder import GraphBuilder

    assert LanguageLoader is not None
    assert CodeParser is not None
    assert RepoScanner is not None
    assert CodeGraph is not None
    assert GraphBuilder is not None


def test_language_loader():
    """测试语言加载器。"""
    from backend.parser.language_loader import LanguageLoader

    loader = LanguageLoader()

    # 测试语言检测
    assert loader.get_language_for_file("test.py") == "python"
    assert loader.get_language_for_file("test.js") == "javascript"
    assert loader.get_language_for_file("test.ts") == "typescript"
    assert loader.get_language_for_file("test.unknown") is None

    # 测试支持的语言列表
    langs = loader.supported_languages()
    assert "python" in langs
    assert "javascript" in langs


def test_code_parser():
    """测试代码解析器。"""
    from backend.parser.code_parser import CodeParser

    parser = CodeParser()

    # 测试 Python 代码解析
    source = """
def hello(name: str) -> str:
    '''Say hello.'''
    return f"Hello, {name}!"

class Greeter:
    def greet(self):
        return hello("World")
"""

    result = parser.parse_source(source, "python", "test.py")

    assert result.language == "python"
    assert len(result.functions) == 1
    assert result.functions[0].name == "hello"
    assert len(result.classes) == 1
    assert result.classes[0].name == "Greeter"


def test_graph_schema():
    """测试图谱数据模型。"""
    from backend.graph.schema import (
        FunctionNode, ModuleNode, EdgeBase, EdgeType, CodeGraph, RepositoryNode
    )

    # 创建节点
    module = ModuleNode(name="test_module", file_path="/test.py")
    func = FunctionNode(name="test_func", line_start=1, line_end=10)

    # 创建边
    edge = EdgeBase(
        type=EdgeType.CONTAINS,
        source_id=module.id,
        target_id=func.id,
    )

    # 创建图谱
    repo = RepositoryNode(name="test_repo", file_path="/repo")
    graph = CodeGraph(
        repository=repo,
        nodes=[module, func],
        edges=[edge],
    )

    assert graph.stats.node_count == 2
    assert graph.stats.edge_count == 1


def test_graph_builder():
    """测试图谱构建器。"""
    from backend.graph.graph_builder import GraphBuilder
    from backend.graph.schema import FunctionNode, EdgeBase, EdgeType, RepositoryNode

    builder = GraphBuilder()

    # 添加节点
    func1 = FunctionNode(name="func1", line_start=1, line_end=5)
    func2 = FunctionNode(name="func2", line_start=10, line_end=15)
    builder.add_nodes([func1, func2])

    # 添加边
    edge = EdgeBase(type=EdgeType.CALLS, source_id=func1.id, target_id=func2.id)
    builder.add_edge(edge)

    # 构建图谱
    repo = RepositoryNode(name="test", file_path="/test")
    graph = builder.build(repo)

    assert graph.stats.node_count == 3  # repo + 2 functions
    assert graph.stats.edge_count == 1


def test_vector_store():
    """测试向量存储（需要 ChromaDB）。"""
    pytest.importorskip("chromadb")

    from backend.rag.vector_store import VectorStore
    from backend.graph.schema import FunctionNode

    store = VectorStore(persist_dir="./test_chroma")

    # 创建测试节点（带嵌入向量）
    node = FunctionNode(
        name="test_func",
        line_start=1,
        line_end=10,
        embedding=[0.1] * 384,  # 模拟嵌入向量
    )
    node.metadata["semantic_summary"] = "This is a test function"

    # 添加节点
    count = store.add_nodes([node], collection_name="test_collection")
    assert count == 1

    # 清理
    store.delete_collection("test_collection")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
