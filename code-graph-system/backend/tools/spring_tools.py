"""Spring 框架专用工具实现。"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)


@dataclass
class BeanInfo:
    """Bean 信息。"""
    name: str
    type: str
    scope: str
    qualifiers: list
    primary: bool
    lazy: bool
    profile: Optional[str]
    file_path: str
    line_number: int


@dataclass
class ControllerInfo:
    """Controller 信息。"""
    name: str
    base_path: str
    methods: list
    annotations: list
    file_path: str
    line_number: int


@dataclass
class EndpointInfo:
    """API 端点信息。"""
    path: str
    http_method: str
    method_name: str
    parameters: list
    return_type: str
    annotations: list
    line_number: int


@dataclass
class EventListenerInfo:
    """事件监听器信息。"""
    event_type: str
    method_name: str
    condition: Optional[str]
    phase: str  # before, after, default
    line_number: int


class SpringTools:
    """Spring 框架专用工具实现。"""

    def __init__(self, repo_path: Path | str, base_tools: Any, semantic_tools: Any):
        self.repo_path = Path(repo_path)
        self.base_tools = base_tools
        self.semantic_tools = semantic_tools

    # ═══════════════════════════════════════════════════════════════
    # extract_beans
    # ═══════════════════════════════════════════════════════════════

    def extract_beans(
        self,
        path: str,
        include_config: bool = True,
    ) -> dict:
        """提取 Spring Bean 定义。"""
        read_result = self.base_tools.read_file(path)
        if not read_result.get("success"):
            return read_result

        content = read_result["content"]
        lines = content.split("\n")

        beans = []

        # 1. 注解驱动 (@Component, @Service, @Repository, @Controller, @Configuration, @Bean)
        beans.extend(self._extract_annotation_beans(lines, path))

        # 2. XML 配置（如果启用）
        if include_config and path.endswith(".xml"):
            beans.extend(self._extract_xml_beans(content, path))

        return {
            "success": True,
            "beans": beans,
            "count": len(beans),
        }

    def _extract_annotation_beans(self, lines: list, path: str) -> list:
        """提取注解驱动的 Bean。"""
        beans = []

        # Spring 组件注解
        component_annotations = {
            "Component", "Service", "Repository", "Controller",
            "RestController", "Configuration", "ControllerAdvice",
        }

        # Bean 定义注解
        bean_annotations = {"Bean"}

        for i, line in enumerate(lines, start=1):
            # 类级别组件
            for ann in component_annotations:
                if f"@{ann}" in line:
                    # 查找类名
                    class_name = self._find_class_name(lines, i - 1)
                    if class_name:
                        # 提取额外信息
                        qualifiers = self._extract_qualifiers(lines, i - 1)
                        scope = self._extract_scope(lines, i - 1)
                        primary = self._has_annotation(lines, i - 1, "Primary")
                        lazy = self._has_annotation(lines, i - 1, "Lazy")
                        profile = self._extract_profile(lines, i - 1)

                        beans.append({
                            "name": self._derive_bean_name(class_name),
                            "type": class_name,
                            "scope": scope,
                            "qualifiers": qualifiers,
                            "primary": primary,
                            "lazy": lazy,
                            "profile": profile,
                            "source": "annotation",
                            "file_path": path,
                            "line_number": i,
                        })

            # @Bean 方法
            if "@Bean" in line:
                method_name = self._find_method_name(lines, i - 1)
                if method_name:
                    return_type = self._find_return_type(lines, i - 1)
                    beans.append({
                        "name": method_name,
                        "type": return_type or "unknown",
                        "scope": self._extract_scope(lines, i - 1) or "singleton",
                        "qualifiers": self._extract_qualifiers(lines, i - 1),
                        "primary": self._has_annotation(lines, i - 1, "Primary"),
                        "lazy": self._has_annotation(lines, i - 1, "Lazy"),
                        "profile": self._extract_profile(lines, i - 1),
                        "source": "bean_method",
                        "file_path": path,
                        "line_number": i,
                    })

        return beans

    def _extract_xml_beans(self, content: str, path: str) -> list:
        """提取 XML 配置的 Bean。"""
        beans = []

        # <bean id="xxx" class="xxx">
        pattern = r'<bean\s+[^>]*id="([^"]+)"[^>]*class="([^"]+)"[^>]*/?>'

        for match in re.finditer(pattern, content):
            beans.append({
                "name": match.group(1),
                "type": match.group(2),
                "scope": "singleton",  # 默认
                "qualifiers": [],
                "primary": False,
                "lazy": False,
                "profile": None,
                "source": "xml",
                "file_path": path,
                "line_number": content[:match.start()].count("\n") + 1,
            })

        return beans

    # ═══════════════════════════════════════════════════════════════
    # extract_controllers
    # ═══════════════════════════════════════════════════════════════

    def extract_controllers(self, path: str) -> dict:
        """提取 Controller 和 API 端点。"""
        read_result = self.base_tools.read_file(path)
        if not read_result.get("success"):
            return read_result

        content = read_result["content"]
        lines = content.split("\n")

        controllers = []

        for i, line in enumerate(lines, start=1):
            if "@RestController" in line or "@Controller" in line:
                class_name = self._find_class_name(lines, i - 1)
                if not class_name:
                    continue

                # 提取 @RequestMapping 基础路径
                base_path = self._extract_request_mapping(lines, i - 1)

                # 提取端点方法
                endpoints = self._extract_endpoints(lines, i - 1)

                controllers.append({
                    "name": class_name,
                    "base_path": base_path,
                    "methods": endpoints,
                    "annotations": self._extract_class_annotations(lines, i - 1),
                    "file_path": path,
                    "line_number": i,
                })

        return {
            "success": True,
            "controllers": controllers,
            "count": len(controllers),
        }

    def _extract_endpoints(self, lines: list, start_idx: int) -> list:
        """提取 Controller 中的端点方法。"""
        endpoints = []

        # HTTP 方法注解
        http_methods = {
            "GetMapping": "GET",
            "PostMapping": "POST",
            "PutMapping": "PUT",
            "DeleteMapping": "DELETE",
            "PatchMapping": "PATCH",
            "RequestMapping": None,  # 需要解析 method 属性
        }

        # 找到类体范围
        class_end = self._find_class_end(lines, start_idx)

        for i in range(start_idx, min(class_end, len(lines))):
            line = lines[i]

            for ann_name, http_method in http_methods.items():
                if f"@{ann_name}" in line:
                    # 提取路径
                    path = self._extract_path_from_mapping(line, ann_name)

                    # 如果是 RequestMapping，需要解析 method
                    if ann_name == "RequestMapping":
                        http_method = self._extract_method_from_mapping(line) or "GET"

                    # 提取方法信息
                    method_info = self._extract_method_info(lines, i)
                    if method_info:
                        endpoints.append({
                            "path": path,
                            "http_method": http_method,
                            "method_name": method_info.get("name"),
                            "parameters": method_info.get("parameters", []),
                            "return_type": method_info.get("return_type"),
                            "annotations": method_info.get("annotations", []),
                            "line_number": i + 1,
                        })

        return endpoints

    # ═══════════════════════════════════════════════════════════════
    # extract_di_dependencies
    # ═══════════════════════════════════════════════════════════════

    def extract_di_dependencies(self, path: str, class_name: str) -> dict:
        """提取类的依赖注入关系。"""
        read_result = self.base_tools.read_file(path)
        if not read_result.get("success"):
            return read_result

        content = read_result["content"]
        lines = content.split("\n")

        dependencies = []

        # 找到类定义
        class_start = None
        for i, line in enumerate(lines):
            if f"class {class_name}" in line:
                class_start = i
                break

        if class_start is None:
            return {"success": False, "error": f"Class {class_name} not found"}

        # 找到类体范围
        class_end = self._find_class_end(lines, class_start)

        for i in range(class_start, class_end):
            line = lines[i]

            # 构造函数注入
            if "public " in line and f"{class_name}(" in line:
                constructor_deps = self._parse_constructor_deps(lines, i)
                dependencies.extend(constructor_deps)

            # 字段注入
            if "@Autowired" in line or "@Inject" in line or "@Resource" in line:
                # 查看下一行获取字段信息
                if i + 1 < len(lines):
                    field_info = self._parse_field_injection(lines[i + 1])
                    if field_info:
                        inject_type = "Autowired" if "@Autowired" in line else \
                                      "Inject" if "@Inject" in line else "Resource"
                        field_info["injection_type"] = inject_type
                        dependencies.append(field_info)

            # Setter 注入
            if "@Autowired" in line and i + 1 < len(lines):
                setter_info = self._parse_setter_injection(lines[i + 1])
                if setter_info:
                    setter_info["injection_type"] = "Autowired"
                    dependencies.append(setter_info)

        return {
            "success": True,
            "class_name": class_name,
            "dependencies": dependencies,
            "count": len(dependencies),
        }

    def _parse_constructor_deps(self, lines: list, line_idx: int) -> list:
        """解析构造函数依赖。"""
        deps = []
        line = lines[line_idx]

        # 提取参数列表
        match = re.search(r'\(([^)]*)\)', line)
        if not match:
            return deps

        params_str = match.group(1)
        params = self._split_params(params_str)

        for param in params:
            param = param.strip()
            if not param:
                continue

            # 跳过注解
            param = re.sub(r'@\w+\s*', '', param)

            # 分离类型和名称
            parts = param.split()
            if len(parts) >= 2:
                param_type = parts[-2]
                param_name = parts[-1]
                deps.append({
                    "type": param_type,
                    "name": param_name,
                    "injection_type": "constructor",
                    "qualifiers": [],
                })

        return deps

    def _parse_field_injection(self, line: str) -> Optional[dict]:
        """解析字段注入。"""
        # private Xxx xxx;
        match = re.match(
            r'(?:private|protected|public)?\s+'
            r'(?:static\s+)?'
            r'(\w+(?:<[^>]+>)?)\s+'
            r'(\w+)\s*[;=]',
            line.strip()
        )
        if match:
            return {
                "type": match.group(1),
                "name": match.group(2),
                "injection_type": "field",
                "qualifiers": [],
            }
        return None

    def _parse_setter_injection(self, line: str) -> Optional[dict]:
        """解析 Setter 注入。"""
        # public void setXxx(Xxx xxx)
        match = re.match(
            r'public\s+void\s+set(\w+)\s*\((\w+(?:<[^>]+>)?)\s+(\w+)\)',
            line.strip()
        )
        if match:
            return {
                "type": match.group(2),
                "name": match.group(3),
                "setter": f"set{match.group(1)}",
                "injection_type": "setter",
                "qualifiers": [],
            }
        return None

    # ═══════════════════════════════════════════════════════════════
    # extract_event_listeners
    # ═══════════════════════════════════════════════════════════════

    def extract_event_listeners(self, path: str) -> dict:
        """提取事件监听器。"""
        read_result = self.base_tools.read_file(path)
        if not read_result.get("success"):
            return read_result

        content = read_result["content"]
        lines = content.split("\n")

        listeners = []

        for i, line in enumerate(lines, start=1):
            # @EventListener
            if "@EventListener" in line:
                listener = self._parse_event_listener(lines, i - 1)
                if listener:
                    listener["file_path"] = path
                    listeners.append(listener)

            # @TransactionalEventListener
            if "@TransactionalEventListener" in line:
                listener = self._parse_tx_event_listener(lines, i - 1)
                if listener:
                    listener["file_path"] = path
                    listeners.append(listener)

            # ApplicationListener 接口实现
            if "implements ApplicationListener" in line:
                class_name = self._find_class_name(lines, i - 1)
                match = re.search(r'ApplicationListener<(\w+)>', line)
                if match:
                    listeners.append({
                        "event_type": match.group(1),
                        "method_name": "onApplicationEvent",
                        "condition": None,
                        "phase": "default",
                        "source": "interface",
                        "class_name": class_name,
                        "file_path": path,
                        "line_number": i,
                    })

        return {
            "success": True,
            "listeners": listeners,
            "count": len(listeners),
        }

    def _parse_event_listener(self, lines: list, line_idx: int) -> Optional[dict]:
        """解析 @EventListener。"""
        line = lines[line_idx]

        # 提取 condition
        condition = None
        cond_match = re.search(r'condition\s*=\s*"([^"]+)"', line)
        if cond_match:
            condition = cond_match.group(1)

        # 提取 classes 属性
        event_type = None
        classes_match = re.search(r'classes\s*=\s*(\w+)\.class', line)
        if classes_match:
            event_type = classes_match.group(1)

        # 提取方法名和参数类型
        method_info = self._extract_method_info(lines, line_idx)
        if method_info:
            if not event_type and method_info.get("parameters"):
                # 从参数推断事件类型
                event_type = method_info["parameters"][0].get("type")

            return {
                "event_type": event_type,
                "method_name": method_info.get("name"),
                "condition": condition,
                "phase": "default",
                "source": "annotation",
            }

        return None

    def _parse_tx_event_listener(self, lines: list, line_idx: int) -> Optional[dict]:
        """解析 @TransactionalEventListener。"""
        line = lines[line_idx]

        # 提取 phase
        phase = "after_commit"
        phase_match = re.search(r'phase\s*=\s*TransactionPhase\.(\w+)', line)
        if phase_match:
            phase = phase_match.group(1).lower()

        listener = self._parse_event_listener(lines, line_idx)
        if listener:
            listener["phase"] = phase
            listener["source"] = "transactional"

        return listener

    # ═══════════════════════════════════════════════════════════════
    # extract_scheduled_tasks
    # ═══════════════════════════════════════════════════════════════

    def extract_scheduled_tasks(self, path: str) -> dict:
        """提取定时任务。"""
        read_result = self.base_tools.read_file(path)
        if not read_result.get("success"):
            return read_result

        lines = read_result["content"].split("\n")

        tasks = []

        for i, line in enumerate(lines, start=1):
            if "@Scheduled" in line:
                task = self._parse_scheduled(lines, i - 1)
                if task:
                    task["file_path"] = path
                    task["line_number"] = i
                    tasks.append(task)

        return {
            "success": True,
            "tasks": tasks,
            "count": len(tasks),
        }

    def _parse_scheduled(self, lines: list, line_idx: int) -> Optional[dict]:
        """解析 @Scheduled 注解。"""
        line = lines[line_idx]

        task_type = None
        value = None

        if "cron" in line:
            task_type = "cron"
            match = re.search(r'cron\s*=\s*"([^"]+)"', line)
            if match:
                value = match.group(1)
        elif "fixedRate" in line:
            task_type = "fixed_rate"
            match = re.search(r'fixedRate\s*=\s*(\d+)', line)
            if match:
                value = int(match.group(1))
        elif "fixedDelay" in line:
            task_type = "fixed_delay"
            match = re.search(r'fixedDelay\s*=\s*(\d+)', line)
            if match:
                value = int(match.group(1))
        elif "initialDelay" in line:
            task_type = "initial_delay"
            match = re.search(r'initialDelay\s*=\s*(\d+)', line)
            if match:
                value = int(match.group(1))

        method_info = self._extract_method_info(lines, line_idx)

        return {
            "type": task_type,
            "value": value,
            "method_name": method_info.get("name") if method_info else None,
        }

    # ═══════════════════════════════════════════════════════════════
    # 辅助方法
    # ═══════════════════════════════════════════════════════════════

    def _find_class_name(self, lines: list, start_idx: int) -> Optional[str]:
        """查找类名。"""
        for i in range(start_idx, min(start_idx + 10, len(lines))):
            match = re.search(r'class\s+(\w+)', lines[i])
            if match:
                return match.group(1)
        return None

    def _find_method_name(self, lines: list, start_idx: int) -> Optional[str]:
        """查找方法名。"""
        for i in range(start_idx, min(start_idx + 5, len(lines))):
            match = re.search(r'(\w+)\s*\([^)]*\)', lines[i])
            if match and match.group(1) not in ("if", "for", "while", "switch", "catch"):
                return match.group(1)
        return None

    def _find_return_type(self, lines: list, start_idx: int) -> Optional[str]:
        """查找返回类型。"""
        for i in range(start_idx, min(start_idx + 5, len(lines))):
            match = re.search(r'public\s+(\w+(?:<[^>]+>)?)\s+\w+\s*\(', lines[i])
            if match:
                return match.group(1)
        return None

    def _find_class_end(self, lines: list, start_idx: int) -> int:
        """找到类的结束位置。"""
        depth = 0
        for i in range(start_idx, len(lines)):
            depth += lines[i].count("{") - lines[i].count("}")
            if depth == 0 and "{" in "".join(lines[start_idx:i + 1]):
                return i
        return len(lines)

    def _derive_bean_name(self, class_name: str) -> str:
        """推导 Bean 名称（首字母小写）。"""
        if not class_name:
            return ""
        return class_name[0].lower() + class_name[1:]

    def _extract_qualifiers(self, lines: list, start_idx: int) -> list:
        """提取 @Qualifier。"""
        qualifiers = []
        for i in range(max(0, start_idx - 5), start_idx + 1):
            match = re.search(r'@Qualifier\s*\(\s*"([^"]+)"\s*\)', lines[i])
            if match:
                qualifiers.append(match.group(1))
        return qualifiers

    def _extract_scope(self, lines: list, start_idx: int) -> str:
        """提取 @Scope。"""
        for i in range(max(0, start_idx - 5), start_idx + 1):
            match = re.search(r'@Scope\s*\(\s*"([^"]+)"\s*\)', lines[i])
            if match:
                return match.group(1)
            match = re.search(r'@Scope\s*\(\s*ConfigurableBeanFactory\.(\w+)', lines[i])
            if match:
                return match.group(1).lower()
        return "singleton"

    def _has_annotation(self, lines: list, start_idx: int, annotation: str) -> bool:
        """检查是否有指定注解。"""
        for i in range(max(0, start_idx - 5), start_idx + 1):
            if f"@{annotation}" in lines[i]:
                return True
        return False

    def _extract_profile(self, lines: list, start_idx: int) -> Optional[str]:
        """提取 @Profile。"""
        for i in range(max(0, start_idx - 5), start_idx + 1):
            match = re.search(r'@Profile\s*\(\s*"([^"]+)"\s*\)', lines[i])
            if match:
                return match.group(1)
        return None

    def _extract_request_mapping(self, lines: list, start_idx: int) -> str:
        """提取 @RequestMapping 路径。"""
        for i in range(max(0, start_idx - 5), start_idx + 1):
            match = re.search(r'@RequestMapping\s*\([^)]*value\s*=\s*"([^"]+)"', lines[i])
            if match:
                return match.group(1)
            match = re.search(r'@RequestMapping\s*\(\s*"([^"]+)"\s*\)', lines[i])
            if match:
                return match.group(1)
        return ""

    def _extract_path_from_mapping(self, line: str, annotation: str) -> str:
        """从映射注解提取路径。"""
        # @GetMapping("/users")
        match = re.search(rf'@{annotation}\s*\(\s*"([^"]+)"\s*\)', line)
        if match:
            return match.group(1)

        # @GetMapping(value = "/users")
        match = re.search(rf'@{annotation}\s*\([^)]*value\s*=\s*"([^"]+)"', line)
        if match:
            return match.group(1)

        # @GetMapping(path = "/users")
        match = re.search(rf'@{annotation}\s*\([^)]*path\s*=\s*"([^"]+)"', line)
        if match:
            return match.group(1)

        return ""

    def _extract_method_from_mapping(self, line: str) -> Optional[str]:
        """从 @RequestMapping 提取 HTTP 方法。"""
        match = re.search(r'method\s*=\s*RequestMethod\.(\w+)', line)
        if match:
            return match.group(1)
        return None

    def _extract_method_info(self, lines: list, line_idx: int) -> Optional[dict]:
        """提取方法信息。"""
        for i in range(line_idx, min(line_idx + 3, len(lines))):
            line = lines[i]

            # 匹配方法签名
            match = re.search(
                r'(?:public|private|protected)?\s*'
                r'(?:static\s+)?'
                r'(\w+(?:<[^>]+>)?(?:\[\])?)\s+'
                r'(\w+)\s*\(([^)]*)\)',
                line
            )
            if match:
                return_type = match.group(1)
                method_name = match.group(2)
                params_str = match.group(3)

                parameters = []
                if params_str.strip():
                    for param in self._split_params(params_str):
                        param = param.strip()
                        parts = param.split()
                        if len(parts) >= 2:
                            parameters.append({
                                "type": parts[-2],
                                "name": parts[-1],
                            })

                return {
                    "name": method_name,
                    "return_type": return_type,
                    "parameters": parameters,
                    "annotations": [],  # TODO
                }

        return None

    def _extract_class_annotations(self, lines: list, start_idx: int) -> list:
        """提取类上的注解。"""
        annotations = []
        for i in range(max(0, start_idx - 10), start_idx):
            match = re.match(r'@(\w+)', lines[i].strip())
            if match:
                annotations.append(match.group(1))
        return annotations

    def _split_params(self, params_str: str) -> list:
        """分割参数列表（处理泛型）。"""
        params = []
        current = ""
        depth = 0

        for char in params_str:
            if char == "<":
                depth += 1
            elif char == ">":
                depth -= 1
            elif char == "," and depth == 0:
                params.append(current)
                current = ""
                continue
            current += char

        if current.strip():
            params.append(current)

        return params
