"""多 Agent 流水线集成测试。"""

import pytest
from pathlib import Path
from unittest.mock import MagicMock, patch

from backend.pipeline.ai_analyze import AIPipeline
from backend.pipeline.multi_agent_pipeline import MultiAgentPipeline
from backend.collaboration import IterationConfig


class TestMultiAgentPipelineIntegration:
    """多 Agent 流水线集成测试。"""

    @pytest.fixture
    def temp_repo(self, tmp_path):
        """创建临时仓库。"""
        repo = tmp_path / "test_repo"
        repo.mkdir()
        (repo / "src").mkdir()

        # 创建一些 Java 文件
        (repo / "src" / "User.java").write_text("""
package com.example.entity;

import javax.persistence.Entity;
import javax.persistence.Table;
import javax.persistence.Id;
import javax.persistence.Column;

@Entity
@Table(name = "users")
public class User {
    @Id
    private Long id;

    @Column(name = "username")
    private String username;

    @Column(name = "email")
    private String email;

    // Getters and Setters
    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getUsername() { return username; }
    public void setUsername(String username) { this.username = username; }
    public String getEmail() { return email; }
    public void setEmail(String email) { this.email = email; }
}
""")

        (repo / "src" / "UserService.java").write_text("""
package com.example.service;

import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Autowired;

@Service
public class UserService {
    @Autowired
    private UserRepository userRepository;

    public User findById(Long id) {
        return userRepository.findById(id).orElse(null);
    }

    public User save(User user) {
        return userRepository.save(user);
    }
}
""")

        return repo

    @pytest.fixture
    def mock_llm_client(self):
        """Mock LLM 客户端。"""
        return MagicMock()

    def test_pipeline_mode_multi_agent(self, temp_repo, mock_llm_client):
        """测试 pipeline_mode=multi_agent 调用 MultiAgentPipeline。"""
        with patch('backend.pipeline.ai_analyze.LLMClient', return_value=mock_llm_client):
            with patch('backend.pipeline.multi_agent_pipeline.LLMClient', return_value=mock_llm_client):
                # Mock MultiAgentOrchestrator.run
                from backend.collaboration.orchestrator import MultiAgentOrchestrator
                from backend.collaboration import MultiAgentResult
                from backend.graph.graph_schema import GraphNode, NodeType

                mock_result = MultiAgentResult(
                    status="success",
                    nodes=[
                        GraphNode(
                            id="entity:User",
                            type=NodeType.ENTITY.value,
                            name="User",
                            properties={},
                        )
                    ],
                    edges=[],
                    iterations=1,
                )

                with patch.object(MultiAgentOrchestrator, 'run', return_value=mock_result):
                    pipeline = AIPipeline()
                    result = pipeline.analyze(
                        temp_repo,
                        repo_name="test-repo",
                        pipeline_mode="multi_agent",
                    )

                    assert result.status == "success"
                    assert len(result.nodes) == 1
                    assert result.nodes[0].name == "User"

    def test_multi_agent_pipeline_direct(self, temp_repo, mock_llm_client):
        """直接测试 MultiAgentPipeline。"""
        from backend.collaboration.orchestrator import MultiAgentOrchestrator
        from backend.collaboration import MultiAgentResult
        from backend.graph.graph_schema import GraphNode, NodeType

        with patch('backend.pipeline.multi_agent_pipeline.LLMClient', return_value=mock_llm_client):
            mock_result = MultiAgentResult(
                status="converged",
                nodes=[
                    GraphNode(
                        id="entity:User",
                        type=NodeType.ENTITY.value,
                        name="User",
                        properties={"confidence": 0.9},
                    ),
                    GraphNode(
                        id="service:UserService",
                        type=NodeType.SERVICE.value,
                        name="UserService",
                        properties={"confidence": 0.85},
                    ),
                ],
                edges=[],
                iterations=2,
                meta={"duration_seconds": 1.5},
            )

            with patch.object(MultiAgentOrchestrator, 'run', return_value=mock_result):
                pipeline = MultiAgentPipeline()
                result = pipeline.analyze(
                    temp_repo,
                    repo_name="test-repo",
                )

                assert result.status == "success"
                assert len(result.nodes) == 2
                assert result.graph_id  # 应该有 graph_id

    def test_multi_agent_pipeline_with_iteration_config(self, temp_repo, mock_llm_client):
        """测试自定义迭代配置。"""
        from backend.collaboration.orchestrator import MultiAgentOrchestrator
        from backend.collaboration import MultiAgentResult

        with patch('backend.pipeline.multi_agent_pipeline.LLMClient', return_value=mock_llm_client):
            mock_result = MultiAgentResult(
                status="stalled",
                nodes=[],
                edges=[],
                iterations=3,
            )

            captured_config = {}

            def capture_init(self, repo_path, llm_client, config, **kwargs):
                captured_config['max_iterations'] = config.max_iterations
                captured_config['convergence_threshold'] = config.convergence_threshold
                # 设置必要的属性
                self.repo_path = repo_path
                self.llm_client = llm_client
                self.config = config
                self.max_workers = kwargs.get('max_workers', 3)
                self.on_progress = kwargs.get('on_progress')
                self._agents = {}
                # Mock run
                return None

            with patch.object(MultiAgentOrchestrator, '__init__', capture_init):
                with patch.object(MultiAgentOrchestrator, 'run', return_value=mock_result):
                    with patch.object(MultiAgentOrchestrator, 'set_agent_priority'):
                        iteration_config = IterationConfig(
                            max_iterations=3,
                            convergence_threshold=0.98,
                        )

                        pipeline = MultiAgentPipeline(iteration_config=iteration_config)
                        pipeline.analyze(temp_repo, repo_name="test")

                        # 验证配置传递
                        assert captured_config['max_iterations'] == 3
                        assert captured_config['convergence_threshold'] == 0.98

    def test_multi_agent_pipeline_with_agent_priorities(self, temp_repo, mock_llm_client):
        """测试 Agent 优先级设置。"""
        from backend.collaboration.orchestrator import MultiAgentOrchestrator
        from backend.collaboration import MultiAgentResult

        with patch('backend.pipeline.multi_agent_pipeline.LLMClient', return_value=mock_llm_client):
            mock_result = MultiAgentResult(
                status="success",
                nodes=[],
                edges=[],
                iterations=1,
            )

            priorities_set = {}

            def mock_set_priority(agent_name, priority):
                priorities_set[agent_name] = priority

            # 完整 mock Orchestrator
            with patch('backend.pipeline.multi_agent_pipeline.MultiAgentOrchestrator') as MockOrchestrator:
                mock_orchestrator_instance = MagicMock()
                mock_orchestrator_instance.run.return_value = mock_result
                mock_orchestrator_instance.set_agent_priority = mock_set_priority
                MockOrchestrator.return_value = mock_orchestrator_instance

                pipeline = MultiAgentPipeline()
                pipeline.analyze(
                    temp_repo,
                    repo_name="test",
                    agent_priorities={
                        "EntityAgent": 1.5,
                        "ServiceAgent": 2.0,
                    },
                )

                assert priorities_set.get("EntityAgent") == 1.5
                assert priorities_set.get("ServiceAgent") == 2.0

    def test_multi_agent_pipeline_with_rag(self, temp_repo, mock_llm_client):
        """测试启用 RAG。"""
        from backend.collaboration.orchestrator import MultiAgentOrchestrator
        from backend.collaboration import MultiAgentResult
        from backend.graph.graph_schema import GraphNode, NodeType
        from backend.rag.vector_store import VectorStore

        mock_vs = MagicMock(spec=VectorStore)

        with patch('backend.pipeline.multi_agent_pipeline.LLMClient', return_value=mock_llm_client):
            mock_result = MultiAgentResult(
                status="success",
                nodes=[
                    GraphNode(
                        id="entity:User",
                        type=NodeType.ENTITY.value,
                        name="User",
                        properties={"description": "User entity"},
                    )
                ],
                edges=[],
                iterations=1,
            )

            with patch.object(MultiAgentOrchestrator, 'run', return_value=mock_result):
                pipeline = MultiAgentPipeline(vector_store=mock_vs)

                # Mock GraphRAGEngine.embed_nodes
                with patch('backend.pipeline.multi_agent_pipeline.GraphRAGEngine') as MockRAG:
                    mock_rag_instance = MagicMock()
                    mock_rag_instance.embed_nodes.return_value = 1
                    MockRAG.return_value = mock_rag_instance

                    result = pipeline.analyze(
                        temp_repo,
                        repo_name="test",
                        enable_rag=True,
                    )

                    # 验证 RAG 被调用
                    mock_rag_instance.embed_nodes.assert_called_once()

    def test_pipeline_mode_comparison(self, temp_repo, mock_llm_client):
        """测试不同 pipeline_mode 的行为。"""
        from backend.collaboration.orchestrator import MultiAgentOrchestrator
        from backend.collaboration import MultiAgentResult
        from backend.graph.graph_schema import GraphNode, NodeType

        with patch('backend.pipeline.ai_analyze.LLMClient', return_value=mock_llm_client):
            mock_result = MultiAgentResult(
                status="success",
                nodes=[
                    GraphNode(
                        id="entity:User",
                        type=NodeType.ENTITY.value,
                        name="User",
                        properties={},
                    )
                ],
                edges=[],
                iterations=1,
            )

            with patch('backend.pipeline.multi_agent_pipeline.MultiAgentOrchestrator') as MockOrchestrator:
                mock_orchestrator_instance = MagicMock()
                mock_orchestrator_instance.run.return_value = mock_result
                MockOrchestrator.return_value = mock_orchestrator_instance

                pipeline = AIPipeline()

                # 测试 multi_agent 模式
                result = pipeline.analyze(
                    temp_repo,
                    repo_name="test",
                    pipeline_mode="multi_agent",
                )
                assert result.status == "success"
                assert len(result.nodes) == 1


class TestPipelineModeSelection:
    """流水线模式选择测试。"""

    def test_pipeline_modes_are_mutually_exclusive(self):
        """验证流水线模式是互斥的。"""
        # 这只是文档性测试，实际验证在集成测试中
        modes = ["static_first", "ai_first", "multi_agent", "optimized"]
        assert len(modes) == len(set(modes))  # 无重复

    def test_default_mode_is_static_first(self):
        """验证默认模式是 static_first。"""
        pipeline = AIPipeline()
        assert pipeline._enable_static_first is True
        assert pipeline._enable_optimization is False
