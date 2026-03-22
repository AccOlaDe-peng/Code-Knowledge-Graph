# Static Call Graph Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `DeepStaticAnalysisStage` 中添加静态调用图提取，生成 `calls` 类型边，使调用图页面能显示真实的函数调用关系。

**Architecture:** 新增 `call_graph_extractor.py` 模块，用 javalang（Java）和标准库 ast（Python）解析方法调用，并在 `DeepStaticAnalysisStage.run()` 中作为独立步骤调用。提取结果追加到 `structural_edges`，由现有的 `GraphMergeWithQualityStage` 和 `GraphStorage._derive_subgraphs()` 自动处理，无需改动下游代码。

**Tech Stack:** Python 3.12, javalang（可选，已安装），标准库 ast，pytest

---

## File Map

| 操作 | 路径 | 职责 |
|------|------|------|
| Create | `backend/pipeline/stages/call_graph_extractor.py` | Java/Python 调用边提取逻辑（纯函数，易于测试） |
| Modify | `backend/pipeline/stages/deep_static_analysis.py` | 在 `run()` 中追加调用图提取步骤 |
| Create | `backend/tests/test_call_graph_extractor.py` | 单元测试 |

---

## 背景知识（实现前必读）

### 节点 ID 格式
```
class:    "class:{rel_path}:{ClassName}"
function: "function:{rel_path}:{ClassName}.{method_name}"
```
`rel_path` 是从仓库根目录到源文件的相对路径，与 `FileSkeleton.path` 保持一致（可含 OS 特定分隔符）。

### 只有 `public` 方法创建了 Function 节点
`_build_graph_elements()` 中 `if method.visibility != "public": continue`，因此 callee 只能是 `public` 方法。

### 置信度体系
| 调用场景 | confidence |
|---------|-----------|
| 类内调用（`this.method()` 或无限定符） | 0.90 |
| 同文件跨类调用（`OtherClass.method()`） | 0.80 |
| 跨文件调用（import 解析） | 0.70 |
| 正则降级（javalang 不可用时） | 0.65 |

### GraphEdge 构造方式
```python
from backend.graph.graph_schema import GraphEdge, EdgeType
edge = GraphEdge(
    from_=caller_id,
    to=callee_id,
    type=EdgeType.CALLS.value,   # "calls"
    properties={"source": "static", "confidence": 0.90},
)
```

---

## Task 1: 创建 `call_graph_extractor.py`（纯提取逻辑）

**Files:**
- Create: `code-graph-system/backend/pipeline/stages/call_graph_extractor.py`
- Test: `code-graph-system/backend/tests/test_call_graph_extractor.py`

- [ ] **Step 1.1: 先写测试（TDD — 红阶段）**

创建测试文件 `backend/tests/test_call_graph_extractor.py`：

```python
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
```

- [ ] **Step 1.2: 运行测试确认红阶段**

```bash
cd code-graph-system
python -m pytest backend/tests/test_call_graph_extractor.py -v
```

预期：`ImportError: cannot import name 'extract_java_calls' from 'backend.pipeline.stages.call_graph_extractor'`（模块尚未存在）

- [ ] **Step 1.3: 实现 `call_graph_extractor.py`**

创建 `backend/pipeline/stages/call_graph_extractor.py`：

```python
"""静态调用图提取器：从 Java 和 Python 源码中提取方法调用关系。

置信度级别：
  0.90 — 类内调用（this.method() 或无限定符隐式调用）
  0.80 — 同文件跨类调用
  0.70 — 跨文件调用（通过 class_to_file import 映射解析）
  0.65 — 正则降级（javalang 不可用时）
"""
from __future__ import annotations

import ast
import logging
import re
from typing import Optional

logger = logging.getLogger(__name__)

# javalang 是可选依赖
try:
    import javalang
    _JAVALANG_AVAILABLE = True
except ImportError:
    _JAVALANG_AVAILABLE = False

# (caller_id, callee_id, confidence)
CallEdge = tuple[str, str, float]


def extract_file_calls(
    source: str,
    file_path: str,
    language: str,
    node_ids: set[str],
    class_to_file: Optional[dict[str, str]] = None,
) -> list[CallEdge]:
    """从单个源文件中提取方法调用关系。

    Args:
        source:       文件源码字符串
        file_path:    相对路径（用于构造节点 ID，与 DeepStaticAnalysisStage 保持一致）
        language:     'java' | 'python'
        node_ids:     已知函数节点 ID 集合（用于校验 caller/callee 存在）
        class_to_file: 类名 -> 文件路径映射（用于跨文件调用解析）

    Returns:
        [(caller_id, callee_id, confidence), ...]，已去重
    """
    lang = language.lower()
    ctf = class_to_file or {}
    if lang == "java":
        return extract_java_calls(source, file_path, node_ids, ctf)
    if lang in ("python", "py"):
        return extract_python_calls(source, file_path, node_ids)
    return []


# ── Java ──────────────────────────────────────────────────────────────────────


def extract_java_calls(
    source: str,
    file_path: str,
    node_ids: set[str],
    class_to_file: dict[str, str],
) -> list[CallEdge]:
    """Java 调用边提取（javalang AST 优先，降级正则）。"""
    if _JAVALANG_AVAILABLE:
        try:
            return _java_ast(source, file_path, node_ids, class_to_file)
        except Exception as exc:
            logger.debug("javalang 解析失败，降级正则: %s — %s", file_path, exc)
    return _java_regex(source, file_path, node_ids)


def _java_ast(
    source: str,
    file_path: str,
    node_ids: set[str],
    class_to_file: dict[str, str],
) -> list[CallEdge]:
    tree = javalang.parse.parse(source)
    calls: list[CallEdge] = []

    # 收集本文件的所有类名（用于同文件跨类匹配）
    local_classes: set[str] = set()
    for _, node in tree:
        if isinstance(node, (
            javalang.tree.ClassDeclaration,
            javalang.tree.InterfaceDeclaration,
            javalang.tree.EnumDeclaration,
        )):
            local_classes.add(node.name)

    # 遍历所有 MethodDeclaration
    for path, node in tree:
        if not isinstance(node, javalang.tree.MethodDeclaration):
            continue

        # 查找父类
        parent_class: str | None = None
        for ancestor in reversed(path):
            if isinstance(ancestor, (
                javalang.tree.ClassDeclaration,
                javalang.tree.InterfaceDeclaration,
            )):
                parent_class = ancestor.name
                break
        if not parent_class:
            continue

        caller_id = f"function:{file_path}:{parent_class}.{node.name}"
        if caller_id not in node_ids or not node.body:
            continue

        # 收集方法体内的所有 MethodInvocation
        seen: set[tuple[str, str]] = set()
        for _, inv in node.filter(javalang.tree.MethodInvocation):
            method_name: str = inv.member
            qualifier: str | None = inv.qualifier

            callee_id: str | None = None
            confidence: float = 0.0

            if not qualifier or qualifier == "this":
                # 类内调用
                callee_id = f"function:{file_path}:{parent_class}.{method_name}"
                confidence = 0.90
            elif qualifier in local_classes:
                # 同文件跨类调用
                callee_id = f"function:{file_path}:{qualifier}.{method_name}"
                confidence = 0.80
            elif qualifier in class_to_file:
                # 跨文件调用（import 解析）
                target_file = class_to_file[qualifier]
                callee_id = f"function:{target_file}:{qualifier}.{method_name}"
                confidence = 0.70

            if (
                callee_id
                and callee_id in node_ids
                and callee_id != caller_id
                and (caller_id, callee_id) not in seen
            ):
                seen.add((caller_id, callee_id))
                calls.append((caller_id, callee_id, confidence))

    return calls


def _java_regex(
    source: str,
    file_path: str,
    node_ids: set[str],
) -> list[CallEdge]:
    """正则降级：仅匹配 this.method() 调用，低精度。"""
    calls: list[CallEdge] = []

    class_match = re.search(r'\bclass\s+(\w+)', source)
    if not class_match:
        return []
    class_name = class_match.group(1)

    method_names = re.findall(
        r'(?:public|protected|private)(?:\s+\w+)+\s+(\w+)\s*\(', source
    )

    seen: set[tuple[str, str]] = set()
    for caller_method in method_names:
        caller_id = f"function:{file_path}:{class_name}.{caller_method}"
        if caller_id not in node_ids:
            continue
        for m in re.finditer(r'this\.(\w+)\s*\(', source):
            callee_method = m.group(1)
            callee_id = f"function:{file_path}:{class_name}.{callee_method}"
            if (
                callee_id in node_ids
                and callee_id != caller_id
                and (caller_id, callee_id) not in seen
            ):
                seen.add((caller_id, callee_id))
                calls.append((caller_id, callee_id, 0.65))

    return calls


# ── Python ────────────────────────────────────────────────────────────────────


def extract_python_calls(
    source: str,
    file_path: str,
    node_ids: set[str],
) -> list[CallEdge]:
    """使用 Python ast 提取 self.method() 类内调用关系。"""
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return []

    calls: list[CallEdge] = []

    for class_node in ast.walk(tree):
        if not isinstance(class_node, ast.ClassDef):
            continue
        class_name = class_node.name

        for item in class_node.body:
            if not isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue

            caller_id = f"function:{file_path}:{class_name}.{item.name}"
            if caller_id not in node_ids:
                continue

            seen: set[tuple[str, str]] = set()
            for call_node in ast.walk(item):
                if not isinstance(call_node, ast.Call):
                    continue
                func = call_node.func
                # 只处理 self.method() 形式
                if not (
                    isinstance(func, ast.Attribute)
                    and isinstance(func.value, ast.Name)
                    and func.value.id == "self"
                ):
                    continue

                callee_id = f"function:{file_path}:{class_name}.{func.attr}"
                if (
                    callee_id in node_ids
                    and callee_id != caller_id
                    and (caller_id, callee_id) not in seen
                ):
                    seen.add((caller_id, callee_id))
                    calls.append((caller_id, callee_id, 0.90))

    return calls
```

- [ ] **Step 1.4: 运行测试确认绿阶段**

```bash
cd code-graph-system
python -m pytest backend/tests/test_call_graph_extractor.py -v
```

预期：所有测试通过（若 javalang 未安装，Java 相关测试会被 `pytest.importorskip` 跳过，其余测试通过）。

- [ ] **Step 1.5: Commit**

```bash
cd code-graph-system
git add backend/pipeline/stages/call_graph_extractor.py backend/tests/test_call_graph_extractor.py
git commit -m "feat: add static call graph extractor for Java and Python"
```

---

## Task 2: 集成到 `DeepStaticAnalysisStage`

**Files:**
- Modify: `code-graph-system/backend/pipeline/stages/deep_static_analysis.py:119-155`

- [ ] **Step 2.1: 先写集成测试（TDD — 红阶段）**

在 `backend/tests/test_call_graph_extractor.py` 末尾追加：

```python
# ─── 集成测试：DeepStaticAnalysisStage 产出 calls 边 ─────────────

import tempfile, os
from pathlib import Path
from backend.pipeline.stages.deep_static_analysis import DeepStaticAnalysisStage
from backend.models.static_analysis import FileInfo


def _make_file_info(rel_path: str, lang: str = "python") -> FileInfo:
    return FileInfo(
        path=rel_path,
        relative_path=rel_path,
        language=lang,
        size=0,
        lines=0,
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

        all_files = {rel: _make_file_info(rel, "python")}
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
```

运行确认红阶段：

```bash
cd code-graph-system
python -m pytest backend/tests/test_call_graph_extractor.py::test_deep_static_stage_produces_calls_edges -v
```

预期：FAIL — `calls` 边数量为 0。

- [ ] **Step 2.2: 修改 `DeepStaticAnalysisStage.run()` 添加调用图提取**

在 `deep_static_analysis.py` 中，在 `run()` 方法的 Step 4 之后（第 119-121 行附近）添加 Step 5：

**定位位置：** `run()` 方法内，`_build_graph_elements()` 调用之后、`elapsed_ms` 计算之前：

```python
        # Step 4: 生成结构节点和边
        structural_nodes, structural_edges, low_confidence_edges = self._build_graph_elements(
            file_skeletons, import_graph
        )

        # Step 5: 提取调用图边（calls 类型）
        call_edges = self._extract_call_edges(repo_path, files_to_parse, file_skeletons, structural_nodes)
        structural_edges.extend(call_edges)
        if call_edges:
            logger.info("调用图提取: %d calls 边", len(call_edges))

        elapsed_ms = int((time.time() - start_time) * 1000)
```

然后在类的末尾（`_infer_node_type` 之后）添加 `_extract_call_edges` 方法：

```python
    def _extract_call_edges(
        self,
        repo_path: Path,
        files: dict[str, FileInfo],
        skeletons: dict[str, FileSkeleton],
        structural_nodes: list,
    ) -> list[GraphEdge]:
        """从源文件中静态提取 calls 类型边。

        只处理 Java 和 Python 文件（其他语言暂无 AST 支持）。
        callee 必须已在 structural_nodes 中（即 public 方法节点），否则忽略。
        """
        from backend.pipeline.stages.call_graph_extractor import extract_file_calls

        # 构建已知函数节点 ID 集合（仅 function 节点）
        node_ids: set[str] = {
            n.id for n in structural_nodes if n.type == "Function"
        }
        if not node_ids:
            return []

        # 构建类名 -> 文件路径映射（用于跨文件调用解析）
        class_to_file: dict[str, str] = {}
        for rel_path, skeleton in skeletons.items():
            for cls in skeleton.classes:
                class_to_file[cls.name] = rel_path

        call_edges: list[GraphEdge] = []

        for rel_path, file_info in files.items():
            lang = file_info.language.lower() if file_info.language else ""
            if lang not in ("java", "python"):
                continue

            skeleton = skeletons.get(rel_path)
            if not skeleton or not skeleton.classes:
                continue  # 跳过无类定义的文件（减少无效解析）

            try:
                source = (repo_path / rel_path).read_text(
                    encoding="utf-8", errors="replace"
                )
            except OSError as exc:
                logger.debug("无法读取文件: %s — %s", rel_path, exc)
                continue

            raw_calls = extract_file_calls(
                source, rel_path, lang, node_ids, class_to_file
            )
            for caller_id, callee_id, confidence in raw_calls:
                call_edges.append(GraphEdge(
                    from_=caller_id,
                    to=callee_id,
                    type=EdgeType.CALLS.value,
                    properties={"source": "static", "confidence": confidence},
                ))

        return call_edges
```

**注意 import 检查**：`GraphEdge` 和 `EdgeType` 已在文件顶部导入（第 25 行），无需新增导入。

- [ ] **Step 2.3: 运行集成测试确认绿阶段**

```bash
cd code-graph-system
python -m pytest backend/tests/test_call_graph_extractor.py -v
```

预期：所有测试通过。

- [ ] **Step 2.4: 运行全量测试，确认无回归**

```bash
cd code-graph-system
python -m pytest backend/tests/test_graphs_api.py backend/tests/test_tasks_graph_storage.py backend/tests/test_call_graph_extractor.py -v
```

预期：所有测试通过。

- [ ] **Step 2.5: Commit**

```bash
cd code-graph-system
git add backend/pipeline/stages/deep_static_analysis.py backend/tests/test_call_graph_extractor.py
git commit -m "feat: integrate call graph extraction into DeepStaticAnalysisStage"
```

---

## Task 3: 端到端验证（手动）

> 完成代码后，需要对已有仓库重新跑一次分析，验证 `call-graph.json` 被生成。

- [ ] **Step 3.1: 用现有图谱数据验证提取器**

直接对 `graph-storage/adms/` 目录的 JSON 中已知节点验证：

```bash
cd code-graph-system
python -c "
import json
from pathlib import Path
from backend.pipeline.stages.call_graph_extractor import extract_java_calls

# 读取现有图谱，找一个有实际 Java 文件的类
with open('graph-storage/adms/graph.json') as f:
    g = json.load(f)

# 取前5个 Function 节点
funcs = [n for n in g['nodes'] if n['type'] == 'Function'][:5]
for f in funcs:
    print(f['id'])
"
```

- [ ] **Step 3.2: 验证 `_extract_call_edges` 在真实仓库路径下工作**

如果本地有 adms 仓库路径（假设 `/path/to/adms`），可手动触发：

```bash
cd code-graph-system
python -c "
from pathlib import Path
from backend.pipeline.stages.deep_static_analysis import DeepStaticAnalysisStage
stage = DeepStaticAnalysisStage(max_workers=2)

# 使用现有 file_skeletons（从 GraphStorage 读取）验证不报错
print('DeepStaticAnalysisStage 初始化成功')
print('call_graph_extractor 导入:', end=' ')
from backend.pipeline.stages.call_graph_extractor import extract_file_calls
print('OK')
"
```

- [ ] **Step 3.3: 触发重新分析（通过 API）**

通过前端或直接 curl：

```bash
# 通过 API 重新分析（将 <repo_id> 替换为实际值）
curl -X POST http://localhost:8000/analyze/repository \
  -H "Content-Type: application/json" \
  -d '{"repo_path": "/path/to/adms", "repo_name": "adms", "depth": "quick"}'
```

或者直接命令行测试（快速验证）：

```bash
cd code-graph-system
python -m backend.pipeline.ai_analyze /path/to/adms --name adms --verbose
```

- [ ] **Step 3.4: 验证 `call-graph.json` 生成**

```bash
ls graph-storage/adms/
# 预期: graph.json  module-graph.json  call-graph.json
```

```bash
python -c "
import json
with open('graph-storage/adms/call-graph.json') as f:
    g = json.load(f)
print('calls 边数量:', len(g.get('edges', [])))
print('示例边:')
for e in g.get('edges', [])[:3]:
    print(' ', e.get('from'), '->', e.get('to'))
"
```

---

## 验收标准

| 检查项 | 预期 |
|-------|------|
| `test_call_graph_extractor.py` 全部通过 | ✅ |
| `test_graphs_api.py` 无回归 | ✅ |
| `test_tasks_graph_storage.py` 无回归 | ✅ |
| 重新分析后 `graph-storage/<repo>/call-graph.json` 存在 | ✅ |
| 调用图页面显示节点和边 | ✅ |

---

## 注意事项

1. **只处理 `public` 方法**：`DeepStaticAnalysisStage` 只为 `public` 方法创建 Function 节点，所以提取到的 callee 也只能是 public 方法。不要尝试修改 visibility 过滤——那会改变现有行为。

2. **javalang 可能不可用**：如果未安装，Java 文件自动降级正则匹配（`_java_regex`）。可用 `pip install javalang` 安装。

3. **性能考虑**：大型仓库（如 adms 有 22k+ 节点）分析时，调用图提取会逐文件读取源码，但只处理有类定义的 Java/Python 文件，且使用 `node_ids` 快速过滤，预计总耗时在秒级。

4. **跨文件调用精度有限**：当前实现通过 qualifier（变量名）匹配类名，无法处理多态和接口。这是静态分析的固有限制，可接受。
