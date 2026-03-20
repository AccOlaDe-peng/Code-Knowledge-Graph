"""Stage 4a: Spring DI/Event 静态解析（零 LLM）。

解析 Spring DI/Event/Kafka 关系，构建 Bean Registry 和 Topic Registry，
产出已解析的边 + 无法静态解析的歧义列表（交 Stage 4b）。
"""
from __future__ import annotations

import logging
import re
import time
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from backend.graph.graph_schema import GraphEdge, EdgeType
from backend.models.static_analysis import (
    ConfidenceLevel,
    FrameworkPattern,
)
from backend.pipeline.observer import AnalysisObserver, StageStarted, StageCompleted
from backend.pipeline.stages.base import StageBase

logger = logging.getLogger(__name__)


@dataclass
class DIResolution:
    """DI 解析结果。"""

    source_file: str
    source_element: str  # 注入点（类.字段 或 类.方法）
    target_bean: str  # 目标 Bean 名称
    confidence: float
    resolution_type: str  # "single_impl" | "qualifier" | "primary" | "config_bean"


@dataclass
class EventResolution:
    """Event 解析结果。"""

    publisher_file: str
    publisher_element: str
    listener_file: str
    listener_element: str
    event_class: str
    confidence: float


@dataclass
class KafkaResolution:
    """Kafka 解析结果。"""

    producer_file: str
    producer_element: str
    consumer_file: str
    consumer_element: str
    topic_name: str
    confidence: float


class SpringDIEventStaticStage(StageBase):
    """Stage 4a: Spring DI/Event 静态解析。

    静态可解的场景（覆盖约 75-80%）：
    - @Autowired + 单实现
    - @Autowired + @Qualifier
    - @Configuration @Bean 显式声明
    - @Primary 标注默认实现
    - @EventListener + 具体事件类
    - @KafkaListener + 字符串常量 topic
    - @FeignClient(name=...)
    """

    name = "spring_di_event_static"

    def __init__(
        self,
        max_items_per_batch: int = 20,
    ):
        """
        Args:
            max_items_per_batch: 每批最大处理数量（Stage 4b 使用）
        """
        self.max_items_per_batch = max_items_per_batch

    def run(
        self,
        framework_patterns: list[FrameworkPattern],
        application_yml_paths: list[Path] | None = None,
        observer: AnalysisObserver | None = None,
        on_progress: Callable[[dict], None] | None = None,
    ) -> tuple[list[GraphEdge], list[FrameworkPattern]]:
        """执行静态 DI/Event 解析。

        Args:
            framework_patterns: Stage 1 检测到的框架模式
            application_yml_paths: application.yml 文件路径列表
            observer: 事件观察器
            on_progress: 进度回调

        Returns:
            (已解析的边, 无法静态解析的歧义列表)
        """
        start_time = time.time()

        # 发送开始事件
        if observer:
            observer.emit(StageStarted.create("spring_di_event_static", file_count=len(framework_patterns)))

        if on_progress:
            on_progress(
                {"step": "spring_di_event_static", "status": "start", "message": "解析 Spring DI/Event..."}
            )

        # Step 1: 构建 Bean Registry
        bean_registry = self._build_bean_registry(framework_patterns)

        # Step 2: 构建 Topic Registry
        topic_registry = self._build_topic_registry(framework_patterns)

        # Step 3: 解析 application.yml（提取 @Value 占位符）
        config_values = self._parse_application_yml(application_yml_paths)

        # Step 4: 解析 DI 关系
        di_edges, di_ambiguities = self._resolve_di(bean_registry, framework_patterns)

        # Step 5: 解析 Event 关系
        event_edges, event_ambiguities = self._resolve_events(framework_patterns)

        # Step 6: 解析 Kafka 关系
        kafka_edges, kafka_ambiguities = self._resolve_kafka(topic_registry, framework_patterns, config_values)

        # Step 7: 解析 Feign 关系
        feign_edges = self._resolve_feign(framework_patterns)

        # 合并结果
        all_edges = di_edges + event_edges + kafka_edges + feign_edges
        all_ambiguities = di_ambiguities + event_ambiguities + kafka_ambiguities

        elapsed_ms = int((time.time() - start_time) * 1000)

        # 发送完成事件
        if observer:
            observer.emit(
                StageCompleted.create("spring_di_event_static", elapsed_ms, cache_hit=False)
            )

        msg = f"Spring DI/Event 静态解析完成: {len(all_edges)} 条边"
        if all_ambiguities:
            msg += f" | {len(all_ambiguities)} 个歧义"

        logger.info("Stage 4a 完成: %s", msg)
        if on_progress:
            on_progress(
                {
                    "step": "spring_di_event_static",
                    "status": "complete",
                    "message": msg,
                    "edges": len(all_edges),
                    "ambiguities": len(all_ambiguities),
                }
            )

        return all_edges, all_ambiguities

    def _build_bean_registry(
        self,
        patterns: list[FrameworkPattern],
    ) -> dict[str, list[FrameworkPattern]]:
        """构建 Bean 注册表（Bean 名称 -> Bean 列表）。"""
        registry: dict[str, list[FrameworkPattern]] = defaultdict(list)

        for p in patterns:
            if p.pattern_type == "bean":
                # Bean 名称通常是类名首字母小写
                bean_name = p.source_element[0].lower() + p.source_element[1:]
                registry[bean_name].append(p)
                # 也注册原始类名
                registry[p.source_element].append(p)

        return dict(registry)

    def _build_topic_registry(
        self,
        patterns: list[FrameworkPattern],
    ) -> dict[str, list[FrameworkPattern]]:
        """构建 Topic 注册表（Topic 名称 -> Pattern 列表）。"""
        registry: dict[str, list[FrameworkPattern]] = defaultdict(list)

        for p in patterns:
            if p.pattern_type in ("kafka_produce", "kafka_consume"):
                if p.target_hint and not p.target_hint.startswith("${"):
                    registry[p.target_hint].append(p)

        return dict(registry)

    def _parse_application_yml(
        self,
        yml_paths: list[Path] | None,
    ) -> dict[str, str]:
        """解析 application.yml 文件，提取配置值。

        Returns:
            {placeholder_key: value}，如 {"kafka.topic.order": "order-created"}
        """
        config_values: dict[str, str] = {}

        if not yml_paths:
            return config_values

        for yml_path in yml_paths:
            if not yml_path.exists():
                continue

            try:
                content = yml_path.read_text(encoding="utf-8", errors="replace")
                # 简化的 YAML 解析（只处理简单的 key: value 格式）
                # 实际项目应使用 PyYAML

                current_path: list[str] = []

                for line in content.splitlines():
                    line = line.rstrip()

                    if not line or line.startswith("#"):
                        continue

                    # 计算缩进
                    indent = len(line) - len(line.lstrip())
                    line = line.strip()

                    if ":" in line:
                        key_value = line.split(":", 1)
                        key = key_value[0].strip()

                        if len(key_value) == 2:
                            value = key_value[1].strip().strip('"').strip("'")

                            # 构建完整 key
                            full_key = ".".join(current_path + [key])
                            config_values[full_key] = value
                        else:
                            # 嵌套层级
                            current_path = current_path[:indent // 2] + [key]

            except Exception as e:
                logger.warning("解析 application.yml 失败 %s: %s", yml_path, e)

        return config_values

    def _resolve_di(
        self,
        bean_registry: dict[str, list[FrameworkPattern]],
        patterns: list[FrameworkPattern],
    ) -> tuple[list[GraphEdge], list[FrameworkPattern]]:
        """解析 DI 关系。

        Returns:
            (已解析的边, 歧义列表)
        """
        edges: list[GraphEdge] = []
        ambiguities: list[FrameworkPattern] = []

        for p in patterns:
            if p.pattern_type != "di_injection":
                continue

            # 尝试解析目标 Bean
            target_bean = p.target_hint  # @Qualifier 指定的 Bean

            if target_bean:
                # 有 @Qualifier
                if target_bean in bean_registry:
                    beans = bean_registry[target_bean]
                    if len(beans) == 1:
                        # 精确匹配
                        target = beans[0]
                        edges.append(GraphEdge(
                            from_=f"class:{p.source_file}:{p.source_element.split('.')[0]}",
                            to=f"class:{target.source_file}:{target.source_element}",
                            type=EdgeType.DEPENDS_ON.value,
                            properties={
                                "source": "static",
                                "confidence": ConfidenceLevel.SPRING_QUALIFIER,
                                "resolution": "qualifier",
                            },
                        ))
                    else:
                        # 多个 Bean 同名（歧义）
                        ambiguities.append(p)
                else:
                    # Bean 名称未找到（可能是配置 Bean）
                    ambiguities.append(p)
            else:
                # 无 @Qualifier，需要按类型推断
                # 简化处理：标记为歧义（需要 AI 推断）
                ambiguities.append(p)

        return edges, ambiguities

    def _resolve_events(
        self,
        patterns: list[FrameworkPattern],
    ) -> tuple[list[GraphEdge], list[FrameworkPattern]]:
        """解析 Event 关系。

        Returns:
            (已解析的边, 歧义列表)
        """
        edges: list[GraphEdge] = []
        ambiguities: list[FrameworkPattern] = []

        # 收集所有事件监听器
        listeners: list[FrameworkPattern] = [
            p for p in patterns if p.pattern_type == "event_listener"
        ]

        # 收集所有事件发布者（需要从 source code 检测 ApplicationEventPublisher.publishEvent）
        # 这里简化处理：如果 event_class 是具体类名（非 "Unknown"），则认为可解析

        for listener in listeners:
            event_class = listener.target_hint

            if event_class and event_class != "Unknown":
                # 已知事件类，可以生成边（发布者暂时未知，标记为待补充）
                edges.append(GraphEdge(
                    from_="event:unknown",  # 发布者待补充
                    to=f"class:{listener.source_file}:{listener.source_element.split('.')[0]}",
                    type=EdgeType.HANDLES.value,
                    properties={
                        "source": "static",
                        "confidence": ConfidenceLevel.SPRING_EVENT_LISTENER,
                        "event_class": event_class,
                    },
                ))
            else:
                # 未知事件类
                ambiguities.append(listener)

        return edges, ambiguities

    def _resolve_kafka(
        self,
        topic_registry: dict[str, list[FrameworkPattern]],
        patterns: list[FrameworkPattern],
        config_values: dict[str, str],
    ) -> tuple[list[GraphEdge], list[FrameworkPattern]]:
        """解析 Kafka 关系。

        Returns:
            (已解析的边, 歧义列表)
        """
        edges: list[GraphEdge] = []
        ambiguities: list[FrameworkPattern] = []

        # 按 topic 分组
        for topic_name, topic_patterns in topic_registry.items():
            producers = [p for p in topic_patterns if p.pattern_type == "kafka_produce"]
            consumers = [p for p in topic_patterns if p.pattern_type == "kafka_consume"]

            # 为每个生产者-消费者对生成边
            for producer in producers:
                for consumer in consumers:
                    edges.append(GraphEdge(
                        from_=f"class:{producer.source_file}:{producer.source_element}",
                        to=f"class:{consumer.source_file}:{consumer.source_element.split('.')[0]}",
                        type=EdgeType.PUBLISHES.value,
                        properties={
                            "source": "static",
                            "confidence": ConfidenceLevel.SPRING_KAFKA_CONSTANT,
                            "topic": topic_name,
                        },
                    ))

        # 处理动态 topic（歧义）
        for p in patterns:
            if p.pattern_type == "kafka_dynamic":
                ambiguities.append(p)

        # 处理 @Value 注入的 topic
        for p in patterns:
            if p.target_hint and p.target_hint.startswith("${"):
                # 尝试从配置中解析
                placeholder = p.target_hint[2:-1]  # 去掉 ${}
                if placeholder in config_values:
                    resolved_topic = config_values[placeholder]
                    # 可以解析，更新 target_hint
                    p.target_hint = resolved_topic
                else:
                    # 无法解析
                    ambiguities.append(p)

        return edges, ambiguities

    def _resolve_feign(
        self,
        patterns: list[FrameworkPattern],
    ) -> list[GraphEdge]:
        """解析 Feign Client 关系。"""
        edges: list[GraphEdge] = []

        for p in patterns:
            if p.pattern_type == "feign":
                service_name = p.target_hint

                edges.append(GraphEdge(
                    from_=f"class:{p.source_file}:{p.source_element}",
                    to=f"service:{service_name}",
                    type=EdgeType.DEPENDS_ON.value,
                    properties={
                        "source": "static",
                        "confidence": ConfidenceLevel.SPRING_FEIGN,
                        "service_name": service_name,
                    },
                ))

        return edges
