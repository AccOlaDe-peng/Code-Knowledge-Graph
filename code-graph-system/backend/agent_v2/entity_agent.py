"""实体分析 Agent。

负责发现和分析项目中的实体类：
- JPA/Hibernate 实体
- MyBatis Mapper
- 数据传输对象（DTO）
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any, Optional

from backend.agent_v2.base_agent import (
    AgentContext,
    AgentPhase,
    AgentResult,
    DomainAgent,
)
from backend.graph.graph_schema import GraphEdge, GraphNode, NodeType, EdgeType

logger = logging.getLogger(__name__)


class EntityAgent(DomainAgent):
    """实体分析 Agent。

    职责：
    1. 发现项目中的实体类（@Entity, @Table, MyBatis POJO）
    2. 分析实体字段和数据库映射关系
    3. 解析实体间的关系（OneToOne, OneToMany, ManyToOne, ManyToMany）
    4. 验证实体命名规范和注解完整性

    输出：
    - Entity 节点
    - Field 节点
    - one_to_one / one_to_many / many_to_one / many_to_many 边
    - has_field 边
    """

    # 目标文件模式
    ENTITY_PATTERNS = [
        "**/entity/**/*.java",
        "**/entities/**/*.java",
        "**/domain/**/*.java",
        "**/model/**/*.java",
        "**/pojo/**/*.java",
        "**/dto/**/*.java",
    ]

    # 实体注解标记
    ENTITY_ANNOTATIONS = [
        "@Entity",
        "@Table",
        "@MappedSuperclass",
        "@Embeddable",
    ]

    def __init__(self, context: AgentContext):
        super().__init__(context)
        self._entity_files: list[str] = []
        self._analyzed_entities: dict[str, dict] = {}

    # ═══════════════════════════════════════════════════════════════
    # Phase 1: Discovery
    # ═══════════════════════════════════════════════════════════════

    def discover(self) -> list[dict]:
        """发现项目中的实体文件。"""
        targets = []

        # 1. 按目录模式搜索
        for pattern in self.ENTITY_PATTERNS:
            result = self.call_tool("find_files", pattern=pattern.replace("**/", ""))
            if result.get("success"):
                for file_path in result.get("files", []):
                    if self._is_entity_file(file_path):
                        targets.append({
                            "target_id": file_path,
                            "target_type": "entity_file",
                            "file_path": file_path,
                            "hints": {"source": "directory_pattern"},
                        })

        # 2. 搜索 @Entity 注解
        search_result = self.call_tool(
            "search_code",
            pattern="@Entity",
            file_pattern="*.java",
            context_lines=2,
            max_results=100,
        )

        if search_result.get("success"):
            seen_files = {t["file_path"] for t in targets}
            for match in search_result.get("results", []):
                file_path = match["file_path"]
                if file_path not in seen_files:
                    targets.append({
                        "target_id": file_path,
                        "target_type": "entity_file",
                        "file_path": file_path,
                        "hints": {"source": "annotation_search", "line": match["line_number"]},
                    })
                    seen_files.add(file_path)

        self._entity_files = [t["file_path"] for t in targets]
        logger.info("[EntityAgent] 发现 %d 个实体文件", len(targets))

        return targets

    def _is_entity_file(self, file_path: str) -> bool:
        """判断是否为实体文件。"""
        # 排除测试文件
        if "test" in file_path.lower() or "Test" in file_path:
            return False

        # 读取文件内容检查
        result = self.call_tool("read_file", path=file_path, max_size=65536)
        if not result.get("success"):
            return False

        content = result["content"]

        # 检查是否有实体注解
        for ann in self.ENTITY_ANNOTATIONS:
            if ann in content:
                return True

        # 检查是否有典型的实体字段模式
        if "@Id" in content or "@Column" in content:
            return True

        return False

    # ═══════════════════════════════════════════════════════════════
    # Phase 2: Analysis
    # ═══════════════════════════════════════════════════════════════

    def analyze(self, target: dict) -> AgentResult:
        """分析单个实体文件。"""
        file_path = target["file_path"]
        result = AgentResult(agent_name=self.name)

        # 使用 JPA 工具提取实体信息
        entity_result = self.call_tool("jpa_entity_analyzer", path=file_path)

        if not entity_result.get("success"):
            # 回退到语义分析
            entity_result = self._analyze_by_semantic_tools(file_path)

        if not entity_result.get("success"):
            result.issues.append({
                "type": "analysis_failed",
                "severity": "high",
                "message": f"无法分析文件: {file_path}",
                "suggestion": "检查文件格式或编码问题",
            })
            return result

        # 提取实体信息
        entities = entity_result.get("entities", [])
        if not entities:
            # 尝试提取类信息
            classes_result = self.call_tool("extract_classes", path=file_path)
            if classes_result.get("success"):
                entities = self._convert_classes_to_entities(classes_result.get("classes", []))

        for entity_data in entities:
            # 创建 Entity 节点
            entity_node = self._create_entity_node(entity_data, file_path)
            result.nodes.append(entity_node)

            # 创建 Field 节点
            for field_data in entity_data.get("fields", []):
                field_node, field_edge = self._create_field_node(
                    field_data, entity_node.id
                )
                result.nodes.append(field_node)
                result.edges.append(field_edge)

            # 创建关系边
            for relation in entity_data.get("relations", []):
                edge = self._create_relation_edge(relation, entity_node.id)
                if edge:
                    result.edges.append(edge)

            # 存储分析结果
            self._analyzed_entities[entity_data["name"]] = entity_data

            # 发布到知识中心
            self.set_shared_knowledge(
                f"entity:{entity_data['name']}",
                entity_data,
                confidence=0.9,
            )

        result.confidence = self._calculate_confidence(entities)
        return result

    def _analyze_by_semantic_tools(self, file_path: str) -> dict:
        """使用语义工具分析（回退方案）。"""
        # 提取类
        classes_result = self.call_tool("extract_classes", path=file_path)
        if not classes_result.get("success"):
            return {"success": False}

        # 提取注解
        annotations_result = self.call_tool("extract_annotations", path=file_path)

        entities = []
        for cls in classes_result.get("classes", []):
            # 检查是否有实体注解
            is_entity = any(
                ann.get("name") in ["Entity", "Table", "MappedSuperclass"]
                for ann in cls.get("annotations", [])
            )

            if is_entity or "entity" in file_path.lower() or "domain" in file_path.lower():
                # 提取字段
                fields_result = self.call_tool(
                    "extract_fields",
                    path=file_path,
                    class_name=cls["name"],
                )

                entity_data = {
                    "name": cls["name"],
                    "table_name": self._infer_table_name(cls["name"]),
                    "type": cls["type"],
                    "fields": fields_result.get("fields", []) if fields_result.get("success") else [],
                    "relations": [],
                    "file_path": file_path,
                }
                entities.append(entity_data)

        return {"success": True, "entities": entities}

    def _convert_classes_to_entities(self, classes: list) -> list:
        """将类信息转换为实体信息。"""
        entities = []
        for cls in classes:
            # 简单启发式：检查类名后缀
            if any(suffix in cls["name"] for suffix in ["Entity", "DTO", "VO", "PO"]):
                entities.append({
                    "name": cls["name"],
                    "table_name": self._infer_table_name(cls["name"]),
                    "type": cls["type"],
                    "fields": [],
                    "relations": [],
                })
        return entities

    def _create_entity_node(self, entity_data: dict, file_path: str) -> GraphNode:
        """创建实体节点。"""
        entity_name = entity_data["name"]

        properties = {
            "table_name": entity_data.get("table_name", self._infer_table_name(entity_name)),
            "file_path": file_path,
            "type": entity_data.get("type", "class"),
            "field_count": len(entity_data.get("fields", [])),
            "relation_count": len(entity_data.get("relations", [])),
        }

        # 添加索引信息
        if entity_data.get("indexes"):
            properties["indexes"] = entity_data["indexes"]

        return GraphNode(
            id=f"entity:{entity_name}",
            type=NodeType.ENTITY.value,
            name=entity_name,
            properties=properties,
        )

    def _create_field_node(
        self,
        field_data: dict,
        entity_id: str,
    ) -> tuple[GraphNode, GraphEdge]:
        """创建字段节点和边。"""
        field_name = field_data["name"]
        field_id = f"field:{entity_id.split(':')[1]}.{field_name}"

        properties = {
            "type": field_data.get("type", "unknown"),
            "column_name": field_data.get("column", field_name.lower()),
            "is_id": field_data.get("is_id", False),
            "is_nullable": field_data.get("is_nullable", True),
            "is_unique": field_data.get("is_unique", False),
        }

        if field_data.get("length"):
            properties["length"] = field_data["length"]
        if field_data.get("precision"):
            properties["precision"] = field_data["precision"]
        if field_data.get("scale"):
            properties["scale"] = field_data["scale"]

        node = GraphNode(
            id=field_id,
            type=NodeType.FIELD.value,
            name=field_name,
            properties=properties,
        )

        edge = GraphEdge(
            from_=entity_id,
            to=field_id,
            type=EdgeType.HAS_FIELD.value,
            properties={},
        )

        return node, edge

    def _create_relation_edge(
        self,
        relation: dict,
        source_entity_id: str,
    ) -> Optional[GraphEdge]:
        """创建关系边。"""
        rel_type = relation.get("type", "")
        target_entity = relation.get("target_entity")

        if not target_entity:
            return None

        target_id = f"entity:{target_entity}"

        # 映射关系类型到边类型
        edge_type_map = {
            "OneToOne": EdgeType.ONE_TO_ONE.value,
            "OneToMany": EdgeType.ONE_TO_MANY.value,
            "ManyToOne": EdgeType.MANY_TO_ONE.value,
            "ManyToMany": EdgeType.MANY_TO_MANY.value,
        }

        edge_type = edge_type_map.get(rel_type, EdgeType.RELATED_TO.value if hasattr(EdgeType, "RELATED_TO") else "related_to")

        properties = {
            "field_name": relation.get("field_name"),
            "join_column": relation.get("join_column"),
            "join_table": relation.get("join_table"),
            "mapped_by": relation.get("mapped_by"),
            "fetch": relation.get("fetch", "LAZY"),
        }

        if relation.get("cascade"):
            properties["cascade"] = relation["cascade"]

        return GraphEdge(
            from_=source_entity_id,
            to=target_id,
            type=edge_type,
            properties=properties,
        )

    def _infer_table_name(self, class_name: str) -> str:
        """推断表名（驼峰转下划线）。"""
        # UserOrder -> user_order
        s1 = re.sub(r'(.)([A-Z][a-z]+)', r'\1_\2', class_name)
        return re.sub(r'([a-z0-9])([A-Z])', r'\1_\2', s1).lower()

    def _calculate_confidence(self, entities: list) -> float:
        """计算分析置信度。"""
        if not entities:
            return 0.3

        confidence = 0.9

        for entity in entities:
            # 检查是否有主键
            has_id = any(f.get("is_id") for f in entity.get("fields", []))
            if not has_id:
                confidence -= 0.05

            # 检查关系是否有目标实体
            for rel in entity.get("relations", []):
                if not rel.get("target_entity"):
                    confidence -= 0.03

        return max(0.5, confidence)

    # ═══════════════════════════════════════════════════════════════
    # Phase 3: Validate
    # ═══════════════════════════════════════════════════════════════

    def validate(self, result: AgentResult) -> tuple[bool, list[dict]]:
        """验证分析结果。"""
        issues = []
        is_valid = True

        # 收集所有节点 ID
        node_ids = {n.id for n in result.nodes}

        # 验证每个实体节点
        for node in result.nodes:
            if node.type == NodeType.ENTITY.value:
                # 检查必填字段
                issue = self._validate_required_fields(node, ["name"])
                if issue:
                    issues.append(issue)
                    is_valid = False

                # 检查命名规范
                if node.name:
                    naming_issue = self._validate_naming_convention(node.name, "PascalCase")
                    if naming_issue:
                        issues.append(naming_issue)

            elif node.type == NodeType.FIELD.value:
                # 检查字段类型
                field_type = node.properties.get("type", "")
                if not field_type or field_type == "unknown":
                    issues.append({
                        "type": "unknown_field_type",
                        "severity": "medium",
                        "message": f"字段 {node.name} 类型未知",
                        "suggestion": "检查字段定义或添加类型注解",
                    })

        # 验证边的引用完整性
        for edge in result.edges:
            if edge.type == EdgeType.HAS_FIELD.value:
                # has_field 边：源是 entity，目标是 field
                if edge.from_ not in node_ids:
                    issues.append({
                        "type": "broken_reference",
                        "severity": "high",
                        "message": f"边引用不存在的源节点: {edge.from_}",
                    })
                    is_valid = False

            elif edge.type in [
                EdgeType.ONE_TO_ONE.value,
                EdgeType.ONE_TO_MANY.value,
                EdgeType.MANY_TO_ONE.value,
                EdgeType.MANY_TO_MANY.value,
            ]:
                # 关系边：目标实体可能还未分析
                # 记录但不报错
                if edge.to not in node_ids:
                    issues.append({
                        "type": "pending_reference",
                        "severity": "low",
                        "message": f"关系目标实体待验证: {edge.to}",
                        "suggestion": "等待其他实体分析完成",
                    })

        # 检查实体间关系的一致性
        relation_issues = self._validate_relation_consistency(result)
        issues.extend(relation_issues)

        return is_valid, issues

    def _validate_relation_consistency(self, result: AgentResult) -> list[dict]:
        """验证关系一致性。"""
        issues = []

        # 收集所有关系
        relations = {}
        for edge in result.edges:
            if edge.type in [
                EdgeType.ONE_TO_ONE.value,
                EdgeType.ONE_TO_MANY.value,
                EdgeType.MANY_TO_ONE.value,
                EdgeType.MANY_TO_MANY.value,
            ]:
                key = f"{edge.from_}->{edge.to}"
                relations[key] = edge

        # 检查双向关系
        for key, edge in relations.items():
            reverse_key = f"{edge.to}->{edge.from_}"

            if reverse_key in relations:
                reverse_edge = relations[reverse_key]

                # 检查 mappedBy 是否匹配
                mapped_by = edge.properties.get("mapped_by")
                reverse_field = reverse_edge.properties.get("field_name")

                if mapped_by and mapped_by != reverse_field:
                    issues.append({
                        "type": "relation_mismatch",
                        "severity": "medium",
                        "message": f"双向关系的 mappedBy 不匹配: {edge.from_} <-> {edge.to}",
                        "suggestion": f"检查 {edge.from_} 的 mappedBy 属性",
                    })

        return issues
