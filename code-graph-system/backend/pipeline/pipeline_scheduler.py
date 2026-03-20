"""智能调度器 + ModuleBatch — 模块调度和批次合并。

注意：故意放在 pipeline/ 而非 scheduler/，避免与 Celery scheduler/ 目录混淆。
"""
from __future__ import annotations

import json
import logging
import threading
import uuid
from collections import deque
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from backend.models.ai_analysis import ModuleInfo

if TYPE_CHECKING:
    from backend.cache.shared_knowledge_pool import SharedKnowledgePool

logger = logging.getLogger(__name__)


@dataclass
class SchedulerConfig:
    """调度器配置。"""

    initial_concurrency: int = 2  # GLM-4 默认 2 并发
    max_concurrency: int = 5  # 与现有 ConcurrencyController 一致
    min_concurrency: int = 1
    batch_token_threshold: int = 8000  # 单模块 Token ≤ 此值才参与合并
    batch_max_total_tokens: int = 16000  # 合并批次的 Token 上限
    response_time_threshold_fast_ms: float = 3000.0  # 连续快 → 增加并发
    response_time_threshold_slow_ms: float = 8000.0  # 连续慢 → 降低并发
    fast_slow_window: int = 3  # 连续多少次触发调整
    rate_limit_backoff_base: float = 5.0  # 退避基数（秒）
    rate_limit_max_consecutive: int = 3  # 连续多少次 429 后减半并发


# ── ModuleScheduleInfo ────────────────────────────────────────────────────────


@dataclass
class ModuleScheduleInfo:
    """模块调度信息（内部使用）。"""

    module: ModuleInfo
    estimated_tokens: int
    complexity_score: float


# ── ModuleBatch ───────────────────────────────────────────────────────────────


class ModuleBatch:
    """模块批次 — 可包含一个或多个模块。

    is_merged=True 时，使用 complete() 一次性分析所有模块。
    is_merged=False 时，使用 AgentOrchestrator 深度分析单个模块。
    """

    def __init__(
        self,
        batch_id: str,
        modules: list[ModuleInfo],
        pool: "SharedKnowledgePool",
        force_merged: bool = False,
    ) -> None:
        self.batch_id = batch_id
        self.modules = modules
        self.pool = pool
        self._force_merged = force_merged
        self._total_tokens: int | None = None

    @property
    def is_merged(self) -> bool:
        return self._force_merged or len(self.modules) > 1

    @property
    def total_estimated_tokens(self) -> int:
        if self._total_tokens is None:
            all_files = [f for m in self.modules for f in m.files]
            self._total_tokens = self.pool.estimate_tokens(all_files)
        return self._total_tokens

    def get_module(self, module_id: str) -> ModuleInfo | None:
        return next((m for m in self.modules if m.id == module_id), None)

    def to_prompt(self) -> str:
        """生成合并分析的提示词。"""
        parts = [f"请分析以下 {len(self.modules)} 个代码模块，提取类、函数、调用关系。\n"]
        for i, module in enumerate(self.modules, 1):
            parts.append(f"\n## 模块 {i}（ID: {module.id}）: {module.name}")
            parts.append(f"职责: {module.purpose}")
            parts.append(f"文件列表: {', '.join(module.files[:10])}")
            # 读取文件内容（限制单文件 4000 字符）
            contents = []
            for fpath in module.files[:10]:
                content = self.pool.get_content(fpath) or ""
                if len(content) > 4000:
                    content = content[:4000] + "\n...(truncated)"
                if content:
                    contents.append(f"// {fpath}\n{content}")
            parts.append("\n```\n" + "\n".join(contents) + "\n```")

        parts.append(
            "\n## 输出格式\n\n以 JSON 输出，按模块 ID 组织：\n\n"
            "```json\n{\n"
            '  "<module_id>": {\n'
            '    "functions": [{"id": "...", "name": "...", "file_path": "...", "summary": "..."}],\n'
            '    "classes": [{"id": "...", "name": "...", "file_path": "...", "summary": "..."}],\n'
            '    "calls": [{"from": "...", "to": "..."}]\n'
            "  }\n}\n```\n\n只输出 JSON，不要其他解释。"
        )
        return "\n".join(parts)

    def parse_response(self, response: str) -> dict[str, Any | None]:
        """解析合并响应，返回 {module_id: data | None}。

        None 表示该模块解析失败（触发 Level 1 降级）。
        """
        result: dict[str, Any | None] = {m.id: None for m in self.modules}
        if not response:
            return result

        # 提取 JSON
        content = response.strip()
        if "```json" in content:
            try:
                content = content.split("```json")[1].split("```")[0].strip()
            except IndexError:
                pass
        elif "```" in content:
            parts = content.split("```")
            for p in reversed(parts):
                p = p.strip()
                if p.startswith("{"):
                    content = p
                    break
        if not content.startswith("{"):
            idx = content.find("{")
            if idx >= 0:
                content = content[idx:]

        try:
            data = json.loads(content)
        except json.JSONDecodeError as e:
            logger.warning("ModuleBatch 响应 JSON 解析失败: %s", e)
            return result

        for module_id in result:
            if module_id in data:
                result[module_id] = data[module_id]
            else:
                logger.warning("模块 %s 在合并响应中缺失，触发 Level 1 降级", module_id)

        return result


# ── IntelligentScheduler ──────────────────────────────────────────────────────


class IntelligentScheduler:
    """智能调度器 — 排序、分批、自适应并发。"""

    def __init__(self, config: SchedulerConfig, pool: "SharedKnowledgePool") -> None:
        self.config = config
        self.pool = pool
        self.current_concurrency = config.initial_concurrency
        self._response_times: deque[float] = deque(maxlen=config.fast_slow_window * 2)
        self._rate_limit_count = 0
        self._lock = threading.Lock()

    def schedule(self, modules: list[ModuleInfo]) -> list[ModuleBatch]:
        """生成调度计划：排序 → 小模块合并 → 返回批次列表。"""
        # 计算调度信息
        infos = []
        for m in modules:
            tokens = self.pool.estimate_tokens(m.files)
            score = tokens / 16000 + len(m.files) / 50
            infos.append(
                ModuleScheduleInfo(
                    module=m, estimated_tokens=tokens, complexity_score=score
                )
            )

        # 按复杂度升序（小优先）
        infos.sort(key=lambda x: x.complexity_score)

        batches: list[ModuleBatch] = []
        pending_merged: list[ModuleInfo] = []
        pending_tokens = 0

        for info in infos:
            if info.estimated_tokens <= self.config.batch_token_threshold:
                # 候选合并
                if (
                    pending_tokens + info.estimated_tokens
                    <= self.config.batch_max_total_tokens
                ):
                    pending_merged.append(info.module)
                    pending_tokens += info.estimated_tokens
                else:
                    # 当前合并批次已满，先提交
                    if pending_merged:
                        batches.append(self._make_merged_batch(pending_merged))
                    pending_merged = [info.module]
                    pending_tokens = info.estimated_tokens
            else:
                # 大模块：先提交累积的合并批次
                if pending_merged:
                    batches.append(self._make_merged_batch(pending_merged))
                    pending_merged = []
                    pending_tokens = 0
                # 大模块单独一个批次
                batches.append(
                    ModuleBatch(
                        batch_id=str(uuid.uuid4())[:8],
                        modules=[info.module],
                        pool=self.pool,
                    )
                )

        # 提交剩余合并批次
        if pending_merged:
            batches.append(self._make_merged_batch(pending_merged))

        return batches

    def on_rate_limit(self) -> float:
        """处理 429 限速，返回退避等待时间（指数退避）。"""
        with self._lock:
            self._rate_limit_count += 1
            count = self._rate_limit_count
        wait = min(
            self.config.rate_limit_backoff_base * (2 ** (count - 1)),
            120.0,
        )
        logger.warning("429 限速（第 %d 次），退避 %.0fs", count, wait)
        return wait

    def on_success(self, response_time_ms: float) -> None:
        """记录成功响应，重置限速计数，尝试调整并发。"""
        with self._lock:
            self._rate_limit_count = 0
            self._response_times.append(response_time_ms)
            self._try_adjust_concurrency()

    def _try_adjust_concurrency(self) -> None:
        """根据最近响应时间调整并发度（需在 _lock 内调用）。"""
        window = self.config.fast_slow_window
        if len(self._response_times) < window:
            return
        recent = list(self._response_times)[-window:]
        avg = sum(recent) / len(recent)
        if avg < self.config.response_time_threshold_fast_ms:
            if self.current_concurrency < self.config.max_concurrency:
                self.current_concurrency += 1
                logger.info(
                    "并发度 +1 → %d（平均响应 %.0fms）",
                    self.current_concurrency,
                    avg,
                )
        elif avg > self.config.response_time_threshold_slow_ms:
            if self.current_concurrency > self.config.min_concurrency:
                self.current_concurrency -= 1
                logger.info(
                    "并发度 -1 → %d（平均响应 %.0fms）",
                    self.current_concurrency,
                    avg,
                )

    def _make_merged_batch(self, modules: list[ModuleInfo]) -> ModuleBatch:
        if len(modules) == 1:
            return ModuleBatch(
                batch_id=str(uuid.uuid4())[:8],
                modules=modules,
                pool=self.pool,
            )
        return ModuleBatch(
            batch_id=str(uuid.uuid4())[:8],
            modules=modules,
            pool=self.pool,
            force_merged=True,
        )
