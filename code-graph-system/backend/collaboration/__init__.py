"""协作模块。

提供 Agent 间的协作机制：
- CrossValidationLayer: 跨 Agent 验证
- Arbitrator: 冲突仲裁
- IterationController: 迭代控制
- MultiAgentOrchestrator: 多 Agent 编排器
"""

from backend.collaboration.cross_validation import (
    CrossValidationLayer,
    ConflictInfo,
    ConflictType,
    ConflictSeverity,
)
from backend.collaboration.arbitrator import Arbitrator, ArbitrationResult, ResolutionStrategy
from backend.collaboration.iteration_controller import (
    IterationController,
    IterationState,
    IterationConfig,
    IterationMetrics,
)
from backend.collaboration.orchestrator import MultiAgentOrchestrator, MultiAgentResult

__all__ = [
    "CrossValidationLayer",
    "ConflictInfo",
    "ConflictType",
    "ConflictSeverity",
    "Arbitrator",
    "ArbitrationResult",
    "ResolutionStrategy",
    "IterationController",
    "IterationState",
    "IterationConfig",
    "IterationMetrics",
    "MultiAgentOrchestrator",
    "MultiAgentResult",
]
