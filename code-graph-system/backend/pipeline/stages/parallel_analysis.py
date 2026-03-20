"""Stage 3: 并行分析 — ThreadPoolExecutor + 三级降级策略。"""
from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import Callable

from backend.cache.shared_knowledge_pool import SharedKnowledgePool
from backend.graph.graph_schema import GraphEdge, GraphNode
from backend.llm.client import LLMClient, RateLimitExhaustedError
from backend.models.ai_analysis import FailedModule, ModuleInfo
from backend.pipeline.pipeline_scheduler import (
    IntelligentScheduler,
    ModuleBatch,
    SchedulerConfig,
)
from backend.pipeline.stages.base import StageBase

logger = logging.getLogger(__name__)


@dataclass
class ModuleResult:
    """单个模块的分析结果。"""

    module_id: str
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    execution_time_ms: float = 0.0


class ParallelAnalysisStage(StageBase):
    """Stage 3: 并行分析所有模块，含三级降级策略。"""

    name = "parallel_analysis"

    def run(
        self,
        modules: list[ModuleInfo],
        pool: SharedKnowledgePool,
        llm_client: LLMClient,
        scheduler_config: SchedulerConfig,
        on_progress: Callable | None = None,
    ) -> tuple[list[GraphNode], list[GraphEdge], list[FailedModule]]:
        if on_progress:
            on_progress(
                {
                    "step": "parallel_analysis",
                    "status": "start",
                    "message": f"并行分析 {len(modules)} 个模块...",
                }
            )

        scheduler = IntelligentScheduler(config=scheduler_config, pool=pool)
        batches = scheduler.schedule(modules)

        all_nodes: list[GraphNode] = []
        all_edges: list[GraphEdge] = []
        failed: list[FailedModule] = []
        retry_queue: list[ModuleInfo] = []

        # 并行执行批次
        with ThreadPoolExecutor(max_workers=scheduler.current_concurrency) as executor:
            future_to_batch = {
                executor.submit(
                    self._execute_batch, batch, pool, llm_client
                ): batch
                for batch in batches
            }

            for future in as_completed(future_to_batch):
                batch = future_to_batch[future]
                t_start = time.time()
                try:
                    batch_results = future.result()
                    elapsed_ms = (time.time() - t_start) * 1000
                    scheduler.on_success(elapsed_ms)

                    # Level 1 降级：收集 None 结果进入重试队列
                    for module_id, result in batch_results.items():
                        if result is None:
                            mod = batch.get_module(module_id)
                            if mod:
                                retry_queue.append(mod)
                        else:
                            all_nodes.extend(result.nodes)
                            all_edges.extend(result.edges)

                except RateLimitExhaustedError:
                    wait = scheduler.on_rate_limit()
                    time.sleep(wait)
                    retry_queue.extend(batch.modules)

                except Exception as e:
                    logger.error("批次 %s 执行失败: %s", batch.batch_id, e)
                    retry_queue.extend(batch.modules)

        # Level 2 降级：单模块重新分析
        for module in retry_queue:
            try:
                nodes, edges = self._analyze_single_with_complete(
                    module, pool, llm_client
                )
                all_nodes.extend(nodes)
                all_edges.extend(edges)
            except Exception as e:
                logger.error("模块 %s Level 2 降级失败: %s", module.id, e)
                # Level 3 降级：记录失败
                failed.append(
                    FailedModule(
                        module_id=module.id,
                        reason=str(e),
                        files_attempted=module.files[:5],
                    )
                )

        msg = f"并行分析完成: {len(all_nodes)} 节点, {len(all_edges)} 边, {len(failed)} 模块失败"
        logger.info("Stage 3 完成: %s", msg)
        if on_progress:
            on_progress(
                {
                    "step": "parallel_analysis",
                    "status": "complete",
                    "message": msg,
                    "nodes": len(all_nodes),
                    "edges": len(all_edges),
                }
            )

        return all_nodes, all_edges, failed

    def _execute_batch(
        self,
        batch: ModuleBatch,
        pool: SharedKnowledgePool,
        llm_client: LLMClient,
    ) -> dict[str, ModuleResult | None]:
        """执行单个批次，返回 {module_id: ModuleResult | None}。"""
        if batch.is_merged:
            return self._execute_merged_batch(batch, pool, llm_client)
        else:
            return self._execute_single_batch(batch, pool, llm_client)

    def _execute_merged_batch(
        self,
        batch: ModuleBatch,
        pool: SharedKnowledgePool,
        llm_client: LLMClient,
    ) -> dict[str, ModuleResult | None]:
        prompt = batch.to_prompt()
        response = llm_client.complete(
            prompt=prompt,
            system="你是代码分析专家，擅长提取代码结构。",
            max_tokens=8192,
        )
        parsed = batch.parse_response(response)
        results: dict[str, ModuleResult | None] = {}
        for module_id, data in parsed.items():
            if data is None:
                results[module_id] = None
            else:
                nodes, edges = self._data_to_graph(data, module_id)
                results[module_id] = ModuleResult(
                    module_id=module_id, nodes=nodes, edges=edges
                )
        return results

    def _execute_single_batch(
        self,
        batch: ModuleBatch,
        pool: SharedKnowledgePool,
        llm_client: LLMClient,
    ) -> dict[str, ModuleResult | None]:
        module = batch.modules[0]
        nodes, edges = self._analyze_single_with_complete(module, pool, llm_client)
        return {
            module.id: ModuleResult(
                module_id=module.id, nodes=nodes, edges=edges
            )
        }

    def _analyze_single_with_complete(
        self,
        module: ModuleInfo,
        pool: SharedKnowledgePool,
        llm_client: LLMClient,
    ) -> tuple[list[GraphNode], list[GraphEdge]]:
        """单模块分析（复用现有 AIPipeline._analyze_with_complete 逻辑）。"""
        from backend.pipeline.ai_analyze import AIPipeline

        pipeline = AIPipeline()
        return pipeline._analyze_with_complete(pool.repo_path, module, llm_client)

    @staticmethod
    def _data_to_graph(
        data: dict, module_id: str
    ) -> tuple[list[GraphNode], list[GraphEdge]]:
        """将解析后的字典转换为 GraphNode / GraphEdge 列表。"""
        from backend.graph.graph_schema import GraphEdge, GraphNode

        nodes: list[GraphNode] = []
        edges: list[GraphEdge] = []

        for func in data.get("functions", []):
            nodes.append(
                GraphNode(
                    id=func.get(
                        "id", f"{module_id}:{func.get('name', 'unknown')}"
                    ),
                    type="Function",
                    name=func.get("name", ""),
                    properties={
                        "file_path": func.get("file_path", ""),
                        "summary": func.get("summary", ""),
                        "module_id": module_id,
                    },
                )
            )
        for cls in data.get("classes", []):
            nodes.append(
                GraphNode(
                    id=cls.get("id", f"{module_id}:{cls.get('name', 'unknown')}"),
                    type="Class",
                    name=cls.get("name", ""),
                    properties={
                        "file_path": cls.get("file_path", ""),
                        "summary": cls.get("summary", ""),
                        "module_id": module_id,
                    },
                )
            )
        for call in data.get("calls", []):
            from_id = call.get("from", "")
            to_id = call.get("to", "")
            if from_id and to_id:
                edges.append(
                    GraphEdge.model_validate(
                        {"from": from_id, "to": to_id, "type": "calls", "properties": {}}
                    )
                )

        return nodes, edges
