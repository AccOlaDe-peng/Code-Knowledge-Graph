"""Stage 3: AI 字段血缘 — 推断字段级数据血缘，追踪字段流转路径。

分析服务类中的字段赋值逻辑，追踪字段在方法调用间的传递，
识别字段值的来源和去向，推断字段级流转路径。

特点：
- 基于实体和服务信息推断血缘
- 标注流转类型（direct/transformed/conditional）
- 标注流转模式（策略驱动/事件触发/定时调度）
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Callable

from pydantic import BaseModel, Field, ValidationError

from backend.llm.client import LLMClient
from backend.models.ai_first_analysis import (
    EntityAnalysisResult,
    ServiceCandidate,
    FieldLineage,
    FieldLineageResult,
)
from backend.pipeline.observer import AnalysisObserver, StageStarted, StageCompleted
from backend.pipeline.stages.base import StageBase

logger = logging.getLogger(__name__)

MAX_RETRIES = 2


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic 输出模型
# ─────────────────────────────────────────────────────────────────────────────


class FieldLineageResponse(BaseModel):
    """字段血缘响应模型。"""

    from_entity: str = Field(description="源实体名")
    from_field: str = Field(description="源字段名")
    to_entity: str = Field(description="目标实体名")
    to_field: str = Field(description="目标字段名")
    flow_type: str = Field(default="direct", description="流转类型")
    flow_pattern: str = Field(default="", description="流转模式")
    transformation: str | None = Field(default=None, description="转换逻辑")
    condition: str | None = Field(default=None, description="条件描述")
    intermediate_methods: list[str] = Field(default_factory=list, description="中间方法")
    description: str = Field(default="", description="描述")


class FieldLineageListResponse(BaseModel):
    """字段血缘列表响应模型。"""

    field_lineages: list[FieldLineageResponse] = Field(default_factory=list, description="血缘列表")


# ─────────────────────────────────────────────────────────────────────────────
# Prompt 模板
# ─────────────────────────────────────────────────────────────────────────────


SYSTEM_PROMPT = """你是一个数据血缘分析专家。你的任务是分析系统中字段级数据流转关系。

## 任务目标

1. **追踪字段在服务调用间的传递路径**
   - 分析服务方法中的字段赋值逻辑
   - 识别字段值从一个实体传递到另一个实体

2. **识别字段值的来源和去向**
   - 来源：字段值来自哪个实体的哪个字段
   - 去向：字段值传递到哪个实体的哪个字段

3. **标注流转类型**
   - direct: 直接传递，值不变
   - transformed: 经过转换（如格式转换、计算）
   - conditional: 条件性传递（有 if 条件判断）

4. **标注流转模式**
   - 策略驱动: 策略配置触发数据流转（如 Policy → Service）
   - 事件触发: 事件驱动数据流转（如 Event → Handler）
   - 定时调度: 定时任务触发数据流转（如 Cron Job → Service）
   - 配置关联: 配置关系导致数据流转（如 FK 关联）
   - API调用: API 调用触发数据流转

## 输出格式

输出必须是合法的 JSON，格式如下：
{
  "field_lineages": [
    {
      "from_entity": "Policy",
      "from_field": "uuid",
      "to_entity": "Frs",
      "to_field": "fullPolicyId",
      "flow_type": "direct",
      "flow_pattern": "策略驱动",
      "description": "策略UUID传递给文件检测服务作为全量策略ID"
    },
    {
      "from_entity": "AdmsApplication",
      "from_field": "uuid",
      "to_entity": "DatabaseDetection",
      "to_field": "admsApplicationId",
      "flow_type": "direct",
      "flow_pattern": "配置关联",
      "description": "在线应用UUID传递给数据库检测作为应用ID"
    }
  ]
}

只输出 JSON，不要其他解释。"""


USER_PROMPT_TEMPLATE = """请分析以下系统中字段级数据流转关系。

## 已知实体和字段

{entities_summary}

## 已知服务

{services_summary}

请分析这些实体和服务之间的字段流转关系，输出字段血缘列表。"""


# ─────────────────────────────────────────────────────────────────────────────
# AIFieldLineageStage
# ─────────────────────────────────────────────────────────────────────────────


class AIFieldLineageStage(StageBase):
    """Stage 3: AI 字段血缘。

    推断字段级数据血缘，追踪字段流转路径。
    """

    name = "ai_field_lineage"

    def __init__(
        self,
        max_retries: int = MAX_RETRIES,
        max_tokens: int = 6000,
        temperature: float = 0.1,
    ):
        """
        Args:
            max_retries: 输出校验失败时的最大重试次数
            max_tokens: LLM 最大 token 数
            temperature: LLM 温度参数
        """
        self.max_retries = max_retries
        self.max_tokens = max_tokens
        self.temperature = temperature

    def run(
        self,
        repo_path: Path,
        entity_results: list[EntityAnalysisResult],
        service_candidates: list[ServiceCandidate],
        llm_client: LLMClient,
        observer: AnalysisObserver | None = None,
        on_progress: Callable[[dict], None] | None = None,
    ) -> FieldLineageResult:
        """执行 AI 字段血缘分析。

        Args:
            repo_path: 仓库根目录
            entity_results: 实体分析结果列表
            service_candidates: 服务候选列表
            llm_client: LLM 客户端
            observer: 事件观察器
            on_progress: 进度回调

        Returns:
            FieldLineageResult: 字段血缘分析结果
        """
        start_time = time.time()

        # 发送开始事件
        if observer:
            observer.emit(StageStarted.create("ai_field_lineage", file_count=len(entity_results)))

        if on_progress:
            on_progress({
                "step": "ai_field_lineage",
                "status": "start",
                "message": "AI 推断字段血缘...",
            })

        # 构建上下文摘要
        entities_summary = self._build_entities_summary(entity_results)
        services_summary = self._build_services_summary(service_candidates)

        # 构建 prompt
        user_prompt = USER_PROMPT_TEMPLATE.format(
            entities_summary=entities_summary,
            services_summary=services_summary,
        )

        # 定义工具
        tools = self._build_tools(repo_path)

        # 构建消息
        messages = [{"role": "user", "content": user_prompt}]

        # 调用 LLM
        lineages: list[FieldLineage] = []

        for attempt in range(self.max_retries + 1):
            try:
                result = llm_client.tool_call_loop(
                    system=SYSTEM_PROMPT,
                    messages=messages,
                    tools=tools,
                    max_iterations=15,
                    temperature=self.temperature,
                    max_tokens=self.max_tokens,
                )

                if result.status == "completed" and result.final_message:
                    parsed = self._parse_response(result.final_message)
                    if parsed:
                        lineages = parsed
                        break

            except Exception as e:
                logger.warning("字段血缘分析失败 (attempt %d): %s", attempt, e)

        elapsed_ms = int((time.time() - start_time) * 1000)

        # 发送完成事件
        if observer:
            observer.emit(StageCompleted.create("ai_field_lineage", elapsed_ms, cache_hit=False))

        # 统计信息
        stats = {
            "lineage_count": len(lineages),
            "flow_types": self._count_flow_types(lineages),
            "flow_patterns": self._count_flow_patterns(lineages),
            "elapsed_ms": elapsed_ms,
        }

        logger.info(
            "[ai_field_lineage] 完成: %d 条血缘, 耗时 %dms",
            len(lineages),
            elapsed_ms,
        )

        if on_progress:
            on_progress({
                "step": "ai_field_lineage",
                "status": "complete",
                "message": f"字段血缘分析完成: {len(lineages)} 条",
                "lineage_count": len(lineages),
            })

        return FieldLineageResult(lineages=lineages, stats=stats)

    def _build_entities_summary(self, entity_results: list[EntityAnalysisResult]) -> str:
        """构建实体摘要。"""
        lines = []
        for entity in entity_results[:30]:  # 限制数量
            field_names = [f.name for f in entity.fields[:10]]
            field_str = ", ".join(field_names)
            if len(entity.fields) > 10:
                field_str += f" ... ({len(entity.fields)} 字段)"
            lines.append(f"- {entity.entity_name} ({entity.table_name}): {field_str}")
        return "\n".join(lines)

    def _build_services_summary(self, service_candidates: list[ServiceCandidate]) -> str:
        """构建服务摘要。"""
        if not service_candidates:
            return "无已知服务"

        lines = []
        for service in service_candidates[:20]:  # 限制数量
            lines.append(f"- {service.class_name} ({service.service_type})")
        return "\n".join(lines)

    def _build_tools(self, repo_path: Path) -> list[dict]:
        """构建 LLM 工具定义。"""
        return [
            {
                "type": "function",
                "function": {
                    "name": "search_code",
                    "description": "在代码中搜索文本模式",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "pattern": {
                                "type": "string",
                                "description": "搜索模式",
                            },
                            "file_pattern": {
                                "type": "string",
                                "description": "文件名模式",
                                "default": "*.java",
                            },
                        },
                        "required": ["pattern"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "read_file",
                    "description": "读取文件内容",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "path": {
                                "type": "string",
                                "description": "相对路径",
                            },
                        },
                        "required": ["path"],
                    },
                },
            },
        ]

    def _parse_response(self, response_text: str) -> list[FieldLineage] | None:
        """解析 LLM 响应。"""
        # 提取 JSON
        json_str = self._extract_json(response_text)

        if json_str:
            try:
                data = json.loads(json_str)
                validated = FieldLineageListResponse.model_validate(data)

                # 转换为内部数据结构
                return [
                    FieldLineage(
                        from_entity=l.from_entity,
                        from_field=l.from_field,
                        to_entity=l.to_entity,
                        to_field=l.to_field,
                        flow_type=l.flow_type,
                        flow_pattern=l.flow_pattern,
                        transformation=l.transformation,
                        condition=l.condition,
                        intermediate_methods=l.intermediate_methods,
                        description=l.description,
                    )
                    for l in validated.field_lineages
                ]
            except (json.JSONDecodeError, ValidationError) as e:
                logger.warning("解析字段血缘响应失败: %s", e)

        return None

    def _extract_json(self, text: str) -> str | None:
        """从响应文本中提取 JSON。"""
        text = text.strip()

        # 尝试直接解析
        if text.startswith("{"):
            return text

        # 查找 JSON 代码块
        match = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
        if match:
            return match.group(1).strip()

        # 查找花括号
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1 and end > start:
            return text[start:end + 1]

        return None

    def _count_flow_types(self, lineages: list[FieldLineage]) -> dict[str, int]:
        """统计流转类型。"""
        counts: dict[str, int] = {}
        for l in lineages:
            counts[l.flow_type] = counts.get(l.flow_type, 0) + 1
        return counts

    def _count_flow_patterns(self, lineages: list[FieldLineage]) -> dict[str, int]:
        """统计流转模式。"""
        counts: dict[str, int] = {}
        for l in lineages:
            if l.flow_pattern:
                counts[l.flow_pattern] = counts.get(l.flow_pattern, 0) + 1
        return counts
