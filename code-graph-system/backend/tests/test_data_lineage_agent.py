# code-graph-system/backend/tests/test_data_lineage_agent.py
"""测试数据血缘分析 Agent。"""


def test_data_lineage_agent_creation():
    """测试 DataLineageAgent 可以创建。"""
    from backend.agent.agents.data_lineage import DataLineageAgent
    from backend.agent.context import AgentContext
    from backend.llm.client import LLMClient

    context = AgentContext(repo_path="/test", module_id="repo:root")
    llm_client = LLMClient(provider="anthropic", api_key="test")

    agent = DataLineageAgent(context=context, llm_client=llm_client)

    assert agent.agent_type == "data_lineage"
    assert "data" in agent.get_system_prompt().lower()


def test_data_lineage_agent_tools_registered():
    """测试 DataLineageAgent 注册了工具。"""
    from backend.agent.agents.data_lineage import DataLineageAgent
    from backend.agent.context import AgentContext
    from backend.llm.client import LLMClient

    context = AgentContext(repo_path="/test", module_id="repo:root")
    llm_client = LLMClient(provider="anthropic", api_key="test")

    agent = DataLineageAgent(context=context, llm_client=llm_client)

    tool_names = [t["name"] for t in agent._tools]
    assert "read_file" in tool_names
    assert "search_code" in tool_names


def test_data_lineage_agent_with_data_objects():
    """测试 DataLineageAgent 使用数据对象信息。"""
    from backend.agent.agents.data_lineage import DataLineageAgent
    from backend.agent.context import AgentContext
    from backend.models.discovery import DataObjectDiscovery
    from backend.llm.client import LLMClient

    context = AgentContext(repo_path="/test", module_id="repo:root")
    context.discoveries.data_objects.append(DataObjectDiscovery(
        object_id="dto:UserDTO",
        name="UserDTO",
        object_type="dto",
        file_path="models/user.py",
    ))

    llm_client = LLMClient(provider="anthropic", api_key="test")
    agent = DataLineageAgent(context=context, llm_client=llm_client)

    assert len(agent.context.discoveries.data_objects) == 1
    assert agent.context.discoveries.data_objects[0].name == "UserDTO"