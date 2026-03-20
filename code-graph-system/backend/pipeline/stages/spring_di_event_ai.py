"""Stage 4b: AI 解析歧义 — 处理 Stage 4a 无法静态解析的关系。

只处理三类场景：
- 多实现 DI：@Autowired 有多个实现，需根据 @Conditional/@Profile 推断
- 动态 topic：topic 名称是动态拼接或配置注入
- 事件多态：监听父类事件，需要识别所有子类发布者

批处理策略：按类型分组，每批最多 max_items_per_batch 个。
"""
from __future__ import annotations

import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Callable

from pydantic import BaseModel, Field, ValidationError

from backend.graph.graph_schema import GraphEdge, EdgeType
from backend.llm.client import LLMClient
from backend.models.static_analysis import (
    ConfidenceLevel,
    FrameworkPattern,
)
from backend.pipeline.observer import (
    AnalysisObserver,
    StageStarted,
    StageCompleted,
)
from backend.pipeline.stages.base import StageBase

logger = logging.getLogger(__name__)

# 批次配置
MAX_ITEMS_PER_BATCH = 20
MAX_CONCURRENCY = 3


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic 输出模型
# ─────────────────────────────────────────────────────────────────────────────


class DIResolutionResponse(BaseModel):
    """DI 歧义解析响应。"""

    resolutions: list[dict] = Field(default_factory=list, description="解析结果")


class TopicResolutionResponse(BaseModel):
    """动态 Topic 解析响应。"""

    resolutions: list[dict] = Field(default_factory=list, description="Topic 解析结果")


class EventResolutionResponse(BaseModel):
    """事件多态解析响应。"""

    resolutions: list[dict] = Field(default_factory=list, description="事件解析结果")


# ─────────────────────────────────────────────────────────────────────────────
# Prompt 模板
# ─────────────────────────────────────────────────────────────────────────────


SYSTEM_PROMPT_DI = """你是一个 Spring 依赖注入分析专家。

你将看到多个 @Autowired 注入点，每个可能有多个候选实现。请根据：
1. @Qualifier 或 @Primary 注解
2. @Conditional/@Profile 条件
3. 代码上下文和命名约定

推断每个注入点最可能使用的实现。

输出格式（JSON）：
{
  "resolutions": [
    {
      "injection_point": "OrderService.paymentService",
      "resolved_bean": "AliPayService",
      "confidence": 0.85,
      "reason": "@Profile(\"prod\") 激活时使用 AliPayService"
    }
  ]
}"""


SYSTEM_PROMPT_TOPIC = """你是一个 Kafka 消息分析专家。

你将看到多个动态 topic 名称，它们可能是字符串拼接或配置注入。请推断它们的实际值或可能值范围。

输出格式（JSON）：
{
  "resolutions": [
    {
      "dynamic_topic": "topicPrefix + \"-\" + env",
      "possible_values": ["order-prod", "order-dev"],
      "confidence": 0.75,
      "reason": "根据环境变量推断"
    }
  ]
}"""


SYSTEM_PROMPT_EVENT = """你是一个 Spring 事件分析专家。

你将看到多个事件监听器，它们监听的是父类事件。请识别所有可能的子类事件发布者。

输出格式（JSON）：
{
  "resolutions": [
    {
      "listener": "OrderEventListener.onOrderEvent",
      "event_class": "OrderEvent",
      "publishers": ["OrderService.createOrder", "PaymentService.processPayment"],
      "confidence": 0.80,
      "reason": "这两个方法发布了 OrderEvent 的子类"
    }
  ]
}"""


class SpringDIEventAIStage(StageBase):
    """Stage 4b: AI 解析歧义。

    特点：
    1. 只处理三类场景（DI/Topic/Event）
    2. 批处理策略，每批最多 max_items_per_batch 个
    3. 与 Stage 3 共享并发控制
    """

    name = "spring_di_event_ai"

    def __init__(
        self,
        max_items_per_batch: int = MAX_ITEMS_PER_BATCH,
        max_concurrency: int = MAX_CONCURRENCY,
    ):
        """
        Args:
            max_items_per_batch: 每批最大处理数量
            max_concurrency: 最大并发批次数
        """
        self.max_items_per_batch = max_items_per_batch
        self.max_concurrency = max_concurrency

    def run(
        self,
        ambiguities: list[FrameworkPattern],
        llm_client: LLMClient,
        observer: AnalysisObserver | None = None,
        on_progress: Callable[[dict], None] | None = None,
    ) -> list[GraphEdge]:
        """执行 AI 歧义解析。

        Args:
            ambiguities: Stage 4a 无法静态解析的歧义列表
            llm_client: LLM 客户端
            observer: 事件观察器
            on_progress: 进度回调

        Returns:
            解析后的边列表
        """
        start_time = time.time()

        # 发送开始事件
        if observer:
            observer.emit(StageStarted.create("spring_di_event_ai", file_count=len(ambiguities)))

        if on_progress:
            on_progress(
                {"step": "spring_di_event_ai", "status": "start", "message": "AI 解析歧义..."}
            )

        if not ambiguities:
            logger.info("Stage 4b: 无歧义，跳过")
            return []

        # 按类型分组
        di_ambiguities = [p for p in ambiguities if "di" in p.pattern_type]
        kafka_ambiguities = [p for p in ambiguities if "kafka" in p.pattern_type]
        event_ambiguities = [p for p in ambiguities if "event" in p.pattern_type]

        all_edges: list[GraphEdge] = []

        # 批处理 DI 歧义
        if di_ambiguities:
            di_edges = self._process_di_ambiguities(di_ambiguities, llm_client)
            all_edges.extend(di_edges)

        # 批处理 Kafka 歧义
        if kafka_ambiguities:
            kafka_edges = self._process_kafka_ambiguities(kafka_ambiguities, llm_client)
            all_edges.extend(kafka_edges)

        # 批处理 Event 歧义
        if event_ambiguities:
            event_edges = self._process_event_ambiguities(event_ambiguities, llm_client)
            all_edges.extend(event_edges)

        elapsed_ms = int((time.time() - start_time) * 1000)

        # 发送完成事件
        if observer:
            observer.emit(
                StageCompleted.create("spring_di_event_ai", elapsed_ms, cache_hit=False)
            )

        msg = f"AI 歧义解析完成: {len(all_edges)} 条边"
        logger.info("Stage 4b 完成: %s", msg)
        if on_progress:
            on_progress(
                {
                    "step": "spring_di_event_ai",
                    "status": "complete",
                    "message": msg,
                    "edges": len(all_edges),
                }
            )

        return all_edges

    def _process_di_ambiguities(
        self,
        ambiguities: list[FrameworkPattern],
        llm_client: LLMClient,
    ) -> list[GraphEdge]:
        """处理 DI 歧义。"""
        edges: list[GraphEdge] = []

        # 分批处理
        batches = self._create_batches(ambiguities)

        for batch in batches:
            try:
                response = self._call_di_resolution(batch, llm_client)
                if response:
                    for res in response.resolutions:
                        edge = GraphEdge(
                            from_=res.get("injection_point", "unknown"),
                            to=res.get("resolved_bean", "unknown"),
                            type=EdgeType.DEPENDS_ON.value,
                            properties={
                                "source": "ai_enhanced",
                                "confidence": res.get("confidence", ConfidenceLevel.AI_VALIDATED),
                                "reason": res.get("reason", ""),
                            },
                        )
                        edges.append(edge)
            except Exception as e:
                logger.warning("DI 歧义解析失败: %s", e)

        return edges

    def _process_kafka_ambiguities(
        self,
        ambiguities: list[FrameworkPattern],
        llm_client: LLMClient,
    ) -> list[GraphEdge]:
        """处理 Kafka 动态 topic 歧义。"""
        edges: list[GraphEdge] = []

        batches = self._create_batches(ambiguities)

        for batch in batches:
            try:
                response = self._call_topic_resolution(batch, llm_client)
                if response:
                    for res in response.resolutions:
                        # 为每个可能的 topic 值创建边
                        possible_values = res.get("possible_values", [])
                        for topic in possible_values:
                            edge = GraphEdge(
                                from_=batch[0].source_element if batch else "unknown",
                                to=f"topic:{topic}",
                                type=EdgeType.PUBLISHES.value,
                                properties={
                                    "source": "ai_enhanced",
                                    "confidence": res.get("confidence", ConfidenceLevel.AI_DISCOVERED),
                                    "original_expression": res.get("dynamic_topic", ""),
                                },
                            )
                            edges.append(edge)
            except Exception as e:
                logger.warning("Kafka 歧义解析失败: %s", e)

        return edges

    def _process_event_ambiguities(
        self,
        ambiguities: list[FrameworkPattern],
        llm_client: LLMClient,
    ) -> list[GraphEdge]:
        """处理事件多态歧义。"""
        edges: list[GraphEdge] = []

        batches = self._create_batches(ambiguities)

        for batch in batches:
            try:
                response = self._call_event_resolution(batch, llm_client)
                if response:
                    for res in response.resolutions:
                        publishers = res.get("publishers", [])
                        listener = res.get("listener", "unknown")

                        for publisher in publishers:
                            edge = GraphEdge(
                                from_=publisher,
                                to=listener,
                                type=EdgeType.TRIGGERS.value,
                                properties={
                                    "source": "ai_enhanced",
                                    "confidence": res.get("confidence", ConfidenceLevel.AI_DISCOVERED),
                                    "event_class": res.get("event_class", ""),
                                },
                            )
                            edges.append(edge)
            except Exception as e:
                logger.warning("Event 歧义解析失败: %s", e)

        return edges

    def _create_batches(
        self,
        items: list[FrameworkPattern],
    ) -> list[list[FrameworkPattern]]:
        """创建批次。"""
        batches = []
        for i in range(0, len(items), self.max_items_per_batch):
            batches.append(items[i:i + self.max_items_per_batch])
        return batches

    def _call_di_resolution(
        self,
        batch: list[FrameworkPattern],
        llm_client: LLMClient,
    ) -> DIResolutionResponse | None:
        """调用 DI 歧义解析。"""
        items_info = "\n".join(
            f"- {p.source_element} (目标提示: {p.target_hint or '无'})"
            for p in batch
        )

        prompt = f"""解析以下 @Autowired 注入点：

{items_info}

请推断每个注入点最可能使用的实现。"""

        try:
            response_text = llm_client.complete(
                prompt=prompt,
                system=SYSTEM_PROMPT_DI,
                max_tokens=2000,
                temperature=0.1,
            )

            json_str = self._extract_json(response_text)
            if json_str:
                return DIResolutionResponse.model_validate_json(json_str)

        except Exception as e:
            logger.warning("DI 调用失败: %s", e)

        return None

    def _call_topic_resolution(
        self,
        batch: list[FrameworkPattern],
        llm_client: LLMClient,
    ) -> TopicResolutionResponse | None:
        """调用 Topic 歧义解析。"""
        items_info = "\n".join(
            f"- {p.source_element}: {p.target_hint or p.raw_code}"
            for p in batch
        )

        prompt = f"""解析以下动态 topic：

{items_info}

请推断每个 topic 的实际值或可能值范围。"""

        try:
            response_text = llm_client.complete(
                prompt=prompt,
                system=SYSTEM_PROMPT_TOPIC,
                max_tokens=2000,
                temperature=0.1,
            )

            json_str = self._extract_json(response_text)
            if json_str:
                return TopicResolutionResponse.model_validate_json(json_str)

        except Exception as e:
            logger.warning("Topic 调用失败: %s", e)

        return None

    def _call_event_resolution(
        self,
        batch: list[FrameworkPattern],
        llm_client: LLMClient,
    ) -> EventResolutionResponse | None:
        """调用 Event 歧义解析。"""
        items_info = "\n".join(
            f"- {p.source_element} 监听 {p.target_hint or '未知事件'}"
            for p in batch
        )

        prompt = f"""分析以下事件监听器：

{items_info}

请识别每个监听器对应的事件发布者。"""

        try:
            response_text = llm_client.complete(
                prompt=prompt,
                system=SYSTEM_PROMPT_EVENT,
                max_tokens=2000,
                temperature=0.1,
            )

            json_str = self._extract_json(response_text)
            if json_str:
                return EventResolutionResponse.model_validate_json(json_str)

        except Exception as e:
            logger.warning("Event 调用失败: %s", e)

        return None

    def _extract_json(self, text: str) -> str | None:
        """从响应文本中提取 JSON。"""
        import re

        text = text.strip()
        if text.startswith("{"):
            return text

        match = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
        if match:
            return match.group(1).strip()

        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1 and end > start:
            return text[start:end + 1]

        return None
