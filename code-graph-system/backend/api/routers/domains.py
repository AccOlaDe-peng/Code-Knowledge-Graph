"""
业务领域配置 API 路由。

提供业务领域配置的管理和自动推断接口。
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from backend.api.deps import get_graph_storage
from backend.services.domain_config_service import get_domain_config_service
from backend.services.domain_inference_service import infer_domains_from_nodes
from backend.services.description_cache import (
    get_description_cache,
    DomainDescription,
    NodeDescription,
)

logger = logging.getLogger(__name__)
router = APIRouter()


# ─── 请求/响应模型 ────────────────────────────────────────────────────────────


class DomainDefinition(BaseModel):
    """业务领域定义。"""

    id: str = Field(..., description="领域唯一标识，如 domain:drs")
    key: str = Field(..., description="目录关键字，如 drs")
    name: str = Field(..., description="显示名称，如 数据报表服务")
    aliases: list[str] = Field(default_factory=list, description="别名列表")
    color: str = Field(default="#00d4ff", description="显示颜色")
    icon: Optional[str] = Field(default=None, description="可选图标")
    description: Optional[str] = Field(default=None, description="可选描述")
    tags: list[str] = Field(default_factory=list, description="可选标签")


class DomainConfigResponse(BaseModel):
    """领域配置响应。"""

    repo_id: str
    version: int
    last_modified: str
    domains: list[DomainDefinition]


class DomainConfigUpdate(BaseModel):
    """领域配置更新请求。"""

    domains: list[DomainDefinition] = Field(..., description="领域定义列表")


class InferredDomain(BaseModel):
    """推断的业务领域。"""

    key: str = Field(..., description="目录关键字")
    suggested_name: str = Field(..., description="推断的中文名称")
    confidence: float = Field(..., description="置信度 0-1")
    node_count: int = Field(..., description="节点数量")
    related_keys: list[str] = Field(default_factory=list, description="相关关键字")
    sample_nodes: list[str] = Field(default_factory=list, description="示例节点")
    suggested_color: str = Field(default="#00d4ff", description="建议颜色")


class InferResponse(BaseModel):
    """推断响应。"""

    repo_id: str
    inferred: list[InferredDomain]


class DomainDescriptionResponse(BaseModel):
    """领域描述响应。"""
    domain_id: str
    summary: str
    core_services: list[str] = []
    data_flow_pattern: str = ""
    generated_at: str
    confidence: float = 0.0


class CodeSnippetResponse(BaseModel):
    """代码片段响应。"""
    node_id: str
    language: str
    content: str
    start_line: int
    end_line: int
    highlight_lines: list[int] = []


class NodeDetailResponse(BaseModel):
    """节点详情响应。"""
    node_id: str
    name: str
    type: str
    file: str
    signature: Optional[str] = None
    line: Optional[int] = None
    end_line: Optional[int] = None
    ai_description: Optional[str] = None
    code_snippet: Optional[CodeSnippetResponse] = None
    call_count: int = 0
    called_by_count: int = 0
    dependencies: list[str] = []
    generated_at: Optional[str] = None


class BatchNodeInfoRequest(BaseModel):
    """批量节点信息请求。"""
    repo_id: str
    domain_id: str
    node_ids: list[str]


class BatchNodeInfoResponse(BaseModel):
    """批量节点信息响应。"""
    domain_id: str
    domain_description: Optional[DomainDescriptionResponse] = None
    nodes: list[NodeDetailResponse] = []
    cached: bool = True


# ─── API 端点 ─────────────────────────────────────────────────────────────────


@router.get("/graph/lineage/domains/config", tags=["图谱视图"])
def get_domain_config(
    repo_id: str = Query(description="仓库 ID"),
) -> dict[str, Any]:
    """
    获取仓库的业务领域配置。

    如果配置不存在，返回默认空配置。
    """
    service = get_domain_config_service()
    config = service.load_config(repo_id)
    return config


@router.post("/graph/lineage/domains/config", tags=["图谱视图"])
def save_domain_config(
    repo_id: str = Query(description="仓库 ID"),
    config: DomainConfigUpdate = ...,
) -> dict[str, Any]:
    """
    保存仓库的业务领域配置。

    会自动更新版本号和时间戳。
    """
    service = get_domain_config_service()

    # 构建完整配置
    full_config = {
        "repo_id": repo_id,
        "domains": [d.model_dump() for d in config.domains],
    }

    service.save_config(repo_id, full_config)
    return service.load_config(repo_id)


@router.get("/graph/lineage/domains/infer", tags=["图谱视图"])
def infer_domains(
    repo_id: str = Query(description="仓库 ID"),
) -> dict[str, Any]:
    """
    自动推断业务领域。

    基于图谱节点的路径和命名规则，推断可能的业务领域。
    """
    # 加载图谱数据
    try:
        storage = get_graph_storage()

        # 尝试直接用 repo_id 加载
        if storage.repo_exists(repo_id):
            graph = storage.load_graph(repo_id)
        else:
            # 尝试从 analysis_store 获取最新 graph_id
            from backend.store.analysis_store import get_analysis_store
            analysis_store = get_analysis_store()
            latest = analysis_store.get_latest(repo_id)

            if latest and latest.get("graph_id"):
                graph_id = latest["graph_id"]
                if storage.repo_exists(graph_id):
                    graph = storage.load_graph(graph_id)
                else:
                    raise HTTPException(status_code=404, detail=f"图谱不存在: {graph_id}")
            else:
                raise HTTPException(status_code=404, detail=f"仓库不存在: {repo_id}")

    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("加载图谱失败: %s", repo_id)
        raise HTTPException(status_code=500, detail=str(exc))

    # 推断业务领域
    nodes = graph.get("nodes", [])
    inferred = infer_domains_from_nodes(nodes)

    return {
        "repo_id": repo_id,
        "inferred": inferred,
    }


# ─── 领域描述 API ─────────────────────────────────────────────────────────────


@router.get("/graph/lineage/domains/{domain_id}/description", tags=["图谱视图"])
def get_domain_description(
    domain_id: str,
    repo_id: str = Query(description="仓库 ID"),
) -> DomainDescriptionResponse:
    """
    获取领域的 AI 描述。

    如果缓存中不存在，返回默认占位描述。
    """
    cache = get_description_cache()
    desc = cache.get_domain_description(repo_id, domain_id)

    if desc:
        return DomainDescriptionResponse(
            domain_id=desc.domain_id,
            summary=desc.summary,
            core_services=desc.core_services,
            data_flow_pattern=desc.data_flow_pattern,
            generated_at=desc.generated_at,
            confidence=desc.confidence,
        )

    # 返回默认占位描述
    domain_key = domain_id.replace("domain:", "")
    return DomainDescriptionResponse(
        domain_id=domain_id,
        summary=f"暂无 AI 生成的描述。领域 {domain_key} 的功能描述待生成。",
        core_services=[],
        data_flow_pattern="",
        generated_at=datetime.utcnow().isoformat(),
        confidence=0.0,
    )


# ─── 节点批量信息 API ─────────────────────────────────────────────────────────


@router.post("/graph/lineage/nodes/batch-info", tags=["图谱视图"])
def get_batch_node_info(
    request: BatchNodeInfoRequest,
) -> BatchNodeInfoResponse:
    """
    批量获取节点详情。

    返回节点的基础信息、AI 描述、代码片段等。
    """
    cache = get_description_cache()

    # 获取领域描述
    domain_desc = cache.get_domain_description(request.repo_id, request.domain_id)
    domain_description = None
    if domain_desc:
        domain_description = DomainDescriptionResponse(
            domain_id=domain_desc.domain_id,
            summary=domain_desc.summary,
            core_services=domain_desc.core_services,
            data_flow_pattern=domain_desc.data_flow_pattern,
            generated_at=domain_desc.generated_at,
            confidence=domain_desc.confidence,
        )

    # 加载图谱数据
    nodes_data = {}
    edges_data = []
    try:
        storage = get_graph_storage()

        # 尝试直接用 repo_id 加载
        if storage.repo_exists(request.repo_id):
            graph = storage.load_graph(request.repo_id)
        else:
            from backend.store.analysis_store import get_analysis_store
            analysis_store = get_analysis_store()
            latest = analysis_store.get_latest(request.repo_id)

            if latest and latest.get("graph_id"):
                graph = storage.load_graph(latest["graph_id"])
            else:
                graph = {"nodes": [], "edges": []}

        # 构建节点索引
        for node in graph.get("nodes", []):
            nodes_data[node.get("id")] = node

        edges_data = graph.get("edges", [])

    except Exception as exc:
        logger.warning("加载图谱数据失败: %s", exc)

    # 计算调用统计
    call_counts = {}
    called_by_counts = {}
    dependencies = {}

    for edge in edges_data:
        from_id = edge.get("from")
        to_id = edge.get("to")
        edge_type = edge.get("type", "")

        if edge_type == "calls":
            call_counts[from_id] = call_counts.get(from_id, 0) + 1
            called_by_counts[to_id] = called_by_counts.get(to_id, 0) + 1

            if from_id not in dependencies:
                dependencies[from_id] = []
            dependencies[from_id].append(to_id)

    # 构建节点详情
    nodes = []
    for node_id in request.node_ids:
        node = nodes_data.get(node_id)
        if not node:
            continue

        props = node.get("properties", {})

        # 获取 AI 描述
        node_desc = cache.get_node_description(request.repo_id, node_id)
        ai_description = node_desc.description if node_desc else None

        # 构建响应
        node_detail = NodeDetailResponse(
            node_id=node_id,
            name=node.get("name", node_id.split(":")[-1]),
            type=node.get("type", "Unknown"),
            file=props.get("file", ""),
            signature=props.get("signature"),
            line=props.get("line"),
            end_line=props.get("end_line"),
            ai_description=ai_description,
            code_snippet=None,  # 代码片段需要单独请求
            call_count=call_counts.get(node_id, 0),
            called_by_count=called_by_counts.get(node_id, 0),
            dependencies=dependencies.get(node_id, [])[:10],
            generated_at=node_desc.generated_at if node_desc else None,
        )
        nodes.append(node_detail)

    return BatchNodeInfoResponse(
        domain_id=request.domain_id,
        domain_description=domain_description,
        nodes=nodes,
        cached=True,
    )


# ─── 代码片段 API ─────────────────────────────────────────────────────────────


@router.get("/graph/lineage/nodes/{node_id}/code", tags=["图谱视图"])
def get_node_code(
    node_id: str,
    repo_id: str = Query(description="仓库 ID"),
    highlight: bool = Query(default=True, description="是否高亮关键行"),
) -> CodeSnippetResponse:
    """
    获取节点的代码片段。

    从源代码文件中提取指定节点相关的代码片段。
    """
    from backend.services.code_snippet_service import get_code_snippet_service

    # 加载图谱数据获取节点信息
    try:
        storage = get_graph_storage()

        if storage.repo_exists(repo_id):
            graph = storage.load_graph(repo_id)
        else:
            from backend.store.analysis_store import get_analysis_store
            analysis_store = get_analysis_store()
            latest = analysis_store.get_latest(repo_id)

            if latest and latest.get("graph_id"):
                graph = storage.load_graph(latest["graph_id"])
            else:
                raise HTTPException(status_code=404, detail=f"仓库不存在: {repo_id}")

        # 查找节点
        node = None
        for n in graph.get("nodes", []):
            if n.get("id") == node_id:
                node = n
                break

        if not node:
            raise HTTPException(status_code=404, detail=f"节点不存在: {node_id}")

    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("加载图谱失败: %s", repo_id)
        raise HTTPException(status_code=500, detail=str(exc))

    props = node.get("properties", {})
    file_path = props.get("file", "")
    line = props.get("line")

    if not file_path:
        raise HTTPException(status_code=404, detail="节点无文件路径信息")

    # 提取代码片段
    snippet_service = get_code_snippet_service()

    # 尝试获取仓库路径
    try:
        from backend.store.analysis_store import get_analysis_store
        analysis_store = get_analysis_store()
        repo_info = analysis_store.get_repo(repo_id)
        if repo_info and repo_info.get("path"):
            snippet_service.set_repo_base_path(repo_info["path"])
    except Exception:
        pass

    if line:
        snippet = snippet_service.extract_snippet(
            file_path, line, context_lines=5, max_lines=25
        )
    else:
        snippet = snippet_service.extract_snippet(
            file_path, 1, context_lines=0, max_lines=25
        )

    if not snippet:
        raise HTTPException(status_code=404, detail="无法提取代码片段")

    return CodeSnippetResponse(
        node_id=node_id,
        language=snippet.language,
        content=snippet.content,
        start_line=snippet.start_line,
        end_line=snippet.end_line,
        highlight_lines=snippet.highlight_lines if highlight else [],
    )
