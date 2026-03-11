"""
基础设施依赖分析器模块。

通过分析代码中的配置读取、连接字符串、环境变量使用等模式，
识别应用程序依赖的基础设施组件：
- 数据库（PostgreSQL、MySQL、MongoDB、SQLite）
- 缓存（Redis、Memcached）
- 消息队列（Kafka、RabbitMQ、Celery）
- 对象存储（S3、GCS、MinIO）
- 外部 API（HTTP 客户端调用）
- 容器/服务（Docker、Kubernetes 配置）

生成 InfrastructureNode 和 DEPENDS_ON / DEPLOYED_ON 边。
"""

from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from backend.graph.schema import (
    EdgeBase,
    EdgeType,
    InfrastructureNode,
    InfraType,
    ModuleNode,
    RepositoryNode,
)
from backend.parser.code_parser import ParsedFile

logger = logging.getLogger(__name__)


# 基础设施识别规则：模块导入前缀 -> (技术名, InfraType)
INFRA_IMPORT_RULES: dict[str, tuple[str, InfraType]] = {
    "sqlalchemy": ("SQLAlchemy", InfraType.DATABASE),
    "psycopg2": ("PostgreSQL", InfraType.DATABASE),
    "pymysql": ("MySQL", InfraType.DATABASE),
    "pymongo": ("MongoDB", InfraType.DATABASE),
    "motor": ("MongoDB", InfraType.DATABASE),
    "redis": ("Redis", InfraType.CACHE),
    "aioredis": ("Redis", InfraType.CACHE),
    "memcache": ("Memcached", InfraType.CACHE),
    "celery": ("Celery", InfraType.QUEUE),
    "kafka": ("Kafka", InfraType.QUEUE),
    "pika": ("RabbitMQ", InfraType.QUEUE),
    "aio_pika": ("RabbitMQ", InfraType.QUEUE),
    "boto3": ("AWS S3", InfraType.STORAGE),
    "google.cloud.storage": ("GCS", InfraType.STORAGE),
    "minio": ("MinIO", InfraType.STORAGE),
    "elasticsearch": ("Elasticsearch", InfraType.DATABASE),
    "httpx": ("HTTP API", InfraType.API),
    "aiohttp": ("HTTP API", InfraType.API),
    "requests": ("HTTP API", InfraType.API),
    "grpc": ("gRPC", InfraType.API),
}

# 环境变量名模式 -> 基础设施推断
ENV_VAR_PATTERNS: list[tuple[re.Pattern, str, InfraType]] = [
    (re.compile(r"DATABASE_URL|DB_URL|POSTGRES_|MYSQL_|MONGO_URI"), "Database", InfraType.DATABASE),
    (re.compile(r"REDIS_URL|REDIS_HOST|CACHE_URL"), "Redis", InfraType.CACHE),
    (re.compile(r"KAFKA_BROKERS|KAFKA_BOOTSTRAP"), "Kafka", InfraType.QUEUE),
    (re.compile(r"RABBITMQ_URL|AMQP_URL"), "RabbitMQ", InfraType.QUEUE),
    (re.compile(r"AWS_S3_|S3_BUCKET|GCS_BUCKET"), "Object Storage", InfraType.STORAGE),
    (re.compile(r"CELERY_BROKER|CELERY_BACKEND"), "Celery", InfraType.QUEUE),
    (re.compile(r"ELASTICSEARCH_URL|ES_HOST"), "Elasticsearch", InfraType.DATABASE),
]

# Docker/Compose 服务 -> 基础设施类型
DOCKER_SERVICE_PATTERNS: dict[str, tuple[str, InfraType]] = {
    "postgres": ("PostgreSQL", InfraType.DATABASE),
    "mysql": ("MySQL", InfraType.DATABASE),
    "mariadb": ("MariaDB", InfraType.DATABASE),
    "mongodb": ("MongoDB", InfraType.DATABASE),
    "redis": ("Redis", InfraType.CACHE),
    "kafka": ("Kafka", InfraType.QUEUE),
    "zookeeper": ("Zookeeper", InfraType.SERVICE),
    "rabbitmq": ("RabbitMQ", InfraType.QUEUE),
    "elasticsearch": ("Elasticsearch", InfraType.DATABASE),
    "nginx": ("Nginx", InfraType.SERVICE),
    "traefik": ("Traefik", InfraType.SERVICE),
    "minio": ("MinIO", InfraType.STORAGE),
}


class InfraAnalyzer:
    """
    基础设施依赖分析器。

    通过多种信号源识别应用所依赖的基础设施组件，
    生成 InfrastructureNode 和依赖边。

    示例::

        analyzer = InfraAnalyzer("/path/to/repo")
        infra_nodes, edges = analyzer.analyze(parsed_files, repo_node)
    """

    def __init__(self, repo_root: str) -> None:
        """
        初始化基础设施分析器。

        Args:
            repo_root: 仓库根目录路径
        """
        self.repo_root = Path(repo_root)

    def analyze(
        self,
        parsed_files: dict[str, ParsedFile],
        repo_node: Optional[RepositoryNode] = None,
        module_nodes: Optional[dict[str, ModuleNode]] = None,
    ) -> tuple[list[InfrastructureNode], list[EdgeBase]]:
        """
        执行基础设施分析。

        Args:
            parsed_files: 文件路径 -> 解析结果的映射
            repo_node: 仓库根节点（用于建立 DEPENDS_ON 边）
            module_nodes: 模块节点映射

        Returns:
            (基础设施节点列表, 关系边列表) 元组
        """
        infra_nodes: list[InfrastructureNode] = []
        edges: list[EdgeBase] = []
        seen: dict[str, InfrastructureNode] = {}

        # 1. 从代码导入分析
        for file_path, parsed in parsed_files.items():
            code_infra = self._analyze_imports(parsed)
            for node in code_infra:
                key = f"{node.technology}:{node.infra_type}"
                if key not in seen:
                    seen[key] = node
                    infra_nodes.append(node)
                # DEPENDS_ON 边：模块 -> 基础设施
                if module_nodes:
                    module = module_nodes.get(file_path)
                    if module:
                        edges.append(EdgeBase(
                            type=EdgeType.DEPENDS_ON,
                            source_id=module.id,
                            target_id=seen[key].id,
                        ))

        # 2. 从环境变量配置分析
        env_infra = self._analyze_env_vars()
        for node in env_infra:
            key = f"{node.technology}:{node.infra_type}"
            if key not in seen:
                seen[key] = node
                infra_nodes.append(node)

        # 3. 从 Docker Compose 分析
        compose_infra = self._analyze_docker_compose()
        for node in compose_infra:
            key = f"{node.technology}:{node.infra_type}"
            if key not in seen:
                seen[key] = node
                infra_nodes.append(node)
            # 仓库 DEPLOYED_ON 基础设施
            if repo_node:
                edges.append(EdgeBase(
                    type=EdgeType.DEPLOYED_ON,
                    source_id=repo_node.id,
                    target_id=seen[key].id,
                    metadata={"source": "docker-compose"},
                ))

        logger.info(
            f"基础设施分析完成: {len(infra_nodes)} 个组件, {len(edges)} 条依赖边"
        )
        return infra_nodes, edges

    def _analyze_imports(self, parsed: ParsedFile) -> list[InfrastructureNode]:
        """从文件导入语句识别基础设施依赖。"""
        nodes: list[InfrastructureNode] = []
        seen_tech: set[str] = set()

        for imp in parsed.imports:
            for prefix, (tech, infra_type) in INFRA_IMPORT_RULES.items():
                if imp.module.startswith(prefix) and tech not in seen_tech:
                    seen_tech.add(tech)
                    nodes.append(InfrastructureNode(
                        name=tech,
                        infra_type=infra_type,
                        technology=tech,
                        metadata={"detected_via": "import", "module": imp.module},
                    ))
        return nodes

    def _analyze_env_vars(self) -> list[InfrastructureNode]:
        """从 .env 文件和环境变量读取推断基础设施。"""
        nodes: list[InfrastructureNode] = []
        env_vars: set[str] = set()

        # 读取 .env 文件
        for env_file in [".env", ".env.example", ".env.sample"]:
            env_path = self.repo_root / env_file
            if env_path.exists():
                for line in env_path.read_text(encoding="utf-8", errors="replace").splitlines():
                    if "=" in line and not line.strip().startswith("#"):
                        key = line.split("=")[0].strip()
                        env_vars.add(key)

        # 检测环境变量模式
        seen_tech: set[str] = set()
        for var in env_vars:
            for pattern, tech, infra_type in ENV_VAR_PATTERNS:
                if pattern.search(var) and tech not in seen_tech:
                    seen_tech.add(tech)
                    nodes.append(InfrastructureNode(
                        name=tech,
                        infra_type=infra_type,
                        technology=tech,
                        metadata={"detected_via": "env_var", "env_key": var},
                    ))

        return nodes

    def _analyze_docker_compose(self) -> list[InfrastructureNode]:
        """从 docker-compose.yml 提取服务信息。"""
        nodes: list[InfrastructureNode] = []

        compose_files = [
            "docker-compose.yml", "docker-compose.yaml",
            "docker-compose.dev.yml", "docker-compose.prod.yml",
        ]

        for filename in compose_files:
            compose_path = self.repo_root / filename
            if not compose_path.exists():
                continue
            try:
                nodes.extend(self._parse_compose_file(compose_path))
            except Exception as e:
                logger.warning(f"解析 {filename} 失败: {e}")

        return nodes

    def _parse_compose_file(self, path: Path) -> list[InfrastructureNode]:
        """解析单个 docker-compose 文件。"""
        nodes: list[InfrastructureNode] = []
        try:
            import yaml  # pyyaml
        except ImportError:
            # 降级：正则解析
            return self._parse_compose_regex(path)

        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return nodes

        services: dict = data.get("services", {})
        for svc_name, svc_config in services.items():
            image = ""
            if isinstance(svc_config, dict):
                image = svc_config.get("image", svc_name)

            # 匹配已知服务
            for pattern, (tech, infra_type) in DOCKER_SERVICE_PATTERNS.items():
                if pattern in image.lower() or pattern in svc_name.lower():
                    ports = []
                    if isinstance(svc_config, dict):
                        ports = svc_config.get("ports", [])
                    port = self._extract_port(ports)
                    nodes.append(InfrastructureNode(
                        name=f"{tech} ({svc_name})",
                        infra_type=infra_type,
                        technology=tech,
                        port=port,
                        metadata={
                            "service_name": svc_name,
                            "image": image,
                            "source": str(path.name),
                        },
                    ))
                    break

        return nodes

    def _parse_compose_regex(self, path: Path) -> list[InfrastructureNode]:
        """使用正则表达式解析 docker-compose（pyyaml 不可用时的降级方案）。"""
        nodes: list[InfrastructureNode] = []
        content = path.read_text(encoding="utf-8")
        images = re.findall(r"image:\s*([^\s]+)", content)
        for image in images:
            for pattern, (tech, infra_type) in DOCKER_SERVICE_PATTERNS.items():
                if pattern in image.lower():
                    nodes.append(InfrastructureNode(
                        name=tech, infra_type=infra_type, technology=tech,
                        metadata={"image": image}
                    ))
                    break
        return nodes

    def _extract_port(self, ports: list) -> Optional[int]:
        """从端口映射列表提取容器端口号。"""
        for p in ports:
            p_str = str(p)
            parts = p_str.split(":")
            try:
                return int(parts[-1])
            except (ValueError, IndexError):
                continue
        return None
