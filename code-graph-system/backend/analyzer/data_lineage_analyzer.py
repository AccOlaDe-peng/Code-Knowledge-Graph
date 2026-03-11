"""
数据血缘分析器模块。

识别代码中的数据实体（ORM 模型、数据库表、Schema定义），
追踪数据的读取（READS）和写入（WRITES）操作，
构建完整的数据血缘图谱。

支持识别：
- SQLAlchemy ORM 模型
- Django ORM 模型
- Pydantic/dataclasses 数据模型
- 直接 SQL 操作（SELECT/INSERT/UPDATE/DELETE）
- Pandas/Polars DataFrame 操作
"""

from __future__ import annotations

import logging
import re
from typing import Optional

from backend.graph.schema import (
    DataEntityNode,
    DataField,
    EdgeBase,
    EdgeType,
    EntityType,
    FunctionNode,
    ModuleNode,
)
from backend.parser.code_parser import ParsedClass, ParsedFile

logger = logging.getLogger(__name__)

# ORM 基类标识符（用于识别数据模型）
ORM_BASE_CLASSES = {
    "Base", "Model", "BaseModel", "DeclarativeBase",
    "db.Model", "Document", "EmbeddedDocument",
    "SQLModel",
}

# 数据库操作模式（正则表达式）
SQL_PATTERNS = {
    "read": re.compile(
        r"\b(?:SELECT|FETCH|GET|FIND|QUERY|READ)\b", re.IGNORECASE
    ),
    "write": re.compile(
        r"\b(?:INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|UPSERT|SAVE|WRITE)\b",
        re.IGNORECASE,
    ),
}

# 方法名 -> 操作类型 映射
METHOD_OP_MAP = {
    "read": {
        "find", "find_one", "find_all", "get", "get_or_404", "filter",
        "filter_by", "all", "first", "one", "scalar", "execute",
        "fetchall", "fetchone", "read", "load", "query",
    },
    "write": {
        "save", "add", "create", "insert", "update", "delete",
        "remove", "bulk_create", "bulk_update", "upsert", "commit",
        "write", "store", "put",
    },
}


class DataLineageAnalyzer:
    """
    数据血缘分析器。

    识别数据实体并追踪数据流向，生成 DataEntityNode 和
    READS/WRITES 类型的关系边。

    示例::

        analyzer = DataLineageAnalyzer()
        entities, edges = analyzer.analyze(parsed_files, function_nodes)
    """

    def analyze(
        self,
        parsed_files: dict[str, ParsedFile],
        function_nodes: dict[str, FunctionNode],
        module_nodes: Optional[dict[str, ModuleNode]] = None,
    ) -> tuple[list[DataEntityNode], list[EdgeBase]]:
        """
        执行数据血缘分析。

        Args:
            parsed_files: 文件路径 -> 解析结果的映射
            function_nodes: 函数名 -> 函数节点的映射
            module_nodes: 文件路径 -> 模块节点的映射

        Returns:
            (数据实体节点列表, 关系边列表) 元组
        """
        entity_nodes: list[DataEntityNode] = []
        edges: list[EdgeBase] = []
        entity_index: dict[str, DataEntityNode] = {}

        # 第一遍：识别数据实体类
        for file_path, parsed in parsed_files.items():
            for cls in parsed.classes:
                entity = self._detect_data_entity(cls, parsed.file_path, parsed.language)
                if entity:
                    entity_nodes.append(entity)
                    entity_index[cls.name] = entity

        # 第二遍：追踪数据读写操作，生成血缘边
        for file_path, parsed in parsed_files.items():
            for cls in parsed.classes:
                for method in cls.methods:
                    func_node = function_nodes.get(f"{cls.name}.{method.name}")
                    if not func_node:
                        func_node = function_nodes.get(method.name)
                    if not func_node:
                        continue

                    lineage = self._trace_data_operations(method, entity_index)
                    for entity, op_type in lineage:
                        edge_type = EdgeType.READS if op_type == "read" else EdgeType.WRITES
                        edges.append(EdgeBase(
                            type=edge_type,
                            source_id=func_node.id,
                            target_id=entity.id,
                            metadata={"operation": op_type},
                        ))

            # 模块级函数
            for func in parsed.functions:
                func_node = function_nodes.get(func.name)
                if not func_node:
                    continue
                lineage = self._trace_data_operations(func, entity_index)
                for entity, op_type in lineage:
                    edge_type = EdgeType.READS if op_type == "read" else EdgeType.WRITES
                    edges.append(EdgeBase(
                        type=edge_type,
                        source_id=func_node.id,
                        target_id=entity.id,
                        metadata={"operation": op_type},
                    ))

        logger.info(
            f"数据血缘分析完成: {len(entity_nodes)} 个数据实体, "
            f"{len(edges)} 条血缘边"
        )
        return entity_nodes, edges

    def _detect_data_entity(
        self,
        cls: ParsedClass,
        file_path: str,
        language: str,
    ) -> Optional[DataEntityNode]:
        """
        检测类是否为数据实体。

        Args:
            cls: 解析到的类定义
            file_path: 所在文件路径
            language: 编程语言

        Returns:
            DataEntityNode（如果是数据实体），否则 None
        """
        is_orm = any(b in ORM_BASE_CLASSES for b in cls.base_classes)
        is_pydantic = "BaseModel" in cls.base_classes
        is_dataclass = "dataclass" in cls.decorators

        if not (is_orm or is_pydantic or is_dataclass):
            return None

        entity_type = self._infer_entity_type(cls, is_orm, is_pydantic)
        fields = self._extract_fields(cls)

        return DataEntityNode(
            name=cls.name,
            file_path=file_path,
            line_start=cls.line_start,
            line_end=cls.line_end,
            entity_type=entity_type,
            fields=fields,
            metadata={
                "language": language,
                "is_orm": is_orm,
                "is_pydantic": is_pydantic,
                "is_dataclass": is_dataclass,
                "docstring": cls.docstring or "",
            },
        )

    def _infer_entity_type(
        self,
        cls: ParsedClass,
        is_orm: bool,
        is_pydantic: bool,
    ) -> EntityType:
        """推断数据实体类型。"""
        name_lower = cls.name.lower()
        if is_orm:
            return EntityType.TABLE
        if "schema" in name_lower:
            return EntityType.SCHEMA
        if is_pydantic:
            return EntityType.MODEL
        return EntityType.MODEL

    def _extract_fields(self, cls: ParsedClass) -> list[DataField]:
        """从类属性中提取数据字段信息。"""
        fields: list[DataField] = []
        for attr_name in cls.attributes:
            # 简单推断：以 id 结尾的字段可能是主键
            is_pk = attr_name.lower() in ("id", "pk", "primary_key")
            fields.append(DataField(
                name=attr_name,
                type=None,  # 需要更深入的类型分析
                nullable=not is_pk,
                primary_key=is_pk,
            ))
        return fields

    def _trace_data_operations(
        self,
        func: "ParsedFunction",  # noqa: F821
        entity_index: dict[str, DataEntityNode],
    ) -> list[tuple[DataEntityNode, str]]:
        """
        追踪函数中的数据操作。

        Returns:
            (数据实体节点, 操作类型) 的列表，操作类型为 "read" 或 "write"
        """
        results: list[tuple[DataEntityNode, str]] = []
        seen: set[str] = set()

        for call in func.calls:
            callee = call.callee
            # 提取调用对象名（obj.method -> obj）
            obj_name = callee.split(".")[0] if "." in callee else ""
            method_name = callee.split(".")[-1] if "." in callee else callee

            # 对象名匹配实体
            entity = entity_index.get(obj_name) or entity_index.get(
                obj_name.replace("_", "").title()
            )

            if not entity:
                continue

            # 根据方法名推断操作类型
            op_type: Optional[str] = None
            for op, method_set in METHOD_OP_MAP.items():
                if method_name.lower() in method_set:
                    op_type = op
                    break

            if op_type and entity.id not in seen:
                seen.add(entity.id)
                results.append((entity, op_type))

        return results
