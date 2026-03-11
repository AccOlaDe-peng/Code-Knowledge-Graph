"""
依赖分析器模块。

分析代码仓库的依赖关系，包括：
1. 包管理器依赖（requirements.txt / package.json / go.mod / Cargo.toml）
2. 第三方库使用分析
3. 内部模块依赖图（基于已有 IMPORTS 边的拓扑分析）
4. 循环依赖检测

生成 DEPENDS_ON 类型的边连接仓库/模块到外部依赖。
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from backend.graph.schema import EdgeBase, EdgeType, InfrastructureNode, InfraType, ModuleNode

logger = logging.getLogger(__name__)


@dataclass
class ExternalDependency:
    """外部依赖信息。"""

    name: str
    """依赖包名"""

    version: Optional[str] = None
    """版本约束字符串"""

    ecosystem: str = "pypi"
    """包生态系统: pypi | npm | maven | cargo | go"""

    is_dev: bool = False
    """是否为开发依赖"""

    extras: list[str] = field(default_factory=list)
    """额外特性（如 fastapi[all]）"""


@dataclass
class DependencyReport:
    """依赖分析报告。"""

    external_deps: list[ExternalDependency] = field(default_factory=list)
    """外部依赖列表"""

    circular_deps: list[list[str]] = field(default_factory=list)
    """循环依赖链（模块路径列表）"""

    unused_imports: list[str] = field(default_factory=list)
    """疑似未使用的导入"""

    dep_stats: dict[str, int] = field(default_factory=dict)
    """各生态系统依赖数量"""


class DependencyAnalyzer:
    """
    依赖关系分析器。

    读取各种包管理器的配置文件，提取外部依赖信息；
    同时分析内部模块图，检测循环依赖。

    示例::

        analyzer = DependencyAnalyzer("/path/to/repo")
        report, infra_nodes, edges = analyzer.analyze(module_nodes)
    """

    def __init__(self, repo_root: str) -> None:
        """
        初始化依赖分析器。

        Args:
            repo_root: 仓库根目录路径
        """
        self.repo_root = Path(repo_root)

    def analyze(
        self,
        module_nodes: dict[str, ModuleNode],
        import_edges: Optional[list[EdgeBase]] = None,
    ) -> tuple[DependencyReport, list[InfrastructureNode], list[EdgeBase]]:
        """
        执行依赖分析。

        Args:
            module_nodes: 文件路径 -> 模块节点的映射
            import_edges: 已有的 IMPORTS 边（用于循环依赖检测）

        Returns:
            (依赖报告, 基础设施节点列表, 新增边列表) 三元组
        """
        report = DependencyReport()
        infra_nodes: list[InfrastructureNode] = []
        new_edges: list[EdgeBase] = []

        # 扫描包管理器文件
        ext_deps = self._scan_package_files()
        report.external_deps = ext_deps

        # 为外部依赖创建基础设施节点
        for dep in ext_deps:
            node = self._dep_to_infra_node(dep)
            infra_nodes.append(node)
            # 将仓库根节点与依赖关联（此处暂以模块为代理）
            report.dep_stats[dep.ecosystem] = report.dep_stats.get(dep.ecosystem, 0) + 1

        # 检测循环依赖
        if import_edges:
            cycles = self._detect_cycles(module_nodes, import_edges)
            report.circular_deps = cycles
            if cycles:
                logger.warning(f"检测到 {len(cycles)} 个循环依赖")

        logger.info(
            f"依赖分析完成: {len(ext_deps)} 个外部依赖, "
            f"{len(report.circular_deps)} 个循环依赖"
        )
        return report, infra_nodes, new_edges

    def _scan_package_files(self) -> list[ExternalDependency]:
        """扫描并解析各类包管理器文件。"""
        deps: list[ExternalDependency] = []

        parsers = [
            ("requirements.txt", self._parse_requirements),
            ("requirements-dev.txt", self._parse_requirements_dev),
            ("pyproject.toml", self._parse_pyproject),
            ("package.json", self._parse_package_json),
            ("go.mod", self._parse_go_mod),
            ("Cargo.toml", self._parse_cargo_toml),
            ("pom.xml", self._parse_pom_xml),
        ]

        for filename, parser in parsers:
            filepath = self.repo_root / filename
            if filepath.exists():
                try:
                    file_deps = parser(filepath)
                    deps.extend(file_deps)
                    logger.debug(f"从 {filename} 解析到 {len(file_deps)} 个依赖")
                except Exception as e:
                    logger.warning(f"解析 {filename} 失败: {e}")

        return deps

    def _parse_requirements(self, path: Path) -> list[ExternalDependency]:
        """解析 requirements.txt 格式文件。"""
        deps: list[ExternalDependency] = []
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or line.startswith("-r"):
                continue
            # 去除 URL 型依赖
            if "://" in line:
                continue
            # 解析包名和版本
            m = re.match(r"^([A-Za-z0-9_\-\[\].]+)\s*([><=!~^,\s\d.*]+)?", line)
            if m:
                name = m.group(1)
                extras = re.findall(r"\[([^\]]+)\]", name)
                name = re.sub(r"\[.*\]", "", name)
                version = m.group(2).strip() if m.group(2) else None
                deps.append(ExternalDependency(
                    name=name, version=version,
                    ecosystem="pypi", extras=extras
                ))
        return deps

    def _parse_requirements_dev(self, path: Path) -> list[ExternalDependency]:
        """解析开发依赖文件。"""
        deps = self._parse_requirements(path)
        for dep in deps:
            dep.is_dev = True
        return deps

    def _parse_pyproject(self, path: Path) -> list[ExternalDependency]:
        """解析 pyproject.toml 中的依赖。"""
        deps: list[ExternalDependency] = []
        try:
            import tomllib  # Python 3.11+
        except ImportError:
            try:
                import tomli as tomllib  # type: ignore
            except ImportError:
                logger.warning("tomllib/tomli 未安装，跳过 pyproject.toml 解析")
                return deps

        try:
            data = tomllib.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return deps

        # PEP 621 格式
        project_deps = data.get("project", {}).get("dependencies", [])
        for dep_str in project_deps:
            m = re.match(r"^([A-Za-z0-9_\-]+)", dep_str)
            if m:
                deps.append(ExternalDependency(name=m.group(1), ecosystem="pypi"))

        return deps

    def _parse_package_json(self, path: Path) -> list[ExternalDependency]:
        """解析 package.json 的 dependencies 和 devDependencies。"""
        deps: list[ExternalDependency] = []
        data: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
        for name, version in data.get("dependencies", {}).items():
            deps.append(ExternalDependency(name=name, version=version, ecosystem="npm"))
        for name, version in data.get("devDependencies", {}).items():
            deps.append(ExternalDependency(name=name, version=version, ecosystem="npm", is_dev=True))
        return deps

    def _parse_go_mod(self, path: Path) -> list[ExternalDependency]:
        """解析 go.mod 文件。"""
        deps: list[ExternalDependency] = []
        in_require = False
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("require ("):
                in_require = True
                continue
            if in_require and line == ")":
                in_require = False
                continue
            if in_require or line.startswith("require "):
                parts = line.replace("require ", "").split()
                if len(parts) >= 2:
                    deps.append(ExternalDependency(
                        name=parts[0], version=parts[1], ecosystem="go"
                    ))
        return deps

    def _parse_cargo_toml(self, path: Path) -> list[ExternalDependency]:
        """解析 Cargo.toml 依赖（简化版）。"""
        deps: list[ExternalDependency] = []
        try:
            import tomllib
        except ImportError:
            try:
                import tomli as tomllib  # type: ignore
            except ImportError:
                return deps

        data = tomllib.loads(path.read_text(encoding="utf-8"))
        for name, spec in data.get("dependencies", {}).items():
            version = spec if isinstance(spec, str) else spec.get("version")
            deps.append(ExternalDependency(name=name, version=version, ecosystem="cargo"))
        return deps

    def _parse_pom_xml(self, path: Path) -> list[ExternalDependency]:
        """解析 Maven pom.xml（简化版，仅提取 artifactId）。"""
        deps: list[ExternalDependency] = []
        content = path.read_text(encoding="utf-8")
        artifacts = re.findall(r"<artifactId>([^<]+)</artifactId>", content)
        versions = re.findall(r"<version>([^<]+)</version>", content)
        for i, name in enumerate(artifacts[1:], 0):  # 跳过项目自身 artifactId
            version = versions[i] if i < len(versions) else None
            deps.append(ExternalDependency(name=name, version=version, ecosystem="maven"))
        return deps

    def _dep_to_infra_node(self, dep: ExternalDependency) -> InfrastructureNode:
        """将外部依赖转换为基础设施节点。"""
        return InfrastructureNode(
            name=dep.name,
            infra_type=InfraType.SERVICE,
            technology=dep.name,
            metadata={
                "version": dep.version or "",
                "ecosystem": dep.ecosystem,
                "is_dev": dep.is_dev,
                "extras": dep.extras,
            },
        )

    def _detect_cycles(
        self,
        module_nodes: dict[str, ModuleNode],
        import_edges: list[EdgeBase],
    ) -> list[list[str]]:
        """
        使用 DFS 检测模块图中的循环依赖。

        Args:
            module_nodes: 模块节点映射
            import_edges: 导入边列表

        Returns:
            循环依赖链列表，每条链为模块名称列表
        """
        # 构建邻接表
        adj: dict[str, list[str]] = {n.id: [] for n in module_nodes.values()}
        id_to_name: dict[str, str] = {n.id: n.name for n in module_nodes.values()}

        for edge in import_edges:
            if edge.source_id in adj:
                adj[edge.source_id].append(edge.target_id)

        cycles: list[list[str]] = []
        visited: set[str] = set()
        rec_stack: list[str] = []

        def dfs(node_id: str) -> bool:
            visited.add(node_id)
            rec_stack.append(node_id)
            for neighbor in adj.get(node_id, []):
                if neighbor not in visited:
                    if dfs(neighbor):
                        return True
                elif neighbor in rec_stack:
                    # 找到环，提取环路
                    idx = rec_stack.index(neighbor)
                    cycle = [id_to_name.get(n, n) for n in rec_stack[idx:]]
                    cycles.append(cycle)
                    return True
            rec_stack.pop()
            return False

        for node_id in list(adj.keys()):
            if node_id not in visited:
                rec_stack.clear()
                dfs(node_id)

        return cycles
