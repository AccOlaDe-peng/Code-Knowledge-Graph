"""
组件识别器模块。

从解析结果中提取类、接口、结构体等组件定义，
生成 ComponentNode 节点和 CONTAINS（模块包含组件）、
INHERITS（继承）、IMPLEMENTS（实现接口）等关系边。
"""

from __future__ import annotations

import logging
from typing import Optional

from backend.graph.schema import (
    ComponentNode,
    ComponentType,
    EdgeBase,
    EdgeType,
    ModuleNode,
)
from backend.parser.code_parser import ParsedClass, ParsedFile

logger = logging.getLogger(__name__)


class ComponentDetector:
    """
    组件识别器。

    遍历所有已解析文件，识别类/接口/结构体定义，
    建立组件间的继承和实现关系。

    示例::

        detector = ComponentDetector()
        nodes, edges = detector.detect(parsed_files, module_nodes)
    """

    # 已知的抽象基类标识符（会标记 is_abstract=True）
    ABSTRACT_MARKERS = {"ABC", "ABCMeta", "Protocol", "Interface", "Abstract"}

    def detect(
        self,
        parsed_files: dict[str, ParsedFile],
        module_nodes: dict[str, ModuleNode],
    ) -> tuple[list[ComponentNode], list[EdgeBase]]:
        """
        执行组件识别。

        Args:
            parsed_files: 文件路径 -> 解析结果的映射
            module_nodes: 文件路径 -> 模块节点的映射（用于建立 CONTAINS 边）

        Returns:
            (组件节点列表, 边列表) 元组
        """
        nodes: list[ComponentNode] = []
        edges: list[EdgeBase] = []
        name_to_node: dict[str, ComponentNode] = {}

        for file_path, parsed in parsed_files.items():
            module_node = module_nodes.get(file_path)
            file_nodes, file_edges = self._process_file(parsed, module_node)
            nodes.extend(file_nodes)
            edges.extend(file_edges)
            for n in file_nodes:
                name_to_node[n.name] = n

        # 第二遍：建立继承/实现关系
        edges.extend(self._build_inheritance_edges(parsed_files, name_to_node))

        logger.info(f"组件识别完成: {len(nodes)} 个组件, {len(edges)} 条关系边")
        return nodes, edges

    def _process_file(
        self,
        parsed: ParsedFile,
        module_node: Optional[ModuleNode],
    ) -> tuple[list[ComponentNode], list[EdgeBase]]:
        """处理单个文件，生成其中的组件节点和边。"""
        nodes: list[ComponentNode] = []
        edges: list[EdgeBase] = []

        for cls in parsed.classes:
            comp_node = self._class_to_node(cls, parsed.file_path, parsed.language)
            nodes.append(comp_node)

            # CONTAINS: 模块 -> 组件
            if module_node:
                edges.append(EdgeBase(
                    type=EdgeType.CONTAINS,
                    source_id=module_node.id,
                    target_id=comp_node.id,
                    metadata={"line": cls.line_start},
                ))

        return nodes, edges

    def _class_to_node(
        self,
        cls: ParsedClass,
        file_path: str,
        language: str,
    ) -> ComponentNode:
        """将 ParsedClass 转换为 ComponentNode。"""
        is_abstract = cls.is_abstract or any(
            b in self.ABSTRACT_MARKERS for b in cls.base_classes
        )
        comp_type = self._infer_component_type(cls, language)

        return ComponentNode(
            name=cls.name,
            file_path=file_path,
            line_start=cls.line_start,
            line_end=cls.line_end,
            component_type=comp_type,
            is_abstract=is_abstract,
            methods=[m.name for m in cls.methods],
            attributes=cls.attributes,
            base_classes=cls.base_classes,
            metadata={
                "decorators": cls.decorators,
                "language": language,
                "docstring": cls.docstring or "",
            },
        )

    def _infer_component_type(self, cls: ParsedClass, language: str) -> ComponentType:
        """根据类的特征推断组件类型。"""
        name_lower = cls.name.lower()

        # Python Protocol -> 接口
        if "Protocol" in cls.base_classes:
            return ComponentType.INTERFACE
        # 枚举
        if "Enum" in cls.base_classes or "IntEnum" in cls.base_classes:
            return ComponentType.ENUM
        # 混入
        if name_lower.endswith("mixin"):
            return ComponentType.MIXIN
        return ComponentType.CLASS

    def _build_inheritance_edges(
        self,
        parsed_files: dict[str, ParsedFile],
        name_to_node: dict[str, ComponentNode],
    ) -> list[EdgeBase]:
        """构建类继承（INHERITS）和接口实现（IMPLEMENTS）边。"""
        edges: list[EdgeBase] = []

        for file_path, parsed in parsed_files.items():
            for cls in parsed.classes:
                child_node = name_to_node.get(cls.name)
                if not child_node:
                    continue

                for base_name in cls.base_classes:
                    parent_node = name_to_node.get(base_name)
                    if not parent_node or parent_node.id == child_node.id:
                        continue

                    # 接口实现 vs 类继承
                    edge_type = (
                        EdgeType.IMPLEMENTS
                        if parent_node.component_type == ComponentType.INTERFACE
                        else EdgeType.INHERITS
                    )
                    edges.append(EdgeBase(
                        type=edge_type,
                        source_id=child_node.id,
                        target_id=parent_node.id,
                    ))

        return edges
