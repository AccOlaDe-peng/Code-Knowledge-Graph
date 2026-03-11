"""
代码解析核心模块。

基于 Tree-sitter 对源代码文件进行 AST 解析，支持 Python / TypeScript / Go / Java。

提取信息：
  - 导入语句（import）
  - 类 / 接口 / 结构体（class）
  - 函数 / 方法（function）
  - 函数调用关系（call）

主要 API::

    parser = CodeParser()

    # 解析单文件
    pf: ParsedFile = parser.parse_file("main.py")

    # 从 ParsedFile 提取各类信息
    classes   = parser.extract_classes(pf)
    functions = parser.extract_functions(pf)
    calls     = parser.extract_calls(pf)

    # 扫描整个仓库，返回 ParseResult
    result: ParseResult = parser.scan_repository("/path/to/repo")
    # result.files / result.classes / result.functions / result.calls
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from backend.parser.language_loader import LanguageLoader, default_loader

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Parsed Data Structures（向后兼容，pipeline 继续使用）
# ---------------------------------------------------------------------------


@dataclass
class ParsedImport:
    module: str
    names: list[str] = field(default_factory=list)
    alias: Optional[str] = None
    line: int = 0
    is_relative: bool = False


@dataclass
class ParsedParameter:
    name: str
    type_annotation: Optional[str] = None
    default_value: Optional[str] = None


@dataclass
class ParsedCall:
    callee: str
    """被调用函数/方法全名，如 'fmt.Println' 或 'save'"""
    line: int = 0
    args_count: int = 0
    is_method_call: bool = False
    receiver: Optional[str] = None
    caller_file: str = ""
    caller_function: Optional[str] = None


@dataclass
class ParsedFunction:
    name: str
    line_start: int
    line_end: int
    file_path: str = ""
    parameters: list[ParsedParameter] = field(default_factory=list)
    return_type: Optional[str] = None
    decorators: list[str] = field(default_factory=list)
    docstring: Optional[str] = None
    is_async: bool = False
    is_generator: bool = False
    is_method: bool = False
    parent_class: Optional[str] = None
    calls: list[ParsedCall] = field(default_factory=list)


@dataclass
class ParsedClass:
    name: str
    line_start: int
    line_end: int
    file_path: str = ""
    base_classes: list[str] = field(default_factory=list)
    decorators: list[str] = field(default_factory=list)
    docstring: Optional[str] = None
    is_abstract: bool = False
    methods: list[ParsedFunction] = field(default_factory=list)
    attributes: list[str] = field(default_factory=list)


@dataclass
class ParsedFile:
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


@dataclass
class ParseResult:
    """scan_repository() 的输出：四类列表的汇总。"""

    files: list[ParsedFile] = field(default_factory=list)
    classes: list[ParsedClass] = field(default_factory=list)
    functions: list[ParsedFunction] = field(default_factory=list)
    calls: list[ParsedCall] = field(default_factory=list)

    @property
    def stats(self) -> dict[str, int]:
        return {
            "files": len(self.files),
            "classes": len(self.classes),
            "functions": len(self.functions),
            "calls": len(self.calls),
        }


# ---------------------------------------------------------------------------
# Helper mixin
# ---------------------------------------------------------------------------

class _VisitorBase:
    """所有 visitor 共享的工具方法。"""

    def _text(self, node: Any, src: bytes) -> str:
        return src[node.start_byte:node.end_byte].decode("utf-8", errors="replace")

    def _collect_calls(self, node: Any, src: bytes, calls: list[ParsedCall]) -> None:
        """递归收集节点下所有函数调用。子类可覆盖以匹配语言特有节点类型。"""
        raise NotImplementedError


# ---------------------------------------------------------------------------
# Python Visitor
# ---------------------------------------------------------------------------

class PythonVisitor(_VisitorBase):

    def visit(self, root: Any, src: bytes) -> tuple[
        list[ParsedImport], list[ParsedClass], list[ParsedFunction], Optional[str]
    ]:
        imports: list[ParsedImport] = []
        classes: list[ParsedClass] = []
        functions: list[ParsedFunction] = []
        module_doc: Optional[str] = None

        for child in root.children:
            t = child.type
            if t in ("import_statement", "import_from_statement"):
                imp = self._parse_import(child, src)
                if imp:
                    imports.append(imp)
            elif t == "class_definition":
                cls = self._parse_class(child, src)
                if cls:
                    classes.append(cls)
            elif t in ("function_definition", "decorated_definition"):
                fn = self._parse_function(child, src)
                if fn:
                    functions.append(fn)
            elif t == "expression_statement" and module_doc is None:
                doc = self._extract_docstring(child, src)
                if doc:
                    module_doc = doc

        return imports, classes, functions, module_doc

    def _extract_docstring(self, node: Any, src: bytes) -> Optional[str]:
        for c in node.children:
            if c.type == "string":
                return self._text(c, src).strip("'\"").strip()
        return None

    def _parse_import(self, node: Any, src: bytes) -> Optional[ParsedImport]:
        text = self._text(node, src)
        line = node.start_point[0] + 1
        is_rel = "from ." in text
        if node.type == "import_statement":
            mods = [c for c in node.children if c.type in ("dotted_name", "aliased_import")]
            if mods:
                return ParsedImport(module=self._text(mods[0], src), line=line, is_relative=is_rel)
        elif node.type == "import_from_statement":
            module = ""
            names: list[str] = []
            for part in node.children:
                if part.type == "dotted_name" and not module:
                    module = self._text(part, src)
                elif part.type in ("import_from_as_name", "dotted_name") and module:
                    names.append(self._text(part, src))
                elif part.type == "wildcard_import":
                    names.append("*")
            return ParsedImport(module=module, names=names, line=line, is_relative=is_rel)
        return None

    def _parse_class(self, node: Any, src: bytes) -> Optional[ParsedClass]:
        name = ""
        bases: list[str] = []
        methods: list[ParsedFunction] = []
        attrs: list[str] = []
        doc: Optional[str] = None
        decs: list[str] = []

        for child in node.children:
            t = child.type
            if t == "identifier":
                name = self._text(child, src)
            elif t == "argument_list":
                for arg in child.children:
                    if arg.type in ("identifier", "attribute"):
                        bases.append(self._text(arg, src))
            elif t == "block":
                first = True
                for stmt in child.children:
                    if first and stmt.type == "expression_statement":
                        d = self._extract_docstring(stmt, src)
                        if d:
                            doc = d
                        first = False
                    elif stmt.type in ("function_definition", "decorated_definition"):
                        m = self._parse_function(stmt, src, is_method=True, parent=name)
                        if m:
                            methods.append(m)

        if not name:
            return None
        return ParsedClass(
            name=name,
            line_start=node.start_point[0] + 1,
            line_end=node.end_point[0] + 1,
            base_classes=bases,
            decorators=decs,
            docstring=doc,
            methods=methods,
            attributes=attrs,
            is_abstract="ABC" in bases or "ABCMeta" in bases,
        )

    def _parse_function(
        self, node: Any, src: bytes,
        is_method: bool = False, parent: Optional[str] = None,
    ) -> Optional[ParsedFunction]:
        decs: list[str] = []
        actual = node
        if node.type == "decorated_definition":
            for c in node.children:
                if c.type == "decorator":
                    decs.append(self._text(c, src).lstrip("@"))
                elif c.type in ("function_definition", "async_function_definition"):
                    actual = c

        name = ""
        params: list[ParsedParameter] = []
        ret: Optional[str] = None
        doc: Optional[str] = None
        is_async = actual.type == "async_function_definition"
        calls: list[ParsedCall] = []

        for c in actual.children:
            t = c.type
            if t == "identifier":
                name = self._text(c, src)
            elif t == "parameters":
                params = self._parse_params(c, src)
            elif t == "type":
                ret = self._text(c, src)
            elif t == "block":
                first = True
                for stmt in c.children:
                    if first and stmt.type == "expression_statement":
                        d = self._extract_docstring(stmt, src)
                        if d:
                            doc = d
                        first = False
                    self._collect_calls(stmt, src, calls)

        if not name:
            return None
        return ParsedFunction(
            name=name,
            line_start=actual.start_point[0] + 1,
            line_end=actual.end_point[0] + 1,
            parameters=params,
            return_type=ret,
            decorators=decs,
            docstring=doc,
            is_async=is_async,
            is_method=is_method,
            parent_class=parent,
            calls=calls,
        )

    def _parse_params(self, node: Any, src: bytes) -> list[ParsedParameter]:
        params: list[ParsedParameter] = []
        for c in node.children:
            if c.type in ("identifier", "typed_parameter", "default_parameter",
                          "typed_default_parameter"):
                p = self._parse_single_param(c, src)
                if p and p.name not in ("self", "cls"):
                    params.append(p)
        return params

    def _parse_single_param(self, node: Any, src: bytes) -> Optional[ParsedParameter]:
        if node.type == "identifier":
            return ParsedParameter(name=self._text(node, src))
        name = ""
        typ = None
        default = None
        for c in node.children:
            if c.type == "identifier" and not name:
                name = self._text(c, src)
            elif c.type == "type":
                typ = self._text(c, src)
            elif c.type not in (":", "=") and default is None and name:
                default = self._text(c, src)
        return ParsedParameter(name=name, type_annotation=typ, default_value=default) if name else None

    def _collect_calls(self, node: Any, src: bytes, calls: list[ParsedCall]) -> None:
        if node.type == "call":
            fn = node.child_by_field_name("function")
            if fn:
                callee = self._text(fn, src)
                is_m = "." in callee
                recv = callee.rsplit(".", 1)[0] if is_m else None
                args = node.child_by_field_name("arguments")
                argc = sum(1 for c in (args.children if args else []) if c.type not in (",", "(", ")"))
                calls.append(ParsedCall(
                    callee=callee, line=node.start_point[0] + 1,
                    args_count=argc, is_method_call=is_m, receiver=recv,
                ))
        for c in node.children:
            self._collect_calls(c, src, calls)


# ---------------------------------------------------------------------------
# TypeScript Visitor
# ---------------------------------------------------------------------------

class TypeScriptVisitor(_VisitorBase):

    def visit(self, root: Any, src: bytes) -> tuple[
        list[ParsedImport], list[ParsedClass], list[ParsedFunction], Optional[str]
    ]:
        imports: list[ParsedImport] = []
        classes: list[ParsedClass] = []
        functions: list[ParsedFunction] = []

        for child in root.named_children:
            actual, export_default = self._unwrap_export(child)
            t = actual.type

            if t == "import_statement":
                imp = self._parse_import(actual, src)
                if imp:
                    imports.append(imp)
            elif t in ("class_declaration", "abstract_class_declaration"):
                cls = self._parse_class(actual, src)
                if cls:
                    classes.append(cls)
            elif t == "function_declaration":
                fn = self._parse_function(actual, src)
                if fn:
                    functions.append(fn)
            elif t == "lexical_declaration":
                functions.extend(self._parse_lexical_functions(actual, src))

        return imports, classes, functions, None

    # ---- unwrap export ----

    def _unwrap_export(self, node: Any) -> tuple[Any, bool]:
        if node.type != "export_statement":
            return node, False
        default = False
        for c in node.children:
            if c.type == "default":
                default = True
            if c.type in ("class_declaration", "abstract_class_declaration",
                          "function_declaration", "lexical_declaration"):
                return c, default
        return node, default

    # ---- import ----

    def _parse_import(self, node: Any, src: bytes) -> Optional[ParsedImport]:
        module = ""
        names: list[str] = []

        for c in node.named_children:
            t = c.type
            if t == "string":
                module = self._string_content(c, src)
            elif t == "import_clause":
                for cc in c.named_children:
                    if cc.type == "identifier":
                        names.append(self._text(cc, src))
                    elif cc.type == "named_imports":
                        for spec in cc.named_children:
                            if spec.type == "import_specifier":
                                nm = spec.child_by_field_name("name") or (spec.named_children[0] if spec.named_children else None)
                                if nm:
                                    names.append(self._text(nm, src))
                    elif cc.type == "namespace_import":
                        names.append("*")

        return ParsedImport(module=module, names=names, line=node.start_point[0] + 1) if module else None

    # ---- class ----

    def _parse_class(self, node: Any, src: bytes) -> Optional[ParsedClass]:
        name = ""
        bases: list[str] = []
        methods: list[ParsedFunction] = []
        attrs: list[str] = []
        is_abstract = node.type == "abstract_class_declaration"

        for c in node.named_children:
            t = c.type
            if t == "type_identifier" and not name:
                name = self._text(c, src)
            elif t == "class_heritage":
                for h in c.named_children:
                    if h.type == "extends_clause":
                        for v in h.named_children:
                            if v.type in ("identifier", "type_identifier", "member_expression"):
                                bases.append(self._text(v, src))
                    elif h.type == "implements_clause":
                        for v in h.named_children:
                            if v.type not in (",",):
                                txt = self._text(v, src)
                                if txt not in ("implements",):
                                    bases.append(txt)
            elif t == "class_body":
                for member in c.named_children:
                    mt = member.type
                    if mt == "method_definition":
                        m = self._parse_method(member, src, parent=name)
                        if m:
                            methods.append(m)
                    elif mt in ("public_field_definition", "field_definition"):
                        prop = member.child_by_field_name("name") or (
                            member.named_children[0] if member.named_children else None
                        )
                        if prop:
                            attrs.append(self._text(prop, src))

        if not name:
            return None
        return ParsedClass(
            name=name,
            line_start=node.start_point[0] + 1,
            line_end=node.end_point[0] + 1,
            base_classes=bases,
            is_abstract=is_abstract,
            methods=methods,
            attributes=attrs,
        )

    # ---- method / function ----

    def _parse_method(self, node: Any, src: bytes, parent: Optional[str] = None) -> Optional[ParsedFunction]:
        name = ""
        params: list[ParsedParameter] = []
        ret: Optional[str] = None
        calls: list[ParsedCall] = []
        is_async = any(c.type == "async" for c in node.children)

        for c in node.named_children:
            t = c.type
            if t in ("property_identifier", "private_property_identifier") and not name:
                name = self._text(c, src)
            elif t == "formal_parameters":
                params = self._parse_params(c, src)
            elif t == "type_annotation":
                ret = self._text(c, src).lstrip(": ").strip()
            elif t == "statement_block":
                self._collect_calls(c, src, calls)

        if not name:
            return None
        return ParsedFunction(
            name=name,
            line_start=node.start_point[0] + 1,
            line_end=node.end_point[0] + 1,
            parameters=params,
            return_type=ret,
            is_async=is_async,
            is_method=True,
            parent_class=parent,
            calls=calls,
        )

    def _parse_function(self, node: Any, src: bytes) -> Optional[ParsedFunction]:
        name = ""
        params: list[ParsedParameter] = []
        ret: Optional[str] = None
        calls: list[ParsedCall] = []
        is_async = any(c.type == "async" for c in node.children)

        for c in node.named_children:
            t = c.type
            if t == "identifier" and not name:
                name = self._text(c, src)
            elif t == "formal_parameters":
                params = self._parse_params(c, src)
            elif t == "type_annotation":
                ret = self._text(c, src).lstrip(": ").strip()
            elif t == "statement_block":
                self._collect_calls(c, src, calls)

        if not name:
            return None
        return ParsedFunction(
            name=name,
            line_start=node.start_point[0] + 1,
            line_end=node.end_point[0] + 1,
            parameters=params,
            return_type=ret,
            is_async=is_async,
            calls=calls,
        )

    def _parse_lexical_functions(self, node: Any, src: bytes) -> list[ParsedFunction]:
        """const foo = () => {} or const foo = function() {}"""
        funcs: list[ParsedFunction] = []
        for c in node.named_children:
            if c.type == "variable_declarator":
                nm = c.child_by_field_name("name")
                val = c.child_by_field_name("value")
                if nm and val and val.type in ("arrow_function", "function"):
                    fn = self._parse_arrow(val, src, name=self._text(nm, src))
                    if fn:
                        funcs.append(fn)
        return funcs

    def _parse_arrow(self, node: Any, src: bytes, name: str) -> Optional[ParsedFunction]:
        params: list[ParsedParameter] = []
        ret: Optional[str] = None
        calls: list[ParsedCall] = []
        is_async = any(c.type == "async" for c in node.children)

        for c in node.named_children:
            t = c.type
            if t == "formal_parameters":
                params = self._parse_params(c, src)
            elif t == "identifier":
                params = [ParsedParameter(name=self._text(c, src))]
            elif t == "type_annotation":
                ret = self._text(c, src).lstrip(": ").strip()
            elif t in ("statement_block", "parenthesized_expression", "binary_expression",
                       "call_expression", "member_expression"):
                self._collect_calls(c, src, calls)

        return ParsedFunction(
            name=name,
            line_start=node.start_point[0] + 1,
            line_end=node.end_point[0] + 1,
            parameters=params,
            return_type=ret,
            is_async=is_async,
            calls=calls,
        )

    def _parse_params(self, node: Any, src: bytes) -> list[ParsedParameter]:
        params: list[ParsedParameter] = []
        for c in node.named_children:
            t = c.type
            if t in ("required_parameter", "optional_parameter"):
                pat = c.child_by_field_name("pattern") or (c.named_children[0] if c.named_children else None)
                typ = c.child_by_field_name("type")
                if pat:
                    typ_str = self._text(typ, src).lstrip(": ").strip() if typ else None
                    params.append(ParsedParameter(name=self._text(pat, src), type_annotation=typ_str))
            elif t == "identifier":
                params.append(ParsedParameter(name=self._text(c, src)))
        return params

    # ---- calls ----

    def _collect_calls(self, node: Any, src: bytes, calls: list[ParsedCall]) -> None:
        if node.type == "call_expression":
            fn = node.named_children[0] if node.named_children else None
            if fn:
                callee = self._text(fn, src)
                is_m = fn.type == "member_expression" or "." in callee
                recv = callee.rsplit(".", 1)[0] if is_m and "." in callee else None
                args = next((c for c in node.named_children if c.type == "arguments"), None)
                argc = len([c for c in (args.named_children if args else []) if c.type not in (",",)])
                calls.append(ParsedCall(
                    callee=callee, line=node.start_point[0] + 1,
                    args_count=argc, is_method_call=is_m, receiver=recv,
                ))
        for c in node.children:
            self._collect_calls(c, src, calls)

    # ---- helpers ----

    def _string_content(self, node: Any, src: bytes) -> str:
        for c in node.named_children:
            if c.type == "string_fragment":
                return self._text(c, src)
        return self._text(node, src).strip("'\"` ")


# ---------------------------------------------------------------------------
# Go Visitor
# ---------------------------------------------------------------------------

class GoVisitor(_VisitorBase):

    def visit(self, root: Any, src: bytes) -> tuple[
        list[ParsedImport], list[ParsedClass], list[ParsedFunction], Optional[str]
    ]:
        imports: list[ParsedImport] = []
        classes: list[ParsedClass] = []
        functions: list[ParsedFunction] = []

        for child in root.named_children:
            t = child.type
            if t == "import_declaration":
                imports.extend(self._parse_imports(child, src))
            elif t == "type_declaration":
                cls = self._parse_type(child, src)
                if cls:
                    classes.append(cls)
            elif t == "function_declaration":
                fn = self._parse_function(child, src)
                if fn:
                    functions.append(fn)
            elif t == "method_declaration":
                fn = self._parse_method(child, src)
                if fn:
                    functions.append(fn)

        return imports, classes, functions, None

    # ---- imports ----

    def _parse_imports(self, node: Any, src: bytes) -> list[ParsedImport]:
        imports: list[ParsedImport] = []
        for c in node.named_children:
            if c.type == "import_spec_list":
                for spec in c.named_children:
                    if spec.type == "import_spec":
                        imp = self._parse_import_spec(spec, src)
                        if imp:
                            imports.append(imp)
            elif c.type == "import_spec":
                imp = self._parse_import_spec(c, src)
                if imp:
                    imports.append(imp)
        return imports

    def _parse_import_spec(self, node: Any, src: bytes) -> Optional[ParsedImport]:
        alias: Optional[str] = None
        path = ""
        for c in node.named_children:
            if c.type == "package_identifier":
                alias = self._text(c, src)
            elif c.type == "interpreted_string_literal":
                path = self._text(c, src).strip('"')
        if not path:
            return None
        return ParsedImport(module=path, alias=alias, line=node.start_point[0] + 1)

    # ---- type (struct / interface) ----

    def _parse_type(self, node: Any, src: bytes) -> Optional[ParsedClass]:
        for c in node.named_children:
            if c.type == "type_spec":
                return self._parse_type_spec(c, src)
        return None

    def _parse_type_spec(self, node: Any, src: bytes) -> Optional[ParsedClass]:
        name = ""
        is_interface = False
        for c in node.named_children:
            if c.type == "type_identifier" and not name:
                name = self._text(c, src)
            elif c.type == "interface_type":
                is_interface = True
        if not name:
            return None
        return ParsedClass(
            name=name,
            line_start=node.start_point[0] + 1,
            line_end=node.end_point[0] + 1,
            is_abstract=is_interface,
        )

    # ---- function ----

    def _parse_function(self, node: Any, src: bytes) -> Optional[ParsedFunction]:
        name = ""
        params: list[ParsedParameter] = []
        ret: Optional[str] = None
        calls: list[ParsedCall] = []

        named = node.named_children
        for i, c in enumerate(named):
            t = c.type
            if t == "identifier" and not name:
                name = self._text(c, src)
            elif t == "parameter_list":
                if not params:
                    params = self._parse_params(c, src)
                else:
                    ret = self._text(c, src)  # result param list
            elif t in _GO_TYPE_NODES and ret is None:
                ret = self._text(c, src)
            elif t == "block":
                self._collect_calls(c, src, calls)

        if not name:
            return None
        return ParsedFunction(
            name=name,
            line_start=node.start_point[0] + 1,
            line_end=node.end_point[0] + 1,
            parameters=params,
            return_type=ret,
            calls=calls,
        )

    # ---- method ----

    def _parse_method(self, node: Any, src: bytes) -> Optional[ParsedFunction]:
        name = ""
        params: list[ParsedParameter] = []
        ret: Optional[str] = None
        parent_class = ""
        calls: list[ParsedCall] = []

        named = node.named_children
        param_lists = [c for c in named if c.type == "parameter_list"]

        # receiver is first parameter_list
        if param_lists:
            for pd in param_lists[0].named_children:
                if pd.type == "parameter_declaration":
                    for tc in pd.named_children:
                        if tc.type in ("pointer_type", "type_identifier"):
                            parent_class = self._text(tc, src).lstrip("*")

        # method name
        for c in named:
            if c.type == "field_identifier":
                name = self._text(c, src)
                break

        # actual params (second parameter_list)
        if len(param_lists) >= 2:
            params = self._parse_params(param_lists[1], src)

        # result type + body
        found_second_params = False
        for c in named:
            t = c.type
            if t == "parameter_list":
                if found_second_params:
                    ret = self._text(c, src)  # result param list
                found_second_params = True
            elif t in _GO_TYPE_NODES and found_second_params and ret is None:
                ret = self._text(c, src)
            elif t == "block":
                self._collect_calls(c, src, calls)

        if not name:
            return None
        return ParsedFunction(
            name=name,
            line_start=node.start_point[0] + 1,
            line_end=node.end_point[0] + 1,
            parameters=params,
            return_type=ret,
            is_method=True,
            parent_class=parent_class or None,
            calls=calls,
        )

    # ---- params ----

    def _parse_params(self, node: Any, src: bytes) -> list[ParsedParameter]:
        params: list[ParsedParameter] = []
        for c in node.named_children:
            if c.type in ("parameter_declaration", "variadic_parameter_declaration"):
                named_cs = c.named_children
                if not named_cs:
                    continue
                # Last named child is the type; all before are names
                type_node = named_cs[-1]
                name_nodes = named_cs[:-1]
                typ_str = self._text(type_node, src) if type_node.type in _GO_TYPE_NODES else None
                if typ_str is None:
                    # All named children are identifiers (unnamed params) — treat all as names
                    name_nodes = named_cs
                for nn in name_nodes:
                    if nn.type == "identifier":
                        params.append(ParsedParameter(name=self._text(nn, src), type_annotation=typ_str))
        return params

    # ---- calls ----

    def _collect_calls(self, node: Any, src: bytes, calls: list[ParsedCall]) -> None:
        if node.type == "call_expression":
            named = node.named_children
            if named:
                fn_node = named[0]
                callee = self._text(fn_node, src)
                is_m = fn_node.type == "selector_expression"
                recv: Optional[str] = None
                if is_m:
                    # selector: obj.Method — named_children = [operand, field_identifier]
                    sel = fn_node.named_children
                    if len(sel) >= 2:
                        recv = self._text(sel[0], src)
                        method_name = self._text(sel[-1], src)
                        callee = f"{recv}.{method_name}"
                    elif len(sel) == 1:
                        recv = self._text(sel[0], src)
                arg_node = next((c for c in named if c.type == "argument_list"), None)
                argc = len([c for c in (arg_node.named_children if arg_node else [])]) if arg_node else 0
                calls.append(ParsedCall(
                    callee=callee, line=node.start_point[0] + 1,
                    args_count=argc, is_method_call=is_m, receiver=recv,
                ))
        for c in node.children:
            self._collect_calls(c, src, calls)


_GO_TYPE_NODES = frozenset({
    "type_identifier", "pointer_type", "slice_type", "map_type",
    "qualified_type", "array_type", "interface_type", "struct_type",
    "channel_type", "function_type",
})


# ---------------------------------------------------------------------------
# Java Visitor
# ---------------------------------------------------------------------------

class JavaVisitor(_VisitorBase):

    def visit(self, root: Any, src: bytes) -> tuple[
        list[ParsedImport], list[ParsedClass], list[ParsedFunction], Optional[str]
    ]:
        imports: list[ParsedImport] = []
        classes: list[ParsedClass] = []

        for child in root.named_children:
            t = child.type
            if t == "import_declaration":
                imp = self._parse_import(child, src)
                if imp:
                    imports.append(imp)
            elif t in ("class_declaration", "interface_declaration",
                       "enum_declaration", "record_declaration"):
                cls = self._parse_class(child, src)
                if cls:
                    classes.append(cls)

        return imports, classes, [], None

    # ---- import ----

    def _parse_import(self, node: Any, src: bytes) -> Optional[ParsedImport]:
        text = self._text(node, src).strip()
        module = text.removeprefix("import").removesuffix(";").strip()
        is_static = module.startswith("static ")
        if is_static:
            module = module.removeprefix("static ").strip()
        # Handle wildcard
        module = module.rstrip(".*") + (".*" if text.endswith(".*;") else "")
        return ParsedImport(module=module.strip(), line=node.start_point[0] + 1) if module else None

    # ---- class ----

    def _parse_class(self, node: Any, src: bytes) -> Optional[ParsedClass]:
        name = ""
        bases: list[str] = []
        methods: list[ParsedFunction] = []
        attrs: list[str] = []
        is_abstract = False
        is_interface = node.type == "interface_declaration"

        for c in node.named_children:
            t = c.type
            if t == "modifiers":
                is_abstract = "abstract" in self._text(c, src)
            elif t == "identifier" and not name:
                name = self._text(c, src)
            elif t == "superclass":
                for sc in c.named_children:
                    if sc.type in ("type_identifier", "generic_type"):
                        bases.append(self._text(sc, src))
            elif t in ("super_interfaces", "extends_interfaces"):
                tl = next((x for x in c.named_children if x.type == "type_list"), None)
                items = tl.named_children if tl else c.named_children
                for ti in items:
                    if ti.type in ("type_identifier", "generic_type"):
                        bases.append(self._text(ti, src))
            elif t == "class_body":
                for member in c.named_children:
                    mt = member.type
                    if mt in ("method_declaration", "constructor_declaration"):
                        m = self._parse_method(member, src, parent=name)
                        if m:
                            methods.append(m)
                    elif mt == "field_declaration":
                        for vd in member.named_children:
                            if vd.type == "variable_declarator":
                                nm = vd.child_by_field_name("name") or (
                                    next((x for x in vd.named_children if x.type == "identifier"), None)
                                )
                                if nm:
                                    attrs.append(self._text(nm, src))

        if not name:
            return None
        return ParsedClass(
            name=name,
            line_start=node.start_point[0] + 1,
            line_end=node.end_point[0] + 1,
            base_classes=bases,
            is_abstract=is_abstract or is_interface,
            methods=methods,
            attributes=attrs,
        )

    # ---- method ----

    def _parse_method(self, node: Any, src: bytes, parent: Optional[str] = None) -> Optional[ParsedFunction]:
        is_ctor = node.type == "constructor_declaration"
        name = ""
        params: list[ParsedParameter] = []
        ret: Optional[str] = None
        calls: list[ParsedCall] = []

        for c in node.named_children:
            t = c.type
            if t == "identifier" and not name:
                name = self._text(c, src)
            elif t == "formal_parameters":
                params = self._parse_params(c, src)
            elif t in ("block", "constructor_body"):
                self._collect_calls(c, src, calls)
            elif not is_ctor and t not in ("modifiers", "identifier", "formal_parameters",
                                           "throws", "type_parameters") and not name:
                # return type appears before name
                ret = self._text(c, src)

        # For method_declaration, return type is before the name
        if not is_ctor:
            named = node.named_children
            # skip modifiers (index 0), next named child is return type
            idx_start = 0
            if named and named[0].type == "modifiers":
                idx_start = 1
            if len(named) > idx_start:
                ret_node = named[idx_start]
                if ret_node.type not in ("identifier", "formal_parameters", "block"):
                    ret = self._text(ret_node, src)

        if not name:
            return None
        return ParsedFunction(
            name=name,
            line_start=node.start_point[0] + 1,
            line_end=node.end_point[0] + 1,
            parameters=params,
            return_type=ret,
            is_method=True,
            parent_class=parent,
            calls=calls,
        )

    def _parse_params(self, node: Any, src: bytes) -> list[ParsedParameter]:
        params: list[ParsedParameter] = []
        for c in node.named_children:
            if c.type in ("formal_parameter", "spread_parameter"):
                named_cs = c.named_children
                if not named_cs:
                    continue
                # last named child = identifier (param name), before it = type
                name_node = named_cs[-1]
                type_node = named_cs[-2] if len(named_cs) >= 2 else None
                if name_node.type == "identifier":
                    typ_str = self._text(type_node, src) if type_node else None
                    params.append(ParsedParameter(name=self._text(name_node, src), type_annotation=typ_str))
        return params

    # ---- calls ----

    def _collect_calls(self, node: Any, src: bytes, calls: list[ParsedCall]) -> None:
        if node.type == "method_invocation":
            named = node.named_children
            # last named child before argument_list is the method name
            arg_list = next((c for c in named if c.type == "argument_list"), None)
            pre_args = [c for c in named if c.type != "argument_list"]

            if pre_args:
                name_node = pre_args[-1]
                recv_nodes = pre_args[:-1]
                method_name = self._text(name_node, src)
                recv_str = self._text(recv_nodes[0], src) if recv_nodes else None
                callee = f"{recv_str}.{method_name}" if recv_str else method_name
                argc = len(arg_list.named_children) if arg_list else 0
                calls.append(ParsedCall(
                    callee=callee, line=node.start_point[0] + 1,
                    args_count=argc,
                    is_method_call=bool(recv_str),
                    receiver=recv_str,
                ))
        for c in node.children:
            self._collect_calls(c, src, calls)


# ---------------------------------------------------------------------------
# CodeParser
# ---------------------------------------------------------------------------

class CodeParser:
    """
    多语言代码解析器，支持 Python / TypeScript / Go / Java。

    主要方法::

        parser = CodeParser()
        pf = parser.parse_file("main.go")
        result = parser.scan_repository("/path/to/repo", languages=["go"])
    """

    SUPPORTED = frozenset({"python", "typescript", "go", "java"})

    def __init__(self, loader: Optional[LanguageLoader] = None) -> None:
        self.loader = loader or default_loader
        self._visitors: dict[str, _VisitorBase] = {
            "python":     PythonVisitor(),
            "typescript": TypeScriptVisitor(),
            "go":         GoVisitor(),
            "java":       JavaVisitor(),
        }

    # ------------------------------------------------------------------
    # Public: scan entire repository
    # ------------------------------------------------------------------

    def scan_repository(
        self,
        repo_path: str | Path,
        languages: Optional[list[str]] = None,
    ) -> ParseResult:
        """扫描整个仓库，解析所有源文件，返回 ParseResult。

        Args:
            repo_path: 仓库根目录。
            languages: 限定语言列表，默认解析所有支持的语言。
        """
        from backend.scanner.repo_scanner import RepoScanner

        lang_filter = [l for l in (languages or list(self.SUPPORTED)) if l in self.SUPPORTED]
        scanner = RepoScanner()
        parsed_files: list[ParsedFile] = []

        for batch in scanner.scan_repository(repo_path, languages=lang_filter):
            for file_info in batch.files:
                pf = self.parse_file(file_info.abs_path)
                if pf.language in self.SUPPORTED:
                    parsed_files.append(pf)

        return self._build_result(parsed_files)

    # ------------------------------------------------------------------
    # Public: parse single file
    # ------------------------------------------------------------------

    def parse_file(self, file_path: str | Path) -> ParsedFile:
        """解析单个源码文件，返回 ParsedFile。"""
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
            self._fallback_parse(result, source, language)
            return result

        try:
            tree = ts_parser.parse(source)
            result.raw_ast = tree
            visitor = self._visitors.get(language)
            if visitor:
                imports, classes, functions, doc = visitor.visit(tree.root_node, source)
                # 回填 file_path
                for cls in classes:
                    cls.file_path = str(path)
                    for m in cls.methods:
                        m.file_path = str(path)
                for fn in functions:
                    fn.file_path = str(path)
                result.imports = imports
                result.classes = classes
                result.functions = functions
                result.module_docstring = doc
            else:
                result.errors.append(f"暂无 {language} 的访问器，使用基础解析")
                self._fallback_parse(result, source, language)
        except Exception as e:
            logger.exception("解析文件 %s 时发生异常", path)
            result.errors.append(f"AST 解析异常: {e}")
            self._fallback_parse(result, source, language)

        return result

    def parse_source(self, source: str, language: str, file_path: str = "<string>") -> ParsedFile:
        """直接解析源码字符串（测试 / 动态代码用）。"""
        result = ParsedFile(file_path=file_path, language=language)
        src_bytes = source.encode("utf-8")
        result.source_lines = source.count("\n") + 1

        ts_parser = self.loader.get_parser(language)
        if ts_parser is None:
            result.errors.append(f"未能加载语言解析器: {language}")
            self._fallback_parse(result, src_bytes, language)
            return result

        try:
            tree = ts_parser.parse(src_bytes)
            result.raw_ast = tree
            visitor = self._visitors.get(language)
            if visitor:
                imports, classes, functions, doc = visitor.visit(tree.root_node, src_bytes)
                result.imports = imports
                result.classes = classes
                result.functions = functions
                result.module_docstring = doc
        except Exception as e:
            result.errors.append(f"解析异常: {e}")

        return result

    # ------------------------------------------------------------------
    # Public: extract helpers
    # ------------------------------------------------------------------

    def extract_classes(self, parsed_file: ParsedFile) -> list[ParsedClass]:
        """提取文件中所有类（含接口/结构体）。"""
        return list(parsed_file.classes)

    def extract_functions(self, parsed_file: ParsedFile) -> list[ParsedFunction]:
        """提取文件中所有函数和方法（模块级 + 类内方法）。"""
        funcs: list[ParsedFunction] = list(parsed_file.functions)
        for cls in parsed_file.classes:
            funcs.extend(cls.methods)
        return funcs

    def extract_calls(self, parsed_file: ParsedFile) -> list[ParsedCall]:
        """提取文件中所有函数调用，并回填 caller 信息。"""
        calls: list[ParsedCall] = []
        for fn in self.extract_functions(parsed_file):
            for call in fn.calls:
                call.caller_file = parsed_file.file_path
                call.caller_function = fn.name
                calls.append(call)
        return calls

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _build_result(self, parsed_files: list[ParsedFile]) -> ParseResult:
        all_classes: list[ParsedClass] = []
        all_functions: list[ParsedFunction] = []
        all_calls: list[ParsedCall] = []
        for pf in parsed_files:
            all_classes.extend(self.extract_classes(pf))
            all_functions.extend(self.extract_functions(pf))
            all_calls.extend(self.extract_calls(pf))
        return ParseResult(
            files=parsed_files,
            classes=all_classes,
            functions=all_functions,
            calls=all_calls,
        )

    def _fallback_parse(self, result: ParsedFile, source: bytes, language: str) -> None:
        """降级解析：用正则提取基本结构（Tree-sitter 不可用时）。"""
        text = source.decode("utf-8", errors="replace")
        lines = text.splitlines()

        patterns: dict[str, list[tuple[re.Pattern[str], str]]] = {
            "python": [
                (re.compile(r"^class\s+(\w+)"), "class"),
                (re.compile(r"^(?:async\s+)?def\s+(\w+)"), "func"),
                (re.compile(r"^(?:import|from)\s+([\w.]+)"), "import"),
            ],
            "go": [
                (re.compile(r"^type\s+(\w+)\s+struct"), "class"),
                (re.compile(r"^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)"), "func"),
                (re.compile(r'^import\s+"([\w./]+)"'), "import"),
            ],
            "java": [
                (re.compile(r"^\s*(?:public|private|protected)?\s*(?:abstract\s+)?class\s+(\w+)"), "class"),
                (re.compile(r"^\s*(?:public|private|protected)?\s+\w+\s+(\w+)\s*\("), "func"),
                (re.compile(r"^\s*import\s+([\w.]+)"), "import"),
            ],
            "typescript": [
                (re.compile(r"^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)"), "class"),
                (re.compile(r"^(?:export\s+)?(?:async\s+)?function\s+(\w+)"), "func"),
                (re.compile(r"^import\s+.+\s+from\s+['\"](.+)['\"]"), "import"),
            ],
        }

        for i, line in enumerate(lines, 1):
            for pattern, kind in patterns.get(language, []):
                m = pattern.match(line)
                if m:
                    sym = m.group(1)
                    if kind == "class":
                        result.classes.append(ParsedClass(name=sym, line_start=i, line_end=i))
                    elif kind == "func":
                        result.functions.append(ParsedFunction(name=sym, line_start=i, line_end=i))
                    elif kind == "import":
                        result.imports.append(ParsedImport(module=sym, line=i))
                    break
