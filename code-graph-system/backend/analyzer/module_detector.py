"""
模块识别器模块。

基于扫描和解析结果，识别代码仓库中的逻辑模块边界，
构建模块节点并推断模块间的依赖关系（IMPORTS 边）。

模块定义：
- Python: 单个 .py 文件 或 含 __init__.py 的目录（包）
- JavaScript/TypeScript: 单个文件 或 package.json 目录
- Java: package 声明对应的目录
- Go: package 声明对应的目录
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

from backend.graph.schema import EdgeBase, EdgeType, ModuleNode, NodeType
from backend.parser.code_parser import ParsedFile
from backend.scanner.repo_scanner import FileInfo, ScanResult

logger = logging.getLogger(__name__)


class ModuleDetector:
    """
    模块识别器。

    分析扫描结果，为每个源码文件/包生成对应的 ModuleNode，
    并根据 import 语句生成 IMPORTS 类型的边。

    示例::

        detector = ModuleDetector()
        nodes, edges = detector.detect(scan_result, parsed_files)
    """

    def __init__(self, repo_root: str) -> None:
        """
        初始化模块识别器。

        Args:
            repo_root: 仓库根目录路径（用于计算相对路径）
        """
        self.repo_root = Path(repo_root)

    def detect(
        self,
        scan_result: ScanResult,
        parsed_files: dict[str, ParsedFile],
    ) -> tuple[list[ModuleNode], list[EdgeBase]]:
        """
        执行模块识别。

        Args:
            scan_result: 仓库扫描结果
            parsed_files: 文件路径 -> 解析结果 的映射

        Returns:
            (模块节点列表, 导入边列表) 元组
        """
        nodes: list[ModuleNode] = []
        edges: list[EdgeBase] = []
        path_to_node: dict[str, ModuleNode] = {}

        # 创建文件级模块节点
        for file_info in scan_result.files:
            node = self._create_module_node(file_info, parsed_files.get(file_info.path))
            nodes.append(node)
            path_to_node[file_info.path] = node

        # 检测包节点（Python __init__.py 所在目录）
        package_nodes = self._detect_packages(scan_result, path_to_node)
        nodes.extend(package_nodes.values())

        # 构建导入边
        edges.extend(
            self._build_import_edges(scan_result, parsed_files, path_to_node)
        )

        logger.info(f"模块识别完成: {len(nodes)} 个模块, {len(edges)} 条导入边")
        return nodes, edges

    def _create_module_node(
        self,
        file_info: FileInfo,
        parsed: Optional[ParsedFile],
    ) -> ModuleNode:
        """根据文件信息创建模块节点。"""
        path = Path(file_info.path)
        package = str(path.parent).replace("/", ".").replace("\\", ".") if str(path.parent) != "." else ""

        exports: list[str] = []
        imports: list[str] = []

        if parsed:
            imports = [imp.module for imp in parsed.imports]
            # 导出：类名 + 模块级函数名
            exports = [cls.name for cls in parsed.classes]
            exports += [fn.name for fn in parsed.functions]

        return ModuleNode(
            name=path.stem,
            file_path=file_info.abs_path,
            line_start=1,
            line_end=file_info.line_count,
            package=package or None,
            is_package=False,
            exports=exports,
            imports=imports,
            metadata={
                "language": file_info.language,
                "size_bytes": file_info.size_bytes,
                "sha256": file_info.sha256,
            },
        )

    def _detect_packages(
        self,
        scan_result: ScanResult,
        path_to_node: dict[str, ModuleNode],
    ) -> dict[str, ModuleNode]:
        """检测 Python 包（含 __init__.py 的目录）。"""
        packages: dict[str, ModuleNode] = {}

        init_files = [
            f for f in scan_result.files
            if f.language == "python" and Path(f.path).name == "__init__.py"
        ]

        for init in init_files:
            pkg_dir = str(Path(init.path).parent)
            if pkg_dir in packages:
                continue
            pkg_path = self.repo_root / pkg_dir
            node = ModuleNode(
                name=Path(pkg_dir).name,
                file_path=str(pkg_path),
                is_package=True,
                package=pkg_dir.replace("/", ".").replace("\\", "."),
                metadata={"language": "python"},
            )
            packages[pkg_dir] = node

        return packages

    def _build_import_edges(
        self,
        scan_result: ScanResult,
        parsed_files: dict[str, ParsedFile],
        path_to_node: dict[str, ModuleNode],
    ) -> list[EdgeBase]:
        """根据解析到的 import 语句构建模块依赖边。"""
        edges: list[EdgeBase] = []
        # 构建模块名 -> 节点 的索引
        name_index: dict[str, ModuleNode] = {
            n.name: n for n in path_to_node.values()
        }
        # 也按 package.name 索引
        pkg_index: dict[str, ModuleNode] = {}
        for node in path_to_node.values():
            if node.package:
                full_name = f"{node.package}.{node.name}"
                pkg_index[full_name] = node

        for file_path, parsed in parsed_files.items():
            source_node = path_to_node.get(file_path)
            if not source_node:
                continue

            for imp in parsed.imports:
                # 查找目标节点
                target = (
                    pkg_index.get(imp.module)
                    or name_index.get(imp.module)
                    or name_index.get(imp.module.split(".")[-1])
                )
                if target and target.id != source_node.id:
                    edges.append(EdgeBase(
                        type=EdgeType.IMPORTS,
                        source_id=source_node.id,
                        target_id=target.id,
                        metadata={"import_line": imp.line, "names": imp.names},
                    ))

        return edges
