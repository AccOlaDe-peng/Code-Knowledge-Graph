# code-graph-system/backend/tests/test_architecture_agent.py
"""测试架构分析 Agent。"""


def test_architecture_agent_creation():
    """测试 ArchitectureAgent 可以创建。"""
    from backend.agent.agents.architecture import ArchitectureAgent
    from backend.agent.context import AgentContext
    from backend.llm.client import LLMClient

    context = AgentContext(repo_path="/test", module_id="repo:root")
    llm_client = LLMClient(provider="anthropic", api_key="test")

    agent = ArchitectureAgent(context=context, llm_client=llm_client)

    assert agent.agent_type == "architecture"
    assert "architecture" in agent.get_system_prompt().lower()


def test_architecture_agent_tools_registered():
    """测试 ArchitectureAgent 注册了工具。"""
    from backend.agent.agents.architecture import ArchitectureAgent
    from backend.agent.context import AgentContext
    from backend.llm.client import LLMClient

    context = AgentContext(repo_path="/test", module_id="repo:root")
    llm_client = LLMClient(provider="anthropic", api_key="test")

    agent = ArchitectureAgent(context=context, llm_client=llm_client)

    tool_names = [t["name"] for t in agent._tools]
    assert "read_file" in tool_names
    assert "search_code" in tool_names


def test_architecture_agent_with_shared_knowledge():
    """测试 ArchitectureAgent 使用共享知识库。"""
    from backend.agent.agents.architecture import ArchitectureAgent
    from backend.agent.context import AgentContext, SharedKnowledgeBase
    from backend.llm.client import LLMClient

    shared_kb = SharedKnowledgeBase()
    shared_kb.modules.append({
        "id": "module:services",
        "name": "Services",
        "path": "services",
    })

    context = AgentContext(
        repo_path="/test",
        module_id="repo:root",
        shared_knowledge=shared_kb,
    )
    llm_client = LLMClient(provider="anthropic", api_key="test")

    agent = ArchitectureAgent(context=context, llm_client=llm_client)

    # 验证共享知识库可访问
    assert len(agent.context.shared_knowledge.modules) == 1
