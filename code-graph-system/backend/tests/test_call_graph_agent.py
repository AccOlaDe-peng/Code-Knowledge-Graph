# code-graph-system/backend/tests/test_call_graph_agent.py
"""测试调用图分析 Agent。"""


def test_call_graph_agent_creation():
    """测试 CallGraphAgent 可以创建。"""
    from backend.agent.agents.call_graph import CallGraphAgent
    from backend.agent.context import AgentContext
    from backend.llm.client import LLMClient

    context = AgentContext(repo_path="/test", module_id="repo:root")
    llm_client = LLMClient(provider="anthropic", api_key="test")

    agent = CallGraphAgent(context=context, llm_client=llm_client)

    assert agent.agent_type == "call_graph"
    assert "call" in agent.get_system_prompt().lower()


def test_call_graph_agent_tools_registered():
    """测试 CallGraphAgent 注册了工具。"""
    from backend.agent.agents.call_graph import CallGraphAgent
    from backend.agent.context import AgentContext
    from backend.llm.client import LLMClient

    context = AgentContext(repo_path="/test", module_id="repo:root")
    llm_client = LLMClient(provider="anthropic", api_key="test")

    agent = CallGraphAgent(context=context, llm_client=llm_client)

    tool_names = [t["name"] for t in agent._tools]
    assert "read_file" in tool_names
    assert "search_code" in tool_names


def test_call_graph_agent_with_functions():
    """测试 CallGraphAgent 使用共享知识库中的函数信息。"""
    from backend.agent.agents.call_graph import CallGraphAgent
    from backend.agent.context import AgentContext, SharedKnowledgeBase
    from backend.models.discovery import FunctionDiscovery
    from backend.llm.client import LLMClient

    context = AgentContext(repo_path="/test", module_id="repo:root")
    context.discoveries.functions.append(FunctionDiscovery(
        function_id="func:login",
        name="login",
        file_path="auth/login.py",
        line_start=10,
        line_end=25,
    ))

    llm_client = LLMClient(provider="anthropic", api_key="test")
    agent = CallGraphAgent(context=context, llm_client=llm_client)

    # 验证函数信息可访问
    assert len(agent.context.discoveries.functions) == 1
    assert agent.context.discoveries.functions[0].name == "login"
