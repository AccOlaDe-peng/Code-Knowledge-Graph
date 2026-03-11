"""
定时任务调度模块。

使用 APScheduler 实现定时任务：
- 定期增量更新图谱
- 清理过期数据
- 生成统计报告
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

logger = logging.getLogger(__name__)


class TaskScheduler:
    """
    任务调度器。

    管理后台定时任务的执行。

    示例::

        scheduler = TaskScheduler()
        scheduler.start()
        scheduler.add_incremental_update_job("/path/to/repo", interval_hours=6)
    """

    def __init__(self) -> None:
        """初始化调度器。"""
        self.scheduler = BackgroundScheduler()
        self._running = False

    def start(self) -> None:
        """启动调度器。"""
        if not self._running:
            self.scheduler.start()
            self._running = True
            logger.info("任务调度器已启动")

    def stop(self) -> None:
        """停止调度器。"""
        if self._running:
            self.scheduler.shutdown()
            self._running = False
            logger.info("任务调度器已停止")

    def add_incremental_update_job(
        self,
        repo_path: str,
        graph_id: str,
        interval_hours: int = 6,
    ) -> str:
        """
        添加增量更新任务。

        Args:
            repo_path: 仓库路径
            graph_id: 图谱 ID
            interval_hours: 更新间隔（小时）

        Returns:
            任务 ID
        """
        job = self.scheduler.add_job(
            func=self._incremental_update,
            trigger="interval",
            hours=interval_hours,
            args=[repo_path, graph_id],
            id=f"incremental_update_{graph_id}",
            replace_existing=True,
        )
        logger.info(f"已添加增量更新任务: {graph_id}, 间隔 {interval_hours}h")
        return job.id

    def add_cleanup_job(self, max_age_days: int = 30) -> str:
        """
        添加数据清理任务（每天凌晨 2 点执行）。

        Args:
            max_age_days: 保留数据的最大天数

        Returns:
            任务 ID
        """
        job = self.scheduler.add_job(
            func=self._cleanup_old_data,
            trigger=CronTrigger(hour=2, minute=0),
            args=[max_age_days],
            id="cleanup_old_data",
            replace_existing=True,
        )
        logger.info(f"已添加数据清理任务: 保留 {max_age_days} 天")
        return job.id

    def remove_job(self, job_id: str) -> bool:
        """
        移除指定任务。

        Args:
            job_id: 任务 ID

        Returns:
            移除成功返回 True
        """
        try:
            self.scheduler.remove_job(job_id)
            logger.info(f"已移除任务: {job_id}")
            return True
        except Exception as e:
            logger.warning(f"移除任务失败 {job_id}: {e}")
            return False

    def list_jobs(self) -> list[dict]:
        """
        列出所有任务。

        Returns:
            任务信息列表
        """
        jobs = []
        for job in self.scheduler.get_jobs():
            jobs.append({
                "id": job.id,
                "name": job.name,
                "next_run": job.next_run_time.isoformat() if job.next_run_time else None,
            })
        return jobs

    # ------------------------------------------------------------------
    # 任务实现
    # ------------------------------------------------------------------

    def _incremental_update(self, repo_path: str, graph_id: str) -> None:
        """增量更新任务实现。"""
        logger.info(f"开始增量更新: {graph_id}")
        try:
            from backend.graph.schema import AnalysisRequest
            from backend.pipeline.analyze_repository import AnalysisPipeline

            pipeline = AnalysisPipeline()
            request = AnalysisRequest(
                repo_path=repo_path,
                repo_id=graph_id,
                incremental=True,
                enable_ai=False,
            )
            response = pipeline.analyze(request)
            logger.info(f"增量更新完成: {response.status}")
        except Exception as e:
            logger.error(f"增量更新失败: {e}")

    def _cleanup_old_data(self, max_age_days: int) -> None:
        """清理过期数据任务实现。"""
        logger.info(f"开始清理 {max_age_days} 天前的数据")
        try:
            from backend.graph.graph_repository import GraphRepository

            repo = GraphRepository()
            graphs = repo.list_graphs()
            cutoff = datetime.now().timestamp() - (max_age_days * 86400)

            deleted_count = 0
            for g in graphs:
                created_at = datetime.fromisoformat(g["created_at"]).timestamp()
                if created_at < cutoff:
                    repo.delete(g["id"])
                    deleted_count += 1

            logger.info(f"清理完成，删除 {deleted_count} 个过期图谱")
        except Exception as e:
            logger.error(f"数据清理失败: {e}")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    scheduler = TaskScheduler()
    scheduler.start()
    print("调度器已启动")
    print("任务列表:", scheduler.list_jobs())
    import time
    time.sleep(5)
    scheduler.stop()
