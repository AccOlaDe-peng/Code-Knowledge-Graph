"""
Agent Orchestrator — 多 Agent 协调器。

主 Agent 负责任务分发、进度监控、结果汇总。
子 Agent 并行探索不同模块，结果写入同一图谱。

使用方式:
    from backend.agent_explorer.orchestrator import AgentOrchestrator

    orch = AgentOrchestrator(graph_id="my-project")
    await orch.start(targets=["auth 模块", "数据库层", "API 端点"])
    await orch.freeze()  # 冻结状态
    await orch.thaw()    # 恢复继续
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional
from uuid import uuid4

from backend.agent_explorer.graph_explorer import (
    AgentEvent,
    AgentState,
    ExplorerMode,
    GraphExplorer,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data Models
# ---------------------------------------------------------------------------

@dataclass
class SubAgentTask:
    """子 Agent 任务。"""

    task_id: str = field(default_factory=lambda: str(uuid4())[:8])
    target: str = ""
    status: str = "pending"  # pending | running | completed | failed
    agent_id: Optional[str] = None
    discoveries: int = 0
    error: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None


@dataclass
class OrchestratorCheckpoint:
    """编排器检查点（冻结/解冻用）。"""

    orchestrator_id: str
    graph_id: str
    created_at: str
    tasks: list[dict[str, Any]]
    completed_tasks: list[dict[str, Any]]
    total_discoveries: int
    conversation_summary: str = ""


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

class AgentOrchestrator:
    """
    多 Agent 编排器。

    协调多个 GraphExplorer 实例并行探索代码库。
    - 将用户目标拆分为子任务
    - 为每个子任务启动独立 Agent
    - 监控进度，汇总结果
    - 支持冻结/解冻
    """

    def __init__(
        self,
        graph_id: str,
        storage_dir: str = "./data/graphs",
        max_sub_agents: int = 3,
        model: str = "claude-sonnet-4-6",
        max_iterations_per_agent: int = 30,
        on_event: Optional[Callable[[AgentEvent], None]] = None,
    ):
        self.orchestrator_id = str(uuid4())[:8]
        self.graph_id = graph_id
        self.storage_dir = storage_dir
        self.max_sub_agents = max_sub_agents
        self.model = model
        self.max_iterations_per_agent = max_iterations_per_agent

        self.state = AgentState.IDLE
        self.tasks: list[SubAgentTask] = []
        self.completed_tasks: list[SubAgentTask] = []
        self.total_discoveries = 0
        self._agents: dict[str, GraphExplorer] = {}
        self._on_event = on_event
        self._stop_requested = False
        self._checkpoint_dir = Path(storage_dir) / "_checkpoints"

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def start(self, targets: list[str]) -> dict[str, Any]:
        """启动多 Agent 探索。

        Args:
            targets: 探索目标列表（每个目标分配给一个子 Agent）

        Returns:
            编排结果摘要
        """
        if self.state == AgentState.RUNNING:
            return {"error": "Orchestrator already running"}

        self.state = AgentState.RUNNING
        self._stop_requested = False

        # 限制并发子 Agent 数量
        targets = targets[:self.max_sub_agents]

        self.tasks = [
            SubAgentTask(target=t, status="pending")
            for t in targets
        ]

        self._emit("orchestrator_started", {
            "targets": targets,
            "max_sub_agents": self.max_sub_agents,
        })

        try:
            result = await self._run_parallel()
            self.state = AgentState.COMPLETED
            return result
        except Exception as e:
            self.state = AgentState.ERROR
            self._emit("error", {"message": str(e)})
            logger.exception("Orchestrator failed")
            raise

    async def stop(self) -> dict[str, Any]:
        """停止所有子 Agent。"""
        self._stop_requested = True
        for agent in self._agents.values():
            await agent.stop()
        self.state = AgentState.STOPPED
        self._emit("orchestrator_stopped", {})
        return self.get_status()

    async def freeze(self) -> dict[str, Any]:
        """冻结当前状态（保存检查点）。"""
        # 停止所有子 Agent
        for agent in self._agents.values():
            await agent.stop()

        checkpoint = OrchestratorCheckpoint(
            orchestrator_id=self.orchestrator_id,
            graph_id=self.graph_id,
            created_at=datetime.now(timezone.utc).isoformat(),
            tasks=[self._task_to_dict(t) for t in self.tasks if t.status != "completed"],
            completed_tasks=[self._task_to_dict(t) for t in self.completed_tasks],
            total_discoveries=self.total_discoveries,
            conversation_summary=self._build_summary(),
        )

        # 保存检查点
        self._checkpoint_dir.mkdir(parents=True, exist_ok=True)
        checkpoint_path = self._checkpoint_dir / f"{self.orchestrator_id}.json"
        checkpoint_path.write_text(
            json.dumps(self._checkpoint_to_dict(checkpoint), ensure_ascii=False, indent=2)
        )

        self.state = AgentState.STOPPED
        self._emit("frozen", {"checkpoint": str(checkpoint_path)})

        return {
            "orchestrator_id": self.orchestrator_id,
            "checkpoint_path": str(checkpoint_path),
            "pending_tasks": len(checkpoint.tasks),
            "completed_tasks": len(checkpoint.completed_tasks),
        }

    async def thaw(self, checkpoint_id: Optional[str] = None) -> dict[str, Any]:
        """从检查点恢复并继续探索。

        Args:
            checkpoint_id: 检查点 ID（不指定则使用最近的）
        """
        checkpoint = self._load_checkpoint(checkpoint_id)
        if checkpoint is None:
            return {"error": "No checkpoint found"}

        # 恢复状态
        self.orchestrator_id = checkpoint["orchestrator_id"]
        self.total_discoveries = checkpoint["total_discoveries"]

        # 恢复未完成任务
        remaining_targets = [t["target"] for t in checkpoint["tasks"]]
        self.completed_tasks = [
            self._dict_to_task(t) for t in checkpoint["completed_tasks"]
        ]

        self._emit("thawed", {
            "pending_tasks": len(remaining_targets),
            "completed_tasks": len(self.completed_tasks),
        })

        if remaining_targets:
            # 继续执行剩余任务
            self.state = AgentState.RUNNING
            self.tasks = [SubAgentTask(target=t, status="pending") for t in remaining_targets]
            result = await self._run_parallel()
            self.state = AgentState.COMPLETED
            return result
        else:
            self.state = AgentState.COMPLETED
            return {"status": "all tasks already completed"}

    def get_status(self) -> dict[str, Any]:
        """获取编排器状态。"""
        return {
            "orchestrator_id": self.orchestrator_id,
            "graph_id": self.graph_id,
            "state": self.state.value,
            "total_discoveries": self.total_discoveries,
            "tasks": [self._task_to_dict(t) for t in self.tasks],
            "completed_tasks": [self._task_to_dict(t) for t in self.completed_tasks],
        }

    # ------------------------------------------------------------------
    # Parallel Execution
    # ------------------------------------------------------------------

    async def _run_parallel(self) -> dict[str, Any]:
        """并行运行子 Agent。"""
        pending = [t for t in self.tasks if t.status == "pending"]

        # 为每个任务创建子 Agent
        coros = []
        for task in pending:
            task.status = "running"
            task.started_at = datetime.now(timezone.utc).isoformat()

            agent = GraphExplorer(
                graph_id=self.graph_id,
                storage_dir=self.storage_dir,
                model=self.model,
                max_iterations=self.max_iterations_per_agent,
                on_event=self._make_sub_agent_event_handler(task),
            )

            self._agents[task.task_id] = agent
            task.agent_id = agent.agent_id

            coros.append(self._run_sub_agent(agent, task))

        # 并行执行
        results = await asyncio.gather(*coros, return_exceptions=True)

        # 汇总结果
        for i, result in enumerate(results):
            task = pending[i]
            if isinstance(result, Exception):
                task.status = "failed"
                task.error = str(result)
                logger.error("Sub-agent %s failed: %s", task.task_id, result)
            else:
                task.status = "completed"
                task.completed_at = datetime.now(timezone.utc).isoformat()
                task.discoveries = result.get("discoveries", 0)
                self.total_discoveries += task.discoveries
                self.completed_tasks.append(task)

        # 从 tasks 中移除已完成的
        self.tasks = [t for t in self.tasks if t.status != "completed"]

        return {
            "orchestrator_id": self.orchestrator_id,
            "graph_id": self.graph_id,
            "total_discoveries": self.total_discoveries,
            "completed_tasks": len(self.completed_tasks),
            "failed_tasks": len([t for t in self.tasks if t.status == "failed"]),
        }

    async def _run_sub_agent(self, agent: GraphExplorer, task: SubAgentTask) -> dict[str, Any]:
        """运行单个子 Agent。"""
        self._emit("sub_agent_started", {
            "task_id": task.task_id,
            "target": task.target,
            "agent_id": agent.agent_id,
        })

        try:
            result = await agent.start(
                mode=ExplorerMode.GUIDED,
                target=task.target,
            )
            self._emit("sub_agent_completed", {
                "task_id": task.task_id,
                "discoveries": result.get("discoveries", 0),
            })
            return result
        except Exception as e:
            self._emit("sub_agent_failed", {
                "task_id": task.task_id,
                "error": str(e),
            })
            raise

    # ------------------------------------------------------------------
    # Event Handling
    # ------------------------------------------------------------------

    def _make_sub_agent_event_handler(self, task: SubAgentTask):
        """创建子 Agent 事件处理器。"""
        def on_event(event: AgentEvent):
            # 转发子 Agent 事件，附带任务 ID
            self._emit("sub_agent_event", {
                "task_id": task.task_id,
                "target": task.target,
                "event_type": event.type,
                "event_data": event.data,
            })
        return on_event

    def _emit(self, event_type: str, data: dict[str, Any]) -> None:
        """发送事件。"""
        if self._on_event:
            event = AgentEvent(type=event_type, data=data)
            self._on_event(event)

    # ------------------------------------------------------------------
    # Checkpoint Helpers
    # ------------------------------------------------------------------

    def _build_summary(self) -> str:
        """构建探索摘要。"""
        completed = len(self.completed_tasks)
        pending = len([t for t in self.tasks if t.status != "completed"])
        return f"已完成 {completed} 个任务，{pending} 个待执行。总计发现 {self.total_discoveries} 个节点/关系。"

    @staticmethod
    def _task_to_dict(task: SubAgentTask) -> dict[str, Any]:
        return {
            "task_id": task.task_id,
            "target": task.target,
            "status": task.status,
            "agent_id": task.agent_id,
            "discoveries": task.discoveries,
            "error": task.error,
            "started_at": task.started_at,
            "completed_at": task.completed_at,
        }

    @staticmethod
    def _dict_to_task(data: dict[str, Any]) -> SubAgentTask:
        return SubAgentTask(
            task_id=data.get("task_id", ""),
            target=data.get("target", ""),
            status=data.get("status", "pending"),
            agent_id=data.get("agent_id"),
            discoveries=data.get("discoveries", 0),
            error=data.get("error"),
            started_at=data.get("started_at"),
            completed_at=data.get("completed_at"),
        )

    @staticmethod
    def _checkpoint_to_dict(cp: OrchestratorCheckpoint) -> dict[str, Any]:
        return {
            "orchestrator_id": cp.orchestrator_id,
            "graph_id": cp.graph_id,
            "created_at": cp.created_at,
            "tasks": cp.tasks,
            "completed_tasks": cp.completed_tasks,
            "total_discoveries": cp.total_discoveries,
            "conversation_summary": cp.conversation_summary,
        }

    def _load_checkpoint(self, checkpoint_id: Optional[str] = None) -> Optional[dict[str, Any]]:
        """加载检查点。"""
        self._checkpoint_dir.mkdir(parents=True, exist_ok=True)

        if checkpoint_id:
            path = self._checkpoint_dir / f"{checkpoint_id}.json"
        else:
            # 使用最新的检查点
            checkpoints = sorted(self._checkpoint_dir.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
            path = checkpoints[0] if checkpoints else None

        if path is None or not path.exists():
            return None

        return json.loads(path.read_text(encoding="utf-8"))

    def list_checkpoints(self) -> list[dict[str, Any]]:
        """列出所有检查点。"""
        self._checkpoint_dir.mkdir(parents=True, exist_ok=True)
        results = []
        for path in sorted(self._checkpoint_dir.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                results.append({
                    "orchestrator_id": data.get("orchestrator_id"),
                    "graph_id": data.get("graph_id"),
                    "created_at": data.get("created_at"),
                    "pending_tasks": len(data.get("tasks", [])),
                    "completed_tasks": len(data.get("completed_tasks", [])),
                    "total_discoveries": data.get("total_discoveries", 0),
                })
            except Exception:
                pass
        return results
