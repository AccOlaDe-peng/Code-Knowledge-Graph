# code-graph-system/backend/tests/test_cross_module_agent.py
"""测试跨模块分析 Agent。"""


def test_cross_module_agent_creation():
    """测试 CrossModuleAgent 可以创建。"""
    from backend.agent.agents.cross_module import CrossModuleAgent
    from backend.agent.context import AgentContext
    from backend.llm.client import LLMClient

    context = AgentContext(repo_path="/test", module_id="repo:root")
    llm_client = LLMClient(provider="anthropic", api_key="test")

    agent = CrossModuleAgent(context=context, llm_client=llm_client)

    assert agent.agent_type == "cross_module"
    assert "cross" in agent.get_system_prompt().lower() or "module" in agent.get_system_prompt().lower()


def test_cross_module_agent_tools_registered():
    """测试 CrossModuleAgent 注册了工具。"""
    from backend.agent.agents.cross_module import CrossModuleAgent
    from backend.agent.context import AgentContext
    from backend.llm.client import LLMClient

    context = AgentContext(repo_path="/test", module_id="repo:root")
    llm_client = LLMClient(provider="anthropic", api_key="test")

    agent = CrossModuleAgent(context=context, llm_client=llm_client)

    tool_names = [t["name"] for t in agent._tools]
    assert "search_code" in tool_names
    assert "read_file" in tool_names


def test_cross_module_agent_with_modules():
    """测试 CrossModuleAgent 使用模块信息。"""
    from backend.agent.agents.cross_module import CrossModuleAgent
    from backend.agent.context import AgentContext
    from backend.llm.client import LLMClient

    context = AgentContext(repo_path="/test", module_id="repo:root")
    context.shared_knowledge.modules = [
        {"id": "module:auth", "name": "Auth", "path": "auth/"},
        {"id": "module:user", "name": "User", "path": "user/"},
    ]

    llm_client = LLMClient(provider="anthropic", api_key="test")
    agent = CrossModuleAgent(context=context, llm_client=llm_client)

    assert len(agent.context.shared_knowledge.modules) == 2