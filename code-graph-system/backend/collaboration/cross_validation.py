"""跨 Agent 验证层。

检测不同 Agent 分析结果之间的冲突和一致性问题。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional

from backend.graph.graph_schema import GraphEdge, GraphNode

logger = logging.getLogger(__name__)


class ConflictType(Enum):
    """冲突类型。"""
    DUPLICATE_NODE = "duplicate_node"  # 不同 Agent 创建了相同 ID 的节点但内容不同
    CONTRADICTORY_RELATION = "contradictory_relation"  # 关系矛盾（如 A->B 和 A!->B）
    MISSING_REFERENCE = "missing_reference"  # 引用的节点不存在
    CONFIDENCE_MISMATCH = "confidence_mismatch"  # 置信度差异过大
    ATTRIBUTE_CONFLICT = "attribute_conflict"  # 属性值冲突
    TYPE_MISMATCH = "type_mismatch"  # 类型不匹配


class ConflictSeverity(Enum):
    """冲突严重程度。"""
    LOW = "low"  # 可忽略的差异
    MEDIUM = "medium"  # 需要关注的差异
    HIGH = "high"  # 必须解决的冲突
    CRITICAL = "critical"  # 阻塞性冲突


@dataclass
class ConflictInfo:
    """冲突信息。"""
    conflict_id: str
    conflict_type: ConflictType
    severity: ConflictSeverity
    agents: list[str]  # 涉及的 Agent
    description: str
    nodes_involved: list[str] = field(default_factory=list)
    edges_involved: list[str] = field(default_factory=list)
    details: dict = field(default_factory=dict)
    resolution_hint: Optional[str] = None


class CrossValidationLayer:
    """跨 Agent 验证层。

    职责：
    1. 合并多个 Agent 的分析结果
    2. 检测结果间的冲突
    3. 生成冲突报告
    4. 提供解决建议

    使用示例：
        validator = CrossValidationLayer()

        # 添加各 Agent 的结果
        validator.add_result("EntityAgent", entity_result)
        validator.add_result("ServiceAgent", service_result)

        # 检测冲突
        conflicts = validator.detect_conflicts()

        # 获取合并后的结果
        merged_nodes, merged_edges = validator.get_merged_results()
    """

    def __init__(self):
        """初始化验证层。"""
        self._results: dict[str, AgentResult] = {}
        self._conflicts: list[ConflictInfo] = []
        self._node_index: dict[str, tuple[str, GraphNode]] = {}  # node_id -> (agent_name, node)
        self._edge_index: dict[str, tuple[str, GraphEdge]] = {}  # edge_key -> (agent_name, edge)

    # ═══════════════════════════════════════════════════════════════
    # 结果收集
    # ═══════════════════════════════════════════════════════════════

    def add_result(self, agent_name: str, result: AgentResult) -> None:
        """添加 Agent 的分析结果。

        Args:
            agent_name: Agent 名称
            result: 分析结果
        """
        self._results[agent_name] = result

        # 建立索引
        for node in result.nodes:
            if node.id in self._node_index:
                # 已存在，记录潜在冲突
                existing_agent, existing_node = self._node_index[node.id]
                if existing_agent != agent_name:
                    self._check_node_conflict(existing_agent, existing_node, agent_name, node)
            else:
                self._node_index[node.id] = (agent_name, node)

        for edge in result.edges:
            edge_key = f"{edge.from_}->{edge.to}:{edge.type}"
            if edge_key in self._edge_index:
                existing_agent, existing_edge = self._edge_index[edge_key]
                if existing_agent != agent_name:
                    self._check_edge_conflict(existing_agent, existing_edge, agent_name, edge)
            else:
                self._edge_index[edge_key] = (agent_name, edge)

        logger.debug(
            "[CrossValidation] 添加结果: %s, nodes=%d, edges=%d",
            agent_name, len(result.nodes), len(result.edges)
        )

    # ═══════════════════════════════════════════════════════════════
    # 冲突检测
    # ═══════════════════════════════════════════════════════════════

    def detect_conflicts(self) -> list[ConflictInfo]:
        """检测所有冲突。

        注意：此方法会保留 add_result 时已检测到的冲突，并添加新检测到的冲突。
        """
        # 保留已有的冲突（在 add_result 时检测到的）
        existing_conflicts = self._conflicts.copy()
        self._conflicts = []

        # 1. 检测重复节点冲突（已在 add_result 中检测）
        self._detect_duplicate_nodes()

        # 2. 检测引用完整性
        self._detect_missing_references()

        # 3. 检测关系矛盾
        self._detect_contradictory_relations()

        # 4. 检测置信度差异
        self._detect_confidence_mismatches()

        # 合并已有冲突
        # 使用 dict 去重（按 conflict_id）
        conflict_map = {c.conflict_id: c for c in existing_conflicts}
        for c in self._conflicts:
            conflict_map[c.conflict_id] = c
        self._conflicts = list(conflict_map.values())

        logger.info(
            "[CrossValidation] 检测完成: %d 个冲突",
            len(self._conflicts)
        )

        return self._conflicts

    def _check_node_conflict(
        self,
        agent1: str,
        node1: GraphNode,
        agent2: str,
        node2: GraphNode,
    ) -> None:
        """检查节点冲突。"""
        # 类型冲突
        if node1.type != node2.type:
            self._conflicts.append(ConflictInfo(
                conflict_id=f"node_type:{node1.id}",
                conflict_type=ConflictType.TYPE_MISMATCH,
                severity=ConflictSeverity.HIGH,
                agents=[agent1, agent2],
                description=f"节点 {node1.id} 类型冲突: {node1.type} vs {node2.type}",
                nodes_involved=[node1.id],
                details={
                    "type1": node1.type,
                    "type2": node2.type,
                },
                resolution_hint="选择置信度更高的类型，或通过仲裁决定",
            ))

        # 属性冲突
        conflicting_props = self._find_conflicting_properties(
            node1.properties or {},
            node2.properties or {},
        )
        if conflicting_props:
            self._conflicts.append(ConflictInfo(
                conflict_id=f"node_props:{node1.id}",
                conflict_type=ConflictType.ATTRIBUTE_CONFLICT,
                severity=ConflictSeverity.MEDIUM,
                agents=[agent1, agent2],
                description=f"节点 {node1.id} 属性冲突: {conflicting_props}",
                nodes_involved=[node1.id],
                details={"conflicting_properties": conflicting_props},
                resolution_hint="合并属性或选择非空值",
            ))

    def _check_edge_conflict(
        self,
        agent1: str,
        edge1: GraphEdge,
        agent2: str,
        edge2: GraphEdge,
    ) -> None:
        """检查边冲突。"""
        # 属性冲突
        conflicting_props = self._find_conflicting_properties(
            edge1.properties or {},
            edge2.properties or {},
        )
        if conflicting_props:
            edge_key = f"{edge1.from_}->{edge1.to}:{edge1.type}"
            self._conflicts.append(ConflictInfo(
                conflict_id=f"edge_props:{edge_key}",
                conflict_type=ConflictType.ATTRIBUTE_CONFLICT,
                severity=ConflictSeverity.LOW,
                agents=[agent1, agent2],
                description=f"边属性冲突: {edge_key}",
                edges_involved=[edge_key],
                details={"conflicting_properties": conflicting_props},
            ))

    def _detect_duplicate_nodes(self) -> None:
        """检测重复节点。"""
        # 已在 add_result 中处理
        pass

    def _detect_missing_references(self) -> None:
        """检测缺失引用。"""
        node_ids = set(self._node_index.keys())

        for edge_key, (agent_name, edge) in self._edge_index.items():
            if edge.from_ not in node_ids:
                self._conflicts.append(ConflictInfo(
                    conflict_id=f"missing_from:{edge_key}",
                    conflict_type=ConflictType.MISSING_REFERENCE,
                    severity=ConflictSeverity.MEDIUM,
                    agents=[agent_name],
                    description=f"边源节点不存在: {edge.from_}",
                    edges_involved=[edge_key],
                    details={"missing_node": edge.from_},
                    resolution_hint="创建缺失节点或移除无效边",
                ))

            if edge.to not in node_ids:
                self._conflicts.append(ConflictInfo(
                    conflict_id=f"missing_to:{edge_key}",
                    conflict_type=ConflictType.MISSING_REFERENCE,
                    severity=ConflictSeverity.MEDIUM,
                    agents=[agent_name],
                    description=f"边目标节点不存在: {edge.to}",
                    edges_involved=[edge_key],
                    details={"missing_node": edge.to},
                    resolution_hint="创建缺失节点或移除无效边",
                ))

    def _detect_contradictory_relations(self) -> None:
        """检测矛盾关系。"""
        # 收集同一对节点间的所有边
        node_pair_edges: dict[tuple[str, str], list[tuple[str, GraphEdge]]] = {}

        for edge_key, (agent_name, edge) in self._edge_index.items():
            key = (edge.from_, edge.to)
            if key not in node_pair_edges:
                node_pair_edges[key] = []
            node_pair_edges[key].append((agent_name, edge))

        # 检查矛盾
        for (from_id, to_id), edges in node_pair_edges.items():
            edge_types = set(e.type for _, e in edges)

            # 检查是否同时存在依赖和非依赖
            if "depends_on" in edge_types and "independent_of" in edge_types:
                self._conflicts.append(ConflictInfo(
                    conflict_id=f"contradict:{from_id}->{to_id}",
                    conflict_type=ConflictType.CONTRADICTORY_RELATION,
                    severity=ConflictSeverity.HIGH,
                    agents=[a for a, _ in edges],
                    description=f"关系矛盾: {from_id} 和 {to_id} 之间",
                    nodes_involved=[from_id, to_id],
                    resolution_hint="通过置信度决定保留哪个关系",
                ))

    def _detect_confidence_mismatches(self) -> None:
        """检测置信度差异。"""
        for agent_name, result in self._results.items():
            # 检查节点置信度
            for node in result.nodes:
                node_conf = node.properties.get("confidence", 1.0)
                if hasattr(result, 'confidence') and abs(node_conf - result.confidence) > 0.3:
                    self._conflicts.append(ConflictInfo(
                        conflict_id=f"conf_mismatch:{node.id}",
                        conflict_type=ConflictType.CONFIDENCE_MISMATCH,
                        severity=ConflictSeverity.LOW,
                        agents=[agent_name],
                        description=f"节点 {node.id} 置信度与 Agent 整体置信度差异过大",
                        nodes_involved=[node.id],
                        details={
                            "node_confidence": node_conf,
                            "agent_confidence": result.confidence,
                        },
                    ))

    def _find_conflicting_properties(
        self,
        props1: dict,
        props2: dict,
    ) -> list[str]:
        """查找冲突的属性。"""
        conflicts = []

        for key in set(props1.keys()) & set(props2.keys()):
            val1, val2 = props1[key], props2[key]

            # 忽略 None 值
            if val1 is None or val2 is None:
                continue

            # 比较
            if val1 != val2:
                # 忽略小的浮点数差异
                if isinstance(val1, (int, float)) and isinstance(val2, (int, float)):
                    if abs(val1 - val2) < 0.01:
                        continue

                conflicts.append(key)

        return conflicts

    # ═══════════════════════════════════════════════════════════════
    # 结果合并
    # ═══════════════════════════════════════════════════════════════

    def get_merged_results(self) -> tuple[list[GraphNode], list[GraphEdge]]:
        """获取合并后的结果。

        Returns:
            (nodes, edges) 合并后的节点和边列表
        """
        nodes = []
        edges = []

        # 按置信度排序的节点
        for node_id, (agent_name, node) in sorted(
            self._node_index.items(),
            key=lambda x: self._results[x[1][0]].confidence,
            reverse=True,
        ):
            nodes.append(node)

        # 边
        for edge_key, (agent_name, edge) in self._edge_index.items():
            edges.append(edge)

        return nodes, edges

    def get_conflicts_by_severity(self, severity: ConflictSeverity) -> list[ConflictInfo]:
        """按严重程度获取冲突。"""
        return [c for c in self._conflicts if c.severity == severity]

    def get_conflicts_by_agent(self, agent_name: str) -> list[ConflictInfo]:
        """按 Agent 获取相关冲突。"""
        return [c for c in self._conflicts if agent_name in c.agents]

    def get_stats(self) -> dict:
        """获取统计信息。"""
        severity_counts = {}
        for severity in ConflictSeverity:
            severity_counts[severity.value] = len([
                c for c in self._conflicts if c.severity == severity
            ])

        return {
            "total_conflicts": len(self._conflicts),
            "by_severity": severity_counts,
            "agents_involved": list(self._results.keys()),
            "node_count": len(self._node_index),
            "edge_count": len(self._edge_index),
        }


# 延迟导入避免循环依赖
from backend.agent_v2.base_agent import AgentResult
