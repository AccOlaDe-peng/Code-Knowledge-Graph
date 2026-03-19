"""测试 BaseAgent._tool_executors 映射和向后兼容性。"""

import pytest
import unittest.mock as mock
from backend.agent.base import BaseAgent
from backend.agent.context import AgentContext
from backend.llm.client import LLMClient


class ConcreteAgent(BaseAgent):
    """用于测试的最简 Agent 实现。"""
    def get_system_prompt(self): return "test"
    def run(self): return None


def _make_agent() -> ConcreteAgent:
    """创建一个用于测试的 Agent 实例（不依赖真实 LLM）。"""
    context = mock.MagicMock(spec=AgentContext)
    context.module_id = "test_module"
    llm_client = mock.MagicMock(spec=LLMClient)
    return ConcreteAgent(agent_type="test", context=context, llm_client=llm_client)


class TestRegisterToolWithExecutor:
    def test_register_without_executor_backward_compatible(self):
        """不传 executor 时，行为与原来一致。"""
        agent = _make_agent()
        agent.register_tool("my_tool", "desc", {"type": "object"})
        assert len(agent._tools) == 1
        assert "my_tool" not in agent._tool_executors

    def test_register_with_executor_stored_in_map(self):
        """传 executor 时，存储到 _tool_executors。"""
        class MyExecutor:
            def my_tool(self): return {}

        agent = _make_agent()
        executor = MyExecutor()
        agent.register_tool("my_tool", "desc", {"type": "object"}, executor=executor)
        assert "my_tool" in agent._tool_executors
        assert agent._tool_executors["my_tool"] is executor

    def test_tool_definition_always_added(self):
        """无论是否有 executor，工具定义都加入 _tools。"""
        class MyExecutor:
            def my_tool(self): return {}

        agent = _make_agent()
        agent.register_tool("my_tool", "desc", {"type": "object"}, executor=MyExecutor())
        assert any(t["name"] == "my_tool" for t in agent._tools)

    def test_multiple_executors_independent(self):
        """多个工具可有不同 executor。"""
        class ExecA:
            def tool_a(self): return {}

        class ExecB:
            def tool_b(self): return {}

        agent = _make_agent()
        exec_a, exec_b = ExecA(), ExecB()
        agent.register_tool("tool_a", "a", {"type": "object"}, executor=exec_a)
        agent.register_tool("tool_b", "b", {"type": "object"}, executor=exec_b)
        assert agent._tool_executors["tool_a"] is exec_a
        assert agent._tool_executors["tool_b"] is exec_b

    def test_tool_executors_dict_exists_on_init(self):
        """_tool_executors 在初始化时就应存在。"""
        agent = _make_agent()
        assert hasattr(agent, "_tool_executors")
        assert isinstance(agent._tool_executors, dict)
        assert len(agent._tool_executors) == 0
