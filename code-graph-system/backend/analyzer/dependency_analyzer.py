"""
依赖分析器模块。

识别两类依赖关系：

1. 模块依赖 (Module depends_on Module)
   来源：各语言 import 语句 → 解析到内部模块路径 → 建立 depends_on 边

2. 服务依赖 (Service depends_on Service)
   来源：构造函数参数的类型注解（依赖注入模式）
       class OrderService:
           def __init__(self, user_svc: UserService)  →  Order depends_on User
   辅助：import 语句中服务文件互相导入

附加：
   循环依赖检测（DFS）记录在 DependencyGraph.circular_deps
"""

from __future__ import annotations

import logging
import re
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from backend.analyzer.component_detector import ComponentGraph
from backend.analyzer.module_detector import ModuleGraph
from backend.graph.graph_schema import EdgeType, GraphEdge, GraphNode
from backend.parser.code_parser import ParsedFile, ParseResult

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Output container
# ---------------------------------------------------------------------------


@dataclass
class DependencyGraph:
    """DependencyAnalyzer.analyze() 的完整输出。

    Attributes:
        module_deps:   Module  --depends_on-->  Module
        service_deps:  Service --depends_on-->  Service
        circular_deps: 循环依赖链（各链为 module 名称列表，仅用于报告）
    """

    module_deps: list[GraphEdge] = field(default_factory=list)
    service_deps: list[GraphEdge] = field(default_factory=list)
    circular_deps: list[list[str]] = field(default_factory=list)

    @property
    def edges(self) -> list[GraphEdge]:
        return self.module_deps + self.service_deps

    @property
    def stats(self) -> dict[str, int]:
        return {
            "module_deps":   len(self.module_deps),
            "service_deps":  len(self.service_deps),
            "circular_deps": len(self.circular_deps),
            "total_edges":   len(self.edges),
        }


# ---------------------------------------------------------------------------
# DependencyAnalyzer
# ---------------------------------------------------------------------------


class DependencyAnalyzer:
    """
    依赖关系分析器。

    接收 ModuleGraph（目录结构）、ComponentGraph（组件/服务节点）
    和 ParseResult（import + 构造函数信息），输出 DependencyGraph。

    示例::

        analyzer = DependencyAnalyzer(repo_root)
        dep_graph = analyzer.analyze(module_graph, component_graph, parsed_result)
        print(dep_graph.stats)
    """

    def __init__(self, repo_root: str | Path) -> None:
        self.repo_root = Path(repo_root).resolve()

    # ------------------------------------------------------------------
    # Public
    # ------------------------------------------------------------------

    def analyze(
        self,
        module_graph: ModuleGraph,
        component_graph: ComponentGraph,
        parsed_result: ParseResult,
    ) -> DependencyGraph:
        """执行依赖分析。

        Args:
            module_graph:     ModuleDetector 输出，含 Module / File 节点。
            component_graph:  ComponentDetector 输出，含 Component 节点。
            parsed_result:    CodeParser 输出，含 ParsedFile（imports + classes）。

        Returns:
            DependencyGraph，含 module_deps / service_deps / circular_deps。
        """
        dep_graph = DependencyGraph()
        seen_mod: set[tuple[str, str]] = set()
        seen_svc: set[tuple[str, str]] = set()

        # 预建索引
        file_to_module = self._build_file_to_module(module_graph)

        for pf in parsed_result.files:
            # ── 1. Module → Module（从 import 语句）──
            self._detect_module_deps(
                pf, file_to_module, module_graph, dep_graph, seen_mod
            )
            # ── 2. Service → Service（从构造函数注解）──
            self._detect_service_deps_from_ctor(
                pf, component_graph, dep_graph, seen_svc
            )

        # ── 3. Service → Service（从 import 路径推断）──
        self._detect_service_deps_from_imports(
            parsed_result, module_graph, component_graph,
            file_to_module, dep_graph, seen_svc,
        )

        # ── 4. 循环依赖检测 ──
        dep_graph.circular_deps = self._detect_cycles(
            module_graph, dep_graph.module_deps
        )
        if dep_graph.circular_deps:
            logger.warning("检测到 %d 个循环依赖", len(dep_graph.circular_deps))

        logger.info(
            "依赖分析完成: module_deps=%d service_deps=%d circular=%d",
            len(dep_graph.module_deps),
            len(dep_graph.service_deps),
            len(dep_graph.circular_deps),
        )
        return dep_graph

    # ------------------------------------------------------------------
    # Module → Module dependencies (from imports)
    # ------------------------------------------------------------------

    def _detect_module_deps(
        self,
        pf: ParsedFile,
        file_to_module: dict[str, GraphNode],
        module_graph: ModuleGraph,
        dep_graph: DependencyGraph,
        seen: set[tuple[str, str]],
    ) -> None:
        source_mod = file_to_module.get(pf.file_path)
        if source_mod is None:
            return

        for imp in pf.imports:
            target_mod = self._resolve_import_to_module(
                imp.module, pf.language, pf.file_path, module_graph
            )
            if target_mod is None or target_mod.id == source_mod.id:
                continue

            key = (source_mod.id, target_mod.id)
            if key in seen:
                continue
            seen.add(key)

            dep_graph.module_deps.append(_edge(
                source_mod.id, target_mod.id,
                EdgeType.DEPENDS_ON.value,
                source="import",
                import_module=imp.module,
                language=pf.language,
                source_file=pf.file_path,
            ))

    # ------------------------------------------------------------------
    # Service → Service: constructor injection
    # ------------------------------------------------------------------

    def _detect_service_deps_from_ctor(
        self,
        pf: ParsedFile,
        component_graph: ComponentGraph,
        dep_graph: DependencyGraph,
        seen: set[tuple[str, str]],
    ) -> None:
        """从构造函数参数的类型注解推断服务依赖。

        示例 Python：
            class OrderService:
                def __init__(self, user_svc: UserService, payment: PaymentService)

        示例 TypeScript / Java：
            constructor(private userService: UserService) {}
        """
        comp_by_name = component_graph.component_by_name

        for cls in pf.classes:
            source_comp = comp_by_name.get(cls.name)
            if source_comp is None:
                continue

            for method in cls.methods:
                if method.name not in ("__init__", "__new__", "constructor",
                                       "init", "setUp"):
                    continue
                for param in method.parameters:
                    if not param.type_annotation:
                        continue
                    target_comp = _find_comp_in_type_ann(
                        param.type_annotation, comp_by_name
                    )
                    if target_comp is None or target_comp.id == source_comp.id:
                        continue

                    key = (source_comp.id, target_comp.id)
                    if key in seen:
                        continue
                    seen.add(key)

                    dep_graph.service_deps.append(_edge(
                        source_comp.id, target_comp.id,
                        EdgeType.DEPENDS_ON.value,
                        source="constructor_injection",
                        source_class=cls.name,
                        target_class=target_comp.name,
                        param_name=param.name,
                        type_annotation=param.type_annotation,
                        language=pf.language,
                    ))

    # ------------------------------------------------------------------
    # Service → Service: import-based inference
    # ------------------------------------------------------------------

    def _detect_service_deps_from_imports(
        self,
        parsed_result: ParseResult,
        module_graph: ModuleGraph,
        component_graph: ComponentGraph,
        file_to_module: dict[str, GraphNode],
        dep_graph: DependencyGraph,
        seen: set[tuple[str, str]],
    ) -> None:
        """若服务文件 A 的 import 解析到了模块 M，且 M 中存在已知服务类，
        则推断 ServiceA depends_on ServiceB。

        避免重复：已由构造函数注解识别的依赖不再添加。
        """
        # 构建 module_id → set[component.id]（哪些服务在该模块下）
        mod_to_comps: dict[str, list[GraphNode]] = defaultdict(list)
        for comp in component_graph.components:
            # comp.properties["file_path"] → 对应的 module
            comp_file = comp.properties.get("file_path", "")
            mod = file_to_module.get(comp_file)
            if mod:
                mod_to_comps[mod.id].append(comp)

        comp_by_name = component_graph.component_by_name

        for pf in parsed_result.files:
            # 该文件属于哪些组件
            file_comps = [
                comp_by_name[cls.name]
                for cls in pf.classes
                if cls.name in comp_by_name
            ]
            if not file_comps:
                continue

            for imp in pf.imports:
                target_mod = self._resolve_import_to_module(
                    imp.module, pf.language, pf.file_path, module_graph
                )
                if target_mod is None:
                    continue

                for target_comp in mod_to_comps.get(target_mod.id, []):
                    for source_comp in file_comps:
                        if source_comp.id == target_comp.id:
                            continue
                        key = (source_comp.id, target_comp.id)
                        if key in seen:
                            continue
                        seen.add(key)
                        dep_graph.service_deps.append(_edge(
                            source_comp.id, target_comp.id,
                            EdgeType.DEPENDS_ON.value,
                            source="import_inference",
                            import_module=imp.module,
                            source_class=source_comp.name,
                            target_class=target_comp.name,
                            language=pf.language,
                        ))

    # ------------------------------------------------------------------
    # Cycle detection (DFS)
    # ------------------------------------------------------------------

    def _detect_cycles(
        self,
        module_graph: ModuleGraph,
        module_deps: list[GraphEdge],
    ) -> list[list[str]]:
        """使用 DFS 在模块依赖图中检测循环依赖链。

        Returns:
            循环链列表，每条链为模块 name 字符串列表。
        """
        # 构建邻接表
        adj: dict[str, list[str]] = defaultdict(list)
        for edge in module_deps:
            adj[edge.from_].append(edge.to)

        # id → name 映射
        id_to_name: dict[str, str] = {
            m.id: m.name for m in module_graph.modules
        }

        cycles: list[list[str]] = []
        visited: set[str] = set()
        path: list[str] = []
        path_set: set[str] = set()

        def dfs(node_id: str) -> None:
            visited.add(node_id)
            path.append(node_id)
            path_set.add(node_id)

            for neighbor in adj.get(node_id, []):
                if neighbor not in visited:
                    dfs(neighbor)
                elif neighbor in path_set:
                    # 找到环：从 neighbor 到当前位置
                    idx = path.index(neighbor)
                    cycle = [id_to_name.get(n, n) for n in path[idx:]]
                    cycles.append(cycle)

            path.pop()
            path_set.discard(node_id)

        all_nodes = set(adj.keys()) | {t for neighbors in adj.values() for t in neighbors}
        for node_id in all_nodes:
            if node_id not in visited:
                dfs(node_id)

        return cycles

    # ------------------------------------------------------------------
    # Import resolution
    # ------------------------------------------------------------------

    def _resolve_import_to_module(
        self,
        import_str: str,
        language: str,
        source_file: str,
        module_graph: ModuleGraph,
    ) -> Optional[GraphNode]:
        """将 import 字符串解析为内部 Module GraphNode。

        各语言转换规则：
          Python:     backend.api.server  →  backend/api, backend/api/server
          TypeScript: ./services/user     →  相对路径解析
          Go:         github.com/x/y/pkg  →  最后若干段 path 匹配
          Java:       com.example.svc.Foo →  com/example/svc, svc
        """
        candidates = self._import_to_candidates(import_str, language, source_file)
        for candidate in candidates:
            mod = module_graph.module_by_dir.get(candidate)
            if mod:
                return mod
        return None

    def _import_to_candidates(
        self,
        import_str: str,
        language: str,
        source_file: str,
    ) -> list[str]:
        candidates: list[str] = []

        if language == "python":
            candidates = self._python_import_candidates(import_str, source_file)

        elif language == "typescript":
            candidates = self._ts_import_candidates(import_str, source_file)

        elif language == "go":
            candidates = self._go_import_candidates(import_str)

        elif language == "java":
            candidates = self._java_import_candidates(import_str)

        return candidates

    # ── Python ──

    def _python_import_candidates(self, import_str: str, source_file: str) -> list[str]:
        cands: list[str] = []

        # 相对导入：. 或 .. 开头
        if import_str.startswith("."):
            level = len(import_str) - len(import_str.lstrip("."))
            rest = import_str.lstrip(".")
            source_dir = Path(source_file).parent
            try:
                # 相对 repo_root 的路径
                rel_dir = source_dir.relative_to(self.repo_root)
            except ValueError:
                rel_dir = source_dir
            # 向上导航 level-1 层
            parts = list(rel_dir.parts)
            parts = parts[:max(0, len(parts) - (level - 1))]
            base = "/".join(parts) if parts else ""
            if rest:
                target = (base + "/" + rest.replace(".", "/")).lstrip("/")
                cands.append(target)
                # 取 parent
                parent = "/".join(target.split("/")[:-1])
                if parent:
                    cands.append(parent)
            elif base:
                cands.append(base)
            return cands

        # 绝对导入：逐层截断
        parts = import_str.split(".")
        for i in range(len(parts), 0, -1):
            cands.append("/".join(parts[:i]))
        return cands

    # ── TypeScript ──

    def _ts_import_candidates(self, import_str: str, source_file: str) -> list[str]:
        # 非相对导入 → 外部包，跳过
        if not import_str.startswith("."):
            return []
        source_dir = Path(source_file).parent
        target = (source_dir / import_str).resolve()
        cands: list[str] = []
        try:
            rel = target.relative_to(self.repo_root)
            cands.append(str(rel).replace("\\", "/"))
            cands.append(str(rel.parent).replace("\\", "/"))
        except ValueError:
            pass
        return cands

    # ── Go ──

    def _go_import_candidates(self, import_str: str) -> list[str]:
        # stdlib（无 /）跳过
        if "/" not in import_str:
            return []
        parts = import_str.split("/")
        cands: list[str] = []
        # 从最长后缀到最短后缀依次尝试
        for i in range(len(parts), 0, -1):
            cands.append("/".join(parts[-i:]))
        return cands

    # ── Java ──

    def _java_import_candidates(self, import_str: str) -> list[str]:
        # 移除通配符
        clean = import_str.rstrip(".*")
        parts = clean.split(".")
        cands: list[str] = []
        # java.*, javax.* → stdlib，跳过
        if parts[0] in ("java", "javax", "sun", "android"):
            return []
        # 逐层截断
        for i in range(len(parts), 0, -1):
            cands.append("/".join(parts[:i]))
        # 最后两段（包名 + 类名 → 目录）
        if len(parts) >= 2:
            cands.append("/".join(parts[-2:]).lower())
        cands.append(parts[-1].lower())
        return cands

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _build_file_to_module(
        self, module_graph: ModuleGraph
    ) -> dict[str, GraphNode]:
        """构建 abs_file_path → Module GraphNode 索引。

        通过 Module --contains--> File 边反推每个文件属于哪个模块。
        """
        mod_ids: set[str] = {m.id for m in module_graph.modules}
        file_id_to_mod_id: dict[str, str] = {}
        for edge in module_graph.edges:
            if edge.from_ in mod_ids:
                file_id_to_mod_id[edge.to] = edge.from_

        mod_by_id: dict[str, GraphNode] = {m.id: m for m in module_graph.modules}
        file_id_to_node: dict[str, GraphNode] = {f.id: f for f in module_graph.files}

        result: dict[str, GraphNode] = {}
        for file_node in module_graph.files:
            abs_path = file_node.properties.get("abs_path", "")
            mod_id = file_id_to_mod_id.get(file_node.id)
            if abs_path and mod_id:
                result[abs_path] = mod_by_id[mod_id]
        return result


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _edge(from_id: str, to_id: str, edge_type: str, **properties) -> GraphEdge:
    return GraphEdge(**{
        "from": from_id,
        "to": to_id,
        "type": edge_type,
        "properties": properties,
    })


def _find_comp_in_type_ann(
    type_ann: str, comp_by_name: dict[str, GraphNode]
) -> Optional[GraphNode]:
    """在类型注解字符串中查找已知组件名称。

    Examples:
        "UserService"           → comp_by_name["UserService"]
        "Optional[UserService]" → comp_by_name["UserService"]
        "List[OrderService]"    → comp_by_name["OrderService"]
    """
    for name, node in comp_by_name.items():
        # 整词匹配，避免 "UserService" 匹配 "UserServiceImpl"
        if re.search(r'\b' + re.escape(name) + r'\b', type_ann):
            return node
    return None
