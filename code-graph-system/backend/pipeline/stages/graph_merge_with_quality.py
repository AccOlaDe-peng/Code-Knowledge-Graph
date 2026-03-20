"""Stage 5: 图谱合并与质量评分。

负责：
1. 合并静态节点/边 + AI 增强节点/边 + DI/Event 边
2. 字段级合并（保留静态置信度）
3. 生成质量报告
4. 发送完成事件
"""
from __future__ import annotations

import logging
import time
from typing import Callable

from backend.graph.graph_builder import GraphBuilder, BuiltGraph
from backend.graph.graph_schema import GraphNode, GraphEdge
from backend.models.static_analysis import (
    ModuleEnhancement,
    QualityReport,
)
from backend.pipeline.observer import (
    AnalysisObserver,
    StageStarted,
    StageCompleted,
    AnalysisCompleted,
)
from backend.pipeline.stages.base import StageBase

logger = logging.getLogger(__name__)


class GraphMergeWithQualityStage(StageBase):
    """Stage 5: 图谱合并与质量评分。

    特点：
    1. 节点先写（structural + AI 补充，字段级合并）
    2. 边后写（structural + AI 验证 + DI/Event）
    3. 更新 module_id（AI 修正文件归属）
    4. 生成质量报告
    """

    name = "graph_merge_with_quality"

    def run(
        self,
        structural_nodes: list[GraphNode],
        structural_edges: list[GraphEdge],
        ai_enhanced_nodes: list[GraphNode],
        ai_enhanced_edges: list[GraphEdge],
        di_event_edges: list[GraphEdge],
        failed_modules: list[str],
        observer: AnalysisObserver | None = None,
        on_progress: Callable[[dict], None] | None = None,
    ) -> tuple[BuiltGraph, QualityReport]:
        """执行图谱合并与质量评分。

        Args:
            structural_nodes: 静态分析节点（高置信度）
            structural_edges: 静态分析边
            ai_enhanced_nodes: AI 增强节点（补充语义信息）
            ai_enhanced_edges: AI 发现的新边
            di_event_edges: DI/Event 解析边
            failed_modules: 分析失败的模块列表
            observer: 事件观察器
            on_progress: 进度回调

        Returns:
            (BuiltGraph, QualityReport)
        """
        start_time = time.time()

        # 发送开始事件
        if observer:
            observer.emit(StageStarted.create(
                "graph_merge_with_quality",
                file_count=len(structural_nodes) + len(ai_enhanced_nodes),
            ))

        if on_progress:
            on_progress(
                {"step": "graph_merge", "status": "start", "message": "合并图谱..."}
            )

        # Step 1: 创建 GraphBuilder
        builder = GraphBuilder()

        # Step 2: 添加静态节点（高优先级，先写入）
        for node in structural_nodes:
            builder.add_node(node)

        # Step 3: 合并 AI 增强节点属性（字段级合并）
        for node in ai_enhanced_nodes:
            builder.merge_node_properties(node, merge_strategy="field_level")

        # Step 4: 添加静态边
        for edge in structural_edges:
            builder.add_edge(edge)

        # Step 5: 添加 AI 发现的边
        for edge in ai_enhanced_edges:
            builder.add_edge(edge)

        # Step 6: 添加 DI/Event 边
        for edge in di_event_edges:
            builder.add_edge(edge)

        # Step 7: 构建图谱
        built = builder.build()

        # Step 8: 计算质量指标
        quality_report = self._calculate_quality_report(
            built=built,
            failed_modules=failed_modules,
        )

        elapsed_ms = int((time.time() - start_time) * 1000)

        # 发送完成事件
        if observer:
            observer.emit(StageCompleted.create(
                "graph_merge_with_quality",
                elapsed_ms,
                cache_hit=False,
            ))

        if on_progress:
            on_progress(
                {
                    "step": "graph_merge",
                    "status": "complete",
                    "message": f"图谱合并完成: {built.node_count} 节点, {built.edge_count} 边",
                    "node_count": built.node_count,
                    "edge_count": built.edge_count,
                }
            )

        logger.info(
            "Stage 5 完成: %d 节点, %d 边, 静态节点 %.1f%%, 低置信度边 %.1f%%",
            built.node_count,
            built.edge_count,
            quality_report.static_node_ratio * 100,
            quality_report.low_confidence_edge_ratio * 100,
        )

        return built, quality_report

    def _calculate_quality_report(
        self,
        built: BuiltGraph,
        failed_modules: list[str],
    ) -> QualityReport:
        """计算质量报告。"""
        # 计算边指标
        total_edges = len(built.edges)
        low_conf_edges = [
            e for e in built.edges
            if e.properties.get("confidence", 0) < 0.70
        ]
        low_conf_edge_ratio = len(low_conf_edges) / total_edges if total_edges > 0 else 0.0

        # 计算节点指标
        static_nodes = sum(
            1 for n in built.nodes
            if n.properties.get("source") == "static"
        )
        ai_nodes = sum(
            1 for n in built.nodes
            if n.properties.get("source") == "ai_enhanced"
        )
        total_nodes = len(built.nodes)
        static_node_ratio = static_nodes / total_nodes if total_nodes > 0 else 0.0
        ai_node_ratio = ai_nodes / total_nodes if total_nodes > 0 else 0.0

        # 创建质量报告
        report = QualityReport(
            low_confidence_edge_ratio=low_conf_edge_ratio,
            failed_modules=failed_modules,
            static_node_ratio=static_node_ratio,
            ai_node_ratio=ai_node_ratio,
        )
        report.check_thresholds()

        return report


def emit_analysis_completed(
    observer: AnalysisObserver,
    graph_id: str,
    quality_report: QualityReport,
    elapsed_ms: int,
) -> None:
    """发送分析完成事件。

    双路径传递：
    1. 通过 Observer 发送事件（用于 SSE）
    2. 通过返回值传递（用于 API 响应）
    """
    observer.emit(AnalysisCompleted.create(
        graph_id=graph_id,
        node_count=quality_report.static_node_ratio * 100,  # 复用字段传递统计
        edge_count=quality_report.low_confidence_edge_ratio * 100,
        elapsed_ms=elapsed_ms,
        warnings=quality_report.warnings,
        errors=quality_report.errors,
    ))
