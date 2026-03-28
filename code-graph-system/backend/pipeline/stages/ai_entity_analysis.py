"""Stage 2: AI 实体分析 — 分析每个实体的字段、注解、关系。

对每个实体候选进行深入分析，识别字段、注解、关系等信息。
支持并行处理多个实体。

特点：
- 并行处理实体（ThreadPoolExecutor）
- Pydantic 约束输出
- 失败重试机制
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Callable

from pydantic import BaseModel, Field, ValidationError

from backend.llm.client import LLMClient
from backend.models.ai_first_analysis import (
    EntityCandidate,
    EntityAnalysisResult,
    FieldInfo,
    RelationshipInfo,
)
from backend.pipeline.observer import AnalysisObserver, StageStarted, StageCompleted
from backend.pipeline.stages.base import StageBase

logger = logging.getLogger(__name__)

# 并发配置
DEFAULT_CONCURRENCY = int(os.getenv("AI_ENTITY_CONCURRENCY", "3"))
MAX_RETRIES = 2


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic 输出模型
# ─────────────────────────────────────────────────────────────────────────────


class FieldInfoResponse(BaseModel):
    """字段信息响应模型。"""

    name: str = Field(description="字段名")
    type: str = Field(description="字段类型")
    column_name: str | None = Field(default=None, description="数据库列名")
    is_primary_key: bool = Field(default=False, description="是否主键")
    is_foreign_key: bool = Field(default=False, description="是否外键")
    is_nullable: bool = Field(default=True, description="是否可空")
    references_entity: str | None = Field(default=None, description="引用的实体名")
    references_field: str | None = Field(default=None, description="引用的字段名")
    description: str = Field(default="", description="字段描述")


class RelationshipInfoResponse(BaseModel):
    """关系信息响应模型。"""

    relation_type: str = Field(description="关系类型：one_to_one / one_to_many / many_to_one / many_to_many")
    target_entity: str = Field(description="目标实体名")
    source_field: str | None = Field(default=None, description="源字段")
    target_field: str | None = Field(default=None, description="目标字段")
    join_table: str | None = Field(default=None, description="中间表名")
    join_column: str | None = Field(default=None, description="join 列名")
    description: str = Field(default="", description="关系描述")


class EntityAnalysisResponse(BaseModel):
    """实体分析响应模型。"""

    entity_name: str = Field(description="实体名")
    table_name: str = Field(description="表名")
    primary_key: str = Field(description="主键字段")
    fields: list[FieldInfoResponse] = Field(default_factory=list, description="字段列表")
    relationships: list[RelationshipInfoResponse] = Field(default_factory=list, description="关系列表")


# ─────────────────────────────────────────────────────────────────────────────
# Prompt 模板
# ─────────────────────────────────────────────────────────────────────────────


SYSTEM_PROMPT = """你是一个 JPA 实体分析专家。你的任务是分析实体类的完整结构。

## 任务目标

1. **识别所有字段及其类型**
   - 分析类中的字段定义
   - 提取字段类型（String, Integer, List 等）

2. **识别字段的数据库列映射**
   - @Column 注解的 name 属性
   - 默认列名规则（驼峰转下划线）

3. **识别实体关系**
   - @OneToOne: 一对一关系
   - @OneToMany: 一对多关系
   - @ManyToOne: 多对一关系
   - @ManyToMany: 多对多关系

4. **识别外键字段和引用目标**
   - @JoinColumn 注解
   - 外键引用的实体和字段

5. **识别中间关系表**
   - @JoinTable 注解
   - 多对多关系的中间表

## 输出格式

输出必须是合法的 JSON，格式如下：
{
  "entity_name": "AdmsApplication",
  "table_name": "adms_application",
  "primary_key": "uuid",
  "fields": [
    {
      "name": "name",
      "type": "String",
      "column_name": "name",
      "is_primary_key": false,
      "is_foreign_key": false,
      "description": "应用名称"
    },
    {
      "name": "businessUuid",
      "type": "String",
      "column_name": "business_uuid",
      "is_foreign_key": true,
      "references_entity": "AdmsBusiness",
      "references_field": "uuid",
      "description": "关联的业务UUID"
    }
  ],
  "relationships": [
    {
      "relation_type": "one_to_one",
      "target_entity": "AdmsBusiness",
      "source_field": "businessUuid",
      "target_field": "uuid",
      "description": "应用归属业务"
    }
  ]
}

只输出 JSON，不要其他解释。"""


USER_PROMPT_TEMPLATE = """请分析以下实体类的完整结构。

实体名称: {entity_name}
文件路径: {file_path}
表名: {table_name}
主键: {primary_key}

请阅读实体类代码，分析字段和关系。"""


# ─────────────────────────────────────────────────────────────────────────────
# AIEntityAnalysisStage
# ─────────────────────────────────────────────────────────────────────────────


class AIEntityAnalysisStage(StageBase):
    """Stage 2: AI 实体分析。

    并行处理每个实体候选，分析字段和关系。
    """

    name = "ai_entity_analysis"

    def __init__(
        self,
        max_concurrency: int = DEFAULT_CONCURRENCY,
        max_retries: int = MAX_RETRIES,
        max_tokens: int = 4000,
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
        candidates: list[EntityCandidate],
        llm_client: LLMClient,
        observer: AnalysisObserver | None = None,
        on_progress: Callable[[dict], None] | None = None,
    ) -> tuple[list[EntityAnalysisResult], list[str]]:
        """执行 AI 实体分析。

        Args:
            repo_path: 仓库根目录
            candidates: 实体候选列表
            llm_client: LLM 客户端
            observer: 事件观察器
            on_progress: 进度回调

        Returns:
            (分析结果列表, 失败的实体ID列表)
        """
        start_time = time.time()

        # 发送开始事件
        if observer:
            observer.emit(StageStarted.create("ai_entity_analysis", file_count=len(candidates)))

        if on_progress:
            on_progress({
                "step": "ai_entity_analysis",
                "status": "start",
                "message": f"AI 分析 {len(candidates)} 个实体...",
            })

        # 并行处理实体
        results: list[EntityAnalysisResult] = []
        failed_entities: list[str] = []

        with ThreadPoolExecutor(max_workers=self.max_concurrency) as executor:
            future_to_candidate = {
                executor.submit(
                    self._analyze_single_entity,
                    repo_path,
                    candidate,
                    llm_client,
                ): candidate
                for candidate in candidates
            }

            completed = 0
            for future in as_completed(future_to_candidate):
                candidate = future_to_candidate[future]
                try:
                    result = future.result()
                    results.append(result)
                    completed += 1

                    if on_progress and completed % 5 == 0:
                        on_progress({
                            "step": "ai_entity_analysis",
                            "status": "progress",
                            "message": f"已完成 {completed}/{len(candidates)} 个实体",
                            "completed": completed,
                            "total": len(candidates),
                        })

                except Exception as e:
                    logger.warning("实体分析失败 %s: %s", candidate.class_name, e)
                    failed_entities.append(candidate.class_name)

        elapsed_ms = int((time.time() - start_time) * 1000)

        # 发送完成事件
        if observer:
            observer.emit(StageCompleted.create("ai_entity_analysis", elapsed_ms, cache_hit=False))

        logger.info(
            "[ai_entity_analysis] 完成: %d 成功, %d 失败, 耗时 %dms",
            len(results),
            len(failed_entities),
            elapsed_ms,
        )

        if on_progress:
            on_progress({
                "step": "ai_entity_analysis",
                "status": "complete",
                "message": f"实体分析完成: {len(results)} 成功",
                "success_count": len(results),
                "failed_count": len(failed_entities),
            })

        return results, failed_entities

    def _analyze_single_entity(
        self,
        repo_path: Path,
        candidate: EntityCandidate,
        llm_client: LLMClient,
    ) -> EntityAnalysisResult:
        """分析单个实体。"""
        # 构建 prompt
        user_prompt = USER_PROMPT_TEMPLATE.format(
            entity_name=candidate.class_name,
            file_path=candidate.file_path,
            table_name=candidate.table_name or "unknown",
            primary_key=candidate.primary_key or "unknown",
        )

        # 定义工具
        tools = self._build_tools(repo_path)

        # 构建消息
        messages = [{"role": "user", "content": user_prompt}]

        # 调用 LLM
        for attempt in range(self.max_retries + 1):
            try:
                result = llm_client.tool_call_loop(
                    system=SYSTEM_PROMPT,
                    messages=messages,
                    tools=tools,
                    max_iterations=10,
                    temperature=self.temperature,
                    max_tokens=self.max_tokens,
                )

                if result.status == "completed" and result.final_message:
                    # 解析响应
                    parsed = self._parse_response(result.final_message, candidate)
                    if parsed:
                        return parsed

            except Exception as e:
                logger.warning("实体分析失败 (attempt %d) %s: %s", attempt, candidate.class_name, e)

        # 返回默认结果
        return EntityAnalysisResult(
            entity_name=candidate.class_name,
            file_path=candidate.file_path,
            table_name=candidate.table_name or "",
            primary_key=candidate.primary_key or "",
        )

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
        ]

    def _parse_response(
        self,
        response_text: str,
        candidate: EntityCandidate,
    ) -> EntityAnalysisResult | None:
        """解析 LLM 响应。"""
        # 提取 JSON
        json_str = self._extract_json(response_text)

        if json_str:
            try:
                data = json.loads(json_str)
                validated = EntityAnalysisResponse.model_validate(data)

                # 转换为内部数据结构
                return EntityAnalysisResult(
                    entity_name=validated.entity_name,
                    file_path=candidate.file_path,
                    table_name=validated.table_name,
                    primary_key=validated.primary_key,
                    fields=[
                        FieldInfo(
                            name=f.name,
                            type=f.type,
                            column_name=f.column_name,
                            is_primary_key=f.is_primary_key,
                            is_foreign_key=f.is_foreign_key,
                            is_nullable=f.is_nullable,
                            references_entity=f.references_entity,
                            references_field=f.references_field,
                            description=f.description,
                        )
                        for f in validated.fields
                    ],
                    relationships=[
                        RelationshipInfo(
                            relation_type=r.relation_type,
                            target_entity=r.target_entity,
                            source_field=r.source_field,
                            target_field=r.target_field,
                            join_table=r.join_table,
                            join_column=r.join_column,
                            description=r.description,
                        )
                        for r in validated.relationships
                    ],
                )
            except (json.JSONDecodeError, ValidationError) as e:
                logger.warning("解析实体响应失败 %s: %s", candidate.class_name, e)

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
