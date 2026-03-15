"""仓库分析状态存储模块。

提供对仓库分析状态的持久化管理，支持：
    - 正在分析的仓库（status=analyzing）
    - 已完成的仓库（status=completed）
    - 失败的仓库（status=failed）
    - 已取消的仓库（status=canceled）

存储格式（data/repos/status.json）：
{
    "repo_id": {
        "repo_id":      "repo-xxx",
        "graph_id":     "graph-xxx",      # 完成后填充
        "repo_name":    "my-project",
        "repo_path":    "/path/to/repo",
        "task_id":      "celery-task-id", # 分析中时存在
        "status":       "analyzing",
        "stage":        "code_analyzer",
        "step":         3,
        "total":        6,
        "message":      "AI 代码分析...",
        "node_count":   0,
        "edge_count":   0,
        "created_at":   "2026-03-16T10:00:00Z",
        "updated_at":   "2026-03-16T10:05:00Z",
    },
    ...
}
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

_DEFAULT_STORAGE_DIR = "./data/repos"


class RepoStatusStore:
    """仓库分析状态存储。

    示例::

        store = RepoStatusStore()

        # 创建/更新仓库状态
        store.set_status(
            repo_id="repo-123",
            repo_name="my-project",
            repo_path="/path/to/repo",
            task_id="celery-xxx",
            status="analyzing",
            stage="scanner",
            step=1,
            total=6,
            message="扫描文件...",
        )

        # 获取单个仓库状态
        status = store.get_status("repo-123")

        # 列出所有仓库状态
        all_repos = store.list_all()

        # 更新进度
        store.update_progress("repo-123", stage="code_analyzer", step=3, message="AI 分析中...")

        # 标记完成
        store.set_completed("repo-123", graph_id="graph-456", node_count=100, edge_count=200)

        # 删除仓库
        store.delete("repo-123")
    """

    def __init__(self, storage_dir: str = _DEFAULT_STORAGE_DIR) -> None:
        self.storage_dir = Path(storage_dir)
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self._status_file = self.storage_dir / "status.json"

    def _load_all(self) -> dict[str, dict[str, Any]]:
        """加载所有仓库状态。"""
        if not self._status_file.exists():
            return {}
        try:
            return json.loads(self._status_file.read_text(encoding="utf-8"))
        except Exception:
            logger.warning("加载仓库状态失败，返回空字典")
            return {}

    def _save_all(self, data: dict[str, dict[str, Any]]) -> None:
        """保存所有仓库状态。"""
        self._status_file.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _now_iso(self) -> str:
        """返回当前时间的 ISO 8601 字符串。"""
        return datetime.now(timezone.utc).isoformat()

    def get_status(self, repo_id: str) -> Optional[dict[str, Any]]:
        """获取单个仓库状态。"""
        all_data = self._load_all()
        return all_data.get(repo_id)

    def list_all(self) -> list[dict[str, Any]]:
        """列出所有仓库状态。"""
        return list(self._load_all().values())

    def set_status(
        self,
        repo_id: str,
        *,
        repo_name: str = "",
        repo_path: str = "",
        task_id: Optional[str] = None,
        graph_id: Optional[str] = None,
        status: str = "saved",
        stage: str = "",
        step: int = 0,
        total: int = 6,
        message: str = "",
        node_count: int = 0,
        edge_count: int = 0,
        error: Optional[str] = None,
    ) -> dict[str, Any]:
        """设置仓库状态（创建或更新）。"""
        all_data = self._load_all()
        now = self._now_iso()

        # 保留 created_at（如果已存在）
        existing = all_data.get(repo_id, {})
        created_at = existing.get("created_at", now)

        repo_status = {
            "repo_id": repo_id,
            "graph_id": graph_id or existing.get("graph_id", ""),
            "repo_name": repo_name or existing.get("repo_name", repo_id),
            "repo_path": repo_path or existing.get("repo_path", ""),
            "task_id": task_id,
            "status": status,
            "stage": stage,
            "step": step,
            "total": total,
            "message": message,
            "node_count": node_count or existing.get("node_count", 0),
            "edge_count": edge_count or existing.get("edge_count", 0),
            "error": error,
            "created_at": created_at,
            "updated_at": now,
        }

        all_data[repo_id] = repo_status
        self._save_all(all_data)
        logger.debug("仓库状态已更新: %s -> %s", repo_id, status)
        return repo_status

    def update_progress(
        self,
        repo_id: str,
        *,
        stage: Optional[str] = None,
        step: Optional[int] = None,
        total: Optional[int] = None,
        message: Optional[str] = None,
    ) -> Optional[dict[str, Any]]:
        """更新分析进度。"""
        all_data = self._load_all()
        if repo_id not in all_data:
            logger.warning("仓库不存在，无法更新进度: %s", repo_id)
            return None

        repo = all_data[repo_id]
        repo["status"] = "analyzing"
        repo["updated_at"] = self._now_iso()

        if stage is not None:
            repo["stage"] = stage
        if step is not None:
            repo["step"] = step
        if total is not None:
            repo["total"] = total
        if message is not None:
            repo["message"] = message

        self._save_all(all_data)
        return repo

    def set_analyzing(
        self,
        repo_id: str,
        *,
        task_id: str,
        repo_name: str = "",
        repo_path: str = "",
    ) -> dict[str, Any]:
        """标记仓库为分析中状态。"""
        return self.set_status(
            repo_id,
            repo_name=repo_name,
            repo_path=repo_path,
            task_id=task_id,
            status="analyzing",
            stage="pending",
            step=0,
            message="任务已排队，等待 Worker...",
        )

    def set_completed(
        self,
        repo_id: str,
        *,
        graph_id: str,
        node_count: int = 0,
        edge_count: int = 0,
        duration_seconds: float = 0,
    ) -> dict[str, Any]:
        """标记仓库为已完成状态。"""
        return self.set_status(
            repo_id,
            graph_id=graph_id,
            task_id=None,  # 清除 task_id
            status="completed",
            stage="completed",
            node_count=node_count,
            edge_count=edge_count,
            message=f"分析完成，耗时 {duration_seconds:.1f}s",
        )

    def set_failed(
        self,
        repo_id: str,
        *,
        error: str,
    ) -> dict[str, Any]:
        """标记仓库为失败状态。"""
        return self.set_status(
            repo_id,
            task_id=None,
            status="failed",
            error=error,
            message=f"分析失败: {error}",
        )

    def set_canceled(self, repo_id: str) -> dict[str, Any]:
        """标记仓库为已取消状态。"""
        return self.set_status(
            repo_id,
            task_id=None,
            status="canceled",
            message="用户取消分析",
        )

    def delete(self, repo_id: str) -> bool:
        """删除仓库状态。"""
        all_data = self._load_all()
        if repo_id in all_data:
            del all_data[repo_id]
            self._save_all(all_data)
            logger.info("仓库状态已删除: %s", repo_id)
            return True
        return False

    def get_by_task_id(self, task_id: str) -> Optional[dict[str, Any]]:
        """根据 task_id 查找仓库状态。"""
        all_data = self._load_all()
        for repo in all_data.values():
            if repo.get("task_id") == task_id:
                return repo
        return None

    def sync_from_graphs(self, graphs: list[dict[str, Any]]) -> None:
        """从 GraphRepository.list_graphs() 同步已完成的仓库。

        用于启动时同步现有图谱到状态存储。
        """
        all_data = self._load_all()
        now = self._now_iso()

        for graph in graphs:
            graph_id = graph.get("graph_id", "")
            if not graph_id:
                continue

            # 如果已存在且状态为 analyzing，跳过（正在分析中）
            existing = all_data.get(graph_id)
            if existing and existing.get("status") == "analyzing":
                continue

            # 同步已完成的图谱
            all_data[graph_id] = {
                "repo_id": graph_id,
                "graph_id": graph_id,
                "repo_name": graph.get("repo_name", graph_id),
                "repo_path": graph.get("repo_path", ""),
                "task_id": None,
                "status": "completed",
                "stage": "completed",
                "step": 6,
                "total": 6,
                "message": "分析完成",
                "node_count": graph.get("node_count", 0),
                "edge_count": graph.get("edge_count", 0),
                "error": None,
                "created_at": graph.get("created_at", now),
                "updated_at": now,
                "git_commit": graph.get("git_commit", ""),
            }

        self._save_all(all_data)
        logger.info("已同步 %d 个图谱到仓库状态存储", len(graphs))


# 全局单例
_repo_status_store: Optional[RepoStatusStore] = None


def get_repo_status_store() -> RepoStatusStore:
    """获取全局 RepoStatusStore 单例。"""
    global _repo_status_store
    if _repo_status_store is None:
        _repo_status_store = RepoStatusStore()
    return _repo_status_store
