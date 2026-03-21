"""Tests for call_graph_extractor module."""
import pytest
from backend.pipeline.stages.call_graph_extractor import (
    extract_java_calls,
    extract_python_calls,
)

# ─── Python 测试 ───────────────────────────────────────────────

PYTHON_SIMPLE = '''\
class MyService:
    def process(self):
        result = self.validate()
        return result

    def validate(self):
        return True
'''


def test_python_intra_class_call():
    """self.validate() 应生成 process -> validate 的 calls 边。"""
    file_path = "src/my_service.py"
    node_ids = {
        f"function:{file_path}:MyService.process",
        f"function:{file_path}:MyService.validate",
    }
    calls = extract_python_calls(PYTHON_SIMPLE, file_path, node_ids)
    assert (
        f"function:{file_path}:MyService.process",
        f"function:{file_path}:MyService.validate",
        0.90,
    ) in calls


def test_python_no_self_call_ignored():
    """非 self.xxx() 的调用不应生成边（外部函数调用暂不处理）。"""
    source = '''\
class MyService:
    def run(self):
        print("hello")
        some_util()
'''
    file_path = "src/svc.py"
    node_ids = {f"function:{file_path}:MyService.run"}
    calls = extract_python_calls(source, file_path, node_ids)
    assert calls == []


def test_python_unknown_callee_ignored():
    """callee 不在 node_ids 中时，不应生成边。"""
    source = '''\
class A:
    def foo(self):
        self.bar()
'''
    file_path = "src/a.py"
    # 只注册 foo，不注册 bar
    node_ids = {f"function:{file_path}:A.foo"}
    calls = extract_python_calls(source, file_path, node_ids)
    assert calls == []


def test_python_no_self_call_to_self():
    """调用自身（递归）不应生成自环。"""
    source = '''\
class A:
    def foo(self):
        self.foo()
'''
    file_path = "src/a.py"
    node_ids = {f"function:{file_path}:A.foo"}
    calls = extract_python_calls(source, file_path, node_ids)
    assert calls == []


def test_python_invalid_syntax_returns_empty():
    """语法错误的文件应返回空列表，不抛异常。"""
    calls = extract_python_calls("def {{{ invalid", "src/bad.py", set())
    assert calls == []


# ─── Java 测试（javalang AST 路径） ────────────────────────────

JAVA_SIMPLE = '''\
package com.example;

public class OrderService {
    public void createOrder() {
        validate();
    }

    public void validate() {
    }
}
'''


def test_java_intra_class_no_qualifier():
    """无限定符的方法调用（隐式 this）应生成 calls 边。"""
    pytest.importorskip("javalang")
    file_path = "src/OrderService.java"
    node_ids = {
        f"function:{file_path}:OrderService.createOrder",
        f"function:{file_path}:OrderService.validate",
    }
    calls = extract_java_calls(source=JAVA_SIMPLE, file_path=file_path,
                                node_ids=node_ids, class_to_file={})
    assert (
        f"function:{file_path}:OrderService.createOrder",
        f"function:{file_path}:OrderService.validate",
        0.90,
    ) in calls


JAVA_CROSS_CLASS = '''\
package com.example;

public class A {
    public void doSomething() {
        B b = new B();
        b.run();
    }
}

public class B {
    public void run() {
    }
}
'''


def test_java_intra_file_cross_class():
    """同文件跨类调用应生成 confidence=0.80 的边。"""
    pytest.importorskip("javalang")
    file_path = "src/AB.java"
    node_ids = {
        f"function:{file_path}:A.doSomething",
        f"function:{file_path}:B.run",
    }
    calls = extract_java_calls(source=JAVA_CROSS_CLASS, file_path=file_path,
                                node_ids=node_ids, class_to_file={})
    assert (
        f"function:{file_path}:A.doSomething",
        f"function:{file_path}:B.run",
        0.80,
    ) in calls


def test_java_cross_file_via_import():
    """通过 class_to_file 映射解析跨文件调用，confidence=0.70。"""
    pytest.importorskip("javalang")
    source = '''\
package com.example;
public class Controller {
    private Service service;
    public void handle() {
        service.process();
    }
}
'''
    file_path = "src/Controller.java"
    service_file = "src/Service.java"
    node_ids = {
        f"function:{file_path}:Controller.handle",
        f"function:{service_file}:Service.process",
    }
    class_to_file = {"Service": service_file}
    calls = extract_java_calls(source=source, file_path=file_path,
                                node_ids=node_ids, class_to_file=class_to_file)
    assert (
        f"function:{file_path}:Controller.handle",
        f"function:{service_file}:Service.process",
        0.70,
    ) in calls


def test_java_unknown_callee_ignored():
    """callee 不在 node_ids 中时不生成边。"""
    pytest.importorskip("javalang")
    source = '''\
public class Svc {
    public void foo() { bar(); }
}
'''
    file_path = "src/Svc.java"
    # bar 未注册
    node_ids = {f"function:{file_path}:Svc.foo"}
    calls = extract_java_calls(source=source, file_path=file_path,
                                node_ids=node_ids, class_to_file={})
    assert calls == []


def test_java_no_duplicate_edges():
    """同一调用多次出现时只生成一条边。"""
    pytest.importorskip("javalang")
    source = '''\
public class A {
    public void caller() {
        callee();
        callee();
        callee();
    }
    public void callee() {}
}
'''
    file_path = "src/A.java"
    node_ids = {
        f"function:{file_path}:A.caller",
        f"function:{file_path}:A.callee",
    }
    calls = extract_java_calls(source=source, file_path=file_path,
                                node_ids=node_ids, class_to_file={})
    assert len(calls) == 1


def test_java_parse_error_returns_empty():
    """无法解析的文件（非 Java）应返回空列表，不抛异常。"""
    pytest.importorskip("javalang")
    calls = extract_java_calls("not java code !!!@#$", "src/bad.java",
                                node_ids=set(), class_to_file={})
    assert calls == []


# ─── 集成测试：DeepStaticAnalysisStage 产出 calls 边 ─────────────

import tempfile, os
from pathlib import Path
from backend.pipeline.stages.deep_static_analysis import DeepStaticAnalysisStage
from backend.models.static_analysis import FileInfo


def _make_file_info(rel_path: str, lang: str = "python", repo_root: Path = Path(".")) -> FileInfo:
    return FileInfo(
        path=rel_path,
        absolute_path=repo_root / rel_path,
        language=lang,
        size_bytes=0,
        line_count=0,
        modified_time=0.0,
    )


def test_deep_static_stage_produces_calls_edges():
    """DeepStaticAnalysisStage.run() 应在 structural_edges 中包含 calls 类型边。"""
    python_source = '''\
class Greeter:
    def greet(self):
        msg = self.build_message()
        return msg

    def build_message(self):
        return "hello"
'''
    with tempfile.TemporaryDirectory() as tmpdir:
        repo_path = Path(tmpdir)
        rel = "greeter.py"
        (repo_path / rel).write_text(python_source, encoding="utf-8")

        all_files = {rel: _make_file_info(rel, "python", repo_path)}
        stage = DeepStaticAnalysisStage(max_workers=1)
        result = stage.run(repo_path, all_files)

        call_edges = [e for e in result.structural_edges if e.type == "calls"]
        assert len(call_edges) >= 1, (
            f"Expected >=1 calls edge, got {len(call_edges)}. "
            f"All edge types: {[e.type for e in result.structural_edges]}"
        )

        caller = f"function:{rel}:Greeter.greet"
        callee = f"function:{rel}:Greeter.build_message"
        ids = [(e.from_, e.to) for e in call_edges]
        assert (caller, callee) in ids, f"Expected {caller} -> {callee}, got {ids}"
