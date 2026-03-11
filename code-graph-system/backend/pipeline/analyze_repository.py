"""
代码仓库分析流水线模块。

整合所有分析器，编排完整的代码分析流程：
1. 扫描仓库
2. 解析源码
3. 执行各类分析器
4. 构建图谱
5. 语义增强（可选）
6. 持久化存储

支持增量更新和并行处理。
"""

from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Optional

from backend.analyzer.call_graph_builder import CallGraphBuilder
from backend.analyzer.component_detector import ComponentDetector
from backend.analyzer.data_lineage_analyzer import DataLineageAnalyzer
from backend.analyzer.dependency_analyzer import DependencyAnalyzer
from backend.analyzer.event_analyzer import EventAnalyzer
from backend.analyzer.infra_analyzer import InfraAnalyzer
from backend.analyzer.module_detector import ModuleDetector
from backend.graph.graph_builder import GraphBuilder
from backend.graph.graph_repository import GraphRepository
from backend.graph.schema import AnalysisRequest, AnalysisResponse, CodeGraph, RepositoryNode
from backend.parser.code_parser import CodeParser
from backend.rag.vector_store import VectorStore
from backend.scanner.repo_scanner import RepoScanner

logger = logging.getLogger(__name__)


class AnalysisPipeline:
    """
    代码仓库分析流水线。

    协调所有分析组件，执行端到端的代码知识图谱构建流程。

    示例::

        pipeline = AnalysisPipeline()
        graph = await pipeline.analyze("/path/to/repo")
    """

    def __init__(
        self,
        graph_repo: Optional[GraphRepository] = None,
        vector_store: Optional[VectorStore] = None,
    ) -> None:
        """
        初始化分析流水线。

        Args:
            graph_repo: 图谱存储仓库
            vector_store: 向量存储
        """
        self.graph_repo = graph_repo or GraphRepository()
        self.vector_store = vector_store or VectorStore()
        self.scanner = RepoScanner()
        self.parser = CodeParser()

    def analyze(
        self,
        request: AnalysisRequest,
    ) -> AnalysisResponse:
        """
        执行完整的代码仓库分析。

        Args:
            request: 分析请求对象

        Returns:
            分析响应对象
        """
        start_time = time.time()
        repo_path = Path(request.repo_path)

        if not repo_path.exists():
            return AnalysisResponse(
                task_id="",
                status="failed",
                message=f"仓库路径不存在: {repo_path}",
            )

        logger.info(f"开始分析仓库: {repo_path}")

        try:
            # 1. 扫描仓库
            logger.info("步骤 1/7: 扫描仓库文件...")
            scan_result = self.scanner.scan(
                repo_path,
                languages=request.languages or None,
                compute_hash=request.incremental,
            )

            if scan_result.total_files == 0:
                return AnalysisResponse(
                    task_id="",
                    status="failed",
                    message="未找到可分析的源码文件",
                )

            # 2. 解析源码
            logger.info(f"步骤 2/7: 解析 {scan_result.total_files} 个文件...")
            parsed_files = {}
            for file_info in scan_result.files:
                parsed = self.parser.parse_file(file_info.abs_path)
                if not parsed.errors:
                    parsed_files[file_info.path] = parsed

            logger.info(f"成功解析 {len(parsed_files)} 个文件")

            # 3. 模块识别
            logger.info("步骤 3/7: 识别模块结构...")
            module_detector = ModuleDetector(str(repo_path))
            module_nodes, import_edges = module_detector.detect(scan_result, parsed_files)
            module_map = {n.file_path: n for n in module_nodes}

            # 4. 组件识别
            logger.info("步骤 4/7: 识别类和组件...")
            component_detector = ComponentDetector()
            component_nodes, component_edges = component_detector.detect(
                parsed_files, {f.path: module_map.get(f.abs_path) for f in scan_result.files}
            )
            component_map = {n.name: n for n in component_nodes}

            # 5. 函数调用图
            logger.info("步骤 5/7: 构建函数调用图...")
            call_graph_builder = CallGraphBuilder()
            function_nodes, call_edges = call_graph_builder.build(
                parsed_files,
                {f.path: module_map.get(f.abs_path) for f in scan_result.files},
                component_map,
            )
            function_map = {f.name: f for f in function_nodes}

            # 6. 数据血缘分析
            logger.info("步骤 6/7: 分析数据血缘...")
            lineage_analyzer = DataLineageAnalyzer()
            data_entities, lineage_edges = lineage_analyzer.analyze(
                parsed_files, function_map
            )

            # 7. 事件流分析
            logger.info("步骤 7/7: 分析事件流...")
            event_analyzer = EventAnalyzer()
            event_nodes, event_edges = event_analyzer.analyze(
                parsed_files, function_map
            )

            # 8. 依赖分析
            logger.info("分析外部依赖...")
            dep_analyzer = DependencyAnalyzer(str(repo_path))
            dep_report, dep_infra_nodes, dep_edges = dep_analyzer.analyze(
                {f.path: module_map.get(f.abs_path) for f in scan_result.files},
                import_edges,
            )

            # 9. 基础设施分析
            logger.info("分析基础设施依赖...")
            infra_analyzer = InfraAnalyzer(str(repo_path))
            infra_nodes, infra_edges = infra_analyzer.analyze(parsed_files)

            # 10. 构建图谱
            logger.info("构建知识图谱...")
            builder = GraphBuilder()

            # 创建仓库根节点
            repo_node = RepositoryNode(
                name=scan_result.repo_name,
                file_path=str(repo_path),
                url=scan_result.git_remote_url,
                language=scan_result.primary_language(),
                branch=scan_result.git_branch,
                commit_hash=scan_result.git_commit,
            )

            # 添加所有节点
            builder.add_nodes(module_nodes)
            builder.add_nodes(component_nodes)
            builder.add_nodes(function_nodes)
            builder.add_nodes(data_entities)
            builder.add_nodes(event_nodes)
            builder.add_nodes(dep_infra_nodes)
            builder.add_nodes(infra_nodes)

            # 添加所有边
            builder.add_edges(import_edges)
            builder.add_edges(component_edges)
            builder.add_edges(call_edges)
            builder.add_edges(lineage_edges)
            builder.add_edges(event_edges)
            builder.add_edges(dep_edges)
            builder.add_edges(infra_edges)

            # 构建最终图谱
            graph = builder.build(repo_node)

            # 11. 持久化
            logger.info("保存图谱...")
            graph_id = self.graph_repo.save(graph)

            # 12. 向量化（如果启用 AI）
            if request.enable_ai:
                logger.info("生成向量索引...")
                self.vector_store.add_nodes(graph.nodes, collection_name=graph_id)

            duration = time.time() - start_time
            logger.info(f"分析完成，耗时 {duration:.2f}s")

            return AnalysisResponse(
                task_id=graph_id,
                status="completed",
                repo_id=graph_id,
                message=f"分析成功，生成 {graph.stats.node_count} 个节点",
                stats=graph.stats,
            )

        except Exception as e:
            logger.exception("分析过程中发生异常")
            return AnalysisResponse(
                task_id="",
                status="failed",
                message=f"分析失败: {str(e)}",
            )


if __name__ == "__main__":
    import sys

    logging.basicConfig(level=logging.INFO)
    pipeline = AnalysisPipeline()
    target = sys.argv[1] if len(sys.argv) > 1 else "."
    req = AnalysisRequest(repo_path=target, enable_ai=False)
    resp = pipeline.analyze(req)
    print(f"\n状态: {resp.status}")
    print(f"消息: {resp.message}")
    if resp.stats:
        print(f"节点数: {resp.stats.node_count}")
        print(f"边数: {resp.stats.edge_count}")
