"""IntelligentScheduler 和 ModuleBatch 单元测试。"""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from backend.models.ai_analysis import ModuleInfo
from backend.pipeline.pipeline_scheduler import (
    IntelligentScheduler,
    ModuleBatch,
    ModuleScheduleInfo,
    SchedulerConfig,
)


def make_module(module_id: str, file_count: int, est_tokens: int) -> ModuleInfo:
    return ModuleInfo(
        id=module_id,
        name=module_id,
        files=[f"file_{i}.py" for i in range(file_count)],
        purpose="test",
        language="python",
        confidence=1.0,
    )


def make_pool(token_map: dict[str, int]) -> MagicMock:
    pool = MagicMock()
    pool.estimate_tokens = lambda paths: sum(token_map.get(p, 100) for p in paths)
    return pool


class TestModuleBatch:
    def test_single_module_batch_is_not_merged(self):
        m = make_module("mod_big", 20, 20000)
        pool = make_pool({})
        batch = ModuleBatch(batch_id="b1", modules=[m], pool=pool)
        assert not batch.is_merged

    def test_small_modules_batch_is_merged(self):
        m1 = make_module("mod_a", 2, 3000)
        m2 = make_module("mod_b", 2, 3000)
        pool = MagicMock()
        pool.estimate_tokens.return_value = 3000
        batch = ModuleBatch(batch_id="b1", modules=[m1, m2], pool=pool, force_merged=True)
        assert batch.is_merged

    def test_get_module_by_id(self):
        m = make_module("mod_x", 3, 5000)
        pool = MagicMock()
        pool.estimate_tokens.return_value = 5000
        batch = ModuleBatch(batch_id="b1", modules=[m], pool=pool)
        assert batch.get_module("mod_x") is m
        assert batch.get_module("nonexistent") is None

    def test_parse_response_valid_json(self):
        m1 = make_module("m1", 1, 1000)
        m2 = make_module("m2", 1, 1000)
        pool = MagicMock()
        pool.estimate_tokens.return_value = 1000
        batch = ModuleBatch(batch_id="b1", modules=[m1, m2], pool=pool, force_merged=True)
        response = '{"m1": {"functions": [], "classes": [], "calls": []}, "m2": {"functions": [], "classes": [], "calls": []}}'
        results = batch.parse_response(response)
        assert "m1" in results
        assert "m2" in results

    def test_parse_response_missing_module_returns_none(self):
        m1 = make_module("m1", 1, 1000)
        m2 = make_module("m2", 1, 1000)
        pool = MagicMock()
        pool.estimate_tokens.return_value = 1000
        batch = ModuleBatch(batch_id="b1", modules=[m1, m2], pool=pool, force_merged=True)
        response = '{"m1": {"functions": [], "classes": [], "calls": []}}'
        results = batch.parse_response(response)
        assert results["m1"] is not None
        assert results["m2"] is None  # 缺失 → Level 1 降级标记

    def test_to_prompt_includes_module_info(self):
        m = make_module("test_mod", 1, 500)
        pool = MagicMock()
        pool.estimate_tokens.return_value = 500
        pool.get_content.return_value = "def foo(): pass"
        batch = ModuleBatch(batch_id="b1", modules=[m], pool=pool, force_merged=True)
        prompt = batch.to_prompt()
        assert "test_mod" in prompt


class TestIntelligentScheduler:
    def test_schedule_sorts_small_modules_first(self):
        modules = [
            make_module("big", 30, 20000),
            make_module("small", 2, 1000),
            make_module("medium", 10, 8000),
        ]
        pool = MagicMock()
        pool.estimate_tokens.side_effect = lambda paths: len(paths) * 500
        config = SchedulerConfig()
        scheduler = IntelligentScheduler(config=config, pool=pool)
        batches = scheduler.schedule(modules)
        # 第一个 batch 应该是最小的模块
        assert batches[0].modules[0].id == "small"

    def test_small_modules_are_merged(self):
        # 两个小模块（各 1000 token）应该被合并
        modules = [
            make_module("a", 2, 1000),
            make_module("b", 2, 1000),
        ]
        pool = MagicMock()
        pool.estimate_tokens.return_value = 1000
        config = SchedulerConfig(batch_token_threshold=8000)
        scheduler = IntelligentScheduler(config=config, pool=pool)
        batches = scheduler.schedule(modules)
        assert any(b.is_merged for b in batches)

    def test_large_module_not_merged(self):
        modules = [make_module("big", 30, 20000)]
        pool = MagicMock()
        pool.estimate_tokens.return_value = 20000
        config = SchedulerConfig(batch_token_threshold=8000)
        scheduler = IntelligentScheduler(config=config, pool=pool)
        batches = scheduler.schedule(modules)
        assert not batches[0].is_merged

    def test_on_rate_limit_returns_backoff_time(self):
        pool = MagicMock()
        config = SchedulerConfig(rate_limit_backoff_base=5.0)
        scheduler = IntelligentScheduler(config=config, pool=pool)
        wait1 = scheduler.on_rate_limit()
        wait2 = scheduler.on_rate_limit()
        assert wait2 > wait1  # 指数退避

    def test_on_success_resets_rate_limit_count(self):
        pool = MagicMock()
        config = SchedulerConfig()
        scheduler = IntelligentScheduler(config=config, pool=pool)
        scheduler.on_rate_limit()
        scheduler.on_rate_limit()
        scheduler.on_success(response_time_ms=1000.0)
        assert scheduler._rate_limit_count == 0

    def test_adjust_concurrency_increases_on_fast_response(self):
        pool = MagicMock()
        config = SchedulerConfig(
            initial_concurrency=2,
            max_concurrency=5,
            response_time_threshold_fast_ms=3000.0,
        )
        scheduler = IntelligentScheduler(config=config, pool=pool)
        # 连续 3 次快速响应
        for _ in range(3):
            scheduler.on_success(response_time_ms=1000.0)
        assert scheduler.current_concurrency == 3

    def test_adjust_concurrency_decreases_on_slow_response(self):
        pool = MagicMock()
        config = SchedulerConfig(
            initial_concurrency=3,
            min_concurrency=1,
            response_time_threshold_slow_ms=8000.0,
        )
        scheduler = IntelligentScheduler(config=config, pool=pool)
        # 连续 3 次慢速响应
        for _ in range(3):
            scheduler.on_success(response_time_ms=10000.0)
        assert scheduler.current_concurrency == 2
