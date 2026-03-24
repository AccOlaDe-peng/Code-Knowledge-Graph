"""
AI 描述缓存服务。

管理领域描述和节点描述的缓存存储。
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Optional
from datetime import datetime
from pydantic import BaseModel


class DomainDescription(BaseModel):
    """领域描述模型。"""
    domain_id: str
    summary: str
    core_services: list[str] = []
    data_flow_pattern: str = ""
    generated_at: str
    confidence: float = 0.0


class NodeDescription(BaseModel):
    """节点描述模型。"""
    node_id: str
    description: str
    code_snippet: Optional[str] = None
    highlight_lines: list[int] = []
    generated_at: str
    confidence: float = 0.0


class DescriptionCache:
    """AI 描述缓存管理器。"""

    def __init__(self, base_path: str = "data/ai_descriptions"):
        self.base_path = Path(base_path)
        self.base_path.mkdir(parents=True, exist_ok=True)

    def _get_repo_path(self, repo_id: str) -> Path:
        """获取仓库缓存目录。"""
        repo_path = self.base_path / repo_id
        repo_path.mkdir(parents=True, exist_ok=True)
        return repo_path

    def _get_domains_path(self, repo_id: str) -> Path:
        """获取领域缓存目录。"""
        domains_path = self._get_repo_path(repo_id) / "domains"
        domains_path.mkdir(parents=True, exist_ok=True)
        return domains_path

    def _get_nodes_path(self, repo_id: str) -> Path:
        """获取节点缓存目录。"""
        nodes_path = self._get_repo_path(repo_id) / "nodes"
        nodes_path.mkdir(parents=True, exist_ok=True)
        return nodes_path

    # ─── 领域描述 ─────────────────────────────────────────────────────────────

    def get_domain_description(
        self, repo_id: str, domain_id: str
    ) -> Optional[DomainDescription]:
        """获取领域描述。"""
        # 从 domain_id 提取 key
        domain_key = domain_id.replace("domain:", "")
        file_path = self._get_domains_path(repo_id) / f"{domain_key}.json"

        if not file_path.exists():
            return None

        try:
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return DomainDescription(**data)
        except (json.JSONDecodeError, KeyError):
            return None

    def set_domain_description(
        self, repo_id: str, domain_id: str, description: DomainDescription
    ) -> None:
        """保存领域描述。"""
        domain_key = domain_id.replace("domain:", "")
        file_path = self._get_domains_path(repo_id) / f"{domain_key}.json"

        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(description.model_dump(), f, ensure_ascii=False, indent=2)

    def delete_domain_description(self, repo_id: str, domain_id: str) -> None:
        """删除领域描述。"""
        domain_key = domain_id.replace("domain:", "")
        file_path = self._get_domains_path(repo_id) / f"{domain_key}.json"
        if file_path.exists():
            file_path.unlink()

    # ─── 节点描述 ─────────────────────────────────────────────────────────────

    def get_node_description(
        self, repo_id: str, node_id: str
    ) -> Optional[NodeDescription]:
        """获取节点描述。"""
        # 使用 node_id 的 hash 作为文件名
        node_hash = self._node_id_to_hash(node_id)
        file_path = self._get_nodes_path(repo_id) / f"{node_hash}.json"

        if not file_path.exists():
            return None

        try:
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return NodeDescription(**data)
        except (json.JSONDecodeError, KeyError):
            return None

    def set_node_description(
        self, repo_id: str, node_id: str, description: NodeDescription
    ) -> None:
        """保存节点描述。"""
        node_hash = self._node_id_to_hash(node_id)
        file_path = self._get_nodes_path(repo_id) / f"{node_hash}.json"

        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(description.model_dump(), f, ensure_ascii=False, indent=2)

    def delete_node_description(self, repo_id: str, node_id: str) -> None:
        """删除节点描述。"""
        node_hash = self._node_id_to_hash(node_id)
        file_path = self._get_nodes_path(repo_id) / f"{node_hash}.json"
        if file_path.exists():
            file_path.unlink()

    def get_nodes_descriptions(
        self, repo_id: str, node_ids: list[str]
    ) -> dict[str, NodeDescription]:
        """批量获取节点描述。"""
        result = {}
        for node_id in node_ids:
            desc = self.get_node_description(repo_id, node_id)
            if desc:
                result[node_id] = desc
        return result

    # ─── 缓存管理 ─────────────────────────────────────────────────────────────

    def invalidate_repo(self, repo_id: str) -> None:
        """清除仓库的所有缓存。"""
        repo_path = self._get_repo_path(repo_id)
        if repo_path.exists():
            import shutil
            shutil.rmtree(repo_path)

    def invalidate_domain(self, repo_id: str, domain_id: str) -> None:
        """清除领域缓存。"""
        self.delete_domain_description(repo_id, domain_id)

    def invalidate_node(self, repo_id: str, node_id: str) -> None:
        """清除节点缓存。"""
        self.delete_node_description(repo_id, node_id)

    # ─── 辅助函数 ─────────────────────────────────────────────────────────────

    @staticmethod
    def _node_id_to_hash(node_id: str) -> str:
        """将 node_id 转换为安全的文件名。"""
        import hashlib
        # 使用前 16 位 hash + 原始 id 的安全部分
        hash_part = hashlib.md5(node_id.encode()).hexdigest()[:16]
        safe_part = "".join(c if c.isalnum() else "_" for c in node_id[-32:])
        return f"{hash_part}_{safe_part}"


# 全局缓存实例
_cache: Optional[DescriptionCache] = None


def get_description_cache() -> DescriptionCache:
    """获取描述缓存单例。"""
    global _cache
    if _cache is None:
        _cache = DescriptionCache()
    return _cache
