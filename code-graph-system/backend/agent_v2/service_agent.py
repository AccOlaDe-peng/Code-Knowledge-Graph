"""服务分析 Agent。

负责发现和分析项目中的服务类：
- Spring Service (@Service)
- REST Controller (@RestController)
- 业务逻辑层
"""

from __future__ import annotations

import logging
import re
from typing import Any, Optional

from backend.agent_v2.base_agent import (
    AgentContext,
    AgentResult,
    DomainAgent,
)
from backend.graph.graph_schema import GraphEdge, GraphNode, NodeType, EdgeType

logger = logging.getLogger(__name__)


class ServiceAgent(DomainAgent):
    """服务分析 Agent。

    职责：
    1. 发现项目中的服务类（@Service, @Component, @RestController）
    2. 分析依赖注入关系
    3. 提取 API 端点信息
    4. 分析服务间的调用关系

    输出：
    - Service 节点
    - APIEndpoint 节点
    - depends_on 边
    - defines 边
    - routes_to 边
    """

    # 目标文件模式
    SERVICE_PATTERNS = [
        "**/service/**/*.java",
        "**/services/**/*.java",
        "**/controller/**/*.java",
        "**/controllers/**/*.java",
        "**/api/**/*.java",
    ]

    # 服务注解标记
    SERVICE_ANNOTATIONS = [
        "@Service",
        "@Component",
        "@RestController",
        "@Controller",
    ]

    def __init__(self, context: AgentContext):
        super().__init__(context)
        self._service_files: list[str] = []
        self._analyzed_services: dict[str, dict] = {}

    # ═══════════════════════════════════════════════════════════════
    # Phase 1: Discovery
    # ═══════════════════════════════════════════════════════════════

    def discover(self) -> list[dict]:
        """发现项目中的服务文件。"""
        targets = []

        # 1. 按目录模式搜索
        for pattern in self.SERVICE_PATTERNS:
            result = self.call_tool("find_files", pattern=pattern.replace("**/", ""))
            if result.get("success"):
                for file_path in result.get("files", []):
                    if self._is_service_file(file_path):
                        targets.append({
                            "target_id": file_path,
                            "target_type": "service_file",
                            "file_path": file_path,
                            "hints": {"source": "directory_pattern"},
                        })

        # 2. 搜索服务注解
        for annotation in self.SERVICE_ANNOTATIONS:
            search_result = self.call_tool(
                "search_code",
                pattern=annotation,
                file_pattern="*.java",
                context_lines=2,
                max_results=50,
            )

            if search_result.get("success"):
                seen_files = {t["file_path"] for t in targets}
                for match in search_result.get("results", []):
                    file_path = match["file_path"]
                    if file_path not in seen_files:
                        targets.append({
                            "target_id": file_path,
                            "target_type": "service_file",
                            "file_path": file_path,
                            "hints": {"source": "annotation_search", "annotation": annotation},
                        })
                        seen_files.add(file_path)

        self._service_files = [t["file_path"] for t in targets]
        logger.info("[ServiceAgent] 发现 %d 个服务文件", len(targets))

        return targets

    def _is_service_file(self, file_path: str) -> bool:
        """判断是否为服务文件。"""
        # 排除测试文件
        if "test" in file_path.lower() or "Test" in file_path:
            return False

        # 读取文件内容检查
        result = self.call_tool("read_file", path=file_path, max_size=65536)
        if not result.get("success"):
            return False

        content = result["content"]

        # 检查是否有服务注解
        for ann in self.SERVICE_ANNOTATIONS:
            if ann in content:
                return True

        return False

    # ═══════════════════════════════════════════════════════════════
    # Phase 2: Analysis
    # ═══════════════════════════════════════════════════════════════

    def analyze(self, target: dict) -> AgentResult:
        """分析单个服务文件。"""
        file_path = target["file_path"]
        result = AgentResult(agent_name=self.name)

        # 读取文件内容
        read_result = self.call_tool("read_file", path=file_path)
        if not read_result.get("success"):
            result.issues.append({
                "type": "file_read_error",
                "severity": "high",
                "message": f"无法读取文件: {file_path}",
            })
            return result

        content = read_result["content"]

        # 判断服务类型
        is_controller = "@RestController" in content or "@Controller" in content
        is_service = "@Service" in content

        # 提取类信息
        classes_result = self.call_tool("extract_classes", path=file_path)
        if not classes_result.get("success"):
            return result

        for cls in classes_result.get("classes", []):
            if is_controller:
                # 分析 Controller
                controller_result = self._analyze_controller(cls, file_path, content)
                result.nodes.extend(controller_result["nodes"])
                result.edges.extend(controller_result["edges"])

            if is_service or not is_controller:
                # 分析 Service
                service_result = self._analyze_service(cls, file_path, content)
                result.nodes.extend(service_result["nodes"])
                result.edges.extend(service_result["edges"])

        result.confidence = 0.9 if is_controller or is_service else 0.7
        return result

    def _analyze_service(
        self,
        class_info: dict,
        file_path: str,
        content: str,
    ) -> dict:
        """分析服务类。"""
        nodes = []
        edges = []

        class_name = class_info["name"]
        service_id = f"service:{class_name}"

        # 创建 Service 节点
        service_node = GraphNode(
            id=service_id,
            type=NodeType.SERVICE.value,
            name=class_name,
            properties={
                "file_path": file_path,
                "type": "service",
                "modifiers": class_info.get("modifiers", []),
            },
        )
        nodes.append(service_node)

        # 分析依赖注入
        di_result = self.call_tool(
            "spring_di_resolver",
            path=file_path,
            class_name=class_name,
        )

        if di_result.get("success"):
            for dep in di_result.get("dependencies", []):
                dep_type = dep.get("type")
                if dep_type:
                    dep_id = f"service:{dep_type}"

                    # 创建依赖边
                    dep_edge = GraphEdge(
                        from_=service_id,
                        to=dep_id,
                        type=EdgeType.DEPENDS_ON.value,
                        properties={
                            "field_name": dep.get("name"),
                            "injection_type": dep.get("injection_type"),
                        },
                    )
                    edges.append(dep_edge)

        # 提取方法信息
        methods_result = self.call_tool(
            "extract_methods",
            path=file_path,
            class_name=class_name,
        )

        if methods_result.get("success"):
            for method in methods_result.get("methods", []):
                # 检查是否为事务方法
                is_transactional = any(
                    ann.get("name") == "Transactional"
                    for ann in method.get("annotations", [])
                )

                if is_transactional:
                    # 更新服务节点属性
                    if "transactional_methods" not in service_node.properties:
                        service_node.properties["transactional_methods"] = []
                    service_node.properties["transactional_methods"].append(method["name"])

        # 存储分析结果
        self._analyzed_services[class_name] = {
            "file_path": file_path,
            "dependencies": di_result.get("dependencies", []) if di_result.get("success") else [],
        }

        # 发布到知识中心
        self.set_shared_knowledge(
            f"service:{class_name}",
            {"file_path": file_path, "name": class_name},
            confidence=0.9,
        )

        return {"nodes": nodes, "edges": edges}

    def _analyze_controller(
        self,
        class_info: dict,
        file_path: str,
        content: str,
    ) -> dict:
        """分析 Controller 类。"""
        nodes = []
        edges = []

        class_name = class_info["name"]
        service_id = f"service:{class_name}"

        # 提取基础路径
        base_path = self._extract_base_path(content)

        # 创建 Service 节点（Controller 也是 Service）
        service_node = GraphNode(
            id=service_id,
            type=NodeType.SERVICE.value,
            name=class_name,
            properties={
                "file_path": file_path,
                "type": "controller",
                "base_path": base_path,
                "modifiers": class_info.get("modifiers", []),
            },
        )
        nodes.append(service_node)

        # 提取 API 端点
        controllers_result = self.call_tool("spring_http_mapping", path=file_path)

        if controllers_result.get("success"):
            for controller in controllers_result.get("controllers", []):
                for endpoint in controller.get("methods", []):
                    # 创建 APIEndpoint 节点
                    endpoint_id = f"api:{class_name}.{endpoint['method_name']}"

                    full_path = self._combine_paths(base_path, endpoint.get("path", ""))

                    endpoint_node = GraphNode(
                        id=endpoint_id,
                        type=NodeType.API_ENDPOINT.value,
                        name=endpoint["method_name"],
                        properties={
                            "http_method": endpoint.get("http_method", "GET"),
                            "path": full_path,
                            "return_type": endpoint.get("return_type"),
                            "parameters": endpoint.get("parameters", []),
                        },
                    )
                    nodes.append(endpoint_node)

                    # 创建 defines 边
                    define_edge = GraphEdge(
                        from_=service_id,
                        to=endpoint_id,
                        type=EdgeType.DEFINES.value,
                        properties={},
                    )
                    edges.append(define_edge)

        # 分析依赖注入
        di_result = self.call_tool(
            "spring_di_resolver",
            path=file_path,
            class_name=class_name,
        )

        if di_result.get("success"):
            for dep in di_result.get("dependencies", []):
                dep_type = dep.get("type")
                if dep_type:
                    dep_id = f"service:{dep_type}"

                    dep_edge = GraphEdge(
                        from_=service_id,
                        to=dep_id,
                        type=EdgeType.DEPENDS_ON.value,
                        properties={
                            "field_name": dep.get("name"),
                            "injection_type": dep.get("injection_type"),
                        },
                    )
                    edges.append(dep_edge)

        return {"nodes": nodes, "edges": edges}

    def _extract_base_path(self, content: str) -> str:
        """提取 Controller 基础路径。"""
        match = re.search(r'@RequestMapping\s*\(\s*"([^"]+)"\s*\)', content)
        if match:
            return match.group(1)

        match = re.search(r'@RequestMapping\s*\([^)]*value\s*=\s*"([^"]+)"', content)
        if match:
            return match.group(1)

        return ""

    def _combine_paths(self, base: str, path: str) -> str:
        """合并路径。"""
        base = base.rstrip("/")
        path = path.lstrip("/")
        if base and path:
            return f"{base}/{path}"
        return base or path or "/"

    # ═══════════════════════════════════════════════════════════════
    # Phase 3: Validate
    # ═══════════════════════════════════════════════════════════════

    def validate(self, result: AgentResult) -> tuple[bool, list[dict]]:
        """验证分析结果。"""
        issues = []
        is_valid = True

        node_ids = {n.id for n in result.nodes}

        for node in result.nodes:
            if node.type == NodeType.SERVICE.value:
                # 检查必填字段
                issue = self._validate_required_fields(node, ["name"])
                if issue:
                    issues.append(issue)
                    is_valid = False

            elif node.type == NodeType.API_ENDPOINT.value:
                # 检查 API 端点
                path = node.properties.get("path", "")
                if not path:
                    issues.append({
                        "type": "missing_path",
                        "severity": "high",
                        "message": f"API 端点 {node.name} 缺少路径定义",
                        "suggestion": "检查 @RequestMapping 或 @GetMapping 等注解",
                    })

                http_method = node.properties.get("http_method", "")
                if not http_method:
                    issues.append({
                        "type": "missing_http_method",
                        "severity": "medium",
                        "message": f"API 端点 {node.name} 缺少 HTTP 方法",
                    })

        # 验证依赖边
        for edge in result.edges:
            if edge.type == EdgeType.DEPENDS_ON.value:
                # 目标服务可能还未分析
                if edge.to not in node_ids:
                    issues.append({
                        "type": "pending_dependency",
                        "severity": "low",
                        "message": f"依赖的服务待验证: {edge.to}",
                    })

        return is_valid, issues
