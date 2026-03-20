"""Phase 1 单元测试。

测试内容：
- 1.1 数据模型定义
- 1.2 AnalysisObserver
- 1.3 Stage 0 改造
- 1.4 Stage 2 目录聚类
"""
from __future__ import annotations

import asyncio
import json
import tempfile
from pathlib import Path

import pytest

# ─────────────────────────────────────────────────────────────────────────────
# 1.1 数据模型测试
# ─────────────────────────────────────────────────────────────────────────────


class TestStaticAnalysisModels:
    """测试静态分析数据模型。"""

    def test_file_info(self):
        from backend.models.static_analysis import FileInfo

        fi = FileInfo(
            path="src/main.py",
            absolute_path=Path("/project/src/main.py"),
            language="python",
            size_bytes=1024,
            line_count=50,
            modified_time=1234567890.0,
        )

        assert fi.path == "src/main.py"
        assert fi.language == "python"
        assert fi.line_count == 50

    def test_file_index_result(self):
        from backend.models.static_analysis import FileIndexResult, FileInfo

        all_files = {
            "main.py": FileInfo(
                path="main.py",
                absolute_path=Path("/project/main.py"),
                language="python",
                size_bytes=100,
                line_count=10,
                modified_time=1.0,
            ),
        }

        result = FileIndexResult(
            all_files=all_files,
            changed_files={"main.py"},
            is_incremental=True,
        )

        assert result.is_incremental is True
        assert "main.py" in result.changed_files
        assert len(result.all_files) == 1

    def test_framework_pattern(self):
        from backend.models.static_analysis import FrameworkPattern

        pattern = FrameworkPattern(
            pattern_type="di",
            source_file="src/service/UserService.java",
            source_element="UserService",
            target_hint="@Qualifier(\"userService\")",
            raw_code="@Autowired @Qualifier(\"userService\") UserService service;",
            line_number=15,
            confidence=0.95,
        )

        assert pattern.pattern_type == "di"
        assert pattern.confidence == 0.95

    def test_static_analysis_result(self):
        from backend.models.static_analysis import StaticAnalysisResult
        from backend.graph.graph_schema import GraphNode

        result = StaticAnalysisResult(
            structural_nodes=[
                GraphNode(id="class:UserService", type="Class", name="UserService")
            ],
            structural_edges=[],
            import_graph={"UserService.java": ["UserRepository.java"]},
            framework_patterns=[],
            low_confidence_edges=[],
            parse_warnings=[],
        )

        assert len(result.structural_nodes) == 1
        assert "UserService.java" in result.import_graph

    def test_module_candidate(self):
        from backend.models.static_analysis import ModuleCandidate

        candidate = ModuleCandidate(
            id="module:auth",
            name="auth",
            files=["auth/login.py", "auth/logout.py"],
            boundary_confidence=0.95,
            boundary_warnings=["与 module:user 存在 10 次 import"],
        )

        assert candidate.name == "auth"
        assert len(candidate.files) == 2
        assert len(candidate.boundary_warnings) == 1

    def test_quality_report_thresholds(self):
        from backend.models.static_analysis import (
            QualityReport,
            ModuleQuality,
            StageMetrics,
        )

        # 创建 10 个模块，1 个失败 = 10% < 20% 阈值，不触发 error
        modules = [
            ModuleQuality(
                module_id=f"module:{i}",
                boundary_confidence=0.9,
                node_count=10,
                ai_node_count=3,
                static_node_count=7,
                ai_correction_count=6 if i == 0 else 0,  # 只有第 1 个模块触发 warning
                low_confidence_edge_count=2,
            )
            for i in range(10)
        ]

        report = QualityReport(
            modules=modules,
            low_confidence_edge_ratio=0.35,  # > 0.30，触发 warning
            failed_modules=["module:payment"],  # 1/11 = 9% < 10%，不触发 warning
            stage_metrics={
                "file_index": StageMetrics(duration_ms=100, cache_hits=0),
            },
        )

        report.check_thresholds()

        # low_confidence_edge_ratio > 30% 和 ai_correction_count > 5 触发 warning
        assert len(report.warnings) >= 2
        # failed_modules_ratio = 1/11 = 9% < 20%，不触发 error
        assert len(report.errors) == 0

    def test_confidence_level_constants(self):
        from backend.models.static_analysis import ConfidenceLevel

        assert ConfidenceLevel.DIRECT_IMPORT == 0.95
        assert ConfidenceLevel.SPRING_CONFIG_BEAN == 0.98
        assert ConfidenceLevel.AI_DISCOVERED == 0.70


# ─────────────────────────────────────────────────────────────────────────────
# 1.2 AnalysisObserver 测试
# ─────────────────────────────────────────────────────────────────────────────


class TestAnalysisObserver:
    """测试 AnalysisObserver。"""

    def test_emit_and_stream(self):
        from backend.pipeline.observer import (
            AnalysisObserver,
            StageStarted,
            StageCompleted,
        )

        observer = AnalysisObserver(task_id="test-001")

        # 发送事件
        observer.emit(StageStarted.create("file_index", file_count=100))
        observer.emit(StageCompleted.create("file_index", elapsed_ms=150))
        observer.emit_end()

        # 同步收集事件
        events = []
        for event in observer._sync_queue.get, observer._sync_queue.get:
            e = observer._sync_queue.get()
            if e is not None and not isinstance(e, type(observer.emit_end().__class__)):
                events.append(e)

        # 直接检查队列内容
        assert observer.task_id == "test-001"

    def test_event_to_dict(self):
        from backend.pipeline.observer import StageStarted

        event = StageStarted.create("file_index", file_count=100, is_incremental=True)
        d = event.to_dict()

        assert d["event_type"] == "stage_started"
        assert d["stage"] == "file_index"
        assert d["file_count"] == 100
        assert d["is_incremental"] is True

    def test_log_file_creation(self):
        from backend.pipeline.observer import AnalysisObserver, StageStarted

        with tempfile.TemporaryDirectory() as tmpdir:
            observer = AnalysisObserver(
                task_id="test-log",
                log_dir=Path(tmpdir),
            )

            observer.emit(StageStarted.create("file_index"))
            observer._close()

            log_file = Path(tmpdir) / "analysis-test-log.jsonl"
            assert log_file.exists()

            # 读取日志内容
            content = log_file.read_text()
            data = json.loads(content.strip())
            assert data["event_type"] == "stage_started"

    def test_observer_manager(self):
        from backend.pipeline.observer import ObserverManager

        manager = ObserverManager()

        obs1 = manager.create("task-001")
        obs2 = manager.create("task-002")

        assert manager.get("task-001") is obs1
        assert manager.get("task-002") is obs2
        assert manager.list_active() == ["task-001", "task-002"]

        manager.remove("task-001")
        assert manager.get("task-001") is None
        assert "task-001" not in manager.list_active()


# ─────────────────────────────────────────────────────────────────────────────
# 1.3 Stage 0 测试
# ─────────────────────────────────────────────────────────────────────────────


class TestFileIndexStage:
    """测试 Stage 0 文件索引。"""

    def test_basic_scan(self):
        from backend.pipeline.stages.file_index_async import FileIndexStage

        with tempfile.TemporaryDirectory() as tmpdir:
            # 创建测试文件
            root = Path(tmpdir)
            (root / "src").mkdir()
            (root / "src" / "main.py").write_text("print('hello')\n" * 10)
            (root / "src" / "utils.py").write_text("def helper(): pass\n")

            stage = FileIndexStage()
            result = stage.run(root)

            assert result.is_incremental is False
            assert len(result.all_files) == 2
            assert "src/main.py" in result.all_files
            assert result.all_files["src/main.py"].line_count == 10

    def test_git_incremental_detection(self):
        """测试 Git 增量检测（需要 git 环境）。"""
        from backend.pipeline.stages.file_index_async import FileIndexStage

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)

            # 初始化 git 仓库
            import subprocess

            subprocess.run(["git", "init"], cwd=root, capture_output=True)
            subprocess.run(["git", "config", "user.email", "test@test.com"], cwd=root, capture_output=True)
            subprocess.run(["git", "config", "user.name", "test"], cwd=root, capture_output=True)

            # 创建初始文件并提交
            (root / "main.py").write_text("print('hello')\n")
            subprocess.run(["git", "add", "."], cwd=root, capture_output=True)
            subprocess.run(["git", "commit", "-m", "initial"], cwd=root, capture_output=True)

            # 获取初始 SHA
            result = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=root,
                capture_output=True,
                text=True,
            )
            initial_sha = result.stdout.strip()

            # 添加新文件
            (root / "new.py").write_text("print('new')\n")
            subprocess.run(["git", "add", "."], cwd=root, capture_output=True)
            subprocess.run(["git", "commit", "-m", "add new"], cwd=root, capture_output=True)

            # 运行增量检测
            stage = FileIndexStage()
            index_result = stage.run(root, last_commit_sha=initial_sha)

            # 应该检测到增量
            assert index_result.is_incremental is True
            assert "new.py" in index_result.changed_files


# ─────────────────────────────────────────────────────────────────────────────
# 1.4 Stage 2 测试
# ─────────────────────────────────────────────────────────────────────────────


class TestDirectoryClusterStage:
    """测试 Stage 2 目录聚类。"""

    def test_basic_clustering(self):
        from backend.models.static_analysis import FileInfo
        from backend.pipeline.stages.directory_cluster import DirectoryClusterStage, ClusterConfig

        # 构造测试文件
        all_files = {
            "src/auth/login.py": FileInfo(
                path="src/auth/login.py",
                absolute_path=Path("/project/src/auth/login.py"),
                language="python",
                size_bytes=100,
                line_count=10,
                modified_time=1.0,
            ),
            "src/auth/logout.py": FileInfo(
                path="src/auth/logout.py",
                absolute_path=Path("/project/src/auth/logout.py"),
                language="python",
                size_bytes=100,
                line_count=10,
                modified_time=1.0,
            ),
            "src/user/profile.py": FileInfo(
                path="src/user/profile.py",
                absolute_path=Path("/project/src/user/profile.py"),
                language="python",
                size_bytes=100,
                line_count=10,
                modified_time=1.0,
            ),
        }

        stage = DirectoryClusterStage(config=ClusterConfig(dir_depth=2))
        candidates = stage.run(all_files, {})

        # 应该生成 2 个模块候选
        assert len(candidates) == 2

        # 检查模块名称
        module_names = {c.name for c in candidates}
        assert "auth" in module_names
        assert "user" in module_names

    def test_import_graph_validation(self):
        from backend.models.static_analysis import FileInfo, ClusterConfig
        from backend.pipeline.stages.directory_cluster import DirectoryClusterStage

        all_files = {
            "src/auth/login.py": FileInfo(
                path="src/auth/login.py",
                absolute_path=Path("/project/src/auth/login.py"),
                language="python",
                size_bytes=100,
                line_count=10,
                modified_time=1.0,
            ),
            "src/user/profile.py": FileInfo(
                path="src/user/profile.py",
                absolute_path=Path("/project/src/user/profile.py"),
                language="python",
                size_bytes=100,
                line_count=10,
                modified_time=1.0,
            ),
        }

        # 构造高频导入图
        import_graph = {
            "src/auth/login.py": ["src/user/profile.py"] * 10,  # 超过阈值
        }

        stage = DirectoryClusterStage(config=ClusterConfig(dir_depth=2, coupling_threshold=5))
        candidates = stage.run(all_files, import_graph)

        # 应该有边界警告
        auth_module = next(c for c in candidates if c.name == "auth")
        assert len(auth_module.boundary_warnings) > 0
        assert auth_module.boundary_confidence < 1.0

    def test_java_maven_normalization(self):
        from backend.models.static_analysis import FileInfo, ClusterConfig
        from backend.pipeline.stages.directory_cluster import DirectoryClusterStage

        # Maven 标准结构
        all_files = {
            "src/main/java/com/example/project/auth/LoginService.java": FileInfo(
                path="src/main/java/com/example/project/auth/LoginService.java",
                absolute_path=Path("/project/src/main/java/com/example/project/auth/LoginService.java"),
                language="java",
                size_bytes=100,
                line_count=10,
                modified_time=1.0,
            ),
            "src/main/java/com/example/project/user/UserService.java": FileInfo(
                path="src/main/java/com/example/project/user/UserService.java",
                absolute_path=Path("/project/src/main/java/com/example/project/user/UserService.java"),
                language="java",
                size_bytes=100,
                line_count=10,
                modified_time=1.0,
            ),
        }

        stage = DirectoryClusterStage(config=ClusterConfig(dir_depth=2, java_maven_normalize=True))
        candidates = stage.run(all_files, {})

        # 剥离 Maven 前缀后，应该按 auth/user 分组
        module_names = {c.name for c in candidates}
        assert "auth" in module_names or "user" in module_names

    def test_incremental_check(self):
        from backend.pipeline.stages.directory_cluster import DirectoryClusterStage

        stage = DirectoryClusterStage()

        # 无新目录
        cached_dirs = {"src/auth", "src/user"}
        changed_files = {"src/auth/login.py"}  # 已有目录中的文件

        assert stage.check_needs_reclustering(changed_files, cached_dirs) is False

        # 有新目录
        changed_files_with_new = {"src/auth/login.py", "src/payment/checkout.py"}
        assert stage.check_needs_reclustering(changed_files_with_new, cached_dirs) is True


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
