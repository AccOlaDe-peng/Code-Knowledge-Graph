"""
组件识别器模块。

组件定义：
    一组实现同一职责的代码，通常体现为一个有意义的类（如 UserService、OrderEngine、
    FileScanner），并由若干方法共同完成该职责。

识别策略（满足任一即视为组件）：
    1. 类名以已知组件后缀结尾（Service、Engine、Manager、Scanner 等）
    2. 类拥有 >= min_methods 个方法（可配置，默认 2）

输出 Graph Node 类型：
    Component   —— 逻辑组件（职责单元）
    Class       —— 实现该组件的具体代码类
    Function    —— 组件内的方法 / 关联的模块级函数

边关系：
    Component  --implements-->  Class      （组件由该类实现）
    Component  --contains-->    Function   （组件包含该函数/方法）
"""

from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Optional

from backend.graph.graph_schema import EdgeType, GraphEdge, GraphNode, NodeType
from backend.parser.code_parser import ParsedClass, ParsedFile, ParsedFunction

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Component suffix vocabulary
# ---------------------------------------------------------------------------

COMPONENT_SUFFIXES: frozenset[str] = frozenset({
    # 服务 / 引擎 / 管理
    "Service", "Engine", "Manager", "Coordinator", "Orchestrator",
    # 存储 / 数据访问
    "Repository", "Store", "Cache", "Registry", "Dao",
    # 处理 / 执行
    "Handler", "Processor", "Executor", "Runner", "Worker",
    # 解析 / 构建
    "Parser", "Builder", "Factory", "Generator",
    # 分析 / 检测
    "Analyzer", "Detector", "Scanner", "Validator", "Resolver",
    # 通信 / 路由
    "Client", "Gateway", "Router", "Broker", "Dispatcher",
    # 适配 / 转换
    "Adapter", "Transformer", "Converter", "Middleware",
    # 控制 / 调度
    "Controller", "Scheduler", "Loader", "Provider",
    # 消息
    "Publisher", "Subscriber", "Listener", "Emitter",
    # 读写
    "Reader", "Writer",
    # 流水线
    "Pipeline",
})


# ---------------------------------------------------------------------------
# Output container
# ---------------------------------------------------------------------------


@dataclass
class ComponentGraph:
    """ComponentDetector.detect() 的完整输出。

    Attributes:
        components:         Component 节点列表
        classes:            Class 节点列表（每个 ParsedClass 一个）
        functions:          Function 节点列表（方法 + 关联模块级函数）
        edges:              implements / contains 边列表
        component_by_name:  类名 → Component 节点索引
        class_by_name:      类名 → Class 节点索引
    """

    components: list[GraphNode] = field(default_factory=list)
    classes: list[GraphNode] = field(default_factory=list)
    functions: list[GraphNode] = field(default_factory=list)
    edges: list[GraphEdge] = field(default_factory=list)

    component_by_name: dict[str, GraphNode] = field(default_factory=dict, repr=False)
    class_by_name: dict[str, GraphNode] = field(default_factory=dict, repr=False)

    @property
    def stats(self) -> dict[str, int]:
        return {
            "components": len(self.components),
            "classes": len(self.classes),
            "functions": len(self.functions),
            "edges": len(self.edges),
        }


# ---------------------------------------------------------------------------
# ComponentDetector
# ---------------------------------------------------------------------------


class ComponentDetector:
    """
    组件识别器。

    遍历已解析文件，识别「承担单一职责的组件类」，为其生成
    Component / Class / Function 节点，并建立 implements / contains 边。

    示例::

        detector = ComponentDetector()
        graph = detector.detect(parsed_files)
        print(graph.stats)
        # {'components': 8, 'classes': 12, 'functions': 64, 'edges': 72}
    """

    def __init__(
        self,
        min_methods: int = 2,
        extra_suffixes: Optional[set[str]] = None,
    ) -> None:
        """
        Args:
            min_methods:    拥有至少这么多方法的类也视为组件（默认 2）。
            extra_suffixes: 额外的组件名称后缀（合并到默认集合）。
        """
        self.min_methods = min_methods
        self.suffixes: frozenset[str] = (
            COMPONENT_SUFFIXES | frozenset(extra_suffixes)
            if extra_suffixes
            else COMPONENT_SUFFIXES
        )

    # ------------------------------------------------------------------
    # Public
    # ------------------------------------------------------------------

    def detect(
        self,
        parsed_files: dict[str, ParsedFile],
    ) -> ComponentGraph:
        """执行组件识别。

        Args:
            parsed_files: 文件路径 → ParsedFile 的映射。

        Returns:
            ComponentGraph，包含所有节点与边。
        """
        graph = ComponentGraph()

        for _file_path, parsed in parsed_files.items():
            self._process_file(parsed, graph)

        logger.info(
            "组件识别完成: components=%d classes=%d functions=%d edges=%d",
            *graph.stats.values(),
        )
        return graph

    # ------------------------------------------------------------------
    # Per-file processing
    # ------------------------------------------------------------------

    def _process_file(self, parsed: ParsedFile, graph: ComponentGraph) -> None:
        """处理单个 ParsedFile，将结果追加到 graph。"""
        lang = parsed.language
        file_components: list[GraphNode] = []

        # ---- 1. 处理每个类 ----
        for cls in parsed.classes:
            class_node = self._make_class_node(cls, lang)
            graph.classes.append(class_node)
            graph.class_by_name[cls.name] = class_node

            if self._is_component(cls):
                comp_node = self._make_component_node(cls, lang)
                graph.components.append(comp_node)
                graph.component_by_name[cls.name] = comp_node
                file_components.append(comp_node)

                # Component --implements--> Class
                graph.edges.append(_edge(
                    comp_node.id, class_node.id,
                    EdgeType.IMPLEMENTS.value,
                    class_name=cls.name,
                    file_path=parsed.file_path,
                ))

                # 处理类内方法 → Function 节点 + contains 边
                for method in cls.methods:
                    fn_node = self._make_function_node(method, lang)
                    graph.functions.append(fn_node)
                    graph.edges.append(_edge(
                        comp_node.id, fn_node.id,
                        EdgeType.CONTAINS.value,
                        kind="method",
                        parent_class=cls.name,
                    ))

        # ---- 2. 处理模块级函数 ----
        # 若文件中只有一个组件，关联到该组件；否则仅创建 Function 节点
        dominant: Optional[GraphNode] = file_components[0] if len(file_components) == 1 else None

        for fn in parsed.functions:
            fn_node = self._make_function_node(fn, lang)
            graph.functions.append(fn_node)
            if dominant:
                graph.edges.append(_edge(
                    dominant.id, fn_node.id,
                    EdgeType.CONTAINS.value,
                    kind="module_function",
                ))

    # ------------------------------------------------------------------
    # Component detection rule
    # ------------------------------------------------------------------

    def _is_component(self, cls: ParsedClass) -> bool:
        """判断一个类是否构成组件。

        规则：
        1. 类名以已知后缀结尾，且名称不仅仅是后缀本身（如纯 "Service" 类名除外）。
        2. 类拥有 >= min_methods 个方法（无论名称如何）。
        """
        name = cls.name
        for suffix in self.suffixes:
            if name.endswith(suffix) and len(name) > len(suffix):
                return True
        return len(cls.methods) >= self.min_methods

    # ------------------------------------------------------------------
    # Node builders
    # ------------------------------------------------------------------

    def _make_component_node(self, cls: ParsedClass, language: str) -> GraphNode:
        return GraphNode(
            type=NodeType.COMPONENT.value,
            name=cls.name,
            properties={
                "component_type": self._infer_component_type(cls.name),
                "language": language,
                "file_path": cls.file_path,
                "line_start": cls.line_start,
                "line_end": cls.line_end,
                "method_count": len(cls.methods),
                "is_abstract": cls.is_abstract,
                "base_classes": cls.base_classes,
                "docstring": cls.docstring or "",
            },
        )

    def _make_class_node(self, cls: ParsedClass, language: str) -> GraphNode:
        return GraphNode(
            type=NodeType.CLASS.value,
            name=cls.name,
            properties={
                "language": language,
                "file_path": cls.file_path,
                "line_start": cls.line_start,
                "line_end": cls.line_end,
                "base_classes": cls.base_classes,
                "is_abstract": cls.is_abstract,
                "method_names": [m.name for m in cls.methods],
                "attribute_names": cls.attributes,
                "decorators": cls.decorators,
                "docstring": cls.docstring or "",
            },
        )

    def _make_function_node(self, fn: ParsedFunction, language: str) -> GraphNode:
        return GraphNode(
            type=NodeType.FUNCTION.value,
            name=fn.name,
            properties={
                "language": language,
                "file_path": fn.file_path,
                "line_start": fn.line_start,
                "line_end": fn.line_end,
                "parameters": [p.name for p in fn.parameters],
                "return_type": fn.return_type or "",
                "is_async": fn.is_async,
                "is_method": fn.is_method,
                "parent_class": fn.parent_class or "",
                "decorators": fn.decorators,
                "docstring": fn.docstring or "",
            },
        )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _infer_component_type(self, name: str) -> str:
        """从类名推断组件职责类型（取匹配后缀，lowercase）。"""
        for suffix in sorted(self.suffixes, key=len, reverse=True):
            if name.endswith(suffix) and len(name) > len(suffix):
                return suffix.lower()
        return "generic"


# ---------------------------------------------------------------------------
# Edge helper
# ---------------------------------------------------------------------------


def _edge(from_id: str, to_id: str, edge_type: str, **properties) -> GraphEdge:
    return GraphEdge(**{
        "from": from_id,
        "to": to_id,
        "type": edge_type,
        "properties": properties,
    })
