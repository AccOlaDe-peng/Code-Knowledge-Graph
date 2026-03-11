"""
调用图构建器模块。

输入：
    ComponentGraph  —— 提供 Function / Component GraphNode 节点
    ParseResult     —— 提供 ParsedFunction.calls 调用关系

输出（CallGraph）：
    function_calls  —— Function   --calls-->  Function
    service_calls   —— Component  --calls-->  Component  (跨 Service 调用)
    api_calls       —— Function   --calls-->  Component  (API endpoint 调用 Service)

识别策略：
    - Function→Function 通过名称索引解析（qualified 优先，单名次之）
    - Service→Service  当两个 Function 分属不同 Component 且调用发生时提升
    - API→Service      当 caller function 是 API 入口（路由装饰器 / API 文件）
                       且 callee component 是 service 时产生
"""

from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from backend.analyzer.component_detector import ComponentGraph
from backend.graph.graph_schema import EdgeType, GraphEdge, GraphNode, NodeType
from backend.parser.code_parser import ParsedCall, ParsedFile, ParsedFunction, ParseResult

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# API detection vocabulary
# ---------------------------------------------------------------------------

# 含有这些片段的装饰器 → 视为 API 入口
_API_DECORATOR_PATTERNS: frozenset[str] = frozenset({
    # Flask / Quart
    "route", ".get", ".post", ".put", ".delete", ".patch",
    # FastAPI / Starlette
    "router.get", "router.post", "router.put", "router.delete",
    "app.get", "app.post", "app.put", "app.delete",
    # Spring (Java)
    "getmapping", "postmapping", "putmapping", "deletemapping", "requestmapping",
    # NestJS / TypeScript decorators
    "Get", "Post", "Put", "Delete", "Patch", "Controller",
    # Django REST Framework
    "api_view", "action",
})

# 文件名（stem，小写）匹配 → 该文件中所有函数都视为 API 入口
_API_FILE_STEMS: frozenset[str] = frozenset({
    "api", "routes", "router", "views", "endpoints",
    "controllers", "handlers",
})

# 被调用方为 service 类型时，触发 Service→Service 和 API→Service 提升
_SERVICE_COMPONENT_TYPES: frozenset[str] = frozenset({
    "service", "engine", "manager", "processor", "handler",
    "executor", "orchestrator", "coordinator",
})


# ---------------------------------------------------------------------------
# Output container
# ---------------------------------------------------------------------------


@dataclass
class CallGraph:
    """CallGraphBuilder.build() 的完整输出。

    Attributes:
        function_calls: Function → Function 调用边
        service_calls:  Component → Component 跨服务调用边
        api_calls:      Function(API) → Component(Service) 调用边
    """

    function_calls: list[GraphEdge] = field(default_factory=list)
    service_calls: list[GraphEdge] = field(default_factory=list)
    api_calls: list[GraphEdge] = field(default_factory=list)

    @property
    def edges(self) -> list[GraphEdge]:
        """所有边的合并列表。"""
        return self.function_calls + self.service_calls + self.api_calls

    @property
    def stats(self) -> dict[str, int]:
        return {
            "function_calls": len(self.function_calls),
            "service_calls":  len(self.service_calls),
            "api_calls":      len(self.api_calls),
            "total":          len(self.edges),
        }


# ---------------------------------------------------------------------------
# CallGraphBuilder
# ---------------------------------------------------------------------------


class CallGraphBuilder:
    """
    调用图构建器。

    基于 ComponentGraph（节点）和 ParseResult（调用关系）
    构建三个层次的调用边：
      Function → Function
      Service  → Service  （跨组件 service 调用提升）
      API      → Service  （API 入口调用 service 提升）

    示例::

        builder = CallGraphBuilder()
        call_graph = builder.build(component_graph, parse_result)
        print(call_graph.stats)
    """

    # ------------------------------------------------------------------
    # Public
    # ------------------------------------------------------------------

    def build(
        self,
        component_graph: ComponentGraph,
        parsed_result: ParseResult,
    ) -> CallGraph:
        """构建完整调用图。

        Args:
            component_graph: ComponentDetector 的输出，包含 Function/Component 节点。
            parsed_result:   CodeParser 的输出，包含 ParsedFunction 及其 .calls。

        Returns:
            CallGraph，包含三类调用边。
        """
        # 1. 从 ComponentGraph 建立解析索引
        indexes = self._build_indexes(component_graph)

        call_graph = CallGraph()
        seen_func: set[tuple[str, str]] = set()
        seen_comp: set[tuple[str, str]] = set()

        # 2. 遍历所有 ParsedFunction → 解析调用
        for pf in parsed_result.files:
            all_pfuncs: list[ParsedFunction] = list(pf.functions)
            for cls in pf.classes:
                all_pfuncs.extend(cls.methods)

            file_stem = Path(pf.file_path).stem.lower()
            for pfunc in all_pfuncs:
                self._process_function(
                    pfunc, pf.file_path, file_stem,
                    indexes, call_graph,
                    seen_func, seen_comp,
                )

        logger.info(
            "调用图构建完成: function=%d service=%d api=%d",
            len(call_graph.function_calls),
            len(call_graph.service_calls),
            len(call_graph.api_calls),
        )
        return call_graph

    # ------------------------------------------------------------------
    # Per-function processing
    # ------------------------------------------------------------------

    def _process_function(
        self,
        pfunc: ParsedFunction,
        file_path: str,
        file_stem: str,
        idx: "_Indexes",
        call_graph: CallGraph,
        seen_func: set[tuple[str, str]],
        seen_comp: set[tuple[str, str]],
    ) -> None:
        # 解析 caller Function 节点
        caller_node = self._resolve_caller(pfunc, idx)
        if caller_node is None:
            return

        caller_comp_id = idx.comp_by_func_id.get(caller_node.id)
        caller_is_api = self._is_api_function(pfunc, file_stem)

        for call in pfunc.calls:
            callee_node = self._resolve_callee(call, idx)
            if callee_node is None or callee_node.id == caller_node.id:
                continue

            # ---- Function → Function ----
            fkey = (caller_node.id, callee_node.id)
            if fkey not in seen_func:
                seen_func.add(fkey)
                call_graph.function_calls.append(_edge(
                    caller_node.id, callee_node.id,
                    EdgeType.CALLS.value,
                    call_line=call.line,
                    is_method_call=call.is_method_call,
                    callee_expr=call.callee,
                    caller_function=pfunc.name,
                    caller_file=file_path,
                ))

            # ---- 提升到组件级别 ----
            callee_comp_id = idx.comp_by_func_id.get(callee_node.id)
            if callee_comp_id is None or caller_comp_id == callee_comp_id:
                continue

            callee_comp = idx.comp_node_by_id.get(callee_comp_id)
            if callee_comp is None:
                continue
            callee_type = callee_comp.properties.get("component_type", "generic")
            callee_is_service = callee_type in _SERVICE_COMPONENT_TYPES

            if caller_is_api and callee_is_service:
                # API → Service
                akey = (caller_node.id, callee_comp_id)
                if akey not in seen_comp:
                    seen_comp.add(akey)
                    call_graph.api_calls.append(_edge(
                        caller_node.id, callee_comp_id,
                        EdgeType.CALLS.value,
                        relation="api_to_service",
                        api_function=pfunc.name,
                        service_component=callee_comp.name,
                        caller_file=file_path,
                    ))

            elif caller_comp_id and callee_is_service:
                # Service → Service
                caller_comp = idx.comp_node_by_id.get(caller_comp_id)
                caller_type = caller_comp.properties.get("component_type", "") if caller_comp else ""
                if caller_type in _SERVICE_COMPONENT_TYPES:
                    skey = (caller_comp_id, callee_comp_id)
                    if skey not in seen_comp:
                        seen_comp.add(skey)
                        call_graph.service_calls.append(_edge(
                            caller_comp_id, callee_comp_id,
                            EdgeType.CALLS.value,
                            relation="service_to_service",
                            caller_component=caller_comp.name if caller_comp else "",
                            callee_component=callee_comp.name,
                        ))

    # ------------------------------------------------------------------
    # Resolution helpers
    # ------------------------------------------------------------------

    def _resolve_caller(
        self, pfunc: ParsedFunction, idx: "_Indexes"
    ) -> Optional[GraphNode]:
        """将 ParsedFunction 解析到 Function GraphNode。"""
        if pfunc.parent_class:
            qualified = f"{pfunc.parent_class}.{pfunc.name}"
            node = idx.func_by_qualified.get(qualified)
            if node:
                return node
        candidates = idx.func_by_name.get(pfunc.name, [])
        # 有多个同名函数时，优先选同文件 / 同类的
        if len(candidates) == 1:
            return candidates[0]
        for c in candidates:
            if c.properties.get("parent_class") == (pfunc.parent_class or ""):
                return c
        return candidates[0] if candidates else None

    def _resolve_callee(
        self, call: ParsedCall, idx: "_Indexes"
    ) -> Optional[GraphNode]:
        """将 ParsedCall.callee 解析到 Function GraphNode。

        解析优先级：
        1. qualified 精确匹配（e.g. "UserService.get_user"）
        2. 根据 receiver 推断 class 名后再 qualified 匹配
        3. 方法名单独查找（仅当唯一时）
        """
        callee = call.callee

        # 1. 直接 qualified 命中
        node = idx.func_by_qualified.get(callee)
        if node:
            return node

        if "." in callee:
            parts = callee.split(".")
            method_name = parts[-1]
            receiver = parts[-2]  # 最近的接收者

            # 2. 将 receiver 转换为 PascalCase 类名后尝试 qualified
            pascal = _to_pascal(receiver)
            node = idx.func_by_qualified.get(f"{pascal}.{method_name}")
            if node:
                return node

            # 3. 通过 component name 索引查找
            comp = idx.comp_by_name.get(pascal) or idx.comp_by_name.get(receiver)
            if comp:
                node = idx.func_by_qualified.get(f"{comp.name}.{method_name}")
                if node:
                    return node

            # 4. 简单名称（方法名）唯一时匹配
            candidates = idx.func_by_name.get(method_name, [])
            if len(candidates) == 1:
                return candidates[0]
        else:
            candidates = idx.func_by_name.get(callee, [])
            if len(candidates) == 1:
                return candidates[0]

        return None

    # ------------------------------------------------------------------
    # API detection
    # ------------------------------------------------------------------

    def _is_api_function(self, pfunc: ParsedFunction, file_stem: str) -> bool:
        """判断函数是否为 API 入口（路由处理器 / 控制器方法）。"""
        # 按装饰器判断
        for dec in pfunc.decorators:
            dec_lower = dec.lower()
            for pattern in _API_DECORATOR_PATTERNS:
                if pattern.lower() in dec_lower:
                    return True
        # 按文件名判断
        return file_stem in _API_FILE_STEMS

    # ------------------------------------------------------------------
    # Index builder
    # ------------------------------------------------------------------

    def _build_indexes(self, cg: ComponentGraph) -> "_Indexes":
        """从 ComponentGraph 构建所有解析索引。"""
        func_by_name: dict[str, list[GraphNode]] = defaultdict(list)
        func_by_qualified: dict[str, GraphNode] = {}

        for fn in cg.functions:
            name = fn.name
            parent = fn.properties.get("parent_class", "")
            func_by_name[name].append(fn)
            if parent:
                func_by_qualified[f"{parent}.{name}"] = fn
            else:
                func_by_qualified[name] = fn

        # func_id → comp_id（从 contains 边反向）
        comp_ids: set[str] = {c.id for c in cg.components}
        comp_by_func_id: dict[str, str] = {}
        for edge in cg.edges:
            if edge.from_ in comp_ids and edge.type == EdgeType.CONTAINS.value:
                comp_by_func_id[edge.to] = edge.from_

        comp_node_by_id: dict[str, GraphNode] = {c.id: c for c in cg.components}
        comp_by_name: dict[str, GraphNode] = {c.name: c for c in cg.components}

        return _Indexes(
            func_by_name=dict(func_by_name),
            func_by_qualified=func_by_qualified,
            comp_by_func_id=comp_by_func_id,
            comp_node_by_id=comp_node_by_id,
            comp_by_name=comp_by_name,
        )


# ---------------------------------------------------------------------------
# Internal data structures
# ---------------------------------------------------------------------------


@dataclass
class _Indexes:
    """内部解析索引，仅在 build() 期间使用。"""

    func_by_name: dict[str, list[GraphNode]]
    """函数名 → Function 节点列表（同名函数可能来自不同类）"""

    func_by_qualified: dict[str, GraphNode]
    """限定名（ClassName.method 或 plain_name）→ Function 节点"""

    comp_by_func_id: dict[str, str]
    """Function 节点 ID → 所属 Component 节点 ID"""

    comp_node_by_id: dict[str, GraphNode]
    """Component 节点 ID → Component 节点"""

    comp_by_name: dict[str, GraphNode]
    """Component 名称 → Component 节点（用于 receiver 推断）"""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _edge(from_id: str, to_id: str, edge_type: str, **properties) -> GraphEdge:
    return GraphEdge(**{
        "from": from_id,
        "to": to_id,
        "type": edge_type,
        "properties": properties,
    })


def _to_pascal(snake: str) -> str:
    """将 snake_case / camelCase receiver 转为 PascalCase 类名猜测。

    Examples:
        user_service  → UserService
        userService   → UserService
        self          → (skip)
    """
    if snake in ("self", "cls", "this"):
        return ""
    # Already PascalCase
    if snake[0].isupper():
        return snake
    # snake_case → PascalCase
    return "".join(word.capitalize() for word in snake.split("_"))
