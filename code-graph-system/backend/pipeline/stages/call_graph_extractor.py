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

    # 遍历每个类，收集字段类型声明，然后处理方法
    for path, class_node in tree:
        if not isinstance(class_node, (
            javalang.tree.ClassDeclaration,
            javalang.tree.InterfaceDeclaration,
        )):
            continue

        parent_class = class_node.name

        # 收集类级字段的变量名->类型映射（var_name -> class_name）
        field_types: dict[str, str] = {}
        for member in (class_node.body or []):
            if isinstance(member, javalang.tree.FieldDeclaration):
                type_name = member.type.name
                for declarator in member.declarators:
                    field_types[declarator.name] = type_name

        # 遍历该类的所有方法
        for method in (class_node.methods or []):
            if not isinstance(method, javalang.tree.MethodDeclaration):
                continue

            caller_id = f"function:{file_path}:{parent_class}.{method.name}"
            if caller_id not in node_ids or not method.body:
                continue

            # 收集方法参数和局部变量类型
            local_types: dict[str, str] = dict(field_types)  # 复制字段类型
            for _, stmt in method.filter(javalang.tree.LocalVariableDeclaration):
                type_name = stmt.type.name
                for declarator in stmt.declarators:
                    local_types[declarator.name] = type_name

            # 收集方法体内的所有 MethodInvocation
            seen: set[tuple[str, str]] = set()
            for _, inv in method.filter(javalang.tree.MethodInvocation):
                method_name: str = inv.member
                qualifier: str | None = inv.qualifier

                callee_id: str | None = None
                confidence: float = 0.0

                if not qualifier or qualifier == "this":
                    # 类内调用（无限定符或 this.method()）
                    callee_id = f"function:{file_path}:{parent_class}.{method_name}"
                    confidence = 0.90
                else:
                    # 通过变量名反查类型名
                    resolved_class = local_types.get(qualifier, qualifier)
                    if resolved_class in local_classes:
                        # 同文件跨类调用
                        callee_id = f"function:{file_path}:{resolved_class}.{method_name}"
                        confidence = 0.80
                    elif resolved_class in class_to_file:
                        # 跨文件调用（import 解析）
                        target_file = class_to_file[resolved_class]
                        callee_id = f"function:{target_file}:{resolved_class}.{method_name}"
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
