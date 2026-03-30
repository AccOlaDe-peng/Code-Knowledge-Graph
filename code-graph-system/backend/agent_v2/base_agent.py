"""领域 Agent 基类实现。"""

from __future__ import annotations

import logging
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional

from backend.graph.graph_schema import GraphEdge, GraphNode

logger = logging.getLogger(__name__)


class AgentPhase(Enum):
    """Agent 分析阶段。"""
    DISCOVERY = "discovery"
    ANALYSIS = "analysis"
    VALIDATE = "validate"


@dataclass
class AgentContext:
    """Agent 运行上下文。"""
    repo_path: str
    knowledge_hub: Any  # KnowledgeHub
    tool_executor: Any  # ToolExecutor
    config: dict = field(default_factory=dict)
    iteration: int = 0
    max_iterations: int = 3


@dataclass
class AgentResult:
    """Agent 分析结果。"""
    agent_name: str
    nodes: list[GraphNode] = field(default_factory=list)
    edges: list[GraphEdge] = field(default_factory=list)
    confidence: float = 1.0
    issues: list[dict] = field(default_factory=list)
    metadata: dict = field(default_factory=dict)

    def merge(self, other: AgentResult) -> AgentResult:
        """合并另一个结果。"""
        self.nodes.extend(other.nodes)
        self.edges.extend(other.edges)
        self.confidence = min(self.confidence, other.confidence)
        self.issues.extend(other.issues)
        return self


class DomainAgent(ABC):
    """领域 Agent 基类。

    每个 Agent 遵循三阶段工作流：
    1. Discovery: 发现分析目标
    2. Analysis: 执行深度分析
    3. Validate: 验证结果质量
    """

    def __init__(self, context: AgentContext):
        self.context = context
        self.name = self.__class__.__name__
        self._phase = AgentPhase.DISCOVERY
        self._targets: list[dict] = []
        self._results: list[AgentResult] = []
        self._start_time: float = 0

    @property
    def knowledge_hub(self):
        """获取知识中心。"""
        return self.context.knowledge_hub

    @property
    def tool_executor(self):
        """获取工具执行器。"""
        return self.context.tool_executor

    @property
    def current_iteration(self) -> int:
        """当前迭代次数。"""
        return self.context.iteration

    # ═══════════════════════════════════════════════════════════════
    # 抽象方法（子类实现）
    # ═══════════════════════════════════════════════════════════════

    @abstractmethod
    def discover(self) -> list[dict]:
        """发现分析目标。

        Returns:
            目标列表，每个目标是一个 dict，包含：
            - target_id: 目标唯一标识
            - target_type: 目标类型
            - file_path: 相关文件路径
            - hints: 额外提示信息
        """
        pass

    @abstractmethod
    def analyze(self, target: dict) -> AgentResult:
        """分析单个目标。

        Args:
            target: 从 discover() 返回的目标

        Returns:
            分析结果（节点 + 边 + 置信度）
        """
        pass

    @abstractmethod
    def validate(self, result: AgentResult) -> tuple[bool, list[dict]]:
        """验证分析结果。

        Args:
            result: analyze() 返回的结果

        Returns:
            (is_valid, issues) 元组
            - is_valid: 结果是否通过验证
            - issues: 问题列表，每个问题包含：
              - type: 问题类型
              - severity: 严重程度 (low/medium/high)
              - message: 问题描述
              - suggestion: 修复建议
        """
        pass

    # ═══════════════════════════════════════════════════════════════
    # 主入口
    # ═══════════════════════════════════════════════════════════════

    def run(self) -> AgentResult:
        """执行完整分析流程。

        流程：
        1. Discovery → 发现目标
        2. Analysis → 并行/串行分析各目标
        3. Validate → 验证结果

        Returns:
            合并后的分析结果
        """
        self._start_time = time.time()
        final_result = AgentResult(agent_name=self.name)

        # Phase 1: Discovery
        self._phase = AgentPhase.DISCOVERY
        logger.info("[%s] Phase 1: Discovery", self.name)
        self._targets = self.discover()
        logger.info("[%s] 发现 %d 个目标", self.name, len(self._targets))

        # 发布发现事件
        self._publish_discovery_event()

        # Phase 2: Analysis
        self._phase = AgentPhase.ANALYSIS
        logger.info("[%s] Phase 2: Analysis", self.name)

        for target in self._targets:
            result = self.analyze(target)

            # Phase 3: Validate（每个目标分析后立即验证）
            self._phase = AgentPhase.VALIDATE
            is_valid, issues = self.validate(result)

            if issues:
                result.issues = issues
                result.confidence *= 0.9 if is_valid else 0.7

            self._results.append(result)
            final_result.merge(result)

            # 发布分析事件
            self._publish_analysis_event(target, result)

            # 切回 Analysis 阶段
            self._phase = AgentPhase.ANALYSIS

        # 计算最终置信度
        final_result.confidence = self._calculate_final_confidence()
        final_result.metadata = {
            "iteration": self.current_iteration,
            "target_count": len(self._targets),
            "elapsed_seconds": time.time() - self._start_time,
        }

        logger.info(
            "[%s] 完成: %d nodes, %d edges, confidence=%.2f",
            self.name, len(final_result.nodes), len(final_result.edges),
            final_result.confidence
        )

        return final_result

    def refine(self, hints: dict) -> AgentResult:
        """增量优化分析。

        Args:
            hints: 优化提示，包含：
            - target_ids: 需要重新分析的目标 ID 列表
            - focus_areas: 需要关注的领域
            - related_entities: 相关实体
            - conflict_info: 冲突信息

        Returns:
            优化后的分析结果
        """
        target_ids = hints.get("target_ids", [])
        focus_areas = hints.get("focus_areas", [])

        # 过滤需要重新分析的目标
        targets_to_refine = [
            t for t in self._targets
            if t.get("target_id") in target_ids
        ]

        if not targets_to_refine and not focus_areas:
            # 无明确目标，根据 focus_areas 重新发现
            self._targets = self.discover()
            targets_to_refine = self._targets

        logger.info(
            "[%s] Refine: %d targets, focus=%s",
            self.name, len(targets_to_refine), focus_areas
        )

        refine_result = AgentResult(agent_name=f"{self.name}.refine")

        for target in targets_to_refine:
            # 将 hints 注入目标
            target["_hints"] = hints

            result = self.analyze(target)
            is_valid, issues = self.validate(result)

            if issues:
                result.issues = issues

            refine_result.merge(result)

        refine_result.metadata["refined_targets"] = [t["target_id"] for t in targets_to_refine]

        return refine_result

    # ═══════════════════════════════════════════════════════════════
    # 辅助方法
    # ═══════════════════════════════════════════════════════════════

    def call_tool(self, tool_name: str, **kwargs) -> dict:
        """调用工具。"""
        result = self.tool_executor.execute(tool_name, kwargs)
        # 将 ToolResult 转换为 dict
        if hasattr(result, 'status'):
            if result.status.value == 'success':
                return result.data or {"success": True}
            else:
                return {"success": False, "error": result.error}
        return result if isinstance(result, dict) else {"success": True, "data": result}

    def get_shared_knowledge(self, key: str, default: Any = None) -> Any:
        """获取共享知识。"""
        return self.knowledge_hub.query(key, default)

    def set_shared_knowledge(self, key: str, value: Any, confidence: float = 1.0):
        """设置共享知识。"""
        self.knowledge_hub.publish(key, value, self.name, confidence)

    def subscribe_event(self, event_type: str, callback):
        """订阅知识事件。"""
        self.knowledge_hub.subscribe(event_type, callback)

    def _publish_discovery_event(self):
        """发布发现阶段事件。"""
        from backend.knowledge.events import KnowledgeEvent, KnowledgeEventType

        event = KnowledgeEvent(
            event_type=KnowledgeEventType.DISCOVERY_COMPLETE,
            agent_name=self.name,
            data={
                "target_count": len(self._targets),
                "targets": [
                    {"id": t["target_id"], "type": t["target_type"]}
                    for t in self._targets[:10]  # 限制数量
                ],
            },
        )
        self.knowledge_hub.emit_event(event)

    def _publish_analysis_event(self, target: dict, result: AgentResult):
        """发布分析完成事件。"""
        from backend.knowledge.events import KnowledgeEvent, KnowledgeEventType

        event_type_map = {
            "entity": KnowledgeEventType.ENTITY_ANALYZED,
            "service": KnowledgeEventType.SERVICE_ANALYZED,
            "flow": KnowledgeEventType.FLOW_ANALYZED,
            "lineage": KnowledgeEventType.LINEAGE_TRACED,
            "topic": KnowledgeEventType.TOPIC_DISCOVERED,
        }

        event_type = event_type_map.get(
            target.get("target_type", ""),
            KnowledgeEventType.ANALYSIS_PROGRESS
        )

        event = KnowledgeEvent(
            event_type=event_type,
            agent_name=self.name,
            data={
                "target_id": target["target_id"],
                "node_count": len(result.nodes),
                "edge_count": len(result.edges),
                "confidence": result.confidence,
            },
        )
        self.knowledge_hub.emit_event(event)

    def _calculate_final_confidence(self) -> float:
        """计算最终置信度。"""
        if not self._results:
            return 1.0

        # 基础置信度：所有结果的加权平均
        total_confidence = sum(r.confidence for r in self._results)
        avg_confidence = total_confidence / len(self._results)

        # 迭代惩罚
        iteration_penalty = 0.95 ** self.current_iteration

        # 问题惩罚
        total_issues = sum(len(r.issues) for r in self._results)
        issue_penalty = max(0.5, 1.0 - 0.05 * total_issues)

        final = avg_confidence * iteration_penalty * issue_penalty
        return max(0.0, min(1.0, final))

    # ═══════════════════════════════════════════════════════════════
    # 通用验证规则
    # ═══════════════════════════════════════════════════════════════

    def _validate_required_fields(
        self,
        node: GraphNode,
        required: list[str],
    ) -> Optional[dict]:
        """验证节点必填字段。"""
        missing = []
        for field in required:
            if field == "name":
                if not node.name:
                    missing.append(field)
            elif field == "properties":
                if not node.properties:
                    missing.append(field)
            else:
                if field not in (node.properties or {}):
                    missing.append(field)

        if missing:
            return {
                "type": "missing_fields",
                "severity": "high",
                "message": f"节点 {node.id} 缺少必填字段: {missing}",
                "suggestion": f"补充字段: {', '.join(missing)}",
            }
        return None

    def _validate_edge_references(
        self,
        edge: GraphEdge,
        node_ids: set[str],
    ) -> Optional[dict]:
        """验证边的引用完整性。"""
        issues = []
        if edge.from_ not in node_ids:
            issues.append(f"源节点 {edge.from_} 不存在")
        if edge.to not in node_ids:
            issues.append(f"目标节点 {edge.to} 不存在")

        if issues:
            return {
                "type": "broken_reference",
                "severity": "high",
                "message": f"边 {edge.type} 引用无效: {'; '.join(issues)}",
                "suggestion": "检查节点 ID 或移除无效边",
            }
        return None

    def _validate_naming_convention(
        self,
        name: str,
        pattern: str = "standard",
    ) -> Optional[dict]:
        """验证命名规范。"""
        import re

        patterns = {
            "standard": r"^[a-zA-Z_][a-zA-Z0-9_]*$",
            "camelCase": r"^[a-z][a-zA-Z0-9]*$",
            "PascalCase": r"^[A-Z][a-zA-Z0-9]*$",
            "snake_case": r"^[a-z][a-z0-9_]*$",
            "UPPER_SNAKE": r"^[A-Z][A-Z0-9_]*$",
        }

        regex = patterns.get(pattern, patterns["standard"])
        if not re.match(regex, name):
            return {
                "type": "naming_violation",
                "severity": "low",
                "message": f"名称 '{name}' 不符合 {pattern} 规范",
                "suggestion": f"重命名为符合 {pattern} 规范的名称",
            }
        return None
