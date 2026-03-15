"""
代码分析器模块。

提供基于 AI 的代码分析能力，利用 LLM 生成架构/服务/业务流/数据血缘/领域模型等语义节点。

可用分析器（AI 驱动）：
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

# 从 AI 子包重新导出所有公共 API
from backend.analyzer.ai import (
    AIAnalysisGraph,
    AIAnalyzerBase,
    AIArchitectureAnalyzer,
    AIBusinessFlowAnalyzer,
    AIDataLineageAnalyzer,
    AIDomainModelAnalyzer,
    AIServiceDetector,
    PromptLoader,
    PromptTemplate,
    ResponseValidator,
    ValidationResult,
)

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
