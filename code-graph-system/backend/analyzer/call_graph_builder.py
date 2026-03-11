"""
函数调用图构建器模块。

从解析结果中提取函数/方法节点，并根据调用点信息
构建函数调用图（CALLS 类型的边）。

同时生成 CONTAINS 边表示：
- 模块 CONTAINS 函数
- 组件（类）CONTAINS 方法
"""

from __future__ import annotations

import logging
from typing import Optional

from backend.graph.schema import (
    ComponentNode,
    EdgeBase,
    EdgeType,
    FunctionNode,
    FunctionParameter,
    ModuleNode,
)
from backend.parser.code_parser import ParsedFile, ParsedFunction

logger = logging.getLogger(__name__)


class CallGraphBuilder:
    """
    函数调用图构建器。

    遍历所有解析文件，为每个函数/方法创建 FunctionNode，
    并根据代码中的调用点（ParsedCall）建立 CALLS 边。

    示例::

        builder = CallGraphBuilder()
        nodes, edges = builder.build(parsed_files, module_nodes, component_nodes)
    """

    def build(
        self,
        parsed_files: dict[str, ParsedFile],
        module_nodes: dict[str, ModuleNode],
        component_nodes: dict[str, ComponentNode],
    ) -> tuple[list[FunctionNode], list[EdgeBase]]:
        """
        构建函数调用图。

        Args:
            parsed_files: 文件路径 -> 解析结果的映射
            module_nodes: 文件路径 -> 模块节点的映射
            component_nodes: 类名 -> 组件节点的映射

        Returns:
            (函数节点列表, 边列表) 元组
        """
        func_nodes: list[FunctionNode] = []
        edges: list[EdgeBase] = []

        # 第一遍：创建所有函数节点，建立名称索引
        name_index: dict[str, FunctionNode] = {}
        qualified_index: dict[str, FunctionNode] = {}

        for file_path, parsed in parsed_files.items():
            module = module_nodes.get(file_path)

            # 模块级函数
            for pfunc in parsed.functions:
                node = self._make_func_node(pfunc, parsed.file_path, parsed.language)
                func_nodes.append(node)
                name_index[pfunc.name] = node
                # 模块 CONTAINS 函数
                if module:
                    edges.append(EdgeBase(
                        type=EdgeType.CONTAINS,
                        source_id=module.id,
                        target_id=node.id,
                        metadata={"line": pfunc.line_start},
                    ))

            # 类方法
            for cls in parsed.classes:
                comp = component_nodes.get(cls.name)
                for pfunc in cls.methods:
                    node = self._make_func_node(
                        pfunc, parsed.file_path, parsed.language,
                        is_method=True, parent_class=cls.name
                    )
                    func_nodes.append(node)
                    qualified_name = f"{cls.name}.{pfunc.name}"
                    name_index[pfunc.name] = node
                    qualified_index[qualified_name] = node
                    # 组件 CONTAINS 方法
                    if comp:
                        edges.append(EdgeBase(
                            type=EdgeType.CONTAINS,
                            source_id=comp.id,
                            target_id=node.id,
                            metadata={"line": pfunc.line_start},
                        ))

        # 第二遍：构建调用边
        call_edges = self._build_call_edges(
            parsed_files, name_index, qualified_index
        )
        edges.extend(call_edges)

        logger.info(
            f"调用图构建完成: {len(func_nodes)} 个函数节点, "
            f"{len(call_edges)} 条调用边"
        )
        return func_nodes, edges

    def _make_func_node(
        self,
        pfunc: ParsedFunction,
        file_path: str,
        language: str,
        is_method: bool = False,
        parent_class: Optional[str] = None,
    ) -> FunctionNode:
        """将 ParsedFunction 转换为 FunctionNode。"""
        params = [
            FunctionParameter(
                name=p.name,
                type=p.type_annotation,
                default=p.default_value,
            )
            for p in pfunc.parameters
        ]

        # 计算简化的圈复杂度（基于关键字数量估算）
        complexity = self._estimate_complexity(pfunc)

        return FunctionNode(
            name=pfunc.name,
            file_path=file_path,
            line_start=pfunc.line_start,
            line_end=pfunc.line_end,
            parameters=params,
            return_type=pfunc.return_type,
            is_async=pfunc.is_async,
            is_generator=pfunc.is_generator,
            decorators=pfunc.decorators,
            docstring=pfunc.docstring,
            complexity=complexity,
            metadata={
                "language": language,
                "is_method": is_method,
                "parent_class": parent_class or "",
                "call_count": len(pfunc.calls),
            },
        )

    def _estimate_complexity(self, pfunc: ParsedFunction) -> int:
        """
        估算圈复杂度。

        基于调用数量和参数数量的简化估算：
        真实圈复杂度需要基于 if/for/while/try 等控制流分支数量。
        """
        base = 1
        branch_estimate = max(0, len(pfunc.calls) // 3)
        param_bonus = max(0, len(pfunc.parameters) - 3)
        return min(base + branch_estimate + param_bonus, 20)

    def _build_call_edges(
        self,
        parsed_files: dict[str, ParsedFile],
        name_index: dict[str, FunctionNode],
        qualified_index: dict[str, FunctionNode],
    ) -> list[EdgeBase]:
        """遍历所有调用点，建立 CALLS 边。"""
        edges: list[EdgeBase] = []
        seen: set[tuple[str, str]] = set()

        all_funcs: list[tuple[ParsedFunction, str]] = []
        for file_path, parsed in parsed_files.items():
            for f in parsed.functions:
                all_funcs.append((f, file_path))
            for cls in parsed.classes:
                for m in cls.methods:
                    all_funcs.append((m, file_path))

        for pfunc, _ in all_funcs:
            caller_name = pfunc.name
            if pfunc.parent_class:
                caller_name = f"{pfunc.parent_class}.{pfunc.name}"
            caller_node = qualified_index.get(caller_name) or name_index.get(pfunc.name)
            if not caller_node:
                continue

            for call in pfunc.calls:
                # 尝试定位被调用函数节点
                callee_node = (
                    qualified_index.get(call.callee)
                    or name_index.get(call.callee)
                    or name_index.get(call.callee.split(".")[-1])
                )
                if not callee_node:
                    continue
                if callee_node.id == caller_node.id:
                    continue  # 跳过自递归（暂不建模）

                key = (caller_node.id, callee_node.id)
                if key in seen:
                    continue
                seen.add(key)

                edges.append(EdgeBase(
                    type=EdgeType.CALLS,
                    source_id=caller_node.id,
                    target_id=callee_node.id,
                    metadata={
                        "call_line": call.line,
                        "is_method_call": call.is_method_call,
                    },
                ))

        return edges
