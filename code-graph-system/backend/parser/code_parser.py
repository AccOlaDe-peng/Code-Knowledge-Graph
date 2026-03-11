"""
代码解析核心模块。

基于 Tree-sitter 对源代码文件进行 AST 解析，提取：
- 模块级导入/导出
- 类/接口定义
- 函数/方法定义（含参数、返回类型、装饰器）
- 函数调用点
- 数据模型定义

支持多语言，通过 LanguageLoader 动态加载解析器。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from backend.parser.language_loader import LanguageLoader, default_loader

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Parsed Data Structures
# ---------------------------------------------------------------------------


@dataclass
class ParsedImport:
    """解析到的导入语句信息。"""

    module: str
    """导入的模块路径"""
    names: list[str] = field(default_factory=list)
    """具体导入的名称（from x import y 中的 y）"""
    alias: Optional[str] = None
    """别名（import x as y 中的 y）"""
    line: int = 0
    """所在行号"""
    is_relative: bool = False
    """是否为相对导入"""


@dataclass
class ParsedParameter:
    """解析到的函数参数。"""

    name: str
    type_annotation: Optional[str] = None
    default_value: Optional[str] = None


@dataclass
class ParsedFunction:
    """解析到的函数/方法信息。"""

    name: str
    line_start: int
    line_end: int
    parameters: list[ParsedParameter] = field(default_factory=list)
    return_type: Optional[str] = None
    decorators: list[str] = field(default_factory=list)
    docstring: Optional[str] = None
    is_async: bool = False
    is_generator: bool = False
    is_method: bool = False
    parent_class: Optional[str] = None
    calls: list["ParsedCall"] = field(default_factory=list)
    """函数内部的调用点列表"""


@dataclass
class ParsedCall:
    """解析到的函数调用点。"""

    callee: str
    """被调用函数/方法名"""
    line: int = 0
    args_count: int = 0
    is_method_call: bool = False
    receiver: Optional[str] = None
    """方法调用的接收者（obj.method() 中的 obj）"""


@dataclass
class ParsedClass:
    """解析到的类/接口定义信息。"""

    name: str
    line_start: int
    line_end: int
    base_classes: list[str] = field(default_factory=list)
    decorators: list[str] = field(default_factory=list)
    docstring: Optional[str] = None
    is_abstract: bool = False
    methods: list[ParsedFunction] = field(default_factory=list)
    attributes: list[str] = field(default_factory=list)


@dataclass
class ParsedFile:
    """单个文件的完整解析结果。"""

    file_path: str
    language: str
    source_lines: int = 0
    imports: list[ParsedImport] = field(default_factory=list)
    classes: list[ParsedClass] = field(default_factory=list)
    functions: list[ParsedFunction] = field(default_factory=list)
    """模块级（非类内）函数"""
    module_docstring: Optional[str] = None
    errors: list[str] = field(default_factory=list)
    raw_ast: Optional[Any] = field(default=None, repr=False)


# ---------------------------------------------------------------------------
# Language-specific AST Visitors
# ---------------------------------------------------------------------------


class PythonVisitor:
    """
    Python AST 访问器。

    遍历 Tree-sitter 生成的 Python AST，提取结构化代码信息。
    """

    def visit(self, tree_node: Any, source: bytes) -> tuple[
        list[ParsedImport],
        list[ParsedClass],
        list[ParsedFunction],
        Optional[str],
    ]:
        """
        访问 AST 根节点，返回解析结果。

        Args:
            tree_node: Tree-sitter 根节点
            source: 原始源码字节串

        Returns:
            (imports, classes, functions, module_docstring) 元组
        """
        imports: list[ParsedImport] = []
        classes: list[ParsedClass] = []
        functions: list[ParsedFunction] = []
        module_docstring: Optional[str] = None

        for child in tree_node.children:
            kind = child.type
            if kind in ("import_statement", "import_from_statement"):
                imp = self._parse_import(child, source)
                if imp:
                    imports.append(imp)
            elif kind == "class_definition":
                cls = self._parse_class(child, source)
                if cls:
                    classes.append(cls)
            elif kind in ("function_definition", "decorated_definition"):
                func = self._parse_function(child, source, is_method=False)
                if func:
                    functions.append(func)
            elif kind == "expression_statement" and module_docstring is None:
                # 模块文档字符串
                doc = self._extract_docstring(child, source)
                if doc:
                    module_docstring = doc

        return imports, classes, functions, module_docstring

    def _get_text(self, node: Any, source: bytes) -> str:
        """提取节点对应的源码文本。"""
        return source[node.start_byte:node.end_byte].decode("utf-8", errors="replace")

    def _extract_docstring(self, node: Any, source: bytes) -> Optional[str]:
        """从 expression_statement 中提取字符串字面量作为文档字符串。"""
        for child in node.children:
            if child.type == "string":
                text = self._get_text(child, source)
                return text.strip("'\"").strip()
        return None

    def _parse_import(self, node: Any, source: bytes) -> Optional[ParsedImport]:
        """解析 import/from import 语句。"""
        text = self._get_text(node, source)
        line = node.start_point[0] + 1
        is_relative = "from ." in text

        if node.type == "import_statement":
            # import os, sys
            modules = [
                c for c in node.children if c.type in ("dotted_name", "aliased_import")
            ]
            if modules:
                module_text = self._get_text(modules[0], source)
                return ParsedImport(module=module_text, line=line, is_relative=is_relative)

        elif node.type == "import_from_statement":
            # from x import y, z
            parts = [c for c in node.children]
            module = ""
            names: list[str] = []
            for i, part in enumerate(parts):
                if part.type == "dotted_name" and not module:
                    module = self._get_text(part, source)
                elif part.type in ("import_from_as_name", "dotted_name") and module:
                    names.append(self._get_text(part, source))
                elif part.type == "wildcard_import":
                    names.append("*")
            return ParsedImport(
                module=module, names=names, line=line, is_relative=is_relative
            )
        return None

    def _parse_class(self, node: Any, source: bytes) -> Optional[ParsedClass]:
        """解析类定义节点。"""
        name = ""
        base_classes: list[str] = []
        methods: list[ParsedFunction] = []
        attributes: list[str] = []
        docstring: Optional[str] = None
        decorators: list[str] = []

        for child in node.children:
            if child.type == "identifier":
                name = self._get_text(child, source)
            elif child.type == "argument_list":
                for arg in child.children:
                    if arg.type in ("identifier", "attribute"):
                        base_classes.append(self._get_text(arg, source))
            elif child.type == "block":
                first = True
                for stmt in child.children:
                    if first and stmt.type == "expression_statement":
                        doc = self._extract_docstring(stmt, source)
                        if doc:
                            docstring = doc
                        first = False
                    elif stmt.type in ("function_definition", "decorated_definition"):
                        m = self._parse_function(stmt, source, is_method=True, parent_class=name)
                        if m:
                            methods.append(m)
                    elif stmt.type == "expression_statement":
                        first = False

        if not name:
            return None

        return ParsedClass(
            name=name,
            line_start=node.start_point[0] + 1,
            line_end=node.end_point[0] + 1,
            base_classes=base_classes,
            decorators=decorators,
            docstring=docstring,
            methods=methods,
            attributes=attributes,
            is_abstract="ABC" in base_classes or "ABCMeta" in base_classes,
        )

    def _parse_function(
        self,
        node: Any,
        source: bytes,
        is_method: bool = False,
        parent_class: Optional[str] = None,
    ) -> Optional[ParsedFunction]:
        """解析函数/方法定义节点。"""
        decorators: list[str] = []
        actual_node = node

        # 处理 decorated_definition
        if node.type == "decorated_definition":
            for child in node.children:
                if child.type == "decorator":
                    decorators.append(self._get_text(child, source).lstrip("@"))
                elif child.type in ("function_definition", "async_function_definition"):
                    actual_node = child

        name = ""
        params: list[ParsedParameter] = []
        return_type: Optional[str] = None
        docstring: Optional[str] = None
        is_async = actual_node.type == "async_function_definition"
        calls: list[ParsedCall] = []

        for child in actual_node.children:
            if child.type == "identifier":
                name = self._get_text(child, source)
            elif child.type == "parameters":
                params = self._parse_params(child, source)
            elif child.type == "type":
                return_type = self._get_text(child, source)
            elif child.type == "block":
                first = True
                for stmt in child.children:
                    if first and stmt.type == "expression_statement":
                        doc = self._extract_docstring(stmt, source)
                        if doc:
                            docstring = doc
                        first = False
                    # 收集调用点
                    self._collect_calls(stmt, source, calls)

        if not name:
            return None

        return ParsedFunction(
            name=name,
            line_start=actual_node.start_point[0] + 1,
            line_end=actual_node.end_point[0] + 1,
            parameters=params,
            return_type=return_type,
            decorators=decorators,
            docstring=docstring,
            is_async=is_async,
            is_method=is_method,
            parent_class=parent_class,
            calls=calls,
        )

    def _parse_params(self, node: Any, source: bytes) -> list[ParsedParameter]:
        """解析函数参数列表。"""
        params: list[ParsedParameter] = []
        for child in node.children:
            if child.type in ("identifier", "typed_parameter", "default_parameter",
                              "typed_default_parameter"):
                p = self._parse_single_param(child, source)
                if p and p.name not in ("self", "cls"):
                    params.append(p)
        return params

    def _parse_single_param(self, node: Any, source: bytes) -> Optional[ParsedParameter]:
        """解析单个参数节点。"""
        if node.type == "identifier":
            return ParsedParameter(name=self._get_text(node, source))

        name = ""
        type_ann = None
        default = None
        for child in node.children:
            if child.type == "identifier" and not name:
                name = self._get_text(child, source)
            elif child.type == "type":
                type_ann = self._get_text(child, source)
            elif child.type not in (":", "="):
                if default is None and name:
                    default = self._get_text(child, source)
        return ParsedParameter(name=name, type_annotation=type_ann, default_value=default) if name else None

    def _collect_calls(self, node: Any, source: bytes, calls: list[ParsedCall]) -> None:
        """递归收集节点中的所有函数调用。"""
        if node.type == "call":
            func_node = node.child_by_field_name("function")
            if func_node:
                callee = self._get_text(func_node, source)
                is_method = "." in callee
                receiver = callee.rsplit(".", 1)[0] if is_method else None
                name = callee.rsplit(".", 1)[-1] if is_method else callee
                args = node.child_by_field_name("arguments")
                arg_count = sum(1 for c in (args.children if args else []) if c.type not in (",", "(", ")"))
                calls.append(ParsedCall(
                    callee=callee,
                    line=node.start_point[0] + 1,
                    args_count=arg_count,
                    is_method_call=is_method,
                    receiver=receiver,
                ))
        for child in node.children:
            self._collect_calls(child, source, calls)


# ---------------------------------------------------------------------------
# CodeParser
# ---------------------------------------------------------------------------


class CodeParser:
    """
    多语言代码解析器。

    封装 Tree-sitter 解析流程，为上层分析器提供统一的结构化解析接口。

    示例::

        parser = CodeParser()
        result = parser.parse_file("/path/to/main.py")
        print(result.classes)
    """

    def __init__(self, loader: Optional[LanguageLoader] = None) -> None:
        """
        初始化解析器。

        Args:
            loader: 语言加载器实例，默认使用全局单例
        """
        self.loader = loader or default_loader
        self._visitors: dict[str, Any] = {
            "python": PythonVisitor(),
        }

    def parse_file(self, file_path: str | Path) -> ParsedFile:
        """
        解析单个源码文件。

        Args:
            file_path: 文件路径

        Returns:
            ParsedFile 对象，包含完整的结构化解析结果
        """
        path = Path(file_path)
        language = self.loader.get_language_for_file(path)

        result = ParsedFile(file_path=str(path), language=language or "unknown")

        if not path.exists():
            result.errors.append(f"文件不存在: {path}")
            return result

        try:
            source = path.read_bytes()
        except OSError as e:
            result.errors.append(f"读取文件失败: {e}")
            return result

        result.source_lines = source.count(b"\n") + 1

        if not language:
            result.errors.append(f"不支持的文件类型: {path.suffix}")
            return result

        ts_parser = self.loader.get_parser(language)
        if ts_parser is None:
            result.errors.append(f"未能加载语言解析器: {language}")
            # Fallback: 使用简单文本解析
            self._fallback_parse(result, source, language)
            return result

        try:
            tree = ts_parser.parse(source)
            result.raw_ast = tree

            visitor = self._visitors.get(language)
            if visitor:
                imports, classes, functions, docstring = visitor.visit(tree.root_node, source)
                result.imports = imports
                result.classes = classes
                result.functions = functions
                result.module_docstring = docstring
            else:
                result.errors.append(f"暂无 {language} 的访问器实现，使用基础解析")
                self._fallback_parse(result, source, language)

        except Exception as e:
            logger.exception(f"解析文件 {path} 时发生异常")
            result.errors.append(f"AST 解析异常: {e}")
            self._fallback_parse(result, source, language)

        return result

    def parse_source(self, source: str, language: str, file_path: str = "<string>") -> ParsedFile:
        """
        直接解析源码字符串。

        Args:
            source: 源码文本
            language: 语言名称
            file_path: 文件路径标识（用于错误报告）

        Returns:
            ParsedFile 对象
        """
        result = ParsedFile(file_path=file_path, language=language)
        source_bytes = source.encode("utf-8")
        result.source_lines = source.count("\n") + 1

        ts_parser = self.loader.get_parser(language)
        if ts_parser is None:
            result.errors.append(f"未能加载语言解析器: {language}")
            self._fallback_parse(result, source_bytes, language)
            return result

        try:
            tree = ts_parser.parse(source_bytes)
            result.raw_ast = tree
            visitor = self._visitors.get(language)
            if visitor:
                imports, classes, functions, docstring = visitor.visit(tree.root_node, source_bytes)
                result.imports = imports
                result.classes = classes
                result.functions = functions
                result.module_docstring = docstring
        except Exception as e:
            result.errors.append(f"解析异常: {e}")

        return result

    def _fallback_parse(self, result: ParsedFile, source: bytes, language: str) -> None:
        """
        降级解析：使用正则/文本分析提取基本结构。
        当 Tree-sitter 不可用时作为后备方案。
        """
        import re

        text = source.decode("utf-8", errors="replace")
        lines = text.splitlines()

        if language == "python":
            for i, line in enumerate(lines, 1):
                # 简单匹配 class/def
                m = re.match(r"^class\s+(\w+)", line)
                if m:
                    result.classes.append(
                        ParsedClass(name=m.group(1), line_start=i, line_end=i)
                    )
                m = re.match(r"^(?:async\s+)?def\s+(\w+)", line)
                if m:
                    result.functions.append(
                        ParsedFunction(name=m.group(1), line_start=i, line_end=i)
                    )
                m = re.match(r"^(?:import|from)\s+([\w.]+)", line)
                if m:
                    result.imports.append(
                        ParsedImport(module=m.group(1), line=i)
                    )


if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO)
    parser = CodeParser()
    target = sys.argv[1] if len(sys.argv) > 1 else __file__
    parsed = parser.parse_file(target)
    print(f"文件: {parsed.file_path}")
    print(f"语言: {parsed.language}")
    print(f"行数: {parsed.source_lines}")
    print(f"导入: {len(parsed.imports)}")
    print(f"类:   {[c.name for c in parsed.classes]}")
    print(f"函数: {[f.name for f in parsed.functions]}")
    if parsed.errors:
        print(f"错误: {parsed.errors}")
