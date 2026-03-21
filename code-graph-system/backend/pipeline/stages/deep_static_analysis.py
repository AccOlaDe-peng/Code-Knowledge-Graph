"""Stage 1: 深度静态分析 — 产出 A/B 两类数据。

产出 A（持久化，直接入图谱）：
    - structural_nodes: 结构节点（类、函数、API、数据模型）
    - structural_edges: 结构边（含跨模块 depends_on）

产出 B（临时，供后续 Stage 消费）：
    - import_graph: 导入图
    - framework_patterns: 框架模式候选（Spring DI/Event/Kafka）
    - low_confidence_edges: 低置信度边

使用 ProcessPoolExecutor 并行 AST 解析。
"""
from __future__ import annotations

import concurrent.futures
import logging
import time
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from typing import Any, Callable

from backend.agent.structure_indexer import ClassInfo, FileSkeleton, StructureIndexer
from backend.graph.graph_schema import GraphEdge, GraphNode, NodeType, EdgeType
from backend.models.static_analysis import (
    ConfidenceLevel,
    FileInfo,
    FrameworkPattern,
    StaticAnalysisResult,
)
from backend.pipeline.observer import AnalysisObserver, StageStarted, StageCompleted
from backend.pipeline.stages.base import StageBase

logger = logging.getLogger(__name__)

# AST 解析 Worker 数量（CPU-bound）
MAX_WORKERS = 4


class DeepStaticAnalysisStage(StageBase):
    """Stage 1: 深度静态分析。

    与旧 StructureParseStage 的区别：
    1. 产出分为 A/B 两类（持久 vs 临时）
    2. 使用 ProcessPoolExecutor 并行 AST 解析
    3. 构建 import_graph 和 framework_patterns
    4. 生成 GraphNode/GraphEdge（含置信度）
    """

    name = "deep_static_analysis"

    def __init__(
        self,
        max_workers: int = MAX_WORKERS,
        use_process_pool: bool = False,
    ):
        """
        Args:
            max_workers: 并行 Worker 数量
            use_process_pool: 是否使用 ProcessPoolExecutor（默认 False 用 ThreadPoolExecutor）
                注意：macOS 上 spawn 方式的子进程不继承 sys.path，ProcessPoolExecutor 会
                导致 ModuleNotFoundError: No module named 'backend'，因此默认禁用。
        """
        self.max_workers = max_workers
        self.use_process_pool = use_process_pool

    def run(
        self,
        repo_path: Path,
        all_files: dict[str, FileInfo],
        changed_files: set[str] | None = None,
        observer: AnalysisObserver | None = None,
        on_progress: Callable[[dict], None] | None = None,
    ) -> StaticAnalysisResult:
        """执行深度静态分析。

        Args:
            repo_path: 仓库根目录
            all_files: 文件元数据字典（Stage 0 输出）
            changed_files: 变更文件集合（增量模式，仅解析这些文件）
            observer: 事件观察器
            on_progress: 进度回调

        Returns:
            StaticAnalysisResult: 包含 A/B 两类产出
        """
        start_time = time.time()

        # 发送开始事件
        if observer:
            observer.emit(StageStarted.create("deep_static_analysis", file_count=len(all_files)))

        if on_progress:
            on_progress(
                {"step": "deep_static_analysis", "status": "start", "message": "深度静态分析..."}
            )

        # 确定要解析的文件（增量 vs 全量）
        if changed_files:
            files_to_parse = {
                p: f for p, f in all_files.items()
                if p in changed_files
            }
            logger.info("增量模式: 解析 %d 个变更文件", len(files_to_parse))
        else:
            files_to_parse = all_files

        # Step 1: 并行 AST 解析
        file_skeletons = self._parse_files_parallel(repo_path, files_to_parse)

        # Step 2: 构建 import_graph
        import_graph = self._build_import_graph(file_skeletons)

        # Step 3: 检测框架模式（Spring）
        framework_patterns = self._detect_framework_patterns(file_skeletons, repo_path)

        # Step 4: 生成结构节点和边
        structural_nodes, structural_edges, low_confidence_edges = self._build_graph_elements(
            file_skeletons, import_graph
        )

        # Step 5: 提取调用图边（calls 类型）
        call_edges = self._extract_call_edges(repo_path, files_to_parse, file_skeletons, structural_nodes)
        structural_edges.extend(call_edges)
        if call_edges:
            logger.info("调用图提取: %d calls 边", len(call_edges))

        elapsed_ms = int((time.time() - start_time) * 1000)

        # 发送完成事件
        if observer:
            observer.emit(
                StageCompleted.create("deep_static_analysis", elapsed_ms, cache_hit=False)
            )

        msg = f"深度静态分析完成: {len(structural_nodes)} 节点, {len(structural_edges)} 边"
        if low_confidence_edges:
            msg += f" | {len(low_confidence_edges)} 低置信度边"

        logger.info("Stage 1 完成: %s", msg)
        if on_progress:
            on_progress(
                {
                    "step": "deep_static_analysis",
                    "status": "complete",
                    "message": msg,
                    "nodes": len(structural_nodes),
                    "edges": len(structural_edges),
                    "low_confidence": len(low_confidence_edges),
                }
            )

        return StaticAnalysisResult(
            structural_nodes=structural_nodes,
            structural_edges=structural_edges,
            import_graph=import_graph,
            framework_patterns=framework_patterns,
            low_confidence_edges=low_confidence_edges,
            parse_warnings=[],
        )

    def _parse_files_parallel(
        self,
        repo_path: Path,
        files: dict[str, FileInfo],
    ) -> dict[str, FileSkeleton]:
        """并行解析文件，返回文件骨架映射。"""
        indexer = StructureIndexer(depth="standard")

        if not files:
            return {}

        # 单 Worker 或少量文件时直接串行解析
        if self.max_workers <= 1 or len(files) <= 10:
            indexer.build_index_from_files(repo_path, list(files.keys()))
            return indexer._index.copy()

        # 并行解析
        file_paths = list(files.keys())
        results: dict[str, FileSkeleton] = {}

        executor_class = ProcessPoolExecutor if self.use_process_pool else concurrent.futures.ThreadPoolExecutor

        # 分批处理（避免 IPC 过大）
        batch_size = 100
        for i in range(0, len(file_paths), batch_size):
            batch = file_paths[i:i + batch_size]

            with executor_class(max_workers=self.max_workers) as executor:
                # 提交解析任务
                future_to_path = {
                    executor.submit(_parse_single_file, repo_path, p): p
                    for p in batch
                }

                # 收集结果
                for future in concurrent.futures.as_completed(future_to_path):
                    path = future_to_path[future]
                    try:
                        skeleton = future.result()
                        if skeleton:
                            results[path] = skeleton
                    except Exception as e:
                        logger.warning("解析文件失败 %s: %s", path, e)

        return results

    def _build_import_graph(
        self,
        skeletons: dict[str, FileSkeleton],
    ) -> dict[str, list[str]]:
        """构建导入图。

        Returns:
            {source_file: [imported_file1, imported_file2, ...]}
        """
        import_graph: dict[str, list[str]] = {}

        for path, skeleton in skeletons.items():
            if skeleton.top_imports:
                # 简化处理：只记录 import 语句，不解析实际路径
                import_graph[path] = skeleton.top_imports

        return import_graph

    def _detect_framework_patterns(
        self,
        skeletons: dict[str, FileSkeleton],
        repo_path: Path,
    ) -> list[FrameworkPattern]:
        """检测框架模式（Spring DI/Event/Kafka）。"""
        patterns: list[FrameworkPattern] = []

        # Spring 注解检测
        spring_annotations = {
            "@Service": "di",
            "@Component": "di",
            "@Repository": "di",
            "@Controller": "di",
            "@RestController": "di",
            "@Configuration": "di",
            "@Autowired": "di",
            "@Inject": "di",
            "@Qualifier": "di",
            "@Primary": "di",
            "@EventListener": "event",
            "@TransactionalEventListener": "event",
            "@KafkaListener": "kafka_consume",
        }

        for path, skeleton in skeletons.items():
            # 只处理 Java 文件
            if skeleton.language != "java":
                continue

            for cls in skeleton.classes:
                # 检查类级注解
                for ann in cls.annotations:
                    pattern_type = spring_annotations.get(ann)
                    if pattern_type:
                        patterns.append(FrameworkPattern(
                            pattern_type=pattern_type,
                            source_file=path,
                            source_element=cls.name,
                            target_hint=None,
                            raw_code=f"{ann} class {cls.name}",
                            line_number=cls.line_start,
                            confidence=ConfidenceLevel.FRAMEWORK_PATTERN,
                        ))

                # 检查方法级注解（如 @KafkaListener）
                for method in cls.methods:
                    for ann in method.annotations:
                        pattern_type = spring_annotations.get(ann)
                        if pattern_type:
                            patterns.append(FrameworkPattern(
                                pattern_type=pattern_type,
                                source_file=path,
                                source_element=f"{cls.name}.{method.name}",
                                target_hint=None,
                                raw_code=f"{ann} {method.signature}",
                                line_number=method.line_start,
                                confidence=ConfidenceLevel.FRAMEWORK_PATTERN,
                            ))

        logger.info("检测到 %d 个框架模式", len(patterns))
        return patterns

    def _build_graph_elements(
        self,
        skeletons: dict[str, FileSkeleton],
        import_graph: dict[str, list[str]],
    ) -> tuple[list[GraphNode], list[GraphEdge], list[GraphEdge]]:
        """生成 GraphNode 和 GraphEdge。

        Returns:
            (structural_nodes, structural_edges, low_confidence_edges)
        """
        nodes: list[GraphNode] = []
        edges: list[GraphEdge] = []
        low_confidence_edges: list[GraphEdge] = []

        for path, skeleton in skeletons.items():
            # 为每个类创建节点
            for cls in skeleton.classes:
                node_id = f"class:{path}:{cls.name}"

                # 判断节点类型
                node_type = self._infer_node_type(cls)

                node = GraphNode(
                    id=node_id,
                    type=node_type,
                    name=cls.name,
                    properties={
                        "file": path,
                        "class_type": cls.class_type,
                        "annotations": cls.annotations,
                        "base_classes": cls.base_classes,
                        "line": cls.line_start,
                        "source": "static",
                        "confidence": ConfidenceLevel.ANNOTATION_DRIVEN if cls.annotations else ConfidenceLevel.DIRECT_IMPORT,
                    },
                )
                nodes.append(node)

                # 为每个公共方法创建节点
                for method in cls.methods:
                    if method.visibility != "public":
                        continue

                    method_id = f"function:{path}:{cls.name}.{method.name}"
                    method_node = GraphNode(
                        id=method_id,
                        type=NodeType.FUNCTION.value,
                        name=method.name,
                        properties={
                            "file": path,
                            "class": cls.name,
                            "signature": method.signature,
                            "annotations": method.annotations,
                            "line": method.line_start,
                            "source": "static",
                            "confidence": ConfidenceLevel.ANNOTATION_DRIVEN if method.annotations else ConfidenceLevel.DIRECT_IMPORT,
                        },
                    )
                    nodes.append(method_node)

                    # 类包含方法的边
                    edge = GraphEdge(
                        from_=node_id,
                        to=method_id,
                        type=EdgeType.CONTAINS.value,
                        properties={
                            "source": "static",
                            "confidence": ConfidenceLevel.DIRECT_IMPORT,
                        },
                    )
                    edges.append(edge)

        # 基于导入图生成 depends_on 边
        for source_file, imports in import_graph.items():
            for imp in imports[:10]:  # 最多处理前 10 个 import
                # 简化处理：只记录 import 语句，实际路径解析需要更复杂的逻辑
                pass  # TODO: 在后续迭代中实现完整的导入图边生成

        return nodes, edges, low_confidence_edges

    def _extract_call_edges(
        self,
        repo_path: Path,
        files: dict[str, FileInfo],
        skeletons: dict[str, FileSkeleton],
        structural_nodes: list,
    ) -> list[GraphEdge]:
        """从源文件中静态提取 calls 类型边。

        只处理 Java 和 Python 文件（其他语言暂无 AST 支持）。
        callee 必须已在 structural_nodes 中（即 public 方法节点），否则忽略。
        """
        from backend.pipeline.stages.call_graph_extractor import extract_file_calls

        # 构建已知函数节点 ID 集合（仅 function 节点）
        node_ids: set[str] = {
            n.id for n in structural_nodes if n.type == "Function"
        }
        if not node_ids:
            return []

        # 构建类名 -> 文件路径映射（用于跨文件调用解析）
        class_to_file: dict[str, str] = {}
        for rel_path, skeleton in skeletons.items():
            for cls in skeleton.classes:
                class_to_file[cls.name] = rel_path

        call_edges: list[GraphEdge] = []

        for rel_path, file_info in files.items():
            lang = file_info.language.lower() if file_info.language else ""
            if lang not in ("java", "python"):
                continue

            skeleton = skeletons.get(rel_path)
            if not skeleton or not skeleton.classes:
                continue  # 跳过无类定义的文件（减少无效解析）

            try:
                source = (repo_path / rel_path).read_text(
                    encoding="utf-8", errors="replace"
                )
            except OSError as exc:
                logger.debug("无法读取文件: %s — %s", rel_path, exc)
                continue

            raw_calls = extract_file_calls(
                source, rel_path, lang, node_ids, class_to_file
            )
            for caller_id, callee_id, confidence in raw_calls:
                call_edges.append(GraphEdge(
                    from_=caller_id,
                    to=callee_id,
                    type=EdgeType.CALLS.value,
                    properties={"source": "static", "confidence": confidence},
                ))

        return call_edges

    def _infer_node_type(self, cls: ClassInfo) -> str:
        """根据类注解推断节点类型。"""
        ann_set = set(cls.annotations)

        if "@RestController" in ann_set or "@Controller" in ann_set:
            return NodeType.COMPONENT.value
        if "@Service" in ann_set:
            return NodeType.SERVICE.value
        if "@Repository" in ann_set:
            return NodeType.SERVICE.value
        if "@Configuration" in ann_set:
            return NodeType.COMPONENT.value
        if cls.class_type == "interface":
            return NodeType.CLASS.value

        return NodeType.CLASS.value


def _parse_single_file(repo_path: Path, rel_path: str) -> FileSkeleton | None:
    """解析单个文件（用于 ProcessPoolExecutor）。"""
    try:
        file_path = repo_path / rel_path
        if not file_path.exists():
            return None

        suffix = file_path.suffix.lower()
        indexer = StructureIndexer(depth="standard")

        if suffix == ".java":
            skeleton = indexer._scan_java(file_path)
        elif suffix == ".py":
            skeleton = indexer._scan_python(file_path)
        else:
            skeleton = indexer._scan_generic(file_path)

        if skeleton:
            skeleton.relative_path = rel_path

        return skeleton
    except Exception as e:
        logger.warning("解析文件失败 %s: %s", rel_path, e)
        return None
