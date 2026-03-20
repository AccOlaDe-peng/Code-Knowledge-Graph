"""Stage 2: 目录聚类 → 模块候选（零 LLM，纯算法）。

按目录层级聚类，使用导入图验证边界，产出可复现的模块候选列表。
"""
from __future__ import annotations

import logging
import re
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from backend.models.static_analysis import (
    ClusterConfig,
    FileInfo,
    ModuleCandidate,
)
from backend.pipeline.observer import AnalysisObserver, StageStarted, StageCompleted
from backend.pipeline.stages.base import StageBase

logger = logging.getLogger(__name__)


# 预设配置
CLUSTER_PRESETS: dict[str, ClusterConfig] = {
    "small": ClusterConfig(
        dir_depth=2,
        coupling_threshold=3,
    ),
    "medium": ClusterConfig(
        dir_depth=2,
        coupling_threshold=5,
    ),
    "large": ClusterConfig(
        dir_depth=3,
        coupling_threshold=8,
    ),
    "large_java": ClusterConfig(
        dir_depth=2,
        coupling_threshold=8,
        java_maven_normalize=True,
    ),
}


class DirectoryClusterStage(StageBase):
    """Stage 2: 目录聚类（零 LLM）。

    算法：
    1. 目录层级聚类（主信号）— 按配置深度切割，每个子目录 = 一个模块候选
    2. 导入图验证（辅助信号）— 扫描模块间 import 密度，标记 boundary_warnings
    """

    name = "directory_cluster"

    def __init__(
        self,
        config: ClusterConfig | None = None,
        preset: str = "medium",
    ):
        """
        Args:
            config: 聚类配置（优先）
            preset: 预设名称（small/medium/large/large_java），config 为空时使用
        """
        if config:
            self.config = config
        else:
            self.config = CLUSTER_PRESETS.get(preset, CLUSTER_PRESETS["medium"])

    def run(
        self,
        all_files: dict[str, FileInfo],
        import_graph: dict[str, list[str]],
        observer: AnalysisObserver | None = None,
        on_progress: Callable[[dict], None] | None = None,
    ) -> list[ModuleCandidate]:
        """执行目录聚类。

        Args:
            all_files: 文件元数据字典（Stage 0 输出）
            import_graph: 导入图（Stage 1 产出 B）
            observer: 事件观察器
            on_progress: 进度回调

        Returns:
            模块候选列表
        """
        import time

        start_time = time.time()

        # 发送开始事件
        if observer:
            observer.emit(StageStarted.create("directory_cluster", file_count=len(all_files)))

        if on_progress:
            on_progress(
                {"step": "directory_cluster", "status": "start", "message": "目录聚类..."}
            )

        # Step 1: 目录层级聚类
        candidates = self._cluster_by_directory(all_files)

        # Step 2: 导入图验证
        candidates = self._validate_with_import_graph(candidates, import_graph)

        elapsed_ms = int((time.time() - start_time) * 1000)

        # 发送完成事件
        if observer:
            observer.emit(
                StageCompleted.create("directory_cluster", elapsed_ms, cache_hit=False)
            )

        msg = f"目录聚类完成: {len(candidates)} 个模块候选"
        warning_count = sum(1 for c in candidates if c.boundary_warnings)
        if warning_count:
            msg += f" | {warning_count} 个模块有边界警告"

        logger.info("Stage 2 完成: %s", msg)
        if on_progress:
            on_progress(
                {
                    "step": "directory_cluster",
                    "status": "complete",
                    "message": msg,
                    "modules": len(candidates),
                    "warnings": warning_count,
                }
            )

        return candidates

    def _cluster_by_directory(self, all_files: dict[str, FileInfo]) -> list[ModuleCandidate]:
        """Step 1: 目录层级聚类。"""
        # 收集所有目录
        dir_to_files: dict[str, list[str]] = defaultdict(list)

        for rel_path in all_files.keys():
            # 判断是否跳过目录
            parts = Path(rel_path).parts
            if any(skip in parts for skip in self.config.skip_dirs):
                continue

            # 计算聚类目录深度
            cluster_dir = self._get_cluster_dir(rel_path)
            if cluster_dir:
                dir_to_files[cluster_dir].append(rel_path)

        # 构建模块候选
        candidates: list[ModuleCandidate] = []
        for dir_path, files in sorted(dir_to_files.items()):
            if not files:
                continue

            # 模块名称：取最后一段目录名
            module_name = Path(dir_path).name if dir_path else "root"

            candidates.append(ModuleCandidate(
                id=f"module:{module_name}",
                name=module_name,
                files=files,
                boundary_confidence=1.0,  # 目录聚类默认高置信度
                boundary_warnings=[],
            ))

        return candidates

    def _get_cluster_dir(self, rel_path: str) -> str:
        """根据配置计算文件所属的聚类目录。

        特殊处理 Java/Maven 项目：剥离 src/main/java/{package_prefix}/ 前缀。
        """
        parts = Path(rel_path).parts

        if not parts:
            return ""

        # Java/Maven 目录规范化
        if self.config.java_maven_normalize:
            normalized = self._normalize_java_maven_path(parts)
            if normalized is not None:
                parts = normalized

        # 按配置深度切割
        depth = min(self.config.dir_depth, len(parts) - 1)  # -1 排除文件名
        if depth <= 0:
            return ""

        return str(Path(*parts[:depth]))

    def _normalize_java_maven_path(self, parts: tuple[str, ...]) -> tuple[str, ...] | None:
        """规范化 Java/Maven 项目路径。

        Maven 标准结构：src/main/java/com/example/project/module/...
        目标：剥离 src/main/java/com/example/project，保留 module/...

        检测策略：
        1. 查找 src/main/java 或 src/test/java
        2. 剥离前缀后，取剩余路径
        """
        # 查找 src/main/java 或 src/test/java
        java_src_prefix = ("src", "main", "java")
        java_test_prefix = ("src", "test", "java")

        # 查找前缀位置
        prefix_len = 0
        for i in range(len(parts) - 2):
            if parts[i:i+3] == java_src_prefix or parts[i:i+3] == java_test_prefix:
                prefix_len = i + 3
                break

        if prefix_len == 0:
            return None  # 不是 Maven 结构

        # 剥离前缀 + 包名前缀（通常 2-3 段，如 com/example）
        remaining = parts[prefix_len:]
        if len(remaining) <= 3:
            return None  # 包名太短，无法剥离

        # 尝试剥离 com/example 或 org/example 等常见前缀
        # 策略：跳过前两段（假设是反向域名）
        if len(remaining) > 4:
            # 检查是否是标准反向域名格式
            first_part = remaining[0]
            if first_part in ("com", "org", "io", "net", "dev", "cn"):
                # 跳过反向域名（2 段）和可能的项目名（1 段）
                return remaining[3:]

        return remaining

    def _validate_with_import_graph(
        self,
        candidates: list[ModuleCandidate],
        import_graph: dict[str, list[str]],
    ) -> list[ModuleCandidate]:
        """Step 2: 导入图验证，标记跨目录强耦合。"""
        if not import_graph:
            return candidates

        # 构建文件 -> 模块映射
        file_to_module: dict[str, str] = {}
        for c in candidates:
            for f in c.files:
                file_to_module[f] = c.id

        # 统计模块间 import 密度
        # coupling[(module_a, module_b)] = import_count
        coupling: dict[tuple[str, str], int] = defaultdict(int)

        for source_file, imported_files in import_graph.items():
            source_module = file_to_module.get(source_file)
            if not source_module:
                continue

            for target_file in imported_files:
                target_module = file_to_module.get(target_file)
                if not target_module or target_module == source_module:
                    continue

                key = (source_module, target_module)
                coupling[key] += 1

        # 标记强耦合警告
        for (m1, m2), count in coupling.items():
            if count > self.config.coupling_threshold:
                warning = f"与 {m2} 之间存在 {count} 次 import（阈值 {self.config.coupling_threshold}）"

                for c in candidates:
                    if c.id == m1:
                        c.boundary_warnings.append(warning)
                        # 降低边界置信度
                        c.boundary_confidence = min(c.boundary_confidence, 0.85)
                    elif c.id == m2:
                        c.boundary_warnings.append(f"与 {m1} 之间存在 {count} 次 import")
                        c.boundary_confidence = min(c.boundary_confidence, 0.85)

        return candidates

    # ── 增量模式支持 ─────────────────────────────────────────────────────────────

    def check_needs_reclustering(
        self,
        changed_files: set[str],
        cached_dir_set: set[str],
    ) -> bool:
        """检查是否需要重新聚类。

        Args:
            changed_files: 变更文件集合
            cached_dir_set: 上次缓存的目录集合

        Returns:
            True 表示需要重新聚类
        """
        if not cached_dir_set:
            return True

        # 计算变更文件所在目录
        new_dirs = {str(Path(f).parent) for f in changed_files}

        # 检查是否有新目录
        has_new_dirs = bool(new_dirs - cached_dir_set)

        if has_new_dirs:
            logger.info(
                "发现新目录，需要重新聚类: %s",
                new_dirs - cached_dir_set,
            )
        else:
            logger.info("无新目录，可跳过重新聚类")

        return has_new_dirs

    def extract_dir_set(self, candidates: list[ModuleCandidate]) -> set[str]:
        """从模块候选中提取目录集合（用于增量缓存）。"""
        dir_set: set[str] = set()
        for c in candidates:
            for f in c.files:
                dir_set.add(str(Path(f).parent))
        return dir_set
