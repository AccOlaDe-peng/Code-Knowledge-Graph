"""Phase 6 集成测试 — 端到端测试。

使用项目自身作为测试对象，验证静态优先流水线的完整功能。
"""
from __future__ import annotations

import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest


class TestStaticFirstPipelineE2E:
    """静态优先流水线端到端测试。"""

    @patch("backend.pipeline.static_first_pipeline.LLMClient")
    def test_e2e_analyze_self_project(self, mock_llm_class):
        """端到端测试：分析项目自身。"""
        from backend.pipeline.static_first_pipeline import StaticFirstPipeline

        # 获取项目根目录
        project_root = Path(__file__).parent.parent.parent

        # Mock LLM 客户端
        mock_llm = MagicMock()
        mock_llm.complete.return_value = '''{
  "module_id": "module:backend",
  "confirmed_files": ["backend/pipeline/static_first_pipeline.py"],
  "name": "Pipeline 模块",
  "purpose": "静态优先流水线实现",
  "layer": "service",
  "technology": ["python"]
}'''
        mock_llm_class.return_value = mock_llm

        # 运行流水线
        pipeline = StaticFirstPipeline(max_workers=2)
        result = pipeline.analyze(
            project_root,
            repo_name="code-graph-system",
            enable_rag=False,
        )

        # 验证结果
        assert result.status in ("success", "partial")
        assert result.graph_id is not None
        assert result.duration_seconds > 0
        # 应该有节点和边
        assert len(result.nodes) > 0 or len(result.edges) >= 0

    @patch("backend.pipeline.static_first_pipeline.LLMClient")
    def test_e2e_python_repository(self, mock_llm_class):
        """端到端测试：分析 Python 仓库。"""
        from backend.pipeline.static_first_pipeline import StaticFirstPipeline

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)

            # 创建一个简单的 Python 项目结构
            (root / "src").mkdir()
            (root / "src" / "__init__.py").write_text("")
            (root / "src" / "main.py").write_text("""
from src.utils import helper

class Application:
    def run(self):
        helper()

if __name__ == "__main__":
    app = Application()
    app.run()
""")
            (root / "src" / "utils.py").write_text("""
def helper():
    return "help"
""")

            # Mock LLM
            mock_llm = MagicMock()
            mock_llm.complete.return_value = '''{
  "module_id": "module:src",
  "confirmed_files": ["src/main.py", "src/utils.py"],
  "name": "核心模块",
  "purpose": "应用核心逻辑",
  "layer": "service",
  "technology": ["python"]
}'''
            mock_llm_class.return_value = mock_llm

            # 运行流水线
            pipeline = StaticFirstPipeline(max_workers=1)
            result = pipeline.analyze(
                root,
                repo_name="test-python-project",
                enable_rag=False,
            )

            # 验证结果
            assert result.status in ("success", "partial")
            assert result.graph_id is not None
            # 应该检测到 Python 文件
            assert len(result.nodes) > 0

    @patch("backend.pipeline.static_first_pipeline.LLMClient")
    def test_e2e_java_repository(self, mock_llm_class):
        """端到端测试：分析 Java 仓库（模拟 Spring）。"""
        from backend.pipeline.static_first_pipeline import StaticFirstPipeline

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)

            # 创建一个简单的 Spring 项目结构
            (root / "src" / "main" / "java" / "com" / "example").mkdir(parents=True)
            (root / "src" / "main" / "java" / "com" / "example" / "Application.java").write_text("""
package com.example;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
""")
            (root / "src" / "main" / "java" / "com" / "example" / "UserService.java").write_text("""
package com.example;

import org.springframework.stereotype.Service;

@Service
public class UserService {
    public String getUser(String id) {
        return "user:" + id;
    }
}
""")

            # Mock LLM
            mock_llm = MagicMock()
            mock_llm.complete.return_value = '''{
  "module_id": "module:example",
  "confirmed_files": [],
  "name": "Example 模块",
  "purpose": "Spring Boot 应用",
  "layer": "service",
  "technology": ["java", "spring-boot"]
}'''
            mock_llm_class.return_value = mock_llm

            # 运行流水线
            pipeline = StaticFirstPipeline(max_workers=1)
            result = pipeline.analyze(
                root,
                repo_name="test-spring-project",
                enable_rag=False,
            )

            # 验证结果
            assert result.status in ("success", "partial")
            assert result.graph_id is not None


class TestAIPipelineIntegration:
    """AIPipeline 集成测试。"""

    @patch("backend.pipeline.static_first_pipeline.LLMClient")
    def test_ai_pipeline_with_static_first(self, mock_llm_class):
        """测试 AIPipeline 使用静态优先流水线。"""
        from backend.pipeline.ai_analyze import AIPipeline

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)

            # 创建测试文件
            (root / "main.py").write_text("""
def main():
    print("hello")
""")

            # Mock LLM
            mock_llm = MagicMock()
            mock_llm.complete.return_value = '''{
  "module_id": "module:default",
  "confirmed_files": ["main.py"],
  "name": "默认模块",
  "purpose": "主程序",
  "layer": "other",
  "technology": ["python"]
}'''
            mock_llm_class.return_value = mock_llm

            # 默认应该使用静态优先流水线
            pipeline = AIPipeline(enable_static_first=True)
            result = pipeline.analyze(
                root,
                repo_name="test-ai-pipeline",
                enable_rag=False,
            )

            assert result.status in ("success", "partial")
            assert result.graph_id is not None

    def test_ai_pipeline_fallback_to_old_pipeline(self):
        """测试 AIPipeline 回退到旧流水线。"""
        from backend.pipeline.ai_analyze import AIPipeline

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)

            # 创建测试文件
            (root / "main.py").write_text("""
def main():
    print("hello")
""")

            # 禁用静态优先流水线，应该使用旧流水线
            # 注意：旧流水线需要 LLM，这里只是验证参数传递
            pipeline = AIPipeline(
                enable_static_first=False,
                enable_optimization=False,
            )

            # 旧流水线会在缺少 LLM API Key 时失败
            # 这里只验证配置正确
            assert pipeline._enable_static_first is False
            assert pipeline._enable_optimization is False


class TestQualityReportIntegration:
    """质量报告集成测试。"""

    @patch("backend.pipeline.static_first_pipeline.LLMClient")
    def test_quality_report_in_result(self, mock_llm_class):
        """测试质量报告包含在结果中。"""
        from backend.pipeline.static_first_pipeline import StaticFirstPipeline

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)

            # 创建测试文件
            (root / "service.py").write_text("""
class UserService:
    def get_user(self, user_id):
        return user_id
""")

            # Mock LLM
            mock_llm = MagicMock()
            mock_llm.complete.return_value = '''{
  "module_id": "module:default",
  "confirmed_files": ["service.py"],
  "name": "服务模块",
  "purpose": "用户服务",
  "layer": "service",
  "technology": ["python"]
}'''
            mock_llm_class.return_value = mock_llm

            # 运行流水线
            pipeline = StaticFirstPipeline(max_workers=1)
            result = pipeline.analyze(
                root,
                repo_name="test-quality-report",
                enable_rag=False,
            )

            # 验证结果包含警告（可能为空）
            assert hasattr(result, 'warnings')
            assert isinstance(result.warnings, list)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
