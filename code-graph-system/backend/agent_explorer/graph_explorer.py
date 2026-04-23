"""
Graph-Explorer Agent — 自主探索代码库并构建知识图谱。

核心能力:
    - 自主探索：从高 PageRank/度节点开始，逐步分析代码
    - 引导探索：用户指定目标，Agent 聚焦分析
    - 实时写入：每发现立即写入图谱，Agent "活在图谱里"
    - 用户干预：随时接收用户引导，调整探索方向

使用方式:
    from backend.agent_explorer.graph_explorer import GraphExplorer

    explorer = GraphExplorer(graph_id="my-project")
    await explorer.start(mode="autonomous")  # 自主模式
    await explorer.start(mode="guided", target="auth 模块")  # 引导模式
    await explorer.guide("跳过测试文件")  # 中途干预
    await explorer.stop()  # 停止
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Callable, Optional
from uuid import uuid4

import anthropic

from backend.graph.graph_repository import GraphRepository
from backend.graph.graph_schema import GraphNode, GraphEdge, NodeType, EdgeType

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DEFAULT_MODEL = os.getenv("AGENT_MODEL", "claude-sonnet-4-6")
DEFAULT_MAX_TOKENS = int(os.getenv("AGENT_MAX_TOKENS", "4096"))
DEFAULT_MAX_ITERATIONS = int(os.getenv("AGENT_MAX_ITERATIONS", "100"))


class ExplorerMode(str, Enum):
    AUTONOMOUS = "autonomous"  # 自主探索
    GUIDED = "guided"          # 用户引导


class AgentState(str, Enum):
    IDLE = "idle"
    RUNNING = "running"
    WAITING_GUIDE = "waiting_guide"
    STOPPED = "stopped"
    COMPLETED = "completed"
    ERROR = "error"


@dataclass
class AgentEvent:
    """Agent 事件（用于 SSE 流式推送）"""

    type: str
    data: dict[str, Any]
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_json(self) -> str:
        return json.dumps({
            "type": self.type,
            "data": self.data,
            "timestamp": self.timestamp,
        }, ensure_ascii=False)


# ---------------------------------------------------------------------------
# System Prompt
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """你是一个代码探索 Agent，你的记忆是知识图谱。

## 探索策略

1. **启动时先查询图谱状态**
   - 调用 graph_status 获取图谱概览
   - 了解已分析的节点数量和类型分布

2. **自主模式：从高价值节点切入**
   - 选择未探索（unexplored）节点中 pagerank/度最高的作为起点
   - 优先分析核心模块、入口函数、高频调用点

3. **引导模式：聚焦用户指定的目标**
   - 用户可能说"分析 auth 模块"、"看登录流程"
   - 用 grep_code 定位相关代码，再深入分析

4. **深入代码**
   - 使用 read_file 阅读源码
   - 理解函数签名、参数、返回值
   - 识别调用关系、依赖关系

5. **发现立即写入**
   - 每发现一个有意义的概念（函数、类、模块、依赖）立即调用 add_node
   - 发现关系立即调用 add_edge（calls, imports, implements, contains）
   - 不要批量写入，边探索边构建

6. **完成一个节点后标记**
   - 调用 mark_explored 标记已探索的节点
   - 附带简短摘要描述分析结论

7. **循环迭代**
   - 回到步骤 2 或 3，继续探索
   - 直到所有目标节点 explored 或用户干预

## 停止条件

- 连续 3 次探索未发现新节点（可能陷入死胡同）
- 用户说"暂停"、"够了"、"停止"
- Token 使用超过阈值
- 达到最大迭代次数

## 歧义处理

- 遇到名称冲突（多个同名函数），优先选择调用次数多的
- 无法确定关系类型时，选择最具体的（优先 implements > contains > depends_on）
- 不确定节点类型时，保守选择 Function（最小粒度）

## 工具使用原则

- 优先使用图谱工具（graph_status, query_graph）了解已知信息
- 代码探索工具（grep_code, read_file）用于发现新内容
- 每次工具调用后立即观察结果，再决定下一步
- 不要重复调用相同的工具

## 输出格式

每轮探索后，用简洁的语言说明：
- 当前分析的是什么
- 发现了什么（新节点/新关系）
- 下一步打算做什么
"""


# ---------------------------------------------------------------------------
# Graph Explorer Agent
# ---------------------------------------------------------------------------

class GraphExplorer:
    """
    Graph-Explorer Agent 实现。

    使用 Anthropic API 实现工具调用循环，支持自主探索和用户引导两种模式。
    """

    def __init__(
        self,
        graph_id: str,
        storage_dir: str = "./data/graphs",
        model: str = DEFAULT_MODEL,
        max_iterations: int = DEFAULT_MAX_ITERATIONS,
        on_event: Optional[Callable[[AgentEvent], None]] = None,
    ):
        self.graph_id = graph_id
        self.model = model
        self.max_iterations = max_iterations

        self.repo = GraphRepository(storage_dir=storage_dir)
        self.client = anthropic.Anthropic()

        self.state = AgentState.IDLE
        self.agent_id = str(uuid4())[:8]
        self.iteration = 0
        self.discoveries: list[dict[str, Any]] = []
        self.current_focus: Optional[str] = None

        self._on_event = on_event
        self._stop_requested = False
        self._guide_message: Optional[str] = None
        self._conversation: list[dict] = []

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def start(
        self,
        mode: ExplorerMode = ExplorerMode.AUTONOMOUS,
        target: Optional[str] = None,
    ) -> dict[str, Any]:
        """启动 Agent 探索。

        Args:
            mode: 探索模式（autonomous 或 guided）
            target: 引导模式的目标描述（如 "auth 模块"）

        Returns:
            探索结果摘要
        """
        if self.state == AgentState.RUNNING:
            return {"error": "Agent already running"}

        self.state = AgentState.RUNNING
        self._stop_requested = False
        self.iteration = 0
        self.discoveries = []

        initial_message = self._build_initial_message(mode, target)
        self._conversation = [{"role": "user", "content": initial_message}]

        self._emit("started", {"mode": mode.value, "target": target})

        try:
            result = await self._run_loop()
            self.state = AgentState.COMPLETED
            return result
        except Exception as e:
            self.state = AgentState.ERROR
            self._emit("error", {"message": str(e)})
            logger.exception("Agent loop failed")
            raise

    async def guide(self, message: str) -> None:
        """用户引导干预。

        Args:
            message: 引导消息（如 "跳过测试文件"、"分析登录流程"）
        """
        self._guide_message = message
        self._emit("guide_received", {"message": message})

    async def stop(self) -> dict[str, Any]:
        """停止 Agent。"""
        self._stop_requested = True
        self._emit("stopping", {})
        return {
            "agent_id": self.agent_id,
            "state": self.state.value,
            "iterations": self.iteration,
            "discoveries": len(self.discoveries),
        }

    def get_status(self) -> dict[str, Any]:
        """获取 Agent 当前状态。"""
        return {
            "agent_id": self.agent_id,
            "graph_id": self.graph_id,
            "state": self.state.value,
            "iteration": self.iteration,
            "current_focus": self.current_focus,
            "discoveries_count": len(self.discoveries),
            "recent_discoveries": self.discoveries[-5:] if self.discoveries else [],
        }

    # ------------------------------------------------------------------
    # Agent Loop
    # ------------------------------------------------------------------

    async def _run_loop(self) -> dict[str, Any]:
        """主循环：调用 API → 执行工具 → 观察 → 决策"""
        consecutive_no_discovery = 0

        while (
            self.iteration < self.max_iterations
            and not self._stop_requested
            and consecutive_no_discovery < 3
        ):
            self.iteration += 1

            # 检查用户引导
            if self._guide_message:
                guide_content = f"\n\n用户引导: {self._guide_message}"
                self._conversation.append({"role": "user", "content": guide_content})
                self._guide_message = None

            # 调用 Anthropic API
            try:
                response = await asyncio.to_thread(
                    self._call_anthropic,
                )
            except Exception as e:
                logger.error("Anthropic API call failed: %s", e)
                break

            # 处理响应
            content_blocks = response.content
            tool_results = []

            for block in content_blocks:
                if block.type == "text":
                    # Agent 的文字输出，记录
                    self._emit("thinking", {"text": block.text[:500]})

                elif block.type == "tool_use":
                    # 执行工具
                    tool_name = block.name
                    tool_input = block.input

                    self._emit("tool_call", {
                        "tool": tool_name,
                        "input": tool_input,
                    })

                    result = await self._execute_tool(tool_name, tool_input)

                    # 检查是否有新发现
                    if result.get("created") or result.get("marked"):
                        consecutive_no_discovery = 0
                        discovery = {
                            "iteration": self.iteration,
                            "tool": tool_name,
                            "result": result,
                        }
                        self.discoveries.append(discovery)
                        self._emit("discovery", discovery)
                    else:
                        consecutive_no_discovery += 1

                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": json.dumps(result, ensure_ascii=False),
                    })

            # 更新对话
            self._conversation.append({"role": "assistant", "content": content_blocks})
            if tool_results:
                self._conversation.append({
                    "role": "user",
                    "content": tool_results,
                })

            # 检查是否应该停止
            stop_reason = response.stop_reason
            if stop_reason in ("end_turn", "max_tokens"):
                # Agent 认为探索完成
                break

        return {
            "agent_id": self.agent_id,
            "graph_id": self.graph_id,
            "iterations": self.iteration,
            "discoveries": len(self.discoveries),
            "stop_reason": "user_stop" if self._stop_requested else "completed",
        }

    def _call_anthropic(self) -> anthropic.types.Message:
        """同步调用 Anthropic API。"""
        tools = self._get_tool_definitions()

        return self.client.messages.create(
            model=self.model,
            max_tokens=DEFAULT_MAX_TOKENS,
            system=SYSTEM_PROMPT,
            messages=self._conversation,
            tools=tools,
        )

    # ------------------------------------------------------------------
    # Tools
    # ------------------------------------------------------------------

    def _get_tool_definitions(self) -> list[dict]:
        """获取工具定义（供 Anthropic API 使用）。"""
        return [
            {
                "name": "graph_status",
                "description": "获取图谱当前状态：节点数量、类型分布、未探索节点列表。",
                "input_schema": {"type": "object", "properties": {}},
            },
            {
                "name": "query_graph",
                "description": "语义搜索图谱节点。返回匹配 query 的节点及其元数据。",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "自然语言搜索查询"},
                        "node_type": {"type": "string", "description": "过滤节点类型"},
                        "limit": {"type": "integer", "default": 10},
                    },
                    "required": ["query"],
                },
            },
            {
                "name": "add_node",
                "description": "向图谱添加节点。发现新的代码实体时立即调用。",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "type": {"type": "string", "description": "节点类型（Function, Class, Module 等）"},
                        "name": {"type": "string", "description": "节点名称"},
                        "properties": {"type": "object", "description": "额外属性（file_path, line_number 等）"},
                    },
                    "required": ["type", "name"],
                },
            },
            {
                "name": "add_edge",
                "description": "向图谱添加边（关系）。发现调用/依赖关系时立即调用。",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "source_id": {"type": "string", "description": "源节点 ID"},
                        "target_id": {"type": "string", "description": "目标节点 ID"},
                        "type": {"type": "string", "description": "边类型（calls, imports, implements 等）"},
                    },
                    "required": ["source_id", "target_id", "type"],
                },
            },
            {
                "name": "get_context",
                "description": "获取节点周围的上下文子图（BFS 扩展）。",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "node_id": {"type": "string", "description": "节点 ID"},
                        "depth": {"type": "integer", "default": 1, "description": "扩展深度"},
                    },
                    "required": ["node_id"],
                },
            },
            {
                "name": "mark_explored",
                "description": "标记节点为已探索。完成节点分析后调用。",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "node_ids": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "要标记的节点 ID 列表",
                        },
                        "summary": {"type": "string", "description": "分析摘要"},
                    },
                    "required": ["node_ids"],
                },
            },
            {
                "name": "grep_code",
                "description": "在代码库中搜索文本模式。定位代码文件时使用。",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "pattern": {"type": "string", "description": "搜索模式"},
                        "path": {"type": "string", "description": "限制搜索路径"},
                    },
                    "required": ["pattern"],
                },
            },
            {
                "name": "read_file",
                "description": "读取源代码文件内容。深入分析代码时使用。",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "文件路径"},
                        "start_line": {"type": "integer", "description": "起始行号"},
                        "end_line": {"type": "integer", "description": "结束行号"},
                    },
                    "required": ["path"],
                },
            },
        ]

    async def _execute_tool(self, name: str, input: dict) -> dict[str, Any]:
        """执行工具调用。"""
        try:
            if name == "graph_status":
                return self._tool_graph_status()
            elif name == "query_graph":
                return await self._tool_query_graph(**input)
            elif name == "add_node":
                return await self._tool_add_node(**input)
            elif name == "add_edge":
                return await self._tool_add_edge(**input)
            elif name == "get_context":
                return await self._tool_get_context(**input)
            elif name == "mark_explored":
                return await self._tool_mark_explored(**input)
            elif name == "grep_code":
                return await self._tool_grep_code(**input)
            elif name == "read_file":
                return await self._tool_read_file(**input)
            else:
                return {"error": f"Unknown tool: {name}"}
        except Exception as e:
            logger.exception("Tool execution failed: %s", name)
            return {"error": str(e)}

    def _tool_graph_status(self) -> dict[str, Any]:
        """获取图谱状态。"""
        built = self.repo.load(self.graph_id)
        if built is None:
            return {"error": f"Graph not found: {self.graph_id}"}

        nodes = built.nodes
        explored_count = sum(1 for n in nodes if n.properties.get("explored"))
        unexplored = [
            {"id": n.id, "type": n.type, "name": n.name}
            for n in nodes
            if not n.properties.get("explored")
        ]

        # 按 pagerank 排序（如果可用）
        if built.metrics:
            unexplored.sort(
                key=lambda n: built.metrics.get(n["id"], {}).get("pagerank", 0),
                reverse=True,
            )
            unexplored = unexplored[:20]  # 只返回前 20

        return {
            "graph_id": self.graph_id,
            "node_count": len(nodes),
            "edge_count": len(built.edges),
            "explored_count": explored_count,
            "unexplored_count": len(unexplored),
            "top_unexplored": unexplored,
            "node_types": built.meta.get("node_type_counts", {}),
        }

    async def _tool_query_graph(self, query: str, node_type: Optional[str] = None, limit: int = 10) -> dict[str, Any]:
        """语义搜索图谱。"""
        from backend.mcp_server.server import GraphTools
        tools = GraphTools(storage_dir=str(self.repo.storage_dir))
        return await tools.query_graph(
            query=query,
            graph_id=self.graph_id,
            node_type=node_type,
            limit=limit,
        )

    async def _tool_add_node(self, type: str, name: str, properties: Optional[dict] = None) -> dict[str, Any]:
        """添加节点。"""
        from backend.mcp_server.server import GraphTools
        tools = GraphTools(storage_dir=str(self.repo.storage_dir))
        result = await tools.add_node(
            type=type,
            name=name,
            graph_id=self.graph_id,
            properties=properties,
        )
        self.current_focus = result.get("node_id")
        return result

    async def _tool_add_edge(self, source_id: str, target_id: str, type: str) -> dict[str, Any]:
        """添加边。"""
        from backend.mcp_server.server import GraphTools
        tools = GraphTools(storage_dir=str(self.repo.storage_dir))
        return await tools.add_edge(
            source_id=source_id,
            target_id=target_id,
            type=type,
            graph_id=self.graph_id,
        )

    async def _tool_get_context(self, node_id: str, depth: int = 1) -> dict[str, Any]:
        """获取节点上下文。"""
        return self.repo.query_neighbors(
            graph_id=self.graph_id,
            node_id=node_id,
            depth=depth,
        )

    async def _tool_mark_explored(self, node_ids: list[str], summary: str = "") -> dict[str, Any]:
        """标记已探索。"""
        return self.repo.mark_explored(
            graph_id=self.graph_id,
            node_ids=node_ids,
            summary=summary,
        )

    async def _tool_grep_code(self, pattern: str, path: Optional[str] = None) -> dict[str, Any]:
        """搜索代码（_placeholder，需要实际实现）。"""
        # TODO: 实现实际的代码搜索
        return {
            "message": "grep_code not yet implemented - integration pending",
            "pattern": pattern,
            "path": path,
        }

    async def _tool_read_file(self, path: str, start_line: Optional[int] = None, end_line: Optional[int] = None) -> dict[str, Any]:
        """读取文件（_placeholder，需要实际实现）。"""
        # TODO: 实现实际的文件读取
        return {
            "message": "read_file not yet implemented - integration pending",
            "path": path,
            "start_line": start_line,
            "end_line": end_line,
        }

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _build_initial_message(self, mode: ExplorerMode, target: Optional[str]) -> str:
        """构建初始消息。"""
        if mode == ExplorerMode.GUIDED and target:
            return f"开始引导探索。目标: {target}\n\n请先查询图谱状态，了解已有的分析进度，然后聚焦于目标相关的代码。"
        else:
            return "开始自主探索。\n\n请先查询图谱状态，从未探索的高价值节点开始分析。优先分析核心模块和入口函数。"

    def _emit(self, event_type: str, data: dict[str, Any]) -> None:
        """发送事件。"""
        if self._on_event:
            event = AgentEvent(type=event_type, data=data)
            self._on_event(event)
