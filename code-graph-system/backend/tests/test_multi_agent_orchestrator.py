"""Phase 5 多 Agent 编排器测试。"""

import pytest
from unittest.mock import MagicMock, patch

from backend.collaboration import (
    MultiAgentOrchestrator,
    MultiAgentResult,
    IterationConfig,
    IterationState,
)
from backend.agent_v2 import AgentResult
from backend.graph.graph_schema import GraphNode, NodeType


class TestMultiAgentOrchestrator:
    """MultiAgentOrchestrator 测试。"""

    @pytest.fixture
    def mock_llm_client(self):
        """Mock LLM 客户端。"""
        return MagicMock()

    @pytest.fixture
    def temp_repo(self, tmp_path):
        """创建临时仓库。"""
        repo = tmp_path / "test_repo"
        repo.mkdir()
        (repo / "src").mkdir()
        (repo / "src" / "Main.java").write_text("""
package com.example;
public class Main {
    public static void main(String[] args) {
        System.out.println("Hello");
    }
}
""")
        return repo

    def test_init(self, temp_repo, mock_llm_client):
        """测试初始化。"""
        orchestrator = MultiAgentOrchestrator(
            repo_path=temp_repo,
            llm_client=mock_llm_client,
        )

        # 验证组件初始化
        assert orchestrator.knowledge_hub is not None
        assert orchestrator.iteration_controller is not None
        assert orchestrator.cross_validation is not None
        assert orchestrator.arbitrator is not None

        # 验证 Agent 初始化
        assert len(orchestrator._agents) == 5
        assert "EntityAgent" in orchestrator._agents
        assert "ServiceAgent" in orchestrator._agents
        assert "FlowAgent" in orchestrator._agents
        assert "LineageAgent" in orchestrator._agents
        assert "TopicAgent" in orchestrator._agents

        # 每个 Agent 应该有自己的 ToolExecutor
        for agent in orchestrator._agents.values():
            assert agent.tool_executor is not None

    def test_run_with_mocked_agents(self, temp_repo, mock_llm_client):
        """测试运行（Mock Agent）。"""
        orchestrator = MultiAgentOrchestrator(
            repo_path=temp_repo,
            llm_client=mock_llm_client,
            config=IterationConfig(max_iterations=1),
        )

        # Mock 所有 Agent 的 run 方法
        mock_result = AgentResult(
            agent_name="EntityAgent",
            nodes=[
                GraphNode(
                    id="entity:User",
                    type=NodeType.ENTITY.value,
                    name="User",
                    properties={"confidence": 0.9},
                )
            ],
            edges=[],
            confidence=0.9,
        )

        for agent in orchestrator._agents.values():
            agent.run = MagicMock(return_value=mock_result)
            agent.refine = MagicMock()

        # 运行
        result = orchestrator.run()

        # 验证结果
        assert result.status in ("success", "converged", "stalled")
        assert result.iterations >= 1
        assert len(result.agent_results) == 5

    def test_run_with_custom_config(self, temp_repo, mock_llm_client):
        """测试自定义配置。"""
        config = IterationConfig(
            max_iterations=2,
            convergence_threshold=0.99,  # 高阈值，难以收敛
            stall_threshold=3,
        )

        orchestrator = MultiAgentOrchestrator(
            repo_path=temp_repo,
            llm_client=mock_llm_client,
            config=config,
        )

        # Mock Agent 返回稳定结果
        stable_result = AgentResult(
            agent_name="TestAgent",
            nodes=[],
            edges=[],
            confidence=0.7,
        )

        for agent in orchestrator._agents.values():
            agent.run = MagicMock(return_value=stable_result)

        result = orchestrator.run()

        # 应该因为达到最大迭代而停止
        assert result.iterations <= 2

    def test_progress_callback(self, temp_repo, mock_llm_client):
        """测试进度回调。"""
        progress_events = []

        def on_progress(event):
            progress_events.append(event)

        orchestrator = MultiAgentOrchestrator(
            repo_path=temp_repo,
            llm_client=mock_llm_client,
            config=IterationConfig(max_iterations=1),
            on_progress=on_progress,
        )

        # Mock Agent
        for agent in orchestrator._agents.values():
            agent.run = MagicMock(return_value=AgentResult(
                agent_name=agent.name,
                nodes=[],
                edges=[],
                confidence=0.8,
            ))

        orchestrator.run()

        # 验证进度事件
        assert len(progress_events) > 0

        # 检查关键事件
        stages = [e.get("stage") for e in progress_events]
        assert "init" in stages
        assert "iteration" in stages

    def test_set_agent_priority(self, temp_repo, mock_llm_client):
        """测试设置 Agent 优先级。"""
        orchestrator = MultiAgentOrchestrator(
            repo_path=temp_repo,
            llm_client=mock_llm_client,
        )

        orchestrator.set_agent_priority("EntityAgent", 2.0)

        # 验证优先级设置
        assert orchestrator.arbitrator._agent_priorities.get("EntityAgent") == 2.0

    def test_set_resolution_strategy(self, temp_repo, mock_llm_client):
        """测试设置解决策略。"""
        from backend.collaboration.arbitrator import ResolutionStrategy

        orchestrator = MultiAgentOrchestrator(
            repo_path=temp_repo,
            llm_client=mock_llm_client,
        )

        orchestrator.set_resolution_strategy("type_mismatch", ResolutionStrategy.MAJORITY_VOTE)

        # 验证策略设置
        assert orchestrator.arbitrator._strategies.get("type_mismatch") == ResolutionStrategy.MAJORITY_VOTE

    def test_get_stats(self, temp_repo, mock_llm_client):
        """测试获取统计信息。"""
        orchestrator = MultiAgentOrchestrator(
            repo_path=temp_repo,
            llm_client=mock_llm_client,
        )

        # Mock Agent
        for agent in orchestrator._agents.values():
            agent.run = MagicMock(return_value=AgentResult(
                agent_name=agent.name,
                nodes=[],
                edges=[],
                confidence=0.8,
            ))

        orchestrator.run()

        stats = orchestrator.get_stats()

        assert "iterations" in stats
        assert "arbitrator" in stats
        assert "cross_validation" in stats
        assert "knowledge_hub" in stats

    def test_agent_failure_handling(self, temp_repo, mock_llm_client):
        """测试 Agent 失败处理。"""
        orchestrator = MultiAgentOrchestrator(
            repo_path=temp_repo,
            llm_client=mock_llm_client,
            config=IterationConfig(max_iterations=1),
        )

        # Mock 部分成功部分失败
        call_count = {"count": 0}

        def make_mock_run(agent_name):
            def mock_run():
                call_count["count"] += 1
                if agent_name == "EntityAgent":
                    raise RuntimeError("Simulated failure")
                return AgentResult(
                    agent_name=agent_name,
                    nodes=[],
                    edges=[],
                    confidence=0.8,
                )
            return mock_run

        for name, agent in orchestrator._agents.items():
            agent.run = make_mock_run(name)

        # 不应该抛出异常
        result = orchestrator.run()

        # 应该返回部分结果
        assert result.status in ("success", "partial", "failed")

    def test_conflict_detection_integration(self, temp_repo, mock_llm_client):
        """测试冲突检测集成。"""
        orchestrator = MultiAgentOrchestrator(
            repo_path=temp_repo,
            llm_client=mock_llm_client,
            config=IterationConfig(max_iterations=1),
        )

        # Mock Agent 返回冲突的节点
        node1 = GraphNode(
            id="entity:User",
            type=NodeType.ENTITY.value,
            name="User",
            properties={"table_name": "users"},
        )

        node2 = GraphNode(
            id="entity:User",
            type=NodeType.SERVICE.value,  # 类型冲突
            name="User",
            properties={"table_name": "app_users"},
        )

        call_count = {"count": 0}

        def mock_run_entity():
            call_count["count"] += 1
            return AgentResult(
                agent_name="EntityAgent",
                nodes=[node1],
                edges=[],
                confidence=0.9,
            )

        def mock_run_service():
            call_count["count"] += 1
            return AgentResult(
                agent_name="ServiceAgent",
                nodes=[node2],
                edges=[],
                confidence=0.8,
            )

        def mock_run_default(agent_name):
            def run():
                call_count["count"] += 1
                return AgentResult(
                    agent_name=agent_name,
                    nodes=[],
                    edges=[],
                    confidence=0.8,
                )
            return run

        for name, agent in orchestrator._agents.items():
            if name == "EntityAgent":
                agent.run = mock_run_entity
            elif name == "ServiceAgent":
                agent.run = mock_run_service
            else:
                agent.run = mock_run_default(name)

        result = orchestrator.run()

        # 应该检测到冲突
        assert len(result.conflicts) >= 1

    def test_iteration_metrics(self, temp_repo, mock_llm_client):
        """测试迭代指标收集。"""
        orchestrator = MultiAgentOrchestrator(
            repo_path=temp_repo,
            llm_client=mock_llm_client,
            config=IterationConfig(max_iterations=1),
        )

        # Mock Agent
        for agent in orchestrator._agents.values():
            agent.run = MagicMock(return_value=AgentResult(
                agent_name=agent.name,
                nodes=[
                    GraphNode(
                        id=f"node:{agent.name}",
                        type=NodeType.ENTITY.value,
                        name=agent.name,
                        properties={},
                    )
                ],
                edges=[],
                confidence=0.85,
            ))

        result = orchestrator.run()

        # 验证元数据
        assert "duration_seconds" in result.meta
        assert "final_state" in result.meta
        assert result.meta["iterations"] >= 1


class TestMultiAgentResult:
    """MultiAgentResult 测试。"""

    def test_default_values(self):
        """测试默认值。"""
        result = MultiAgentResult(status="success")

        assert result.status == "success"
        assert result.nodes == []
        assert result.edges == []
        assert result.iterations == 0
        assert result.agent_results == {}
        assert result.conflicts == []
        assert result.arbitrations == []
        assert result.meta == {}

    def test_with_data(self):
        """测试带数据。"""
        node = GraphNode(
            id="test:1",
            type=NodeType.ENTITY.value,
            name="Test",
            properties={},
        )

        result = MultiAgentResult(
            status="converged",
            nodes=[node],
            edges=[],
            iterations=3,
            meta={"duration_seconds": 10.5},
        )

        assert result.status == "converged"
        assert len(result.nodes) == 1
        assert result.iterations == 3
        assert result.meta["duration_seconds"] == 10.5
