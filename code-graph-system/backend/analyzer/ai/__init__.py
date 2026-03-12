"""
AI Analyzer 子包。

提供基于 LLM 的高层次代码分析能力，在静态分析之后运行，
利用 RepoSummary 生成架构/服务/业务流/数据血缘/领域模型等语义节点。

可用分析器：
    AIArchitectureAnalyzer  — 识别分层架构，生成 Layer 节点
    AIServiceDetector       — 识别微服务边界，补全 Service 节点
    AIBusinessFlowAnalyzer  — 识别业务流程，生成 Flow 节点
    AIDataLineageAnalyzer   — 追踪数据血缘，生成 reads/writes/transforms 边
    AIDomainModelAnalyzer   — 识别 DDD 领域模型，生成 DomainEntity 节点

Prompt 系统：
    PromptLoader      — 从 prompts/*.txt 文件加载模板，内置模板兜底
    PromptTemplate    — 单个模板（system + user_template + version）
    ResponseValidator — 验证 LLM 响应 JSON 结构
    ValidationResult  — 验证结果容器
"""

from backend.analyzer.ai.ai_analyzer_base import AIAnalysisGraph, AIAnalyzerBase
from backend.analyzer.ai.ai_architecture_analyzer import AIArchitectureAnalyzer
from backend.analyzer.ai.ai_business_flow_analyzer import AIBusinessFlowAnalyzer
from backend.analyzer.ai.ai_data_lineage_analyzer import AIDataLineageAnalyzer
from backend.analyzer.ai.ai_domain_model_analyzer import AIDomainModelAnalyzer
from backend.analyzer.ai.ai_service_detector import AIServiceDetector
from backend.analyzer.ai.prompt_loader import PromptLoader, PromptTemplate
from backend.analyzer.ai.prompt_validator import ResponseValidator, ValidationResult

__all__ = [
    # Base
    "AIAnalyzerBase",
    "AIAnalysisGraph",
    # Analyzers
    "AIArchitectureAnalyzer",
    "AIServiceDetector",
    "AIBusinessFlowAnalyzer",
    "AIDataLineageAnalyzer",
    "AIDomainModelAnalyzer",
    # Prompt system
    "PromptLoader",
    "PromptTemplate",
    "ResponseValidator",
    "ValidationResult",
]
