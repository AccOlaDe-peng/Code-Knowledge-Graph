"""AI 驱动的代码分析流水线。

6 步流水线：
    Step 1: RepoScanner      — 扫描文件列表
    Step 2: AIModuleScanner  — AI 识别模块边界
    Step 3: AICodeAnalyzer   — AI 代码分析（使用现有 AgentOrchestrator）
    Step 4: GraphBuilder     — 合并图谱
    Step 5: GraphRepository  — 持久化
    Step 6: GraphRAGEngine   — 向量化（可选）
"""

from __future__ import annotations

import logging
import os
import time
from pathlib import Path
from typing import Any, Callable, Optional

from backend.agent.agents.module_scanner import ModuleScannerAgent
from backend.agent.context import AgentContext, SharedKnowledgeBase
from backend.agent.orchestrator import AgentOrchestrator
from backend.graph.graph_builder import BuiltGraph, GraphBuilder
from backend.graph.graph_repository import GraphRepository
from backend.graph.graph_schema import GraphNode, GraphEdge
from backend.llm.client import LLMClient
from backend.models.ai_analysis import (
    AIAnalysisConfig,
    AIAnalysisResult,
    FailedModule,
    ModuleInfo,
    ModulePlan,
)
from backend.rag.graph_rag_engine import GraphRAGEngine
from backend.rag.vector_store import VectorStore
from backend.scanner.repo_scanner import RepoScanner, ScanResult

logger = logging.getLogger(__name__)


class AIPipeline:
    """AI 驱动的代码分析流水线。

    使用 AI 模块扫描和 Agent 编排器完成代码分析。

    示例::

        pipeline = AIPipeline()
        result = pipeline.analyze("/path/to/repo", repo_name="my-project")

        print(f"图谱 ID: {result.graph_id}")
        print(f"节点数: {result.node_count}")
        print(f"边数: {result.edge_count}")
    """

    def __init__(
        self,
        config: Optional[AIAnalysisConfig] = None,
        graph_repo: Optional[GraphRepository] = None,
        vector_store: Optional[VectorStore] = None,
        rag_engine: Optional[GraphRAGEngine] = None,
    ):
        """初始化 AIPipeline。

        Args:
            config: AI 分析配置，None 使用默认配置
            graph_repo: 图谱存储仓库，None 创建默认实例
            vector_store: 向量存储，None 创建默认实例
            rag_engine: GraphRAG 引擎，None 创建默认实例
        """
        self.config = config or AIAnalysisConfig()
        self._repo = graph_repo or GraphRepository()
        self._vector_store = vector_store
        self._rag_engine = rag_engine

    def analyze(
        self,
        repo_path: str | Path,
        *,
        repo_name: str = "",
        enable_rag: bool = False,
        on_progress: Optional[Callable[[dict], None]] = None,
    ) -> AIAnalysisResult:
        """执行 AI 分析流水线。

        Args:
            repo_path: 代码仓库路径
            repo_name: 仓库名称（用于生成图谱 ID）
            enable_rag: 是否启用向量化（Step 6）
            on_progress: 进度回调函数

        Returns:
            AIAnalysisResult 包含图谱和分析状态

        Raises:
            ValueError: 仓库路径无效或没有源码文件
        """
        start_time = time.time()
        repo_path = Path(repo_path).resolve()

        # 验证路径
        if not repo_path.exists():
            raise ValueError(f"仓库路径不存在: {repo_path}")
        if not repo_path.is_dir():
            raise ValueError(f"路径不是目录: {repo_path}")

        # Step 1: RepoScanner — 扫描文件列表
        self._emit_progress(on_progress, "scanner", "start", "开始扫描文件...")
        scanner = RepoScanner()
        scan_result = scanner.scan(repo_path)

        if not scan_result.files:
            raise ValueError(f"没有找到任何源码文件: {repo_path}")

        self._emit_progress(
            on_progress, "scanner", "complete",
            f"扫描完成: {scan_result.total_files} 文件",
            files=scan_result.total_files,
        )
        logger.info("Step 1 完成: 扫描到 %d 个文件", scan_result.total_files)

        # Step 2: AIModuleScanner — AI 识别模块边界
        self._emit_progress(on_progress, "module_scanner", "start", "AI 识别模块边界...")
        llm_client = self._create_llm_client()
        module_plan = self._run_module_scanner(scan_result, llm_client)

        modules = module_plan.modules
        if not modules:
            # 没有检测到模块，创建默认模块包含所有文件
            modules = [self._create_default_module(scan_result)]
            logger.info("未检测到模块，创建默认模块包含 %d 个文件", len(modules[0].files))

        self._emit_progress(
            on_progress, "module_scanner", "complete",
            f"识别到 {len(modules)} 个模块",
            modules=len(modules),
        )
        logger.info("Step 2 完成: 识别到 %d 个模块", len(modules))

        # Step 3: AICodeAnalyzer — AI 代码分析
        self._emit_progress(on_progress, "code_analyzer", "start", "AI 代码分析...")
        all_nodes: list[GraphNode] = []
        all_edges: list[GraphEdge] = []
        failed_modules: list[FailedModule] = []

        for module in modules:
            try:
                module_nodes, module_edges = self._analyze_module(
                    repo_path, module, llm_client, on_progress
                )
                all_nodes.extend(module_nodes)
                all_edges.extend(module_edges)
            except Exception as e:
                logger.error("模块 %s 分析失败: %s", module.id, e)
                failed_modules.append(FailedModule(
                    module_id=module.id,
                    reason=str(e),
                    files_attempted=module.files[:5],  # 只记录前 5 个文件
                ))

        self._emit_progress(
            on_progress, "code_analyzer", "complete",
            f"代码分析完成: {len(all_nodes)} 节点, {len(all_edges)} 边",
            nodes=len(all_nodes),
            edges=len(all_edges),
        )
        logger.info("Step 3 完成: %d 节点, %d 边", len(all_nodes), len(all_edges))

        # Step 4: GraphBuilder — 合并图谱
        self._emit_progress(on_progress, "graph_builder", "start", "构建图谱...")
        builder = GraphBuilder()
        for node in all_nodes:
            builder.add_node(node)
        for edge in all_edges:
            builder.add_edge(edge)

        built = builder.build()
        self._emit_progress(
            on_progress, "graph_builder", "complete",
            f"图谱构建完成: {built.node_count} 节点, {built.edge_count} 边",
        )
        logger.info("Step 4 完成: 图谱构建完成")

        # Step 5: GraphRepository — 持久化
        self._emit_progress(on_progress, "repository", "start", "保存图谱...")
        graph_id = self._repo.save(built, repo_name=repo_name or repo_path.name)
        self._emit_progress(
            on_progress, "repository", "complete",
            f"图谱已保存: {graph_id}",
            graph_id=graph_id,
        )
        logger.info("Step 5 完成: 图谱已保存为 %s", graph_id)

        # Step 6: GraphRAGEngine — 向量化（可选）
        if enable_rag:
            self._emit_progress(on_progress, "rag", "start", "向量化节点...")
            try:
                rag_engine = self._get_rag_engine()
                embedded_count = rag_engine.embed_nodes(graph_id, built.nodes)
                self._emit_progress(
                    on_progress, "rag", "complete",
                    f"向量化完成: {embedded_count} 节点",
                    embedded=embedded_count,
                )
                logger.info("Step 6 完成: 向量化 %d 节点", embedded_count)
            except Exception as e:
                logger.warning("向量化失败: %s", e)

        # 确定状态
        status = self._determine_status(len(modules), len(failed_modules))

        duration = time.time() - start_time
        logger.info("AI 分析完成: 状态=%s, 耗时=%.2fs", status, duration)

        return AIAnalysisResult(
            graph_id=graph_id,
            nodes=all_nodes,
            edges=all_edges,
            status=status,
            failed_modules=failed_modules,
            warnings=[],
            duration_seconds=duration,
        )

    def _create_llm_client(self) -> LLMClient:
        """创建 LLM 客户端。"""
        provider = os.environ.get("LLM_PROVIDER", self.config.provider)
        api_key = (
            os.environ.get("LLM_API_KEY") or
            os.environ.get("ANTHROPIC_API_KEY") or
            os.environ.get("OPENAI_API_KEY") or
            os.environ.get("MINIMAX_API_KEY")
        )
        base_url = os.environ.get("LLM_BASE_URL") or os.environ.get("ANTHROPIC_BASE_URL")
        model = os.environ.get("LLM_MODEL", self.config.model)

        return LLMClient(
            provider=provider,
            model=model or None,
            api_key=api_key,
            base_url=base_url,
            max_tokens=self.config.max_tokens,
            temperature=self.config.temperature,
        )

    def _run_module_scanner(
        self,
        scan_result: ScanResult,
        llm_client: LLMClient,
    ) -> ModulePlan:
        """运行模块扫描 Agent。"""
        try:
            context = AgentContext(
                repo_path=scan_result.repo_path,
                module_id="scanner",
                shared_knowledge=SharedKnowledgeBase(),
            )
            agent = ModuleScannerAgent(context=context, llm_client=llm_client)
            return agent.scan(scan_result)
        except Exception as e:
            logger.error("模块扫描失败: %s", e)
            return ModulePlan(modules=[], architecture_hints={}, confidence=0.0)

    def _create_default_module(self, scan_result: ScanResult) -> ModuleInfo:
        """创建默认模块包含所有文件。"""
        return ModuleInfo(
            id="module:default",
            name="Default Module",
            files=[f.path for f in scan_result.files],
            purpose="自动创建的默认模块，包含所有源码文件",
            language=scan_result.primary_language() or "unknown",
            confidence=1.0,
        )

    def _analyze_module(
        self,
        repo_path: Path,
        module: ModuleInfo,
        llm_client: LLMClient,
        on_progress: Optional[Callable[[dict], None]] = None,
    ) -> tuple[list[GraphNode], list[GraphEdge]]:
        """分析单个模块。"""
        self._emit_progress(
            on_progress, "module_analysis", "start",
            f"分析模块: {module.name}",
            module_id=module.id,
        )

        try:
            orchestrator = AgentOrchestrator(
                repo_path=str(repo_path),
                llm_client=llm_client,
                max_iterations=self.config.max_parallel_modules * 4,
                on_progress=on_progress,
            )

            result = orchestrator.run_architecture_analysis()

            self._emit_progress(
                on_progress, "module_analysis", "complete",
                f"模块分析完成: {module.name}",
                module_id=module.id,
            )

            return result.nodes, result.edges

        except Exception as e:
            logger.error("模块 %s 分析失败: %s", module.id, e)
            return [], []

    def _get_rag_engine(self) -> GraphRAGEngine:
        """获取或创建 GraphRAG 引擎。"""
        if self._rag_engine is None:
            vector_store = self._vector_store or VectorStore()
            self._rag_engine = GraphRAGEngine(
                graph_repo=self._repo,
                vector_store=vector_store,
            )
        return self._rag_engine

    def _emit_progress(
        self,
        on_progress: Optional[Callable[[dict], None]],
        step: str,
        status: str,
        message: str,
        **extra: Any,
    ) -> None:
        """发送进度事件。"""
        if on_progress:
            try:
                on_progress({
                    "step": step,
                    "status": status,
                    "message": message,
                    **extra,
                })
            except Exception:
                pass

    def _determine_status(self, total_modules: int, failed_count: int) -> str:
        """确定分析状态。"""
        if failed_count == 0:
            return "success"
        elif failed_count < total_modules:
            return "partial"
        else:
            return "failed"


# ---------------------------------------------------------------------------
# CLI Entry Point
# ---------------------------------------------------------------------------

def main():
    """CLI 入口点。"""
    import argparse
    import sys

    parser = argparse.ArgumentParser(
        description="AI 驱动的代码分析流水线"
    )
    parser.add_argument(
        "repo_path",
        help="代码仓库路径",
    )
    parser.add_argument(
        "--name", "-n",
        default="",
        help="仓库名称（默认使用目录名）",
    )
    parser.add_argument(
        "--enable-rag",
        action="store_true",
        help="启用向量化（Step 6）",
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="显示详细日志",
    )

    args = parser.parse_args()

    # 配置日志
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )

    def on_progress(event: dict):
        """打印进度。"""
        status = event.get("status", "")
        step = event.get("step", "")
        message = event.get("message", "")
        print(f"[{step}] {status}: {message}")

    try:
        pipeline = AIPipeline()
        result = pipeline.analyze(
            args.repo_path,
            repo_name=args.name,
            enable_rag=args.enable_rag,
            on_progress=on_progress,
        )

        print("\n" + "=" * 60)
        print("AI 分析完成!")
        print("=" * 60)
        print(f"图谱 ID: {result.graph_id}")
        print(f"状态: {result.status}")
        print(f"节点数: {result.node_count}")
        print(f"边数: {result.edge_count}")
        print(f"耗时: {result.duration_seconds:.2f}s")

        if result.failed_modules:
            print(f"\n失败模块 ({len(result.failed_modules)}):")
            for fm in result.failed_modules:
                print(f"  - {fm.module_id}: {fm.reason}")

        sys.exit(0 if result.status != "failed" else 1)

    except ValueError as e:
        print(f"错误: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"分析失败: {e}", file=sys.stderr)
        logger.exception("分析失败")
        sys.exit(1)


if __name__ == "__main__":
    main()
