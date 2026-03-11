"""
事件分析器模块。

支持 Kafka、RabbitMQ、EventBus 三种消息系统的事件流识别。

识别策略：
    1. 从 import 语句检测消息中间件类型
    2. 从源码文本正则提取 topic / queue / event 名称
    3. 从类名 / 方法调用 / 装饰器识别 Producer / Consumer 角色
    4. 将 Producer / Consumer 关联到已有 Component 节点

输出（EventGraph）：
    events:  Event GraphNode 列表
    topics:  Topic GraphNode 列表
    edges:   publishes / routes_to / consumes 边列表

Graph 关系：
    Component  --publishes-->  Event
    Event      --routes_to-->  Topic
    Component  --consumes-->   Topic
"""

from __future__ import annotations

import logging
import re
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from backend.analyzer.component_detector import ComponentGraph
from backend.graph.graph_schema import EdgeType, GraphEdge, GraphNode, NodeType
from backend.parser.code_parser import ParsedFile, ParseResult

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Broker detection vocabulary
# ---------------------------------------------------------------------------

# import 模块前缀 → broker 类型
_KAFKA_IMPORTS: frozenset[str] = frozenset({
    "kafka", "confluent_kafka", "aiokafka", "faust", "faust_streaming",
})
_RABBITMQ_IMPORTS: frozenset[str] = frozenset({
    "pika", "aio_pika", "kombu", "amqp", "celery",
})
_EVENTBUS_IMPORTS: frozenset[str] = frozenset({
    "blinker", "pyee", "eventemitter",
    "django.dispatch", "django.db.models.signals",
    "django.core.signals",
})

# 类名片段 → Producer 角色（模糊匹配，全小写）
_PRODUCER_NAME_HINTS: frozenset[str] = frozenset({
    "producer", "publisher", "sender", "emitter",
    "broadcaster", "dispatcher", "notifier",
})
# 类名片段 → Consumer 角色（模糊匹配，全小写）
_CONSUMER_NAME_HINTS: frozenset[str] = frozenset({
    "consumer", "subscriber", "listener", "handler",
    "receiver", "worker", "processor",
})

# 方法名 → 判定为 Publish 行为
_PUBLISH_METHODS: frozenset[str] = frozenset({
    # Kafka
    "send", "produce", "send_and_wait",
    # RabbitMQ
    "basic_publish", "publish",
    # EventBus / generic
    "emit", "dispatch", "trigger", "fire", "broadcast",
    "put", "put_nowait", "send_message",
})
# 方法名 → 判定为 Consume 行为
_CONSUME_METHODS: frozenset[str] = frozenset({
    # Kafka
    "subscribe",
    # RabbitMQ
    "basic_consume", "basic_get",
    # EventBus / generic
    "on", "listen", "add_listener", "add_event_listener",
    "connect", "register", "register_handler",
})

# 装饰器片段 → 判定为 Consumer 角色（全小写匹配）
_CONSUMER_DECORATOR_HINTS: frozenset[str] = frozenset({
    "subscribe", "consumer", "listen",
    "on_event", "agent",       # FastAPI / Faust
    "shared_task", "task",     # Celery
    "signal.connect",
})


# ---------------------------------------------------------------------------
# Per-broker regex patterns for topic / queue / event name extraction
# ---------------------------------------------------------------------------

# 所有 pattern 均带 1 个捕获组：目标名称字符串
# 使用时以 re.IGNORECASE | re.DOTALL 运行

_KAFKA_PUBLISH_PATTERNS: list[str] = [
    r'\.send\s*\(\s*["\']([^"\']{1,120})["\']',           # producer.send('topic', ...)
    r'\.produce\s*\(\s*["\']([^"\']{1,120})["\']',        # producer.produce('topic', ...)
    r'\.send_and_wait\s*\(\s*["\']([^"\']{1,120})["\']',  # aiokafka
]
_KAFKA_CONSUME_PATTERNS: list[str] = [
    r'KafkaConsumer\s*\(\s*["\']([^"\']{1,120})["\']',     # KafkaConsumer('topic')
    r'AIOKafkaConsumer\s*\(\s*["\']([^"\']{1,120})["\']',  # aiokafka
    r'\.subscribe\s*\(\s*\[\s*["\']([^"\']{1,120})["\']',  # consumer.subscribe(['topic'])
    r'app\.topic\s*\(\s*["\']([^"\']{1,120})["\']',        # Faust: app.topic('name')
    r'@app\.agent\s*\(\s*["\']([^"\']{1,120})["\']',       # Faust: @app.agent('topic')
    r'faust\.topic\s*\(\s*["\']([^"\']{1,120})["\']',
]

_RABBITMQ_PUBLISH_PATTERNS: list[str] = [
    # channel.basic_publish(exchange='', routing_key='hello', ...)
    r'basic_publish\s*\([^)]{0,300}routing_key\s*=\s*["\']([^"\']{1,120})["\']',
    # exchange.publish(..., routing_key='key') / producer.publish(..., routing_key='key')
    r'\.publish\s*\([^)]{0,300}routing_key\s*=\s*["\']([^"\']{1,120})["\']',
    # direct string first arg: producer.publish(msg, 'routing-key')
    r'\.publish\s*\([^,)]+,\s*["\']([^"\']{1,120})["\']',
]
_RABBITMQ_CONSUME_PATTERNS: list[str] = [
    # channel.basic_consume(queue='hello', ...)
    r'basic_consume\s*\([^)]{0,300}queue\s*=\s*["\']([^"\']{1,120})["\']',
    # channel.queue_declare(queue='hello')
    r'queue_declare\s*\([^)]{0,300}queue\s*=\s*["\']([^"\']{1,120})["\']',
    # Queue('name', ...)  ← kombu
    r'\bQueue\s*\(\s*["\']([^"\']{1,120})["\']',
    # exchange_declare(exchange='name', ...)
    r'exchange_declare\s*\([^)]{0,300}exchange\s*=\s*["\']([^"\']{1,120})["\']',
]

_EVENTBUS_PUBLISH_PATTERNS: list[str] = [
    r'\.emit\s*\(\s*["\']([^"\']{1,120})["\']',       # bus.emit('event', ...)
    r'\.publish\s*\(\s*["\']([^"\']{1,120})["\']',    # bus.publish('event', ...)
    r'\.dispatch\s*\(\s*["\']([^"\']{1,120})["\']',   # bus.dispatch('event', ...)
    r'\.trigger\s*\(\s*["\']([^"\']{1,120})["\']',    # bus.trigger('event', ...)
    r'\.fire\s*\(\s*["\']([^"\']{1,120})["\']',       # bus.fire('event', ...)
    r'\.send\s*\(\s*["\']([^"\']{1,120})["\']',       # signal.send('event', ...)
    r'signal\s*\(\s*["\']([^"\']{1,120})["\']',       # blinker: signal('name')
]
_EVENTBUS_CONSUME_PATTERNS: list[str] = [
    r'\.subscribe\s*\(\s*["\']([^"\']{1,120})["\']',          # bus.subscribe('event', ...)
    r'\.on\s*\(\s*["\']([^"\']{1,120})["\']',                 # bus.on('event', handler)
    r'\.listen\s*\(\s*["\']([^"\']{1,120})["\']',             # bus.listen('event', ...)
    r'\.add_listener\s*\(\s*["\']([^"\']{1,120})["\']',
    r'\.connect\s*\(\s*["\']([^"\']{1,120})["\']',            # Django signal.connect
    r'on_event\s*\(\s*["\']([^"\']{1,120})["\']',             # @app.on_event('startup')
    r'@\w[\w.]*\.on\s*\(\s*["\']([^"\']{1,120})["\']',       # decorator form
]

_BROKER_PUBLISH: dict[str, list[str]] = {
    "kafka":    _KAFKA_PUBLISH_PATTERNS,
    "rabbitmq": _RABBITMQ_PUBLISH_PATTERNS,
    "eventbus": _EVENTBUS_PUBLISH_PATTERNS,
}
_BROKER_CONSUME: dict[str, list[str]] = {
    "kafka":    _KAFKA_CONSUME_PATTERNS,
    "rabbitmq": _RABBITMQ_CONSUME_PATTERNS,
    "eventbus": _EVENTBUS_CONSUME_PATTERNS,
}


# ---------------------------------------------------------------------------
# Output container
# ---------------------------------------------------------------------------


@dataclass
class EventGraph:
    """EventAnalyzer.analyze() 的完整输出。

    Attributes:
        events:  Event 节点列表
        topics:  Topic 节点列表
        edges:   publishes / routes_to / consumes 边列表
    """

    events: list[GraphNode] = field(default_factory=list)
    topics: list[GraphNode] = field(default_factory=list)
    edges:  list[GraphEdge] = field(default_factory=list)

    # 内部索引（不参与序列化）
    _event_index: dict[str, GraphNode] = field(default_factory=dict, repr=False)
    _topic_index: dict[str, GraphNode] = field(default_factory=dict, repr=False)

    @property
    def stats(self) -> dict[str, int]:
        return {
            "events": len(self.events),
            "topics": len(self.topics),
            "edges":  len(self.edges),
        }


# ---------------------------------------------------------------------------
# EventAnalyzer
# ---------------------------------------------------------------------------


class EventAnalyzer:
    """
    事件流分析器。

    基于 ParseResult（解析数据）和 ComponentGraph（已识别组件），
    识别三类消息中间件的 Producer / Consumer 角色，输出 EventGraph。

    示例::

        analyzer = EventAnalyzer()
        event_graph = analyzer.analyze(parsed_result, component_graph)
        print(event_graph.stats)
    """

    # ------------------------------------------------------------------
    # Public
    # ------------------------------------------------------------------

    def analyze(
        self,
        parsed_result: ParseResult,
        component_graph: ComponentGraph,
    ) -> EventGraph:
        """执行事件流分析。

        Args:
            parsed_result:   CodeParser 输出，含 ParsedFile。
            component_graph: ComponentDetector 输出，含 Component 节点。

        Returns:
            EventGraph，含 events / topics / edges。
        """
        eg = EventGraph()

        # 文件路径 → 组件节点列表（一个文件可能有多个组件类）
        comp_by_file = self._build_comp_by_file(component_graph)

        # 去重 seen 集合
        seen_pub:    set[tuple[str, str]] = set()
        seen_routes: set[tuple[str, str]] = set()
        seen_con:    set[tuple[str, str]] = set()

        for pf in parsed_result.files:
            broker = self._detect_broker(pf)
            if broker == "generic":
                continue  # 无已知消息中间件，跳过

            try:
                source_text = Path(pf.file_path).read_text(encoding="utf-8", errors="replace")
            except OSError:
                logger.debug("无法读取文件: %s", pf.file_path)
                continue

            publish_names = self._extract_names(
                source_text, _BROKER_PUBLISH.get(broker, [])
            )
            consume_names = self._extract_names(
                source_text, _BROKER_CONSUME.get(broker, [])
            )

            if not publish_names and not consume_names:
                continue

            producers = self._find_producers(pf, comp_by_file)
            consumers = self._find_consumers(pf, comp_by_file)

            # ── Publish 路径：Producer --publishes--> Event --routes_to--> Topic ──
            for name in publish_names:
                event_node = self._ensure_event(name, broker, pf.file_path, eg)
                topic_node = self._ensure_topic(name, broker, pf.file_path, eg)

                _add_edge(event_node.id, topic_node.id,
                          EdgeType.ROUTES_TO.value, eg, seen_routes,
                          broker=broker, event_name=name)

                for comp in producers:
                    _add_edge(comp.id, event_node.id,
                              EdgeType.PUBLISHES.value, eg, seen_pub,
                              broker=broker, topic=name,
                              source_file=pf.file_path)

            # ── Consume 路径：Consumer --consumes--> Topic ──
            for name in consume_names:
                topic_node = self._ensure_topic(name, broker, pf.file_path, eg)

                for comp in consumers:
                    _add_edge(comp.id, topic_node.id,
                              EdgeType.CONSUMES.value, eg, seen_con,
                              broker=broker, topic=name,
                              source_file=pf.file_path)

        logger.info(
            "事件分析完成: events=%d topics=%d edges=%d",
            len(eg.events), len(eg.topics), len(eg.edges),
        )
        return eg

    # ------------------------------------------------------------------
    # Broker detection
    # ------------------------------------------------------------------

    def _detect_broker(self, pf: ParsedFile) -> str:
        """从 import 语句判断使用的消息中间件。

        Returns:
            "kafka" | "rabbitmq" | "eventbus" | "generic"
        """
        for imp in pf.imports:
            mod = imp.module.lower()
            for prefix in _KAFKA_IMPORTS:
                if mod == prefix or mod.startswith(prefix + "."):
                    return "kafka"
            for prefix in _RABBITMQ_IMPORTS:
                if mod == prefix or mod.startswith(prefix + "."):
                    return "rabbitmq"
            for prefix in _EVENTBUS_IMPORTS:
                if mod == prefix or mod.startswith(prefix + "."):
                    return "eventbus"

        # 没有明确 import，但如果类名或变量名含 EventBus/EventEmitter 关键词
        for cls in pf.classes:
            lower = cls.name.lower()
            if "eventbus" in lower or "eventemitter" in lower or "event_bus" in lower:
                return "eventbus"

        return "generic"

    # ------------------------------------------------------------------
    # Topic / event name extraction
    # ------------------------------------------------------------------

    def _extract_names(self, source_text: str, patterns: list[str]) -> list[str]:
        """对 source_text 应用 regex patterns，收集所有捕获的名称（去重）。"""
        names: list[str] = []
        seen: set[str] = set()
        flags = re.IGNORECASE | re.DOTALL
        for pattern in patterns:
            for m in re.finditer(pattern, source_text, flags):
                name = m.group(1).strip()
                if name and name not in seen:
                    seen.add(name)
                    names.append(name)
        return names

    # ------------------------------------------------------------------
    # Producer / Consumer role detection
    # ------------------------------------------------------------------

    def _find_producers(
        self, pf: ParsedFile, comp_by_file: dict[str, list[GraphNode]]
    ) -> list[GraphNode]:
        """识别该文件中扮演 Producer 角色的组件节点。"""
        file_comps: list[GraphNode] = comp_by_file.get(pf.file_path, [])
        if not file_comps:
            return []

        comp_by_cls: dict[str, GraphNode] = {c.name: c for c in file_comps}
        result: list[GraphNode] = []
        added: set[str] = set()

        for cls in pf.classes:
            comp = comp_by_cls.get(cls.name)
            if comp is None:
                continue

            # 1. 类名命中
            if _name_contains_any(cls.name, _PRODUCER_NAME_HINTS):
                if comp.id not in added:
                    added.add(comp.id)
                    result.append(comp)
                continue

            # 2. 方法调用命中
            if self._class_has_call(cls, _PUBLISH_METHODS):
                if comp.id not in added:
                    added.add(comp.id)
                    result.append(comp)

        # 如果文件中只有一个组件且找不到明确标记，退回到该组件
        if not result and len(file_comps) == 1:
            # 文件整体有 publish 调用？
            all_calls = {
                call.callee.split(".")[-1].lower()
                for fn in pf.functions
                for call in fn.calls
            }
            if all_calls & _PUBLISH_METHODS:
                result.append(file_comps[0])

        return result

    def _find_consumers(
        self, pf: ParsedFile, comp_by_file: dict[str, list[GraphNode]]
    ) -> list[GraphNode]:
        """识别该文件中扮演 Consumer 角色的组件节点。"""
        file_comps: list[GraphNode] = comp_by_file.get(pf.file_path, [])
        if not file_comps:
            return []

        comp_by_cls: dict[str, GraphNode] = {c.name: c for c in file_comps}
        result: list[GraphNode] = []
        added: set[str] = set()

        for cls in pf.classes:
            comp = comp_by_cls.get(cls.name)
            if comp is None:
                continue

            # 1. 类名命中
            if _name_contains_any(cls.name, _CONSUMER_NAME_HINTS):
                if comp.id not in added:
                    added.add(comp.id)
                    result.append(comp)
                continue

            # 2. 装饰器命中
            if self._class_has_consumer_decorator(cls):
                if comp.id not in added:
                    added.add(comp.id)
                    result.append(comp)
                continue

            # 3. 方法调用命中
            if self._class_has_call(cls, _CONSUME_METHODS):
                if comp.id not in added:
                    added.add(comp.id)
                    result.append(comp)

        if not result and len(file_comps) == 1:
            all_calls = {
                call.callee.split(".")[-1].lower()
                for fn in pf.functions
                for call in fn.calls
            }
            if all_calls & _CONSUME_METHODS:
                result.append(file_comps[0])

        return result

    # ------------------------------------------------------------------
    # Role detection helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _class_has_call(cls, method_set: frozenset[str]) -> bool:
        """判断类中是否存在目标方法调用。"""
        for method in cls.methods:
            for call in method.calls:
                if call.callee.split(".")[-1].lower() in method_set:
                    return True
        return False

    @staticmethod
    def _class_has_consumer_decorator(cls) -> bool:
        """判断类方法是否带有消费者装饰器。"""
        for method in cls.methods:
            for dec in method.decorators:
                dec_lower = dec.lower()
                for hint in _CONSUMER_DECORATOR_HINTS:
                    if hint in dec_lower:
                        return True
        return False

    # ------------------------------------------------------------------
    # Node creation helpers
    # ------------------------------------------------------------------

    def _ensure_event(
        self, name: str, broker: str, source_file: str, eg: EventGraph
    ) -> GraphNode:
        """获取或创建 Event 节点（按名称全局唯一）。"""
        key = f"event:{name}"
        if key in eg._event_index:
            return eg._event_index[key]
        node = GraphNode(
            type=NodeType.EVENT.value,
            name=name,
            properties={
                "broker": broker,
                "source_file": source_file,
            },
        )
        eg._event_index[key] = node
        eg.events.append(node)
        return node

    def _ensure_topic(
        self, name: str, broker: str, source_file: str, eg: EventGraph
    ) -> GraphNode:
        """获取或创建 Topic 节点（按 broker+name 唯一）。"""
        key = f"topic:{broker}:{name}"
        if key in eg._topic_index:
            return eg._topic_index[key]
        node = GraphNode(
            type=NodeType.TOPIC.value,
            name=name,
            properties={
                "broker": broker,
                "source_file": source_file,
            },
        )
        eg._topic_index[key] = node
        eg.topics.append(node)
        return node

    # ------------------------------------------------------------------
    # Index builder
    # ------------------------------------------------------------------

    @staticmethod
    def _build_comp_by_file(
        component_graph: ComponentGraph,
    ) -> dict[str, list[GraphNode]]:
        """构建 file_path → [Component GraphNode] 索引。"""
        result: dict[str, list[GraphNode]] = defaultdict(list)
        for comp in component_graph.components:
            fp = comp.properties.get("file_path", "")
            if fp:
                result[fp].append(comp)
        return dict(result)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _name_contains_any(class_name: str, hints: frozenset[str]) -> bool:
    """检查类名（大小写不敏感）是否包含任一提示词。"""
    lower = class_name.lower()
    return any(hint in lower for hint in hints)


def _add_edge(
    from_id: str,
    to_id: str,
    edge_type: str,
    eg: EventGraph,
    seen: set[tuple[str, str]],
    **properties,
) -> None:
    """去重后添加一条边到 EventGraph。"""
    key = (from_id, to_id)
    if key in seen:
        return
    seen.add(key)
    eg.edges.append(GraphEdge(**{
        "from": from_id,
        "to":   to_id,
        "type": edge_type,
        "properties": properties,
    }))
