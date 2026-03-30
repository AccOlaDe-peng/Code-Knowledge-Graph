"""冲突仲裁器。

解决 Agent 间的结果冲突，决定最终结果。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional

from backend.graph.graph_schema import GraphEdge, GraphNode

logger = logging.getLogger(__name__)


class ResolutionStrategy(Enum):
    """解决策略。"""
    HIGHEST_CONFIDENCE = "highest_confidence"  # 选择置信度最高的
    MAJORITY_VOTE = "majority_vote"  # 多数投票
    FIRST_WINS = "first_wins"  # 先到先得
    MERGE = "merge"  # 合并结果
    LLM_DECIDE = "llm_decide"  # LLM 决定
    MANUAL = "manual"  # 需要人工干预


@dataclass
class ArbitrationResult:
    """仲裁结果。"""
    conflict_id: str
    resolved: bool
    strategy: ResolutionStrategy
    winner: Optional[str] = None  # 获胜的 Agent
    final_value: Any = None  # 最终值
    reasoning: str = ""
    confidence: float = 1.0


class Arbitrator:
    """冲突仲裁器。

    职责：
    1. 接收冲突信息
    2. 应用解决策略
    3. 生成仲裁结果
    4. 更新最终结果

    使用示例：
        arbitrator = Arbitrator()

        # 设置策略
        arbitrator.set_strategy(ResolutionStrategy.HIGHEST_CONFIDENCE)

        # 仲裁冲突
        result = arbitrator.arbitrate(conflict_info, context)

        # 应用结果
        arbitrator.apply_result(result, merged_nodes, merged_edges)
    """

    # 默认策略映射（按冲突类型）
    DEFAULT_STRATEGIES = {
        "duplicate_node": ResolutionStrategy.HIGHEST_CONFIDENCE,
        "contradictory_relation": ResolutionStrategy.HIGHEST_CONFIDENCE,
        "missing_reference": ResolutionStrategy.MERGE,
        "confidence_mismatch": ResolutionStrategy.HIGHEST_CONFIDENCE,
        "attribute_conflict": ResolutionStrategy.MERGE,
        "type_mismatch": ResolutionStrategy.HIGHEST_CONFIDENCE,
    }

    def __init__(self, llm_client: Any = None):
        """初始化仲裁器。

        Args:
            llm_client: LLM 客户端（用于 LLM_DECIDE 策略）
        """
        self._llm_client = llm_client
        self._strategies: dict[str, ResolutionStrategy] = dict(self.DEFAULT_STRATEGIES)
        self._results: list[ArbitrationResult] = []
        self._agent_priorities: dict[str, float] = {}

    def set_strategy(
        self,
        conflict_type: str,
        strategy: ResolutionStrategy,
    ) -> None:
        """设置特定冲突类型的解决策略。"""
        self._strategies[conflict_type] = strategy

    def set_agent_priority(self, agent_name: str, priority: float) -> None:
        """设置 Agent 优先级。"""
        self._agent_priorities[agent_name] = priority

    # ═══════════════════════════════════════════════════════════════
    # 仲裁入口
    # ═══════════════════════════════════════════════════════════════

    def arbitrate(
        self,
        conflict: Any,  # ConflictInfo
        context: dict,
    ) -> ArbitrationResult:
        """仲裁冲突。

        Args:
            conflict: 冲突信息
            context: 上下文（包含各 Agent 的结果等）

        Returns:
            ArbitrationResult: 仲裁结果
        """
        from backend.collaboration.cross_validation import ConflictType, ConflictSeverity

        conflict_type = conflict.conflict_type.value
        strategy = self._strategies.get(conflict_type, ResolutionStrategy.HIGHEST_CONFIDENCE)

        logger.debug(
            "[Arbitrator] 仲裁冲突: %s, 策略=%s",
            conflict.conflict_id, strategy.value
        )

        # 根据策略执行仲裁
        if strategy == ResolutionStrategy.HIGHEST_CONFIDENCE:
            result = self._arbitrate_by_confidence(conflict, context)
        elif strategy == ResolutionStrategy.MAJORITY_VOTE:
            result = self._arbitrate_by_vote(conflict, context)
        elif strategy == ResolutionStrategy.FIRST_WINS:
            result = self._arbitrate_by_first(conflict, context)
        elif strategy == ResolutionStrategy.MERGE:
            result = self._arbitrate_by_merge(conflict, context)
        elif strategy == ResolutionStrategy.LLM_DECIDE:
            result = self._arbitrate_by_llm(conflict, context)
        else:
            result = ArbitrationResult(
                conflict_id=conflict.conflict_id,
                resolved=False,
                strategy=strategy,
                reasoning="需要人工干预",
            )

        self._results.append(result)
        return result

    # ═══════════════════════════════════════════════════════════════
    # 仲裁策略实现
    # ═══════════════════════════════════════════════════════════════

    def _arbitrate_by_confidence(
        self,
        conflict: Any,
        context: dict,
    ) -> ArbitrationResult:
        """按置信度仲裁。"""
        agent_results = context.get("agent_results", {})

        best_agent = None
        best_confidence = -1

        for agent_name in conflict.agents:
            if agent_name in agent_results:
                conf = agent_results[agent_name].get("confidence", 0.5)
                # 考虑优先级加成
                priority = self._agent_priorities.get(agent_name, 1.0)
                adjusted_conf = conf * priority

                if adjusted_conf > best_confidence:
                    best_confidence = adjusted_conf
                    best_agent = agent_name

        if best_agent:
            return ArbitrationResult(
                conflict_id=conflict.conflict_id,
                resolved=True,
                strategy=ResolutionStrategy.HIGHEST_CONFIDENCE,
                winner=best_agent,
                reasoning=f"Agent {best_agent} 具有最高置信度 ({best_confidence:.2f})",
                confidence=best_confidence,
            )

        return ArbitrationResult(
            conflict_id=conflict.conflict_id,
            resolved=False,
            strategy=ResolutionStrategy.HIGHEST_CONFIDENCE,
            reasoning="无法确定最佳 Agent",
        )

    def _arbitrate_by_vote(
        self,
        conflict: Any,
        context: dict,
    ) -> ArbitrationResult:
        """按投票仲裁。"""
        # 统计各选项的支持数
        votes: dict[str, int] = {}

        for agent_name in conflict.agents:
            # 获取 Agent 的选择
            choice = self._get_agent_choice(conflict, agent_name, context)
            if choice:
                votes[choice] = votes.get(choice, 0) + 1

        if votes:
            winner = max(votes, key=votes.get)
            vote_count = votes[winner]

            return ArbitrationResult(
                conflict_id=conflict.conflict_id,
                resolved=True,
                strategy=ResolutionStrategy.MAJORITY_VOTE,
                winner=winner,
                final_value=winner,
                reasoning=f"通过投票决定: {winner} ({vote_count} 票)",
                confidence=vote_count / len(conflict.agents),
            )

        return ArbitrationResult(
            conflict_id=conflict.conflict_id,
            resolved=False,
            strategy=ResolutionStrategy.MAJORITY_VOTE,
            reasoning="无法进行投票",
        )

    def _arbitrate_by_first(
        self,
        conflict: Any,
        context: dict,
    ) -> ArbitrationResult:
        """按先到先得仲裁。"""
        if conflict.agents:
            first_agent = conflict.agents[0]
            return ArbitrationResult(
                conflict_id=conflict.conflict_id,
                resolved=True,
                strategy=ResolutionStrategy.FIRST_WINS,
                winner=first_agent,
                reasoning=f"第一个分析的 Agent: {first_agent}",
                confidence=0.7,  # 默认置信度
            )

        return ArbitrationResult(
            conflict_id=conflict.conflict_id,
            resolved=False,
            strategy=ResolutionStrategy.FIRST_WINS,
            reasoning="没有 Agent 参与",
        )

    def _arbitrate_by_merge(
        self,
        conflict: Any,
        context: dict,
    ) -> ArbitrationResult:
        """通过合并仲裁。"""
        agent_results = context.get("agent_results", {})

        # 收集所有值
        all_values = {}
        for agent_name in conflict.agents:
            if agent_name in agent_results:
                values = self._extract_conflict_values(conflict, agent_results[agent_name])
                all_values[agent_name] = values

        # 合并值
        merged = self._merge_values(all_values, conflict.details)

        if merged:
            return ArbitrationResult(
                conflict_id=conflict.conflict_id,
                resolved=True,
                strategy=ResolutionStrategy.MERGE,
                final_value=merged,
                reasoning="合并了所有 Agent 的结果",
                confidence=0.8,
            )

        return ArbitrationResult(
            conflict_id=conflict.conflict_id,
            resolved=False,
            strategy=ResolutionStrategy.MERGE,
            reasoning="无法合并结果",
        )

    def _arbitrate_by_llm(
        self,
        conflict: Any,
        context: dict,
    ) -> ArbitrationResult:
        """通过 LLM 仲裁。"""
        if not self._llm_client:
            return ArbitrationResult(
                conflict_id=conflict.conflict_id,
                resolved=False,
                strategy=ResolutionStrategy.LLM_DECIDE,
                reasoning="LLM 客户端不可用",
            )

        # 构建 prompt
        prompt = self._build_llm_prompt(conflict, context)

        try:
            response = self._llm_client.chat(prompt)
            result = self._parse_llm_response(response)

            if result:
                return ArbitrationResult(
                    conflict_id=conflict.conflict_id,
                    resolved=True,
                    strategy=ResolutionStrategy.LLM_DECIDE,
                    winner=result.get("winner"),
                    final_value=result.get("value"),
                    reasoning=result.get("reasoning", "LLM 决定"),
                    confidence=result.get("confidence", 0.75),
                )
        except Exception as e:
            logger.warning("[Arbitrator] LLM 仲裁失败: %s", e)

        return ArbitrationResult(
            conflict_id=conflict.conflict_id,
            resolved=False,
            strategy=ResolutionStrategy.LLM_DECIDE,
            reasoning="LLM 仲裁失败",
        )

    # ═══════════════════════════════════════════════════════════════
    # 辅助方法
    # ═══════════════════════════════════════════════════════════════

    def _get_agent_choice(
        self,
        conflict: Any,
        agent_name: str,
        context: dict,
    ) -> Optional[str]:
        """获取 Agent 的选择。"""
        # 从冲突详情中提取
        if conflict.details:
            key = f"{agent_name}_choice"
            if key in conflict.details:
                return conflict.details[key]

        # 从节点信息推断
        if conflict.nodes_involved:
            return conflict.nodes_involved[0]

        return None

    def _extract_conflict_values(self, conflict: Any, agent_result: dict) -> dict:
        """从 Agent 结果中提取冲突相关值。"""
        values = {}

        for node_id in conflict.nodes_involved:
            for node in agent_result.get("nodes", []):
                if node.id == node_id:
                    values[node_id] = {
                        "type": node.type,
                        "name": node.name,
                        "properties": node.properties,
                    }

        return values

    def _merge_values(self, all_values: dict, conflict_details: dict) -> Optional[dict]:
        """合并多个 Agent 的值。"""
        if not all_values:
            return None

        merged = {}

        for agent_name, values in all_values.items():
            for key, value in values.items():
                if key not in merged:
                    merged[key] = value
                elif isinstance(value, dict) and isinstance(merged[key], dict):
                    # 合并字典（后者覆盖前者，但 None 值不覆盖）
                    for k, v in value.items():
                        if v is not None:
                            merged[key][k] = v

        return merged if merged else None

    def _build_llm_prompt(self, conflict: Any, context: dict) -> str:
        """构建 LLM prompt。"""
        return f"""请分析以下代码分析结果冲突并做出仲裁：

冲突类型: {conflict.conflict_type.value}
冲突描述: {conflict.description}
涉及的 Agent: {', '.join(conflict.agents)}
冲突详情: {conflict.details}

请返回 JSON 格式:
{{
  "winner": "获胜的 Agent 名称或 null",
  "value": "最终值",
  "reasoning": "仲裁理由",
  "confidence": 0.85
}}
"""

    def _parse_llm_response(self, response: str) -> Optional[dict]:
        """解析 LLM 响应。"""
        import json
        import re

        # 尝试提取 JSON
        match = re.search(r'\{[\s\S]*\}', response)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                pass

        return None

    # ═══════════════════════════════════════════════════════════════
    # 结果应用
    # ═══════════════════════════════════════════════════════════════

    def apply_result(
        self,
        result: ArbitrationResult,
        nodes: list[GraphNode],
        edges: list[GraphEdge],
    ) -> None:
        """应用仲裁结果到最终结果。"""
        if not result.resolved:
            return

        # 查找冲突的节点/边并更新
        # 具体实现取决于冲突类型

        logger.debug(
            "[Arbitrator] 应用结果: %s, winner=%s",
            result.conflict_id, result.winner
        )

    def get_stats(self) -> dict:
        """获取统计信息。"""
        resolved = [r for r in self._results if r.resolved]
        unresolved = [r for r in self._results if not r.resolved]

        strategy_counts = {}
        for result in self._results:
            strategy = result.strategy.value
            strategy_counts[strategy] = strategy_counts.get(strategy, 0) + 1

        return {
            "total": len(self._results),
            "resolved": len(resolved),
            "unresolved": len(unresolved),
            "by_strategy": strategy_counts,
        }
