"""
模块识别器模块。

核心规则：同一目录下的文件视为同一模块。

输出结构（ModuleGraph）::

    repository: GraphNode          # type=Repository（根节点）
    modules:    list[GraphNode]    # type=Module，每个目录对应一个
    files:      list[GraphNode]    # type=File，每个源文件对应一个
    edges:      list[GraphEdge]    # contains 边

边关系：
    Repository --contains--> Module
    Module     --contains--> File
"""

from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional
from uuid import uuid4

from backend.graph.graph_schema import EdgeType, GraphEdge, GraphNode, NodeType
from backend.scanner.repo_scanner import FileInfo, ScanResult

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Output container
# ---------------------------------------------------------------------------


@dataclass
class ModuleGraph:
    """ModuleDetector.detect() 的完整输出。

    Attributes:
        repository:    仓库根节点（type=Repository）
        modules:       模块节点列表（type=Module），每目录一个
        files:         文件节点列表（type=File），每源文件一个
        edges:         contains 边（Repository→Module 和 Module→File）
        module_by_dir: 目录相对路径 → Module GraphNode 索引
        file_by_path:  文件绝对路径 → File GraphNode 索引
    """

    repository: GraphNode
    modules: list[GraphNode] = field(default_factory=list)
    files: list[GraphNode] = field(default_factory=list)
    edges: list[GraphEdge] = field(default_factory=list)

    # 快捷索引（不参与序列化）
    module_by_dir: dict[str, GraphNode] = field(default_factory=dict, repr=False)
    file_by_path: dict[str, GraphNode] = field(default_factory=dict, repr=False)

    @property
    def stats(self) -> dict[str, int]:
        return {
            "modules": len(self.modules),
            "files": len(self.files),
            "edges": len(self.edges),
        }


# ---------------------------------------------------------------------------
# ModuleDetector
# ---------------------------------------------------------------------------


class ModuleDetector:
    """
    目录级模块识别器。

    将仓库文件按所在目录聚合，每个目录产生一个 Module 节点，
    同时为每个源文件产生一个 File 节点，并生成：
      - Repository --contains--> Module
      - Module     --contains--> File

    示例::

        detector = ModuleDetector(repo_root="/path/to/repo")
        graph = detector.detect(scan_result)
        print(graph.stats)
        # {'modules': 12, 'files': 37, 'edges': 49}
    """

    def __init__(self, repo_root: str | Path) -> None:
        self.repo_root = Path(repo_root).resolve()

    # ------------------------------------------------------------------
    # Public
    # ------------------------------------------------------------------

    def detect(
        self,
        scan_result: ScanResult,
        repo_node_id: Optional[str] = None,
    ) -> ModuleGraph:
        """执行模块识别，返回 ModuleGraph。

        Args:
            scan_result:  仓库扫描结果（来自 RepoScanner）。
            repo_node_id: 外部传入的 Repository 节点 ID；
                          若为 None 则自动创建新的仓库根节点。
        """
        # 1. 仓库根节点
        repo_node = self._make_repo_node(scan_result, repo_node_id)

        # 2. 按目录分组
        dir_groups = self._group_by_directory(scan_result.files)

        # 3. 构建 Module 节点
        modules: list[GraphNode] = []
        module_by_dir: dict[str, GraphNode] = {}
        for dir_path, dir_files in sorted(dir_groups.items()):
            node = self._make_module_node(dir_path, dir_files)
            modules.append(node)
            module_by_dir[dir_path] = node

        # 4. 构建 File 节点
        files: list[GraphNode] = []
        file_by_path: dict[str, GraphNode] = {}
        for file_info in scan_result.files:
            node = self._make_file_node(file_info)
            files.append(node)
            file_by_path[file_info.abs_path] = node

        # 5. 构建 contains 边
        edges = self._build_edges(
            repo_node, modules, files,
            dir_groups, module_by_dir, file_by_path,
        )

        graph = ModuleGraph(
            repository=repo_node,
            modules=modules,
            files=files,
            edges=edges,
            module_by_dir=module_by_dir,
            file_by_path=file_by_path,
        )

        logger.info(
            "模块识别完成: repo=%s modules=%d files=%d edges=%d",
            scan_result.repo_name,
            len(modules),
            len(files),
            len(edges),
        )
        return graph

    # ------------------------------------------------------------------
    # Node builders
    # ------------------------------------------------------------------

    def _make_repo_node(
        self, scan_result: ScanResult, node_id: Optional[str]
    ) -> GraphNode:
        return GraphNode(
            id=node_id or str(uuid4()),
            type=NodeType.REPOSITORY.value,
            name=scan_result.repo_name,
            properties={
                "path": scan_result.repo_path,
                "primary_language": scan_result.primary_language(),
                "total_files": scan_result.total_files,
                "total_lines": scan_result.total_lines,
                "git_branch": scan_result.git_branch,
                "git_commit": scan_result.git_commit,
                "git_remote_url": scan_result.git_remote_url,
            },
        )

    def _make_module_node(
        self, dir_path: str, files: list[FileInfo]
    ) -> GraphNode:
        """每个目录 → 一个 Module 节点。"""
        # 主语言：文件数最多的语言
        lang_count: dict[str, int] = defaultdict(int)
        for f in files:
            lang_count[f.language] += 1
        primary_lang = max(lang_count, key=lang_count.__getitem__) if lang_count else "unknown"

        # 目录的绝对路径
        abs_dir = str(self.repo_root / dir_path) if dir_path else str(self.repo_root)

        # 深度（根目录深度为 0）
        depth = len(Path(dir_path).parts) if dir_path else 0

        # 节点名称：取最后一段目录名；根目录用仓库名
        name = Path(dir_path).name if dir_path else self.repo_root.name

        return GraphNode(
            type=NodeType.MODULE.value,
            name=name,
            properties={
                "path": dir_path or "",
                "abs_path": abs_dir,
                "depth": depth,
                "file_count": len(files),
                "primary_language": primary_lang,
                "languages": dict(lang_count),
            },
        )

    def _make_file_node(self, file_info: FileInfo) -> GraphNode:
        """每个源文件 → 一个 File 节点。"""
        return GraphNode(
            type=NodeType.FILE.value,
            name=Path(file_info.path).name,
            properties={
                "path": file_info.path,
                "abs_path": file_info.abs_path,
                "language": file_info.language,
                "size_bytes": file_info.size_bytes,
                "line_count": file_info.line_count,
                "sha256": file_info.sha256,
                "last_modified": file_info.last_modified,
            },
        )

    # ------------------------------------------------------------------
    # Edge builders
    # ------------------------------------------------------------------

    def _build_edges(
        self,
        repo_node: GraphNode,
        modules: list[GraphNode],
        files: list[GraphNode],
        dir_groups: dict[str, list[FileInfo]],
        module_by_dir: dict[str, GraphNode],
        file_by_path: dict[str, GraphNode],
    ) -> list[GraphEdge]:
        edges: list[GraphEdge] = []

        # Repository --contains--> Module
        for mod in modules:
            edges.append(GraphEdge(**{
                "from": repo_node.id,
                "to": mod.id,
                "type": EdgeType.CONTAINS.value,
                "properties": {
                    "relation": "repository_contains_module",
                    "module_path": mod.properties.get("path", ""),
                },
            }))

        # Module --contains--> File
        for dir_path, dir_files in dir_groups.items():
            mod_node = module_by_dir.get(dir_path)
            if not mod_node:
                continue
            for fi in dir_files:
                file_node = file_by_path.get(fi.abs_path)
                if not file_node:
                    continue
                edges.append(GraphEdge(**{
                    "from": mod_node.id,
                    "to": file_node.id,
                    "type": EdgeType.CONTAINS.value,
                    "properties": {
                        "relation": "module_contains_file",
                        "file_path": fi.path,
                        "language": fi.language,
                    },
                }))

        return edges

    # ------------------------------------------------------------------
    # Directory grouping
    # ------------------------------------------------------------------

    def _group_by_directory(
        self, files: list[FileInfo]
    ) -> dict[str, list[FileInfo]]:
        """将文件列表按所在目录分组。

        Returns:
            { 目录相对路径: [FileInfo, ...] }
            根目录下的文件键为空字符串 ""。
        """
        groups: dict[str, list[FileInfo]] = defaultdict(list)
        for fi in files:
            dir_path = str(Path(fi.path).parent)
            # 根目录显示为空字符串
            if dir_path == ".":
                dir_path = ""
            groups[dir_path].append(fi)
        return dict(groups)
