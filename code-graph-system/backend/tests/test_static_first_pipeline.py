"""静态优先流水线测试。

测试内容：
- Stage 1 FileIndex
- Stage 2 DeepStaticAnalysis
- Stage 3 + Stage 4a 并行执行
- Stage 3b AISemanticEnhance
- Stage 4b SpringDIEventAI
- Stage 5 GraphMerge
- 完整流水线集成测试
"""
from __future__ import annotations

import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest


# ─────────────────────────────────────────────────────────────────────────────
# Stage 集成测试
# ─────────────────────────────────────────────────────────────────────────────


class TestStaticFirstPipelineIntegration:
    """静态优先流水线集成测试。"""

    def test_stage1_file_index(self):
        """测试 Stage 1 文件索引。"""
        from backend.pipeline.stages.file_index_async import FileIndexStage
        from backend.models.static_analysis import FileInfo

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)

            # 创建测试文件
            (root / "src").mkdir()
            (root / "src" / "main.py").write_text("print('hello')")
            (root / "src" / "utils.py").write_text("def helper(): pass")

            stage = FileIndexStage()
            result = stage.run(root)

            assert len(result.all_files) >= 2
            assert not result.is_incremental
            assert all(isinstance(f, FileInfo) for f in result.all_files.values())

    def test_stage2_deep_static_analysis(self):
        """测试 Stage 2 深度静态分析。"""
        from backend.pipeline.stages.deep_static_analysis import DeepStaticAnalysisStage
        from backend.models.static_analysis import FileInfo

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)

            # 创建 Python 文件
            (root / "service.py").write_text("""
class UserService:
    def get_user(self, user_id):
        return user_id

    def create_user(self, name):
        return {"name": name}
""")

            all_files = {
                "service.py": FileInfo(
                    path="service.py",
                    absolute_path=root / "service.py",
                    language="python",
                    size_bytes=200,
                    line_count=10,
                    modified_time=1.0,
                ),
            }

            stage = DeepStaticAnalysisStage(max_workers=1)
            result = stage.run(root, all_files)

            # 应该有类节点
            assert len(result.structural_nodes) >= 1
            # import_graph 可能为空
            assert result.import_graph is not None
            # framework_patterns 可能为空
            assert result.framework_patterns is not None

    def test_stage3_directory_cluster(self):
        """测试 Stage 3 目录聚类。"""
        from backend.pipeline.stages.directory_cluster import DirectoryClusterStage
        from backend.models.static_analysis import StaticAnalysisResult, ModuleCandidate, FileInfo

        # 创建模拟的文件信息和导入图
        all_files = {
            "src/service.py": FileInfo(
                path="src/service.py",
                absolute_path="/tmp/src/service.py",
                language="python",
                size_bytes=100,
                line_count=10,
                modified_time=1.0,
            ),
            "src/repo.py": FileInfo(
                path="src/repo.py",
                absolute_path="/tmp/src/repo.py",
                language="python",
                size_bytes=100,
                line_count=10,
                modified_time=1.0,
            ),
        }

        import_graph = {
            "src/service.py": ["src/repo.py"],
            "src/repo.py": [],
        }

        stage = DirectoryClusterStage()
        candidates = stage.run(all_files, import_graph)

        # 应该返回模块候选列表
        assert isinstance(candidates, list)
        # 每个候选都是 ModuleCandidate
        for c in candidates:
            assert isinstance(c, ModuleCandidate)

    def test_stage4a_spring_di_event_static(self):
        """测试 Stage 4a Spring DI/Event 静态解析。"""
        from backend.pipeline.stages.spring_di_event_static import SpringDIEventStaticStage
        from backend.models.static_analysis import FrameworkPattern

        stage = SpringDIEventStaticStage()

        patterns = [
            FrameworkPattern(
                pattern_type="bean",
                source_file="UserService.java",
                source_element="UserService",
                target_hint="service",
                raw_code="@Service class UserService",
                line_number=5,
                confidence=0.90,
            ),
            FrameworkPattern(
                pattern_type="kafka_produce",
                source_file="OrderProducer.java",
                source_element="kafkaTemplate",
                target_hint="order-topic",
                raw_code='kafkaTemplate.send("order-topic", order)',
                line_number=10,
                confidence=0.90,
            ),
        ]

        edges, ambiguities = stage.run(patterns, [])

        # 应该返回边列表
        assert isinstance(edges, list)
        assert isinstance(ambiguities, list)

    def test_parallel_execution(self):
        """测试 Stage 3 和 Stage 4a 并行执行。"""
        from backend.pipeline.static_first_pipeline import StaticFirstPipeline
        from backend.models.static_analysis import StaticAnalysisResult, FileInfo

        # 创建模拟的静态分析结果
        static_result = StaticAnalysisResult(
            structural_nodes=[],
            structural_edges=[],
            import_graph={"src/main.py": []},
            framework_patterns=[],
            low_confidence_edges=[],
        )

        # 创建模拟的文件信息
        all_files = {
            "src/main.py": FileInfo(
                path="src/main.py",
                absolute_path="/tmp/src/main.py",
                language="python",
                size_bytes=100,
                line_count=10,
                modified_time=1.0,
            ),
        }

        pipeline = StaticFirstPipeline()

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "main.py").write_text("print('hello')")

            # 模拟并行执行
            import concurrent.futures

            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
                # Stage 3
                cluster_future = executor.submit(
                    pipeline._run_stage3_cluster,
                    all_files,
                    {"src/main.py": []},
                    None,
                    None,
                )

                # Stage 4a
                di_event_future = executor.submit(
                    pipeline._run_stage4a_static,
                    static_result,
                    root,
                    None,
                    None,
                )

                # 获取结果
                candidates = cluster_future.result()
                edges, ambiguities = di_event_future.result()

            assert isinstance(candidates, list)
            assert isinstance(edges, list)


# ─────────────────────────────────────────────────────────────────────────────
# Stage 3b 测试（Mock LLM）
# ─────────────────────────────────────────────────────────────────────────────


class TestAISemanticEnhanceStageMock:
    """AI 语义增强测试（Mock LLM）。"""

    def test_enhance_with_mock_llm(self):
        """使用 Mock LLM 测试语义增强。"""
        from backend.pipeline.stages.ai_semantic_enhance import AISemanticEnhanceStage
        from backend.models.static_analysis import (
            ModuleCandidate,
            StaticAnalysisResult,
        )

        # 创建模块候选
        candidates = [
            ModuleCandidate(
                id="module:user",
                name="user-module",
                files=["src/user/service.py", "src/user/repo.py"],
                boundary_confidence=1.0,
                boundary_warnings=[],
            ),
        ]

        # 创建静态分析结果
        static_result = StaticAnalysisResult(
            structural_nodes=[],
            structural_edges=[],
            import_graph={},
            framework_patterns=[],
            low_confidence_edges=[],
        )

        # Mock LLM 客户端
        mock_llm = MagicMock()
        mock_llm.complete.return_value = '''
{
  "module_id": "module:user",
  "confirmed_files": ["src/user/service.py", "src/user/repo.py"],
  "name": "用户模块",
  "purpose": "用户管理和认证",
  "layer": "service",
  "technology": ["python", "fastapi"]
}
'''

        stage = AISemanticEnhanceStage(max_concurrency=1)
        enhancements, nodes, edges, failed = stage.run(
            module_candidates=candidates,
            static_result=static_result,
            llm_client=mock_llm,
            observer=None,
            on_progress=None,
        )

        # 应该有一个增强结果
        assert len(enhancements) == 1
        assert enhancements[0].name == "用户模块"
        assert enhancements[0].layer == "service"
        assert len(failed) == 0


# ─────────────────────────────────────────────────────────────────────────────
# Stage 4b 测试（Mock LLM）
# ─────────────────────────────────────────────────────────────────────────────


class TestSpringDIEventAIStageMock:
    """Spring DI/Event AI 解析测试（Mock LLM）。"""

    def test_resolve_di_ambiguities(self):
        """测试 DI 歧义解析。"""
        from backend.pipeline.stages.spring_di_event_ai import SpringDIEventAIStage
        from backend.models.static_analysis import FrameworkPattern

        # 创建歧义
        ambiguities = [
            FrameworkPattern(
                pattern_type="di_injection",
                source_file="OrderService.java",
                source_element="OrderService.paymentService",
                target_hint=None,
                raw_code="@Autowired PaymentService paymentService",
                line_number=10,
                confidence=0.70,
            ),
        ]

        # Mock LLM 客户端
        mock_llm = MagicMock()
        mock_llm.complete.return_value = '''{
  "resolutions": [
    {
      "injection_point": "OrderService.paymentService",
      "resolved_bean": "AliPayService",
      "confidence": 0.85,
      "reason": "@Profile('prod') 激活时使用 AliPayService"
    }
  ]
}'''

        stage = SpringDIEventAIStage()
        edges = stage.run(
            ambiguities=ambiguities,
            llm_client=mock_llm,
            observer=None,
            on_progress=None,
        )

        # 应该返回解析的边
        assert len(edges) >= 1
        assert all(e.properties.get("source") == "ai_enhanced" for e in edges)

    def test_resolve_kafka_ambiguities(self):
        """测试 Kafka 动态 topic 解析。"""
        from backend.pipeline.stages.spring_di_event_ai import SpringDIEventAIStage
        from backend.models.static_analysis import FrameworkPattern

        ambiguities = [
            FrameworkPattern(
                pattern_type="kafka_dynamic",
                source_file="OrderProducer.java",
                source_element="kafkaTemplate",
                target_hint="topicPrefix + '-' + env",
                raw_code="kafkaTemplate.send(topicPrefix + '-' + env, order)",
                line_number=15,
                confidence=0.60,
            ),
        ]

        mock_llm = MagicMock()
        mock_llm.complete.return_value = '''{
  "resolutions": [
    {
      "dynamic_topic": "topicPrefix + '-' + env",
      "possible_values": ["order-prod", "order-dev"],
      "confidence": 0.75,
      "reason": "根据环境变量推断"
    }
  ]
}'''

        stage = SpringDIEventAIStage()
        edges = stage.run(
            ambiguities=ambiguities,
            llm_client=mock_llm,
            observer=None,
            on_progress=None,
        )

        # 应该为每个可能的值创建边
        assert len(edges) >= 1


# ─────────────────────────────────────────────────────────────────────────────
# 完整流水线测试（Mock LLM）
# ─────────────────────────────────────────────────────────────────────────────


class TestStaticFirstPipelineFullMock:
    """完整流水线测试（Mock LLM）。"""

    @patch("backend.pipeline.static_first_pipeline.LLMClient")
    def test_full_pipeline_with_mock_llm(self, mock_llm_class):
        """测试完整流水线（Mock LLM）。"""
        from backend.pipeline.static_first_pipeline import StaticFirstPipeline

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)

            # 创建测试文件结构
            (root / "src").mkdir()
            (root / "src" / "service.py").write_text("""
class UserService:
    def get_user(self, user_id):
        return user_id
""")
            (root / "src" / "repo.py").write_text("""
class UserRepository:
    def find_by_id(self, user_id):
        return {"id": user_id}
""")

            # Mock LLM
            mock_llm = MagicMock()
            mock_llm.complete.return_value = '''
{
  "module_id": "module:src",
  "confirmed_files": ["src/service.py", "src/repo.py"],
  "name": "核心模块",
  "purpose": "用户服务",
  "layer": "service",
  "technology": ["python"]
}
'''
            mock_llm_class.return_value = mock_llm

            # 运行流水线
            pipeline = StaticFirstPipeline(max_workers=1)
            result = pipeline.analyze(
                root,
                repo_name="test-repo",
                enable_rag=False,
            )

            # 验证结果
            assert result.status in ("success", "partial")
            assert result.graph_id is not None
            assert len(result.nodes) >= 0
            assert len(result.edges) >= 0
            assert result.duration_seconds > 0

    def test_empty_repository(self):
        """测试空仓库。"""
        from backend.pipeline.static_first_pipeline import StaticFirstPipeline

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)

            # 空目录
            pipeline = StaticFirstPipeline()

            with pytest.raises(ValueError, match="没有找到任何源码文件"):
                pipeline.analyze(root)


# ─────────────────────────────────────────────────────────────────────────────
# 质量报告测试
# ─────────────────────────────────────────────────────────────────────────────


class TestQualityReport:
    """质量报告测试。"""

    def test_quality_report_calculation(self):
        """测试质量报告计算。"""
        from backend.models.static_analysis import QualityReport

        # 创建质量报告
        report = QualityReport(
            low_confidence_edge_ratio=0.25,  # 25% 低置信度边
            failed_modules=[],
            static_node_ratio=0.80,  # 80% 静态节点
            ai_node_ratio=0.20,  # 20% AI 节点
            stage_metrics=None,
        )
        report.check_thresholds()

        assert report.low_confidence_edge_ratio == 0.25
        assert len(report.failed_modules) == 0
        # 25% 不超过 30% 警告阈值
        assert len(report.warnings) == 0
        assert len(report.errors) == 0

    def test_quality_report_warning(self):
        """测试质量报告警告阈值。"""
        from backend.models.static_analysis import QualityReport

        report = QualityReport(
            low_confidence_edge_ratio=0.35,  # 35% 超过 30% 警告阈值
            failed_modules=[],
        )
        report.check_thresholds()

        assert len(report.warnings) >= 1
        assert "low_confidence_edge_ratio" in report.warnings[0]

    def test_quality_report_error(self):
        """测试质量报告错误阈值。"""
        from backend.models.static_analysis import QualityReport

        report = QualityReport(
            low_confidence_edge_ratio=0.55,  # 55% 超过 50% 错误阈值
            failed_modules=["module1", "module2"],
        )
        report.check_thresholds()

        assert len(report.errors) >= 1
        assert "low_confidence_edge_ratio" in report.errors[0]


# ─────────────────────────────────────────────────────────────────────────────
# Stage 5 GraphMergeWithQualityStage 测试
# ─────────────────────────────────────────────────────────────────────────────


class TestGraphMergeWithQualityStage:
    """Stage 5 图谱合并测试。"""

    def test_merge_nodes_and_edges(self):
        """测试节点和边合并。"""
        from backend.pipeline.stages.graph_merge_with_quality import GraphMergeWithQualityStage
        from backend.graph.graph_schema import GraphNode, GraphEdge

        # 创建静态节点
        static_nodes = [
            GraphNode(
                id="class:UserService",
                type="Class",
                name="UserService",
                properties={"source": "static", "confidence": 0.95},
            ),
        ]

        # 创建静态边
        static_edges = [
            GraphEdge(
                from_="class:UserService",
                to="class:UserRepo",
                type="calls",
                properties={"source": "static", "confidence": 0.90},
            ),
        ]

        # 创建 AI 增强节点
        ai_nodes = [
            GraphNode(
                id="class:UserService",
                type="Class",
                name="UserService",
                properties={
                    "source": "ai_enhanced",
                    "purpose": "用户服务类",
                    "layer": "service",
                },
            ),
        ]

        # 创建 DI 边
        di_edges = [
            GraphEdge(
                from_="class:OrderService",
                to="class:UserService",
                type="depends_on",
                properties={"source": "static", "confidence": 0.85},
            ),
        ]

        stage = GraphMergeWithQualityStage()
        built, report = stage.run(
            structural_nodes=static_nodes,
            structural_edges=static_edges,
            ai_enhanced_nodes=ai_nodes,
            ai_enhanced_edges=[],
            di_event_edges=di_edges,
            failed_modules=[],
            observer=None,
            on_progress=None,
        )

        # 验证节点数量
        assert built.node_count == 1
        # 验证边数量
        assert built.edge_count == 2

        # 验证节点属性合并
        user_service_node = built.nodes[0]
        assert user_service_node.properties["source"] == "static"
        assert user_service_node.properties["confidence"] == 0.95
        assert user_service_node.properties["purpose"] == "用户服务类"
        assert user_service_node.properties["layer"] == "service"

    def test_quality_report_generation(self):
        """测试质量报告生成。"""
        from backend.pipeline.stages.graph_merge_with_quality import GraphMergeWithQualityStage
        from backend.graph.graph_schema import GraphNode, GraphEdge

        # 创建不同置信度的节点和边
        static_nodes = [
            GraphNode(
                id="node1",
                type="Class",
                name="HighConfClass",
                properties={"source": "static", "confidence": 0.95},
            ),
            GraphNode(
                id="node2",
                type="Class",
                name="AIEnhancedClass",
                properties={"source": "ai_enhanced", "confidence": 0.70},
            ),
        ]

        static_edges = [
            GraphEdge(
                from_="node1",
                to="node2",
                type="calls",
                properties={"confidence": 0.85},
            ),
            GraphEdge(
                from_="node2",
                to="node3",
                type="calls",
                properties={"confidence": 0.55},  # 低置信度
            ),
        ]

        stage = GraphMergeWithQualityStage()
        built, report = stage.run(
            structural_nodes=static_nodes,
            structural_edges=static_edges,
            ai_enhanced_nodes=[],
            ai_enhanced_edges=[],
            di_event_edges=[],
            failed_modules=["module_failed"],
            observer=None,
            on_progress=None,
        )

        # 验证质量报告
        assert report.static_node_ratio == 0.5  # 1/2
        assert report.ai_node_ratio == 0.5  # 1/2
        assert report.low_confidence_edge_ratio == 0.5  # 1/2
        assert "module_failed" in report.failed_modules


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
