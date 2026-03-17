"""测试 AgentOrchestrator 与 CheckpointManager 的集成。"""

from __future__ import annotations

import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from backend.agent.checkpoint import CheckpointManager, ModuleCheckpoint, CHECKPOINT_STATUS_COMPLETED
from backend.agent.config import AnalysisConfig, AnalysisPreset
from backend.agent.orchestrator import AgentOrchestrator, OrchestratorResult
from backend.graph.graph_schema import GraphNode, GraphEdge
from backend.models.agent_output import AgentOutput


@pytest.fixture
def mock_llm_client():
    """创建模拟的 LLM 客户端。"""
    client = MagicMock()
    client.model_name = "test-model"
    return client


@pytest.fixture
def temp_repo_path():
    """创建临时仓库路径。"""
    with tempfile.TemporaryDirectory() as tmpdir:
        repo_path = Path(tmpdir) / "test_repo"
        repo_path.mkdir()
        (repo_path / "main.py").write_text("print('hello')")
        yield str(repo_path)


@pytest.fixture
def temp_checkpoint_dir():
    """创建临时检查点目录。"""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield tmpdir


@pytest.fixture
def sample_modules():
    """示例模块列表。"""
    return [
        {"id": "module:backend.api", "name": "API Module"},
        {"id": "module:backend.core", "name": "Core Module"},
        {"id": "module:backend.utils", "name": "Utils Module"},
    ]


def create_mock_output(node_id: str, from_id: str = None, to_id: str = None) -> AgentOutput:
    """创建模拟的 AgentOutput。"""
    nodes = [GraphNode(id=node_id, type="Module", name=f"Test-{node_id}")]
    edges = []
    if from_id and to_id:
        edges = [GraphEdge(from_=from_id, to=to_id, type="depends_on")]
    return AgentOutput(
        agent_type="architecture",
        module_id=node_id,
        status="success",
        execution_time_ms=100,
        nodes=nodes,
        edges=edges,
    )


class TestOrchestratorWithCheckpointEnabled:
    """测试启用检查点功能的编排器。"""

    def test_orchestrator_with_checkpoint_enabled(
        self, mock_llm_client, temp_repo_path, temp_checkpoint_dir, sample_modules
    ):
        """测试启用检查点时，检查点会被正确保存。"""
        config = AnalysisConfig(preset=AnalysisPreset.STANDARD)

        with patch.object(
            CheckpointManager, "__init__", lambda self, repo_name, storage_dir="data/checkpoints": None
        ):
            orchestrator = AgentOrchestrator(
                repo_path=temp_repo_path,
                llm_client=mock_llm_client,
                config=config,
            )

            # 模拟 ArchitectureAgent 的 run 方法
            mock_outputs = [
                create_mock_output(f"node{i}", f"node{i}", f"node{i + 1}")
                for i in range(3)
            ]

            with patch(
                "backend.agent.orchestrator.ArchitectureAgent"
            ) as MockAgent:
                MockAgent.return_value.run.side_effect = mock_outputs

                # 模拟 CheckpointManager
                mock_checkpoint_manager = MagicMock()
                mock_checkpoint_manager.get_aggregated_knowledge.return_value = {
                    "modules": [],
                    "layers": [],
                }
                orchestrator.checkpoint_manager = mock_checkpoint_manager

                result = orchestrator.run_module_analysis(
                    modules=sample_modules,
                    repo_name="test-repo",
                )

            # 验证结果
            assert result.status == "success"
            assert len(result.nodes) == 3  # 3 个模块，每个产生 1 个节点
            assert len(result.edges) == 3  # 3 个模块，每个产生 1 条边
            assert result.meta["checkpoint_enabled"] is True
            assert result.meta["total_modules"] == 3
            assert result.meta["successful_modules"] == 3

            # 验证检查点保存被调用
            assert mock_checkpoint_manager.save.call_count == 3

    def test_orchestrator_without_checkpoint(
        self, mock_llm_client, temp_repo_path, sample_modules
    ):
        """测试未启用检查点时，编排器仍能正常工作。"""
        config = AnalysisConfig(preset=AnalysisPreset.STANDARD)

        orchestrator = AgentOrchestrator(
            repo_path=temp_repo_path,
            llm_client=mock_llm_client,
            config=config,
        )

        # 模拟 ArchitectureAgent 的 run 方法
        mock_outputs = [create_mock_output(f"node{i}") for i in range(3)]

        with patch("backend.agent.orchestrator.ArchitectureAgent") as MockAgent:
            MockAgent.return_value.run.side_effect = mock_outputs

            result = orchestrator.run_module_analysis(
                modules=sample_modules,
                repo_name=None,  # 不启用检查点
            )

        # 验证结果
        assert result.status == "success"
        assert len(result.nodes) == 3
        assert result.meta["checkpoint_enabled"] is False
        assert orchestrator.checkpoint_manager is None


class TestOrchestratorMaxModulesLimit:
    """测试 max_modules 限制。"""

    def test_orchestrator_respects_max_modules(
        self, mock_llm_client, temp_repo_path, sample_modules
    ):
        """测试 max_modules 限制被正确应用。"""
        config = AnalysisConfig(preset=AnalysisPreset.QUICK)  # quick preset 有 max_modules=10
        config.max_modules = 2  # 覆盖为 2

        orchestrator = AgentOrchestrator(
            repo_path=temp_repo_path,
            llm_client=mock_llm_client,
            config=config,
        )

        # 模拟 ArchitectureAgent 的 run 方法
        mock_outputs = [create_mock_output(f"node{i}") for i in range(3)]

        with patch("backend.agent.orchestrator.ArchitectureAgent") as MockAgent:
            MockAgent.return_value.run.side_effect = mock_outputs

            result = orchestrator.run_module_analysis(
                modules=sample_modules,  # 3 个模块
                repo_name=None,
            )

        # 验证只处理了 2 个模块
        assert len(result.agent_outputs) == 2
        assert len(result.nodes) == 2
        assert result.meta["total_modules"] == 2


class TestContextMonitorReset:
    """测试上下文监控器重置。"""

    def test_context_monitor_reset_between_modules(
        self, mock_llm_client, temp_repo_path, sample_modules
    ):
        """测试模块间上下文监控器被正确重置。"""
        config = AnalysisConfig(preset=AnalysisPreset.STANDARD)

        orchestrator = AgentOrchestrator(
            repo_path=temp_repo_path,
            llm_client=mock_llm_client,
            config=config,
        )

        # 记录一些 token 使用量
        orchestrator.context_monitor._total_input = 10000
        orchestrator.context_monitor._total_output = 5000

        # 模拟 ArchitectureAgent 的 run 方法
        mock_outputs = [create_mock_output(f"node{i}") for i in range(3)]

        reset_spy = MagicMock(wraps=orchestrator.context_monitor.reset)

        with patch("backend.agent.orchestrator.ArchitectureAgent") as MockAgent:
            MockAgent.return_value.run.side_effect = mock_outputs
            with patch.object(
                orchestrator.context_monitor, "reset", reset_spy
            ):
                result = orchestrator.run_module_analysis(
                    modules=sample_modules,
                    repo_name=None,
                )

        # 验证 reset 被调用（每个模块后调用一次）
        assert reset_spy.call_count == 3
        assert result.status == "success"

    def test_context_monitor_reset_on_exception(
        self, mock_llm_client, temp_repo_path, sample_modules
    ):
        """测试模块执行异常时，上下文监控器仍被重置。"""
        config = AnalysisConfig(preset=AnalysisPreset.STANDARD)

        orchestrator = AgentOrchestrator(
            repo_path=temp_repo_path,
            llm_client=mock_llm_client,
            config=config,
        )

        reset_spy = MagicMock(wraps=orchestrator.context_monitor.reset)

        with patch("backend.agent.orchestrator.ArchitectureAgent") as MockAgent:
            # 第一个模块失败，第二个和第三个成功
            MockAgent.return_value.run.side_effect = [
                Exception("Test error"),
                create_mock_output("node2"),
                create_mock_output("node3"),
            ]

            with patch.object(
                orchestrator.context_monitor, "reset", reset_spy
            ):
                result = orchestrator.run_module_analysis(
                    modules=sample_modules,
                    repo_name=None,
                )

        # 验证 reset 仍被调用（每个模块后调用一次，包括失败的模块）
        assert reset_spy.call_count == 3
        assert result.status == "partial"  # 部分成功


class TestCheckpointManagerIntegration:
    """测试 CheckpointManager 集成。"""

    def test_checkpoint_manager_integration(
        self, mock_llm_client, temp_repo_path, temp_checkpoint_dir, sample_modules
    ):
        """测试 CheckpointManager 完整集成。"""
        config = AnalysisConfig(preset=AnalysisPreset.STANDARD)

        orchestrator = AgentOrchestrator(
            repo_path=temp_repo_path,
            llm_client=mock_llm_client,
            config=config,
        )

        # 使用真实的 CheckpointManager
        orchestrator.checkpoint_manager = CheckpointManager(
            repo_name="test-repo",
            storage_dir=temp_checkpoint_dir,
        )

        # 模拟 ArchitectureAgent 的 run 方法
        mock_outputs = [create_mock_output(f"node{i}", f"node{i}", f"node{i + 1}") for i in range(3)]

        with patch("backend.agent.orchestrator.ArchitectureAgent") as MockAgent:
            MockAgent.return_value.run.side_effect = mock_outputs

            result = orchestrator.run_module_analysis(
                modules=sample_modules,
                repo_name="test-repo",
            )

        # 验证结果
        assert result.status == "success"
        assert len(result.nodes) == 3
        assert len(result.edges) == 3

        # 验证检查点被保存
        assert len(orchestrator.checkpoint_manager) == 3

        # 验证可以加载检查点
        checkpoint = orchestrator.checkpoint_manager.load("module:backend.api")
        assert checkpoint is not None
        assert checkpoint.module_name == "API Module"
        assert checkpoint.status == CHECKPOINT_STATUS_COMPLETED
        assert len(checkpoint.nodes) == 1

    def test_aggregated_knowledge_injection(
        self, mock_llm_client, temp_repo_path, temp_checkpoint_dir
    ):
        """测试聚合知识被正确注入到后续模块。"""
        config = AnalysisConfig(preset=AnalysisPreset.STANDARD)

        orchestrator = AgentOrchestrator(
            repo_path=temp_repo_path,
            llm_client=mock_llm_client,
            config=config,
        )

        # 使用真实的 CheckpointManager
        orchestrator.checkpoint_manager = CheckpointManager(
            repo_name="test-repo",
            storage_dir=temp_checkpoint_dir,
        )

        # 预先添加一些知识
        orchestrator.checkpoint_manager.save(
            ModuleCheckpoint(
                module_id="previous:module",
                module_name="Previous Module",
                nodes=[],
                edges=[],
                knowledge={
                    "modules": [{"id": "prev:mod", "name": "Previous"}],
                    "layers": [{"name": "api"}, {"name": "core"}],
                },
                status=CHECKPOINT_STATUS_COMPLETED,
            )
        )

        modules = [{"id": "module:test", "name": "Test Module"}]

        with patch("backend.agent.orchestrator.ArchitectureAgent") as MockAgent:
            MockAgent.return_value.run.return_value = create_mock_output("test-node")

            orchestrator.run_module_analysis(
                modules=modules,
                repo_name="test-repo",
            )

        # 验证聚合知识被注入
        # 验证 get_aggregated_knowledge 返回正确结果
        aggregated = orchestrator.checkpoint_manager.get_aggregated_knowledge()
        assert len(aggregated["modules"]) == 1
        assert aggregated["modules"][0]["id"] == "prev:mod"
        assert len(aggregated["layers"]) == 2


class TestOrchestratorConfigIntegration:
    """测试编排器与配置的集成。"""

    def test_config_max_iterations_applied(
        self, mock_llm_client, temp_repo_path
    ):
        """测试配置中的 max_iterations_per_module 被正确应用。"""
        config = AnalysisConfig(preset=AnalysisPreset.DEEP)
        # DEEP preset 有 max_iterations_per_module=20

        orchestrator = AgentOrchestrator(
            repo_path=temp_repo_path,
            llm_client=mock_llm_client,
            config=config,
        )

        assert orchestrator.max_iterations == 20

    def test_config_context_window_applied(
        self, mock_llm_client, temp_repo_path
    ):
        """测试配置中的 context_window 被正确应用。"""
        config = AnalysisConfig(preset=AnalysisPreset.STANDARD)
        config.context_window = 200000

        orchestrator = AgentOrchestrator(
            repo_path=temp_repo_path,
            llm_client=mock_llm_client,
            config=config,
        )

        assert orchestrator.context_monitor.max_tokens == 200000

    def test_default_config_when_none_provided(
        self, mock_llm_client, temp_repo_path
    ):
        """测试未提供配置时使用默认值。"""
        orchestrator = AgentOrchestrator(
            repo_path=temp_repo_path,
            llm_client=mock_llm_client,
            config=None,
        )

        assert orchestrator.config is not None
        assert orchestrator.config.preset == AnalysisPreset.STANDARD
        assert orchestrator.max_iterations == 15  # STANDARD preset 默认值

    def test_partial_success_status(
        self, mock_llm_client, temp_repo_path, sample_modules
    ):
        """测试部分模块成功时返回 partial 状态。"""
        config = AnalysisConfig(preset=AnalysisPreset.STANDARD)

        orchestrator = AgentOrchestrator(
            repo_path=temp_repo_path,
            llm_client=mock_llm_client,
            config=config,
        )

        # 模拟：第一个成功，第二个失败，第三个成功
        with patch("backend.agent.orchestrator.ArchitectureAgent") as MockAgent:
            MockAgent.return_value.run.side_effect = [
                create_mock_output("node1"),
                AgentOutput(
                    agent_type="architecture",
                    module_id="module:backend.core",
                    status="failed",
                    execution_time_ms=100,
                ),
                create_mock_output("node3"),
            ]

            result = orchestrator.run_module_analysis(
                modules=sample_modules,
                repo_name=None,
            )

        assert result.status == "partial"
        assert len(result.nodes) == 2  # 2 个成功的节点
        assert result.meta["successful_modules"] == 2

    def test_all_failed_status(
        self, mock_llm_client, temp_repo_path, sample_modules
    ):
        """测试所有模块都失败时返回 failed 状态。"""
        config = AnalysisConfig(preset=AnalysisPreset.STANDARD)

        orchestrator = AgentOrchestrator(
            repo_path=temp_repo_path,
            llm_client=mock_llm_client,
            config=config,
        )

        # 模拟所有模块都失败
        with patch("backend.agent.orchestrator.ArchitectureAgent") as MockAgent:
            MockAgent.return_value.run.return_value = AgentOutput(
                agent_type="architecture",
                module_id="module:failed",
                status="failed",
                execution_time_ms=100,
            )

            result = orchestrator.run_module_analysis(
                modules=sample_modules,
                repo_name=None,
            )

        assert result.status == "failed"
        assert len(result.nodes) == 0