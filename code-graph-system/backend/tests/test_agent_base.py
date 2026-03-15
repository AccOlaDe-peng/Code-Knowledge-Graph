# code-graph-system/backend/tests/test_agent_base.py
"""测试 Agent 基础系统。"""


def test_agent_context_creation():
    """测试 AgentContext 可以创建。"""
    from backend.agent.context import AgentContext

    context = AgentContext(
        repo_path="/path/to/repo",
        module_id="module:test",
    )

    assert context.repo_path == "/path/to/repo"
    assert context.module_id == "module:test"


def test_shared_knowledge_base():
    """测试 SharedKnowledgeBase 可以创建和操作。"""
    from backend.agent.context import SharedKnowledgeBase

    kb = SharedKnowledgeBase()
    kb.layers.append({"id": "layer:presentation", "name": "Presentation"})

    assert len(kb.layers) == 1
    assert kb.layers[0]["name"] == "Presentation"


def test_base_agent_initialization():
    """测试 BaseAgent 可以初始化。"""
    from backend.agent.base import BaseAgent
    from backend.agent.context import AgentContext
    from backend.llm.client import LLMClient
    from backend.models.agent_output import AgentOutput

    # 创建具体实现类
    class ConcreteAgent(BaseAgent):
        def get_system_prompt(self) -> str:
            return "Test prompt"

        def run(self) -> AgentOutput:
            return self.create_output(status="success")

    context = AgentContext(repo_path="/test", module_id="module:test")
    llm_client = LLMClient(provider="anthropic", api_key="test")

    agent = ConcreteAgent(
        agent_type="test_agent",
        context=context,
        llm_client=llm_client
    )

    assert agent.agent_type == "test_agent"
    assert agent.context == context


def test_base_agent_register_tool():
    """测试 BaseAgent 可以注册工具。"""
    from backend.agent.base import BaseAgent
    from backend.agent.context import AgentContext
    from backend.llm.client import LLMClient
    from backend.models.agent_output import AgentOutput

    # 创建具体实现类
    class ConcreteAgent(BaseAgent):
        def get_system_prompt(self) -> str:
            return "Test prompt"

        def run(self) -> AgentOutput:
            return self.create_output(status="success")

    context = AgentContext(repo_path="/test", module_id="module:test")
    llm_client = LLMClient(provider="anthropic", api_key="test")

    agent = ConcreteAgent(
        agent_type="test_agent",
        context=context,
        llm_client=llm_client
    )

    agent.register_tool(
        name="read_file",
        description="Read a file",
        input_schema={"type": "object", "properties": {"path": {"type": "string"}}}
    )

    assert len(agent._tools) == 1
    assert agent._tools[0]["name"] == "read_file"
