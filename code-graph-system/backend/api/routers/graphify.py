"""Graphify 分析 API：POST /analyze/graphify"""
from __future__ import annotations

import logging
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.services.graphify_runner import GraphifyRunner

logger = logging.getLogger(__name__)
router = APIRouter()


class GraphifyRequest(BaseModel):
    """POST /analyze/graphify 请求体。"""
    repo_path: str = Field(description="仓库根目录（本地绝对路径）")
    repo_name: str = Field(default="", description="图谱名称")
    repo_id: Optional[str] = Field(default=None, description="前端 repo_store 中的仓库 ID")


class GraphifyAsyncResponse(BaseModel):
    """POST /analyze/graphify 异步响应。"""
    task_id: str
    status: str = "pending"


@router.post("/analyze/graphify", response_model=GraphifyAsyncResponse, tags=["分析"])
def analyze_graphify(req: GraphifyRequest):
    """
    提交 Graphify 分析任务（异步）。通过 Claude Code CLI 执行 /graphify skill。

    返回 task_id，通过 GET /analyze/stream/{task_id} 订阅实时进度。
    """
    task_id = str(uuid.uuid4())

    logger.info(
        "POST /analyze/graphify  path=%s  name=%s  task_id=%s",
        req.repo_path, req.repo_name, task_id,
    )

    # 注册分析状态
    from backend.store.repo_status_store import get_repo_status_store
    status_store = get_repo_status_store()
    legacy_repo_id = req.repo_name or req.repo_path.rstrip("/").split("/")[-1]
    status_store.set_analyzing(
        legacy_repo_id,
        task_id=task_id,
        repo_name=req.repo_name or legacy_repo_id,
        repo_path=req.repo_path,
    )

    # 在后台线程执行（不阻塞请求）
    import threading

    def _update_status(stage: str, step: int, total: int, message: str) -> None:
        """更新仓库状态（供 GraphifyRunner 回调）。"""
        status_store.update_progress(
            legacy_repo_id,
            stage=stage,
            step=step,
            total=total,
            message=message,
        )

    def _run_graphify():
        try:
            runner = GraphifyRunner(on_progress=_update_status)
            result = runner.run(req.repo_path, repo_name=req.repo_name)

            if result.success:
                validation = runner.validate_output(repo_name=req.repo_name or legacy_repo_id)
                if validation.all_exist:
                    status_store.set_completed(
                        legacy_repo_id,
                        graph_id=req.repo_name or legacy_repo_id,
                    )
                    logger.info("Graphify 完成: %s", legacy_repo_id)
                else:
                    status_store.set_failed(
                        legacy_repo_id,
                        error=f"部分文件未生成: {', '.join(validation.missing)}",
                    )
                    logger.warning("Graphify 部分完成: %s missing %s", legacy_repo_id, validation.missing)
            else:
                status_store.set_failed(legacy_repo_id, error=result.error)
                logger.error("Graphify 失败: %s — %s", legacy_repo_id, result.error)
        except Exception as exc:
            status_store.set_failed(legacy_repo_id, error=str(exc))
            logger.exception("Graphify 异常: %s", legacy_repo_id)

    thread = threading.Thread(target=_run_graphify, daemon=True)
    thread.start()

    return GraphifyAsyncResponse(task_id=task_id, status="pending")
