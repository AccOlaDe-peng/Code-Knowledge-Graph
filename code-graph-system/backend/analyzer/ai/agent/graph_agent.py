"""
AIGraphAgent - AI 驱动的代码图谱分析 Agent。

使用 LLM 进行自主代码探索，通过工具调用循环识别高层架构模式，
最终输出语义节点和边。
"""

import json
import logging
from pathlib import Path
from typing import Any, Optional

from backend.analyzer.ai.agent.context_builder import ContextBuilder
from backend.analyzer.ai.agent.output_parser import OutputParser
from backend.analyzer.ai.agent.tools import AgentTools
from backend.graph.graph_builder import BuiltGraph
from backend.pipeline.repo_summary_builder import RepoSummary

logger = logging.getLogger(__name__)

# Anthropic tool schemas
TOOL_SCHEMAS = [
    {
        "name": "read_file",
        "description": "Read source code from a file",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "File path (relative to repo root)",
                },
                "start_line": {
                    "type": "integer",
                    "description": "Starting line number (1-indexed)",
                },
                "end_line": {
                    "type": "integer",
                    "description": "Ending line number (inclusive)",
                },
            },
            "required": ["path"],
        },
    },
    {
        "name": "list_directory",
        "description": "List files and subdirectories in a directory",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Directory path (relative to repo root)",
                },
            },
            "required": ["path"],
        },
    },
    {
        "name": "search_code",
        "description": "Search for pattern in repository files using regex",
        "input_schema": {
            "type": "object",
            "properties": {
                "pattern": {
                    "type": "string",
                    "description": "Search pattern (regex)",
                },
                "file_glob": {
                    "type": "string",
                    "description": "File glob pattern (default: **/*)",
                },
            },
            "required": ["pattern"],
        },
    },
    {
        "name": "get_ast_nodes",
        "description": "Get AST nodes (classes, functions) from static analysis for a file",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "File path (relative to repo root)",
                },
            },
            "required": ["path"],
        },
    },
    {
        "name": "get_call_graph",
        "description": "Get call graph edges starting from a node",
        "input_schema": {
            "type": "object",
            "properties": {
                "node_id": {
                    "type": "string",
                    "description": "Starting node ID",
                },
                "depth": {
                    "type": "integer",
                    "description": "Traversal depth (default: 1)",
                },
            },
            "required": ["node_id"],
        },
    },
    {
        "name": "get_imports",
        "description": "Get import dependencies for a file from static analysis",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "File path (relative to repo root)",
                },
            },
            "required": ["path"],
        },
    },
    {
        "name": "emit_graph",
        "description": "Submit final graph and terminate analysis",
        "input_schema": {
            "type": "object",
            "properties": {
                "graph_json": {
                    "type": "string",
                    "description": "JSON string containing nodes, edges, and exploration_summary",
                },
            },
            "required": ["graph_json"],
        },
    },
]


class AIGraphAgent:
    """AI 驱动的代码图谱分析 Agent。

    使用 LLM 进行工具调用循环，自主探索代码仓库，
    识别高层架构模式（Layer、Service、Flow、DataObject）。
    """

    def __init__(
        self,
        llm_client: Any,
        repo_path: str,
        static_graph: BuiltGraph,
        max_tool_calls: int = 20,
    ):
        """初始化 Agent。

        Args:
            llm_client: Anthropic LLM 客户端
            repo_path: 仓库根目录绝对路径
            static_graph: 静态分析图谱快照
            max_tool_calls: 最大工具调用次数
        """
        self.llm_client = llm_client
        self.repo_path = repo_path
        self.static_graph = static_graph
        self.max_tool_calls = max_tool_calls

        self.tools = AgentTools(repo_path, static_graph)
        self.context_builder = ContextBuilder()
        self.output_parser = OutputParser()

        # 工具映射
        self._tool_map = {
            "read_file": self.tools.read_file,
            "list_directory": self.tools.list_directory,
            "search_code": self.tools.search_code,
            "get_ast_nodes": self.tools.get_ast_nodes,
            "get_call_graph": self.tools.get_call_graph,
            "get_imports": self.tools.get_imports,
            "emit_graph": self._handle_emit_graph,
        }

        # 加载 system prompt
        self._system_prompt = self._load_system_prompt()

    def analyze(self, summary: RepoSummary) -> dict[str, Any]:
        """主分析方法。

        Args:
            summary: 仓库摘要（由 RepoSummaryBuilder 生成）

        Returns:
            包含 nodes 和 edges 的字典
        """
        logger.info(
            f"开始 AI Graph Agent 分析: {summary.repo_name} "
            f"(预算: {self.max_tool_calls} 次工具调用)"
        )

        # 构建初始上下文
        initial_context = self.context_builder.build(summary, self.max_tool_calls)

        # 替换 system prompt 中的 {context} 占位符
        system_prompt = self._system_prompt.replace("{context}", initial_context)

        # 初始化消息历史
        messages = []

        # 工具调用循环
        tool_call_count = 0
        final_result = None

        while tool_call_count < self.max_tool_calls:
            try:
                # 调用 LLM
                response = self.llm_client.messages.create(
                    model="claude-3-5-sonnet-20241022",
                    max_tokens=4096,
                    system=system_prompt,
                    messages=messages,
                    tools=TOOL_SCHEMAS,
                )

                # 检查停止原因
                if response.stop_reason == "end_turn":
                    logger.warning("LLM 提前结束对话，未调用 emit_graph")
                    break

                # 解析工具调用
                tool_uses = [
                    block for block in response.content 
                    if hasattr(block, "type") and block.type == "tool_use"
                ]

                if not tool_uses:
                    logger.warning("LLM 响应中没有工具调用")
                    break

                # 添加 assistant 消息到历史
                messages.append({"role": "assistant", "content": response.content})

                # 执行工具调用
                tool_results = []
                emit_graph_received = False

                for tool_use in tool_uses:
                    tool_call_count += 1
                    logger.debug(
                        f"工具调用 {tool_call_count}/{self.max_tool_calls}: "
                        f"{tool_use.name}({tool_use.input})"
                    )

                    # 执行工具
                    result = self._execute_tool(tool_use.name, tool_use.input)

                    # 检查是否是 emit_graph（终止信号）
                    if tool_use.name == "emit_graph" and result.get("final_result"):
                        final_result = result["final_result"]
                        logger.info("收到 emit_graph，终止分析循环")
                        emit_graph_received = True
                        break

                    # 添加工具结果
                    tool_results.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": tool_use.id,
                            "content": json.dumps(result, ensure_ascii=False),
                        }
                    )

                # 如果收到 emit_graph，终止循环
                if emit_graph_received:
                    break

                # 添加工具结果到消息历史（只有在没有 emit_graph 时才添加）
                if tool_results:
                    messages.append({"role": "user", "content": tool_results})

                # 检查预算
                if tool_call_count >= self.max_tool_calls:
                    logger.warning("达到工具调用预算上限，强制终止")
                    break

            except Exception as e:
                logger.error(f"工具调用循环出错: {e}", exc_info=True)
                break

        # 如果没有收到 emit_graph，返回空结果
        if final_result is None:
            logger.warning("分析结束但未收到 emit_graph，返回空图谱")
            final_result = {
                "nodes": [],
                "edges": [],
                "meta": {
                    "exploration_summary": "Analysis terminated without emit_graph",
                    "tool_calls_used": tool_call_count,
                },
            }

        logger.info(
            f"AI Graph Agent 分析完成: "
            f"{len(final_result.get('nodes', []))} 节点, "
            f"{len(final_result.get('edges', []))} 边, "
            f"{tool_call_count} 次工具调用"
        )

        return final_result

    def _execute_tool(self, tool_name: str, tool_input: dict[str, Any]) -> dict[str, Any]:
        """执行单个工具调用。

        Args:
            tool_name: 工具名称
            tool_input: 工具输入参数

        Returns:
            工具执行结果（JSON 可序列化）
        """
        try:
            tool_func = self._tool_map.get(tool_name)
            if tool_func is None:
                return {
                    "success": False,
                    "error": f"Unknown tool: {tool_name}",
                }

            # 执行工具
            result = tool_func(**tool_input)
            return result

        except Exception as e:
            logger.error(f"工具执行失败 {tool_name}: {e}", exc_info=True)
            return {
                "success": False,
                "error": str(e),
            }

    def _handle_emit_graph(self, graph_json: str) -> dict[str, Any]:
        """处理 emit_graph 工具调用。

        Args:
            graph_json: JSON 字符串，包含 nodes、edges、exploration_summary

        Returns:
            包含 final_result 的字典（作为终止信号）
        """
        try:
            # 使用 OutputParser 解析
            parsed = self.output_parser.parse(graph_json)

            # 添加 meta 信息
            if "meta" not in parsed:
                parsed["meta"] = {}

            # 返回带有终止信号的结果
            return {
                "success": True,
                "final_result": parsed,
            }

        except Exception as e:
            logger.error(f"emit_graph 解析失败: {e}", exc_info=True)
            return {
                "success": False,
                "error": str(e),
                "final_result": {
                    "nodes": [],
                    "edges": [],
                    "meta": {"error": str(e)},
                },
            }

    def _load_system_prompt(self) -> str:
        """加载 system prompt 模板。

        Returns:
            System prompt 字符串
        """
        try:
            prompt_path = (
                Path(__file__).parent.parent / "prompts" / "graph_agent.txt"
            )
            with open(prompt_path, "r", encoding="utf-8") as f:
                return f.read()
        except Exception as e:
            logger.error(f"加载 system prompt 失败: {e}", exc_info=True)
            return "You are an AI code architecture analyst."

    def _fallback(self) -> dict[str, Any]:
        """预算耗尽时的 fallback 处理（暂时为空实现）。

        Returns:
            空图谱结果
        """
        return {
            "nodes": [],
            "edges": [],
            "meta": {"fallback": True},
        }
