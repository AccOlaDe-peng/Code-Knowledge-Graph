"""分析事件观察器 — 线程安全事件队列 + asyncio 桥接 + SSE 支持。

用于实时推送分析进度、失败诊断、质量报告。
"""
from __future__ import annotations

import asyncio
import json
import logging
import queue
import threading
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# 事件类型定义
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class AnalysisEvent:
    """分析事件基类。"""

    event_type: str
    timestamp: float = field(default_factory=lambda: datetime.now().timestamp())
    data: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "event_type": self.event_type,
            "timestamp": self.timestamp,
            **self.data,
        }


@dataclass
class StreamEnd(AnalysisEvent):
    """流结束信号。"""

    event_type: str = "stream_end"


@dataclass
class StageStarted(AnalysisEvent):
    """Stage 开始事件。"""

    event_type: str = "stage_started"

    @classmethod
    def create(
        cls,
        stage: str,
        file_count: int = 0,
        is_incremental: bool = False,
    ) -> "StageStarted":
        return cls(
            event_type="stage_started",
            data={
                "stage": stage,
                "file_count": file_count,
                "is_incremental": is_incremental,
            },
        )


@dataclass
class StageCompleted(AnalysisEvent):
    """Stage 完成事件。"""

    event_type: str = "stage_completed"

    @classmethod
    def create(
        cls,
        stage: str,
        elapsed_ms: int,
        cache_hit: bool = False,
    ) -> "StageCompleted":
        return cls(
            event_type="stage_completed",
            data={
                "stage": stage,
                "elapsed_ms": elapsed_ms,
                "cache_hit": cache_hit,
            },
        )


@dataclass
class ModuleAnalysisStarted(AnalysisEvent):
    """模块分析开始事件。"""

    event_type: str = "module_analysis_started"

    @classmethod
    def create(
        cls,
        module_id: str,
        file_count: int,
        has_warnings: bool = False,
    ) -> "ModuleAnalysisStarted":
        return cls(
            event_type="module_analysis_started",
            data={
                "module_id": module_id,
                "file_count": file_count,
                "has_warnings": has_warnings,
            },
        )


@dataclass
class ModuleAnalysisCompleted(AnalysisEvent):
    """模块分析完成事件。"""

    event_type: str = "module_analysis_completed"

    @classmethod
    def create(
        cls,
        module_id: str,
        node_count: int,
        edge_count: int,
        elapsed_ms: int,
        source: str = "ai",
    ) -> "ModuleAnalysisCompleted":
        return cls(
            event_type="module_analysis_completed",
            data={
                "module_id": module_id,
                "node_count": node_count,
                "edge_count": edge_count,
                "elapsed_ms": elapsed_ms,
                "source": source,
            },
        )


@dataclass
class ModuleAnalysisFailed(AnalysisEvent):
    """模块分析失败事件（含 raw LLM 输出）。"""

    event_type: str = "module_analysis_failed"

    @classmethod
    def create(
        cls,
        module_id: str,
        stage: str,
        reason: str,
        raw_llm_output: str | None = None,
        retry_count: int = 0,
    ) -> "ModuleAnalysisFailed":
        return cls(
            event_type="module_analysis_failed",
            data={
                "module_id": module_id,
                "stage": stage,
                "reason": reason,
                "raw_llm_output": raw_llm_output,
                "retry_count": retry_count,
            },
        )


@dataclass
class LowConfidenceWarning(AnalysisEvent):
    """低置信度警告事件。"""

    event_type: str = "low_confidence_warning"

    @classmethod
    def create(
        cls,
        module_id: str,
        edge_id: str,
        confidence: float,
        description: str,
    ) -> "LowConfidenceWarning":
        return cls(
            event_type="low_confidence_warning",
            data={
                "module_id": module_id,
                "edge_id": edge_id,
                "confidence": confidence,
                "description": description,
            },
        )


@dataclass
class BoundaryWarning(AnalysisEvent):
    """模块边界警告事件。"""

    event_type: str = "boundary_warning"

    @classmethod
    def create(
        cls,
        module_id: str,
        message: str,
    ) -> "BoundaryWarning":
        return cls(
            event_type="boundary_warning",
            data={
                "module_id": module_id,
                "message": message,
            },
        )


@dataclass
class AnalysisCompleted(AnalysisEvent):
    """分析完成事件（含质量报告）。"""

    event_type: str = "analysis_completed"

    @classmethod
    def create(
        cls,
        quality_report: dict[str, Any],
    ) -> "AnalysisCompleted":
        return cls(
            event_type="analysis_completed",
            data={"quality_report": quality_report},
        )


@dataclass
class StageMetrics(AnalysisEvent):
    """Stage 性能指标事件。"""

    event_type: str = "stage_metrics"

    @classmethod
    def create(
        cls,
        stage: str,
        duration_ms: int,
        llm_calls: int = 0,
        cache_hits: int = 0,
        token_count: int = 0,
    ) -> "StageMetrics":
        return cls(
            event_type="stage_metrics",
            data={
                "stage": stage,
                "duration_ms": duration_ms,
                "llm_calls": llm_calls,
                "cache_hits": cache_hits,
                "token_count": token_count,
            },
        )


# ─────────────────────────────────────────────────────────────────────────────
# AnalysisObserver
# ─────────────────────────────────────────────────────────────────────────────


class AnalysisObserver:
    """分析事件观察器。

    线程安全：使用 queue.Queue 接收来自 ThreadPoolExecutor / ProcessPoolExecutor 的事件。
    asyncio 桥接：stream() 方法使用 run_in_executor 不阻塞事件循环。

    用法：
        observer = AnalysisObserver()

        # 分析线程中发送事件
        observer.emit(StageStarted.create("file_index", file_count=100))

        # FastAPI SSE endpoint 中消费事件
        async def stream_events(request: Request):
            async for event in observer.stream():
                yield f"data: {json.dumps(event.to_dict())}\\n\\n"
    """

    def __init__(
        self,
        task_id: str | None = None,
        log_dir: Path | None = None,
    ):
        """
        Args:
            task_id: 任务 ID（用于日志文件名），默认自动生成
            log_dir: 日志目录，默认 logs/
        """
        self.task_id = task_id or str(uuid4())[:8]
        self._sync_queue: queue.Queue[AnalysisEvent | None] = queue.Queue()
        self._lock = threading.Lock()
        self._closed = False

        # 日志落盘
        self._log_dir = log_dir or Path("logs")
        self._log_dir.mkdir(parents=True, exist_ok=True)
        self._log_file = self._log_dir / f"analysis-{self.task_id}.jsonl"
        self._log_handle: Any = None

    def emit(self, event: AnalysisEvent) -> None:
        """发送事件（线程安全，非阻塞）。

        事件会被放入队列并落盘到日志文件。
        """
        if self._closed:
            logger.warning("Observer 已关闭，忽略事件: %s", event.event_type)
            return

        self._sync_queue.put(event)

        # 落盘到日志
        self._write_log(event)

    def emit_end(self) -> None:
        """发送流结束信号。"""
        self._sync_queue.put(StreamEnd())
        self._close()

    def _write_log(self, event: AnalysisEvent) -> None:
        """将事件写入日志文件。"""
        try:
            if self._log_handle is None:
                self._log_handle = self._log_file.open("a", encoding="utf-8")
            self._log_handle.write(json.dumps(event.to_dict(), ensure_ascii=False) + "\n")
            self._log_handle.flush()
        except OSError as e:
            logger.warning("写入事件日志失败: %s", e)

    def _close(self) -> None:
        """关闭观察器。"""
        with self._lock:
            self._closed = True
            if self._log_handle is not None:
                try:
                    self._log_handle.close()
                except OSError:
                    pass
                self._log_handle = None

    async def stream(self):
        """异步事件流（供 FastAPI SSE 使用）。

        使用 asyncio.get_running_loop() + run_in_executor 桥接同步队列，
        不阻塞 asyncio 事件循环。
        """
        loop = asyncio.get_running_loop()

        while True:
            # 在 executor 中阻塞等待，不阻塞事件循环
            event = await loop.run_in_executor(None, self._sync_queue.get)

            if event is None or isinstance(event, StreamEnd):
                break

            yield event


# ─────────────────────────────────────────────────────────────────────────────
# 全局 Observer 管理器（用于多任务场景）
# ─────────────────────────────────────────────────────────────────────────────


class ObserverManager:
    """Observer 管理器。

    用于管理多个分析任务的 Observer 实例，
    支持通过 task_id 查找和清理。
    """

    def __init__(self):
        self._observers: dict[str, AnalysisObserver] = {}
        self._lock = threading.Lock()

    def create(self, task_id: str | None = None) -> AnalysisObserver:
        """创建新的 Observer 并注册。"""
        observer = AnalysisObserver(task_id=task_id)
        with self._lock:
            self._observers[observer.task_id] = observer
        return observer

    def get(self, task_id: str) -> AnalysisObserver | None:
        """获取已存在的 Observer。"""
        with self._lock:
            return self._observers.get(task_id)

    def remove(self, task_id: str) -> None:
        """移除并关闭 Observer。"""
        with self._lock:
            observer = self._observers.pop(task_id, None)
            if observer:
                observer._close()

    def list_active(self) -> list[str]:
        """列出所有活跃的 task_id。"""
        with self._lock:
            return list(self._observers.keys())


# 全局单例
observer_manager = ObserverManager()
