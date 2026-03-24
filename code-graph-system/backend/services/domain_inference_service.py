"""
业务领域推断服务。

从图谱节点中自动推断业务领域。
"""
from __future__ import annotations

import logging
import re
from collections import Counter
from typing import Any

from backend.services.domain_config_service import (
    DOMAIN_COLORS,
    DOMAIN_NAME_INFERENCE,
    get_domain_config_service,
)

logger = logging.getLogger(__name__)


def extract_business_key(node_id: str) -> str | None:
    """从节点 ID 中提取业务关键字。

    支持的 ID 格式：
    - class:adms-api/src/main/java/.../service/drs/... -> drs
    - function:adms-api/src/main/java/.../controller/mdm/... -> mdm
    """
    if not node_id:
        return None

    # 移除前缀
    body = node_id.split(":", 1)[-1] if ":" in node_id else node_id
    parts = body.split("/")

    # 跳过特殊节点
    special_prefixes = ["datasource", "database", "topic", "external", "module"]
    if len(parts) > 0 and parts[0] in special_prefixes:
        return None

    # 寻找业务目录
    # 典型路径: adms-api/src/main/java/com/activeio/adms/service/drs/...
    # 我们要找的是 service/, controller/, repository/ 后面的目录
    for i, part in enumerate(parts):
        lower_part = part.lower()
        if lower_part in ("service", "services", "controller", "controllers",
                          "repository", "repositories", "mapper", "dao"):
            # 下一个目录就是业务目录
            if i + 1 < len(parts):
                biz_dir = parts[i + 1]
                # 过滤掉一些非业务目录
                if biz_dir.lower() not in ("impl", "dto", "entity", "vo", "util",
                                           "utils", "common", "config", "base"):
                    return biz_dir

    return None


def extract_class_prefix(node_name: str) -> str | None:
    """从类名中提取业务前缀。

    例如：
    - DrsDataService -> Drs
    - MdmController -> Mdm
    - UserService -> User
    """
    if not node_name:
        return None

    # 移除常见后缀
    suffixes = [
        "ServiceImpl", "Service", "Controller", "Repository", "Dao",
        "Mapper", "DaoImpl", "Component", "Handler", "Factory",
    ]
    for suffix in suffixes:
        if node_name.endswith(suffix):
            prefix = node_name[: -len(suffix)]
            if prefix:
                return prefix.lower() if len(prefix) <= 10 else None

    return None


def infer_domains_from_nodes(nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """从节点列表中推断业务领域。

    Args:
        nodes: 节点列表，每个节点包含 id, type, name 等字段

    Returns:
        推断的业务领域列表
    """
    domain_service = get_domain_config_service()

    # 统计业务关键字
    key_counter: Counter[str] = Counter()
    key_samples: dict[str, list[str]] = {}
    key_related: dict[str, set[str]] = {}

    for node in nodes:
        node_id = node.get("id", "")
        node_name = node.get("name", "")
        node_type = node.get("type", "")

        # 只处理特定类型
        if node_type not in ("Service", "Component", "Class", "Function"):
            continue

        # 过滤测试类
        if "/test/" in node_id or "Test" in node_name:
            continue

        # 方式1: 从路径提取
        biz_key = extract_business_key(node_id)

        # 方式2: 从类名提取（备用）
        if not biz_key:
            biz_key = extract_class_prefix(node_name)

        if biz_key:
            key_counter[biz_key] += 1

            # 记录示例节点
            if biz_key not in key_samples:
                key_samples[biz_key] = []
            if len(key_samples[biz_key]) < 3:
                key_samples[biz_key].append(node_name or node_id.split("/")[-1])

            # 记录相关关键字
            if biz_key not in key_related:
                key_related[biz_key] = set()

            # 检查是否有相似的 key
            for other_key in list(key_counter.keys()):
                if other_key != biz_key and (
                    biz_key.lower() in other_key.lower()
                    or other_key.lower() in biz_key.lower()
                ):
                    key_related[biz_key].add(other_key)

    # 构建推断结果
    inferred = []
    used_colors = set()

    for key, count in key_counter.most_common(20):
        if count < 5:  # 过滤太小的领域
            continue

        # 推断名称
        suggested_name = domain_service.infer_domain_name(key)

        # 计算置信度
        # 基于节点数量和是否有明确的目录结构
        confidence = min(0.5 + (count / 100) * 0.3, 0.95)
        if key.lower() in [k.lower() for k in DOMAIN_NAME_INFERENCE.keys()]:
            confidence = min(confidence + 0.3, 0.98)

        # 分配颜色
        color_idx = len(inferred) % len(DOMAIN_COLORS)
        color = DOMAIN_COLORS[color_idx]

        inferred.append({
            "key": key,
            "suggested_name": suggested_name,
            "confidence": round(confidence, 2),
            "node_count": count,
            "related_keys": list(key_related.get(key, [])),
            "sample_nodes": key_samples.get(key, []),
            "suggested_color": color,
        })

    return inferred


def match_node_to_domain(
    node_id: str,
    node_name: str,
    domains: list[dict[str, Any]],
) -> str | None:
    """将节点匹配到已定义的业务领域。

    Args:
        node_id: 节点 ID
        node_name: 节点名称
        domains: 已定义的业务领域列表

    Returns:
        匹配的领域 ID，如果没有匹配则返回 None
    """
    # 从路径提取业务关键字
    biz_key = extract_business_key(node_id)
    if not biz_key:
        biz_key = extract_class_prefix(node_name)

    if not biz_key:
        return None

    # 匹配领域
    biz_key_lower = biz_key.lower()
    for domain in domains:
        domain_key = domain.get("key", "").lower()
        aliases = [a.lower() for a in domain.get("aliases", [])]

        if biz_key_lower == domain_key or biz_key_lower in aliases:
            return domain["id"]

        # 模糊匹配
        if domain_key in biz_key_lower or biz_key_lower in domain_key:
            return domain["id"]

    return None
