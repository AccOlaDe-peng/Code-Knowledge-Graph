# code-graph-system/backend/tests/test_agent_orchestrator.py
"""测试 Agent 编排器。"""


def test_agent_orchestrator_creation():
    """测试 AgentOrchestrator 可以创建。"""
    from backend.agent.orchestrator import AgentOrchestrator
    from backend.llm.client import LLMClient

    llm_client = LLMClient(provider="anthropic", api_key="test")
    orchestrator = AgentOrchestrator(
        repo_path="/test",
        llm_client=llm_client,
    )

    # repo_path 被转换为绝对路径
    assert str(orchestrator.repo_path).endswith("test") or str(orchestrator.repo_path) == "/test"
    assert orchestrator.llm_client == llm_client


def test_agent_orchestrator_run_module_detection():
    """测试 AgentOrchestrator 可以运行模块检测。"""
    from unittest.mock import patch, MagicMock
    from backend.agent.orchestrator import AgentOrchestrator
    from backend.llm.client import LLMClient

    llm_client = LLMClient(provider="anthropic", api_key="test")
    orchestrator = AgentOrchestrator(
        repo_path="/test",
        llm_client=llm_client,
    )

    # Mock ModuleDetectorAgent.run()
    with patch('backend.agent.orchestrator.ModuleDetectorAgent') as MockAgent:
        mock_instance = MagicMock()
        mock_instance.run.return_value = MagicMock(
            status="success",
            nodes=[],
            edges=[],
        )
        MockAgent.return_value = mock_instance

        result = orchestrator.run_module_detection()

        assert result.status == "success"
        MockAgent.assert_called_once()
