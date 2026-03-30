"""流程分析 Agent。

负责发现和分析项目中的业务流程：
- 业务用例流程
- 事务流程
- 审批流程
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


class FlowAgent(DomainAgent):
    """流程分析 Agent。

    职责：
    1. 发现项目中的业务流程（通过入口点如 Controller 方法）
    2. 分析流程步骤和调用链
    3. 识别事务边界
    4. 构建流程图

    输出：
    - Flow 节点
    - FlowNode 节点
    - flow_step 边
    - triggers 边
    """

    # 流程入口模式
    ENTRY_PATTERNS = [
        "**/controller/**/*.java",
        "**/controllers/**/*.java",
        "**/api/**/*.java",
        "**/facade/**/*.java",
    ]

    # 流程关键词
    FLOW_KEYWORDS = [
        "create", "update", "delete", "process", "submit", "approve",
        "register", "login", "checkout", "order", "pay", "send",
    ]

    def __init__(self, context: AgentContext):
        super().__init__(context)
        self._entry_files: list[str] = []
        self._discovered_flows: dict[str, dict] = {}

    # ═══════════════════════════════════════════════════════════════
    # Phase 1: Discovery
    # ═══════════════════════════════════════════════════════════════

    def discover(self) -> list[dict]:
        """发现潜在的流程入口。"""
        targets = []

        # 1. 从 Controller 发现入口
        for pattern in self.ENTRY_PATTERNS:
            result = self.call_tool("find_files", pattern=pattern.replace("**/", ""))
            if result.get("success"):
                for file_path in result.get("files", []):
                    if self._is_entry_file(file_path):
                        # 提取入口方法
                        entry_methods = self._extract_entry_methods(file_path)
                        for method in entry_methods:
                            targets.append({
                                "target_id": f"{file_path}:{method['name']}",
                                "target_type": "flow_entry",
                                "file_path": file_path,
                                "hints": {
                                    "method_name": method["name"],
                                    "http_method": method.get("http_method"),
                                    "path": method.get("path"),
                                },
                            })

        # 2. 从已分析的服务中发现
        services = self.get_shared_knowledge("service", default={})
        for service_name, service_data in services.items() if isinstance(services, dict) else []:
            file_path = service_data.get("file_path")
            if file_path:
                # 检查是否有流程入口方法
                methods = self._find_flow_methods(file_path)
                for method in methods:
                    targets.append({
                        "target_id": f"{file_path}:{method}",
                        "target_type": "flow_entry",
                        "file_path": file_path,
                        "hints": {"method_name": method},
                    })

        self._entry_files = list({t["file_path"] for t in targets})
        logger.info("[FlowAgent] 发现 %d 个流程入口", len(targets))

        return targets

    def _is_entry_file(self, file_path: str) -> bool:
        """判断是否为入口文件。"""
        if "test" in file_path.lower():
            return False

        result = self.call_tool("read_file", path=file_path, max_size=65536)
        if not result.get("success"):
            return False

        content = result["content"]

        # 检查是否有入口注解
        entry_annotations = [
            "@GetMapping", "@PostMapping", "@PutMapping", "@DeleteMapping",
            "@RequestMapping", "@PatchMapping",
        ]

        return any(ann in content for ann in entry_annotations)

    def _extract_entry_methods(self, file_path: str) -> list[dict]:
        """提取入口方法。"""
        methods = []

        result = self.call_tool("spring_http_mapping", path=file_path)
        if result.get("success"):
            for controller in result.get("controllers", []):
                for endpoint in controller.get("methods", []):
                    method_name = endpoint.get("method_name")
                    if method_name:
                        # 检查方法名是否暗示业务流程
                        if self._is_flow_method(method_name):
                            methods.append({
                                "name": method_name,
                                "http_method": endpoint.get("http_method"),
                                "path": endpoint.get("path"),
                            })

        return methods

    def _find_flow_methods(self, file_path: str) -> list[str]:
        """查找流程方法。"""
        methods = []

        # 提取所有方法
        classes_result = self.call_tool("extract_classes", path=file_path)
        if not classes_result.get("success"):
            return methods

        for cls in classes_result.get("classes", []):
            methods_result = self.call_tool(
                "extract_methods",
                path=file_path,
                class_name=cls["name"],
            )
            if methods_result.get("success"):
                for method in methods_result.get("methods", []):
                    if self._is_flow_method(method["name"]):
                        methods.append(method["name"])

        return methods

    def _is_flow_method(self, method_name: str) -> bool:
        """判断是否为流程方法。"""
        lower_name = method_name.lower()

        # 检查关键词
        for keyword in self.FLOW_KEYWORDS:
            if keyword in lower_name:
                return True

        return False

    # ═══════════════════════════════════════════════════════════════
    # Phase 2: Analysis
    # ═══════════════════════════════════════════════════════════════

    def analyze(self, target: dict) -> AgentResult:
        """分析单个流程入口。"""
        file_path = target["file_path"]
        hints = target.get("hints", {})
        method_name = hints.get("method_name")

        result = AgentResult(agent_name=self.name)

        if not method_name:
            return result

        # 创建 Flow 节点
        flow_id = f"flow:{method_name}"
        flow_name = self._generate_flow_name(method_name, hints)

        flow_node = GraphNode(
            id=flow_id,
            type=NodeType.FLOW.value,
            name=flow_name,
            properties={
                "entry_file": file_path,
                "entry_method": method_name,
                "http_method": hints.get("http_method"),
                "api_path": hints.get("path"),
            },
        )
        result.nodes.append(flow_node)

        # 追踪调用链
        call_chain = self._trace_call_chain(file_path, method_name)

        # 创建流程步骤节点
        prev_step_id = None
        for i, step in enumerate(call_chain):
            step_id = f"flownode:{method_name}:{i}"

            step_node = GraphNode(
                id=step_id,
                type=NodeType.FLOW_NODE.value,
                name=step.get("method", f"step_{i}"),
                properties={
                    "step_index": i,
                    "file_path": step.get("file_path"),
                    "class_name": step.get("class_name"),
                    "method_name": step.get("method"),
                    "type": step.get("type", "method_call"),
                },
            )
            result.nodes.append(step_node)

            # 创建 flow_step 边
            if prev_step_id:
                step_edge = GraphEdge(
                    from_=prev_step_id,
                    to=step_id,
                    type=EdgeType.FLOW_STEP.value,
                    properties={},
                )
                result.edges.append(step_edge)
            else:
                # 第一步：从 Flow 到 FlowNode
                entry_edge = GraphEdge(
                    from_=flow_id,
                    to=step_id,
                    type=EdgeType.TRIGGERS.value,
                    properties={},
                )
                result.edges.append(entry_edge)

            prev_step_id = step_id

        # 存储流程信息
        self._discovered_flows[method_name] = {
            "flow_id": flow_id,
            "entry_file": file_path,
            "call_chain": call_chain,
        }

        # 发布到知识中心
        self.set_shared_knowledge(
            f"flow:{method_name}",
            {"flow_id": flow_id, "name": flow_name},
            confidence=0.85,
        )

        result.confidence = 0.85 if call_chain else 0.6
        return result

    def _generate_flow_name(self, method_name: str, hints: dict) -> str:
        """生成流程名称。"""
        # 尝试从方法名生成
        # createUser -> Create User
        # processOrder -> Process Order
        name = re.sub(r'([A-Z])', r' \1', method_name)
        name = name[0].upper() + name[1:]

        # 如果有 API 路径，添加到名称中
        path = hints.get("path")
        if path:
            name = f"{name} ({path})"

        return name

    def _trace_call_chain(self, file_path: str, method_name: str) -> list[dict]:
        """追踪调用链。"""
        call_chain = []

        # 读取方法体
        classes_result = self.call_tool("extract_classes", path=file_path)
        if not classes_result.get("success"):
            return call_chain

        for cls in classes_result.get("classes", []):
            # 提取方法
            methods_result = self.call_tool(
                "extract_methods",
                path=file_path,
                class_name=cls["name"],
            )

            if methods_result.get("success"):
                for method in methods_result.get("methods", []):
                    if method["name"] == method_name:
                        # 分析方法调用
                        calls = self._extract_method_calls(file_path, method)
                        call_chain.extend(calls)

        # 限制深度
        max_depth = 10
        if len(call_chain) > max_depth:
            call_chain = call_chain[:max_depth]

        return call_chain

    def _extract_method_calls(self, file_path: str, method_info: dict) -> list[dict]:
        """提取方法内的调用。"""
        calls = []

        # 读取方法体
        start_line = method_info.get("line_start", 1)
        end_line = method_info.get("line_end", start_line + 50)

        lines_result = self.call_tool(
            "read_lines",
            path=file_path,
            start_line=start_line,
            end_line=end_line,
        )

        if not lines_result.get("success"):
            return calls

        content = lines_result.get("content", "")

        # 提取方法调用模式
        # service.method(), repository.save(), etc.
        call_pattern = r'(\w+)\.(\w+)\s*\('

        for match in re.finditer(call_pattern, content):
            obj_name = match.group(1)
            method = match.group(2)

            # 排除常见的关键字
            if obj_name in ["this", "super", "log", "logger", "String", "Integer"]:
                continue

            calls.append({
                "type": "method_call",
                "object": obj_name,
                "method": method,
                "file_path": file_path,
            })

        return calls

    # ═══════════════════════════════════════════════════════════════
    # Phase 3: Validate
    # ═══════════════════════════════════════════════════════════════

    def validate(self, result: AgentResult) -> tuple[bool, list[dict]]:
        """验证分析结果。"""
        issues = []
        is_valid = True

        node_ids = {n.id for n in result.nodes}

        # 验证 Flow 节点
        for node in result.nodes:
            if node.type == NodeType.FLOW.value:
                issue = self._validate_required_fields(node, ["name"])
                if issue:
                    issues.append(issue)
                    is_valid = False

                # 检查是否有流程步骤
                has_steps = any(
                    e.from_ == node.id and e.type == EdgeType.TRIGGERS.value
                    for e in result.edges
                )
                if not has_steps:
                    issues.append({
                        "type": "empty_flow",
                        "severity": "medium",
                        "message": f"流程 {node.name} 没有任何步骤",
                        "suggestion": "检查方法体内的调用或增加分析深度",
                    })

            elif node.type == NodeType.FLOW_NODE.value:
                # 检查步骤信息
                method_name = node.properties.get("method_name")
                if not method_name:
                    issues.append({
                        "type": "missing_method",
                        "severity": "low",
                        "message": f"流程步骤 {node.name} 缺少方法信息",
                    })

        # 验证边的引用
        for edge in result.edges:
            if edge.type in [EdgeType.FLOW_STEP.value, EdgeType.TRIGGERS.value]:
                if edge.from_ not in node_ids or edge.to not in node_ids:
                    issues.append({
                        "type": "broken_reference",
                        "severity": "high",
                        "message": f"流程边引用无效节点",
                    })
                    is_valid = False

        return is_valid, issues
