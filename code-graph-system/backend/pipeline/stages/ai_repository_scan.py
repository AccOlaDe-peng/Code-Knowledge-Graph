"""Stage 1: AI 仓库扫描 — 探索仓库结构，识别实体、流程、服务等。

AI 主动探索代码仓库，使用工具（list_directory, search_code, read_file）
识别所有关键的结构元素，输出结构化的候选列表。

特点：
- 单次 LLM 调用完成仓库扫描
- AI 主动使用工具探索代码
- 输出 Pydantic 约束的结构化数据
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Any, Callable

from pydantic import BaseModel, Field, ValidationError

from backend.llm.client import LLMClient
from backend.models.ai_first_analysis import (
    EntityCandidate,
    FlowCandidate,
    FlowNodeCandidate,
    ServiceCandidate,
    RepositoryCandidate,
    TopicCandidate,
    RepositoryScanResult,
)
from backend.pipeline.observer import AnalysisObserver, StageStarted, StageCompleted
from backend.pipeline.stages.base import StageBase

logger = logging.getLogger(__name__)

# 重试配置
MAX_RETRIES = 2


# ─────────────────────────────────────────────────────────────────────────────
# Pydantic 输出模型
# ─────────────────────────────────────────────────────────────────────────────


class EntityCandidateResponse(BaseModel):
    """实体候选响应模型。"""

    class_name: str = Field(description="类名")
    file_path: str = Field(description="文件路径")
    table_name: str | None = Field(default=None, description="表名")
    primary_key: str | None = Field(default=None, description="主键字段名")
    brief_description: str = Field(default="", description="简要描述")


class FlowCandidateResponse(BaseModel):
    """流程候选响应模型。"""

    class_name: str = Field(description="类名")
    file_path: str = Field(description="文件路径")
    flow_type: str = Field(default="flow", description="流程类型")
    key: str | None = Field(default=None, description="流程关键字")
    brief_description: str = Field(default="", description="简要描述")


class FlowNodeCandidateResponse(BaseModel):
    """流程节点候选响应模型。"""

    class_name: str = Field(description="类名")
    file_path: str = Field(description="文件路径")
    node_type: str = Field(default="node", description="节点类型")
    parent_flow: str | None = Field(default=None, description="所属流程")
    brief_description: str = Field(default="", description="简要描述")


class ServiceCandidateResponse(BaseModel):
    """服务候选响应模型。"""

    class_name: str = Field(description="类名")
    file_path: str = Field(description="文件路径")
    service_type: str = Field(default="service", description="服务类型")
    annotations: list[str] = Field(default_factory=list, description="注解列表")
    brief_description: str = Field(default="", description="简要描述")


class RepositoryCandidateResponse(BaseModel):
    """Repository 候选响应模型。"""

    class_name: str = Field(description="类名")
    file_path: str = Field(description="文件路径")
    entity_type: str | None = Field(default=None, description="关联的实体类型")
    brief_description: str = Field(default="", description="简要描述")


class TopicCandidateResponse(BaseModel):
    """消息主题候选响应模型。"""

    name: str = Field(description="Topic 名称")
    source_file: str = Field(description="定义位置")
    source_element: str = Field(description="定义元素")
    topic_type: str = Field(default="kafka", description="消息队列类型")
    pattern: str = Field(default="unknown", description="模式")
    brief_description: str = Field(default="", description="简要描述")


class RepositoryScanResponse(BaseModel):
    """仓库扫描响应模型。"""

    entities: list[EntityCandidateResponse] = Field(default_factory=list, description="实体列表")
    flows: list[FlowCandidateResponse] = Field(default_factory=list, description="流程列表")
    flow_nodes: list[FlowNodeCandidateResponse] = Field(default_factory=list, description="流程节点列表")
    services: list[ServiceCandidateResponse] = Field(default_factory=list, description="服务列表")
    repositories: list[RepositoryCandidateResponse] = Field(default_factory=list, description="Repository 列表")
    topics: list[TopicCandidateResponse] = Field(default_factory=list, description="消息主题列表")


# ─────────────────────────────────────────────────────────────────────────────
# Prompt 模板
# ─────────────────────────────────────────────────────────────────────────────


SYSTEM_PROMPT = """你是一个代码结构分析专家。你的任务是探索代码仓库，识别所有关键的结构元素。

## 任务目标

1. **识别 JPA 实体类**
   - 搜索 @Entity 注解
   - 提取类名、文件路径、表名（@Table）、主键（@Id）

2. **识别流程定义类**
   - 搜索 Flow, Playbook, Workflow 等关键词
   - 提取流程名称、关键字、类型

3. **识别业务服务类**
   - 搜索 @Service, @Component, @Controller 等注解
   - 提取类名、文件路径、注解列表

4. **识别 Repository 类**
   - 搜索 @Repository 注解或 extends JpaRepository
   - 提取类名、关联的实体类型

5. **识别消息主题定义**
   - 搜索 @KafkaListener, KafkaTemplate
   - 提取 topic 名称、生产者/消费者信息

## 探索策略

1. 先使用 list_directory 了解目录结构
2. 使用 search_code 搜索关键注解
3. 使用 read_file 阅读具体文件确认

## 输出格式

输出必须是合法的 JSON，格式如下：
{
  "entities": [
    {
      "class_name": "AdmsApplication",
      "file_path": "adms-core/src/main/java/com/example/entity/AdmsApplication.java",
      "table_name": "adms_application",
      "primary_key": "uuid",
      "brief_description": "在线应用管理实体"
    }
  ],
  "flows": [...],
  "flow_nodes": [...],
  "services": [...],
  "repositories": [...],
  "topics": [...]
}

只输出 JSON，不要其他解释。"""


USER_PROMPT_TEMPLATE = """请探索以下代码仓库，识别所有关键的结构元素。

仓库路径: {repo_path}

{additional_context}

请使用工具探索代码结构，然后输出 JSON 格式的分析结果。"""


# ─────────────────────────────────────────────────────────────────────────────
# AIRepositoryScanStage
# ─────────────────────────────────────────────────────────────────────────────


class AIRepositoryScanStage(StageBase):
    """Stage 1: AI 仓库扫描。

    使用 AI 主动探索代码仓库，识别实体、流程、服务等结构元素。
    """

    name = "ai_repository_scan"

    def __init__(
        self,
        max_retries: int = MAX_RETRIES,
        max_tokens: int = 8000,
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
        llm_client: LLMClient,
        observer: AnalysisObserver | None = None,
        on_progress: Callable[[dict], None] | None = None,
    ) -> RepositoryScanResult:
        """执行 AI 仓库扫描。

        Args:
            repo_path: 仓库根目录
            llm_client: LLM 客户端
            observer: 事件观察器
            on_progress: 进度回调

        Returns:
            RepositoryScanResult: 扫描结果
        """
        start_time = time.time()

        # 发送开始事件
        if observer:
            observer.emit(StageStarted.create("ai_repository_scan", file_count=0))

        if on_progress:
            on_progress({
                "step": "ai_repository_scan",
                "status": "start",
                "message": "AI 探索仓库结构...",
            })

        # 构建上下文
        additional_context = self._build_additional_context(repo_path)

        # 构建 prompt
        user_prompt = USER_PROMPT_TEMPLATE.format(
            repo_path=str(repo_path),
            additional_context=additional_context,
        )

        # 调用 LLM（支持 tool call）
        response = self._call_llm_with_tools(
            llm_client=llm_client,
            repo_path=repo_path,
            user_prompt=user_prompt,
        )

        # 解析响应
        result = self._parse_response(response, repo_path)

        elapsed_ms = int((time.time() - start_time) * 1000)

        # 发送完成事件
        if observer:
            observer.emit(StageCompleted.create("ai_repository_scan", elapsed_ms, cache_hit=False))

        # 统计信息
        stats = {
            "entity_count": len(result.entities),
            "flow_count": len(result.flows),
            "service_count": len(result.services),
            "repository_count": len(result.repositories),
            "topic_count": len(result.topics),
            "elapsed_ms": elapsed_ms,
        }
        result.stats = stats

        logger.info(
            "[ai_repository_scan] 完成: %d 实体, %d 流程, %d 服务, %d Repository, %d Topic",
            len(result.entities),
            len(result.flows),
            len(result.services),
            len(result.repositories),
            len(result.topics),
        )

        if on_progress:
            on_progress({
                "step": "ai_repository_scan",
                "status": "complete",
                "message": f"仓库扫描完成: {len(result.entities)} 实体, {len(result.services)} 服务",
                **stats,
            })

        return result

    def _build_additional_context(self, repo_path: Path) -> str:
        """构建额外上下文信息。"""
        contexts = []

        # 检测项目类型
        if (repo_path / "pom.xml").exists():
            contexts.append("- 这是一个 Maven 项目")
        if (repo_path / "build.gradle").exists():
            contexts.append("- 这是一个 Gradle 项目")
        if (repo_path / "package.json").exists():
            contexts.append("- 这是一个 Node.js 项目")

        # 检测常见目录结构
        src_main_java = repo_path / "src" / "main" / "java"
        if src_main_java.exists():
            contexts.append(f"- Java 源码目录: src/main/java/")

        if contexts:
            return "\n检测到的项目信息:\n" + "\n".join(contexts)
        return ""

    def _call_llm_with_tools(
        self,
        llm_client: LLMClient,
        repo_path: Path,
        user_prompt: str,
    ) -> str:
        """调用 LLM（支持 tool call）。"""
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
                    max_iterations=20,
                )

                if result.status == "completed" and result.final_message:
                    return result.final_message

                logger.warning("LLM 调用未完成 (attempt %d): %s", attempt, result.status)

            except Exception as e:
                logger.warning("LLM 调用失败 (attempt %d): %s", attempt, e)

        # 失败时返回空结果
        return '{"entities": [], "flows": [], "flow_nodes": [], "services": [], "repositories": [], "topics": []}'

    def _build_tools(self, repo_path: Path) -> list[dict]:
        """构建 LLM 工具定义。"""
        return [
            {
                "type": "function",
                "function": {
                    "name": "list_directory",
                    "description": "列出目录内容",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "path": {
                                "type": "string",
                                "description": "相对路径（相对于仓库根目录）",
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
                                "description": "搜索模式（支持正则表达式）",
                            },
                            "file_pattern": {
                                "type": "string",
                                "description": "文件名模式（如 *.java）",
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
                            "start_line": {
                                "type": "integer",
                                "description": "起始行号",
                            },
                            "end_line": {
                                "type": "integer",
                                "description": "结束行号",
                            },
                        },
                        "required": ["path"],
                    },
                },
            },
        ]

    def _parse_response(self, response_text: str, repo_path: Path) -> RepositoryScanResult:
        """解析 LLM 响应。"""
        # 提取 JSON
        json_str = self._extract_json(response_text)

        if json_str:
            try:
                data = json.loads(json_str)
                validated = RepositoryScanResponse.model_validate(data)

                # 转换为内部数据结构
                return RepositoryScanResult(
                    entities=[
                        EntityCandidate(
                            class_name=e.class_name,
                            file_path=e.file_path,
                            table_name=e.table_name,
                            primary_key=e.primary_key,
                            brief_description=e.brief_description,
                        )
                        for e in validated.entities
                    ],
                    flows=[
                        FlowCandidate(
                            class_name=f.class_name,
                            file_path=f.file_path,
                            flow_type=f.flow_type,
                            key=f.key,
                            brief_description=f.brief_description,
                        )
                        for f in validated.flows
                    ],
                    flow_nodes=[
                        FlowNodeCandidate(
                            class_name=n.class_name,
                            file_path=n.file_path,
                            node_type=n.node_type,
                            parent_flow=n.parent_flow,
                            brief_description=n.brief_description,
                        )
                        for n in validated.flow_nodes
                    ],
                    services=[
                        ServiceCandidate(
                            class_name=s.class_name,
                            file_path=s.file_path,
                            service_type=s.service_type,
                            annotations=s.annotations,
                            brief_description=s.brief_description,
                        )
                        for s in validated.services
                    ],
                    repositories=[
                        RepositoryCandidate(
                            class_name=r.class_name,
                            file_path=r.file_path,
                            entity_type=r.entity_type,
                            brief_description=r.brief_description,
                        )
                        for r in validated.repositories
                    ],
                    topics=[
                        TopicCandidate(
                            name=t.name,
                            source_file=t.source_file,
                            source_element=t.source_element,
                            topic_type=t.topic_type,
                            pattern=t.pattern,
                            brief_description=t.brief_description,
                        )
                        for t in validated.topics
                    ],
                )
            except (json.JSONDecodeError, ValidationError) as e:
                logger.warning("解析响应失败: %s", e)

        # 返回空结果
        return RepositoryScanResult()

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
