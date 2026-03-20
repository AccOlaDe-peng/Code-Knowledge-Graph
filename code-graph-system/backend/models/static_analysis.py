"""静态分析数据模型。

定义静态优先、AI 增强流水线所需的数据结构。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from backend.graph.graph_schema import GraphNode, GraphEdge


# ─────────────────────────────────────────────────────────────────────────────
# Stage 0: 文件索引
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class FileInfo:
    """文件元信息。"""

    path: str  # 相对路径
    absolute_path: Path  # 绝对路径
    language: str  # 语言类型
    size_bytes: int  # 文件大小（字节）
    line_count: int  # 行数
    modified_time: float  # mtime


@dataclass
class FileIndexResult:
    """Stage 0 输出：文件索引结果。"""

    all_files: dict[str, FileInfo]  # 全量文件元数据
    changed_files: set[str]  # 本次变更文件（增量模式）
    is_incremental: bool  # 是否增量分析


# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: 深度静态分析
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class FrameworkPattern:
    """框架模式检测结果（Spring DI/Event/Kafka 等）。"""

    pattern_type: str  # "di" | "event" | "kafka_produce" | "kafka_consume" | "feign"
    source_file: str  # 检测到的文件路径
    source_element: str  # 类名或方法名
    target_hint: str | None  # 目标提示（如 @Qualifier 值、topic 名称）
    raw_code: str  # 原始代码片段
    line_number: int  # 行号
    confidence: float = 0.80  # 默认置信度


@dataclass
class StaticAnalysisResult:
    """Stage 1 输出：深度静态分析结果。

    产出 A（持久化，直接入图谱）：
        - structural_nodes: 结构节点
        - structural_edges: 结构边

    产出 B（临时，供后续 Stage 消费）：
        - import_graph: 导入图
        - framework_patterns: 框架模式候选
        - low_confidence_edges: 低置信度边
    """

    # 产出 A（持久化）
    structural_nodes: list[GraphNode] = field(default_factory=list)
    structural_edges: list[GraphEdge] = field(default_factory=list)

    # 产出 B（临时）
    import_graph: dict[str, list[str]] = field(default_factory=dict)
    framework_patterns: list[FrameworkPattern] = field(default_factory=list)
    low_confidence_edges: list[GraphEdge] = field(default_factory=list)
    parse_warnings: list[str] = field(default_factory=list)  # Java 14+ 降级警告


# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: 目录聚类
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class ClusterConfig:
    """目录聚类配置。"""

    dir_depth: int = 2  # 目录切割深度
    coupling_threshold: int = 5  # 跨目录 import 阈值
    skip_dirs: list[str] = field(
        default_factory=lambda: [
            "utils",
            "common",
            "constants",
            "exceptions",
            "config",
            "test",
            "tests",
        ]
    )
    java_maven_normalize: bool = True  # 是否剥离 Maven 前缀


@dataclass
class ModuleCandidate:
    """Stage 2 输出：模块候选（静态聚类结果）。"""

    id: str  # 模块 ID，格式: "module:{name}"
    name: str  # 模块名称
    files: list[str]  # 包含的文件路径列表
    boundary_confidence: float = 1.0  # 边界置信度
    boundary_warnings: list[str] = field(default_factory=list)  # 边界警告


# ─────────────────────────────────────────────────────────────────────────────
# Stage 3: AI 语义增强
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class EdgeValidation:
    """AI 对低置信度边的验证结果。"""

    edge_id: str  # 边的唯一标识（from -> to）
    is_valid: bool  # 是否有效
    corrected_target: str | None = None  # 修正后的目标（如 AI 认为应该指向其他类）
    confidence: float = 0.75  # 验证后的置信度
    reason: str = ""  # 验证理由


@dataclass
class NewRelationship:
    """AI 发现的额外关系。"""

    from_element: str  # 源元素
    to_element: str  # 目标元素
    relationship_type: str  # 关系类型
    description: str  # 描述
    confidence: float = 0.70


@dataclass
class ModuleEnhancement:
    """Stage 3 输出：AI 语义增强结果。"""

    module_id: str
    confirmed_files: list[str]  # 确认/修正后的文件列表
    name: str  # 语义命名
    purpose: str  # 模块用途描述
    layer: str  # 架构层（controller/service/repository/...）
    technology: list[str] = field(default_factory=list)  # 技术栈
    validated_edges: list[EdgeValidation] = field(default_factory=list)
    new_relationships: list[NewRelationship] = field(default_factory=list)


# ─────────────────────────────────────────────────────────────────────────────
# Stage 5: 质量评分
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class ModuleQuality:
    """模块级质量指标。"""

    module_id: str
    boundary_confidence: float
    node_count: int
    ai_node_count: int
    static_node_count: int
    ai_correction_count: int  # AI 修正了多少静态结论
    low_confidence_edge_count: int


@dataclass
class StageMetrics:
    """单个 Stage 的性能指标。"""

    duration_ms: int
    llm_calls: int = 0
    cache_hits: int = 0
    cache_misses: int = 0
    token_count: int = 0


@dataclass
class QualityReport:
    """Stage 5 输出：质量报告。"""

    # 模块级
    modules: list[ModuleQuality] = field(default_factory=list)

    # 图谱级
    low_confidence_edge_ratio: float = 0.0  # < 0.7 的边占比
    failed_modules: list[str] = field(default_factory=list)
    static_node_ratio: float = 0.0  # 静态产出节点占比
    ai_node_ratio: float = 0.0  # AI 产出节点占比
    stage_metrics: dict[str, StageMetrics] = field(default_factory=dict)

    # 告警
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    def check_thresholds(self) -> None:
        """检查告警阈值，填充 warnings 和 errors。"""
        # low_confidence_edge_ratio
        if self.low_confidence_edge_ratio > 0.50:
            self.errors.append(
                f"low_confidence_edge_ratio={self.low_confidence_edge_ratio:.2%} > 50%"
            )
        elif self.low_confidence_edge_ratio > 0.30:
            self.warnings.append(
                f"low_confidence_edge_ratio={self.low_confidence_edge_ratio:.2%} > 30%"
            )

        # failed_modules 占比
        total_modules = len(self.modules) + len(self.failed_modules)
        if total_modules > 0:
            failed_ratio = len(self.failed_modules) / total_modules
            if failed_ratio > 0.20:
                self.errors.append(
                    f"failed_modules_ratio={failed_ratio:.2%} > 20%"
                )
            elif failed_ratio > 0.10:
                self.warnings.append(
                    f"failed_modules_ratio={failed_ratio:.2%} > 10%"
                )

        # 单模块 ai_correction_count
        for m in self.modules:
            if m.ai_correction_count > 10:
                self.errors.append(
                    f"module={m.module_id} ai_correction_count={m.ai_correction_count} > 10"
                )
            elif m.ai_correction_count > 5:
                self.warnings.append(
                    f"module={m.module_id} ai_correction_count={m.ai_correction_count} > 5"
                )


# ─────────────────────────────────────────────────────────────────────────────
# 置信度常量（不使用魔法数字）
# ─────────────────────────────────────────────────────────────────────────────


class ConfidenceLevel:
    """置信度常量。"""

    # 静态分析
    DIRECT_IMPORT = 0.95  # 直接 import 语句
    ANNOTATION_DRIVEN = 0.90  # 注解驱动（@app.route, @GetMapping 等）
    TYPE_INFERRED_CALL = 0.85  # 类型推断的方法调用
    FRAMEWORK_PATTERN = 0.80  # 框架模式匹配
    DIRECTORY_HEURISTIC = 0.65  # 目录同级启发
    REGEX_FALLBACK = 0.65  # 正则降级

    # Spring 专项
    SPRING_CONFIG_BEAN = 0.98  # @Configuration @Bean 显式声明
    SPRING_QUALIFIER = 0.95  # @Autowired + @Qualifier
    SPRING_SINGLE_IMPL = 0.90  # @Autowired + 单实现
    SPRING_PRIMARY = 0.88  # @Primary 标注默认实现
    SPRING_EVENT_LISTENER = 0.92  # @EventListener + 具体事件类
    SPRING_KAFKA_CONSTANT = 0.90  # @KafkaListener + 字符串常量 topic
    SPRING_KAFKA_CONFIG = 0.85  # @Value 注入的 topic
    SPRING_FEIGN = 0.88  # @FeignClient(name=...)

    # AI 增强
    AI_VALIDATED = 0.75  # AI 验证通过（原低置信）
    AI_DISCOVERED = 0.70  # AI 新发现
