"""
业务领域配置 API 路由。

提供业务领域配置的管理和自动推断接口。
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from backend.api.deps import get_graph_storage
from backend.services.domain_config_service import get_domain_config_service
from backend.services.domain_inference_service import infer_domains_from_nodes

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
