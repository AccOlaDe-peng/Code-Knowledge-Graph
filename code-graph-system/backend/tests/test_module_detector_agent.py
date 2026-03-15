# code-graph-system/backend/tests/test_module_detector_agent.py
"""测试模块检测 Agent。"""


def test_module_detector_agent_creation():
    """测试 ModuleDetectorAgent 可以创建。"""
    from backend.agent.agents.module_detector import ModuleDetectorAgent
    from backend.agent.context import AgentContext
    from backend.llm.client import LLMClient

    context = AgentContext(repo_path="/test", module_id="repo:root")
    llm_client = LLMClient(provider="anthropic", api_key="test")

    agent = ModuleDetectorAgent(context=context, llm_client=llm_client)

    assert agent.agent_type == "module_detector"
    assert "module" in agent.get_system_prompt().lower()


def test_module_detector_agent_tools_registered():
    """测试 ModuleDetectorAgent 注册了工具。"""
    from backend.agent.agents.module_detector import ModuleDetectorAgent
    from backend.agent.context import AgentContext
    from backend.llm.client import LLMClient

    context = AgentContext(repo_path="/test", module_id="repo:root")
    llm_client = LLMClient(provider="anthropic", api_key="test")

    agent = ModuleDetectorAgent(context=context, llm_client=llm_client)

    tool_names = [t["name"] for t in agent._tools]
    assert "read_file" in tool_names
    assert "list_directory" in tool_names
    assert "search_code" in tool_names
