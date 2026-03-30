"""主题分析 Agent。

负责发现和分析项目中的消息主题：
- Kafka Topic
- RabbitMQ Queue
- Event Bus
"""

from __future__ import annotations

import logging
import re
from typing import Any, Optional

from backend.agent_v2.base_agent import (
    AgentContext,
    AgentResult,
    DomainAgent,
)
from backend.graph.graph_schema import GraphEdge, GraphNode, NodeType, EdgeType

logger = logging.getLogger(__name__)


class TopicAgent(DomainAgent):
    """主题分析 Agent。

    职责：
    1. 发现项目中的消息 Topic/Queue
    2. 分析生产者和消费者
    3. 构建消息流图
    4. 识别事件驱动模式

    输出：
    - Topic 节点
    - Event 节点
    - EventHandler 节点
    - publishes 边
    - subscribes 边
    """

    # 消息相关文件模式
    MESSAGE_PATTERNS = [
        "**/consumer/**/*.java",
        "**/producer/**/*.java",
        "**/listener/**/*.java",
        "**/event/**/*.java",
        "**/message/**/*.java",
        "**/messaging/**/*.java",
        "**/kafka/**/*.java",
    ]

    # Kafka 注解
    KAFKA_ANNOTATIONS = [
        "@KafkaListener",
        "@KafkaHandler",
        "@SendTo",
    ]

    # RabbitMQ 注解
    RABBIT_ANNOTATIONS = [
        "@RabbitListener",
        "@RabbitHandler",
    ]

    # Spring Event 注解
    SPRING_EVENT_ANNOTATIONS = [
        "@EventListener",
        "@TransactionalEventListener",
        "@ApplicationEvent",
    ]

    def __init__(self, context: AgentContext):
        super().__init__(context)
        self._topic_files: list[str] = []
        self._discovered_topics: dict[str, dict] = {}
        self._discovered_events: dict[str, dict] = {}

    # ═══════════════════════════════════════════════════════════════
    # Phase 1: Discovery
    # ═══════════════════════════════════════════════════════════════

    def discover(self) -> list[dict]:
        """发现消息相关文件。"""
        targets = []

        # 1. 按目录模式搜索
        for pattern in self.MESSAGE_PATTERNS:
            result = self.call_tool("find_files", pattern=pattern.replace("**/", ""))
            if result.get("success"):
                for file_path in result.get("files", []):
                    if self._is_message_file(file_path):
                        targets.append({
                            "target_id": file_path,
                            "target_type": "message_file",
                            "file_path": file_path,
                            "hints": {"source": "directory_pattern"},
                        })

        # 2. 搜索 Kafka 注解
        for annotation in self.KAFKA_ANNOTATIONS + self.RABBIT_ANNOTATIONS + self.SPRING_EVENT_ANNOTATIONS:
            search_result = self.call_tool(
                "search_code",
                pattern=annotation,
                file_pattern="*.java",
                context_lines=3,
                max_results=30,
            )

            if search_result.get("success"):
                seen_files = {t["file_path"] for t in targets}
                for match in search_result.get("results", []):
                    file_path = match["file_path"]
                    if file_path not in seen_files:
                        targets.append({
                            "target_id": file_path,
                            "target_type": "message_file",
                            "file_path": file_path,
                            "hints": {
                                "source": "annotation_search",
                                "annotation": annotation,
                                "line": match["line_number"],
                            },
                        })
                        seen_files.add(file_path)

        self._topic_files = [t["file_path"] for t in targets]
        logger.info("[TopicAgent] 发现 %d 个消息相关文件", len(targets))

        return targets

    def _is_message_file(self, file_path: str) -> bool:
        """判断是否为消息相关文件。"""
        if "test" in file_path.lower():
            return False

        result = self.call_tool("read_file", path=file_path, max_size=32768)
        if not result.get("success"):
            return False

        content = result["content"]

        # 检查是否有消息相关注解或类
        indicators = [
            "@KafkaListener", "@RabbitListener", "@EventListener",
            "KafkaTemplate", "RabbitTemplate", "ApplicationEventPublisher",
            "implements ApplicationListener", "Topic", "Queue",
        ]

        return any(ind in content for ind in indicators)

    # ═══════════════════════════════════════════════════════════════
    # Phase 2: Analysis
    # ═══════════════════════════════════════════════════════════════

    def analyze(self, target: dict) -> AgentResult:
        """分析单个消息相关文件。"""
        file_path = target["file_path"]
        hints = target.get("hints", {})

        result = AgentResult(agent_name=self.name)

        # 读取文件内容
        read_result = self.call_tool("read_file", path=file_path)
        if not read_result.get("success"):
            return result

        content = read_result["content"]

        # 判断消息类型
        has_kafka = any(ann in content for ann in self.KAFKA_ANNOTATIONS)
        has_rabbit = any(ann in content for ann in self.RABBIT_ANNOTATIONS)
        has_spring_event = any(ann in content for ann in self.SPRING_EVENT_ANNOTATIONS)

        if has_kafka:
            kafka_result = self._analyze_kafka(file_path, content)
            result.nodes.extend(kafka_result["nodes"])
            result.edges.extend(kafka_result["edges"])

        if has_rabbit:
            rabbit_result = self._analyze_rabbitmq(file_path, content)
            result.nodes.extend(rabbit_result["nodes"])
            result.edges.extend(rabbit_result["edges"])

        if has_spring_event:
            event_result = self._analyze_spring_event(file_path, content)
            result.nodes.extend(event_result["nodes"])
            result.edges.extend(event_result["edges"])

        # 如果没有特定类型，尝试通用分析
        if not (has_kafka or has_rabbit or has_spring_event):
            generic_result = self._analyze_generic(file_path, content)
            result.nodes.extend(generic_result["nodes"])
            result.edges.extend(generic_result["edges"])

        result.confidence = 0.85 if result.nodes else 0.5
        return result

    def _analyze_kafka(self, file_path: str, content: str) -> dict:
        """分析 Kafka 相关代码。"""
        nodes = []
        edges = []

        # 提取 @KafkaListener
        listener_pattern = r'@KafkaListener\s*\([^)]*topics\s*=\s*"([^"]+)"[^)]*\)'
        for match in re.finditer(listener_pattern, content):
            topic_name = match.group(1)

            # 创建 Topic 节点
            topic_id = f"topic:{topic_name}"
            if not any(n.id == topic_id for n in nodes):
                topic_node = GraphNode(
                    id=topic_id,
                    type=NodeType.TOPIC.value,
                    name=topic_name,
                    properties={
                        "type": "kafka",
                        "file_path": file_path,
                    },
                )
                nodes.append(topic_node)

            # 提取消费者类/方法
            class_match = re.search(r'class\s+(\w+)', content)
            if class_match:
                class_name = class_match.group(1)

                # 创建 EventHandler 节点
                handler_id = f"eventhandler:{class_name}"

                handler_node = GraphNode(
                    id=handler_id,
                    type=NodeType.EVENT_HANDLER.value,
                    name=class_name,
                    properties={
                        "type": "kafka_consumer",
                        "file_path": file_path,
                    },
                )
                nodes.append(handler_node)

                # 创建 subscribes 边
                sub_edge = GraphEdge(
                    from_=handler_id,
                    to=topic_id,
                    type=EdgeType.SUBSCRIBES.value,
                    properties={},
                )
                edges.append(sub_edge)

        # 提取 KafkaTemplate 发送
        send_pattern = r'kafkaTemplate\.send\(\s*"([^"]+)"'
        for match in re.finditer(send_pattern, content):
            topic_name = match.group(1)

            topic_id = f"topic:{topic_name}"

            # 创建 Topic 节点（如果不存在）
            if not any(n.id == topic_id for n in nodes):
                topic_node = GraphNode(
                    id=topic_id,
                    type=NodeType.TOPIC.value,
                    name=topic_name,
                    properties={
                        "type": "kafka",
                        "file_path": file_path,
                    },
                )
                nodes.append(topic_node)

            # 查找生产者类
            class_match = re.search(r'class\s+(\w+)', content)
            if class_match:
                class_name = class_match.group(1)
                producer_id = f"service:{class_name}"

                # 创建 publishes 边
                pub_edge = GraphEdge(
                    from_=producer_id,
                    to=topic_id,
                    type=EdgeType.PUBLISHES.value,
                    properties={},
                )
                edges.append(pub_edge)

        # 存储发现的 Topic
        for node in nodes:
            if node.type == NodeType.TOPIC.value:
                self._discovered_topics[node.name] = {
                    "id": node.id,
                    "type": "kafka",
                    "file_path": file_path,
                }

        return {"nodes": nodes, "edges": edges}

    def _analyze_rabbitmq(self, file_path: str, content: str) -> dict:
        """分析 RabbitMQ 相关代码。"""
        nodes = []
        edges = []

        # 提取 @RabbitListener
        listener_pattern = r'@RabbitListener\s*\([^)]*queues\s*=\s*"([^"]+)"[^)]*\)'
        for match in re.finditer(listener_pattern, content):
            queue_name = match.group(1)

            # 创建 Topic 节点（RabbitMQ 用 Queue）
            topic_id = f"topic:{queue_name}"
            if not any(n.id == topic_id for n in nodes):
                topic_node = GraphNode(
                    id=topic_id,
                    type=NodeType.TOPIC.value,
                    name=queue_name,
                    properties={
                        "type": "rabbitmq_queue",
                        "file_path": file_path,
                    },
                )
                nodes.append(topic_node)

            # 提取消费者类
            class_match = re.search(r'class\s+(\w+)', content)
            if class_match:
                class_name = class_match.group(1)
                handler_id = f"eventhandler:{class_name}"

                handler_node = GraphNode(
                    id=handler_id,
                    type=NodeType.EVENT_HANDLER.value,
                    name=class_name,
                    properties={
                        "type": "rabbitmq_consumer",
                        "file_path": file_path,
                    },
                )
                nodes.append(handler_node)

                sub_edge = GraphEdge(
                    from_=handler_id,
                    to=topic_id,
                    type=EdgeType.SUBSCRIBES.value,
                    properties={},
                )
                edges.append(sub_edge)

        return {"nodes": nodes, "edges": edges}

    def _analyze_spring_event(self, file_path: str, content: str) -> dict:
        """分析 Spring Event 相关代码。"""
        nodes = []
        edges = []

        # 提取 @EventListener
        listeners_result = self.call_tool("spring_kafka_listener", path=file_path)

        if listeners_result.get("success"):
            for listener in listeners_result.get("listeners", []):
                event_type = listener.get("event_type")
                if not event_type:
                    continue

                # 创建 Event 节点
                event_id = f"event:{event_type}"
                if not any(n.id == event_id for n in nodes):
                    event_node = GraphNode(
                        id=event_id,
                        type=NodeType.EVENT.value,
                        name=event_type,
                        properties={
                            "type": "spring_event",
                            "file_path": file_path,
                        },
                    )
                    nodes.append(event_node)

                # 提取监听器类
                class_name = listener.get("class_name")
                if class_name:
                    handler_id = f"eventhandler:{class_name}"

                    if not any(n.id == handler_id for n in nodes):
                        handler_node = GraphNode(
                            id=handler_id,
                            type=NodeType.EVENT_HANDLER.value,
                            name=class_name,
                            properties={
                                "type": "spring_event_listener",
                                "file_path": file_path,
                                "phase": listener.get("phase", "default"),
                            },
                        )
                        nodes.append(handler_node)

                    # 创建 subscribes 边
                    sub_edge = GraphEdge(
                        from_=handler_id,
                        to=event_id,
                        type=EdgeType.SUBSCRIBES.value,
                        properties={
                            "condition": listener.get("condition"),
                        },
                    )
                    edges.append(sub_edge)

        # 查找事件发布
        publish_pattern = r'applicationEventPublisher\.publishEvent\(\s*new\s+(\w+)'
        for match in re.finditer(publish_pattern, content):
            event_type = match.group(1)

            event_id = f"event:{event_type}"
            if not any(n.id == event_id for n in nodes):
                event_node = GraphNode(
                    id=event_id,
                    type=NodeType.EVENT.value,
                    name=event_type,
                    properties={
                        "type": "spring_event",
                        "file_path": file_path,
                    },
                )
                nodes.append(event_node)

            # 查找发布者类
            class_match = re.search(r'class\s+(\w+)', content)
            if class_match:
                class_name = class_match.group(1)
                publisher_id = f"service:{class_name}"

                pub_edge = GraphEdge(
                    from_=publisher_id,
                    to=event_id,
                    type=EdgeType.PUBLISHES.value,
                    properties={},
                )
                edges.append(pub_edge)

        # 存储发现的事件
        for node in nodes:
            if node.type == NodeType.EVENT.value:
                self._discovered_events[node.name] = {
                    "id": node.id,
                    "type": "spring_event",
                    "file_path": file_path,
                }

        return {"nodes": nodes, "edges": edges}

    def _analyze_generic(self, file_path: str, content: str) -> dict:
        """通用消息分析（无特定框架）。"""
        nodes = []
        edges = []

        # 查找 Topic/Queue 字符串常量
        topic_pattern = r'(?:TOPIC|QUEUE|TOPIC_NAME)\s*=\s*"([^"]+)"'
        for match in re.finditer(topic_pattern, content):
            topic_name = match.group(1)

            topic_id = f"topic:{topic_name}"
            topic_node = GraphNode(
                id=topic_id,
                type=NodeType.TOPIC.value,
                name=topic_name,
                properties={
                    "type": "generic",
                    "file_path": file_path,
                },
            )
            nodes.append(topic_node)

        return {"nodes": nodes, "edges": edges}

    # ═══════════════════════════════════════════════════════════════
    # Phase 3: Validate
    # ═══════════════════════════════════════════════════════════════

    def validate(self, result: AgentResult) -> tuple[bool, list[dict]]:
        """验证分析结果。"""
        issues = []
        is_valid = True

        node_ids = {n.id for n in result.nodes}

        for node in result.nodes:
            if node.type == NodeType.TOPIC.value:
                issue = self._validate_required_fields(node, ["name"])
                if issue:
                    issues.append(issue)
                    is_valid = False

                # 检查是否有订阅者或发布者
                has_subscriber = any(
                    e.to == node.id and e.type == EdgeType.SUBSCRIBES.value
                    for e in result.edges
                )
                has_publisher = any(
                    e.to == node.id and e.type == EdgeType.PUBLISHES.value
                    for e in result.edges
                )

                if not has_subscriber and not has_publisher:
                    issues.append({
                        "type": "orphan_topic",
                        "severity": "low",
                        "message": f"Topic {node.name} 没有订阅者或发布者",
                        "suggestion": "检查是否有遗漏的消息处理代码",
                    })

            elif node.type == NodeType.EVENT.value:
                if not node.name:
                    issues.append({
                        "type": "missing_event_name",
                        "severity": "medium",
                        "message": "事件节点缺少名称",
                    })

        # 验证边的引用
        for edge in result.edges:
            if edge.type in [EdgeType.PUBLISHES.value, EdgeType.SUBSCRIBES.value]:
                if edge.to not in node_ids:
                    issues.append({
                        "type": "pending_topic",
                        "severity": "low",
                        "message": f"目标 Topic/Event 待验证: {edge.to}",
                    })

        return is_valid, issues
