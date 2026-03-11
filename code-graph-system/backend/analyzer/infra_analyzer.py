"""
基础设施分析器模块。

解析 Dockerfile、Kubernetes YAML、Terraform HCL 三类基础设施配置文件，
识别 Service / Container / Cluster / Database 节点并构建部署关系图谱。

识别策略：
    1. Dockerfile → Container 节点（FROM 镜像），ENV 变量推断 Database 依赖
    2. Kubernetes YAML（通过 apiVersion + kind 判别）
         - Deployment / StatefulSet / DaemonSet → Service 节点
         - Service（kind=Service）             → Service 节点
         - Namespace                            → Cluster 节点
         - containers[].image                  → Container 节点
         - env DATABASE_URL / REDIS_URL 等     → Database 依赖
    3. Terraform HCL（正则解析）
         - aws_eks_cluster / google_container_cluster 等  → Cluster 节点
         - aws_ecs_service / kubernetes_deployment 等     → Service 节点
         - aws_db_instance / google_sql_database_instance → Database 节点
         - 资源间引用推断 deployed_on / uses 边

Graph 关系：
    Service  --deployed_on-->  Cluster
    Service  --uses-->         Database
    Cluster  --contains-->     Service

输出（InfraGraph）：
    services:   Service  GraphNode 列表
    containers: Container GraphNode 列表（NodeType=COMPONENT）
    clusters:   Cluster  GraphNode 列表
    databases:  Database GraphNode 列表
    edges:      deployed_on / uses / contains 边列表
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from backend.graph.graph_schema import EdgeType, GraphEdge, GraphNode, NodeType

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Kubernetes kind → NodeType mapping
# ---------------------------------------------------------------------------

# 视为 Service 节点的 kind 集合
_K8S_SERVICE_KINDS: frozenset[str] = frozenset({
    "Deployment", "StatefulSet", "DaemonSet",
    "ReplicaSet", "Job", "CronJob",
    "Service",
})

# 视为 Cluster 节点的 kind 集合
_K8S_CLUSTER_KINDS: frozenset[str] = frozenset({
    "Namespace", "ClusterRole", "ClusterRoleBinding",
})

# kind 中包含数据库语义的名称片段（全小写匹配）
_K8S_DB_IMAGE_HINTS: frozenset[str] = frozenset({
    "postgres", "mysql", "mariadb", "mongodb", "mongo",
    "redis", "elasticsearch", "cassandra", "cockroachdb",
    "mssql", "oracle", "sqlite",
})


# ---------------------------------------------------------------------------
# Terraform resource type → (tech_name, NodeType)
# ---------------------------------------------------------------------------

_TF_CLUSTER_RESOURCES: dict[str, str] = {
    "aws_eks_cluster":                  "EKS Cluster",
    "aws_ecs_cluster":                  "ECS Cluster",
    "google_container_cluster":         "GKE Cluster",
    "azurerm_kubernetes_cluster":       "AKS Cluster",
    "digitalocean_kubernetes_cluster":  "DO Kubernetes Cluster",
    "azurerm_container_app_environment":"Azure Container App Env",
}

_TF_SERVICE_RESOURCES: dict[str, str] = {
    "aws_ecs_service":          "ECS Service",
    "aws_lambda_function":      "Lambda Function",
    "google_cloud_run_service": "Cloud Run Service",
    "azurerm_container_group":  "Azure Container Group",
    "kubernetes_deployment":    "Kubernetes Deployment",
    "kubernetes_service":       "Kubernetes Service",
    "helm_release":             "Helm Release",
}

_TF_DATABASE_RESOURCES: dict[str, str] = {
    "aws_db_instance":                "RDS Instance",
    "aws_rds_cluster":                "Aurora Cluster",
    "aws_dynamodb_table":             "DynamoDB Table",
    "aws_elasticache_cluster":        "ElastiCache Cluster",
    "aws_elasticache_replication_group": "ElastiCache (Redis)",
    "google_sql_database_instance":   "Cloud SQL",
    "google_bigtable_instance":       "Bigtable",
    "google_firestore_database":      "Firestore",
    "azurerm_sql_server":             "Azure SQL",
    "azurerm_cosmosdb_account":       "CosmosDB",
    "azurerm_redis_cache":            "Azure Redis",
    "digitalocean_database_cluster":  "DO Database",
    "mongodbatlas_cluster":           "MongoDB Atlas",
}

# ---------------------------------------------------------------------------
# ENV variable patterns → database name（用于 Dockerfile 和 K8s env 推断）
# ---------------------------------------------------------------------------

_DB_ENV_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"DATABASE_URL|POSTGRES_|PG_|DB_URL",       re.I), "PostgreSQL"),
    (re.compile(r"MYSQL_|MARIADB_",                          re.I), "MySQL"),
    (re.compile(r"MONGO_URI|MONGODB_URL|MONGO_URL",          re.I), "MongoDB"),
    (re.compile(r"REDIS_URL|REDIS_HOST|CACHE_URL",           re.I), "Redis"),
    (re.compile(r"ELASTICSEARCH_URL|ES_HOST|ELASTIC_",       re.I), "Elasticsearch"),
    (re.compile(r"CASSANDRA_HOST|CASSANDRA_URL",             re.I), "Cassandra"),
    (re.compile(r"RABBITMQ_URL|AMQP_URL",                    re.I), "RabbitMQ"),
    (re.compile(r"KAFKA_BROKERS|KAFKA_BOOTSTRAP",            re.I), "Kafka"),
]

# Terraform resource 正则：匹配 resource "type" "name" {
_TF_RESOURCE_RE = re.compile(
    r'resource\s+"([^"]+)"\s+"([^"]+)"\s*\{',
    re.MULTILINE,
)
# 块内 name 属性
_TF_NAME_ATTR_RE = re.compile(r'^\s*(?:name|identifier|function_name)\s*=\s*"([^"]+)"', re.MULTILINE)


# ---------------------------------------------------------------------------
# Output container
# ---------------------------------------------------------------------------


@dataclass
class InfraGraph:
    """InfraAnalyzer.analyze() 的完整输出。

    Attributes:
        services:   Service 节点列表（微服务 / k8s Deployment 等）
        containers: Container 节点列表（NodeType=COMPONENT，对应 Docker 镜像）
        clusters:   Cluster 节点列表（k8s Namespace / EKS / ECS Cluster 等）
        databases:  Database 节点列表
        edges:      deployed_on / uses / contains 边列表
    """

    services:   list[GraphNode] = field(default_factory=list)
    containers: list[GraphNode] = field(default_factory=list)
    clusters:   list[GraphNode] = field(default_factory=list)
    databases:  list[GraphNode] = field(default_factory=list)
    edges:      list[GraphEdge] = field(default_factory=list)

    # 内部索引（不参与序列化）
    _service_index:   dict[str, GraphNode] = field(default_factory=dict, repr=False)
    _container_index: dict[str, GraphNode] = field(default_factory=dict, repr=False)
    _cluster_index:   dict[str, GraphNode] = field(default_factory=dict, repr=False)
    _database_index:  dict[str, GraphNode] = field(default_factory=dict, repr=False)

    @property
    def stats(self) -> dict[str, int]:
        return {
            "services":   len(self.services),
            "containers": len(self.containers),
            "clusters":   len(self.clusters),
            "databases":  len(self.databases),
            "edges":      len(self.edges),
        }


# ---------------------------------------------------------------------------
# InfraAnalyzer
# ---------------------------------------------------------------------------


class InfraAnalyzer:
    """
    基础设施配置分析器。

    扫描仓库根目录下的 Dockerfile、Kubernetes YAML、Terraform HCL，
    识别 Service / Container / Cluster / Database 节点，并输出 InfraGraph。

    示例::

        analyzer = InfraAnalyzer()
        infra_graph = analyzer.analyze("/path/to/repo")
        print(infra_graph.stats)
    """

    # ------------------------------------------------------------------
    # Public
    # ------------------------------------------------------------------

    def analyze(self, repo_path: str | Path) -> InfraGraph:
        """执行基础设施分析。

        Args:
            repo_path: 仓库根目录路径。

        Returns:
            InfraGraph，含 services / containers / clusters / databases / edges。
        """
        root = Path(repo_path)
        ig = InfraGraph()
        seen_edges: set[tuple[str, str, str]] = set()

        # 1. Dockerfile
        for df_path in self._find_dockerfiles(root):
            try:
                self._parse_dockerfile(df_path, ig, seen_edges)
            except Exception:
                logger.debug("解析 Dockerfile 失败: %s", df_path, exc_info=True)

        # 2. Kubernetes YAML
        for yaml_path in self._find_yaml_files(root):
            try:
                self._parse_kubernetes_yaml(yaml_path, ig, seen_edges)
            except Exception:
                logger.debug("解析 Kubernetes YAML 失败: %s", yaml_path, exc_info=True)

        # 3. Terraform
        for tf_path in self._find_tf_files(root):
            try:
                self._parse_terraform(tf_path, ig, seen_edges)
            except Exception:
                logger.debug("解析 Terraform 文件失败: %s", tf_path, exc_info=True)

        logger.info(
            "基础设施分析完成: services=%d containers=%d clusters=%d databases=%d edges=%d",
            len(ig.services), len(ig.containers), len(ig.clusters),
            len(ig.databases), len(ig.edges),
        )
        return ig

    # ------------------------------------------------------------------
    # File discovery
    # ------------------------------------------------------------------

    @staticmethod
    def _find_dockerfiles(root: Path) -> list[Path]:
        results: list[Path] = []
        for p in root.rglob("Dockerfile*"):
            if p.is_file() and not _in_hidden_dir(p, root):
                results.append(p)
        for p in root.rglob("*.dockerfile"):
            if p.is_file() and not _in_hidden_dir(p, root):
                results.append(p)
        return results

    @staticmethod
    def _find_yaml_files(root: Path) -> list[Path]:
        results: list[Path] = []
        for pattern in ("*.yaml", "*.yml"):
            for p in root.rglob(pattern):
                if p.is_file() and not _in_hidden_dir(p, root):
                    results.append(p)
        return results

    @staticmethod
    def _find_tf_files(root: Path) -> list[Path]:
        results: list[Path] = []
        for p in root.rglob("*.tf"):
            if p.is_file() and not _in_hidden_dir(p, root):
                results.append(p)
        return results

    # ------------------------------------------------------------------
    # Dockerfile parser
    # ------------------------------------------------------------------

    def _parse_dockerfile(
        self,
        path: Path,
        ig: InfraGraph,
        seen_edges: set[tuple[str, str, str]],
    ) -> None:
        """解析单个 Dockerfile，提取 Container 节点和 Database 依赖。"""
        content = path.read_text(encoding="utf-8", errors="replace")
        source = str(path)

        # FROM 指令 → Container 节点
        for m in re.finditer(r"^FROM\s+([^\s]+)", content, re.MULTILINE | re.IGNORECASE):
            image = m.group(1).strip()
            # 去掉 as <alias>
            image = re.split(r"\s+(?i:as)\s+", image)[0]
            if image.lower() == "scratch":
                continue
            image_name = image.split(":")[0].split("/")[-1]
            container = self._ensure_container(image_name, ig, properties={
                "image": image,
                "source_file": source,
            })
            _ = container  # 已注册

        # ENV 指令 → Database 推断
        env_vars = re.findall(r"^ENV\s+([A-Z_][A-Z0-9_]*)", content, re.MULTILINE | re.IGNORECASE)
        env_vars += re.findall(r"^ARG\s+([A-Z_][A-Z0-9_]*)", content, re.MULTILINE | re.IGNORECASE)
        self._infer_databases_from_env(env_vars, ig, seen_edges, source_file=source)

    # ------------------------------------------------------------------
    # Kubernetes YAML parser
    # ------------------------------------------------------------------

    def _parse_kubernetes_yaml(
        self,
        path: Path,
        ig: InfraGraph,
        seen_edges: set[tuple[str, str, str]],
    ) -> None:
        """解析单个 YAML 文件，若为 Kubernetes 资源则提取节点和边。"""
        content = path.read_text(encoding="utf-8", errors="replace")

        # 快速过滤：必须含 apiVersion 和 kind
        if "apiVersion" not in content or "kind" not in content:
            return

        docs = self._load_yaml_docs(content)
        if not docs:
            return

        source = str(path)
        for doc in docs:
            if not isinstance(doc, dict):
                continue
            self._process_k8s_doc(doc, ig, seen_edges, source)

    def _process_k8s_doc(
        self,
        doc: dict,
        ig: InfraGraph,
        seen_edges: set[tuple[str, str, str]],
        source: str,
    ) -> None:
        kind = doc.get("kind", "")
        meta = doc.get("metadata", {}) or {}
        name = meta.get("name", "") or ""
        namespace = meta.get("namespace", "") or "default"

        if not name:
            return

        if kind in _K8S_SERVICE_KINDS:
            svc = self._ensure_service(name, ig, properties={
                "kind": kind,
                "namespace": namespace,
                "source_file": source,
            })

            # Namespace → Cluster 节点（用 namespace 作为集群边界）
            cluster = self._ensure_cluster(namespace, ig, properties={
                "type": "k8s_namespace",
                "source_file": source,
            })

            # Service --deployed_on--> Cluster
            _add_edge(svc.id, cluster.id, EdgeType.DEPLOYED_ON.value,
                      ig, seen_edges, source_file=source)

            # 提取 containers（spec.template.spec.containers 或 spec.containers）
            self._extract_k8s_containers(doc, svc, ig, seen_edges, source)

        elif kind in _K8S_CLUSTER_KINDS:
            self._ensure_cluster(name, ig, properties={
                "kind": kind,
                "source_file": source,
            })

    def _extract_k8s_containers(
        self,
        doc: dict,
        svc_node: GraphNode,
        ig: InfraGraph,
        seen_edges: set[tuple[str, str, str]],
        source: str,
    ) -> None:
        """从 Deployment spec 提取 containers，识别镜像和 env 中的数据库依赖。"""
        containers: list[dict] = []

        spec = doc.get("spec", {}) or {}
        # Deployment / StatefulSet / DaemonSet：spec.template.spec.containers
        template = spec.get("template", {}) or {}
        tpl_spec = template.get("spec", {}) or {}
        containers.extend(tpl_spec.get("containers", []) or [])
        containers.extend(tpl_spec.get("initContainers", []) or [])

        # Job / bare Pod：spec.containers
        containers.extend(spec.get("containers", []) or [])

        for c in containers:
            if not isinstance(c, dict):
                continue

            image = c.get("image", "") or ""
            cname = c.get("name", "") or image.split(":")[0].split("/")[-1]

            if image:
                # 判断是否为数据库镜像
                img_lower = image.lower()
                db_hint = next((h for h in _K8S_DB_IMAGE_HINTS if h in img_lower), None)
                if db_hint:
                    db_node = self._ensure_database(db_hint.capitalize(), ig, properties={
                        "image": image,
                        "source_file": source,
                    })
                    _add_edge(svc_node.id, db_node.id, EdgeType.USES.value,
                              ig, seen_edges, source_file=source)
                else:
                    self._ensure_container(cname, ig, properties={
                        "image": image,
                        "source_file": source,
                    })

            # env 推断数据库
            env_list = c.get("env", []) or []
            env_keys = []
            for ev in env_list:
                if isinstance(ev, dict) and ev.get("name"):
                    env_keys.append(ev["name"])
            self._infer_databases_from_env(
                env_keys, ig, seen_edges, source_file=source,
                svc_node=svc_node,
            )

    # ------------------------------------------------------------------
    # Terraform parser
    # ------------------------------------------------------------------

    def _parse_terraform(
        self,
        path: Path,
        ig: InfraGraph,
        seen_edges: set[tuple[str, str, str]],
    ) -> None:
        """正则解析单个 .tf 文件，提取 Cluster / Service / Database 节点。"""
        content = path.read_text(encoding="utf-8", errors="replace")
        source = str(path)

        for res_type, logical_name, block_content in _extract_tf_blocks(content):
            display_name = _tf_name_from_block(block_content) or logical_name

            if res_type in _TF_CLUSTER_RESOURCES:
                tech = _TF_CLUSTER_RESOURCES[res_type]
                self._ensure_cluster(display_name, ig, properties={
                    "resource_type": res_type,
                    "logical_name": logical_name,
                    "tech": tech,
                    "source_file": source,
                })

            elif res_type in _TF_SERVICE_RESOURCES:
                tech = _TF_SERVICE_RESOURCES[res_type]
                svc = self._ensure_service(display_name, ig, properties={
                    "resource_type": res_type,
                    "logical_name": logical_name,
                    "tech": tech,
                    "source_file": source,
                })

                # 尝试从块内容找 cluster / cluster_arn 引用
                cluster_ref = _tf_attr(block_content, "cluster")
                if cluster_ref:
                    # cluster_ref 形如 aws_ecs_cluster.main.arn 或 "cluster-name"
                    ref_name = cluster_ref.strip('"').split(".")[-2] if "." in cluster_ref else cluster_ref.strip('"')
                    if ref_name:
                        cluster_node = self._ensure_cluster(ref_name, ig, properties={
                            "source_file": source,
                        })
                        _add_edge(svc.id, cluster_node.id, EdgeType.DEPLOYED_ON.value,
                                  ig, seen_edges, source_file=source)

            elif res_type in _TF_DATABASE_RESOURCES:
                tech = _TF_DATABASE_RESOURCES[res_type]
                self._ensure_database(display_name, ig, properties={
                    "resource_type": res_type,
                    "logical_name": logical_name,
                    "tech": tech,
                    "source_file": source,
                })

        # 二次遍历：尝试将 Service --uses--> Database（基于块内属性引用）
        self._tf_link_service_to_db(content, ig, seen_edges, source)

    def _tf_link_service_to_db(
        self,
        content: str,
        ig: InfraGraph,
        seen_edges: set[tuple[str, str, str]],
        source: str,
    ) -> None:
        """从 Terraform 块内的 db_instance_identifier / database_name 等属性推断 uses 边。"""
        for res_type, logical_name, block_content in _extract_tf_blocks(content):
            if res_type not in _TF_SERVICE_RESOURCES:
                continue

            display_name = _tf_name_from_block(block_content) or logical_name
            svc_node = ig._service_index.get(display_name) or ig._service_index.get(logical_name)
            if not svc_node:
                continue

            # 查找 db / database 属性引用
            db_attrs = ["db_instance_identifier", "database_id",
                        "db_cluster_identifier", "redis_settings"]
            for attr in db_attrs:
                ref = _tf_attr(block_content, attr)
                if not ref:
                    continue
                ref_name = ref.strip('"').split(".")[-2] if "." in ref else ref.strip('"')
                db_node = ig._database_index.get(ref_name)
                if db_node:
                    _add_edge(svc_node.id, db_node.id, EdgeType.USES.value,
                              ig, seen_edges, source_file=source)

    # ------------------------------------------------------------------
    # Shared: ENV-based database inference
    # ------------------------------------------------------------------

    def _infer_databases_from_env(
        self,
        env_keys: list[str],
        ig: InfraGraph,
        seen_edges: set[tuple[str, str, str]],
        source_file: str,
        svc_node: Optional[GraphNode] = None,
    ) -> None:
        """从环境变量名推断 Database 依赖，并在 svc_node 不为空时创建 uses 边。"""
        seen_db: set[str] = set()
        for key in env_keys:
            for pattern, db_name in _DB_ENV_PATTERNS:
                if pattern.search(key) and db_name not in seen_db:
                    seen_db.add(db_name)
                    db_node = self._ensure_database(db_name, ig, properties={
                        "detected_via": "env_var",
                        "env_key": key,
                        "source_file": source_file,
                    })
                    if svc_node:
                        _add_edge(svc_node.id, db_node.id, EdgeType.USES.value,
                                  ig, seen_edges, source_file=source_file)

    # ------------------------------------------------------------------
    # Node creation helpers
    # ------------------------------------------------------------------

    def _ensure_service(
        self, name: str, ig: InfraGraph,
        *, properties: Optional[dict] = None,
    ) -> GraphNode:
        if name in ig._service_index:
            return ig._service_index[name]
        node = GraphNode(
            type=NodeType.SERVICE.value,
            name=name,
            properties=properties or {},
        )
        ig._service_index[name] = node
        ig.services.append(node)
        return node

    def _ensure_container(
        self, name: str, ig: InfraGraph,
        *, properties: Optional[dict] = None,
    ) -> GraphNode:
        if name in ig._container_index:
            return ig._container_index[name]
        node = GraphNode(
            type=NodeType.COMPONENT.value,
            name=name,
            properties={**(properties or {}), "role": "container"},
        )
        ig._container_index[name] = node
        ig.containers.append(node)
        return node

    def _ensure_cluster(
        self, name: str, ig: InfraGraph,
        *, properties: Optional[dict] = None,
    ) -> GraphNode:
        if name in ig._cluster_index:
            return ig._cluster_index[name]
        node = GraphNode(
            type=NodeType.CLUSTER.value,
            name=name,
            properties=properties or {},
        )
        ig._cluster_index[name] = node
        ig.clusters.append(node)
        return node

    def _ensure_database(
        self, name: str, ig: InfraGraph,
        *, properties: Optional[dict] = None,
    ) -> GraphNode:
        if name in ig._database_index:
            return ig._database_index[name]
        node = GraphNode(
            type=NodeType.DATABASE.value,
            name=name,
            properties=properties or {},
        )
        ig._database_index[name] = node
        ig.databases.append(node)
        return node

    # ------------------------------------------------------------------
    # YAML loader (PyYAML with fallback)
    # ------------------------------------------------------------------

    @staticmethod
    def _load_yaml_docs(content: str) -> list[dict]:
        """尝试用 PyYAML 解析 YAML 内容（多文档支持），失败时返回空列表。"""
        try:
            import yaml  # pyyaml
            docs = list(yaml.safe_load_all(content))
            return [d for d in docs if isinstance(d, dict)]
        except Exception:
            return []


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _in_hidden_dir(path: Path, root: Path) -> bool:
    """判断路径是否位于 . 开头的隐藏目录或 vendor / node_modules 下。"""
    try:
        rel = path.relative_to(root)
    except ValueError:
        return False
    _SKIP = frozenset({".git", ".hg", ".svn", "node_modules", "vendor", "__pycache__"})
    return any(part.startswith(".") or part in _SKIP for part in rel.parts[:-1])


def _extract_tf_blocks(content: str) -> list[tuple[str, str, str]]:
    """从 Terraform 内容提取 (resource_type, logical_name, block_content) 列表。"""
    results: list[tuple[str, str, str]] = []
    for m in _TF_RESOURCE_RE.finditer(content):
        res_type = m.group(1)
        logical_name = m.group(2)
        start = m.end()  # 位于 { 之后
        depth = 1
        i = start
        while i < len(content) and depth > 0:
            ch = content[i]
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
            i += 1
        block_content = content[start: i - 1]
        results.append((res_type, logical_name, block_content))
    return results


def _tf_name_from_block(block_content: str) -> Optional[str]:
    """从 Terraform 块内容提取 name / identifier / function_name 属性值。"""
    m = _TF_NAME_ATTR_RE.search(block_content)
    return m.group(1) if m else None


def _tf_attr(block_content: str, attr: str) -> Optional[str]:
    """提取块内指定属性的值（字符串字面量或引用表达式）。"""
    pattern = re.compile(
        r"^\s*" + re.escape(attr) + r"\s*=\s*([^\n#]+)",
        re.MULTILINE,
    )
    m = pattern.search(block_content)
    if not m:
        return None
    return m.group(1).strip().rstrip(",")


def _add_edge(
    from_id: str,
    to_id: str,
    edge_type: str,
    ig: InfraGraph,
    seen: set[tuple[str, str, str]],
    **properties,
) -> None:
    """去重后添加一条边到 InfraGraph。"""
    key = (from_id, to_id, edge_type)
    if key in seen:
        return
    seen.add(key)
    ig.edges.append(GraphEdge(**{
        "from": from_id,
        "to":   to_id,
        "type": edge_type,
        "properties": properties,
    }))
