"""测试 Agent Explorer 编排器（Phase 3: Multi-Agent Collaboration）。"""

import asyncio
import json
import pytest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime, timezone

from backend.agent_explorer.orchestrator import (
    AgentOrchestrator,
    SubAgentTask,
    OrchestratorCheckpoint,
)
from backend.agent_explorer.graph_explorer import AgentState


class TestSubAgentTask:
    """测试 SubAgentTask 数据类。"""

    def test_default_values(self):
        """测试默认值。"""
        task = SubAgentTask()
        assert task.task_id != ""
        assert task.target == ""
        assert task.status == "pending"
        assert task.agent_id is None
        assert task.discoveries == 0
        assert task.error is None

    def test_custom_values(self):
        """测试自定义值。"""
        task = SubAgentTask(
            task_id="abc123",
            target="auth 模块",
            status="running",
            agent_id="agent-001",
            discoveries=5,
        )
        assert task.task_id == "abc123"
        assert task.target == "auth 模块"
        assert task.status == "running"
        assert task.agent_id == "agent-001"
        assert task.discoveries == 5


class TestAgentOrchestrator:
    """测试 AgentOrchestrator。"""

    def test_init(self, tmp_path):
        """测试初始化。"""
        orch = AgentOrchestrator(
            graph_id="test-graph",
            storage_dir=str(tmp_path),
            max_sub_agents=3,
            model="claude-sonnet-4-6",
        )
        assert orch.graph_id == "test-graph"
        assert orch.max_sub_agents == 3
        assert orch.model == "claude-sonnet-4-6"
        assert orch.state == AgentState.IDLE
        assert len(orch.tasks) == 0
        assert len(orch.completed_tasks) == 0

    def test_get_status(self, tmp_path):
        """测试状态获取。"""
        orch = AgentOrchestrator(
            graph_id="test-graph",
            storage_dir=str(tmp_path),
        )
        status = orch.get_status()
        assert status["orchestrator_id"] == orch.orchestrator_id
        assert status["graph_id"] == "test-graph"
        assert status["state"] == "idle"
        assert status["total_discoveries"] == 0
        assert status["tasks"] == []
        assert status["completed_tasks"] == []

    @pytest.mark.asyncio
    async def test_start_creates_tasks(self, tmp_path):
        """测试启动时创建任务。"""
        orch = AgentOrchestrator(
            graph_id="test-graph",
            storage_dir=str(tmp_path),
            max_sub_agents=3,
        )

        # Mock _run_parallel to avoid actual agent execution
        with patch.object(orch, "_run_parallel", new_callable=AsyncMock) as mock_run:
            mock_run.return_value = {
                "orchestrator_id": orch.orchestrator_id,
                "total_discoveries": 0,
            }

            targets = ["auth 模块", "数据库层", "API 端点"]
            await orch.start(targets=targets)

            assert len(orch.tasks) == 3
            assert all(t.status in ("pending", "running") for t in orch.tasks)
            assert orch.state == AgentState.COMPLETED

    @pytest.mark.asyncio
    async def test_start_limits_concurrent_agents(self, tmp_path):
        """测试并发子 Agent 数量限制。"""
        orch = AgentOrchestrator(
            graph_id="test-graph",
            storage_dir=str(tmp_path),
            max_sub_agents=2,
        )

        with patch.object(orch, "_run_parallel", new_callable=AsyncMock) as mock_run:
            mock_run.return_value = {"total_discoveries": 0}

            targets = ["a", "b", "c", "d", "e"]
            await orch.start(targets=targets)

            # 因为 max_sub_agents=2，只创建 2 个任务
            assert len(orch.tasks) == 2

    @pytest.mark.asyncio
    async def test_stop(self, tmp_path):
        """测试停止。"""
        orch = AgentOrchestrator(
            graph_id="test-graph",
            storage_dir=str(tmp_path),
        )

        # Create mock agents
        mock_agent = MagicMock()
        mock_agent.stop = AsyncMock(return_value={"status": "stopped"})
        orch._agents["agent-1"] = mock_agent
        orch.state = AgentState.RUNNING

        result = await orch.stop()

        mock_agent.stop.assert_called_once()
        assert orch.state == AgentState.STOPPED

    def test_task_to_dict(self, tmp_path):
        """测试任务序列化。"""
        task = SubAgentTask(
            task_id="t1",
            target="auth",
            status="completed",
            discoveries=5,
        )
        d = AgentOrchestrator._task_to_dict(task)
        assert d["task_id"] == "t1"
        assert d["target"] == "auth"
        assert d["status"] == "completed"
        assert d["discoveries"] == 5

    def test_dict_to_task(self, tmp_path):
        """测试任务反序列化。"""
        data = {
            "task_id": "t2",
            "target": "db",
            "status": "pending",
            "discoveries": 0,
        }
        task = AgentOrchestrator._dict_to_task(data)
        assert task.task_id == "t2"
        assert task.target == "db"
        assert task.status == "pending"


class TestCheckpoint:
    """测试冻结/解冻机制。"""

    @pytest.mark.asyncio
    async def test_freeze_saves_checkpoint(self, tmp_path):
        """测试冻结保存检查点。"""
        orch = AgentOrchestrator(
            graph_id="test-graph",
            storage_dir=str(tmp_path),
        )

        # Add some tasks
        orch.tasks = [
            SubAgentTask(target="pending-task", status="pending"),
            SubAgentTask(target="running-task", status="running"),
        ]
        orch.completed_tasks = [
            SubAgentTask(target="done-task", status="completed", discoveries=3),
        ]
        orch.total_discoveries = 3
        orch.state = AgentState.RUNNING

        result = await orch.freeze()

        assert "checkpoint_path" in result
        assert result["pending_tasks"] == 2
        assert result["completed_tasks"] == 1
        assert orch.state == AgentState.STOPPED

        # Verify checkpoint file exists
        checkpoint_path = Path(result["checkpoint_path"])
        assert checkpoint_path.exists()

        # Verify checkpoint content
        data = json.loads(checkpoint_path.read_text())
        assert data["graph_id"] == "test-graph"
        assert len(data["tasks"]) == 2
        assert len(data["completed_tasks"]) == 1
        assert data["total_discoveries"] == 3

    @pytest.mark.asyncio
    async def test_thaw_restores_state(self, tmp_path):
        """测试解冻恢复状态。"""
        orch = AgentOrchestrator(
            graph_id="test-graph",
            storage_dir=str(tmp_path),
        )

        # First freeze a state
        orch.completed_tasks = [
            SubAgentTask(target="done", status="completed", discoveries=5),
        ]
        orch.total_discoveries = 5

        freeze_result = await orch.freeze()
        checkpoint_id = orch.orchestrator_id

        # Create new orchestrator and thaw
        orch2 = AgentOrchestrator(
            graph_id="",
            storage_dir=str(tmp_path),
        )

        with patch.object(orch2, "_run_parallel", new_callable=AsyncMock) as mock_run:
            mock_run.return_value = {"total_discoveries": 5}

            result = await orch2.thaw(checkpoint_id=checkpoint_id)

            # Verify state restored
            assert orch2.total_discoveries == 5
            assert len(orch2.completed_tasks) == 1

    def test_list_checkpoints(self, tmp_path):
        """测试列出检查点。"""
        orch = AgentOrchestrator(
            graph_id="test-graph",
            storage_dir=str(tmp_path),
        )

        # Create checkpoint directory
        checkpoint_dir = tmp_path / "_checkpoints"
        checkpoint_dir.mkdir(parents=True, exist_ok=True)

        # Create a mock checkpoint file
        checkpoint_data = {
            "orchestrator_id": "test-orch",
            "graph_id": "test-graph",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "tasks": [{"target": "pending"}],
            "completed_tasks": [],
            "total_discoveries": 10,
        }
        checkpoint_file = checkpoint_dir / "test-orch.json"
        checkpoint_file.write_text(json.dumps(checkpoint_data))

        checkpoints = orch.list_checkpoints()

        assert len(checkpoints) >= 1
        found = any(cp["orchestrator_id"] == "test-orch" for cp in checkpoints)
        assert found


class TestBuildSummary:
    """测试摘要构建。"""

    def test_build_summary(self, tmp_path):
        """测试摘要内容。"""
        orch = AgentOrchestrator(
            graph_id="test-graph",
            storage_dir=str(tmp_path),
        )

        orch.completed_tasks = [SubAgentTask(target="a", status="completed")]
        orch.tasks = [SubAgentTask(target="b", status="pending")]
        orch.total_discoveries = 42

        summary = orch._build_summary()

        assert "已完成 1 个任务" in summary
        assert "1 个待执行" in summary
        assert "42 个节点" in summary
