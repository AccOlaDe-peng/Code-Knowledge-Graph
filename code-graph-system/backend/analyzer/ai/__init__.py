"""
AI Analyzer 子包。

提供基于 LLM 的高层次代码分析能力，在静态分析之后运行，
利用 RepoSummary 生成架构/服务/业务流/数据血缘等语义节点。

可用分析器：
    AIArchitectureAnalyzer  — 识别分层架构，生成 Layer 节点
    AIServiceDetector       — 识别微服务边界，补全 Service 节点
    AIBusinessFlowAnalyzer  — 识别业务流程，生成 Flow 节点
    AIDataLineageAnalyzer   — 追踪数据血缘，生成 reads/writes/transforms 边
"""

from backend.analyzer.ai.ai_analyzer_base import AIAnalysisGraph, AIAnalyzerBase
from backend.analyzer.ai.ai_architecture_analyzer import AIArchitectureAnalyzer
from backend.analyzer.ai.ai_business_flow_analyzer import AIBusinessFlowAnalyzer
from backend.analyzer.ai.ai_data_lineage_analyzer import AIDataLineageAnalyzer
from backend.analyzer.ai.ai_service_detector import AIServiceDetector

__all__ = [
    "AIAnalyzerBase",
    "AIAnalysisGraph",
    "AIArchitectureAnalyzer",
    "AIServiceDetector",
    "AIBusinessFlowAnalyzer",
    "AIDataLineageAnalyzer",
]
