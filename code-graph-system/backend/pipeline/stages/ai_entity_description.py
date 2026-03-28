"""Stage 4: AI 实体描述 — 生成实体、字段、流程的业务语义描述。

扩展原有 AIDescriptionStage，支持 AI 优先流水线的需求：
- 实体描述：功能摘要、作用、核心字段、重要性评分
- 字段描述：字段含义、业务语义、使用场景
- 流程描述：执行逻辑、触发类型、相关实体
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from pydantic import BaseModel, Field, ValidationError

from backend.llm.client import LLMClient
from backend.models.ai_first_analysis import (
    EntityAnalysisResult,
    FieldInfo,
    EntityDescription,
    FieldDescription,
    FlowDescription,
    DescriptionResult,
)
from backend.pipeline.observer import AnalysisObserver, StageStarted, StageCompleted
from backend.pipeline.stages.base import StageBase

logger = logging.getLogger(__name__)

# 并发配置
DEFAULT_CONCURRENCY = int(os.getenv("AI_DESCRIPTION_CONCURRENCY", "3"))
MAX_RETRIES = 2


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic 输出模型
# ─────────────────────────────────────────────────────────────────────────────


class EntityDescriptionResponse(BaseModel):
    """实体描述响应模型。"""

    entity_name: str = Field(description="实体名")
    summary: str = Field(description="功能摘要（50-100字）")
    role_in_system: str = Field(description="在系统中的作用")
    core_fields: list[str] = Field(default_factory=list, description="核心字段列表")
    importance_score: int = Field(default=5, ge=1, le=10, description="重要性评分")
    importance_reason: str = Field(default="", description="重要性原因")
    business_domain: str = Field(default="", description="业务领域")
    business_value: str = Field(default="", description="业务价值")


class FieldDescriptionResponse(BaseModel):
    """字段描述响应模型。"""

    entity_name: str = Field(description="所属实体")
    field_name: str = Field(description="字段名")
    description: str = Field(description="字段含义描述")
    business_meaning: str = Field(default="", description="业务含义")
    usage_scenario: str = Field(default="", description="使用场景")
    data_pattern: str = Field(default="", description="数据模式")


class FlowDescriptionResponse(BaseModel):
    """流程描述响应模型。"""

    flow_name: str = Field(description="流程名")
    summary: str = Field(description="功能摘要")
    execution_logic: str = Field(description="执行逻辑说明")
    trigger_type: str = Field(default="", description="触发类型")
    typical_duration: str = Field(default="", description="典型执行时长")
    related_entities: list[str] = Field(default_factory=list, description="相关实体")
    related_services: list[str] = Field(default_factory=list, description="相关服务")


# ─────────────────────────────────────────────────────────────────────────────
# Prompt 模板
# ─────────────────────────────────────────────────────────────────────────────


ENTITY_SYSTEM_PROMPT = """你是一个业务文档专家。你的任务是为实体生成业务语义描述。

## 任务目标

1. **生成实体功能摘要**（50-100字）
   - 描述实体的主要功能
   - 说明在系统中的作用

2. **列出核心字段**（3-5个）
   - 选择最重要的字段
   - 优先选择业务关键字段

3. **评估实体重要性**（1-10分）
   - 10分：核心枢纽节点，连接多个关键实体
   - 8-9分：重要业务实体，有复杂关联
   - 6-7分：中等重要实体
   - 4-5分：辅助实体
   - 1-3分：边缘实体

## 输出格式

输出必须是合法的 JSON，格式如下：
{
  "entity_name": "FlowJob",
  "summary": "流程作业实体，记录作业执行的完整生命周期，包括名称、状态、进度、关联策略等。",
  "role_in_system": "所有作业类型的汇聚点，是任务执行的统一入口",
  "core_fields": ["name", "status", "progress", "policyUuid", "processId"],
  "importance_score": 9,
  "importance_reason": "核心枢纽节点，连接策略、剧本、任务三个关键实体",
  "business_domain": "作业调度",
  "business_value": "支撑所有检测、备份、恢复等作业的执行"
}

只输出 JSON，不要其他解释。"""


ENTITY_USER_TEMPLATE = """请为以下实体生成业务语义描述。

实体名称: {entity_name}
表名: {table_name}
主键: {primary_key}

字段列表:
{fields}

关系列表:
{relationships}

请输出 JSON 格式的描述。"""


FIELD_SYSTEM_PROMPT = """你是一个业务文档专家。你的任务是为字段生成业务语义描述。

## 任务目标

1. **字段含义描述**：说明字段存储什么数据
2. **业务含义**：说明字段在业务中的作用
3. **使用场景**：说明字段在哪些场景下使用
4. **数据模式**：说明字段的数据特征（如 UUID、时间戳、枚举值等）

## 输出格式

输出必须是合法的 JSON 数组，格式如下：
[
  {
    "entity_name": "AdmsApplication",
    "field_name": "businessUuid",
    "description": "关联的业务UUID",
    "business_meaning": "确定应用归属的业务线",
    "usage_scenario": "创建应用时关联业务，查询应用时按业务筛选",
    "data_pattern": "UUID格式，外键引用"
  }
]

只输出 JSON，不要其他解释。"""


FLOW_SYSTEM_PROMPT = """你是一个流程分析专家。你的任务是为流程生成描述。

## 任务目标

1. **功能摘要**：描述流程的主要功能
2. **执行逻辑**：描述流程的执行步骤
3. **触发类型**：manual / scheduled / event / api
4. **相关实体和服务**：列出相关的实体和服务

## 输出格式

输出必须是合法的 JSON，格式如下：
{
  "flow_name": "Playbook",
  "summary": "流程剧本定义，包含作业执行的完整流程",
  "execution_logic": "策略触发 → 创建作业实例 → 分配任务节点 → 并行执行 → 汇总结果",
  "trigger_type": "scheduled",
  "typical_duration": "几分钟到几小时不等",
  "related_entities": ["FlowJob", "JobTask", "Policy"],
  "related_services": ["JobService", "TaskExecutor"]
}

只输出 JSON，不要其他解释。"""


# ─────────────────────────────────────────────────────────────────────────────
# AIEntityDescriptionStage
# ─────────────────────────────────────────────────────────────────────────────


class AIEntityDescriptionStage(StageBase):
    """Stage 4: AI 实体描述。

    为实体、字段、流程生成业务语义描述。
    """

    name = "ai_entity_description"

    def __init__(
        self,
        max_concurrency: int = DEFAULT_CONCURRENCY,
        max_retries: int = MAX_RETRIES,
        max_tokens: int = 2000,
        temperature: float = 0.1,
    ):
        """
        Args:
            max_concurrency: 最大并发数
            max_retries: 输出校验失败时的最大重试次数
            max_tokens: LLM 最大 token 数
            temperature: LLM 温度参数
        """
        self.max_concurrency = max_concurrency
        self.max_retries = max_retries
        self.max_tokens = max_tokens
        self.temperature = temperature

    def run(
        self,
        repo_path: Path,
        entity_results: list[EntityAnalysisResult],
        llm_client: LLMClient,
        observer: AnalysisObserver | None = None,
        on_progress: Callable[[dict], None] | None = None,
    ) -> DescriptionResult:
        """执行 AI 描述生成。

        Args:
            repo_path: 仓库根目录
            entity_results: 实体分析结果列表
            llm_client: LLM 客户端
            observer: 事件观察器
            on_progress: 进度回调

        Returns:
            DescriptionResult: 描述生成结果
        """
        start_time = time.time()

        # 发送开始事件
        if observer:
            observer.emit(StageStarted.create("ai_entity_description", file_count=len(entity_results)))

        if on_progress:
            on_progress({
                "step": "ai_entity_description",
                "status": "start",
                "message": f"AI 生成描述...",
            })

        # 并行生成实体描述
        entity_descriptions = self._generate_entity_descriptions(
            repo_path, entity_results, llm_client
        )

        # 生成字段描述（批量）
        field_descriptions = self._generate_field_descriptions(
            repo_path, entity_results, llm_client
        )

        elapsed_ms = int((time.time() - start_time) * 1000)

        # 发送完成事件
        if observer:
            observer.emit(StageCompleted.create("ai_entity_description", elapsed_ms, cache_hit=False))

        # 统计信息
        stats = {
            "entity_descriptions": len(entity_descriptions),
            "field_descriptions": len(field_descriptions),
            "elapsed_ms": elapsed_ms,
        }

        logger.info(
            "[ai_entity_description] 完成: %d 实体描述, %d 字段描述, 耗时 %dms",
            len(entity_descriptions),
            len(field_descriptions),
            elapsed_ms,
        )

        if on_progress:
            on_progress({
                "step": "ai_entity_description",
                "status": "complete",
                "message": f"描述生成完成: {len(entity_descriptions)} 实体",
                **stats,
            })

        return DescriptionResult(
            entity_descriptions=entity_descriptions,
            field_descriptions=field_descriptions,
            stats=stats,
        )

    def _generate_entity_descriptions(
        self,
        repo_path: Path,
        entity_results: list[EntityAnalysisResult],
        llm_client: LLMClient,
    ) -> list[EntityDescription]:
        """并行生成实体描述。"""
        results: list[EntityDescription] = []

        with ThreadPoolExecutor(max_workers=self.max_concurrency) as executor:
            future_to_entity = {
                executor.submit(
                    self._generate_single_entity_description,
                    repo_path,
                    entity,
                    llm_client,
                ): entity
                for entity in entity_results
            }

            for future in as_completed(future_to_entity):
                entity = future_to_entity[future]
                try:
                    result = future.result()
                    if result:
                        results.append(result)
                except Exception as e:
                    logger.warning("生成实体描述失败 %s: %s", entity.entity_name, e)

        return results

    def _generate_single_entity_description(
        self,
        repo_path: Path,
        entity: EntityAnalysisResult,
        llm_client: LLMClient,
    ) -> EntityDescription | None:
        """生成单个实体描述。"""
        # 构建字段摘要
        fields_str = "\n".join([
            f"- {f.name} ({f.type}): {f.description or '无描述'}"
            for f in entity.fields[:15]
        ])

        # 构建关系摘要
        rels_str = "\n".join([
            f"- {r.relation_type} -> {r.target_entity}: {r.description or '无描述'}"
            for r in entity.relationships[:10]
        ])

        # 构建 prompt
        user_prompt = ENTITY_USER_TEMPLATE.format(
            entity_name=entity.entity_name,
            table_name=entity.table_name,
            primary_key=entity.primary_key,
            fields=fields_str,
            relationships=rels_str,
        )

        # 定义工具
        tools = self._build_tools(repo_path)

        # 构建消息
        messages = [{"role": "user", "content": user_prompt}]

        # 调用 LLM
        for attempt in range(self.max_retries + 1):
            try:
                result = llm_client.tool_call_loop(
                    system=ENTITY_SYSTEM_PROMPT,
                    messages=messages,
                    tools=tools,
                    max_iterations=5,
                    temperature=self.temperature,
                    max_tokens=self.max_tokens,
                )

                if result.status == "completed" and result.final_message:
                    parsed = self._parse_entity_description(result.final_message, entity)
                    if parsed:
                        return parsed

            except Exception as e:
                logger.warning("生成实体描述失败 (attempt %d) %s: %s", attempt, entity.entity_name, e)

        return None

    def _generate_field_descriptions(
        self,
        repo_path: Path,
        entity_results: list[EntityAnalysisResult],
        llm_client: LLMClient,
    ) -> list[FieldDescription]:
        """批量生成字段描述。"""
        # 收集所有字段
        all_fields: list[tuple[str, FieldInfo]] = []
        for entity in entity_results:
            for field in entity.fields:
                all_fields.append((entity.entity_name, field))

        if not all_fields:
            return []

        # 分批处理
        batch_size = 15
        results: list[FieldDescription] = []

        for i in range(0, len(all_fields), batch_size):
            batch = all_fields[i:i + batch_size]

            # 构建 prompt
            fields_str = "\n".join([
                f"- {entity_name}.{field.name} ({field.type}): {field.description or '无描述'}"
                for entity_name, field in batch
            ])

            user_prompt = f"""请为以下字段生成业务语义描述。

字段列表:
{fields_str}

请输出 JSON 数组格式的描述。"""

            # 定义工具
            tools = self._build_tools(repo_path)

            # 构建消息
            messages = [{"role": "user", "content": user_prompt}]

            # 调用 LLM
            try:
                result = llm_client.tool_call_loop(
                    system=FIELD_SYSTEM_PROMPT,
                    messages=messages,
                    tools=tools,
                    max_iterations=5,
                    temperature=self.temperature,
                    max_tokens=self.max_tokens * 2,
                )

                if result.status == "completed" and result.final_message:
                    parsed = self._parse_field_descriptions(result.final_message)
                    if parsed:
                        results.extend(parsed)

            except Exception as e:
                logger.warning("批量生成字段描述失败: %s", e)

        return results

    def _build_tools(self, repo_path: Path) -> list[dict]:
        """构建 LLM 工具定义。"""
        return [
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

    def _parse_entity_description(
        self,
        response_text: str,
        entity: EntityAnalysisResult,
    ) -> EntityDescription | None:
        """解析实体描述响应。"""
        json_str = self._extract_json(response_text)

        if json_str:
            try:
                data = json.loads(json_str)
                validated = EntityDescriptionResponse.model_validate(data)

                return EntityDescription(
                    entity_name=validated.entity_name,
                    summary=validated.summary,
                    role_in_system=validated.role_in_system,
                    core_fields=validated.core_fields,
                    importance_score=validated.importance_score,
                    importance_reason=validated.importance_reason,
                    business_domain=validated.business_domain,
                    business_value=validated.business_value,
                )
            except (json.JSONDecodeError, ValidationError) as e:
                logger.warning("解析实体描述响应失败 %s: %s", entity.entity_name, e)

        return None

    def _parse_field_descriptions(
        self,
        response_text: str,
    ) -> list[FieldDescription] | None:
        """解析字段描述响应。"""
        json_str = self._extract_json(response_text)

        if json_str:
            try:
                data = json.loads(json_str)
                if isinstance(data, list):
                    results = []
                    for item in data:
                        try:
                            validated = FieldDescriptionResponse.model_validate(item)
                            results.append(FieldDescription(
                                entity_name=validated.entity_name,
                                field_name=validated.field_name,
                                description=validated.description,
                                business_meaning=validated.business_meaning,
                                usage_scenario=validated.usage_scenario,
                                data_pattern=validated.data_pattern,
                            ))
                        except ValidationError:
                            continue
                    return results
            except json.JSONDecodeError as e:
                logger.warning("解析字段描述响应失败: %s", e)

        return None

    def _extract_json(self, text: str) -> str | None:
        """从响应文本中提取 JSON。"""
        text = text.strip()

        # 尝试直接解析
        if text.startswith("{") or text.startswith("["):
            return text

        # 查找 JSON 代码块
        match = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
        if match:
            return match.group(1).strip()

        # 查找花括号或方括号
        if "{" in text:
            start = text.find("{")
            end = text.rfind("}")
            if end > start:
                return text[start:end + 1]

        if "[" in text:
            start = text.find("[")
            end = text.rfind("]")
            if end > start:
                return text[start:end + 1]

        return None
