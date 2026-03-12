"""
AI 分析器抽象基类。

定义所有 AI 分析器共享的生命周期、LLM 调用、
JSON 校验、节点/边工厂方法和 fallback 机制。

子类只需：
    1. 实现 analyze(summary) → AIAnalysisGraph
    2. 实现 _fallback(summary)   → AIAnalysisGraph（LLM 不可用时的静态降级）
    3. 可选：覆写 _validate_response(raw) 增加 schema 校验

输出 AIAnalysisGraph 可直接传给 GraphBuilder.merge_graph()，
因为它暴露 .nodes 和 .edges 属性（duck typing）。
"""

from __future__ import annotations

import dataclasses
import json
import logging
import re
import time
from abc import ABC, abstractmethod
from typing import Any, Optional

from backend.ai.llm_client import LLMClient, get_default_client
from backend.analyzer.ai.prompt_loader import PromptLoader
from backend.graph.graph_schema import EdgeType, GraphEdge, GraphNode, NodeType

logger = logging.getLogger(__name__)

# 每次 LLM 调用失败后等待的秒数（简单线性退避：1s, 2s）
_RETRY_DELAYS = (1.0, 2.0)

# 响应体中允许的最大字符数（防止超长无效响应）
_MAX_RESPONSE_CHARS = 32_000


# ---------------------------------------------------------------------------
# Output container
# ---------------------------------------------------------------------------


@dataclasses.dataclass
class AIAnalysisGraph:
    """AI 分析器的统一输出容器。

    与 GraphBuilder.merge_graph() duck typing 兼容：
        builder.merge_graph(ai_graph)  # 直接可用，无需适配器

    Attributes:
        nodes:         生成的 GraphNode 列表（可能为空）
        edges:         生成的 GraphEdge 列表（可能为空）
        confidence:    整体置信度 0.0–1.0
        analyzer_name: 产生此图的分析器类名
        metadata:      分析器专属元数据（不进图，仅用于日志/缓存）
    """

    nodes: list[GraphNode] = dataclasses.field(default_factory=list)
    edges: list[GraphEdge] = dataclasses.field(default_factory=list)
    confidence: float = 0.0
    analyzer_name: str = ""
    metadata: dict[str, Any] = dataclasses.field(default_factory=dict)

    @property
    def stats(self) -> dict[str, Any]:
        return {
            "nodes": len(self.nodes),
            "edges": len(self.edges),
            "confidence": round(self.confidence, 3),
            "analyzer": self.analyzer_name,
        }

    def is_empty(self) -> bool:
        return not self.nodes and not self.edges


# ---------------------------------------------------------------------------
# Base class
# ---------------------------------------------------------------------------


class AIAnalyzerBase(ABC):
    """AI 分析器抽象基类。

    子类示例::

        class MyAnalyzer(AIAnalyzerBase):

            def analyze(self, summary: RepoSummary) -> AIAnalysisGraph:
                system, user = self._prompt_loader.render("my_template",
                                                          repo_name=summary.repo_name)
                raw = self._call_llm_json(system, user, required_keys=["items"])
                if not raw:
                    return self._fallback(summary)
                return self._build_graph_from_response(raw, summary)

            def _fallback(self, summary: RepoSummary) -> AIAnalysisGraph:
                # 静态规则兜底
                ...
    """

    # 子类可覆写的重试次数（不含首次调用）
    MAX_RETRIES: int = 2

    def __init__(self, llm_client: Optional[LLMClient] = None) -> None:
        """
        Args:
            llm_client: LLM 客户端实例，None 则使用 get_default_client()。
                        客户端不可用时，analyze() 自动转为 _fallback()。
        """
        self._llm = llm_client or get_default_client()
        self._use_llm: bool = self._llm.is_available()
        self._prompt_loader = PromptLoader()

        if not self._use_llm:
            logger.info(
                "%s: LLM 不可用，将使用静态规则降级模式",
                self.analyzer_name,
            )

    # ------------------------------------------------------------------
    # Identity
    # ------------------------------------------------------------------

    @property
    def analyzer_name(self) -> str:
        """分析器类名，用于日志和缓存 key。"""
        return type(self).__name__

    # ------------------------------------------------------------------
    # Abstract interface
    # ------------------------------------------------------------------

    @abstractmethod
    def analyze(self, summary: "RepoSummary") -> AIAnalysisGraph:  # type: ignore[name-defined]
        """执行分析，返回 AIAnalysisGraph。

        Args:
            summary: RepoSummaryBuilder 生成的仓库摘要。

        Returns:
            AIAnalysisGraph — 含 nodes / edges，可直接传给
            ``GraphBuilder.merge_graph()``。

        Notes:
            实现应在 LLM 不可用或调用失败时调用 ``self._fallback(summary)``
            并返回其结果，而不是向上抛出异常。
        """

    @abstractmethod
    def _fallback(self, summary: "RepoSummary") -> AIAnalysisGraph:  # type: ignore[name-defined]
        """LLM 不可用或调用失败时的静态降级实现。

        应基于 summary 中的信息（模块名、函数名等）用正则/关键字
        推断出尽可能有用的节点/边，而不是返回空图。
        """

    # ------------------------------------------------------------------
    # LLM invocation
    # ------------------------------------------------------------------

    def _call_llm_json(
        self,
        system: str,
        user: str,
        required_keys: Optional[list[str]] = None,
    ) -> dict[str, Any]:
        """调用 LLM 并返回解析后的 JSON 字典。

        内置：
            - 最多 MAX_RETRIES 次重试（线性退避）
            - 自动从响应中提取第一个合法 JSON 对象
            - required_keys 校验（缺少任意 key 则视为无效响应）
            - 超长响应截断保护

        Args:
            system:        系统 prompt。
            user:          用户 prompt。
            required_keys: 响应 JSON 必须包含的顶层 key 列表。

        Returns:
            解析后的字典；所有重试均失败时返回空字典 ``{}``。
        """
        if not self._use_llm:
            return {}

        last_error: Optional[Exception] = None

        for attempt in range(self.MAX_RETRIES + 1):
            try:
                raw_text = self._llm.complete(user, system=system)
                if not raw_text:
                    raise ValueError("LLM returned empty response")

                parsed = self._extract_json(raw_text)
                if not parsed:
                    raise ValueError("No valid JSON found in LLM response")

                if required_keys:
                    missing = [k for k in required_keys if k not in parsed]
                    if missing:
                        raise ValueError(
                            f"LLM response missing required keys: {missing}"
                        )

                logger.debug(
                    "%s: LLM call succeeded (attempt %d/%d)",
                    self.analyzer_name, attempt + 1, self.MAX_RETRIES + 1,
                )
                return parsed

            except Exception as exc:
                last_error = exc
                if attempt < self.MAX_RETRIES:
                    delay = _RETRY_DELAYS[min(attempt, len(_RETRY_DELAYS) - 1)]
                    logger.warning(
                        "%s: LLM attempt %d/%d failed (%s), retrying in %.1fs",
                        self.analyzer_name, attempt + 1, self.MAX_RETRIES + 1,
                        exc, delay,
                    )
                    time.sleep(delay)

        logger.error(
            "%s: All %d LLM attempts failed. Last error: %s",
            self.analyzer_name, self.MAX_RETRIES + 1, last_error,
        )
        return {}

    # ------------------------------------------------------------------
    # JSON extraction & validation
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_json(text: str) -> dict[str, Any]:
        """从 LLM 响应文本中提取第一个合法 JSON 对象。

        处理常见问题：
            - Markdown 代码围栏 ``` json … ```
            - 响应前/后多余的散文文字
            - 嵌套大括号（取最外层完整对象）
        """
        if len(text) > _MAX_RESPONSE_CHARS:
            text = text[:_MAX_RESPONSE_CHARS]

        # 1. 尝试直接解析（最快路径）
        stripped = text.strip()
        try:
            result = json.loads(stripped)
            if isinstance(result, dict):
                return result
        except json.JSONDecodeError:
            pass

        # 2. 去除 markdown 代码围栏
        fence = re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", text, re.IGNORECASE)
        if fence:
            try:
                result = json.loads(fence.group(1))
                if isinstance(result, dict):
                    return result
            except json.JSONDecodeError:
                pass

        # 3. 找到最外层 { … } 对象
        start = text.find("{")
        if start == -1:
            return {}

        depth = 0
        for i, ch in enumerate(text[start:], start):
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try:
                        result = json.loads(text[start : i + 1])
                        if isinstance(result, dict):
                            return result
                    except json.JSONDecodeError:
                        break

        logger.debug("Could not extract JSON from LLM response")
        return {}

    def _validate_response(
        self,
        raw: dict[str, Any],
        required_keys: list[str],
    ) -> bool:
        """校验响应是否包含必要字段，子类可覆写以增加 schema 校验。"""
        missing = [k for k in required_keys if k not in raw]
        if missing:
            logger.warning(
                "%s: response missing keys %s", self.analyzer_name, missing
            )
            return False
        return True

    # ------------------------------------------------------------------
    # Node / edge factories
    # ------------------------------------------------------------------

    def _make_node(
        self,
        node_type: str,
        name: str,
        node_id: Optional[str] = None,
        **props: Any,
    ) -> GraphNode:
        """构造带 source 标记的 GraphNode。

        Args:
            node_type: NodeType 枚举值（字符串）。
            name:      节点名称。
            node_id:   可选固定 ID（留空则自动生成 UUID）。
            **props:   附加 properties（自动注入 source / analyzer）。
        """
        properties = {
            **props,
            "source": "ai",
            "analyzer": self.analyzer_name,
        }
        if node_id:
            return GraphNode(id=node_id, type=node_type, name=name, properties=properties)
        return GraphNode(type=node_type, name=name, properties=properties)

    def _make_edge(
        self,
        from_id: str,
        to_id: str,
        edge_type: str,
        **props: Any,
    ) -> GraphEdge:
        """构造带 source 标记的 GraphEdge。

        Args:
            from_id:   源节点 ID。
            to_id:     目标节点 ID。
            edge_type: EdgeType 枚举值（字符串）。
            **props:   附加 properties。
        """
        return GraphEdge(**{
            "from": from_id,
            "to": to_id,
            "type": edge_type,
            "properties": {**props, "source": "ai"},
        })

    # ------------------------------------------------------------------
    # Graph helpers
    # ------------------------------------------------------------------

    def _empty_graph(self, confidence: float = 0.0) -> AIAnalysisGraph:
        """返回空的 AIAnalysisGraph（用于错误 / 无数据情况）。"""
        return AIAnalysisGraph(
            nodes=[],
            edges=[],
            confidence=confidence,
            analyzer_name=self.analyzer_name,
        )

    @staticmethod
    def _dedupe_nodes(nodes: list[GraphNode]) -> list[GraphNode]:
        """按 ID 去重（保留最后一个）。"""
        seen: dict[str, GraphNode] = {}
        for n in nodes:
            seen[n.id] = n
        return list(seen.values())

    @staticmethod
    def _dedupe_edges(edges: list[GraphEdge]) -> list[GraphEdge]:
        """按 (from, to, type) 三元组去重（保留首个）。"""
        seen: set[tuple[str, str, str]] = set()
        result: list[GraphEdge] = []
        for e in edges:
            key = (e.from_, e.to, e.type)
            if key not in seen:
                seen.add(key)
                result.append(e)
        return result

    def _finalize(
        self,
        nodes: list[GraphNode],
        edges: list[GraphEdge],
        confidence: float,
        **metadata: Any,
    ) -> AIAnalysisGraph:
        """去重并封装为 AIAnalysisGraph。便捷工厂方法。"""
        return AIAnalysisGraph(
            nodes=self._dedupe_nodes(nodes),
            edges=self._dedupe_edges(edges),
            confidence=round(max(0.0, min(1.0, confidence)), 3),
            analyzer_name=self.analyzer_name,
            metadata=dict(metadata),
        )

    # ------------------------------------------------------------------
    # Logging helpers
    # ------------------------------------------------------------------

    def _log_result(self, graph: AIAnalysisGraph) -> None:
        logger.info(
            "%s 完成: nodes=%d edges=%d confidence=%.2f%s",
            self.analyzer_name,
            len(graph.nodes),
            len(graph.edges),
            graph.confidence,
            " [fallback]" if graph.metadata.get("fallback") else "",
        )
