"""Phase 1 组件测试。"""

import pytest

from backend.tools import (
    ToolExecutor,
    AGENT_TOOL_PERMISSIONS,
    ALL_TOOL_DEFINITIONS,
    ToolResult,
    ToolResultStatus,
)
from backend.knowledge import (
    KnowledgeHub,
    KnowledgeEventType,
    KnowledgeEvent,
    calculate_propagated_confidence,
    calculate_dependency_depth,
    aggregate_confidence,
)
from backend.agent_v2 import (
    DomainAgent,
    AgentPhase,
    AgentResult,
    AgentContext,
)
from backend.graph.graph_schema import GraphNode, GraphEdge


class TestKnowledgeHub:
    """KnowledgeHub 测试。"""

    def test_simple_publish_query(self):
        """测试简单 key-value 存取。"""
        hub = KnowledgeHub()
        hub.publish("test_key", {"value": 123}, confidence=0.9)

        result = hub.query("test_key")
        assert result == {"value": 123}

    def test_full_publish_query(self):
        """测试完整事件发布。"""
        hub = KnowledgeHub()

        hub.publish(
            "EntityAgent",
            KnowledgeEventType.ENTITY_ANALYZED,
            {"entity_name": "User", "fields": ["id", "name"], "confidence": 0.95},
        )

        entity = hub.get_entity("User")
        assert entity is not None
        assert entity["entity_name"] == "User"

    def test_subscribe_event(self):
        """测试事件订阅。"""
        hub = KnowledgeHub()
        received_events = []

        def on_entity_analyzed(event: KnowledgeEvent):
            received_events.append(event)

        hub.subscribe(KnowledgeEventType.ENTITY_ANALYZED, on_entity_analyzed)

        hub.publish(
            "EntityAgent",
            KnowledgeEventType.ENTITY_ANALYZED,
            {"entity_name": "Order"},
        )

        assert len(received_events) == 1
        assert received_events[0].data["entity_name"] == "Order"

    def test_confidence_propagation(self):
        """测试置信度传播。"""
        hub = KnowledgeHub()

        hub.publish("EntityAgent", KnowledgeEventType.ENTITY_ANALYZED, {
            "entity_name": "User",
            "confidence": 0.9,
        })

        hub.set_dependencies("field:User.name", ["entity:User"])
        hub.set_confidence("field:User.name", 0.85)

        propagated = hub.get_propagated_confidence("field:User.name")
        assert 0 < propagated < 0.85  # 应该有衰减

    def test_stats(self):
        """测试统计信息。"""
        hub = KnowledgeHub()

        hub.publish("EntityAgent", KnowledgeEventType.ENTITY_ANALYZED, {"entity_name": "User"})
        hub.publish("ServiceAgent", KnowledgeEventType.SERVICE_ANALYZED, {"service_name": "UserService"})

        stats = hub.get_stats()
        assert stats["entity_count"] == 1
        assert stats["service_count"] == 1


class TestConfidenceCalculation:
    """置信度计算测试。"""

    def test_base_confidence(self):
        """测试基础置信度。"""
        conf = calculate_propagated_confidence(
            "node1",
            {"node1": 0.9},
            {},
        )
        assert conf == 0.9

    def test_propagation_with_decay(self):
        """测试带衰减的传播。"""
        conf = calculate_propagated_confidence(
            "node1",
            {"node1": 0.9, "node2": 0.8},
            {"node1": ["node2"]},
        )
        # node1.base=0.9, decay=0.85, upstream=0.8
        # = 0.9 * 0.85 * 0.8 = 0.612
        assert 0.5 < conf < 0.9

    def test_circular_dependency(self):
        """测试循环依赖处理。"""
        conf = calculate_propagated_confidence(
            "node1",
            {"node1": 0.9, "node2": 0.8},
            {"node1": ["node2"], "node2": ["node1"]},
        )
        # 应该检测到循环并返回基础置信度
        assert conf > 0

    def test_dependency_depth(self):
        """测试依赖深度计算。"""
        depth = calculate_dependency_depth(
            "node1",
            {"node1": ["node2"], "node2": ["node3"], "node3": []},
        )
        assert depth == 2

    def test_aggregate_confidence(self):
        """测试置信度聚合。"""
        confidences = [0.9, 0.8, 0.7]

        assert aggregate_confidence(confidences, "min") == 0.7
        assert aggregate_confidence(confidences, "max") == 0.9
        assert abs(aggregate_confidence(confidences, "avg") - 0.8) < 0.0001  # 浮点数比较


class TestToolDefinitions:
    """工具定义测试。"""

    def test_all_tools_defined(self):
        """测试所有工具都有定义。"""
        assert len(ALL_TOOL_DEFINITIONS) >= 20

        # 检查关键字段
        for name, tool in ALL_TOOL_DEFINITIONS.items():
            assert tool.name == name
            assert tool.description
            assert tool.parameters
            assert tool.layer in ("base", "semantic", "framework", "advanced")

    def test_agent_permissions(self):
        """测试 Agent 权限配置。"""
        assert "EntityAgent" in AGENT_TOOL_PERMISSIONS
        assert "ServiceAgent" in AGENT_TOOL_PERMISSIONS
        assert "LineageAgent" in AGENT_TOOL_PERMISSIONS
        assert "FlowAgent" in AGENT_TOOL_PERMISSIONS
        assert "TopicAgent" in AGENT_TOOL_PERMISSIONS

        # EntityAgent 应该有 JPA 相关工具
        entity_tools = AGENT_TOOL_PERMISSIONS["EntityAgent"]
        assert "jpa_entity_analyzer" in entity_tools or "jpa_relation_resolver" in entity_tools

    def test_tool_executor_no_permission(self):
        """测试工具执行器权限检查。"""
        import tempfile
        with tempfile.TemporaryDirectory() as tmpdir:
            executor = ToolExecutor(tmpdir, "TestAgent")

            # TestAgent 没有权限
            result = executor.execute("read_file", {"path": "test.java"})

            assert result.status == ToolResultStatus.NO_PERMISSION


class TestAgentBaseClass:
    """Agent 基类测试。"""

    def test_agent_result_merge(self):
        """测试 AgentResult 合并。"""
        node1 = GraphNode(id="node1", type="Entity", name="User", properties={})
        node2 = GraphNode(id="node2", type="Entity", name="Order", properties={})

        result1 = AgentResult(
            agent_name="TestAgent",
            nodes=[node1],
            confidence=0.9,
        )
        result2 = AgentResult(
            agent_name="TestAgent",
            nodes=[node2],
            confidence=0.8,
        )

        merged = result1.merge(result2)

        assert len(merged.nodes) == 2
        assert merged.confidence == 0.8  # min(0.9, 0.8)

    def test_agent_context(self):
        """测试 AgentContext 创建。"""
        hub = KnowledgeHub()

        context = AgentContext(
            repo_path="/tmp/test",
            knowledge_hub=hub,
            tool_executor=None,
            config={"max_iterations": 5},
        )

        assert context.repo_path == "/tmp/test"
        assert context.iteration == 0
        assert context.config["max_iterations"] == 5  # config 中的值
