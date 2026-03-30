"""知识中枢：管理 Agent 间的数据共享与事件通知。"""

from __future__ import annotations

import logging
import threading
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

from backend.knowledge.events import KnowledgeEvent, KnowledgeEventType

logger = logging.getLogger(__name__)


@dataclass
class ChangeRecord:
    """变更记录。"""

    version: int
    event_type: KnowledgeEventType
    agent_name: str
    entity_name: Optional[str] = None
    timestamp: float = 0.0

    def __post_init__(self):
        if self.timestamp == 0.0:
            self.timestamp = time.time()


class KnowledgeHub:
    """知识中枢：管理 Agent 间的数据共享与事件通知。

    特点：
    - 线程安全的数据存储
    - 发布-订阅事件机制
    - 置信度传播计算
    - 增量变更追踪

    使用示例：
        hub = KnowledgeHub()

        # 订阅事件
        hub.subscribe(
            KnowledgeEventType.ENTITY_ANALYZED,
            lambda event: print(f"Entity analyzed: {event.data}")
        )

        # 发布数据
        hub.publish(
            agent="EntityAgent",
            event_type=KnowledgeEventType.ENTITY_ANALYZED,
            data={"entity_name": "User", "fields": [...]}
        )

        # 查询数据
        entity = hub.get_entity("User")
    """

    def __init__(self):
        """初始化知识中枢。"""
        # 数据存储（线程安全）
        self._lock = threading.RLock()

        # 各类数据存储
        self._entity_data: dict[str, Any] = {}
        self._service_data: dict[str, Any] = {}
        self._flow_data: dict[str, Any] = {}
        self._lineage_data: list[Any] = []
        self._topic_data: dict[str, Any] = {}

        # 置信度数据
        self._confidence_map: dict[str, float] = {}
        self._dependency_map: dict[str, list[str]] = {}

        # 订阅关系
        self._subscriptions: dict[KnowledgeEventType, list[Callable]] = defaultdict(list)

        # 变更记录
        self._change_log: list[ChangeRecord] = []
        self._version = 0

        # 事件历史（用于调试）
        self._event_history: list[KnowledgeEvent] = []
        self._max_event_history = 100

    # ═══════════════════════════════════════════════════════════════
    # 数据发布与查询
    # ═══════════════════════════════════════════════════════════════

    def publish(
        self,
        key_or_agent: str,
        data_or_event_type: Any = None,
        data: Any = None,
        metadata: dict = None,
        confidence: float = 1.0,
    ) -> KnowledgeEvent:
        """发布数据并触发订阅回调。

        支持两种调用方式：
        1. 简单模式: hub.publish("key", data, confidence=0.9)
        2. 完整模式: hub.publish("EntityAgent", KnowledgeEventType.ENTITY_ANALYZED, data)

        Args:
            key_or_agent: 简单模式下为 key，完整模式下为 Agent 名称
            data_or_event_type: 简单模式下为数据，完整模式下为事件类型
            data: 完整模式下的事件数据
            metadata: 额外元数据
            confidence: 置信度（简单模式）

        Returns:
            KnowledgeEvent: 创建的事件对象
        """
        # 判断调用模式
        from backend.knowledge.events import KnowledgeEventType

        if isinstance(data_or_event_type, KnowledgeEventType):
            # 完整模式
            agent = key_or_agent
            event_type = data_or_event_type
            event_data = data
        else:
            # 简单模式：key-value 存储
            key = key_or_agent
            event_data = data_or_event_type if data_or_event_type is not None else data

            with self._lock:
                self._entity_data[key] = event_data
                if confidence < 1.0:
                    self._confidence_map[key] = confidence

            # 创建简单事件
            event_type = KnowledgeEventType.ENTITY_ANALYZED
            agent = "SimplePublisher"

        with self._lock:
            self._version += 1

            # 创建事件
            event = KnowledgeEvent(
                event_type=event_type,
                agent_name=agent,
                data=event_data,
                version=self._version,
                metadata=metadata or {},
            )

            # 根据事件类型存储数据
            self._store_data(event_type, event_data)

            # 记录变更
            self._change_log.append(ChangeRecord(
                version=self._version,
                event_type=event_type,
                agent_name=agent,
                entity_name=self._extract_entity_name(event_data),
            ))

            # 记录事件历史
            self._event_history.append(event)
            if len(self._event_history) > self._max_event_history:
                self._event_history = self._event_history[-self._max_event_history:]

            logger.debug(
                "[KnowledgeHub] 发布事件: %s from %s, version=%d",
                event_type.value, agent, self._version
            )

        # 触发订阅回调（在锁外执行，避免死锁）
        self._notify_subscribers(event)

        return event

    def _store_data(self, event_type: KnowledgeEventType, data: Any) -> None:
        """根据事件类型存储数据。"""
        if event_type == KnowledgeEventType.ENTITY_ANALYZED:
            if isinstance(data, dict):
                entity_name = data.get("entity_name") or data.get("name")
                if entity_name:
                    self._entity_data[entity_name] = data
                    # 存储置信度
                    if "confidence" in data:
                        self._confidence_map[f"entity:{entity_name}"] = data["confidence"]
            elif isinstance(data, list):
                for item in data:
                    entity_name = item.get("entity_name") or item.get("name")
                    if entity_name:
                        self._entity_data[entity_name] = item
                        if "confidence" in item:
                            self._confidence_map[f"entity:{entity_name}"] = item["confidence"]

        elif event_type == KnowledgeEventType.SERVICE_ANALYZED:
            if isinstance(data, dict):
                service_name = data.get("service_name") or data.get("name")
                if service_name:
                    self._service_data[service_name] = data
            elif isinstance(data, list):
                for item in data:
                    service_name = item.get("service_name") or item.get("name")
                    if service_name:
                        self._service_data[service_name] = item

        elif event_type == KnowledgeEventType.FLOW_ANALYZED:
            if isinstance(data, dict):
                flow_name = data.get("flow_name") or data.get("name")
                if flow_name:
                    self._flow_data[flow_name] = data
            elif isinstance(data, list):
                for item in data:
                    flow_name = item.get("flow_name") or item.get("name")
                    if flow_name:
                        self._flow_data[flow_name] = item

        elif event_type == KnowledgeEventType.LINEAGE_TRACED:
            if isinstance(data, list):
                self._lineage_data.extend(data)
            elif isinstance(data, dict):
                self._lineage_data.append(data)

        elif event_type == KnowledgeEventType.TOPIC_DISCOVERED:
            if isinstance(data, dict):
                topic_name = data.get("topic_name") or data.get("name")
                if topic_name:
                    self._topic_data[topic_name] = data
            elif isinstance(data, list):
                for item in data:
                    topic_name = item.get("topic_name") or item.get("name")
                    if topic_name:
                        self._topic_data[topic_name] = item

        elif event_type == KnowledgeEventType.ENTITY_UPDATED:
            if isinstance(data, dict):
                entity_name = data.get("entity_name") or data.get("name")
                if entity_name:
                    # 合并更新
                    if entity_name in self._entity_data:
                        self._entity_data[entity_name].update(data)
                    else:
                        self._entity_data[entity_name] = data

    def _extract_entity_name(self, data: Any) -> Optional[str]:
        """从数据中提取实体名称。"""
        if isinstance(data, dict):
            return data.get("entity_name") or data.get("name") or data.get("service_name")
        return None

    # ═══════════════════════════════════════════════════════════════
    # 数据查询
    # ═══════════════════════════════════════════════════════════════

    def get_entity(self, entity_name: str) -> Optional[dict]:
        """获取实体数据。"""
        with self._lock:
            return self._entity_data.get(entity_name)

    def get_service(self, service_name: str) -> Optional[dict]:
        """获取服务数据。"""
        with self._lock:
            return self._service_data.get(service_name)

    def get_flow(self, flow_name: str) -> Optional[dict]:
        """获取流程数据。"""
        with self._lock:
            return self._flow_data.get(flow_name)

    def get_topic(self, topic_name: str) -> Optional[dict]:
        """获取 Topic 数据。"""
        with self._lock:
            return self._topic_data.get(topic_name)

    def get_all_entities(self) -> dict[str, Any]:
        """获取所有实体数据。"""
        with self._lock:
            return dict(self._entity_data)

    def get_all_services(self) -> dict[str, Any]:
        """获取所有服务数据。"""
        with self._lock:
            return dict(self._service_data)

    def get_all_flows(self) -> dict[str, Any]:
        """获取所有流程数据。"""
        with self._lock:
            return dict(self._flow_data)

    def get_all_lineages(self) -> list[Any]:
        """获取所有血缘数据。"""
        with self._lock:
            return list(self._lineage_data)

    def get_all_topics(self) -> dict[str, Any]:
        """获取所有 Topic 数据。"""
        with self._lock:
            return dict(self._topic_data)

    def query(
        self,
        data_type: str,
        filter_fn: Callable[[Any], bool] = None,
        default: Any = None,
    ) -> Any:
        """查询数据。

        支持两种用法：
        1. 简单 key-value: hub.query("test_key") 返回 hub._entity_data.get("test_key", default)
        2. 类型查询: hub.query("entity", filter_fn=lambda x: x["name"] == "User")

        Args:
            data_type: 数据类型 ("entity", "service", "flow", "lineage", "topic") 或自定义 key
            filter_fn: 过滤函数（可选）
            default: 默认值（仅在 key-value 模式下使用）

        Returns:
            匹配的数据或数据列表
        """
        with self._lock:
            # 标准类型查询
            standard_types = {"entity", "service", "flow", "lineage", "topic"}

            if data_type in standard_types:
                if data_type == "entity":
                    data = list(self._entity_data.values())
                elif data_type == "service":
                    data = list(self._service_data.values())
                elif data_type == "flow":
                    data = list(self._flow_data.values())
                elif data_type == "lineage":
                    data = list(self._lineage_data)
                elif data_type == "topic":
                    data = list(self._topic_data.values())
                else:
                    data = []

                if filter_fn:
                    data = [d for d in data if filter_fn(d)]

                return data
            else:
                # Key-value 模式：直接查询 entity_data
                return self._entity_data.get(data_type, default)

    # ═══════════════════════════════════════════════════════════════
    # 事件订阅
    # ═══════════════════════════════════════════════════════════════

    def subscribe(
        self,
        event_type: KnowledgeEventType,
        callback: Callable[[KnowledgeEvent], None],
    ) -> None:
        """订阅事件。

        Args:
            event_type: 事件类型
            callback: 回调函数，接收 KnowledgeEvent 参数
        """
        with self._lock:
            self._subscriptions[event_type].append(callback)
            logger.debug(
                "[KnowledgeHub] 订阅事件: %s, 当前订阅者数=%d",
                event_type.value, len(self._subscriptions[event_type])
            )

    def unsubscribe(
        self,
        event_type: KnowledgeEventType,
        callback: Callable[[KnowledgeEvent], None],
    ) -> bool:
        """取消订阅。

        Returns:
            是否成功取消
        """
        with self._lock:
            if callback in self._subscriptions[event_type]:
                self._subscriptions[event_type].remove(callback)
                return True
            return False

    def _notify_subscribers(self, event: KnowledgeEvent) -> None:
        """通知订阅者（在锁外调用）。"""
        callbacks = self._subscriptions.get(event.event_type, [])

        for callback in callbacks:
            try:
                callback(event)
            except Exception as e:
                logger.warning(
                    "[KnowledgeHub] 订阅回调执行失败: %s, error=%s",
                    event.event_type.value, e
                )

    # ═══════════════════════════════════════════════════════════════
    # 置信度管理
    # ═══════════════════════════════════════════════════════════════

    def set_confidence(self, node_id: str, confidence: float) -> None:
        """设置节点置信度。"""
        with self._lock:
            self._confidence_map[node_id] = confidence

    def get_confidence(self, node_id: str) -> float:
        """获取节点置信度。"""
        with self._lock:
            return self._confidence_map.get(node_id, 1.0)

    def set_dependencies(self, node_id: str, dependencies: list[str]) -> None:
        """设置节点依赖关系。"""
        with self._lock:
            self._dependency_map[node_id] = dependencies

    def get_dependencies(self, node_id: str) -> list[str]:
        """获取节点依赖。"""
        with self._lock:
            return self._dependency_map.get(node_id, [])

    def get_propagated_confidence(self, node_id: str) -> float:
        """计算传播置信度（考虑依赖链）。

        Args:
            node_id: 节点 ID（如 "entity:User" 或 "field:User.name"）

        Returns:
            传播后的置信度
        """
        from backend.knowledge.confidence import calculate_propagated_confidence

        with self._lock:
            return calculate_propagated_confidence(
                node_id=node_id,
                confidence_map=self._confidence_map,
                dependency_map=self._dependency_map,
            )

    # ═══════════════════════════════════════════════════════════════
    # 变更追踪
    # ═══════════════════════════════════════════════════════════════

    def get_changes(self, since_version: int = 0) -> list[ChangeRecord]:
        """获取指定版本之后的变更记录。"""
        with self._lock:
            return [r for r in self._change_log if r.version > since_version]

    def get_version(self) -> int:
        """获取当前版本号。"""
        with self._lock:
            return self._version

    def get_event_history(self, limit: int = 10) -> list[KnowledgeEvent]:
        """获取最近的事件历史。"""
        with self._lock:
            return list(self._event_history[-limit:])

    # ═══════════════════════════════════════════════════════════════
    # 统计信息
    # ═══════════════════════════════════════════════════════════════

    def get_stats(self) -> dict:
        """获取统计信息。"""
        with self._lock:
            return {
                "entity_count": len(self._entity_data),
                "service_count": len(self._service_data),
                "flow_count": len(self._flow_data),
                "lineage_count": len(self._lineage_data),
                "topic_count": len(self._topic_data),
                "version": self._version,
                "subscription_count": sum(len(v) for v in self._subscriptions.values()),
            }

    def clear(self) -> None:
        """清空所有数据。"""
        with self._lock:
            self._entity_data.clear()
            self._service_data.clear()
            self._flow_data.clear()
            self._lineage_data.clear()
            self._topic_data.clear()
            self._confidence_map.clear()
            self._dependency_map.clear()
            self._change_log.clear()
            self._event_history.clear()
            self._version = 0
            logger.info("[KnowledgeHub] 数据已清空")
