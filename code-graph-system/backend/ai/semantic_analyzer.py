"""
语义分析器模块。

使用 LLM 对代码进行深度语义理解，识别四类节点：
    - Component  技术组件（Parser、Builder、Repository、Validator 等）
    - Service    业务服务（UserService、OrderEngine、PaymentGateway 等）
    - Domain     业务领域分组（user、order、payment 等 bounded context）
    - API        接口层（Router、Controller、View、Endpoint 等）

处理流程：
    1. 按文件批量提取类信息（名称、方法、装饰器、基类、文档字符串）
    2. 每批调用 LLM，获得 role / description / domain 标注
    3. 按 domain 字段聚合，创建 Domain 节点
    4. 建立 Domain --contains--> Component/Service/API 边

输出（SemanticGraph）：
    components: Component GraphNode 列表
    services:   Service  GraphNode 列表
    domains:    Domain   GraphNode 列表（NodeType=MODULE，semantic_role=domain）
    apis:       API      GraphNode 列表
    edges:      contains 边列表

降级策略（LLM 不可用时）：
    - 后缀规则  → Service（*Service/*Engine 等）
    - 装饰器    → API（router.*、app.route 等）
    - 其余      → Component
    - 跳过 Domain 节点创建
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Optional

from backend.ai.llm_client import LLMClient, get_default_client
from backend.analyzer.component_detector import ComponentGraph
from backend.graph.graph_schema import EdgeType, GraphEdge, GraphNode, NodeType
from backend.parser.code_parser import ParsedClass, ParsedFile, ParseResult

logger = logging.getLogger(__name__)

# LLM 每次调用最多处理的类数量（控制 prompt token 量）
_BATCH_SIZE = 12

# 已知 Service 后缀（降级用）
_SERVICE_SUFFIXES: frozenset[str] = frozenset({
    "Service", "Engine", "Manager", "Coordinator", "Orchestrator",
    "Gateway", "Facade", "UseCase",
})
# 已知 API 装饰器片段（降级用）
_API_DECORATOR_HINTS: frozenset[str] = frozenset({
    "router.", "app.get", "app.post", "app.put", "app.delete", "app.patch",
    "app.route", "app.api_route", "bp.route", "blueprint",
    "get_mapping", "post_mapping", "request_mapping",
})
# 已知 API 类名片段（降级用）
_API_CLASS_HINTS: frozenset[str] = frozenset({
    "Controller", "Router", "View", "ViewSet", "Endpoint",
    "Resource", "Blueprint",
})


# ---------------------------------------------------------------------------
# Internal data structures
# ---------------------------------------------------------------------------


@dataclass
class _ClassRecord:
    """单个类的分类结果（LLM 输出或降级推断）。"""
    class_name: str
    file_path: str
    role: str          # "service" | "component" | "api" | "other"
    description: str = ""
    domain: str = ""   # 业务域名（英文，如 user / order / payment）
    responsibilities: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Output container
# ---------------------------------------------------------------------------


@dataclass
class SemanticGraph:
    """SemanticAnalyzer.analyze() 的完整输出。

    Attributes:
        components: Component 节点列表（技术组件）
        services:   Service 节点列表（业务服务）
        domains:    Domain 节点列表（NodeType=MODULE，semantic_role=domain）
        apis:       API 节点列表（接口层）
        edges:      Domain --contains--> * 边列表
    """

    components: list[GraphNode] = field(default_factory=list)
    services:   list[GraphNode] = field(default_factory=list)
    domains:    list[GraphNode] = field(default_factory=list)
    apis:       list[GraphNode] = field(default_factory=list)
    edges:      list[GraphEdge] = field(default_factory=list)

    # 内部索引（不参与序列化）
    _node_by_class:  dict[str, GraphNode] = field(default_factory=dict, repr=False)
    _domain_by_name: dict[str, GraphNode] = field(default_factory=dict, repr=False)

    @property
    def all_nodes(self) -> list[GraphNode]:
        return self.components + self.services + self.domains + self.apis

    @property
    def stats(self) -> dict[str, int]:
        return {
            "components": len(self.components),
            "services":   len(self.services),
            "domains":    len(self.domains),
            "apis":       len(self.apis),
            "edges":      len(self.edges),
        }


# ---------------------------------------------------------------------------
# SemanticAnalyzer
# ---------------------------------------------------------------------------


class SemanticAnalyzer:
    """
    代码语义分析器。

    使用 LLM 对类进行角色分类和语义标注，输出 Component / Service /
    Domain / API 四类 GraphNode。

    示例::

        analyzer = SemanticAnalyzer()
        sg = analyzer.analyze(parsed_result, component_graph)
        print(sg.stats)
    """

    def __init__(self, llm_client: Optional[LLMClient] = None) -> None:
        """
        Args:
            llm_client: LLM 客户端实例，None 则使用 get_default_client()。
                        若客户端不可用，自动降级为启发式规则。
        """
        self._llm = llm_client or get_default_client()
        self._use_llm = self._llm.is_available()
        if not self._use_llm:
            logger.info("LLM 不可用，SemanticAnalyzer 使用启发式规则降级模式")

    # ------------------------------------------------------------------
    # Public
    # ------------------------------------------------------------------

    def analyze(
        self,
        parsed_result: ParseResult,
        component_graph: ComponentGraph,
    ) -> SemanticGraph:
        """执行语义分析。

        Args:
            parsed_result:   CodeParser 输出。
            component_graph: ComponentDetector 输出（用于辅助分类）。

        Returns:
            SemanticGraph，含 components / services / domains / apis / edges。
        """
        sg = SemanticGraph()

        # 收集所有有意义的类（跳过无方法的纯数据类）
        classes_to_analyze = self._collect_classes(parsed_result)

        if not classes_to_analyze:
            return sg

        # 分批分类
        records = self._classify_classes(classes_to_analyze, component_graph)

        # 构建节点
        self._build_nodes(records, sg)

        # 构建 Domain --contains--> * 边
        seen_edges: set[tuple[str, str]] = set()
        self._build_domain_edges(records, sg, seen_edges)

        logger.info(
            "语义分析完成: components=%d services=%d domains=%d apis=%d edges=%d",
            len(sg.components), len(sg.services), len(sg.domains),
            len(sg.apis), len(sg.edges),
        )
        return sg

    # ------------------------------------------------------------------
    # Class collection
    # ------------------------------------------------------------------

    @staticmethod
    def _collect_classes(parsed_result: ParseResult) -> list[tuple[ParsedFile, ParsedClass]]:
        """从 ParseResult 收集所有有意义的类（至少 1 个方法 或有文档字符串）。"""
        result = []
        for pf in parsed_result.files:
            for cls in pf.classes:
                if cls.methods or cls.docstring:
                    result.append((pf, cls))
        return result

    # ------------------------------------------------------------------
    # Classification dispatch
    # ------------------------------------------------------------------

    def _classify_classes(
        self,
        items: list[tuple[ParsedFile, ParsedClass]],
        component_graph: ComponentGraph,
    ) -> list[_ClassRecord]:
        """对类列表进行分批分类，返回 _ClassRecord 列表。"""
        if self._use_llm:
            return self._classify_with_llm(items)
        return self._classify_heuristic(items, component_graph)

    # ------------------------------------------------------------------
    # LLM classification
    # ------------------------------------------------------------------

    def _classify_with_llm(
        self,
        items: list[tuple[ParsedFile, ParsedClass]],
    ) -> list[_ClassRecord]:
        """分批调用 LLM 分类，汇总所有结果。"""
        records: list[_ClassRecord] = []

        # 按文件分组，再按 _BATCH_SIZE 切批
        batches = self._make_batches(items)

        for batch in batches:
            try:
                batch_records = self._llm_classify_batch(batch)
                records.extend(batch_records)
            except Exception:
                logger.warning("LLM 批次分类失败，此批次回退到启发式", exc_info=True)
                from backend.analyzer.component_detector import ComponentGraph as _CG
                fallback = self._classify_heuristic(batch, _CG())
                records.extend(fallback)

        return records

    @staticmethod
    def _make_batches(
        items: list[tuple[ParsedFile, ParsedClass]],
    ) -> list[list[tuple[ParsedFile, ParsedClass]]]:
        """将 items 按 _BATCH_SIZE 切成若干批次。"""
        return [items[i: i + _BATCH_SIZE] for i in range(0, len(items), _BATCH_SIZE)]

    def _llm_classify_batch(
        self,
        batch: list[tuple[ParsedFile, ParsedClass]],
    ) -> list[_ClassRecord]:
        """对单个批次调用 LLM，解析响应并返回记录。"""
        class_info_lines: list[str] = []
        for idx, (pf, cls) in enumerate(batch, 1):
            info = _format_class_info(idx, pf, cls)
            class_info_lines.append(info)

        prompt = _CLASSIFY_PROMPT_TEMPLATE.format(
            class_descriptions="\n\n".join(class_info_lines),
        )

        raw = self._llm.complete_with_json(prompt, system=_SYSTEM_PROMPT)

        # 解析响应
        items_raw = raw.get("items") or raw.get("classifications") or []
        records: list[_ClassRecord] = []

        # 名称→文件路径索引（用于回填 file_path）
        name_to_fp: dict[str, str] = {
            cls.name: pf.file_path for (pf, cls) in batch
        }

        for item in items_raw:
            if not isinstance(item, dict):
                continue
            name = item.get("name") or item.get("class_name", "")
            if not name:
                continue
            role = str(item.get("role", "component")).lower()
            if role not in ("service", "component", "api", "other"):
                role = "component"
            records.append(_ClassRecord(
                class_name=name,
                file_path=name_to_fp.get(name, ""),
                role=role,
                description=item.get("description", ""),
                domain=_normalize_domain(item.get("domain", "")),
                responsibilities=item.get("responsibilities", []),
            ))

        # 对 LLM 没有返回的类，用启发式补全
        returned_names = {r.class_name for r in records}
        for (pf, cls) in batch:
            if cls.name not in returned_names:
                records.append(_fallback_classify(pf, cls))

        return records

    # ------------------------------------------------------------------
    # Heuristic classification (fallback)
    # ------------------------------------------------------------------

    @staticmethod
    def _classify_heuristic(
        items: list[tuple[ParsedFile, ParsedClass]],
        component_graph: ComponentGraph,
    ) -> list[_ClassRecord]:
        """基于启发式规则对类进行角色分类。"""
        records = []
        for (pf, cls) in items:
            records.append(_fallback_classify(pf, cls))
        return records

    # ------------------------------------------------------------------
    # Node & edge construction
    # ------------------------------------------------------------------

    def _build_nodes(self, records: list[_ClassRecord], sg: SemanticGraph) -> None:
        """从分类结果构建 GraphNode 并注册到 SemanticGraph。"""
        for rec in records:
            if rec.role == "other":
                continue  # 不为纯数据类创建节点

            node = GraphNode(
                type=_ROLE_TO_NODE_TYPE[rec.role],
                name=rec.class_name,
                properties={
                    "description":       rec.description,
                    "domain":            rec.domain,
                    "responsibilities":  rec.responsibilities,
                    "semantic_role":     rec.role,
                    "source_file":       rec.file_path,
                },
            )
            sg._node_by_class[rec.class_name] = node

            if rec.role == "service":
                sg.services.append(node)
            elif rec.role == "api":
                sg.apis.append(node)
            else:
                sg.components.append(node)

        # 创建 Domain 节点（按 domain 字段聚合）
        domain_members: dict[str, list[str]] = {}
        for rec in records:
            if rec.role == "other" or not rec.domain:
                continue
            domain_members.setdefault(rec.domain, []).append(rec.class_name)

        for domain_name, member_names in domain_members.items():
            if domain_name in sg._domain_by_name:
                continue
            domain_node = GraphNode(
                type=NodeType.MODULE.value,
                name=domain_name,
                properties={
                    "semantic_role": "domain",
                    "description":   f"{domain_name} business domain",
                    "members":       member_names,
                },
            )
            sg._domain_by_name[domain_name] = domain_node
            sg.domains.append(domain_node)

    def _build_domain_edges(
        self,
        records: list[_ClassRecord],
        sg: SemanticGraph,
        seen: set[tuple[str, str]],
    ) -> None:
        """建立 Domain --contains--> Component/Service/API 边。"""
        for rec in records:
            if rec.role == "other" or not rec.domain:
                continue
            domain_node = sg._domain_by_name.get(rec.domain)
            member_node = sg._node_by_class.get(rec.class_name)
            if not domain_node or not member_node:
                continue
            key = (domain_node.id, member_node.id)
            if key in seen:
                continue
            seen.add(key)
            sg.edges.append(GraphEdge(**{
                "from": domain_node.id,
                "to":   member_node.id,
                "type": EdgeType.CONTAINS.value,
                "properties": {"domain": rec.domain},
            }))


# ---------------------------------------------------------------------------
# LLM prompt templates
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = """\
你是代码架构专家，精通 DDD（领域驱动设计）和软件分层架构。
分析代码类信息，为每个类分配语义角色并识别所属业务域。

角色定义：
  service   — 实现核心业务逻辑（如 UserService、OrderProcessor、PaymentGateway）
  component — 实现技术职责（如 Parser、Builder、Validator、Repository、Cache、Client）
  api       — 暴露 HTTP/RPC 接口（如 Router、Controller、View、Endpoint、Handler）
  other     — 数据类、工具类、枚举、配置类等

严格返回 JSON，不添加任何解释文字。\
"""

_CLASSIFY_PROMPT_TEMPLATE = """\
分析以下代码类，返回每个类的语义角色：

{class_descriptions}

返回格式（严格 JSON，items 数组与上面类的顺序一致）：
{{
  "items": [
    {{
      "name": "类名（原样复制）",
      "role": "service|component|api|other",
      "description": "核心职责，15字以内",
      "domain": "业务域英文标识（如 user / order / payment / infra / auth）",
      "responsibilities": ["职责1", "职责2"]
    }}
  ]
}}\
"""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# role → NodeType 映射
_ROLE_TO_NODE_TYPE: dict[str, str] = {
    "service":   NodeType.SERVICE.value,
    "component": NodeType.COMPONENT.value,
    "api":       NodeType.API.value,
}


def _format_class_info(idx: int, pf: ParsedFile, cls: ParsedClass) -> str:
    """将类信息格式化为 LLM 可读的紧凑文本。"""
    lines = [f"[{idx}] {cls.name}"]

    if cls.base_classes:
        lines.append(f"    基类: {', '.join(cls.base_classes[:3])}")

    if cls.decorators:
        lines.append(f"    装饰器: {', '.join(cls.decorators[:3])}")

    method_names = [m.name for m in cls.methods if not m.name.startswith("_")][:8]
    if method_names:
        lines.append(f"    方法: {', '.join(method_names)}")

    if cls.docstring:
        doc_short = cls.docstring.strip().splitlines()[0][:60]
        lines.append(f"    文档: \"{doc_short}\"")

    return "\n".join(lines)


def _fallback_classify(pf: ParsedFile, cls: ParsedClass) -> _ClassRecord:
    """仅使用启发式规则为单个类分配角色（LLM 不可用时的降级）。"""
    name_lower = cls.name.lower()

    # API 类名片段
    for hint in _API_CLASS_HINTS:
        if name_lower.endswith(hint.lower()) or name_lower == hint.lower():
            return _ClassRecord(cls.name, pf.file_path, "api")

    # API 装饰器
    all_decs = " ".join(d.lower() for m in cls.methods for d in m.decorators)
    all_decs += " ".join(d.lower() for d in cls.decorators)
    for hint in _API_DECORATOR_HINTS:
        if hint in all_decs:
            return _ClassRecord(cls.name, pf.file_path, "api")

    # Service 后缀
    for suffix in _SERVICE_SUFFIXES:
        if cls.name.endswith(suffix):
            return _ClassRecord(cls.name, pf.file_path, "service")

    return _ClassRecord(cls.name, pf.file_path, "component")


def _normalize_domain(raw: str) -> str:
    """将 LLM 返回的 domain 字符串标准化为小写、连字符形式。"""
    if not raw:
        return ""
    s = raw.strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")[:40]
