"""
事件流分析器模块。

识别代码中的事件发布/订阅、消息队列交互、
WebSocket 事件、信号/槽机制等异步事件模式，
构建事件流图谱。

支持识别：
- Python asyncio 事件
- Django/Flask 信号
- Celery 任务发布
- Redis Pub/Sub
- Kafka/RabbitMQ 消息
- FastAPI WebSocket 事件
- EventEmitter 模式（Node.js 风格）
"""

from __future__ import annotations

import logging
import re
from typing import Optional

from backend.graph.schema import (
    EdgeBase,
    EdgeType,
    EventNode,
    EventType,
    FunctionNode,
    ModuleNode,
)
from backend.parser.code_parser import ParsedFile

logger = logging.getLogger(__name__)

# 事件发布模式：方法名 -> 事件类型
EMIT_PATTERNS = {
    "emit", "send", "publish", "produce", "dispatch",
    "trigger", "fire", "broadcast", "notify",
    "delay", "apply_async",  # Celery
    "send_message", "put",  # 队列操作
}

# 事件监听模式：方法名/装饰器 -> 订阅类型
LISTEN_PATTERNS = {
    "on", "listen", "subscribe", "consume",
    "add_listener", "add_event_listener",
    "connect",  # Django signal
    "register",
}

# 装饰器 -> 事件类型映射
DECORATOR_EVENTS = {
    "app.on_event": EventType.LISTEN,
    "router.on_event": EventType.LISTEN,
    "signal.connect": EventType.LISTEN,
    "celery.task": EventType.SUBSCRIBE,
    "shared_task": EventType.SUBSCRIBE,
    "consumer": EventType.SUBSCRIBE,
    "event_handler": EventType.LISTEN,
    "subscribe": EventType.SUBSCRIBE,
    "listen": EventType.LISTEN,
}

# 消息队列/事件总线技术识别
MESSAGING_IMPORTS = {
    "celery": "celery",
    "kafka": "kafka",
    "pika": "rabbitmq",
    "redis": "redis",
    "aio_pika": "rabbitmq",
    "confluent_kafka": "kafka",
    "aiokafka": "kafka",
    "nats": "nats",
    "websockets": "websocket",
}


class EventAnalyzer:
    """
    事件流分析器。

    识别代码中的事件发布/订阅模式，
    生成 EventNode 和 EMITS/LISTENS 类型的边。

    示例::

        analyzer = EventAnalyzer()
        event_nodes, edges = analyzer.analyze(parsed_files, function_nodes)
    """

    def analyze(
        self,
        parsed_files: dict[str, ParsedFile],
        function_nodes: dict[str, FunctionNode],
        module_nodes: Optional[dict[str, ModuleNode]] = None,
    ) -> tuple[list[EventNode], list[EdgeBase]]:
        """
        执行事件流分析。

        Args:
            parsed_files: 文件路径 -> 解析结果的映射
            function_nodes: 函数名 -> 函数节点的映射
            module_nodes: 文件路径 -> 模块节点的映射

        Returns:
            (事件节点列表, 关系边列表) 元组
        """
        event_nodes: list[EventNode] = []
        edges: list[EdgeBase] = []
        event_index: dict[str, EventNode] = {}

        for file_path, parsed in parsed_files.items():
            # 检测使用的消息技术
            messaging_tech = self._detect_messaging_tech(parsed)

            # 分析模块级函数
            for func in parsed.functions:
                func_node = function_nodes.get(func.name)
                if not func_node:
                    continue

                # 检查装饰器
                decorator_events = self._check_decorators(func.decorators)
                for ev_name, ev_type in decorator_events:
                    event = self._get_or_create_event(
                        ev_name, ev_type, file_path, event_index, event_nodes,
                        tech=messaging_tech
                    )
                    edge_type = EdgeType.LISTENS if ev_type in (EventType.LISTEN, EventType.SUBSCRIBE) else EdgeType.EMITS
                    edges.append(EdgeBase(
                        type=edge_type,
                        source_id=func_node.id,
                        target_id=event.id,
                        metadata={"decorator": True},
                    ))

                # 检查函数调用中的事件操作
                for call in func.calls:
                    method = call.callee.split(".")[-1].lower()
                    if method in EMIT_PATTERNS:
                        channel = self._infer_channel(call.callee, messaging_tech)
                        event = self._get_or_create_event(
                            channel, EventType.EMIT, file_path, event_index, event_nodes,
                            tech=messaging_tech
                        )
                        edges.append(EdgeBase(
                            type=EdgeType.EMITS,
                            source_id=func_node.id,
                            target_id=event.id,
                            metadata={"call_line": call.line, "callee": call.callee},
                        ))
                    elif method in LISTEN_PATTERNS:
                        channel = self._infer_channel(call.callee, messaging_tech)
                        event = self._get_or_create_event(
                            channel, EventType.LISTEN, file_path, event_index, event_nodes,
                            tech=messaging_tech
                        )
                        edges.append(EdgeBase(
                            type=EdgeType.LISTENS,
                            source_id=func_node.id,
                            target_id=event.id,
                            metadata={"call_line": call.line},
                        ))

            # 分析类方法
            for cls in parsed.classes:
                for method in cls.methods:
                    func_node = function_nodes.get(f"{cls.name}.{method.name}") or \
                                function_nodes.get(method.name)
                    if not func_node:
                        continue

                    for call in method.calls:
                        m = call.callee.split(".")[-1].lower()
                        if m in EMIT_PATTERNS:
                            channel = self._infer_channel(call.callee, messaging_tech)
                            event = self._get_or_create_event(
                                channel, EventType.EMIT, file_path, event_index, event_nodes,
                                tech=messaging_tech
                            )
                            edges.append(EdgeBase(
                                type=EdgeType.EMITS,
                                source_id=func_node.id,
                                target_id=event.id,
                                metadata={"call_line": call.line},
                            ))

        logger.info(
            f"事件流分析完成: {len(event_nodes)} 个事件节点, {len(edges)} 条事件边"
        )
        return event_nodes, edges

    def _detect_messaging_tech(self, parsed: ParsedFile) -> str:
        """从导入语句检测使用的消息技术。"""
        for imp in parsed.imports:
            for prefix, tech in MESSAGING_IMPORTS.items():
                if imp.module.startswith(prefix):
                    return tech
        return "generic"

    def _check_decorators(
        self, decorators: list[str]
    ) -> list[tuple[str, EventType]]:
        """
        检查函数装饰器，识别事件监听/订阅模式。

        Returns:
            (事件名称, 事件类型) 列表
        """
        results: list[tuple[str, EventType]] = []
        for dec in decorators:
            for pattern, ev_type in DECORATOR_EVENTS.items():
                if dec.startswith(pattern) or pattern in dec:
                    # 尝试提取事件名称（如 @app.on_event("startup")）
                    m = re.search(r'["\']([^"\']+)["\']', dec)
                    ev_name = m.group(1) if m else dec
                    results.append((ev_name, ev_type))
                    break
        return results

    def _infer_channel(self, callee: str, tech: str) -> str:
        """从调用表达式推断事件频道名称。"""
        # 简化：使用调用链的倒数第二部分作为频道
        parts = callee.split(".")
        if len(parts) >= 2:
            return f"{tech}:{parts[-2]}"
        return f"{tech}:unknown"

    def _get_or_create_event(
        self,
        name: str,
        event_type: EventType,
        file_path: str,
        index: dict[str, EventNode],
        nodes: list[EventNode],
        tech: str = "generic",
    ) -> EventNode:
        """获取已存在的事件节点，或创建新节点。"""
        key = f"{event_type}:{name}"
        if key in index:
            return index[key]
        node = EventNode(
            name=name,
            file_path=file_path,
            event_type=event_type,
            channel=name,
            metadata={"technology": tech},
        )
        index[key] = node
        nodes.append(node)
        return node
