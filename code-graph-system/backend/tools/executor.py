"""工具执行器：统一管理 Agent 的工具调用权限和执行。"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════════
# Agent 工具权限配置
# ═══════════════════════════════════════════════════════════════════════════

AGENT_TOOL_PERMISSIONS = {
    "EntityAgent": [
        # 基础工具
        "list_directory",
        "search_code",
        "read_file",
        "read_lines",
        "find_files",
        "grep_pattern",
        "get_file_info",
        "list_imports",
        # 语义工具
        "extract_annotations",
        "extract_classes",
        "extract_methods",
        "extract_fields",
        "analyze_inheritance",
        "infer_field_mapping",
        # 框架工具
        "jpa_entity_analyzer",
        "jpa_relation_resolver",
        "mybatis_mapper",
        # 高级工具
        "resolve_ambiguity",
        "cross_file_follow",
    ],
    "ServiceAgent": [
        # 基础工具
        "list_directory",
        "search_code",
        "read_file",
        "read_lines",
        "find_files",
        "grep_pattern",
        "get_file_info",
        "list_imports",
        # 语义工具
        "extract_annotations",
        "extract_classes",
        "extract_methods",
        "extract_fields",
        "extract_call_graph",
        "detect_patterns",
        # 框架工具
        "spring_di_resolver",
        "spring_http_mapping",
        "spring_transaction_boundary",
        "spring_kafka_listener",
        # 高级工具
        "cross_file_follow",
        "trace_data_flow",
    ],
    "LineageAgent": [
        # 基础工具
        "search_code",
        "read_file",
        "read_lines",
        "grep_pattern",
        # 语义工具
        "extract_methods",
        "extract_call_graph",
        # 高级工具
        "trace_data_flow",
        "cross_file_follow",
        "explain_code",
    ],
    "FlowAgent": [
        # 基础工具
        "list_directory",
        "search_code",
        "read_file",
        "read_lines",
        "find_files",
        "grep_pattern",
        # 语义工具
        "extract_annotations",
        "extract_classes",
        "extract_methods",
        "detect_patterns",
        # 高级工具
        "explain_code",
        "cross_file_follow",
    ],
    "TopicAgent": [
        # 基础工具
        "search_code",
        "read_file",
        "read_lines",
        "grep_pattern",
        "find_files",
        # 语义工具
        "extract_annotations",
        "extract_methods",
        # 框架工具
        "spring_kafka_listener",
        # 高级工具
        "cross_file_follow",
    ],
}


# ═══════════════════════════════════════════════════════════════════════════
# 工具结果状态
# ═══════════════════════════════════════════════════════════════════════════

class ToolResultStatus(Enum):
    """工具执行状态。"""
    SUCCESS = "success"
    ERROR = "error"
    PARTIAL = "partial"
    NOT_FOUND = "not_found"
    TIMEOUT = "timeout"
    NO_PERMISSION = "no_permission"


@dataclass
class ToolResult:
    """工具执行结果。"""
    status: ToolResultStatus
    data: Any = None
    error: str | None = None
    metadata: dict = field(default_factory=dict)
    cache_hit: bool = False


# ═══════════════════════════════════════════════════════════════════════════
# 工具定义
# ═══════════════════════════════════════════════════════════════════════════

@dataclass
class ToolDefinition:
    """工具定义。"""
    name: str
    description: str
    parameters: dict
    returns: str
    layer: str  # "base", "semantic", "framework", "advanced"


# 基础工具定义
BASE_TOOL_DEFINITIONS = {
    "list_directory": ToolDefinition(
        name="list_directory",
        description="列出指定目录下的所有文件和子目录",
        parameters={
            "path": {"type": "string", "description": "相对于仓库根目录的路径"},
            "recursive": {"type": "boolean", "description": "是否递归列出子目录", "default": False},
            "file_pattern": {"type": "string", "description": "文件名过滤模式（如 *.java）", "default": "*"},
        },
        returns="目录内容列表，包含文件名、类型、大小",
        layer="base",
    ),
    "search_code": ToolDefinition(
        name="search_code",
        description="在代码文件中搜索指定文本模式（支持正则表达式）",
        parameters={
            "pattern": {"type": "string", "description": "搜索模式（支持正则表达式）"},
            "file_pattern": {"type": "string", "description": "文件名过滤模式", "default": "*.java"},
            "context_lines": {"type": "integer", "description": "返回匹配行的上下文行数", "default": 2},
        },
        returns="匹配结果列表，包含文件路径、行号、匹配内容",
        layer="base",
    ),
    "read_file": ToolDefinition(
        name="read_file",
        description="读取指定文件的完整内容",
        parameters={
            "path": {"type": "string", "description": "相对于仓库根目录的文件路径"},
            "max_size": {"type": "integer", "description": "最大读取字节数", "default": 524288},
        },
        returns="文件完整内容字符串",
        layer="base",
    ),
    "read_lines": ToolDefinition(
        name="read_lines",
        description="读取文件指定行范围的内容",
        parameters={
            "path": {"type": "string", "description": "文件路径"},
            "start_line": {"type": "integer", "description": "起始行号（从 1 开始）"},
            "end_line": {"type": "integer", "description": "结束行号"},
        },
        returns="指定行范围的代码内容",
        layer="base",
    ),
    "find_files": ToolDefinition(
        name="find_files",
        description="根据名称模式查找文件",
        parameters={
            "pattern": {"type": "string", "description": "文件名模式（支持通配符）"},
            "path": {"type": "string", "description": "搜索起始目录", "default": "."},
        },
        returns="匹配的文件路径列表",
        layer="base",
    ),
    "grep_pattern": ToolDefinition(
        name="grep_pattern",
        description="使用正则表达式在文件中搜索并提取匹配内容",
        parameters={
            "path": {"type": "string", "description": "文件路径"},
            "pattern": {"type": "string", "description": "正则表达式模式"},
            "extract_groups": {"type": "boolean", "description": "是否提取捕获组", "default": True},
        },
        returns="匹配结果，包含提取的内容",
        layer="base",
    ),
    "get_file_info": ToolDefinition(
        name="get_file_info",
        description="获取文件的元信息",
        parameters={
            "path": {"type": "string", "description": "文件路径"},
        },
        returns="文件元信息：大小、行数、语言、最后修改时间",
        layer="base",
    ),
    "list_imports": ToolDefinition(
        name="list_imports",
        description="列出文件中的所有 import 语句",
        parameters={
            "path": {"type": "string", "description": "文件路径"},
        },
        returns="导入列表，包含包名和类名",
        layer="base",
    ),
}

# 语义工具定义
SEMANTIC_TOOL_DEFINITIONS = {
    "extract_annotations": ToolDefinition(
        name="extract_annotations",
        description="从文件中提取所有注解及其属性",
        parameters={
            "path": {"type": "string", "description": "文件路径"},
            "annotation_filter": {"type": "string", "description": "注解名称过滤（可选）", "default": None},
        },
        returns="注解列表，包含注解名、位置、属性值",
        layer="semantic",
    ),
    "extract_classes": ToolDefinition(
        name="extract_classes",
        description="从文件中提取所有类/接口/枚举定义",
        parameters={
            "path": {"type": "string", "description": "文件路径"},
        },
        returns="类定义列表，包含类名、类型、修饰符、父类、接口",
        layer="semantic",
    ),
    "extract_methods": ToolDefinition(
        name="extract_methods",
        description="从类中提取所有方法定义",
        parameters={
            "path": {"type": "string", "description": "文件路径"},
            "class_name": {"type": "string", "description": "目标类名"},
        },
        returns="方法列表，包含方法名、签名、返回类型、注解、行号",
        layer="semantic",
    ),
    "extract_fields": ToolDefinition(
        name="extract_fields",
        description="从类中提取所有字段定义",
        parameters={
            "path": {"type": "string", "description": "文件路径"},
            "class_name": {"type": "string", "description": "目标类名"},
        },
        returns="字段列表，包含字段名、类型、修饰符、注解",
        layer="semantic",
    ),
    "extract_call_graph": ToolDefinition(
        name="extract_call_graph",
        description="从方法中提取方法调用关系",
        parameters={
            "path": {"type": "string", "description": "文件路径"},
            "method_name": {"type": "string", "description": "目标方法名"},
            "depth": {"type": "integer", "description": "调用深度", "default": 1},
        },
        returns="调用图，包含调用者、被调用者、调用位置",
        layer="semantic",
    ),
    "analyze_inheritance": ToolDefinition(
        name="analyze_inheritance",
        description="分析类的继承结构",
        parameters={
            "path": {"type": "string", "description": "文件路径"},
            "class_name": {"type": "string", "description": "目标类名"},
        },
        returns="继承链，包含父类、接口、子类",
        layer="semantic",
    ),
    "infer_field_mapping": ToolDefinition(
        name="infer_field_mapping",
        description="推断 Java 字段到数据库列的映射关系",
        parameters={
            "path": {"type": "string", "description": "实体文件路径"},
            "class_name": {"type": "string", "description": "实体类名"},
        },
        returns="字段映射列表，包含字段名、列名、类型、约束",
        layer="semantic",
    ),
    "detect_patterns": ToolDefinition(
        name="detect_patterns",
        description="检测代码中的设计模式和架构模式",
        parameters={
            "path": {"type": "string", "description": "文件路径"},
            "pattern_types": {"type": "array", "description": "要检测的模式类型", "default": ["singleton", "factory", "strategy", "builder", "repository"]},
        },
        returns="检测到的模式列表",
        layer="semantic",
    ),
}

# 框架工具定义
FRAMEWORK_TOOL_DEFINITIONS = {
    "spring_di_resolver": ToolDefinition(
        name="spring_di_resolver",
        description="解析 Spring 依赖注入关系",
        parameters={
            "path": {"type": "string", "description": "服务文件路径"},
            "class_name": {"type": "string", "description": "服务类名"},
        },
        returns="DI 关系列表，包含注入字段、类型、Qualifier",
        layer="framework",
    ),
    "spring_http_mapping": ToolDefinition(
        name="spring_http_mapping",
        description="提取 Spring HTTP 映射信息",
        parameters={
            "path": {"type": "string", "description": "Controller 文件路径"},
            "class_name": {"type": "string", "description": "Controller 类名"},
        },
        returns="HTTP 端点列表，包含方法、路径、参数、返回类型",
        layer="framework",
    ),
    "spring_transaction_boundary": ToolDefinition(
        name="spring_transaction_boundary",
        description="分析 Spring 事务边界",
        parameters={
            "path": {"type": "string", "description": "服务文件路径"},
            "class_name": {"type": "string", "description": "服务类名"},
        },
        returns="事务方法列表，包含传播行为、隔离级别、回滚规则",
        layer="framework",
    ),
    "spring_kafka_listener": ToolDefinition(
        name="spring_kafka_listener",
        description="分析 Spring Kafka 监听器",
        parameters={
            "path": {"type": "string", "description": "消费者文件路径"},
        },
        returns="Kafka 监听器列表，包含 topic、group、方法、消息类型",
        layer="framework",
    ),
    "jpa_entity_analyzer": ToolDefinition(
        name="jpa_entity_analyzer",
        description="深度分析 JPA 实体",
        parameters={
            "path": {"type": "string", "description": "实体文件路径"},
            "class_name": {"type": "string", "description": "实体类名"},
        },
        returns="完整的实体分析结果，包含表名、主键、字段、索引、约束",
        layer="framework",
    ),
    "jpa_relation_resolver": ToolDefinition(
        name="jpa_relation_resolver",
        description="解析 JPA 实体间的关系",
        parameters={
            "path": {"type": "string", "description": "实体文件路径"},
            "class_name": {"type": "string", "description": "实体类名"},
        },
        returns="关系列表，包含类型、目标实体、Join 配置",
        layer="framework",
    ),
    "mybatis_mapper": ToolDefinition(
        name="mybatis_mapper",
        description="分析 MyBatis Mapper 接口和 XML 映射",
        parameters={
            "mapper_path": {"type": "string", "description": "Mapper 接口路径"},
            "xml_path": {"type": "string", "description": "Mapper XML 路径（可选）", "default": None},
        },
        returns="SQL 映射列表，包含方法、SQL 类型、表、字段",
        layer="framework",
    ),
}

# 高级工具定义
ADVANCED_TOOL_DEFINITIONS = {
    "trace_data_flow": ToolDefinition(
        name="trace_data_flow",
        description="追踪字段值在代码中的流转路径",
        parameters={
            "start_entity": {"type": "string", "description": "起始实体名"},
            "start_field": {"type": "string", "description": "起始字段名"},
            "max_depth": {"type": "integer", "description": "最大追踪深度", "default": 5},
        },
        returns="数据流路径，包含经过的方法、转换逻辑",
        layer="advanced",
    ),
    "cross_file_follow": ToolDefinition(
        name="cross_file_follow",
        description="跨文件追踪符号引用",
        parameters={
            "symbol_name": {"type": "string", "description": "符号名称（类名/方法名/字段名）"},
            "from_file": {"type": "string", "description": "起始文件路径"},
            "follow_type": {"type": "string", "description": "追踪类型：definition / usage / both", "default": "both"},
        },
        returns="追踪结果，包含定义位置和所有引用位置",
        layer="advanced",
    ),
    "resolve_ambiguity": ToolDefinition(
        name="resolve_ambiguity",
        description="使用 LLM 解决代码分析中的歧义",
        parameters={
            "ambiguous_item": {"type": "object", "description": "歧义项描述"},
            "candidates": {"type": "array", "description": "候选解释列表"},
            "evidence": {"type": "array", "description": "支持证据"},
        },
        returns="解决结果，包含选择的解释和理由",
        layer="advanced",
    ),
    "explain_code": ToolDefinition(
        name="explain_code",
        description="使用 LLM 解释代码",
        parameters={
            "path": {"type": "string", "description": "文件路径"},
            "start_line": {"type": "integer", "description": "起始行"},
            "end_line": {"type": "integer", "description": "结束行"},
            "explain_level": {"type": "string", "description": "解释级别：brief / detailed / comprehensive", "default": "detailed"},
        },
        returns="代码解释文本",
        layer="advanced",
    ),
}

# 合并所有工具定义
ALL_TOOL_DEFINITIONS = {
    **BASE_TOOL_DEFINITIONS,
    **SEMANTIC_TOOL_DEFINITIONS,
    **FRAMEWORK_TOOL_DEFINITIONS,
    **ADVANCED_TOOL_DEFINITIONS,
}


# ═══════════════════════════════════════════════════════════════════════════
# ToolExecutor
# ═══════════════════════════════════════════════════════════════════════════

class ToolExecutor:
    """工具执行器：统一管理工具调用权限和执行。

    使用示例：
        executor = ToolExecutor(repo_path, "EntityAgent", llm_client)

        # 执行工具
        result = executor.execute("read_file", {"path": "src/User.java"})

        # 获取 LLM 可用的工具定义
        definitions = executor.get_tool_definitions_for_llm()
    """

    def __init__(
        self,
        repo_path: Path | str,
        agent_name: str,
        llm_client: Any = None,
        enable_cache: bool = True,
    ):
        """初始化工具执行器。

        Args:
            repo_path: 仓库根目录
            agent_name: Agent 名称（用于权限检查）
            llm_client: LLM 客户端（高级工具需要）
            enable_cache: 是否启用结果缓存
        """
        self.repo_path = Path(repo_path)
        self.agent_name = agent_name
        self.llm_client = llm_client
        self.enable_cache = enable_cache

        # 获取权限
        self.allowed_tools = AGENT_TOOL_PERMISSIONS.get(agent_name, [])

        # 缓存
        self._cache: dict[str, ToolResult] = {}

        # 工具处理器（延迟初始化）
        self._handlers: dict[str, Callable] = {}
        self._handlers_initialized = False

        logger.debug(
            "[ToolExecutor] 初始化: agent=%s, allowed_tools=%d",
            agent_name, len(self.allowed_tools)
        )

    def _init_handlers(self) -> None:
        """延迟初始化工具处理器。"""
        if self._handlers_initialized:
            return

        # 导入工具模块（延迟导入，避免循环依赖）
        try:
            from backend.tools.base_tools import BaseTools
            self._base_tools = BaseTools(self.repo_path)

            # 注册基础工具处理器
            self._handlers.update({
                "list_directory": self._base_tools.list_directory,
                "search_code": self._base_tools.search_code,
                "read_file": self._base_tools.read_file,
                "read_lines": self._base_tools.read_lines,
                "find_files": self._base_tools.find_files,
                "grep_pattern": self._base_tools.grep_pattern,
                "get_file_info": self._base_tools.get_file_info,
                "list_imports": self._base_tools.list_imports,
            })
        except ImportError:
            logger.warning("[ToolExecutor] BaseTools 导入失败，基础工具不可用")
            self._base_tools = None

        try:
            from backend.tools.semantic_tools import SemanticTools
            self._semantic_tools = SemanticTools(self.repo_path, self._base_tools)

            # 注册语义工具处理器
            self._handlers.update({
                "extract_annotations": self._semantic_tools.extract_annotations,
                "extract_classes": self._semantic_tools.extract_classes,
                "extract_methods": self._semantic_tools.extract_methods,
                "extract_fields": self._semantic_tools.extract_fields,
                "extract_call_graph": self._semantic_tools.extract_call_graph,
                "analyze_inheritance": self._semantic_tools.analyze_inheritance,
                "infer_field_mapping": self._semantic_tools.infer_field_mapping,
                "detect_patterns": self._semantic_tools.detect_patterns,
            })
        except ImportError:
            logger.warning("[ToolExecutor] SemanticTools 导入失败，语义工具不可用")
            self._semantic_tools = None

        # 初始化框架工具
        self._init_framework_tools()

        # 初始化高级工具
        self._init_advanced_tools()

        self._handlers_initialized = True

    def _init_framework_tools(self) -> None:
        """初始化框架工具。"""
        if not self._base_tools or not self._semantic_tools:
            return

        try:
            from backend.tools.spring_tools import SpringTools
            from backend.tools.jpa_tools import JPATools

            self._spring_tools = SpringTools(self.repo_path, self._base_tools, self._semantic_tools)
            self._jpa_tools = JPATools(self.repo_path, self._base_tools, self._semantic_tools)

            # 注册 Spring 工具处理器
            self._handlers.update({
                "spring_di_resolver": lambda **p: self._spring_tools.extract_di_dependencies(p.get("path"), p.get("class_name")),
                "spring_http_mapping": lambda **p: self._spring_tools.extract_controllers(p.get("path")),
                "spring_transaction_boundary": lambda **p: self._detect_transaction_boundary(p.get("path"), p.get("class_name")),
                "spring_kafka_listener": lambda **p: self._spring_tools.extract_event_listeners(p.get("path")),
            })

            # 注册 JPA 工具处理器
            self._handlers.update({
                "jpa_entity_analyzer": lambda **p: self._jpa_tools.extract_entities(p.get("path")),
                "jpa_relation_resolver": lambda **p: self._jpa_tools.infer_entity_relations(p.get("path")),
            })

        except ImportError as e:
            logger.warning("[ToolExecutor] 框架工具导入失败: %s", e)

    def _init_advanced_tools(self) -> None:
        """初始化高级工具。"""
        if not self._base_tools or not self._semantic_tools:
            return

        try:
            from backend.tools.advanced_tools import AdvancedTools

            self._advanced_tools = AdvancedTools(
                self.repo_path, self._base_tools, self._semantic_tools, self.llm_client
            )

            # 注册高级工具处理器
            self._handlers.update({
                "resolve_ambiguity": lambda **p: self._advanced_tools.resolve_ambiguity(
                    p.get("symbol"), p.get("context", {}), p.get("candidates", [])
                ),
                "trace_data_flow": lambda **p: self._advanced_tools.infer_data_flow(
                    p.get("source"), p.get("target"), p.get("scope", "repository")
                ),
                "cross_file_follow": lambda **p: self._cross_file_follow(
                    p.get("symbol_name"), p.get("from_file"), p.get("follow_type", "both")
                ),
                "explain_code": lambda **p: self._advanced_tools.understand_business_semantic(
                    p.get("path"), "method", {"file_path": p.get("path")}
                ),
                "detect_architecture_patterns": lambda **p: self._advanced_tools.detect_architecture_patterns(
                    p.get("path"), p.get("patterns")
                ),
            })

        except ImportError as e:
            logger.warning("[ToolExecutor] 高级工具导入失败: %s", e)

    def _detect_transaction_boundary(self, path: str, class_name: str) -> dict:
        """检测事务边界。"""
        result = self._semantic_tools.extract_methods(path, class_name)
        if not result.get("success"):
            return result

        transactional_methods = []
        for method in result.get("methods", []):
            for ann in method.get("annotations", []):
                if ann.get("name") == "Transactional":
                    transactional_methods.append({
                        "method_name": method["name"],
                        "line_number": method["line_start"],
                    })

        return {
            "success": True,
            "class_name": class_name,
            "transactional_methods": transactional_methods,
            "count": len(transactional_methods),
        }

    def _cross_file_follow(self, symbol_name: str, from_file: str, follow_type: str) -> dict:
        """跨文件追踪符号。"""
        # 搜索定义
        definitions = []
        usages = []

        # 在代码中搜索符号
        search_result = self._base_tools.search_code(
            pattern=f"\\b{symbol_name}\\b",
            context_lines=2,
            max_results=50,
        )

        if search_result.get("success"):
            for r in search_result.get("results", []):
                location = {
                    "file_path": r["file_path"],
                    "line_number": r["line_number"],
                    "content": r["line_content"],
                }

                # 判断是定义还是使用
                content = r["line_content"]
                if f"class {symbol_name}" in content or f"interface {symbol_name}" in content:
                    definitions.append(location)
                else:
                    usages.append(location)

        if follow_type == "definition":
            return {"success": True, "definitions": definitions, "count": len(definitions)}
        elif follow_type == "usage":
            return {"success": True, "usages": usages, "count": len(usages)}
        else:
            return {
                "success": True,
                "definitions": definitions,
                "usages": usages,
                "definition_count": len(definitions),
                "usage_count": len(usages),
            }

    def execute(
        self,
        tool_name: str,
        params: dict,
    ) -> ToolResult:
        """执行工具调用。

        Args:
            tool_name: 工具名称
            params: 工具参数

        Returns:
            ToolResult: 执行结果
        """
        # 检查权限
        if tool_name not in self.allowed_tools:
            return ToolResult(
                status=ToolResultStatus.NO_PERMISSION,
                error=f"Agent '{self.agent_name}' has no permission to use tool '{tool_name}'",
            )

        # 检查缓存
        if self.enable_cache:
            cache_key = self._build_cache_key(tool_name, params)
            if cache_key in self._cache:
                result = self._cache[cache_key]
                result.cache_hit = True
                return result

        # 初始化处理器
        self._init_handlers()

        # 查找处理器
        handler = self._handlers.get(tool_name)
        if handler is None:
            # 尝试框架和高级工具
            handler = self._get_advanced_handler(tool_name)

        if handler is None:
            return ToolResult(
                status=ToolResultStatus.ERROR,
                error=f"Unknown tool: {tool_name}",
            )

        # 执行工具
        try:
            result = handler(**params)

            # 统一返回格式
            if isinstance(result, ToolResult):
                pass
            elif isinstance(result, dict):
                status = ToolResultStatus.SUCCESS if result.get("success", True) else ToolResultStatus.ERROR
                result = ToolResult(
                    status=status,
                    data=result,
                    error=result.get("error"),
                )
            else:
                result = ToolResult(
                    status=ToolResultStatus.SUCCESS,
                    data=result,
                )

        except Exception as e:
            result = ToolResult(
                status=ToolResultStatus.ERROR,
                error=str(e),
            )

        # 缓存结果
        if self.enable_cache and result.status == ToolResultStatus.SUCCESS:
            self._cache[self._build_cache_key(tool_name, params)] = result

        return result

    def _get_advanced_handler(self, tool_name: str) -> Callable | None:
        """获取框架和高级工具处理器。"""
        # 框架工具
        if tool_name.startswith("spring_") or tool_name.startswith("jpa_") or tool_name == "mybatis_mapper":
            try:
                from backend.tools.spring_tools import SpringTools
                from backend.tools.jpa_tools import JPATools

                if not hasattr(self, "_spring_tools"):
                    self._spring_tools = SpringTools(self.repo_path, self._semantic_tools)
                if not hasattr(self, "_jpa_tools"):
                    self._jpa_tools = JPATools(self._spring_tools)

                handlers = {
                    "spring_di_resolver": self._spring_tools.spring_di_resolver,
                    "spring_http_mapping": self._spring_tools.spring_http_mapping,
                    "spring_transaction_boundary": self._spring_tools.spring_transaction_boundary,
                    "spring_kafka_listener": self._spring_tools.spring_kafka_listener,
                    "jpa_entity_analyzer": self._spring_tools.jpa_entity_analyzer,
                    "jpa_relation_resolver": self._jpa_tools.jpa_relation_resolver,
                    "mybatis_mapper": self._jpa_tools.mybatis_mapper,
                }
                return handlers.get(tool_name)
            except ImportError:
                logger.warning("[ToolExecutor] 框架工具导入失败")
                return None

        # 高级工具
        if tool_name in ["trace_data_flow", "cross_file_follow", "resolve_ambiguity", "explain_code"]:
            if self.llm_client is None:
                return lambda **kwargs: ToolResult(
                    status=ToolResultStatus.ERROR,
                    error="LLM client not available for this tool",
                )

            try:
                from backend.tools.advanced_tools import AdvancedTools

                if not hasattr(self, "_advanced_tools"):
                    self._advanced_tools = AdvancedTools(
                        self.repo_path, self.llm_client, self._base_tools, self._semantic_tools
                    )

                handlers = {
                    "trace_data_flow": self._advanced_tools.trace_data_flow,
                    "cross_file_follow": self._advanced_tools.cross_file_follow,
                    "resolve_ambiguity": self._advanced_tools.resolve_ambiguity,
                    "explain_code": self._advanced_tools.explain_code,
                }
                return handlers.get(tool_name)
            except ImportError:
                logger.warning("[ToolExecutor] 高级工具导入失败")
                return None

        return None

    def _build_cache_key(self, tool_name: str, params: dict) -> str:
        """构建缓存键。"""
        params_str = str(sorted(params.items()))
        params_hash = hashlib.md5(params_str.encode()).hexdigest()[:8]
        return f"{tool_name}:{params_hash}"

    def get_tool_definitions_for_llm(self) -> list[dict]:
        """获取用于 LLM function calling 的工具定义列表。"""
        definitions = []

        for tool_name in self.allowed_tools:
            if tool_name in ALL_TOOL_DEFINITIONS:
                tool = ALL_TOOL_DEFINITIONS[tool_name]

                # 构建 parameters schema
                properties = {}
                required = []

                for param_name, param_def in tool.parameters.items():
                    properties[param_name] = {
                        "type": param_def.get("type", "string"),
                        "description": param_def.get("description", ""),
                    }
                    if param_def.get("default") is not None:
                        properties[param_name]["default"] = param_def["default"]
                    if param_def.get("required", False):
                        required.append(param_name)

                definitions.append({
                    "type": "function",
                    "function": {
                        "name": tool.name,
                        "description": tool.description,
                        "parameters": {
                            "type": "object",
                            "properties": properties,
                            "required": required,
                        },
                    },
                })

        return definitions

    def clear_cache(self) -> None:
        """清空缓存。"""
        self._cache.clear()
