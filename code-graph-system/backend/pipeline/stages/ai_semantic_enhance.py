"""Stage 3: AI 语义增强 — 在静态图谱基础上做增量增强。

每个模块候选拆为两次 AI 调用：
- 调用 A（必发）：确认边界 + 语义描述（轻量，< 2K tokens）
- 调用 B（按需）：低置信度边验证（仅当有低置信度边时才发）

使用 Pydantic Model 约束输出，校验失败直接重试（最多 2 次）。
"""
from __future__ import annotations

import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from pydantic import BaseModel, Field, ValidationError

from backend.graph.graph_schema import GraphNode, GraphEdge, EdgeType
from backend.llm.client import LLMClient
from backend.models.static_analysis import (
    ConfidenceLevel,
    ModuleCandidate,
    ModuleEnhancement,
    EdgeValidation,
    NewRelationship,
    StaticAnalysisResult,
    StageMetrics,
)
from backend.pipeline.observer import (
    AnalysisObserver,
    StageStarted,
    StageCompleted,
    ModuleAnalysisStarted,
    ModuleAnalysisCompleted,
    ModuleAnalysisFailed,
)
from backend.pipeline.stages.base import StageBase

logger = logging.getLogger(__name__)

# 并发配置
MAX_POOL_SIZE = 8
MAX_RETRIES = 2


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic 输出模型
# ─────────────────────────────────────────────────────────────────────────────


class ModuleBoundaryResponse(BaseModel):
    """调用 A 的输出格式：边界 + 语义。"""

    module_id: str = Field(description="模块 ID")
    confirmed_files: list[str] = Field(default_factory=list, description="确认后的文件列表")
    name: str = Field(description="模块语义名称")
    purpose: str = Field(description="模块用途描述")
    layer: str = Field(description="架构层（controller/service/repository/domain/...）")
    technology: list[str] = Field(default_factory=list, description="技术栈")


class EdgeValidationResponse(BaseModel):
    """调用 B 的输出格式：边验证。"""

    module_id: str = Field(description="模块 ID")
    validated_edges: list[dict] = Field(default_factory=list, description="验证后的边列表")
    new_relationships: list[dict] = Field(default_factory=list, description="新发现的关系")


# ─────────────────────────────────────────────────────────────────────────────
# Prompt 模板
# ─────────────────────────────────────────────────────────────────────────────


SYSTEM_PROMPT_BOUNDARY = """你是一个代码架构分析专家。你的任务是分析代码模块的语义含义。

请根据提供的模块文件列表和代码结构，输出：
1. 模块的语义名称（简洁、有意义）
2. 模块的用途描述（1-2 句话）
3. 架构层（controller/service/repository/domain/util/config/other）
4. 使用的技术栈（如 spring-boot, kafka, mybatis 等）
5. 确认文件列表是否合理（可删除明显不相关的文件）

输出格式必须是合法的 JSON，格式如下：
{
  "module_id": "...",
  "confirmed_files": ["file1.java", "file2.java"],
  "name": "用户认证模块",
  "purpose": "处理用户登录、登出、Token 管理",
  "layer": "service",
  "technology": ["spring-boot", "jwt", "redis"]
}"""


SYSTEM_PROMPT_EDGE = """你是一个代码依赖分析专家。你的任务是验证和补充代码依赖关系。

你将看到一些低置信度的依赖边，需要验证这些关系是否正确，或发现遗漏的关系。

输出格式必须是合法的 JSON：
{
  "module_id": "...",
  "validated_edges": [
    {
      "edge_id": "UserService -> UserRepo",
      "is_valid": true,
      "corrected_target": null,
      "confidence": 0.85,
      "reason": "确认存在调用关系"
    }
  ],
  "new_relationships": [
    {
      "from_element": "OrderService",
      "to_element": "KafkaTemplate",
      "relationship_type": "uses",
      "description": "发送订单消息",
      "confidence": 0.80
    }
  ]
}"""


class AISemanticEnhanceStage(StageBase):
    """Stage 3: AI 语义增强。

    特点：
    1. 拆分为两次调用（边界 + 边验证），按需触发
    2. Pydantic 约束输出，校验失败重试
    3. 并发调度（继承 IntelligentScheduler 策略）
    """

    name = "ai_semantic_enhance"

    def __init__(
        self,
        max_concurrency: int = 3,
        max_retries: int = MAX_RETRIES,
    ):
        """
        Args:
            max_concurrency: 最大并发模块数
            max_retries: 输出校验失败时的最大重试次数
        """
        self.max_concurrency = max_concurrency
        self.max_retries = max_retries

    def run(
        self,
        module_candidates: list[ModuleCandidate],
        static_result: StaticAnalysisResult,
        llm_client: LLMClient,
        observer: AnalysisObserver | None = None,
        on_progress: Callable[[dict], None] | None = None,
    ) -> tuple[list[ModuleEnhancement], list[GraphNode], list[GraphEdge], list[str]]:
        """执行 AI 语义增强。

        Args:
            module_candidates: 模块候选列表（Stage 2 输出）
            static_result: 静态分析结果（Stage 1 输出）
            llm_client: LLM 客户端
            observer: 事件观察器
            on_progress: 进度回调

        Returns:
            (模块增强列表, 新增节点, 新增边, 失败模块列表)
        """
        start_time = time.time()

        # 发送开始事件
        if observer:
            observer.emit(StageStarted.create("ai_semantic_enhance", file_count=len(module_candidates)))

        if on_progress:
            on_progress(
                {"step": "ai_semantic_enhance", "status": "start", "message": "AI 语义增强..."}
            )

        # 分发低置信度边到各模块
        module_low_conf_edges = self._distribute_low_confidence_edges(
            module_candidates, static_result.low_confidence_edges
        )

        # 并发处理模块
        enhancements: list[ModuleEnhancement] = []
        new_nodes: list[GraphNode] = []
        new_edges: list[GraphEdge] = []
        failed_modules: list[str] = []

        with ThreadPoolExecutor(max_workers=self.max_concurrency) as executor:
            future_to_module = {}

            for candidate in module_candidates:
                low_conf_edges = module_low_conf_edges.get(candidate.id, [])

                future = executor.submit(
                    self._enhance_single_module,
                    candidate,
                    static_result,
                    low_conf_edges,
                    llm_client,
                    observer,
                )
                future_to_module[future] = candidate

            for future in as_completed(future_to_module):
                candidate = future_to_module[future]
                try:
                    enhancement, nodes, edges = future.result()
                    enhancements.append(enhancement)
                    new_nodes.extend(nodes)
                    new_edges.extend(edges)
                except Exception as e:
                    logger.warning("模块分析失败 %s: %s", candidate.id, e)
                    failed_modules.append(candidate.id)

                    if observer:
                        observer.emit(ModuleAnalysisFailed.create(
                            module_id=candidate.id,
                            stage="ai_semantic_enhance",
                            reason=str(e),
                            raw_llm_output=None,
                        ))

        elapsed_ms = int((time.time() - start_time) * 1000)

        # 发送完成事件
        if observer:
            observer.emit(
                StageCompleted.create("ai_semantic_enhance", elapsed_ms, cache_hit=False)
            )

        msg = f"AI 语义增强完成: {len(enhancements)} 个模块"
        if failed_modules:
            msg += f" | {len(failed_modules)} 个失败"

        logger.info("[ai_semantic_enhance] 完成: %s", msg)
        if on_progress:
            on_progress(
                {
                    "step": "ai_semantic_enhance",
                    "status": "complete",
                    "message": msg,
                    "modules": len(enhancements),
                    "failed": len(failed_modules),
                }
            )

        return enhancements, new_nodes, new_edges, failed_modules

    def _distribute_low_confidence_edges(
        self,
        candidates: list[ModuleCandidate],
        low_conf_edges: list[GraphEdge],
    ) -> dict[str, list[GraphEdge]]:
        """分发低置信度边到各模块。

        规则：按 from_ 节点所在文件归属到对应模块。
        """
        # 构建文件 -> 模块映射
        file_to_module: dict[str, str] = {}
        for c in candidates:
            for f in c.files:
                file_to_module[f] = c.id

        # 分发边
        result: dict[str, list[GraphEdge]] = {}
        for edge in low_conf_edges:
            # 从 from_ 节点 ID 提取文件路径
            # 格式: "class:file_path:ClassName" 或 "function:file_path:..."
            parts = edge.from_.split(":")
            if len(parts) >= 2:
                file_path = parts[1]
                module_id = file_to_module.get(file_path)
                if module_id:
                    if module_id not in result:
                        result[module_id] = []
                    result[module_id].append(edge)

        return result

    def _enhance_single_module(
        self,
        candidate: ModuleCandidate,
        static_result: StaticAnalysisResult,
        low_conf_edges: list[GraphEdge],
        llm_client: LLMClient,
        observer: AnalysisObserver | None,
    ) -> tuple[ModuleEnhancement, list[GraphNode], list[GraphEdge]]:
        """增强单个模块。"""
        module_start = time.time()

        if observer:
            observer.emit(ModuleAnalysisStarted.create(
                module_id=candidate.id,
                file_count=len(candidate.files),
                has_warnings=bool(candidate.boundary_warnings),
            ))

        # 调用 A：边界 + 语义
        boundary_response = self._call_boundary(
            candidate, static_result, llm_client
        )

        # 调用 B：边验证（按需）
        validated_edges: list[EdgeValidation] = []
        new_relationships: list[NewRelationship] = []

        if low_conf_edges:
            edge_response = self._call_edge_validation(
                candidate, low_conf_edges, llm_client
            )
            if edge_response:
                validated_edges = [
                    EdgeValidation(**e) for e in edge_response.validated_edges
                ]
                new_relationships = [
                    NewRelationship(**r) for r in edge_response.new_relationships
                ]

        # 构建 ModuleEnhancement
        enhancement = ModuleEnhancement(
            module_id=candidate.id,
            confirmed_files=boundary_response.confirmed_files or candidate.files,
            name=boundary_response.name,
            purpose=boundary_response.purpose,
            layer=boundary_response.layer,
            technology=boundary_response.technology,
            validated_edges=validated_edges,
            new_relationships=new_relationships,
        )

        # 构建新增节点和边
        new_nodes: list[GraphNode] = []
        new_edges: list[GraphEdge] = []

        # 根据新发现的关系创建边
        for rel in new_relationships:
            edge = GraphEdge(
                from_=rel.from_element,
                to=rel.to_element,
                type=rel.relationship_type,
                properties={
                    "source": "ai_enhanced",
                    "confidence": rel.confidence,
                    "description": rel.description,
                },
            )
            new_edges.append(edge)

        elapsed_ms = int((time.time() - module_start) * 1000)

        if observer:
            observer.emit(ModuleAnalysisCompleted.create(
                module_id=candidate.id,
                node_count=len(new_nodes),
                edge_count=len(new_edges),
                elapsed_ms=elapsed_ms,
                source="ai",
            ))

        return enhancement, new_nodes, new_edges

    def _call_boundary(
        self,
        candidate: ModuleCandidate,
        static_result: StaticAnalysisResult,
        llm_client: LLMClient,
    ) -> ModuleBoundaryResponse:
        """调用 A：边界 + 语义。"""
        # 构建提示词
        files_info = "\n".join(f"- {f}" for f in candidate.files[:20])  # 最多 20 个文件

        boundary_hints = ""
        if candidate.boundary_warnings:
            boundary_hints = "\n边界警告：\n" + "\n".join(f"- {w}" for w in candidate.boundary_warnings)

        prompt = f"""分析以下代码模块：

模块 ID: {candidate.id}
文件列表（共 {len(candidate.files)} 个）:
{files_info}
{boundary_hints}

请输出模块的语义信息。"""

        # 调用 LLM
        for attempt in range(self.max_retries + 1):
            try:
                response_text = llm_client.complete(
                    prompt=prompt,
                    system=SYSTEM_PROMPT_BOUNDARY,
                    max_tokens=1000,
                    temperature=0.1,
                )

                # 提取 JSON
                json_str = self._extract_json(response_text)
                if json_str:
                    return ModuleBoundaryResponse.model_validate_json(json_str)

            except ValidationError as e:
                logger.warning("边界响应校验失败 (attempt %d): %s", attempt, e)
            except Exception as e:
                logger.warning("边界调用失败 (attempt %d): %s", attempt, e)

        # 失败时返回默认值
        return ModuleBoundaryResponse(
            module_id=candidate.id,
            confirmed_files=candidate.files,
            name=candidate.name,
            purpose="",
            layer="other",
            technology=[],
        )

    def _call_edge_validation(
        self,
        candidate: ModuleCandidate,
        low_conf_edges: list[GraphEdge],
        llm_client: LLMClient,
    ) -> EdgeValidationResponse | None:
        """调用 B：边验证。"""
        # 构建边列表
        edges_info = "\n".join(
            f"- {e.from_} -> {e.to} ({e.type}): {e.properties.get('confidence', 0):.2f}"
            for e in low_conf_edges[:10]  # 最多 10 条边
        )

        prompt = f"""验证以下低置信度依赖关系：

模块 ID: {candidate.id}
待验证的边：
{edges_info}

请验证这些边是否正确，并发现可能遗漏的关系。"""

        for attempt in range(self.max_retries + 1):
            try:
                response_text = llm_client.complete(
                    prompt=prompt,
                    system=SYSTEM_PROMPT_EDGE,
                    max_tokens=2000,
                    temperature=0.1,
                )

                json_str = self._extract_json(response_text)
                if json_str:
                    return EdgeValidationResponse.model_validate_json(json_str)

            except ValidationError as e:
                logger.warning("边验证响应校验失败 (attempt %d): %s", attempt, e)
            except Exception as e:
                logger.warning("边验证调用失败 (attempt %d): %s", attempt, e)

        return None

    def _extract_json(self, text: str) -> str | None:
        """从响应文本中提取 JSON。"""
        # 尝试直接解析
        text = text.strip()
        if text.startswith("{"):
            return text

        # 查找 JSON 代码块
        import re
        match = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
        if match:
            return match.group(1).strip()

        # 查找花括号
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1 and end > start:
            return text[start:end + 1]

        return None
