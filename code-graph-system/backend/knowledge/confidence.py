"""置信度计算模块。

实现置信度传播计算，支持依赖链上的置信度衰减。
"""

from __future__ import annotations

import logging
from typing import Optional

logger = logging.getLogger(__name__)

# 默认衰减因子
DEFAULT_DECAY_FACTOR = 0.85

# 最大递归深度
MAX_RECURSION_DEPTH = 10


def calculate_propagated_confidence(
    node_id: str,
    confidence_map: dict[str, float],
    dependency_map: dict[str, list[str]],
    decay_factor: float = DEFAULT_DECAY_FACTOR,
    max_depth: int = MAX_RECURSION_DEPTH,
    _visited: Optional[set] = None,
) -> float:
    """计算传播置信度（考虑依赖链）。

    置信度传播规则：
    1. 节点基础置信度来自 confidence_map
    2. 每经过一层依赖，置信度乘以衰减因子
    3. 最终置信度 = 基础置信度 × 衰减因子^深度 × min(上游置信度)

    Args:
        node_id: 节点 ID（如 "entity:User" 或 "field:User.name"）
        confidence_map: 节点置信度映射 {node_id: confidence}
        dependency_map: 节点依赖映射 {node_id: [dep_node_id, ...]}
        decay_factor: 衰减因子（每层依赖的衰减比例）
        max_depth: 最大递归深度
        _visited: 已访问节点集合（内部使用，防止循环依赖）

    Returns:
        传播后的置信度（0.0 ~ 1.0）
    """
    # 初始化访问集合
    if _visited is None:
        _visited = set()

    # 防止循环依赖
    if node_id in _visited:
        logger.warning("[置信度] 检测到循环依赖: %s", node_id)
        return confidence_map.get(node_id, 1.0)

    # 达到最大深度
    if len(_visited) >= max_depth:
        logger.debug("[置信度] 达到最大递归深度: %s", node_id)
        return confidence_map.get(node_id, 1.0)

    _visited.add(node_id)

    # 获取基础置信度
    base_confidence = confidence_map.get(node_id, 1.0)

    # 获取依赖节点
    dependencies = dependency_map.get(node_id, [])

    if not dependencies:
        return base_confidence

    # 计算依赖深度
    depth = len(_visited)

    # 计算衰减
    decay = decay_factor ** depth

    # 计算上游最小置信度
    min_upstream = 1.0
    for dep_id in dependencies:
        dep_confidence = calculate_propagated_confidence(
            node_id=dep_id,
            confidence_map=confidence_map,
            dependency_map=dependency_map,
            decay_factor=decay_factor,
            max_depth=max_depth,
            _visited=_visited.copy(),  # 使用副本，避免不同分支共享访问记录
        )
        min_upstream = min(min_upstream, dep_confidence)

    # 计算传播置信度
    propagated = base_confidence * decay * min_upstream

    # 限制在 [0, 1] 范围
    propagated = max(0.0, min(1.0, propagated))

    logger.debug(
        "[置信度] %s: base=%.2f, decay=%.2f, min_upstream=%.2f → propagated=%.2f",
        node_id, base_confidence, decay, min_upstream, propagated
    )

    return propagated


def calculate_dependency_depth(
    node_id: str,
    dependency_map: dict[str, list[str]],
    _visited: Optional[set] = None,
) -> int:
    """计算依赖深度。

    Args:
        node_id: 节点 ID
        dependency_map: 节点依赖映射
        _visited: 已访问节点集合（内部使用）

    Returns:
        依赖深度（0 表示无依赖）
    """
    if _visited is None:
        _visited = set()

    if node_id in _visited:
        return 0

    _visited.add(node_id)

    dependencies = dependency_map.get(node_id, [])
    if not dependencies:
        return 0

    max_dep_depth = 0
    for dep_id in dependencies:
        dep_depth = calculate_dependency_depth(dep_id, dependency_map, _visited.copy())
        max_dep_depth = max(max_dep_depth, dep_depth)

    return max_dep_depth + 1


def build_dependency_chain(
    node_id: str,
    dependency_map: dict[str, list[str]],
    max_depth: int = 5,
    _visited: Optional[set] = None,
    _chain: Optional[list[str]] = None,
) -> list[str]:
    """构建依赖链。

    Args:
        node_id: 节点 ID
        dependency_map: 节点依赖映射
        max_depth: 最大深度
        _visited: 已访问节点集合（内部使用）
        _chain: 当前链（内部使用）

    Returns:
        依赖链列表（从源节点到目标节点）
    """
    if _visited is None:
        _visited = set()
    if _chain is None:
        _chain = []

    if node_id in _visited or len(_chain) >= max_depth:
        return _chain

    _visited.add(node_id)
    _chain.append(node_id)

    dependencies = dependency_map.get(node_id, [])
    for dep_id in dependencies:
        build_dependency_chain(dep_id, dependency_map, max_depth, _visited.copy(), _chain)
        break  # 只取第一条路径

    return _chain


def aggregate_confidence(
    confidences: list[float],
    method: str = "min",
) -> float:
    """聚合多个置信度。

    Args:
        confidences: 置信度列表
        method: 聚合方法 ("min", "max", "avg", "weighted")

    Returns:
        聚合后的置信度
    """
    if not confidences:
        return 1.0

    if method == "min":
        return min(confidences)
    elif method == "max":
        return max(confidences)
    elif method == "avg":
        return sum(confidences) / len(confidences)
    elif method == "weighted":
        # 加权平均：越低的置信度权重越高（保守策略）
        weights = [1.0 / (c + 0.1) for c in confidences]
        total_weight = sum(weights)
        return sum(c * w for c, w in zip(confidences, weights)) / total_weight
    else:
        return min(confidences)
