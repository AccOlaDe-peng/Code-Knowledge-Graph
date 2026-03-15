# code-graph-system/backend/tests/test_api_endpoint_agent.py
"""测试 API 端点分析 Agent。"""


def test_api_endpoint_agent_creation():
    """测试 APIEndpointAgent 可以创建。"""
    from backend.agent.agents.api_endpoint import APIEndpointAgent
    from backend.agent.context import AgentContext
    from backend.llm.client import LLMClient

    context = AgentContext(repo_path="/test", module_id="repo:root")
    llm_client = LLMClient(provider="anthropic", api_key="test")

    agent = APIEndpointAgent(context=context, llm_client=llm_client)

    assert agent.agent_type == "api_endpoint"
    assert "api" in agent.get_system_prompt().lower()


def test_api_endpoint_agent_tools_registered():
    """测试 APIEndpointAgent 注册了工具。"""
    from backend.agent.agents.api_endpoint import APIEndpointAgent
    from backend.agent.context import AgentContext
    from backend.llm.client import LLMClient

    context = AgentContext(repo_path="/test", module_id="repo:root")
    llm_client = LLMClient(provider="anthropic", api_key="test")

    agent = APIEndpointAgent(context=context, llm_client=llm_client)

    tool_names = [t["name"] for t in agent._tools]
    assert "search_code" in tool_names
    assert "read_file" in tool_names


def test_api_endpoint_agent_with_modules():
    """测试 APIEndpointAgent 使用模块信息。"""
    from backend.agent.agents.api_endpoint import APIEndpointAgent
    from backend.agent.context import AgentContext
    from backend.llm.client import LLMClient

    context = AgentContext(repo_path="/test", module_id="module:api")
    context.shared_knowledge.modules.append({
        "id": "module:api",
        "name": "API",
        "path": "api/",
    })

    llm_client = LLMClient(provider="anthropic", api_key="test")
    agent = APIEndpointAgent(context=context, llm_client=llm_client)

    assert len(agent.context.shared_knowledge.modules) == 1