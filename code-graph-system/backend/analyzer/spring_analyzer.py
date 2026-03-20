"""Spring 框架分析器。

检测 Spring 注解模式：
- DI（依赖注入）：@Service, @Autowired, @Qualifier, @Primary
- Event（事件）：@EventListener, ApplicationEventPublisher
- Kafka（消息队列）：@KafkaListener, KafkaTemplate
- Feign（远程调用）：@FeignClient
- Config（配置）：@Configuration, @Bean
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from backend.agent.structure_indexer import ClassInfo, FileSkeleton, MethodInfo
from backend.models.static_analysis import ConfidenceLevel, FrameworkPattern

logger = logging.getLogger(__name__)


# Spring 注解分类
SPRING_CLASS_ANNOTATIONS = {
    # Bean 注解（标记为组件）
    "@Service": "bean",
    "@Component": "bean",
    "@Repository": "bean",
    "@Controller": "bean",
    "@RestController": "bean",
    "@Configuration": "config",
}

SPRING_DI_ANNOTATIONS = {
    "@Autowired": "di_injection",
    "@Inject": "di_injection",
    "@Resource": "di_injection",
}

SPRING_QUALIFIER_ANNOTATIONS = {
    "@Qualifier": "di_qualifier",
    "@Primary": "di_primary",
}

SPRING_EVENT_ANNOTATIONS = {
    "@EventListener": "event_listener",
    "@TransactionalEventListener": "event_listener",
}

SPRING_KAFKA_ANNOTATIONS = {
    "@KafkaListener": "kafka_consumer",
    "@KafkaHandler": "kafka_consumer",
}

SPRING_FEIGN_ANNOTATIONS = {
    "@FeignClient": "feign_client",
    "@LoadBalanced": "feign_loadbalanced",
}

SPRING_CONFIG_ANNOTATIONS = {
    "@Bean": "config_bean",
    "@Value": "config_value",
    "@ConfigurationProperties": "config_properties",
}


@dataclass
class BeanInfo:
    """Spring Bean 信息。"""

    name: str  # Bean 名称
    class_name: str  # 类名
    file_path: str  # 文件路径
    bean_type: str  # service/repository/controller/component/config
    annotations: list[str]  # 类级注解
    dependencies: list[str]  # 依赖的其他 Bean
    is_primary: bool = False
    qualifier: str | None = None


@dataclass
class KafkaTopicInfo:
    """Kafka Topic 信息。"""

    topic_name: str  # Topic 名称
    direction: str  # "produce" | "consume"
    source_file: str  # 文件路径
    source_element: str  # 类名或方法名
    raw_code: str  # 原始代码
    line_number: int
    is_dynamic: bool = False  # 是否动态 topic


@dataclass
class EventInfo:
    """Spring Event 信息。"""

    event_class: str  # 事件类名
    listener_file: str  # 监听器文件
    listener_method: str  # 监听器方法
    raw_code: str
    line_number: int


class SpringFrameworkAnalyzer:
    """Spring 框架分析器。

    分析 Java 文件，检测 Spring 注解模式，产出：
    - Bean 列表（用于 DI 解析）
    - Kafka Topic 列表（用于消息流分析）
    - Event 列表（用于事件流分析）
    """

    def __init__(self):
        self.beans: list[BeanInfo] = []
        self.kafka_topics: list[KafkaTopicInfo] = []
        self.events: list[EventInfo] = []
        self.patterns: list[FrameworkPattern] = []

    def analyze(
        self,
        file_path: Path,
        skeleton: FileSkeleton,
        source_code: str | None = None,
    ) -> list[FrameworkPattern]:
        """分析单个 Java 文件，检测 Spring 注解模式。

        Args:
            file_path: 文件路径
            skeleton: 文件骨架（AST 解析结果）
            source_code: 原始源码（可选，用于提取更详细信息）

        Returns:
            检测到的框架模式列表
        """
        if skeleton.language != "java":
            return []

        rel_path = str(file_path)
        patterns: list[FrameworkPattern] = []

        # 读取源码（用于提取注解参数）
        if source_code is None:
            try:
                source_code = file_path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                source_code = ""

        lines = source_code.splitlines() if source_code else []

        for cls in skeleton.classes:
            # 检测 Bean 注解
            bean_pattern = self._detect_bean(rel_path, cls)
            if bean_pattern:
                patterns.append(bean_pattern)

            # 检测 Feign Client
            feign_patterns = self._detect_feign(rel_path, cls)
            patterns.extend(feign_patterns)

            # 检测方法级注解
            for method in cls.methods:
                # 检测 DI 注入
                di_patterns = self._detect_di_injection(rel_path, cls.name, method, lines)
                patterns.extend(di_patterns)

                # 检测 Event Listener
                event_patterns = self._detect_event_listener(rel_path, cls.name, method, lines)
                patterns.extend(event_patterns)

                # 检测 Kafka Consumer
                kafka_patterns = self._detect_kafka_consumer(rel_path, cls.name, method, lines, source_code)
                patterns.extend(kafka_patterns)

        # 检测 Kafka Producer（需要扫描源码）
        producer_patterns = self._detect_kafka_producer(rel_path, source_code)
        patterns.extend(producer_patterns)

        # 检测 @Configuration @Bean
        config_patterns = self._detect_config_bean(rel_path, skeleton, source_code)
        patterns.extend(config_patterns)

        self.patterns.extend(patterns)
        return patterns

    def _detect_bean(self, file_path: str, cls: ClassInfo) -> FrameworkPattern | None:
        """检测 Spring Bean 注解。"""
        for ann in cls.annotations:
            if ann in SPRING_CLASS_ANNOTATIONS:
                bean_type = SPRING_CLASS_ANNOTATIONS[ann]

                # 检测 @Primary
                is_primary = "@Primary" in cls.annotations

                # 提取 Bean 名称（如果有 @Service("xxx")）
                bean_name = cls.name
                name_match = re.search(rf'{re.escape(ann)}\s*\(\s*"([^"]+)"\s*\)', "")
                if name_match:
                    bean_name = name_match.group(1)

                self.beans.append(BeanInfo(
                    name=bean_name,
                    class_name=cls.name,
                    file_path=file_path,
                    bean_type=bean_type,
                    annotations=cls.annotations,
                    dependencies=[],
                    is_primary=is_primary,
                ))

                return FrameworkPattern(
                    pattern_type="bean",
                    source_file=file_path,
                    source_element=cls.name,
                    target_hint=bean_type,
                    raw_code=f"{ann} class {cls.name}",
                    line_number=cls.line_start,
                    confidence=ConfidenceLevel.SPRING_SINGLE_IMPL,
                )

        return None

    def _detect_feign(self, file_path: str, cls: ClassInfo) -> list[FrameworkPattern]:
        """检测 @FeignClient 注解。"""
        patterns = []

        for ann in cls.annotations:
            if ann == "@FeignClient" or ann.startswith("@FeignClient("):
                # 提取服务名
                name_match = re.search(r'@FeignClient\s*\(\s*(?:name\s*=\s*)?"([^"]+)"', ann)
                service_name = name_match.group(1) if name_match else cls.name

                patterns.append(FrameworkPattern(
                    pattern_type="feign",
                    source_file=file_path,
                    source_element=cls.name,
                    target_hint=service_name,
                    raw_code=f"{ann} interface {cls.name}",
                    line_number=cls.line_start,
                    confidence=ConfidenceLevel.SPRING_FEIGN,
                ))

        return patterns

    def _detect_di_injection(
        self,
        file_path: str,
        class_name: str,
        method: MethodInfo,
        lines: list[str],
    ) -> list[FrameworkPattern]:
        """检测依赖注入注解。"""
        patterns = []

        for ann in method.annotations:
            if ann in SPRING_DI_ANNOTATIONS:
                # 检测 @Qualifier
                qualifier = None
                for a in method.annotations:
                    if a.startswith("@Qualifier"):
                        match = re.search(r'@Qualifier\s*\(\s*"([^"]+)"\s*\)', a)
                        if match:
                            qualifier = match.group(1)

                patterns.append(FrameworkPattern(
                    pattern_type="di_injection",
                    source_file=file_path,
                    source_element=f"{class_name}.{method.name}",
                    target_hint=qualifier,
                    raw_code=f"{ann} {method.signature}",
                    line_number=method.line_start,
                    confidence=ConfidenceLevel.SPRING_QUALIFIER if qualifier else ConfidenceLevel.SPRING_SINGLE_IMPL,
                ))

        return patterns

    def _detect_event_listener(
        self,
        file_path: str,
        class_name: str,
        method: MethodInfo,
        lines: list[str],
    ) -> list[FrameworkPattern]:
        """检测 @EventListener 注解。"""
        patterns = []

        for ann in method.annotations:
            if ann in SPRING_EVENT_ANNOTATIONS:
                # 尝试提取事件类型（从方法参数）
                event_class = "Unknown"
                if "(" in method.signature:
                    params = method.signature.split("(")[1].rstrip(")")
                    if params:
                        # 简化处理：取第一个参数类型
                        event_class = params.split()[0] if " " in params else params

                self.events.append(EventInfo(
                    event_class=event_class,
                    listener_file=file_path,
                    listener_method=f"{class_name}.{method.name}",
                    raw_code=f"{ann} {method.signature}",
                    line_number=method.line_start,
                ))

                patterns.append(FrameworkPattern(
                    pattern_type="event_listener",
                    source_file=file_path,
                    source_element=f"{class_name}.{method.name}",
                    target_hint=event_class,
                    raw_code=f"{ann} {method.signature}",
                    line_number=method.line_start,
                    confidence=ConfidenceLevel.SPRING_EVENT_LISTENER,
                ))

        return patterns

    def _detect_kafka_consumer(
        self,
        file_path: str,
        class_name: str,
        method: MethodInfo,
        lines: list[str],
        source_code: str,
    ) -> list[FrameworkPattern]:
        """检测 @KafkaListener 注解。"""
        patterns = []

        for ann in method.annotations:
            if ann.startswith("@KafkaListener"):
                # 提取 topic
                topic_match = re.search(r'topics\s*=\s*"([^"]+)"', ann)
                if not topic_match:
                    topic_match = re.search(r'topics\s*=\s*\{?"([^"]+)"\}?', ann)

                topic_name = topic_match.group(1) if topic_match else "unknown"

                # 判断是否动态 topic（包含 ${} 或字符串拼接）
                is_dynamic = "${" in topic_name or "+" in topic_name

                self.kafka_topics.append(KafkaTopicInfo(
                    topic_name=topic_name,
                    direction="consume",
                    source_file=file_path,
                    source_element=f"{class_name}.{method.name}",
                    raw_code=ann,
                    line_number=method.line_start,
                    is_dynamic=is_dynamic,
                ))

                confidence = ConfidenceLevel.REGEX_FALLBACK if is_dynamic else ConfidenceLevel.SPRING_KAFKA_CONSTANT
                pattern_type = "kafka_dynamic" if is_dynamic else "kafka_consume"

                patterns.append(FrameworkPattern(
                    pattern_type=pattern_type,
                    source_file=file_path,
                    source_element=f"{class_name}.{method.name}",
                    target_hint=topic_name,
                    raw_code=ann,
                    line_number=method.line_start,
                    confidence=confidence,
                ))

        return patterns

    def _detect_kafka_producer(
        self,
        file_path: str,
        source_code: str,
    ) -> list[FrameworkPattern]:
        """检测 KafkaTemplate.send() 调用。"""
        patterns = []

        if not source_code:
            return patterns

        # 查找 KafkaTemplate.send() 调用
        # 匹配模式：kafkaTemplate.send("topic", ...) 或 kafkaTemplate.send(topic, ...)
        pattern = re.compile(
            r'(\w+)\.send\s*\(\s*"([^"]+)"',
            re.MULTILINE,
        )

        for match in pattern.finditer(source_code):
            template_var = match.group(1)
            topic_name = match.group(2)

            # 计算行号
            line_num = source_code[:match.start()].count("\n") + 1

            # 判断是否动态 topic
            is_dynamic = "${" in topic_name or "+" in topic_name

            self.kafka_topics.append(KafkaTopicInfo(
                topic_name=topic_name,
                direction="produce",
                source_file=file_path,
                source_element=template_var,
                raw_code=match.group(0),
                line_number=line_num,
                is_dynamic=is_dynamic,
            ))

            confidence = ConfidenceLevel.REGEX_FALLBACK if is_dynamic else ConfidenceLevel.SPRING_KAFKA_CONSTANT
            pattern_type = "kafka_dynamic" if is_dynamic else "kafka_produce"

            patterns.append(FrameworkPattern(
                pattern_type=pattern_type,
                source_file=file_path,
                source_element=template_var,
                target_hint=topic_name,
                raw_code=match.group(0),
                line_number=line_num,
                confidence=confidence,
            ))

        return patterns

    def _detect_config_bean(
        self,
        file_path: str,
        skeleton: FileSkeleton,
        source_code: str,
    ) -> list[FrameworkPattern]:
        """检测 @Configuration @Bean 注解。"""
        patterns = []

        # 检查类是否有 @Configuration
        is_config = any(
            ann == "@Configuration" or ann.startswith("@Configuration")
            for cls in skeleton.classes
            for ann in cls.annotations
        )

        if not is_config:
            return patterns

        # 查找 @Bean 方法
        for cls in skeleton.classes:
            for method in cls.methods:
                has_bean = any(
                    ann == "@Bean" or ann.startswith("@Bean")
                    for ann in method.annotations
                )

                if has_bean:
                    patterns.append(FrameworkPattern(
                        pattern_type="config_bean",
                        source_file=file_path,
                        source_element=f"{cls.name}.{method.name}",
                        target_hint=method.name,  # Bean 名称默认为方法名
                        raw_code=f"@Bean {method.signature}",
                        line_number=method.line_start,
                        confidence=ConfidenceLevel.SPRING_CONFIG_BEAN,
                    ))

        return patterns

    def get_bean_registry(self) -> dict[str, list[BeanInfo]]:
        """获取 Bean 注册表（按 Bean 名称索引）。"""
        registry: dict[str, list[BeanInfo]] = {}
        for bean in self.beans:
            if bean.name not in registry:
                registry[bean.name] = []
            registry[bean.name].append(bean)
        return registry

    def get_topic_registry(self) -> dict[str, list[KafkaTopicInfo]]:
        """获取 Topic 注册表（按 Topic 名称索引）。"""
        registry: dict[str, list[KafkaTopicInfo]] = {}
        for topic in self.kafka_topics:
            if topic.topic_name not in registry:
                registry[topic.topic_name] = []
            registry[topic.topic_name].append(topic)
        return registry
