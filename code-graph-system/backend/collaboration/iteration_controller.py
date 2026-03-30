"""迭代控制器。

控制分析迭代的进行、收敛检测、预算管理。
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional

logger = logging.getLogger(__name__)


class IterationState(Enum):
    """迭代状态。"""
    PENDING = "pending"
    RUNNING = "running"
    CONVERGED = "conged"  # 收敛
    STALLED = "stalled"  # 停滞
    BUDGET_EXCEEDED = "budget_exceeded"  # 预算超限
    MAX_ITERATIONS = "max_iterations"  # 达到最大迭代
    COMPLETED = "completed"


class ConvergenceReason(Enum):
    """收敛原因。"""
    QUALITY_THRESHOLD = "quality_threshold"  # 达到质量阈值
    NO_IMPROVEMENT = "no_improvement"  # 无改进
    NO_CONFLICTS = "no_conflicts"  # 无冲突
    MANUAL_STOP = "manual_stop"  # 手动停止


@dataclass
class IterationMetrics:
    """迭代指标。"""
    iteration: int
    node_count: int
    edge_count: int
    conflict_count: int
    avg_confidence: float
    elapsed_seconds: float
    improvement: float = 0.0  # 相比上一次的改进


@dataclass
class IterationConfig:
    """迭代配置。"""
    max_iterations: int = 5
    min_iterations: int = 1
    convergence_threshold: float = 0.95  # 置信度阈值
    improvement_threshold: float = 0.01  # 最小改进阈值
    stall_threshold: int = 2  # 连续无改进次数阈值
    timeout_seconds: float = 300.0  # 超时时间
    budget_limit: Optional[float] = None  # 预算限制（如 LLM 调用次数）


class IterationController:
    """迭代控制器。

    职责：
    1. 控制迭代流程
    2. 检测收敛条件
    3. 管理预算
    4. 记录迭代历史

    使用示例：
        controller = IterationController(config)

        while controller.should_continue():
            controller.start_iteration()

            # 执行分析...

            metrics = IterationMetrics(...)
            controller.end_iteration(metrics)

        print(controller.get_final_state())
    """

    def __init__(self, config: IterationConfig = None):
        """初始化迭代控制器。

        Args:
            config: 迭代配置
        """
        self._config = config or IterationConfig()

        # 状态
        self._state = IterationState.PENDING
        self._current_iteration = 0
        self._start_time: Optional[float] = None
        self._iteration_start_time: Optional[float] = None

        # 历史记录
        self._history: list[IterationMetrics] = []
        self._stall_count = 0

        # 预算追踪
        self._budget_used: float = 0.0

        # 收敛原因
        self._convergence_reason: Optional[ConvergenceReason] = None

    # ═══════════════════════════════════════════════════════════════
    # 状态检查
    # ═══════════════════════════════════════════════════════════════

    def should_continue(self) -> bool:
        """判断是否应该继续迭代。"""
        if self._state == IterationState.PENDING:
            return True

        if self._state != IterationState.RUNNING:
            return False

        # 检查最大迭代
        if self._current_iteration >= self._config.max_iterations:
            self._state = IterationState.MAX_ITERATIONS
            self._convergence_reason = ConvergenceReason.NO_IMPROVEMENT
            return False

        # 检查超时
        if self._start_time:
            elapsed = time.time() - self._start_time
            if elapsed > self._config.timeout_seconds:
                self._state = IterationState.BUDGET_EXCEEDED
                return False

        # 检查预算
        if self._config.budget_limit and self._budget_used >= self._config.budget_limit:
            self._state = IterationState.BUDGET_EXCEEDED
            return False

        # 检查停滞
        if self._stall_count >= self._config.stall_threshold:
            self._state = IterationState.STALLED
            self._convergence_reason = ConvergenceReason.NO_IMPROVEMENT
            return False

        return True

    # ═══════════════════════════════════════════════════════════════
    # 迭代控制
    # ═══════════════════════════════════════════════════════════════

    def start_iteration(self) -> int:
        """开始新迭代。

        Returns:
            当前迭代号
        """
        if self._state == IterationState.PENDING:
            self._start_time = time.time()

        self._state = IterationState.RUNNING
        self._current_iteration += 1
        self._iteration_start_time = time.time()

        logger.info(
            "[IterationController] 开始迭代 %d",
            self._current_iteration
        )

        return self._current_iteration

    def end_iteration(self, metrics: IterationMetrics) -> IterationState:
        """结束当前迭代。

        Args:
            metrics: 迭代指标

        Returns:
            当前状态
        """
        # 计算改进
        if self._history:
            last = self._history[-1]
            improvement = metrics.avg_confidence - last.avg_confidence
            metrics.improvement = improvement

            # 检查是否收敛
            if metrics.avg_confidence >= self._config.convergence_threshold:
                if metrics.conflict_count == 0:
                    self._state = IterationState.CONVERGED
                    self._convergence_reason = ConvergenceReason.NO_CONFLICTS
                else:
                    self._state = IterationState.CONVERGED
                    self._convergence_reason = ConvergenceReason.QUALITY_THRESHOLD

            # 检查改进
            if improvement < self._config.improvement_threshold:
                self._stall_count += 1
            else:
                self._stall_count = 0

        # 记录历史
        self._history.append(metrics)

        logger.info(
            "[IterationController] 结束迭代 %d: nodes=%d, edges=%d, confidence=%.2f, improvement=%.3f",
            self._current_iteration, metrics.node_count, metrics.edge_count,
            metrics.avg_confidence, metrics.improvement
        )

        return self._state

    def add_budget_usage(self, amount: float) -> None:
        """添加预算使用量。"""
        self._budget_used += amount

    def force_stop(self, reason: str = "manual") -> None:
        """强制停止迭代。"""
        self._state = IterationState.COMPLETED
        self._convergence_reason = ConvergenceReason.MANUAL_STOP

        logger.info("[IterationController] 强制停止: %s", reason)

    # ═══════════════════════════════════════════════════════════════
    # 增量分析支持
    # ═══════════════════════════════════════════════════════════════

    def get_targets_for_refinement(self) -> list[str]:
        """获取需要优化的目标列表。

        根据上一次迭代的结果，确定哪些目标需要重新分析。
        """
        if not self._history:
            return []

        last = self._history[-1]

        # 如果有冲突，返回冲突相关的目标
        # TODO: 从冲突信息中提取

        return []

    def should_refine_target(self, target_id: str) -> bool:
        """判断目标是否需要优化。"""
        # TODO: 基于置信度和冲突历史判断
        return self._current_iteration > 1

    # ═══════════════════════════════════════════════════════════════
    # 信息获取
    # ═══════════════════════════════════════════════════════════════

    @property
    def current_iteration(self) -> int:
        """当前迭代号。"""
        return self._current_iteration

    @property
    def state(self) -> IterationState:
        """当前状态。"""
        return self._state

    @property
    def convergence_reason(self) -> Optional[ConvergenceReason]:
        """收敛原因。"""
        return self._convergence_reason

    def get_history(self) -> list[IterationMetrics]:
        """获取迭代历史。"""
        return list(self._history)

    def get_final_state(self) -> dict:
        """获取最终状态。"""
        elapsed = time.time() - self._start_time if self._start_time else 0

        return {
            "state": self._state.value,
            "iterations": self._current_iteration,
            "convergence_reason": self._convergence_reason.value if self._convergence_reason else None,
            "elapsed_seconds": elapsed,
            "budget_used": self._budget_used,
            "history_count": len(self._history),
        }

    def get_stats(self) -> dict:
        """获取统计信息。"""
        stats = self.get_final_state()

        if self._history:
            last = self._history[-1]
            stats["final_metrics"] = {
                "node_count": last.node_count,
                "edge_count": last.edge_count,
                "conflict_count": last.conflict_count,
                "avg_confidence": last.avg_confidence,
            }

            # 改进趋势
            if len(self._history) > 1:
                first = self._history[0]
                stats["improvement"] = {
                    "confidence": last.avg_confidence - first.avg_confidence,
                    "nodes": last.node_count - first.node_count,
                    "edges": last.edge_count - first.edge_count,
                }

        return stats

    def get_progress(self) -> dict:
        """获取进度信息。"""
        progress = self._current_iteration / self._config.max_iterations

        elapsed = 0
        remaining = 0
        if self._start_time:
            elapsed = time.time() - self._start_time
            if self._current_iteration > 0:
                avg_time_per_iter = elapsed / self._current_iteration
                remaining_iters = self._config.max_iterations - self._current_iteration
                remaining = avg_time_per_iter * remaining_iters

        return {
            "iteration": self._current_iteration,
            "max_iterations": self._config.max_iterations,
            "progress": progress,
            "elapsed_seconds": elapsed,
            "estimated_remaining_seconds": remaining,
            "state": self._state.value,
        }
