"""Stage 6: 数据血缘提取。

从静态分析产出的节点和边中提取数据血缘关系：
- Repository → Database (reads/writes)
- Service → Repository (queries)
- Service → Service (flow_to)
- Controller → APIEndpoint (produces)
- Service → Topic (produces/consumes)

基于 Spring 注解和命名约定推断血缘关系（零 LLM）。
"""
from __future__ import annotations

import logging
import re
import time
from collections import defaultdict
from typing import Any, Callable

from backend.graph.graph_schema import (
    GraphNode,
    GraphEdge,
    EdgeType,
    DATA_SOURCE_TYPES,
    DATA_PROCESSOR_TYPES,
    DATA_SINK_TYPES,
)
from backend.models.static_analysis import (
    ConfidenceLevel,
    FrameworkPattern,
    LineageExtractionResult,
)
from backend.pipeline.observer import AnalysisObserver, StageStarted, StageCompleted
from backend.pipeline.stages.base import StageBase

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# 命名约定检测
# ─────────────────────────────────────────────────────────────────────────────

# Repository 命名模式
REPOSITORY_PATTERNS = [
    r".*Repository$",      # XxxRepository
    r".*Repo$",            # XxxRepo
    r".*DAO$",             # XxxDAO
    r".*Dao$",             # XxxDao
    r".*Mapper$",          # XxxMapper (MyBatis)
]

# Service 命名模式
SERVICE_PATTERNS = [
    r".*Service$",         # XxxService
    r".*ServiceImpl$",     # XxxServiceImpl
    r".*Manager$",         # XxxManager
    r".*Provider$",        # XxxProvider
]

# Controller 命名模式
CONTROLLER_PATTERNS = [
    r".*Controller$",      # XxxController
    r".*RestController$",  # XxxRestController
    r".*Resource$",        # XxxResource (JAX-RS)
    r".*Endpoint$",        # XxxEndpoint
]


class DataLineageExtractionStage(StageBase):
    """Stage 6: 数据血缘提取。

    零 LLM 的血缘推断，基于：
    1. Spring 注解（@Repository, @Service, @Controller）
    2. 命名约定（XxxRepository, XxxService）
    3. DI 关系（@Autowired）
    4. HTTP 映射注解（@GetMapping, @PostMapping）
    """

    name = "data_lineage_extraction"

    def __init__(
        self,
        infer_database_from_repository: bool = True,
        extract_api_endpoints: bool = True,
        extract_service_flow: bool = True,
    ):
        """
        Args:
            infer_database_from_repository: 是否从 Repository 推断 Database 节点
            extract_api_endpoints: 是否从 Controller 提取 APIEndpoint 节点
            extract_service_flow: 是否从 DI 关系推断 Service 数据流
        """
        self.infer_database_from_repository = infer_database_from_repository
        self.extract_api_endpoints = extract_api_endpoints
        self.extract_service_flow = extract_service_flow

    def run(
        self,
        structural_nodes: list[GraphNode],
        structural_edges: list[GraphEdge],
        di_edges: list[GraphEdge],
        framework_patterns: list[FrameworkPattern],
        observer: AnalysisObserver | None = None,
        on_progress: Callable[[dict], None] | None = None,
    ) -> LineageExtractionResult:
        """执行数据血缘提取。

        Args:
            structural_nodes: Stage 2 产出的结构节点
            structural_edges: Stage 2 产出的结构边
            di_edges: Stage 4a/4b 产出的 DI 边
            framework_patterns: Stage 2 检测到的框架模式
            observer: 事件观察器
            on_progress: 进度回调

        Returns:
            LineageExtractionResult
        """
        start_time = time.time()

        if observer:
            observer.emit(StageStarted.create("data_lineage_extraction", node_count=len(structural_nodes)))

        if on_progress:
            on_progress({
                "step": "data_lineage_extraction",
                "status": "start",
                "message": "提取数据血缘..."
            })

        lineage_nodes: list[GraphNode] = []
        lineage_edges: list[GraphEdge] = []

        # Step 1: 从 Repository 推断 Database 节点
        if self.infer_database_from_repository:
            db_nodes, repo_edges = self._extract_repository_lineage(
                structural_nodes, framework_patterns
            )
            lineage_nodes.extend(db_nodes)
            lineage_edges.extend(repo_edges)
            logger.info("[lineage] Repository → Database: %d 节点, %d 边", len(db_nodes), len(repo_edges))

        # Step 2: 从 Controller 提取 APIEndpoint 节点
        if self.extract_api_endpoints:
            api_nodes, api_edges = self._extract_api_lineage(
                structural_nodes, framework_patterns
            )
            lineage_nodes.extend(api_nodes)
            lineage_edges.extend(api_edges)
            logger.info("[lineage] Controller → APIEndpoint: %d 节点, %d 边", len(api_nodes), len(api_edges))

        # Step 3: 从 DI 关系推断 Service 数据流
        if self.extract_service_flow:
            flow_edges = self._extract_service_flow(structural_nodes, di_edges)
            lineage_edges.extend(flow_edges)
            logger.info("[lineage] Service → Service flow_to: %d 边", len(flow_edges))

        # Step 4: 从 Kafka/Event 模式提取 Topic 血缘
        topic_nodes, topic_edges = self._extract_topic_lineage(framework_patterns)
        lineage_nodes.extend(topic_nodes)
        lineage_edges.extend(topic_edges)
        logger.info("[lineage] Topic 血缘: %d 节点, %d 边", len(topic_nodes), len(topic_edges))

        # 构建统计信息
        stats = self._build_stats(lineage_nodes, lineage_edges)

        elapsed_ms = int((time.time() - start_time) * 1000)

        if observer:
            observer.emit(StageCompleted.create("data_lineage_extraction", elapsed_ms, cache_hit=False))

        msg = f"数据血缘提取完成: {len(lineage_nodes)} 节点, {len(lineage_edges)} 边"
        logger.info("Stage 6 完成: %s", msg)

        if on_progress:
            on_progress({
                "step": "data_lineage_extraction",
                "status": "complete",
                "message": msg,
                "lineage_nodes": len(lineage_nodes),
                "lineage_edges": len(lineage_edges),
            })

        return LineageExtractionResult(
            lineage_nodes=lineage_nodes,
            lineage_edges=lineage_edges,
            stats=stats,
        )

    def _extract_repository_lineage(
        self,
        nodes: list[GraphNode],
        patterns: list[FrameworkPattern],
    ) -> tuple[list[GraphNode], list[GraphEdge]]:
        """从 Repository 节点推断 Database 节点。

        策略：
        1. 识别 @Repository 注解或 XxxRepository 命名
        2. 按数据源分组（默认单个 primary 数据库）
        3. 生成 reads/writes 边
        """
        db_nodes: list[GraphNode] = []
        edges: list[GraphEdge] = []

        # 收集 Repository 节点
        repository_nodes = []
        for node in nodes:
            if self._is_repository(node):
                repository_nodes.append(node)

        if not repository_nodes:
            return db_nodes, edges

        # 推断数据源（简化：默认单个数据库）
        # TODO: 从 application.yml 或 @DataSource 注解推断多数据源
        db_node = GraphNode(
            id="datasource:primary",
            type="Database",
            name="PrimaryDB",
            properties={
                "inferred": True,
                "source": "repository_naming",
                "confidence": ConfidenceLevel.LINEAGE_REPOSITORY,
            },
        )
        db_nodes.append(db_node)

        # 为每个 Repository 生成 reads/writes 边
        for repo_node in repository_nodes:
            # 简化：同时生成 reads 和 writes
            # TODO: 从方法名推断具体操作（findById → reads, save → writes）
            edges.append(GraphEdge(
                from_=repo_node.id,
                to=db_node.id,
                type=EdgeType.READS.value,
                properties={
                    "source": "static",
                    "confidence": ConfidenceLevel.LINEAGE_REPOSITORY,
                    "inferred_operations": ["read"],
                },
            ))
            edges.append(GraphEdge(
                from_=repo_node.id,
                to=db_node.id,
                type=EdgeType.WRITES.value,
                properties={
                    "source": "static",
                    "confidence": ConfidenceLevel.LINEAGE_REPOSITORY,
                    "inferred_operations": ["write"],
                },
            ))

        return db_nodes, edges

    def _extract_api_lineage(
        self,
        nodes: list[GraphNode],
        patterns: list[FrameworkPattern],
    ) -> tuple[list[GraphNode], list[GraphEdge]]:
        """从 Controller 提取 APIEndpoint 节点。

        策略：
        1. 识别 @RestController/@Controller 注解
        2. 从 @GetMapping/@PostMapping 等提取端点
        3. 生成 produces 边
        """
        api_nodes: list[GraphNode] = []
        edges: list[GraphEdge] = []

        # 从 framework_patterns 提取 HTTP 映射
        http_methods = {
            "GetMapping": "GET",
            "PostMapping": "POST",
            "PutMapping": "PUT",
            "DeleteMapping": "DELETE",
            "PatchMapping": "PATCH",
            "RequestMapping": "GET",  # 默认
        }

        # 收集 Controller 节点
        controller_nodes = {n.id: n for n in nodes if self._is_controller(n)}

        # 从 patterns 提取 API 端点
        for pattern in patterns:
            if pattern.pattern_type in ("controller", "rest_controller"):
                continue  # 跳过类级注解

            # 检查是否是 HTTP 映射注解
            for method_prefix, http_method in http_methods.items():
                if method_prefix in pattern.raw_code:
                    # 提取路径
                    path = self._extract_path_from_pattern(pattern)
                    if not path:
                        path = f"/{pattern.source_element}"

                    # 生成 APIEndpoint 节点
                    api_node_id = f"api:{http_method}:{path}"
                    api_node = GraphNode(
                        id=api_node_id,
                        type="APIEndpoint",
                        name=f"{http_method} {path}",
                        properties={
                            "http_method": http_method,
                            "path": path,
                            "handler": pattern.source_element,
                            "source_file": pattern.source_file,
                            "confidence": ConfidenceLevel.LINEAGE_API_ENDPOINT,
                        },
                    )
                    api_nodes.append(api_node)

                    # 找到对应的 Controller 节点
                    controller_id = f"class:{pattern.source_file}:{pattern.source_element.split('.')[0]}"
                    if controller_id in controller_nodes:
                        edges.append(GraphEdge(
                            from_=controller_id,
                            to=api_node_id,
                            type=EdgeType.PRODUCES.value,
                            properties={
                                "source": "static",
                                "confidence": ConfidenceLevel.LINEAGE_API_ENDPOINT,
                            },
                        ))
                    break

        return api_nodes, edges

    def _extract_service_flow(
        self,
        nodes: list[GraphNode],
        di_edges: list[GraphEdge],
    ) -> list[GraphEdge]:
        """从 DI 关系推断 Service 数据流。

        策略：
        1. 过滤出 Service → Service 的 depends_on 边
        2. 转换为 flow_to 边（表示数据流向）
        """
        flow_edges: list[GraphEdge] = []

        # 构建 Service 节点集合
        service_ids = {n.id for n in nodes if self._is_service(n)}

        for edge in di_edges:
            # 只处理 Service → Service 的依赖
            if edge.type not in ("depends_on", "uses"):
                continue

            from_id = edge.from_
            to_id = edge.to

            # 检查是否都是 Service
            if from_id in service_ids and to_id in service_ids:
                flow_edges.append(GraphEdge(
                    from_=from_id,
                    to=to_id,
                    type=EdgeType.FLOW_TO.value,
                    properties={
                        "source": "di_inference",
                        "confidence": ConfidenceLevel.LINEAGE_SERVICE_FLOW,
                        "original_edge_type": edge.type,
                    },
                ))

        return flow_edges

    def _extract_topic_lineage(
        self,
        patterns: list[FrameworkPattern],
    ) -> tuple[list[GraphNode], list[GraphEdge]]:
        """从 Kafka/Event 模式提取 Topic 血缘。

        策略：
        1. 识别 @KafkaListener (consumes)
        2. 识别 KafkaTemplate.send (produces)
        3. 生成 Topic 节点和 produces/consumes 边
        """
        topic_nodes: list[GraphNode] = []
        edges: list[GraphEdge] = []

        # 收集 Topic 名称
        topics_seen: dict[str, GraphNode] = {}

        for pattern in patterns:
            if pattern.pattern_type == "kafka_consume":
                topic_name = pattern.target_hint
                if not topic_name or topic_name.startswith("${"):
                    continue  # 跳过占位符

                # 创建/复用 Topic 节点
                if topic_name not in topics_seen:
                    topic_node = GraphNode(
                        id=f"topic:{topic_name}",
                        type="Topic",
                        name=topic_name,
                        properties={
                            "message_queue": "Kafka",
                            "confidence": ConfidenceLevel.SPRING_KAFKA_CONSTANT,
                        },
                    )
                    topics_seen[topic_name] = topic_node
                    topic_nodes.append(topic_node)

                # 生成 consumes 边
                consumer_id = f"class:{pattern.source_file}:{pattern.source_element.split('.')[0]}"
                edges.append(GraphEdge(
                    from_=consumer_id,
                    to=f"topic:{topic_name}",
                    type=EdgeType.CONSUMES.value,
                    properties={
                        "source": "static",
                        "confidence": ConfidenceLevel.SPRING_KAFKA_CONSTANT,
                        "listener_method": pattern.source_element,
                    },
                ))

            elif pattern.pattern_type == "kafka_produce":
                topic_name = pattern.target_hint
                if not topic_name or topic_name.startswith("${"):
                    continue

                # 创建/复用 Topic 节点
                if topic_name not in topics_seen:
                    topic_node = GraphNode(
                        id=f"topic:{topic_name}",
                        type="Topic",
                        name=topic_name,
                        properties={
                            "message_queue": "Kafka",
                            "confidence": ConfidenceLevel.SPRING_KAFKA_CONSTANT,
                        },
                    )
                    topics_seen[topic_name] = topic_node
                    topic_nodes.append(topic_node)

                # 生成 produces 边
                producer_id = f"class:{pattern.source_file}:{pattern.source_element.split('.')[0]}"
                edges.append(GraphEdge(
                    from_=producer_id,
                    to=f"topic:{topic_name}",
                    type=EdgeType.PRODUCES.value,
                    properties={
                        "source": "static",
                        "confidence": ConfidenceLevel.SPRING_KAFKA_CONSTANT,
                    },
                ))

        return topic_nodes, edges

    def _build_stats(
        self,
        nodes: list[GraphNode],
        edges: list[GraphEdge],
    ) -> dict[str, Any]:
        """构建统计信息。"""
        node_type_counts: dict[str, int] = defaultdict(int)
        for node in nodes:
            node_type_counts[node.type] += 1

        edge_type_counts: dict[str, int] = defaultdict(int)
        for edge in edges:
            edge_type_counts[edge.type] += 1

        return {
            "database_count": node_type_counts.get("Database", 0),
            "api_endpoint_count": node_type_counts.get("APIEndpoint", 0),
            "topic_count": node_type_counts.get("Topic", 0),
            "reads_edges": edge_type_counts.get("reads", 0),
            "writes_edges": edge_type_counts.get("writes", 0),
            "flow_to_edges": edge_type_counts.get("flow_to", 0),
            "produces_edges": edge_type_counts.get("produces", 0),
            "consumes_edges": edge_type_counts.get("consumes", 0),
            "total_lineage_nodes": len(nodes),
            "total_lineage_edges": len(edges),
        }

    # ─────────────────────────────────────────────────────────────────────────
    # 辅助方法
    # ─────────────────────────────────────────────────────────────────────────

    def _is_repository(self, node: GraphNode) -> bool:
        """判断节点是否是 Repository。"""
        # 检查注解
        annotations = node.properties.get("annotations", [])
        if "@Repository" in annotations:
            return True

        # 检查命名
        name = node.name
        for pattern in REPOSITORY_PATTERNS:
            if re.match(pattern, name):
                return True

        return False

    def _is_service(self, node: GraphNode) -> bool:
        """判断节点是否是 Service。"""
        # 检查注解
        annotations = node.properties.get("annotations", [])
        if "@Service" in annotations:
            return True

        # 检查类型
        if node.type == "Service":
            return True

        # 检查命名
        name = node.name
        for pattern in SERVICE_PATTERNS:
            if re.match(pattern, name):
                return True

        return False

    def _is_controller(self, node: GraphNode) -> bool:
        """判断节点是否是 Controller。"""
        # 检查注解
        annotations = node.properties.get("annotations", [])
        if "@Controller" in annotations or "@RestController" in annotations:
            return True

        # 检查类型
        if node.type == "Component":
            # 进一步检查命名
            name = node.name
            for pattern in CONTROLLER_PATTERNS:
                if re.match(pattern, name):
                    return True

        return False

    def _extract_path_from_pattern(self, pattern: FrameworkPattern) -> str | None:
        """从 pattern 中提取 HTTP 路径。"""
        # 尝试从 raw_code 提取路径
        # 例如: @GetMapping("/users/{id}")
        raw = pattern.raw_code

        # 匹配引号内的路径
        match = re.search(r'["\']([^"\']+)["\']', raw)
        if match:
            return match.group(1)

        return None
