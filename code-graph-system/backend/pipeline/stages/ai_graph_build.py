"""Stage 5: AI 图谱构建 — 构建图谱节点和边。

从 AI 分析结果构建图谱节点和边，包括：
- Entity 节点
- Table 节点
- Field 节点
- 关系边（one_to_one, one_to_many, many_to_many）
- 字段血缘边（flow_to）
"""
from __future__ import annotations

import logging
import time
from typing import Callable

from backend.graph.graph_schema import (
    GraphNode,
    GraphEdge,
    NodeType,
    EdgeType,
)
from backend.models.ai_first_analysis import (
    RepositoryScanResult,
    EntityAnalysisResult,
    FieldLineage,
    FieldLineageResult,
    DescriptionResult,
)
from backend.models.static_analysis import QualityReport, StageMetrics
from backend.pipeline.observer import AnalysisObserver, StageStarted, StageCompleted
from backend.pipeline.stages.base import StageBase

logger = logging.getLogger(__name__)


class AIGraphBuildStage(StageBase):
    """Stage 5: AI 图谱构建。

    从 AI 分析结果构建图谱节点和边。
    """

    name = "ai_graph_build"

    def run(
        self,
        scan_result: RepositoryScanResult,
        entity_results: list[EntityAnalysisResult],
        lineage_result: FieldLineageResult,
        description_result: DescriptionResult,
        observer: AnalysisObserver | None = None,
        on_progress: Callable[[dict], None] | None = None,
    ) -> tuple[list[GraphNode], list[GraphEdge], QualityReport]:
        """执行图谱构建。

        Args:
            scan_result: 仓库扫描结果
            entity_results: 实体分析结果列表
            lineage_result: 字段血缘结果
            description_result: 描述生成结果
            observer: 事件观察器
            on_progress: 进度回调

        Returns:
            (节点列表, 边列表, 质量报告)
        """
        start_time = time.time()

        # 发送开始事件
        if observer:
            observer.emit(StageStarted.create("ai_graph_build", file_count=len(entity_results)))

        if on_progress:
            on_progress({
                "step": "ai_graph_build",
                "status": "start",
                "message": "构建图谱...",
            })

        # 构建描述映射
        entity_desc_map = {
            d.entity_name: d
            for d in description_result.entity_descriptions
        }
        field_desc_map = {
            f"{d.entity_name}.{d.field_name}": d
            for d in description_result.field_descriptions
        }

        # 构建节点
        nodes: list[GraphNode] = []
        nodes.extend(self._create_entity_nodes(entity_results, entity_desc_map))
        nodes.extend(self._create_table_nodes(entity_results))
        nodes.extend(self._create_field_nodes(entity_results, field_desc_map))
        nodes.extend(self._create_service_nodes(scan_result))
        nodes.extend(self._create_flow_nodes(scan_result))

        # 构建边
        edges: list[GraphEdge] = []
        edges.extend(self._create_maps_to_edges(entity_results))
        edges.extend(self._create_has_field_edges(entity_results))
        edges.extend(self._create_relationship_edges(entity_results))
        edges.extend(self._create_lineage_edges(lineage_result))

        # 生成质量报告
        quality_report = self._build_quality_report(
            nodes=nodes,
            edges=edges,
            entity_results=entity_results,
            elapsed_ms=int((time.time() - start_time) * 1000),
        )

        elapsed_ms = int((time.time() - start_time) * 1000)

        # 发送完成事件
        if observer:
            observer.emit(StageCompleted.create("ai_graph_build", elapsed_ms, cache_hit=False))

        logger.info(
            "[ai_graph_build] 完成: %d 节点, %d 边, 耗时 %dms",
            len(nodes),
            len(edges),
            elapsed_ms,
        )

        if on_progress:
            on_progress({
                "step": "ai_graph_build",
                "status": "complete",
                "message": f"图谱构建完成: {len(nodes)} 节点, {len(edges)} 边",
                "node_count": len(nodes),
                "edge_count": len(edges),
            })

        return nodes, edges, quality_report

    def _create_entity_nodes(
        self,
        entity_results: list[EntityAnalysisResult],
        entity_desc_map: dict,
    ) -> list[GraphNode]:
        """创建 Entity 节点。"""
        nodes = []

        for entity in entity_results:
            desc = entity_desc_map.get(entity.entity_name)

            node = GraphNode(
                id=f"entity:{entity.entity_name}",
                type=NodeType.ENTITY.value,
                name=entity.entity_name,
                properties={
                    "table_name": entity.table_name,
                    "primary_key": entity.primary_key,
                    "file_path": entity.file_path,
                    "field_count": len(entity.fields),
                    "relationship_count": len(entity.relationships),
                    "description": desc.summary if desc else entity.description,
                    "role_in_system": desc.role_in_system if desc else "",
                    "core_fields": desc.core_fields if desc else [],
                    "importance_score": desc.importance_score if desc else 5,
                    "importance_reason": desc.importance_reason if desc else "",
                    "business_domain": desc.business_domain if desc else "",
                    "source": "ai_analyzed",
                    "confidence": entity.confidence,
                },
            )
            nodes.append(node)

        return nodes

    def _create_table_nodes(
        self,
        entity_results: list[EntityAnalysisResult],
    ) -> list[GraphNode]:
        """创建 Table 节点。"""
        nodes = []
        seen_tables = set()

        for entity in entity_results:
            if not entity.table_name or entity.table_name in seen_tables:
                continue

            seen_tables.add(entity.table_name)

            node = GraphNode(
                id=f"table:{entity.table_name}",
                type=NodeType.TABLE.value,
                name=entity.table_name,
                properties={
                    "entity_name": entity.entity_name,
                    "source": "ai_analyzed",
                },
            )
            nodes.append(node)

        return nodes

    def _create_field_nodes(
        self,
        entity_results: list[EntityAnalysisResult],
        field_desc_map: dict,
    ) -> list[GraphNode]:
        """创建 Field 节点。"""
        nodes = []

        for entity in entity_results:
            for field in entity.fields:
                field_key = f"{entity.entity_name}.{field.name}"
                desc = field_desc_map.get(field_key)

                node = GraphNode(
                    id=f"field:{entity.entity_name}.{field.name}",
                    type=NodeType.FIELD.value,
                    name=field.name,
                    properties={
                        "entity_name": entity.entity_name,
                        "type": field.type,
                        "column_name": field.column_name,
                        "is_primary_key": field.is_primary_key,
                        "is_foreign_key": field.is_foreign_key,
                        "is_nullable": field.is_nullable,
                        "references_entity": field.references_entity,
                        "references_field": field.references_field,
                        "description": desc.description if desc else field.description,
                        "business_meaning": desc.business_meaning if desc else "",
                        "usage_scenario": desc.usage_scenario if desc else "",
                        "data_pattern": desc.data_pattern if desc else "",
                        "source": "ai_analyzed",
                    },
                )
                nodes.append(node)

        return nodes

    def _create_service_nodes(
        self,
        scan_result: RepositoryScanResult,
    ) -> list[GraphNode]:
        """创建 Service 节点。"""
        nodes = []

        for service in scan_result.services:
            node = GraphNode(
                id=f"service:{service.class_name}",
                type=NodeType.SERVICE.value,
                name=service.class_name,
                properties={
                    "file_path": service.file_path,
                    "service_type": service.service_type,
                    "annotations": service.annotations,
                    "description": service.brief_description,
                    "source": "ai_analyzed",
                },
            )
            nodes.append(node)

        return nodes

    def _create_flow_nodes(
        self,
        scan_result: RepositoryScanResult,
    ) -> list[GraphNode]:
        """创建 Flow 节点。"""
        nodes = []

        for flow in scan_result.flows:
            node = GraphNode(
                id=f"flow:{flow.class_name}",
                type=NodeType.FLOW.value,
                name=flow.class_name,
                properties={
                    "file_path": flow.file_path,
                    "flow_type": flow.flow_type,
                    "key": flow.key,
                    "description": flow.brief_description,
                    "source": "ai_analyzed",
                },
            )
            nodes.append(node)

        for flow_node in scan_result.flow_nodes:
            node = GraphNode(
                id=f"flow_node:{flow_node.class_name}",
                type=NodeType.FLOW_NODE.value,
                name=flow_node.class_name,
                properties={
                    "file_path": flow_node.file_path,
                    "node_type": flow_node.node_type,
                    "parent_flow": flow_node.parent_flow,
                    "description": flow_node.brief_description,
                    "source": "ai_analyzed",
                },
            )
            nodes.append(node)

        return nodes

    def _create_maps_to_edges(
        self,
        entity_results: list[EntityAnalysisResult],
    ) -> list[GraphEdge]:
        """创建 maps_to 边（Entity → Table）。"""
        edges = []

        for entity in entity_results:
            if not entity.table_name:
                continue

            edge = GraphEdge(
                from_=f"entity:{entity.entity_name}",
                to=f"table:{entity.table_name}",
                type=EdgeType.MAPS_TO.value,
                properties={
                    "source": "ai_analyzed",
                },
            )
            edges.append(edge)

        return edges

    def _create_has_field_edges(
        self,
        entity_results: list[EntityAnalysisResult],
    ) -> list[GraphEdge]:
        """创建 has_field 边（Entity → Field）。"""
        edges = []

        for entity in entity_results:
            for field in entity.fields:
                edge = GraphEdge(
                    from_=f"entity:{entity.entity_name}",
                    to=f"field:{entity.entity_name}.{field.name}",
                    type=EdgeType.HAS_FIELD.value,
                    properties={
                        "source": "ai_analyzed",
                        "is_primary_key": field.is_primary_key,
                        "is_foreign_key": field.is_foreign_key,
                    },
                )
                edges.append(edge)

        return edges

    def _create_relationship_edges(
        self,
        entity_results: list[EntityAnalysisResult],
    ) -> list[GraphEdge]:
        """创建关系边（one_to_one, one_to_many, many_to_many）。"""
        edges = []

        # 边类型映射
        rel_type_to_edge_type = {
            "one_to_one": EdgeType.ONE_TO_ONE,
            "one_to_many": EdgeType.ONE_TO_MANY,
            "many_to_one": EdgeType.MANY_TO_ONE,
            "many_to_many": EdgeType.MANY_TO_MANY,
        }

        for entity in entity_results:
            for rel in entity.relationships:
                edge_type = rel_type_to_edge_type.get(rel.relation_type)
                if not edge_type:
                    continue

                edge = GraphEdge(
                    from_=f"entity:{entity.entity_name}",
                    to=f"entity:{rel.target_entity}",
                    type=edge_type.value,
                    properties={
                        "source_field": rel.source_field,
                        "target_field": rel.target_field,
                        "join_table": rel.join_table,
                        "join_column": rel.join_column,
                        "description": rel.description,
                        "source": "ai_analyzed",
                        "confidence": rel.confidence,
                    },
                )
                edges.append(edge)

        return edges

    def _create_lineage_edges(
        self,
        lineage_result: FieldLineageResult,
    ) -> list[GraphEdge]:
        """创建字段血缘边（flow_to）。"""
        edges = []

        for lineage in lineage_result.lineages:
            edge = GraphEdge(
                from_=f"field:{lineage.from_entity}.{lineage.from_field}",
                to=f"field:{lineage.to_entity}.{lineage.to_field}",
                type=EdgeType.FLOW_TO.value,
                properties={
                    "from_entity": lineage.from_entity,
                    "from_field": lineage.from_field,
                    "to_entity": lineage.to_entity,
                    "to_field": lineage.to_field,
                    "flow_type": lineage.flow_type,
                    "flow_pattern": lineage.flow_pattern,
                    "transformation": lineage.transformation,
                    "condition": lineage.condition,
                    "intermediate_methods": lineage.intermediate_methods,
                    "description": lineage.description,
                    "source": "ai_analyzed",
                    "confidence": lineage.confidence,
                },
            )
            edges.append(edge)

        return edges

    def _build_quality_report(
        self,
        nodes: list[GraphNode],
        edges: list[GraphEdge],
        entity_results: list[EntityAnalysisResult],
        elapsed_ms: int,
    ) -> QualityReport:
        """构建质量报告。"""
        # 统计节点类型
        node_type_counts: dict[str, int] = {}
        for node in nodes:
            node_type_counts[node.type] = node_type_counts.get(node.type, 0) + 1

        # 统计边类型
        edge_type_counts: dict[str, int] = {}
        for edge in edges:
            edge_type_counts[edge.type] = edge_type_counts.get(edge.type, 0) + 1

        # 计算平均重要性评分
        importance_scores = [
            n.properties.get("importance_score", 5)
            for n in nodes
            if n.type == NodeType.ENTITY.value
        ]
        avg_importance = (
            sum(importance_scores) / len(importance_scores)
            if importance_scores else 5
        )

        # 构建 stage metrics
        stage_metrics = {
            "ai_graph_build": StageMetrics(
                duration_ms=elapsed_ms,
                llm_calls=0,  # 此阶段无 LLM 调用
            ),
        }

        return QualityReport(
            stage_metrics=stage_metrics,
            warnings=[],
            errors=[],
        )
