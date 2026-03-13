"""
ContextBuilder - 构建 AI Agent 初始上下文提示。

从静态分析摘要（RepoSummary）生成结构化的初始 prompt，
包含仓库概览、工具说明、规则约束和预算提示。
"""

from __future__ import annotations

from backend.pipeline.repo_summary_builder import RepoSummary

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SYSTEM_ROLE = """You are an AI code architecture analyst. Your task is to analyze a codebase and answer the user's question using the available tools.

CRITICAL RULES:
1. You have a LIMITED BUDGET of tool calls. Use them wisely.
2. ALWAYS check remaining budget before making a tool call.
3. When budget is exhausted, provide your best answer based on gathered information.
4. Prioritize high-value tools (e.g., get_key_functions before get_all_functions).
5. Use search tools to narrow scope before fetching details.
6. NEVER make redundant tool calls for the same information.
7. If a tool returns empty results, try alternative approaches instead of retrying.

AVAILABLE TOOLS:
- get_node_by_id(node_id): Get detailed info for a specific node
- get_neighbors(node_id, edge_types, depth): Explore graph relationships
- search_nodes(query, node_types, limit): Semantic search across nodes
- get_call_chain(from_id, to_id, max_depth): Find call paths between functions
- get_key_functions(limit): Get most important functions (by PageRank)
- get_data_lineage(node_id, direction, depth): Trace data flow
- get_event_flow(event_id): Get event publishers/subscribers

STRATEGY:
1. Start with high-level overview tools (get_key_functions, search_nodes)
2. Use search to identify relevant nodes before fetching details
3. Explore relationships only when necessary (get_neighbors, get_call_chain)
4. Synthesize findings and provide clear answers
5. Stop when you have sufficient information or budget is exhausted
"""

BUDGET_WARNING_TEMPLATE = """
⚠️  BUDGET: {remaining} tool calls remaining out of {total}
"""

BUDGET_EXHAUSTED_MESSAGE = """
❌ BUDGET EXHAUSTED: No tool calls remaining.
Provide your best answer based on the information already gathered.
"""


# ---------------------------------------------------------------------------
# ContextBuilder
# ---------------------------------------------------------------------------


class ContextBuilder:
    """构建 AI Agent 初始上下文提示。

    将 RepoSummary 转换为结构化的 prompt，供 Agent 使用。
    """

    def build(self, summary: RepoSummary, max_tool_calls: int) -> str:
        """构建初始上下文 prompt。

        Args:
            summary: 静态分析摘要
            max_tool_calls: 工具调用预算上限

        Returns:
            格式化的初始 prompt 字符串
        """
        sections: list[str] = []

        # System role and rules
        sections.append(SYSTEM_ROLE.strip())
        sections.append("")

        # Budget status
        if max_tool_calls > 0:
            sections.append(
                BUDGET_WARNING_TEMPLATE.format(
                    remaining=max_tool_calls, total=max_tool_calls
                ).strip()
            )
        else:
            sections.append(BUDGET_EXHAUSTED_MESSAGE.strip())
        sections.append("")

        # Repository overview
        sections.append("# REPOSITORY OVERVIEW")
        sections.append("")
        sections.append(f"Repository: {summary.repo_name}")
        sections.append(f"Path: {summary.repo_path}")
        sections.append(f"Languages: {', '.join(summary.languages)}")
        if summary.git_commit:
            sections.append(f"Git commit: {summary.git_commit[:12]}")
        sections.append(
            f"Scale: {summary.total_files} files, "
            f"{summary.total_nodes} nodes, "
            f"{summary.total_edges} edges"
        )
        sections.append("")

        # Static analysis summary (from RepoSummary.to_prompt_text())
        sections.append("# STATIC ANALYSIS SUMMARY")
        sections.append("")
        sections.append(summary.to_prompt_text())
        sections.append("")

        # Final instructions
        sections.append("# YOUR TASK")
        sections.append("")
        sections.append(
            "The user will ask a question about this codebase. "
            "Use the tools strategically to gather information and provide "
            "a comprehensive answer. Remember your budget constraint."
        )
        sections.append("")

        return "\n".join(sections)
