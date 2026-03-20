"""结构预索引器：静态扫描代码仓库，提取类/方法骨架，供 Agent 精准查询。"""

from __future__ import annotations

import ast
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# javalang 为可选依赖
try:
    import javalang
    _JAVALANG_AVAILABLE = True
except ImportError:
    _JAVALANG_AVAILABLE = False
    logger.warning(
        "javalang 未安装，Java 解析将降级为正则模式。"
        "安装命令：pip install javalang"
    )

# 按重要性排序的注解（排在前面的文件优先返回）
_PRIORITY_ANNOTATIONS = {
    "@RestController", "@Controller", "@Service", "@Repository",
    "@Component", "@Configuration", "@SpringBootApplication",
}


@dataclass
class MethodInfo:
    """方法骨架。"""
    name: str
    signature: str           # 含参数类型和返回类型的完整签名
    annotations: list[str]   # 方法级注解
    line_start: int          # 方法首行行号（1-based）
    visibility: str          # "public" | "protected" | "private" | ""


@dataclass
class ClassInfo:
    """类骨架。"""
    name: str
    class_type: str          # "class" | "interface" | "abstract" | "enum"
    annotations: list[str]   # 类级注解
    methods: list[MethodInfo]
    base_classes: list[str]  # extends / implements 的类名
    line_start: int          # 类首行行号（1-based）


@dataclass
class FileSkeleton:
    """文件骨架。"""
    relative_path: str
    language: str
    classes: list[ClassInfo]
    top_imports: list[str]   # 最多 10 个 import 语句
    line_count: int


class StructureIndexer:
    """代码仓库结构预索引器。

    build_index() 扫描整个仓库（无 LLM 调用），将文件骨架存入 self._index。
    search_structure() 按注解/父类/关键词/路径等条件查询索引。
    """

    def __init__(self, depth: str = "standard") -> None:
        """
        Args:
            depth: 骨架详细程度。
                "quick"    – 仅类名 + 注解
                "standard" – 类 + 公共方法签名 + 行号
                "deep"     – 类 + 全部方法 + 依赖 + 行号
        """
        if depth not in ("quick", "standard", "deep"):
            raise ValueError(f"depth 必须是 'quick'/'standard'/'deep'，收到: {depth}")
        self.depth = depth
        self._index: dict[str, FileSkeleton] = {}

    # ── 公共接口 ──────────────────────────────────────────────────────────────

    def build_index(self, repo_path: Path) -> None:
        """扫描 repo_path 下所有源文件，构建骨架索引（存入 self._index）。"""
        repo_path = Path(repo_path).resolve()
        self._index.clear()

        # 忽略常见非源码目录
        ignore_dirs = {
            ".git", "venv", "node_modules", "target", "build",
            ".gradle", "__pycache__", ".idea", ".mvn",
        }

        for file_path in repo_path.rglob("*"):
            if not file_path.is_file():
                continue
            try:
                rel = file_path.relative_to(repo_path)
            except ValueError:
                continue
            if any(part in ignore_dirs for part in rel.parts):
                continue

            suffix = file_path.suffix.lower()
            skeleton = None

            if suffix == ".java":
                skeleton = self._scan_java(file_path)
            elif suffix == ".py":
                skeleton = self._scan_python(file_path)
            else:
                skeleton = self._scan_generic(file_path)

            if skeleton is not None:
                rel_path = str(file_path.relative_to(repo_path))
                skeleton.relative_path = rel_path
                self._index[rel_path] = skeleton

        logger.info("StructureIndexer: 索引构建完成，共 %d 个文件", len(self._index))

    def build_index_from_files(self, repo_path: Path, file_paths: list[str]) -> None:
        """从已知文件列表构建骨架索引，跳过目录遍历。

        与 build_index() 区别：不再 rglob 整个目录，
        直接遍历 file_paths 中已过滤好的相对路径列表。

        Args:
            repo_path: 仓库根目录（绝对路径）
            file_paths: 相对于 repo_path 的文件路径列表
        """
        repo_path = Path(repo_path).resolve()
        self._index.clear()

        for rel_path in file_paths:
            file_path = repo_path / rel_path
            if not file_path.is_file():
                continue

            suffix = file_path.suffix.lower()
            skeleton = None

            if suffix == ".java":
                skeleton = self._scan_java(file_path)
            elif suffix == ".py":
                skeleton = self._scan_python(file_path)
            else:
                skeleton = self._scan_generic(file_path)

            if skeleton is not None:
                skeleton.relative_path = rel_path
                self._index[rel_path] = skeleton

        logger.info(
            "StructureIndexer.build_index_from_files: 索引完成，共 %d 个文件",
            len(self._index),
        )

    def search_structure(
        self,
        annotation: str | None = None,
        base_class: str | None = None,
        keyword: str | None = None,
        file_pattern: str | None = None,
        module_path: str | None = None,
        max_results: int = 30,
        max_output_tokens: int = 4096,
    ) -> dict[str, Any]:
        """查询结构索引，返回匹配骨架 + 精确行号。

        方法名与工具名 search_structure 保持一致，确保 _dispatch_tool 路由正确。
        """
        matches: list[FileSkeleton] = []

        for rel_path, skeleton in self._index.items():
            if module_path and not rel_path.startswith(module_path):
                continue
            if file_pattern and not self._match_glob(rel_path, file_pattern):
                continue
            if annotation and not self._has_annotation(skeleton, annotation):
                continue
            if base_class and not self._has_base_class(skeleton, base_class):
                continue
            if keyword and not self._has_keyword(skeleton, keyword):
                continue
            matches.append(skeleton)

        matches.sort(key=self._priority_score, reverse=True)

        total_count = len(matches)
        truncated = total_count > max_results
        matches = matches[:max_results]

        max_chars = max_output_tokens * 4
        results = []
        used_chars = 0

        for skeleton in matches:
            entry = self._format_skeleton_entry(skeleton)
            entry_str = str(entry)
            if used_chars + len(entry_str) > max_chars:
                break
            results.append(entry)
            used_chars += len(entry_str)

        truncation_note = ""
        if truncated:
            truncation_note = (
                f"... 还有 {total_count - len(results)} 个文件匹配，"
                "请用 file_pattern 或 module_path 缩小范围"
            )

        return {
            "count": len(results),
            "total_count": total_count,
            "truncated": truncated,
            "truncation_note": truncation_note,
            "results": results,
        }

    # ── 私有：Java 解析 ───────────────────────────────────────────────────────

    def _scan_java(self, file_path: Path) -> FileSkeleton | None:
        """Java 文件骨架提取（javalang AST → 正则降级 → 仅行数）。"""
        try:
            source = file_path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return None

        lines = source.splitlines()
        line_count = len(lines)

        if _JAVALANG_AVAILABLE:
            try:
                return self._scan_java_ast(source, lines, line_count)
            except Exception:
                pass

        try:
            return self._scan_java_regex(source, lines, line_count)
        except Exception:
            pass

        return FileSkeleton(
            relative_path="",
            language="java",
            classes=[],
            top_imports=[],
            line_count=line_count,
        )

    def _scan_java_ast(self, source: str, lines: list[str], line_count: int) -> FileSkeleton:
        """用 javalang 做 AST 解析提取 Java 骨架。"""
        tree = javalang.parse.parse(source)

        top_imports = [
            f"import {imp.path}{'.*' if imp.wildcard else ''};"
            for imp in (tree.imports or [])
        ][:10]

        classes: list[ClassInfo] = []
        for path, node in tree:
            if not isinstance(node, (
                javalang.tree.ClassDeclaration,
                javalang.tree.InterfaceDeclaration,
                javalang.tree.EnumDeclaration,
            )):
                continue

            if isinstance(node, javalang.tree.InterfaceDeclaration):
                class_type = "interface"
            elif isinstance(node, javalang.tree.EnumDeclaration):
                class_type = "enum"
            elif node.modifiers and "abstract" in node.modifiers:
                class_type = "abstract"
            else:
                class_type = "class"

            annotations = [f"@{a.name}" for a in (node.annotations or [])]

            base_classes: list[str] = []
            if hasattr(node, "extends") and node.extends:
                ext = node.extends
                if isinstance(ext, list):
                    base_classes.extend(e.name for e in ext if hasattr(e, "name"))
                elif hasattr(ext, "name"):
                    base_classes.append(ext.name)
            if hasattr(node, "implements") and node.implements:
                for iface in node.implements:
                    if hasattr(iface, "name"):
                        base_classes.append(iface.name)

            line_start = node.position.line if node.position else 1

            methods: list[MethodInfo] = []
            if self.depth in ("standard", "deep"):
                for member in (node.body or []):
                    if not isinstance(member, javalang.tree.MethodDeclaration):
                        continue
                    vis = "public"
                    if member.modifiers:
                        if "private" in member.modifiers:
                            vis = "private"
                        elif "protected" in member.modifiers:
                            vis = "protected"

                    if self.depth == "standard" and vis != "public":
                        continue

                    m_annotations = [f"@{a.name}" for a in (member.annotations or [])]
                    params = ", ".join(
                        f"{p.type.name} {p.name}" for p in (member.parameters or [])
                    )
                    ret = member.return_type.name if member.return_type else "void"
                    sig = f"{ret} {member.name}({params})"
                    m_line = member.position.line if member.position else 0

                    methods.append(MethodInfo(
                        name=member.name,
                        signature=sig,
                        annotations=m_annotations,
                        line_start=m_line,
                        visibility=vis,
                    ))

            classes.append(ClassInfo(
                name=node.name,
                class_type=class_type,
                annotations=annotations,
                methods=methods,
                base_classes=base_classes,
                line_start=line_start,
            ))

        return FileSkeleton(
            relative_path="",
            language="java",
            classes=classes,
            top_imports=top_imports,
            line_count=line_count,
        )

    def _scan_java_regex(self, source: str, lines: list[str], line_count: int) -> FileSkeleton:
        """正则降级：只提取类名和注解，不提取方法签名。"""
        top_imports = re.findall(r"^import\s+[\w.*]+;", source, re.MULTILINE)[:10]

        class_pattern = re.compile(
            r"(?P<annotations>(?:\s*@\w+(?:\([^)]*\))?\s*)*)"
            r"\s*(?:public\s+)?(?P<mod>abstract\s+)?(?P<type>class|interface|enum)\s+"
            r"(?P<name>\w+)",
            re.MULTILINE,
        )
        classes: list[ClassInfo] = []
        for m in class_pattern.finditer(source):
            annotations = re.findall(r"@\w+", m.group("annotations"))
            mod = m.group("mod") or ""
            class_type = "abstract" if "abstract" in mod else m.group("type")
            line_no = source[:m.start()].count("\n") + 1
            classes.append(ClassInfo(
                name=m.group("name"),
                class_type=class_type,
                annotations=annotations,
                methods=[],
                base_classes=[],
                line_start=line_no,
            ))

        return FileSkeleton(
            relative_path="",
            language="java",
            classes=classes,
            top_imports=top_imports,
            line_count=line_count,
        )

    # ── 私有：Python 解析 ─────────────────────────────────────────────────────

    def _scan_python(self, file_path: Path) -> FileSkeleton | None:
        """Python 文件骨架提取（标准库 ast）。"""
        try:
            source = file_path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return None

        try:
            tree = ast.parse(source)
        except SyntaxError:
            return None

        lines = source.splitlines()
        line_count = len(lines)

        top_imports: list[str] = []
        classes: list[ClassInfo] = []

        # 仅遍历模块顶层节点，避免 ast.walk 收集嵌套类/函数
        for node in tree.body:
            # 收集顶层 import（按源码顺序，遇到第一个非 import 语句后停止收集）
            if isinstance(node, (ast.Import, ast.ImportFrom)) and len(top_imports) < 10:
                if isinstance(node, ast.Import):
                    top_imports.append(f"import {', '.join(a.name for a in node.names)}")
                else:
                    mod = node.module or ""
                    top_imports.append(f"from {mod} import ...")

            if not isinstance(node, ast.ClassDef):
                continue

            base_classes = [
                (getattr(b, "id", None) or getattr(b, "attr", None) or "")
                for b in node.bases
            ]

            methods: list[MethodInfo] = []
            if self.depth in ("standard", "deep"):
                for item in node.body:
                    if not isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        continue
                    name = item.name
                    # dunder 方法（__init__ 等）视为 public，单下划线视为 private
                    if name.startswith("__") and name.endswith("__"):
                        vis = "public"
                    elif name.startswith("_"):
                        vis = "private"
                    else:
                        vis = "public"

                    if self.depth == "standard" and vis != "public":
                        continue

                    args = item.args
                    param_names = [a.arg for a in args.args if a.arg != "self"]
                    sig = f"{name}({', '.join(param_names)})"

                    methods.append(MethodInfo(
                        name=name,
                        signature=sig,
                        annotations=[],
                        line_start=item.lineno,
                        visibility=vis,
                    ))

            classes.append(ClassInfo(
                name=node.name,
                class_type="class",
                annotations=[],
                methods=methods,
                base_classes=[b for b in base_classes if b],
                line_start=node.lineno,
            ))

        return FileSkeleton(
            relative_path="",
            language="python",
            classes=classes,
            top_imports=top_imports[:10],
            line_count=line_count,
        )

    # ── 私有：通用解析 ────────────────────────────────────────────────────────

    def _scan_generic(self, file_path: Path) -> FileSkeleton | None:
        """其他语言：仅提取行数，不提取结构。"""
        if file_path.suffix.lower() not in (
            ".ts", ".js", ".go", ".rs", ".kt", ".scala", ".cs",
        ):
            return None
        try:
            source = file_path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return None
        return FileSkeleton(
            relative_path="",
            language=file_path.suffix.lstrip(".").lower(),
            classes=[],
            top_imports=[],
            line_count=len(source.splitlines()),
        )

    # ── 私有：查询辅助 ────────────────────────────────────────────────────────

    def _has_annotation(self, skeleton: FileSkeleton, annotation: str) -> bool:
        ann = annotation if annotation.startswith("@") else f"@{annotation}"
        return any(ann in cls.annotations for cls in skeleton.classes)

    def _has_base_class(self, skeleton: FileSkeleton, base_class: str) -> bool:
        return any(base_class in cls.base_classes for cls in skeleton.classes)

    def _has_keyword(self, skeleton: FileSkeleton, keyword: str) -> bool:
        kw = keyword.lower()
        for cls in skeleton.classes:
            if kw in cls.name.lower():
                return True
            for m in cls.methods:
                if kw in m.name.lower():
                    return True
        return kw in skeleton.relative_path.lower()

    def _match_glob(self, path: str, pattern: str) -> bool:
        from fnmatch import fnmatch
        return fnmatch(path, pattern) or fnmatch(path.replace("\\", "/"), pattern)

    def _priority_score(self, skeleton: FileSkeleton) -> int:
        score = 0
        for cls in skeleton.classes:
            for ann in cls.annotations:
                if ann in _PRIORITY_ANNOTATIONS:
                    score += 2
        return score

    def _format_skeleton_entry(self, skeleton: FileSkeleton) -> dict[str, Any]:
        """将 FileSkeleton 转换为简洁的字典，供查询结果返回。"""
        classes_info = []
        for cls in skeleton.classes:
            entry: dict[str, Any] = {
                "name": cls.name,
                "type": cls.class_type,
                "annotations": cls.annotations,
                "line": cls.line_start,
            }
            if cls.base_classes:
                entry["extends"] = cls.base_classes
            if cls.methods:
                entry["methods"] = [
                    {
                        "name": m.name,
                        "signature": m.signature,
                        "annotations": m.annotations,
                        "line": m.line_start,
                    }
                    for m in cls.methods
                ]
            classes_info.append(entry)

        return {
            "file": skeleton.relative_path,
            "language": skeleton.language,
            "line_count": skeleton.line_count,
            "imports": skeleton.top_imports[:5],
            "classes": classes_info,
        }
