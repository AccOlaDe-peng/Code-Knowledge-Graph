"""血缘分析 Agent。

负责追踪数据流和构建血缘图：
- 字段级数据血缘
- 表间数据流转
- ETL 数据管道
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


class LineageAgent(DomainAgent):
    """血缘分析 Agent。

    职责：
    1. 追踪字段级数据血缘
    2. 分析数据转换逻辑
    3. 构建数据流图
    4. 识别数据源和数据目的地

    输出：
    - DataObject 节点
    - DataSource / DataSink 节点
    - flow_to 边
    - transforms 边
    """

    # 血缘追踪入口
    LINEAGE_SOURCES = [
        "**/repository/**/*.java",
        "**/mapper/**/*.java",
        "**/dao/**/*.java",
        "**/service/**/*.java",
    ]

    # 数据操作关键词
    DATA_OPERATION_KEYWORDS = [
        "save", "insert", "update", "delete", "find", "get", "query",
        "select", "from", "into", "set", "map", "convert", "transform",
    ]

    def __init__(self, context: AgentContext):
        super().__init__(context)
        self._lineage_sources: list[str] = []
        self._field_mappings: dict[str, list] = {}

    # ═══════════════════════════════════════════════════════════════
    # Phase 1: Discovery
    # ═══════════════════════════════════════════════════════════════

    def discover(self) -> list[dict]:
        """发现数据血缘来源。"""
        targets = []

        # 1. 从实体发现数据源
        entities = self.get_shared_knowledge("entity", default={})
        if isinstance(entities, dict):
            for entity_name, entity_data in entities.items():
                file_path = entity_data.get("file_path")
                if file_path:
                    targets.append({
                        "target_id": f"entity:{entity_name}",
                        "target_type": "data_source",
                        "file_path": file_path,
                        "hints": {"entity_name": entity_name},
                    })

        # 2. 从 Repository/Mapper 发现数据操作
        for pattern in self.LINEAGE_SOURCES:
            result = self.call_tool("find_files", pattern=pattern.replace("**/", ""))
            if result.get("success"):
                for file_path in result.get("files", []):
                    if self._is_lineage_file(file_path):
                        targets.append({
                            "target_id": file_path,
                            "target_type": "data_operation",
                            "file_path": file_path,
                            "hints": {"source": "repository_pattern"},
                        })

        # 3. 搜索数据操作方法
        for keyword in self.DATA_OPERATION_KEYWORDS[:3]:  # 限制搜索量
            search_result = self.call_tool(
                "search_code",
                pattern=f"\\.{keyword}\\s*\\(",
                file_pattern="*.java",
                context_lines=1,
                max_results=30,
            )

            if search_result.get("success"):
                seen_files = {t["file_path"] for t in targets}
                for match in search_result.get("results", []):
                    file_path = match["file_path"]
                    if file_path not in seen_files:
                        targets.append({
                            "target_id": f"{file_path}:{keyword}",
                            "target_type": "data_operation",
                            "file_path": file_path,
                            "hints": {
                                "operation": keyword,
                                "line": match["line_number"],
                            },
                        })
                        seen_files.add(file_path)

        self._lineage_sources = [t["file_path"] for t in targets]
        logger.info("[LineageAgent] 发现 %d 个血缘来源", len(targets))

        return targets

    def _is_lineage_file(self, file_path: str) -> bool:
        """判断是否为血缘相关文件。"""
        if "test" in file_path.lower():
            return False

        result = self.call_tool("read_file", path=file_path, max_size=32768)
        if not result.get("success"):
            return False

        content = result["content"]

        # 检查是否有数据操作
        indicators = [
            "@Repository", "@Mapper", "JpaRepository", "Repository",
            "INSERT", "UPDATE", "SELECT", "DELETE",
            "save", "findById", "findAll",
        ]

        return any(ind in content for ind in indicators)

    # ═══════════════════════════════════════════════════════════════
    # Phase 2: Analysis
    # ═══════════════════════════════════════════════════════════════

    def analyze(self, target: dict) -> AgentResult:
        """分析单个血缘来源。"""
        file_path = target["file_path"]
        target_type = target["target_type"]
        hints = target.get("hints", {})

        result = AgentResult(agent_name=self.name)

        if target_type == "data_source":
            # 分析实体数据源
            result = self._analyze_data_source(file_path, hints)
        elif target_type == "data_operation":
            # 分析数据操作
            result = self._analyze_data_operation(file_path, hints)

        return result

    def _analyze_data_source(self, file_path: str, hints: dict) -> AgentResult:
        """分析数据源（实体）。"""
        result = AgentResult(agent_name=self.name)

        entity_name = hints.get("entity_name")
        if not entity_name:
            return result

        # 获取实体信息
        entity_data = self.get_shared_knowledge(f"entity:{entity_name}", default={})
        if not entity_data:
            return result

        # 创建 DataSource 节点
        source_id = f"datasource:{entity_name}"

        table_name = entity_data.get("table_name", entity_name.lower())

        source_node = GraphNode(
            id=source_id,
            type=NodeType.DATA_SOURCE.value,
            name=table_name,
            properties={
                "entity_name": entity_name,
                "type": "table",
                "file_path": file_path,
            },
        )
        result.nodes.append(source_node)

        # 为每个字段创建数据对象
        fields = entity_data.get("fields", [])
        for field in fields:
            field_name = field.get("name")
            if not field_name:
                continue

            field_id = f"dataobject:{table_name}.{field_name}"

            field_node = GraphNode(
                id=field_id,
                type=NodeType.DATA_OBJECT.value,
                name=field_name,
                properties={
                    "column_name": field.get("column", field_name.lower()),
                    "data_type": field.get("type"),
                    "is_id": field.get("is_id", False),
                    "source_table": table_name,
                },
            )
            result.nodes.append(field_node)

            # 创建 belongs_to 边
            belong_edge = GraphEdge(
                from_=field_id,
                to=source_id,
                type=EdgeType.BELONGS_TO.value,
                properties={},
            )
            result.edges.append(belong_edge)

        result.confidence = 0.9
        return result

    def _analyze_data_operation(self, file_path: str, hints: dict) -> AgentResult:
        """分析数据操作。"""
        result = AgentResult(agent_name=self.name)

        operation = hints.get("operation")

        # 读取文件内容
        read_result = self.call_tool("read_file", path=file_path, max_size=65536)
        if not read_result.get("success"):
            return result

        content = read_result["content"]

        # 分析方法调用
        if operation in ["save", "insert", "update"]:
            # 写操作 -> 创建数据流
            self._analyze_write_operation(file_path, content, operation, result)
        elif operation in ["find", "get", "query", "select"]:
            # 读操作 -> 创建数据流
            self._analyze_read_operation(file_path, content, operation, result)

        result.confidence = 0.75
        return result

    def _analyze_write_operation(
        self,
        file_path: str,
        content: str,
        operation: str,
        result: AgentResult,
    ):
        """分析写操作。"""
        # 查找 save(entity) 模式
        patterns = [
            r'(\w+)\.save\((\w+)\)',
            r'(\w+)\.insert\((\w+)\)',
            r'(\w+)\.update\((\w+)\)',
        ]

        for pattern in patterns:
            for match in re.finditer(pattern, content):
                repo_name = match.group(1)
                entity_var = match.group(2)

                # 推断实体类型
                entity_type = self._infer_entity_type(repo_name, content)
                if entity_type:
                    # 创建 DataSink 节点
                    sink_id = f"datasink:{entity_type}"

                    sink_node = GraphNode(
                        id=sink_id,
                        type=NodeType.DATA_SINK.value,
                        name=entity_type,
                        properties={
                            "operation": operation,
                            "repository": repo_name,
                            "file_path": file_path,
                        },
                    )
                    result.nodes.append(sink_node)

    def _analyze_read_operation(
        self,
        file_path: str,
        content: str,
        operation: str,
        result: AgentResult,
    ):
        """分析读操作。"""
        # 查找 findById, findAll 模式
        patterns = [
            r'(\w+)\.findById\((\w+)\)',
            r'(\w+)\.findAll\(\)',
            r'(\w+)\.findBy(\w+)\(',
        ]

        for pattern in patterns:
            for match in re.finditer(pattern, content):
                repo_name = match.group(1)

                # 推断实体类型
                entity_type = self._infer_entity_type(repo_name, content)
                if entity_type:
                    # 创建 DataSource 节点
                    source_id = f"datasource:{entity_type}"

                    # 检查是否已存在
                    existing = [n for n in result.nodes if n.id == source_id]
                    if not existing:
                        source_node = GraphNode(
                            id=source_id,
                            type=NodeType.DATA_SOURCE.value,
                            name=entity_type,
                            properties={
                                "operation": operation,
                                "repository": repo_name,
                                "file_path": file_path,
                            },
                        )
                        result.nodes.append(source_node)

    def _infer_entity_type(self, repo_name: str, content: str) -> Optional[str]:
        """从 Repository 名称推断实体类型。"""
        # UserRepository -> User
        # OrderRepository -> Order
        if repo_name.endswith("Repository"):
            return repo_name[:-10]
        if repo_name.endswith("Mapper"):
            return repo_name[:-6]
        if repo_name.endswith("Dao"):
            return repo_name[:-3]

        # 尝试从泛型推断
        match = re.search(rf'{repo_name}.*?<(\w+)>', content)
        if match:
            return match.group(1)

        return None

    def _analyze_field_mapping(
        self,
        source_fields: list,
        target_fields: list,
        transformation: str,
    ) -> list[dict]:
        """分析字段映射关系。"""
        mappings = []

        # 简单的同名映射
        for source_field in source_fields:
            source_name = source_field.get("name", "")
            for target_field in target_fields:
                target_name = target_field.get("name", "")
                if source_name == target_name:
                    mappings.append({
                        "source_field": source_name,
                        "target_field": target_name,
                        "transformation": "direct",
                        "confidence": 0.95,
                    })

        # 存储映射
        key = f"{source_fields[0].get('entity', 'unknown')}_to_{target_fields[0].get('entity', 'unknown')}"
        self._field_mappings[key] = mappings

        return mappings

    # ═══════════════════════════════════════════════════════════════
    # Phase 3: Validate
    # ═══════════════════════════════════════════════════════════════

    def validate(self, result: AgentResult) -> tuple[bool, list[dict]]:
        """验证分析结果。"""
        issues = []
        is_valid = True

        node_ids = {n.id for n in result.nodes}

        for node in result.nodes:
            if node.type in [NodeType.DATA_SOURCE.value, NodeType.DATA_SINK.value]:
                # 检查数据源/目的地
                issue = self._validate_required_fields(node, ["name"])
                if issue:
                    issues.append(issue)

            elif node.type == NodeType.DATA_OBJECT.value:
                # 检查数据对象
                if not node.properties.get("source_table"):
                    issues.append({
                        "type": "missing_source",
                        "severity": "medium",
                        "message": f"数据对象 {node.name} 缺少源表信息",
                    })

        # 验证边的引用
        for edge in result.edges:
            if edge.type == EdgeType.FLOW_TO.value:
                if edge.from_ not in node_ids or edge.to not in node_ids:
                    issues.append({
                        "type": "broken_reference",
                        "severity": "medium",
                        "message": "血缘边引用无效节点",
                    })

        return is_valid, issues

    # ═══════════════════════════════════════════════════════════════
    # 高级功能：字段级血缘追踪
    # ═══════════════════════════════════════════════════════════════

    def trace_field_lineage(
        self,
        entity_name: str,
        field_name: str,
        direction: str = "upstream",
        depth: int = 3,
    ) -> dict:
        """追踪字段血缘。

        Args:
            entity_name: 实体名称
            field_name: 字段名称
            direction: 追踪方向 (upstream/downstream/both)
            depth: 追踪深度

        Returns:
            字段血缘信息
        """
        field_id = f"field:{entity_name}.{field_name}"

        lineage = {
            "field_id": field_id,
            "entity": entity_name,
            "field": field_name,
            "upstream": [],
            "downstream": [],
        }

        # 使用高级工具追踪
        if self.tool_executor and hasattr(self.tool_executor, "_advanced_tools"):
            flow_result = self.call_tool(
                "trace_data_flow",
                source=entity_name,
                target=field_name,
                scope="repository",
            )

            if flow_result.get("success"):
                lineage["flow_paths"] = flow_result.get("paths", [])

        return lineage
