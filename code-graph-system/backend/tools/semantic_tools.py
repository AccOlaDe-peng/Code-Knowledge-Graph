"""语义分析工具实现。"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)


@dataclass
class AnnotationInfo:
    """注解信息。"""
    name: str
    full_name: str
    line_number: int
    attributes: dict
    target_element: str
    target_type: str


@dataclass
class ClassInfo:
    """类信息。"""
    name: str
    full_name: str
    type: str  # class / interface / enum
    modifiers: list
    extends: Optional[str]
    implements: list
    annotations: list
    line_start: int
    line_end: int
    file_path: str


@dataclass
class MethodInfo:
    """方法信息。"""
    name: str
    signature: str
    return_type: str
    parameters: list
    modifiers: list
    annotations: list
    throws: list
    line_start: int
    line_end: int


@dataclass
class FieldInfo:
    """字段信息。"""
    name: str
    type: str
    modifiers: list
    annotations: list
    default_value: Optional[str]
    line_number: int


class SemanticTools:
    """语义分析工具实现。"""

    def __init__(self, repo_path: Path | str, base_tools: Any):
        self.repo_path = Path(repo_path)
        self.base_tools = base_tools

    # ═══════════════════════════════════════════════════════════════
    # extract_annotations
    # ═══════════════════════════════════════════════════════════════

    def extract_annotations(
        self,
        path: str,
        annotation_filter: Optional[str] = None,
    ) -> dict:
        """提取文件中的所有注解。"""
        read_result = self.base_tools.read_file(path)
        if not read_result.get("success"):
            return read_result

        content = read_result["content"]
        lines = content.split("\n")

        # Java 注解正则
        annotation_pattern = r'@([A-Z][a-zA-Z0-9]*)\s*(?:\(([^)]*(?:\([^)]*\)[^)]*)*)\))?'

        annotations = []

        for i, line in enumerate(lines, start=1):
            for match in re.finditer(annotation_pattern, line):
                ann_name = match.group(1)

                # 过滤
                if annotation_filter and ann_name != annotation_filter:
                    continue

                # 解析属性
                attributes = {}
                attr_str = match.group(2)
                if attr_str:
                    attributes = self._parse_annotation_attributes(attr_str)

                # 推断目标元素
                target_element, target_type = self._infer_annotation_target(lines, i - 1)

                annotations.append({
                    "name": ann_name,
                    "full_name": f"@{ann_name}",
                    "line_number": i,
                    "attributes": attributes,
                    "target_element": target_element,
                    "target_type": target_type,
                })

        return {
            "success": True,
            "annotations": annotations,
            "count": len(annotations),
        }

    def _parse_annotation_attributes(self, attr_str: str) -> dict:
        """解析注解属性。"""
        attributes = {}

        # 简单解析：key = value
        pattern = r'(\w+)\s*=\s*(?:"([^"]*)"|\'([^\']*)\'|(\d+(?:\.\d+)?)|(true|false)|\{([^}]*)\}|([A-Za-z_][\w.]*))'

        for match in re.finditer(pattern, attr_str):
            key = match.group(1)
            for g in match.groups()[1:]:
                if g is not None:
                    if isinstance(g, str) and g.startswith("{"):
                        g = [item.strip().strip('"\'') for item in g[1:-1].split(",") if item.strip()]
                    attributes[key] = g
                    break

        # 无 key 的默认属性
        if not attributes and attr_str.strip():
            default_value = attr_str.strip().strip('"\'')
            if default_value:
                attributes["value"] = default_value

        return attributes

    def _infer_annotation_target(
        self,
        lines: list,
        line_idx: int,
    ) -> tuple:
        """推断注解的目标元素。"""
        text_after = "\n".join(lines[line_idx:])

        # 类定义
        class_match = re.search(
            r'(?:public\s+|private\s+|protected\s+)?'
            r'(?:abstract\s+|final\s+)?'
            r'(class|interface|enum|@interface)\s+(\w+)',
            text_after[:500]
        )
        if class_match:
            return class_match.group(2), class_match.group(1)

        # 方法定义
        method_match = re.search(
            r'(?:public|private|protected)?\s*'
            r'(?:static\s+)?'
            r'(?:\w+(?:<[^>]+>)?\s+)?'
            r'(\w+)\s*\([^)]*\)',
            text_after[:200]
        )
        if method_match:
            return method_match.group(1), "method"

        # 字段定义
        field_match = re.search(
            r'(?:public|private|protected)?\s*'
            r'(?:static\s+)?'
            r'(?:final\s+)?'
            r'(\w+(?:<[^>]+>)?)\s+(\w+)\s*[;=]',
            text_after[:200]
        )
        if field_match:
            return field_match.group(2), "field"

        return "unknown", "unknown"

    # ═══════════════════════════════════════════════════════════════
    # extract_classes
    # ═══════════════════════════════════════════════════════════════

    def extract_classes(self, path: str) -> dict:
        """提取文件中的类定义。"""
        read_result = self.base_tools.read_file(path)
        if not read_result.get("success"):
            return read_result

        content = read_result["content"]
        lines = content.split("\n")

        # 类定义正则
        class_pattern = re.compile(
            r'(?P<modifiers>(?:public|private|protected|abstract|final|static)\s+)*'
            r'(?P<type>class|interface|enum|@interface)\s+'
            r'(?P<name>\w+)'
            r'(?:\s+extends\s+(?P<extends>[\w.<>,\s]+))?'
            r'(?:\s+implements\s+(?P<implements>[\w.<>,\s]+))?'
            r'\s*\{'
        )

        classes = []

        for match in class_pattern.finditer(content):
            start_pos = match.start()
            line_number = content[:start_pos].count("\n") + 1

            # 找到类的结束位置
            end_pos = self._find_matching_brace(content, match.end() - 1)
            end_line = content[:end_pos].count("\n") + 1 if end_pos else line_number

            modifiers_str = match.group("modifiers") or ""
            modifiers = modifiers_str.split()

            implements = []
            if match.group("implements"):
                implements = [i.strip() for i in match.group("implements").split(",")]

            # 提取类上的注解
            class_annotations = self._extract_annotations_before(lines, line_number - 1)

            classes.append({
                "name": match.group("name"),
                "full_name": match.group("name"),
                "type": match.group("type").replace("@interface", "annotation"),
                "modifiers": modifiers,
                "extends": match.group("extends").strip() if match.group("extends") else None,
                "implements": implements,
                "annotations": class_annotations,
                "line_start": line_number,
                "line_end": end_line,
                "file_path": path,
            })

        return {
            "success": True,
            "classes": classes,
            "count": len(classes),
        }

    def _find_matching_brace(self, content: str, start_pos: int) -> Optional[int]:
        """找到匹配的右花括号位置。"""
        if start_pos >= len(content) or content[start_pos] != "{":
            return None

        depth = 1
        pos = start_pos + 1

        while pos < len(content) and depth > 0:
            if content[pos] == "{":
                depth += 1
            elif content[pos] == "}":
                depth -= 1
            pos += 1

        return pos if depth == 0 else None

    def _extract_annotations_before(self, lines: list, line_idx: int) -> list:
        """提取指定行之前的注解。"""
        annotations = []

        for i in range(line_idx - 1, max(0, line_idx - 10), -1):
            line = lines[i].strip()
            if not line:
                continue
            if line.startswith("@"):
                match = re.match(r'@(\w+)', line)
                if match:
                    annotations.append({
                        "name": match.group(1),
                        "line_number": i + 1,
                    })
            elif not line.startswith("//") and not line.startswith("/*"):
                break

        return list(reversed(annotations))

    # ═══════════════════════════════════════════════════════════════
    # extract_methods
    # ═══════════════════════════════════════════════════════════════

    def extract_methods(self, path: str, class_name: str) -> dict:
        """提取类中的方法。"""
        classes_result = self.extract_classes(path)
        if not classes_result.get("success"):
            return classes_result

        target_class = None
        for cls in classes_result["classes"]:
            if cls["name"] == class_name:
                target_class = cls
                break

        if not target_class:
            return {"success": False, "error": f"Class not found: {class_name}"}

        read_result = self.base_tools.read_file(path)
        content = read_result["content"]
        lines = content.split("\n")

        # 提取类体
        class_body_lines = lines[target_class["line_start"]:target_class["line_end"]]
        class_body = "\n".join(class_body_lines)

        # 方法定义正则
        method_pattern = re.compile(
            r'(?P<modifiers>(?:public|private|protected|static|final|abstract|synchronized|native)\s+)*'
            r'(?P<return_type>\w+(?:<[^>]+>)?(?:\[\])?)\s+'
            r'(?P<name>\w+)\s*'
            r'(?P<params>\([^)]*\))'
            r'(?:\s+throws\s+(?P<throws>[\w.,\s]+))?'
            r'\s*(?:\{|;)'
        )

        methods = []

        for match in method_pattern.finditer(class_body):
            method_name = match.group("name")

            # 过滤构造函数
            if method_name == class_name:
                continue

            line_in_body = class_body[:match.start()].count("\n")
            line_number = target_class["line_start"] + line_in_body

            modifiers_str = match.group("modifiers") or ""
            modifiers = modifiers_str.split()

            params_str = match.group("params")[1:-1]
            parameters = self._parse_parameters(params_str)

            throws = []
            if match.group("throws"):
                throws = [t.strip() for t in match.group("throws").split(",")]

            method_annotations = self._extract_annotations_before(class_body_lines, line_in_body)

            methods.append({
                "name": method_name,
                "signature": f"{match.group('return_type')} {method_name}{match.group('params')}",
                "return_type": match.group("return_type"),
                "parameters": parameters,
                "modifiers": modifiers,
                "annotations": method_annotations,
                "throws": throws,
                "line_start": line_number,
                "line_end": line_number,
            })

        return {
            "success": True,
            "methods": methods,
            "class_name": class_name,
            "count": len(methods),
        }

    def _parse_parameters(self, params_str: str) -> list:
        """解析方法参数。"""
        if not params_str.strip():
            return []

        parameters = []
        parts = params_str.split(",")

        for part in parts:
            part = part.strip()
            if not part:
                continue

            annotations = []
            ann_pattern = r'@(\w+)'
            for ann_match in re.finditer(ann_pattern, part):
                annotations.append(ann_match.group(1))

            clean_part = re.sub(ann_pattern, "", part).strip()
            words = clean_part.split()

            if len(words) >= 2:
                param_type = " ".join(words[:-1])
                param_name = words[-1]
            elif len(words) == 1:
                param_type = words[0]
                param_name = ""
            else:
                continue

            parameters.append({
                "name": param_name,
                "type": param_type,
                "annotations": annotations,
            })

        return parameters

    # ═══════════════════════════════════════════════════════════════
    # extract_fields
    # ═══════════════════════════════════════════════════════════════

    def extract_fields(self, path: str, class_name: str) -> dict:
        """提取类中的字段。"""
        classes_result = self.extract_classes(path)
        if not classes_result.get("success"):
            return classes_result

        target_class = None
        for cls in classes_result["classes"]:
            if cls["name"] == class_name:
                target_class = cls
                break

        if not target_class:
            return {"success": False, "error": f"Class not found: {class_name}"}

        read_result = self.base_tools.read_file(path)
        content = read_result["content"]
        lines = content.split("\n")

        class_body_lines = lines[target_class["line_start"]:target_class["line_end"]]
        class_body = "\n".join(class_body_lines)

        # 字段定义正则
        field_pattern = re.compile(
            r'(?P<modifiers>(?:public|private|protected|static|final|transient|volatile)\s+)*'
            r'(?P<type>\w+(?:<[^>]+>)?(?:\[\])?)\s+'
            r'(?P<name>\w+)'
            r'(?:\s*=\s*(?P<default>[^;]+))?'
            r'\s*;'
        )

        fields = []

        # 排除方法
        method_pattern = re.compile(r'\w+\s*\([^)]*\)\s*\{')
        method_positions = {m.start() for m in method_pattern.finditer(class_body)}

        for match in field_pattern.finditer(class_body):
            pos = match.start()
            in_method = any(
                self._is_pos_in_method(class_body, pos, m_start)
                for m_start in method_positions
            )
            if in_method:
                continue

            line_in_body = class_body[:pos].count("\n")
            line_number = target_class["line_start"] + line_in_body

            modifiers_str = match.group("modifiers") or ""
            modifiers = modifiers_str.split()

            field_annotations = self._extract_annotations_before(class_body_lines, line_in_body)

            fields.append({
                "name": match.group("name"),
                "type": match.group("type"),
                "modifiers": modifiers,
                "annotations": field_annotations,
                "default_value": match.group("default").strip() if match.group("default") else None,
                "line_number": line_number,
            })

        return {
            "success": True,
            "fields": fields,
            "class_name": class_name,
            "count": len(fields),
        }

    def _is_pos_in_method(self, content: str, pos: int, method_start: int) -> bool:
        """判断位置是否在方法体内。"""
        if pos < method_start:
            return False

        brace_pos = content.find("{", method_start)
        if brace_pos == -1:
            return False

        end_pos = self._find_matching_brace(content, brace_pos)
        if end_pos is None:
            return False

        return brace_pos < pos < end_pos

    # ═══════════════════════════════════════════════════════════════
    # extract_call_graph
    # ═══════════════════════════════════════════════════════════════

    def extract_call_graph(
        self,
        path: str,
        method_name: str,
        depth: int = 1,
    ) -> dict:
        """提取方法调用关系（简化实现）。"""
        # TODO: 完整实现
        return {
            "success": True,
            "calls": [],
            "method_name": method_name,
            "depth": depth,
        }

    # ═══════════════════════════════════════════════════════════════
    # analyze_inheritance
    # ═══════════════════════════════════════════════════════════════

    def analyze_inheritance(self, path: str, class_name: str) -> dict:
        """分析类的继承结构。"""
        classes_result = self.extract_classes(path)
        if not classes_result.get("success"):
            return classes_result

        target_class = None
        for cls in classes_result["classes"]:
            if cls["name"] == class_name:
                target_class = cls
                break

        if not target_class:
            return {"success": False, "error": f"Class not found: {class_name}"}

        return {
            "success": True,
            "class_name": class_name,
            "extends": target_class["extends"],
            "implements": target_class["implements"],
            "inheritance_chain": [class_name] + ([target_class["extends"]] if target_class["extends"] else []),
        }

    # ═══════════════════════════════════════════════════════════════
    # infer_field_mapping
    # ═══════════════════════════════════════════════════════════════

    def infer_field_mapping(self, path: str, class_name: str) -> dict:
        """推断字段映射。"""
        fields_result = self.extract_fields(path, class_name)
        if not fields_result.get("success"):
            return fields_result

        mappings = []
        for field in fields_result["fields"]:
            field_name = field["name"]
            # 驼峰转下划线
            column_name = re.sub(r'([a-z])([A-Z])', r'\1_\2', field_name).lower()

            mappings.append({
                "field_name": field_name,
                "column_name": column_name,
                "type": field["type"],
                "is_primary": any(a.get("name") == "Id" for a in field.get("annotations", [])),
            })

        return {
            "success": True,
            "mappings": mappings,
            "class_name": class_name,
            "count": len(mappings),
        }

    # ═══════════════════════════════════════════════════════════════
    # detect_patterns
    # ═══════════════════════════════════════════════════════════════

    def detect_patterns(
        self,
        path: str,
        pattern_types: list = None,
    ) -> dict:
        """检测设计模式（简化实现）。"""
        pattern_types = pattern_types or ["singleton", "factory", "repository"]

        read_result = self.base_tools.read_file(path)
        if not read_result.get("success"):
            return read_result

        content = read_result["content"]
        detected = []

        # Singleton 检测
        if "singleton" in pattern_types:
            if re.search(r'private\s+static\s+\w+\s+instance', content):
                detected.append({"pattern": "singleton", "confidence": 0.7})

        # Repository 检测
        if "repository" in pattern_types:
            if re.search(r'@Repository|extends\s+\w*Repository', content):
                detected.append({"pattern": "repository", "confidence": 0.9})

        # Factory 检测
        if "factory" in pattern_types:
            if re.search(r'Factory|create\w*\s*\(', content):
                detected.append({"pattern": "factory", "confidence": 0.6})

        return {
            "success": True,
            "patterns": detected,
            "path": path,
        }
