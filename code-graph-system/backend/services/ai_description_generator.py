"""
AI 描述生成服务。

使用 LLM 为业务领域和代码节点生成描述。
"""
from __future__ import annotations

import json
import logging
import asyncio
from datetime import datetime
from typing import Optional

from backend.llm.client import get_llm_client
from backend.llm.prompts.description_prompts import (
    build_domain_description_prompt,
    build_node_description_prompt,
    build_batch_node_description_prompt,
)
from backend.services.description_cache import (
    get_description_cache,
    DomainDescription,
    NodeDescription,
)
from backend.services.code_snippet_service import get_code_snippet_service

logger = logging.getLogger(__name__)


class AIDescriptionGenerator:
    """AI 描述生成器。"""

    def __init__(
        self,
        repo_id: str,
        repo_path: Optional[str] = None,
        concurrency: int = 3,
    ):
        """
        初始化生成器。

        Args:
            repo_id: 仓库 ID
            repo_path: 仓库路径（用于读取代码）
            concurrency: 并发数
        """
        self.repo_id = repo_id
        self.repo_path = repo_path
        self.concurrency = concurrency
        self.cache = get_description_cache()
        self.code_service = get_code_snippet_service()
        self.llm_client = get_llm_client()

        if repo_path:
            self.code_service.set_repo_base_path(repo_path)

    # ─── 领域描述生成 ───────────────────────────────────────────────────────────

    def generate_domain_description(
        self,
        domain_id: str,
        domain_name: str,
        domain_key: str,
        nodes: list[dict],
        edges: list[dict],
        force: bool = False,
    ) -> Optional[DomainDescription]:
        """
        生成领域描述。

        Args:
            domain_id: 领域 ID
            domain_name: 领域名称
            domain_key: 领域关键字
            nodes: 领域内的节点列表
            edges: 领域内的边列表
            force: 是否强制重新生成

        Returns:
            DomainDescription 或 None
        """
        # 检查缓存
        if not force:
            cached = self.cache.get_domain_description(self.repo_id, domain_id)
            if cached:
                logger.debug("使用缓存的领域描述: %s", domain_id)
                return cached

        try:
            # 构建 Prompt
            system_prompt, user_prompt = build_domain_description_prompt(
                domain_name=domain_name,
                domain_key=domain_key,
                nodes=nodes,
                edges=edges,
            )

            # 调用 LLM
            response = self.llm_client.chat_completion(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.3,
                max_tokens=500,
            )

            content = response.get("content", "")

            # 解析 JSON 响应
            # 尝试提取 JSON 块
            json_start = content.find("{")
            json_end = content.rfind("}") + 1
            if json_start >= 0 and json_end > json_start:
                json_str = content[json_start:json_end]
                data = json.loads(json_str)
            else:
                data = json.loads(content)

            # 构建描述对象
            description = DomainDescription(
                domain_id=domain_id,
                summary=data.get("summary", ""),
                core_services=data.get("core_services", []),
                data_flow_pattern=data.get("data_flow_pattern", ""),
                generated_at=datetime.utcnow().isoformat(),
                confidence=0.85,
            )

            # 保存到缓存
            self.cache.set_domain_description(self.repo_id, domain_id, description)

            logger.info("生成领域描述: %s", domain_id)
            return description

        except Exception as exc:
            logger.error("生成领域描述失败: %s - %s", domain_id, exc)
            return None

    # ─── 节点描述生成 ───────────────────────────────────────────────────────────

    def generate_node_description(
        self,
        node_id: str,
        node_type: str,
        node_name: str,
        file_path: str,
        line: Optional[int] = None,
        force: bool = False,
    ) -> Optional[NodeDescription]:
        """
        生成节点描述。

        Args:
            node_id: 节点 ID
            node_type: 节点类型
            node_name: 节点名称
            file_path: 文件路径
            line: 起始行号
            force: 是否强制重新生成

        Returns:
            NodeDescription 或 None
        """
        # 检查缓存
        if not force:
            cached = self.cache.get_node_description(self.repo_id, node_id)
            if cached:
                return cached

        try:
            # 提取代码片段
            code_snippet = None
            if file_path and line:
                code_snippet = self.code_service.extract_snippet(
                    file_path, line, context_lines=5, max_lines=25
                )

            code_content = code_snippet.content if code_snippet else "// 代码不可用"

            # 构建 Prompt
            system_prompt, user_prompt = build_node_description_prompt(
                node_id=node_id,
                node_type=node_type,
                node_name=node_name,
                file_path=file_path,
                code_content=code_content,
            )

            # 调用 LLM
            response = self.llm_client.chat_completion(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.3,
                max_tokens=300,
            )

            content = response.get("content", "")

            # 解析 JSON 响应
            json_start = content.find("{")
            json_end = content.rfind("}") + 1
            if json_start >= 0 and json_end > json_start:
                json_str = content[json_start:json_end]
                data = json.loads(json_str)
            else:
                data = json.loads(content)

            # 构建描述对象
            description = NodeDescription(
                node_id=node_id,
                description=data.get("description", ""),
                code_snippet=code_content if code_snippet else None,
                highlight_lines=data.get("highlight_lines", []),
                generated_at=datetime.utcnow().isoformat(),
                confidence=0.8,
            )

            # 保存到缓存
            self.cache.set_node_description(self.repo_id, node_id, description)

            logger.debug("生成节点描述: %s", node_id)
            return description

        except Exception as exc:
            logger.warning("生成节点描述失败: %s - %s", node_id, exc)
            return None

    # ─── 批量生成 ───────────────────────────────────────────────────────────────

    async def generate_batch_node_descriptions(
        self,
        nodes: list[dict],
        force: bool = False,
    ) -> dict[str, NodeDescription]:
        """
        批量生成节点描述。

        Args:
            nodes: 节点列表，每个节点包含 id, type, name, file, line
            force: 是否强制重新生成

        Returns:
            节点 ID -> NodeDescription 的映射
        """
        results = {}
        semaphore = asyncio.Semaphore(self.concurrency)

        async def generate_one(node: dict) -> tuple[str, Optional[NodeDescription]]:
            async with semaphore:
                # 在线程池中执行同步的生成操作
                loop = asyncio.get_event_loop()
                desc = await loop.run_in_executor(
                    None,
                    self.generate_node_description,
                    node.get("id"),
                    node.get("type"),
                    node.get("name"),
                    node.get("file"),
                    node.get("line"),
                    force,
                )
                return node.get("id"), desc

        tasks = [generate_one(node) for node in nodes]
        completed = await asyncio.gather(*tasks, return_exceptions=True)

        for result in completed:
            if isinstance(result, Exception):
                logger.warning("批量生成节点描述失败: %s", result)
                continue
            node_id, desc = result
            if desc:
                results[node_id] = desc

        logger.info("批量生成节点描述完成: %d/%d", len(results), len(nodes))
        return results

    # ─── 增量更新 ───────────────────────────────────────────────────────────────

    def invalidate_changed_files(self, changed_files: list[str]) -> None:
        """
        使变更文件相关的描述缓存失效。

        Args:
            changed_files: 变更文件路径列表
        """
        # 获取所有节点描述
        nodes_path = self.cache._get_nodes_path(self.repo_id)
        if not nodes_path.exists():
            return

        invalidated = 0
        for cache_file in nodes_path.glob("*.json"):
            try:
                with open(cache_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                node_id = data.get("node_id", "")

                # 检查节点是否属于变更文件
                for changed_file in changed_files:
                    if changed_file in node_id:
                        cache_file.unlink()
                        invalidated += 1
                        break

            except Exception as exc:
                logger.warning("处理缓存文件失败: %s - %s", cache_file, exc)

        if invalidated > 0:
            logger.info("已使 %d 个节点描述缓存失效", invalidated)
