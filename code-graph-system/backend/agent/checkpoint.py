"""模块级检查点管理。

支持大型仓库的分段分析，在模块间重置上下文，同时保留分析结果。
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field, asdict
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)


# 检查点状态常量
CHECKPOINT_STATUS_PENDING = "pending"
CHECKPOINT_STATUS_COMPLETED = "completed"
CHECKPOINT_STATUS_PARTIAL = "partial"
CHECKPOINT_STATUS_FAILED = "failed"


@dataclass
class ModuleCheckpoint:
    """模块分析检查点。

    存储单个模块的分析结果，支持断点续分析。

    Attributes:
        module_id: 模块唯一标识，格式如 "repo:my-project" 或 "module:backend.api"
        module_name: 模块可读名称
        nodes: 该模块分析产生的图谱节点列表
        edges: 该模块分析产生的图谱边列表
        knowledge: 该模块的共享知识（用于跨模块传递）
        status: 检查点状态
        created_at: 创建时间 ISO 格式
        token_usage: Token 使用统计
    """

    module_id: str
    module_name: str
    nodes: list[dict] = field(default_factory=list)
    edges: list[dict] = field(default_factory=list)
    knowledge: dict[str, Any] = field(default_factory=dict)
    status: str = CHECKPOINT_STATUS_PENDING
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    token_usage: dict[str, int] = field(default_factory=lambda: {"input": 0, "output": 0})

    def to_dict(self) -> dict[str, Any]:
        """转换为字典格式。

        Returns:
            包含所有字段的字典
        """
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ModuleCheckpoint":
        """从字典创建检查点实例。

        Args:
            data: 包含检查点数据的字典

        Returns:
            ModuleCheckpoint 实例
        """
        return cls(
            module_id=data["module_id"],
            module_name=data["module_name"],
            nodes=data.get("nodes", []),
            edges=data.get("edges", []),
            knowledge=data.get("knowledge", {}),
            status=data.get("status", CHECKPOINT_STATUS_PENDING),
            created_at=data.get("created_at", datetime.now().isoformat()),
            token_usage=data.get("token_usage", {"input": 0, "output": 0}),
        )

    def mark_completed(self, nodes: list[dict], edges: list[dict]) -> None:
        """标记检查点为已完成。

        Args:
            nodes: 分析产生的节点列表
            edges: 分析产生的边列表
        """
        self.nodes = nodes
        self.edges = edges
        self.status = CHECKPOINT_STATUS_COMPLETED
        self.created_at = datetime.now().isoformat()

    def mark_partial(self, nodes: list[dict], edges: list[dict]) -> None:
        """标记检查点为部分完成。

        Args:
            nodes: 分析产生的节点列表
            edges: 分析产生的边列表
        """
        self.nodes = nodes
        self.edges = edges
        self.status = CHECKPOINT_STATUS_PARTIAL
        self.created_at = datetime.now().isoformat()

    def mark_failed(self) -> None:
        """标记检查点为失败。"""
        self.status = CHECKPOINT_STATUS_FAILED
        self.created_at = datetime.now().isoformat()

    def add_token_usage(self, input_tokens: int, output_tokens: int) -> None:
        """累加 Token 使用量。

        Args:
            input_tokens: 输入 Token 数量
            output_tokens: 输出 Token 数量
        """
        self.token_usage["input"] += input_tokens
        self.token_usage["output"] += output_tokens


class CheckpointManager:
    """检查点管理器。

    管理多个模块的分析检查点，支持：
    - 保存/加载检查点到内存和磁盘
    - 合并所有检查点的结果
    - 聚合共享知识
    - 列出待分析/已完成的模块

    Attributes:
        repo_name: 仓库名称
        storage_dir: 检查点存储目录
        checkpoints: 内存中的检查点字典
    """

    def __init__(self, repo_name: str, storage_dir: str = "data/checkpoints"):
        """初始化检查点管理器。

        Args:
            repo_name: 仓库名称，用于隔离不同仓库的检查点
            storage_dir: 检查点存储目录，默认为 data/checkpoints
        """
        self.repo_name = repo_name
        self.storage_dir = Path(storage_dir)
        self.checkpoints: dict[str, ModuleCheckpoint] = {}

        # 确保存储目录存在
        self.storage_dir.mkdir(parents=True, exist_ok=True)

        # 加载已有检查点
        self._load_existing_checkpoints()

    def _get_checkpoint_path(self, module_id: str) -> Path:
        """获取检查点文件路径。

        Args:
            module_id: 模块 ID

        Returns:
            检查点文件路径
        """
        # 将 module_id 中的冒号替换为下划线，避免文件系统问题
        safe_id = module_id.replace(":", "_").replace("/", "_")
        return self.storage_dir / f"{self.repo_name}_{safe_id}.json"

    def _load_existing_checkpoints(self) -> None:
        """加载存储目录中的现有检查点。"""
        pattern = f"{self.repo_name}_*.json"
        for checkpoint_file in self.storage_dir.glob(pattern):
            try:
                with open(checkpoint_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                checkpoint = ModuleCheckpoint.from_dict(data)
                self.checkpoints[checkpoint.module_id] = checkpoint
                logger.debug(f"加载检查点: {checkpoint.module_id}")
            except (json.JSONDecodeError, KeyError) as e:
                logger.warning(f"加载检查点文件失败 {checkpoint_file}: {e}")

    def save(self, checkpoint: ModuleCheckpoint) -> str:
        """保存检查点到内存和磁盘。

        Args:
            checkpoint: 要保存的检查点

        Returns:
            检查点文件路径
        """
        # 保存到内存
        self.checkpoints[checkpoint.module_id] = checkpoint

        # 保存到磁盘
        checkpoint_path = self._get_checkpoint_path(checkpoint.module_id)
        try:
            with open(checkpoint_path, "w", encoding="utf-8") as f:
                json.dump(checkpoint.to_dict(), f, ensure_ascii=False, indent=2)
            logger.debug(f"检查点已保存: {checkpoint_path}")
        except IOError as e:
            logger.error(f"保存检查点失败 {checkpoint_path}: {e}")

        return str(checkpoint_path)

    def load(self, module_id: str) -> Optional[ModuleCheckpoint]:
        """加载检查点。

        优先从内存加载，若不存在则尝试从磁盘加载。

        Args:
            module_id: 模块 ID

        Returns:
            检查点实例，不存在时返回 None
        """
        # 先检查内存
        if module_id in self.checkpoints:
            return self.checkpoints[module_id]

        # 尝试从磁盘加载
        checkpoint_path = self._get_checkpoint_path(module_id)
        if checkpoint_path.exists():
            try:
                with open(checkpoint_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                checkpoint = ModuleCheckpoint.from_dict(data)
                self.checkpoints[module_id] = checkpoint
                return checkpoint
            except (json.JSONDecodeError, KeyError) as e:
                logger.warning(f"加载检查点失败 {checkpoint_path}: {e}")

        return None

    def get_all_results(self) -> tuple[list[dict], list[dict]]:
        """合并所有检查点的结果。

        Returns:
            元组 (所有节点列表, 所有边列表)
        """
        all_nodes: list[dict] = []
        all_edges: list[dict] = []

        for checkpoint in self.checkpoints.values():
            all_nodes.extend(checkpoint.nodes)
            all_edges.extend(checkpoint.edges)

        return all_nodes, all_edges

    def load_partial_results(self) -> tuple[list[dict], list[dict]]:
        """从所有已完成模块的检查点中合并节点和边，用于 PartialResultError 退出时。

        只合并状态为 completed 的检查点，其余状态（pending/partial/failed）忽略。
        同一节点 ID 出现多次时，后加载的覆盖先加载的（dict 键覆盖语义）。

        Returns:
            元组 (去重后的节点列表, 所有边列表)
        """
        nodes_by_id: dict[str, dict] = {}
        all_edges: list[dict] = []

        for checkpoint in self.checkpoints.values():
            if checkpoint.status != CHECKPOINT_STATUS_COMPLETED:
                continue
            for node in checkpoint.nodes:
                node_id = node.get("id")
                if node_id is not None:
                    nodes_by_id[node_id] = node
            all_edges.extend(checkpoint.edges)

        return list(nodes_by_id.values()), all_edges

    def get_aggregated_knowledge(self) -> dict[str, Any]:
        """聚合所有检查点的共享知识。

        合并策略：
        - layers: 取并集（去重）
        - modules: 取并集（去重）
        - services: 取并集（去重）
        - entry_points: 取并集（去重）
        - 其他字段: 深度合并

        Returns:
            聚合后的共享知识字典
        """
        aggregated: dict[str, Any] = {
            "layers": [],
            "modules": [],
            "services": [],
            "entry_points": [],
        }

        # 用于去重的集合
        seen_layers: set[str] = set()
        seen_modules: set[str] = set()
        seen_services: set[str] = set()
        seen_entry_points: set[str] = set()

        for checkpoint in self.checkpoints.values():
            knowledge = checkpoint.knowledge

            # 合并 layers（按 name 去重）
            for layer in knowledge.get("layers", []):
                layer_name = layer.get("name", "")
                if layer_name and layer_name not in seen_layers:
                    aggregated["layers"].append(layer)
                    seen_layers.add(layer_name)

            # 合并 modules（按 id 去重）
            for module in knowledge.get("modules", []):
                module_id = module.get("id", "")
                if module_id and module_id not in seen_modules:
                    aggregated["modules"].append(module)
                    seen_modules.add(module_id)

            # 合并 services（按 name 去重）
            for service in knowledge.get("services", []):
                service_name = service.get("name", "")
                if service_name and service_name not in seen_services:
                    aggregated["services"].append(service)
                    seen_services.add(service_name)

            # 合并 entry_points（按 id 去重）
            for entry in knowledge.get("entry_points", []):
                entry_id = entry.get("id", "")
                if entry_id and entry_id not in seen_entry_points:
                    aggregated["entry_points"].append(entry)
                    seen_entry_points.add(entry_id)

            # 合并其他字段
            for key, value in knowledge.items():
                if key not in aggregated:
                    aggregated[key] = value
                elif isinstance(aggregated[key], dict) and isinstance(value, dict):
                    # 深度合并字典
                    aggregated[key] = {**aggregated[key], **value}

        return aggregated

    def list_completed_modules(self) -> list[str]:
        """列出已完成的模块 ID。

        Returns:
            状态为 completed 的模块 ID 列表
        """
        return [
            module_id
            for module_id, checkpoint in self.checkpoints.items()
            if checkpoint.status == CHECKPOINT_STATUS_COMPLETED
        ]

    def list_pending_modules(self, all_modules: list[str]) -> list[str]:
        """列出待分析的模块 ID。

        Args:
            all_modules: 所有模块 ID 列表

        Returns:
            未完成（pending、partial、failed 或不存在）的模块 ID 列表
        """
        pending = []
        for module_id in all_modules:
            checkpoint = self.checkpoints.get(module_id)
            if checkpoint is None:
                pending.append(module_id)
            elif checkpoint.status in (
                CHECKPOINT_STATUS_PENDING,
                CHECKPOINT_STATUS_PARTIAL,
                CHECKPOINT_STATUS_FAILED,
            ):
                pending.append(module_id)

        return pending

    def get_total_token_usage(self) -> dict[str, int]:
        """获取所有检查点的总 Token 使用量。

        Returns:
            包含 input 和 output 的 Token 使用量字典
        """
        total_input = 0
        total_output = 0

        for checkpoint in self.checkpoints.values():
            total_input += checkpoint.token_usage.get("input", 0)
            total_output += checkpoint.token_usage.get("output", 0)

        return {"input": total_input, "output": total_output}

    def get_statistics(self) -> dict[str, Any]:
        """获取检查点统计信息。

        Returns:
            包含统计信息的字典
        """
        status_counts = {
            CHECKPOINT_STATUS_PENDING: 0,
            CHECKPOINT_STATUS_COMPLETED: 0,
            CHECKPOINT_STATUS_PARTIAL: 0,
            CHECKPOINT_STATUS_FAILED: 0,
        }

        total_nodes = 0
        total_edges = 0

        for checkpoint in self.checkpoints.values():
            status_counts[checkpoint.status] = status_counts.get(checkpoint.status, 0) + 1
            total_nodes += len(checkpoint.nodes)
            total_edges += len(checkpoint.edges)

        return {
            "repo_name": self.repo_name,
            "total_checkpoints": len(self.checkpoints),
            "status_counts": status_counts,
            "total_nodes": total_nodes,
            "total_edges": total_edges,
            "token_usage": self.get_total_token_usage(),
        }

    def delete(self, module_id: str) -> bool:
        """删除指定模块的检查点。

        Args:
            module_id: 模块 ID

        Returns:
            是否成功删除
        """
        # 从内存删除
        if module_id in self.checkpoints:
            del self.checkpoints[module_id]

        # 从磁盘删除
        checkpoint_path = self._get_checkpoint_path(module_id)
        if checkpoint_path.exists():
            try:
                checkpoint_path.unlink()
                logger.debug(f"检查点已删除: {checkpoint_path}")
                return True
            except IOError as e:
                logger.error(f"删除检查点失败 {checkpoint_path}: {e}")
                return False

        return module_id in self.checkpoints  # 如果之前存在于内存中

    def clear(self) -> None:
        """清理所有检查点。"""
        # 清理磁盘文件
        pattern = f"{self.repo_name}_*.json"
        for checkpoint_file in self.storage_dir.glob(pattern):
            try:
                checkpoint_file.unlink()
                logger.debug(f"检查点文件已删除: {checkpoint_file}")
            except IOError as e:
                logger.warning(f"删除检查点文件失败 {checkpoint_file}: {e}")

        # 清理内存
        self.checkpoints.clear()
        logger.info(f"已清理仓库 {self.repo_name} 的所有检查点")

    def __len__(self) -> int:
        """返回检查点数量。"""
        return len(self.checkpoints)

    def __contains__(self, module_id: str) -> bool:
        """检查指定模块是否有检查点。"""
        return module_id in self.checkpoints
