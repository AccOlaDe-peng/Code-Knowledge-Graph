"""
分析流水线模块。

提供两种分析流水线：

1. AIPipeline（推荐）— AI 驱动的代码分析流水线
   - 使用 LLM 进行模块识别和代码分析
   - 生成语义化的知识图谱
   - 支持 GraphRAG 查询

2. AnalysisPipeline（旧版）— 静态分析流水线
   - 基于 Tree-sitter AST 解析
   - 已弃用，保留用于向后兼容

3. GraphPipeline — 图谱构建流水线
   - 从已有数据构建图谱
"""

# AI 驱动流水线（推荐）
from backend.pipeline.ai_analyze import AIPipeline
from backend.models.ai_analysis import AIAnalysisResult, AIAnalysisConfig

# 旧版静态分析流水线（向后兼容）
from backend.pipeline.analyze_repository import AnalysisPipeline, AnalysisResult

# 图谱构建流水线
from backend.pipeline.graph_pipeline import GraphPipeline

__all__ = [
    # AI Pipeline (推荐)
    "AIPipeline",
    "AIAnalysisResult",
    "AIAnalysisConfig",
    # Legacy Pipeline (向后兼容)
    "AnalysisPipeline",
    "AnalysisResult",
    # Graph Pipeline
    "GraphPipeline",
]