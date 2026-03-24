"""
AI 描述生成流水线阶段。

在代码分析完成后，生成业务领域和节点的 AI 描述。
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Optional
from collections import defaultdict

from backend.graph.graph_schema import GraphNode, GraphEdge
from backend.services.ai_description_generator import AIDescriptionGenerator
from backend.services.domain_inference_service import extract_business_key

logger = logging.getLogger(__name__)


@dataclass
class AIDescriptionConfig:
    """AI 描述生成配置。"""

    enabled: bool = True
    max_nodes_per_domain: int = 50  # 每个领域最多处理的节点数
    batch_size: int = 10  # 批量调用大小
    concurrency: int = 3  # 并发数
    skip_if_cached: bool = True  # 如果已有缓存则跳过


@dataclass
class AIDescriptionResult:
    """AI 描述生成结果。"""

    domains_generated: int = 0
    nodes_generated: int = 0
    domains_skipped: int = 0
    nodes_skipped: int = 0
    errors: list[str] = field(default_factory=list)


class AIDescriptionStage:
    """
    AI 描述生成阶段。

    在代码分析完成后，为业务领域和关键节点生成 AI 描述。
    """

    def __init__(
        self,
        repo_id: str,
        repo_path: Optional[str] = None,
        config: Optional[AIDescriptionConfig] = None,
    ):
        """
        初始化阶段。

        Args:
            repo_id: 仓库 ID
            repo_path: 仓库路径
            config: 配置
        """
        self.repo_id = repo_id
        self.repo_path = repo_path
        self.config = config or AIDescriptionConfig()
        self.generator = AIDescriptionGenerator(
            repo_id=repo_id,
            repo_path=repo_path,
            concurrency=self.config.concurrency,
        )
        self.result = AIDescriptionResult()

    def run(
        self,
        nodes: list[GraphNode],
        edges: list[GraphEdge],
        domain_definitions: Optional[list[dict]] = None,
    ) -> AIDescriptionResult:
        """
        运行 AI 描述生成。

        Args:
            nodes: 图节点列表
            edges: 图边列表
            domain_definitions: 已定义的业务领域（可选）

        Returns:
            生成结果统计
        """
        if not self.config.enabled:
            logger.info("AI 描述生成已禁用")
            return self.result

        logger.info(
            "开始 AI 描述生成: %d 节点, %d 边",
            len(nodes),
            len(edges),
        )

        try:
            # 1. 按领域分组节点
            domain_nodes = self._group_nodes_by_domain(nodes, domain_definitions)

            # 2. 为每个领域生成描述
            self._generate_domain_descriptions(domain_nodes, edges)

            # 3. 为关键节点生成描述
            self._generate_key_node_descriptions(nodes, edges)

        except Exception as exc:
            logger.exception("AI 描述生成失败: %s", exc)
            self.result.errors.append(str(exc))

        logger.info(
            "AI 描述生成完成: 领域 %d/%d, 节点 %d/%d",
            self.result.domains_generated,
            self.result.domains_generated + self.result.domains_skipped,
            self.result.nodes_generated,
            self.result.nodes_generated + self.result.nodes_skipped,
        )

        return self.result

    def _group_nodes_by_domain(
        self,
        nodes: list[GraphNode],
        domain_definitions: Optional[list[dict]],
    ) -> dict[str, list[GraphNode]]:
        """
        按业务领域分组节点。

        Returns:
            domain_key -> 节点列表
        """
        # 构建领域查找映射
        domain_map: dict[str, str] = {}  # key -> domain_id
        domain_names: dict[str, str] = {}  # key -> domain_name

        if domain_definitions:
            for domain in domain_definitions:
                key = domain.get("key", "").lower()
                domain_id = domain.get("id", f"domain:{key}")
                domain_name = domain.get("name", key)
                domain_map[key] = domain_id
                domain_names[key] = domain_name

                for alias in domain.get("aliases", []):
                    domain_map[alias.lower()] = domain_id

        # 分组节点
        raw_groups: dict[str, list[GraphNode]] = defaultdict(list)

        for node in nodes:
            # 提取业务关键字
            biz_key = extract_business_key(node.id)
            if not biz_key:
                continue

            # 过滤掉含文件扩展名的 key（如 nbuimageservice.java）
            if "." in biz_key:
                continue

            biz_key_lower = biz_key.lower()

            # 查找对应的领域
            domain_id = domain_map.get(biz_key_lower, f"domain:{biz_key_lower}")

            raw_groups[domain_id].append(node)

        # 过滤：移除节点数过少的领域（< 3 个节点），避免把单个类当领域
        MIN_DOMAIN_SIZE = 3
        groups: dict[str, list[GraphNode]] = {
            domain_id: nodes_list
            for domain_id, nodes_list in raw_groups.items()
            if len(nodes_list) >= MIN_DOMAIN_SIZE
        }

        logger.info(
            "领域分组: 原始 %d 个 → 过滤后 %d 个（最小节点数 %d）",
            len(raw_groups),
            len(groups),
            MIN_DOMAIN_SIZE,
        )

        return groups

    def _generate_domain_descriptions(
        self,
        domain_nodes: dict[str, list[GraphNode]],
        edges: list[GraphEdge],
    ) -> None:
        """为每个领域生成描述。"""
        for domain_id, nodes in domain_nodes.items():
            if len(nodes) == 0:
                continue

            # 提取领域信息
            domain_key = domain_id.replace("domain:", "")
            domain_name = domain_key.upper()  # 默认名称

            # 从第一个节点推断领域名称
            if nodes:
                first_node = nodes[0]
                props = first_node.properties or {}
                file_path = props.get("file", "")
                # 尝试从文件路径提取更友好的名称
                parts = file_path.split("/")
                for part in parts:
                    if part.lower() == domain_key.lower():
                        domain_name = part
                        break

            # 限制节点数量
            sample_nodes = nodes[: self.config.max_nodes_per_domain]

            # 构建边列表
            node_ids = {n.id for n in sample_nodes}
            domain_edges = [
                e for e in edges
                if e.from_ in node_ids and e.to in node_ids
            ]

            # 生成描述
            try:
                # 转换为字典格式
                nodes_dict = [
                    {"id": n.id, "type": n.type, "name": n.properties.get("name", "")}
                    for n in sample_nodes
                ]
                edges_dict = [
                    {"from": e.from_, "to": e.to, "type": e.type}
                    for e in domain_edges
                ]

                desc = self.generator.generate_domain_description(
                    domain_id=domain_id,
                    domain_name=domain_name,
                    domain_key=domain_key,
                    nodes=nodes_dict,
                    edges=edges_dict,
                    force=not self.config.skip_if_cached,
                )

                if desc:
                    self.result.domains_generated += 1
                else:
                    self.result.domains_skipped += 1

            except Exception as exc:
                logger.warning("生成领域描述失败: %s - %s", domain_id, exc)
                self.result.domains_skipped += 1

    def _generate_key_node_descriptions(
        self,
        nodes: list[GraphNode],
        edges: list[GraphEdge],
    ) -> None:
        """为关键节点生成描述。"""
        import asyncio

        # 筛选关键节点
        key_node_types = {"Service", "Controller", "Repository"}
        key_nodes = [
            n for n in nodes
            if n.type in key_node_types
        ]

        # 限制数量
        if len(key_nodes) > 100:
            # 优先处理被调用次数多的节点
            call_counts = defaultdict(int)
            for edge in edges:
                if edge.type == "calls":
                    call_counts[edge.to] += 1

            key_nodes.sort(key=lambda n: call_counts.get(n.id, 0), reverse=True)
            key_nodes = key_nodes[:100]

        # 构建节点参数
        node_params = []
        for node in key_nodes:
            props = node.properties or {}
            node_params.append({
                "id": node.id,
                "type": node.type,
                "name": props.get("name", ""),
                "file": props.get("file", ""),
                "line": props.get("line"),
            })

        # 批量生成
        try:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                results = loop.run_until_complete(
                    self.generator.generate_batch_node_descriptions(
                        node_params,
                        force=not self.config.skip_if_cached,
                    )
                )
                self.result.nodes_generated = len(results)
                self.result.nodes_skipped = len(key_nodes) - len(results)
            finally:
                loop.close()

        except Exception as exc:
            logger.warning("批量生成节点描述失败: %s", exc)
            self.result.nodes_skipped = len(key_nodes)
