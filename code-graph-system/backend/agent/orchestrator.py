"""Agent 编排器。

协调多个专业 Agent 完成复杂的代码分析任务。
"""

from __future__ import annotations

import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Optional

from backend.agent.checkpoint import (
    CheckpointManager,
    ModuleCheckpoint,
    CHECKPOINT_STATUS_COMPLETED,
    CHECKPOINT_STATUS_PARTIAL,
    CHECKPOINT_STATUS_FAILED,
)
from backend.agent.config import AnalysisConfig, AnalysisPreset
from backend.agent.context import AgentContext, SharedKnowledgeBase
from backend.agent.agents.module_detector import ModuleDetectorAgent
from backend.agent.agents.architecture import ArchitectureAgent
from backend.agent.agents.call_graph import CallGraphAgent
from backend.agent.agents.data_lineage import DataLineageAgent
from backend.agent.agents.api_endpoint import APIEndpointAgent
from backend.agent.agents.cross_module import CrossModuleAgent
from backend.agent.concurrency import ConcurrencyController, MAX_POOL_SIZE
from backend.graph.graph_schema import GraphNode, GraphEdge
from backend.llm.client import LLMClient, RateLimitExhaustedError
from backend.llm.context_monitor import ContextMonitor
from backend.models.agent_output import AgentOutput

logger = logging.getLogger(__name__)

# 限速暂停配置（可通过环境变量覆盖）
RATE_LIMIT_MAX_PAUSES = int(os.environ.get("RATE_LIMIT_MAX_PAUSES", "3"))
RATE_LIMIT_PAUSE_MINUTES = int(os.environ.get("RATE_LIMIT_PAUSE_MINUTES", "10"))

# 并发控制配置（可通过环境变量覆盖）
CONCURRENT_WORKERS_INIT = int(os.environ.get("CONCURRENT_WORKERS_INIT", "2"))
CONCURRENT_WORKERS_MAX = int(os.environ.get("CONCURRENT_WORKERS_MAX", "5"))


class PartialResultError(Exception):
    """持续限速导致提前退出，携带已完成模块数量信息。"""

    def __init__(self, completed_count: int, total_count: int):
        self.completed_count = completed_count
        self.total_count = total_count
        self.result = None   # 由 pipeline 层在 re-raise 前赋值
        super().__init__(f"部分完成: {completed_count}/{total_count} 个模块")


@dataclass
class OrchestratorResult:
    """编排器执行结果。"""
    status: str  # "success" | "partial" | "failed"
    nodes: list[GraphNode] = field(default_factory=list)
    edges: list[GraphEdge] = field(default_factory=list)
    agent_outputs: dict[str, AgentOutput] = field(default_factory=dict)
    meta: dict[str, Any] = field(default_factory=dict)


class AgentOrchestrator:
    """Agent 编排器。

    协调多个专业 Agent 完成代码分析任务：
    1. ModuleDetectorAgent - 模块检测
    2. ArchitectureAgent - 架构分析
    3. CallGraphAgent - 调用图分析
    4. DataLineageAgent - 数据血缘分析
    5. APIEndpointAgent - API 端点分析
    6. CrossModuleAgent - 跨模块分析
    """

    def __init__(
        self,
        repo_path: str,
        llm_client: LLMClient,
        max_iterations: int = 20,
        on_progress: Optional[Callable[[dict], None]] = None,
        context_window: int = 128000,
        config: AnalysisConfig = None,
    ):
        self.repo_path = Path(repo_path).resolve()
        self.llm_client = llm_client
        self.config = config or AnalysisConfig()
        self.max_iterations = self.config.max_iterations_per_module
        self.on_progress = on_progress

        # 共享知识库
        self.shared_knowledge = SharedKnowledgeBase()

        # 上下文窗口监控
        self.context_monitor = ContextMonitor(max_tokens=self.config.context_window)

        # 检查点管理器（可选，通过 run_module_analysis 启用）
        self.checkpoint_manager: Optional[CheckpointManager] = None

    def _emit_progress(self, agent_type: str, status: str, message: str, **extra):
        """发布进度事件。"""
        if self.on_progress:
            try:
                self.on_progress({
                    "agent": agent_type,
                    "status": status,
                    "message": message,
                    **extra,
                })
            except Exception:
                pass

    def _wait_with_heartbeat(self, total_minutes: int) -> None:
        """分段睡眠，每 2 分钟发送一次 rate_limited 心跳事件。"""
        interval = 120  # 每 2 分钟
        elapsed = 0
        total_seconds = total_minutes * 60
        while elapsed < total_seconds:
            sleep_time = min(interval, total_seconds - elapsed)
            time.sleep(sleep_time)
            elapsed += sleep_time
            self._emit_progress(
                "orchestrator",
                "rate_limited",
                f"等待 API 配额恢复，已等待 {elapsed // 60} 分钟...",
                wait_minutes=elapsed // 60,
            )

    def _run_agent_for_module(self, module: dict) -> Any:
        """对单个模块运行 ArchitectureAgent，返回 AgentOutput。"""
        module_id = module.get("id", "unknown")
        context = self._create_context(module_id)

        # 注意：共享知识注入已移至 run_module_analysis 开头批量执行（并发安全）
        # 这里不再直接赋值 context.shared_knowledge.modules = ...（@property 无 setter）

        agent = ArchitectureAgent(context=context, llm_client=self.llm_client)

        # [新增] 注册 search_structure 工具，executor 指向预构建索引
        if hasattr(self, "_structure_indexer"):
            agent.register_tool(
                name="search_structure",
                description=(
                    "查询代码结构索引，获取类/方法骨架和精确行号。"
                    "支持按注解（如 @RestController）、父类、关键词、路径模式过滤。"
                    "优先用此工具了解模块结构，再用 read_file 精准读取具体方法。"
                ),
                input_schema={
                    "type": "object",
                    "properties": {
                        "annotation": {
                            "type": "string",
                            "description": "按注解过滤，如 @RestController、@Service",
                        },
                        "base_class": {
                            "type": "string",
                            "description": "按父类或接口名过滤",
                        },
                        "keyword": {
                            "type": "string",
                            "description": "按类名或方法名关键词搜索",
                        },
                        "file_pattern": {
                            "type": "string",
                            "description": "文件路径 glob 模式，如 */controller/*",
                        },
                        "module_path": {
                            "type": "string",
                            "description": "限定搜索目录范围",
                        },
                    },
                },
                executor=self._structure_indexer,
            )

        return agent.run()

    def _create_context(self, module_id: str = None) -> AgentContext:
        """创建 Agent 上下文。每次调用创建独立 ContextMonitor 实例（并发安全）。"""
        return AgentContext(
            repo_path=str(self.repo_path),
            module_id=module_id or f"repo:{self.repo_path.name}",
            shared_knowledge=self.shared_knowledge,
            max_iterations=self.max_iterations,
            context_monitor=ContextMonitor(max_tokens=self.config.context_window),
        )

    def run_module_detection(self) -> AgentOutput:
        """运行模块检测 Agent。"""
        context = self._create_context()
        agent = ModuleDetectorAgent(context=context, llm_client=self.llm_client)
        return agent.run()

    def run_architecture_analysis(self) -> AgentOutput:
        """运行架构分析 Agent。"""
        context = self._create_context()
        agent = ArchitectureAgent(context=context, llm_client=self.llm_client)
        return agent.run()

    def run_call_graph_analysis(self) -> AgentOutput:
        """运行调用图分析 Agent。"""
        context = self._create_context()
        agent = CallGraphAgent(context=context, llm_client=self.llm_client)
        return agent.run()

    def run_data_lineage_analysis(self) -> AgentOutput:
        """运行数据血缘分析 Agent。"""
        context = self._create_context()
        agent = DataLineageAgent(context=context, llm_client=self.llm_client)
        return agent.run()

    def run_api_endpoint_analysis(self) -> AgentOutput:
        """运行 API 端点分析 Agent。"""
        context = self._create_context()
        agent = APIEndpointAgent(context=context, llm_client=self.llm_client)
        return agent.run()

    def run_cross_module_analysis(self) -> AgentOutput:
        """运行跨模块分析 Agent。"""
        context = self._create_context()
        agent = CrossModuleAgent(context=context, llm_client=self.llm_client)
        return agent.run()

    def run_all(
        self,
        enable_architecture: bool = True,
        enable_call_graph: bool = True,
        enable_data_lineage: bool = True,
        enable_api_endpoint: bool = True,
        enable_cross_module: bool = True,
    ) -> OrchestratorResult:
        """运行所有 Agent。"""
        all_nodes: list[GraphNode] = []
        all_edges: list[GraphEdge] = []
        agent_outputs: dict[str, AgentOutput] = {}

        def _run_agent(name: str, runner: Callable[[], AgentOutput], depends_on: list[str] = None):
            """运行单个 Agent 并处理结果。"""
            logger.info(f"运行 {name}...")
            self._emit_progress(name, "running", f"开始 {name}")

            try:
                output = runner()
                agent_outputs[name] = output

                if output.status == "success":
                    all_nodes.extend(output.nodes)
                    all_edges.extend(output.edges)
                    logger.info(f"  → {len(output.nodes)} 节点 / {len(output.edges)} 边")
                    self._emit_progress(name, "success", f"完成 {name}",
                                       nodes=len(output.nodes), edges=len(output.edges))
                else:
                    logger.warning(f"  → {name} 失败: {output.status}")
                    self._emit_progress(name, "failed", f"{name} 失败: {output.status}")

            except Exception as e:
                logger.error(f"{name} 执行失败: {e}", exc_info=True)
                self._emit_progress(name, "error", f"{name} 执行失败: {e}")

        # Step 1: 模块检测（基础）
        _run_agent("module_detector", self.run_module_detection)

        # Step 2: 架构分析（依赖模块检测）
        if enable_architecture:
            _run_agent("architecture", self.run_architecture_analysis)

        # Step 3: 调用图分析（依赖架构分析）
        if enable_call_graph:
            _run_agent("call_graph", self.run_call_graph_analysis)

        # Step 4: 数据血缘分析（并行）
        if enable_data_lineage:
            _run_agent("data_lineage", self.run_data_lineage_analysis)

        # Step 5: API 端点分析（并行）
        if enable_api_endpoint:
            _run_agent("api_endpoint", self.run_api_endpoint_analysis)

        # Step 6: 跨模块分析（依赖所有前面的分析）
        if enable_cross_module:
            _run_agent("cross_module", self.run_cross_module_analysis)

        # 确定最终状态
        successful = [a for a in agent_outputs.values() if a.status == "success"]
        if len(successful) == len(agent_outputs):
            status = "success"
        elif len(all_nodes) > 0:
            status = "partial"
        else:
            status = "failed"

        return OrchestratorResult(
            status=status,
            nodes=all_nodes,
            edges=all_edges,
            agent_outputs=agent_outputs,
            meta={
                "total_agents": len(agent_outputs),
                "successful_agents": len(successful),
                "total_nodes": len(all_nodes),
                "total_edges": len(all_edges),
            },
        )

    def _reset_context_monitor(self) -> None:
        """重置上下文监控器。"""
        self.context_monitor.reset()

    def _run_module_worker(
        self, module: dict, controller: ConcurrencyController
    ) -> AgentOutput:
        """Worker 线程执行函数。占 slot → 分析模块 → 释放 slot。"""
        controller.wait_to_start()
        try:
            output = self._run_agent_for_module(module)
            controller.record_success()
            return output
        except RateLimitExhaustedError:
            controller.record_429()
            # 使用 return 而非 raise：rate limit 已由 controller 处理，
            # 两者均触发 finally，但 return 语义更清晰
            return AgentOutput(status="rate_limited", nodes=[], edges=[])
        except Exception:
            raise
        finally:
            controller.release()  # 无论如何释放 slot

    def run_module_analysis(
        self,
        modules: list[dict],
        repo_name: str = None,
    ) -> OrchestratorResult:
        """运行模块级分析（并发 + 检查点）。

        使用 ThreadPoolExecutor 并发执行，ConcurrencyController 动态控制并发度（2-5）。
        主线程通过 as_completed 串行写检查点，确保线程安全。

        Args:
            modules: 模块列表，每个模块包含 id, name 等字段
            repo_name: 仓库名称，用于检查点存储。为 None 时禁用检查点

        Returns:
            OrchestratorResult 包含所有模块的分析结果
        """
        if repo_name and self.checkpoint_manager is None:
            self.checkpoint_manager = CheckpointManager(repo_name)

        # 应用 max_modules 限制
        if self.config.max_modules:
            modules = modules[: self.config.max_modules]

        # 断点续跑：计算待处理模块
        all_module_ids = [m.get("id", f"module_{i}") for i, m in enumerate(modules)]
        if self.checkpoint_manager is not None:
            pending_ids = set(self.checkpoint_manager.list_pending_modules(all_module_ids))
        else:
            pending_ids = set(all_module_ids)

        completed_count = len(all_module_ids) - len(pending_ids)
        if completed_count > 0:
            logger.info("断点续跑：已完成 %d/%d 个模块，续跑剩余", completed_count, len(all_module_ids))

        # 从检查点批量注入聚合知识（替代原 _run_agent_for_module 内的逐次注入）
        # 原代码直接赋值 context.shared_knowledge.modules = ... 在 @property 下会 AttributeError
        if self.checkpoint_manager is not None:
            aggregated = self.checkpoint_manager.get_aggregated_knowledge()
            for m in aggregated.get("modules", []):
                self.shared_knowledge.add_module(m)
            for layer in aggregated.get("layers", []):
                self.shared_knowledge.add_layer(layer)

        # 构建整个仓库的结构索引（零 LLM 调用，一次性）
        try:
            from backend.agent.structure_indexer import StructureIndexer
            _raw_depth = self.config.preset.value if hasattr(self.config, "preset") else "standard"
            depth = _raw_depth if _raw_depth in ("quick", "standard", "deep") else "standard"
            self._structure_indexer = StructureIndexer(depth=depth)
            self._structure_indexer.build_index(self.repo_path)
            logger.info("StructureIndexer 索引构建完成：%d 个文件", len(self._structure_indexer._index))
        except Exception as _si_err:
            logger.warning("StructureIndexer 初始化失败，跳过结构索引：%s", _si_err)

        # 初始化并发控制器
        controller = ConcurrencyController(
            initial_workers=CONCURRENT_WORKERS_INIT,
            max_workers=CONCURRENT_WORKERS_MAX,
            max_pauses=RATE_LIMIT_MAX_PAUSES,
            initial_backoff=float(os.environ.get("RATE_LIMIT_PAUSE_SECONDS", "10")),
        )

        pending_modules = [m for m in modules if m.get("id") in pending_ids]
        all_nodes: list[GraphNode] = []
        all_edges: list[GraphEdge] = []
        module_outputs: dict[str, AgentOutput] = {}

        with ThreadPoolExecutor(max_workers=MAX_POOL_SIZE) as executor:
            futures = {
                executor.submit(self._run_module_worker, m, controller): m
                for m in pending_modules
            }

            for future in as_completed(futures):
                # 检查 should_abort（429 次数超限）
                if controller.should_abort:
                    completed = (
                        len(self.checkpoint_manager.list_completed_modules())
                        if self.checkpoint_manager else 0
                    )
                    raise PartialResultError(completed, len(modules))

                module = futures[future]
                module_id = module.get("id", "unknown")
                module_name = module.get("name", module_id)

                try:
                    output = future.result()
                    module_outputs[module_id] = output

                    # 主线程串行写检查点（CheckpointManager 内部已加 RLock，双重保险）
                    if self.checkpoint_manager is not None:
                        checkpoint_status = CHECKPOINT_STATUS_COMPLETED
                        if output.status == "partial":
                            checkpoint_status = CHECKPOINT_STATUS_PARTIAL
                        elif output.status in ("failed", "rate_limited"):
                            checkpoint_status = CHECKPOINT_STATUS_FAILED

                        checkpoint = ModuleCheckpoint(
                            module_id=module_id,
                            module_name=module_name,
                            nodes=[n.model_dump() for n in output.nodes],
                            edges=[e.model_dump() for e in output.edges],
                            knowledge={
                                "modules": self.shared_knowledge.modules,
                                "layers": self.shared_knowledge.layers,
                            },
                            status=checkpoint_status,
                        )
                        self.checkpoint_manager.save(checkpoint)

                    if output.status == "success":
                        all_nodes.extend(output.nodes)
                        all_edges.extend(output.edges)
                        logger.info(
                            "模块 %s: %d 节点 / %d 边",
                            module_name, len(output.nodes), len(output.edges),
                        )
                        self._emit_progress(
                            "module_analysis", "success",
                            f"完成模块分析: {module_name}",
                            module_id=module_id,
                            nodes=len(output.nodes),
                            edges=len(output.edges),
                        )
                    else:
                        logger.warning("模块 %s 分析结果: %s", module_name, output.status)

                except PartialResultError:
                    raise  # 透传，不 catch
                except Exception as e:
                    logger.error("模块 %s 失败: %s", module_id, e, exc_info=True)
                    # 并发模式下每个模块有独立 ContextMonitor，无需重置共享实例

        # 仅在全部完成时清除检查点（异常退出时保留，供断点续跑）
        if self.checkpoint_manager is not None:
            self.checkpoint_manager.clear()

        # 确定最终状态
        successful = [o for o in module_outputs.values() if o.status == "success"]
        if len(successful) == len(modules):
            status = "success"
        elif len(all_nodes) > 0:
            status = "partial"
        else:
            status = "failed"

        return OrchestratorResult(
            status=status,
            nodes=all_nodes,
            edges=all_edges,
            agent_outputs=module_outputs,
            meta={
                "checkpoint_enabled": self.checkpoint_manager is not None,
                "total_modules": len(modules),
                "successful_modules": len(successful),
                "total_nodes": len(all_nodes),
                "total_edges": len(all_edges),
                "concurrent": True,
            },
        )
