"""Phase 2 Agent 测试。"""

import tempfile
from pathlib import Path

import pytest

from backend.agent_v2 import (
    AgentContext,
    AgentPhase,
    AgentResult,
    DomainAgent,
    EntityAgent,
    ServiceAgent,
    FlowAgent,
    LineageAgent,
    TopicAgent,
)
from backend.graph.graph_schema import GraphEdge, GraphNode, NodeType, EdgeType
from backend.knowledge import KnowledgeHub
from backend.tools import ToolExecutor


class TestAgentBase:
    """Agent 基类测试。"""

    def test_agent_result_merge(self):
        """测试结果合并。"""
        node1 = GraphNode(id="n1", type=NodeType.ENTITY.value, name="User", properties={})
        node2 = GraphNode(id="n2", type=NodeType.ENTITY.value, name="Order", properties={})
        edge1 = GraphEdge(from_="n1", to="n2", type=EdgeType.ONE_TO_MANY.value, properties={})

        result1 = AgentResult(agent_name="Test1", nodes=[node1], confidence=0.9)
        result2 = AgentResult(agent_name="Test2", nodes=[node2], edges=[edge1], confidence=0.8)

        merged = result1.merge(result2)

        assert len(merged.nodes) == 2
        assert len(merged.edges) == 1
        assert merged.confidence == 0.8

    def test_agent_context_creation(self):
        """测试上下文创建。"""
        hub = KnowledgeHub()

        context = AgentContext(
            repo_path="/test/path",
            knowledge_hub=hub,
            tool_executor=None,
            config={"key": "value"},
        )

        assert context.repo_path == "/test/path"
        assert context.knowledge_hub is hub
        assert context.config["key"] == "value"
        assert context.iteration == 0


class TestEntityAgent:
    """EntityAgent 测试。"""

    @pytest.fixture
    def agent_context(self):
        """创建测试上下文。"""
        with tempfile.TemporaryDirectory() as tmpdir:
            # 创建测试文件
            entity_file = Path(tmpdir) / "User.java"
            entity_file.write_text("""
package com.example.entity;

import jakarta.persistence.*;

@Entity
@Table(name = "users")
public class User {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "username", nullable = false, unique = true)
    private String username;

    @Column(name = "email")
    private String email;

    @OneToMany(mappedBy = "user")
    private List<Order> orders;

    // getters and setters
}
""")

            hub = KnowledgeHub()
            executor = ToolExecutor(tmpdir, "EntityAgent")

            yield AgentContext(
                repo_path=tmpdir,
                knowledge_hub=hub,
                tool_executor=executor,
            )

    def test_discover_entities(self, agent_context):
        """测试实体发现。"""
        agent = EntityAgent(agent_context)

        targets = agent.discover()

        assert len(targets) > 0
        assert any("User.java" in t["file_path"] for t in targets)

    def test_create_entity_node(self, agent_context):
        """测试实体节点创建。"""
        agent = EntityAgent(agent_context)

        entity_data = {
            "name": "User",
            "table_name": "users",
            "fields": [
                {"name": "id", "type": "Long", "is_id": True},
                {"name": "username", "type": "String"},
            ],
            "relations": [],
        }

        node = agent._create_entity_node(entity_data, "User.java")

        assert node.id == "entity:User"
        assert node.type == NodeType.ENTITY.value
        assert node.name == "User"
        assert node.properties["table_name"] == "users"


class TestServiceAgent:
    """ServiceAgent 测试。"""

    @pytest.fixture
    def agent_context(self):
        """创建测试上下文。"""
        with tempfile.TemporaryDirectory() as tmpdir:
            service_file = Path(tmpdir) / "UserService.java"
            service_file.write_text("""
package com.example.service;

import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Autowired;

@Service
public class UserService {
    @Autowired
    private UserRepository userRepository;

    public User findById(Long id) {
        return userRepository.findById(id).orElse(null);
    }
}
""")

            hub = KnowledgeHub()
            executor = ToolExecutor(tmpdir, "ServiceAgent")

            yield AgentContext(
                repo_path=tmpdir,
                knowledge_hub=hub,
                tool_executor=executor,
            )

    def test_discover_services(self, agent_context):
        """测试服务发现。"""
        agent = ServiceAgent(agent_context)

        targets = agent.discover()

        assert len(targets) > 0


class TestFlowAgent:
    """FlowAgent 测试。"""

    def test_is_flow_method(self):
        """测试流程方法判断。"""
        with tempfile.TemporaryDirectory() as tmpdir:
            hub = KnowledgeHub()
            executor = ToolExecutor(tmpdir, "FlowAgent")
            context = AgentContext(repo_path=tmpdir, knowledge_hub=hub, tool_executor=executor)

            agent = FlowAgent(context)

            assert agent._is_flow_method("createUser")
            assert agent._is_flow_method("processOrder")
            assert agent._is_flow_method("submitForm")
            assert not agent._is_flow_method("getName")
            assert not agent._is_flow_method("toString")

    def test_generate_flow_name(self):
        """测试流程名称生成。"""
        with tempfile.TemporaryDirectory() as tmpdir:
            hub = KnowledgeHub()
            executor = ToolExecutor(tmpdir, "FlowAgent")
            context = AgentContext(repo_path=tmpdir, knowledge_hub=hub, tool_executor=executor)

            agent = FlowAgent(context)

            name1 = agent._generate_flow_name("createUser", {})
            assert "Create" in name1
            assert "User" in name1

            name2 = agent._generate_flow_name("processOrder", {"path": "/api/orders"})
            assert "/api/orders" in name2


class TestLineageAgent:
    """LineageAgent 测试。"""

    def test_infer_entity_type(self):
        """测试实体类型推断。"""
        with tempfile.TemporaryDirectory() as tmpdir:
            hub = KnowledgeHub()
            executor = ToolExecutor(tmpdir, "LineageAgent")
            context = AgentContext(repo_path=tmpdir, knowledge_hub=hub, tool_executor=executor)

            agent = LineageAgent(context)

            assert agent._infer_entity_type("UserRepository", "") == "User"
            assert agent._infer_entity_type("OrderMapper", "") == "Order"
            assert agent._infer_entity_type("ProductDao", "") == "Product"


class TestTopicAgent:
    """TopicAgent 测试。"""

    def test_analyze_kafka_pattern(self):
        """测试 Kafka 模式分析。"""
        with tempfile.TemporaryDirectory() as tmpdir:
            hub = KnowledgeHub()
            executor = ToolExecutor(tmpdir, "TopicAgent")
            context = AgentContext(repo_path=tmpdir, knowledge_hub=hub, tool_executor=executor)

            agent = TopicAgent(context)

            content = '''
@KafkaListener(topics = "user-events")
public void handleUserEvent(UserEvent event) {
    // process event
}
'''

            result = agent._analyze_kafka("test.java", content)

            assert len(result["nodes"]) > 0
            # 应该找到 Topic 节点
            topic_nodes = [n for n in result["nodes"] if n.type == NodeType.TOPIC.value]
            assert len(topic_nodes) > 0
            assert topic_nodes[0].name == "user-events"
