"""AI 描述生成模块测试。"""
import json
import pytest
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock

from backend.pipeline.stages.ai_description_stage import (
    AIDescriptionStage,
    AIDescriptionConfig,
    AIDescriptionResult,
)
from backend.graph.graph_schema import GraphNode, GraphEdge


class TestAIDescriptionConfig:
    """测试 AIDescriptionConfig。"""

    def test_default_config(self):
        """默认配置。"""
        config = AIDescriptionConfig()
        assert config.enabled is True
        assert config.max_nodes_per_domain == 50
        assert config.batch_size == 10
        assert config.concurrency == 3
        assert config.skip_if_cached is True

    def test_custom_config(self):
        """自定义配置。"""
        config = AIDescriptionConfig(
            enabled=False,
            max_nodes_per_domain=100,
            batch_size=20,
            concurrency=5,
            skip_if_cached=False,
        )
        assert config.enabled is False
        assert config.max_nodes_per_domain == 100
        assert config.batch_size == 20
        assert config.concurrency == 5
        assert config.skip_if_cached is False


class TestAIDescriptionResult:
    """测试 AIDescriptionResult。"""

    def test_default_result(self):
        """默认结果。"""
        result = AIDescriptionResult()
        assert result.domains_generated == 0
        assert result.nodes_generated == 0
        assert result.domains_skipped == 0
        assert result.nodes_skipped == 0
        assert result.errors == []

    def test_result_with_data(self):
        """带数据的结果。"""
        result = AIDescriptionResult(
            domains_generated=5,
            nodes_generated=20,
            domains_skipped=2,
            nodes_skipped=5,
            errors=["error1"],
        )
        assert result.domains_generated == 5
        assert result.nodes_generated == 20
        assert result.domains_skipped == 2
        assert result.nodes_skipped == 5
        assert len(result.errors) == 1


class TestAIDescriptionStage:
    """测试 AIDescriptionStage。"""

    def test_init(self):
        """初始化阶段。"""
        stage = AIDescriptionStage(repo_id="test-repo")
        assert stage.repo_id == "test-repo"
        assert stage.config.enabled is True

    def test_init_with_config(self):
        """使用配置初始化。"""
        config = AIDescriptionConfig(enabled=False)
        stage = AIDescriptionStage(repo_id="test-repo", config=config)
        assert stage.config.enabled is False

    def test_run_disabled(self):
        """禁用时跳过。"""
        config = AIDescriptionConfig(enabled=False)
        stage = AIDescriptionStage(repo_id="test-repo", config=config)
        result = stage.run(nodes=[], edges=[])
        assert result.domains_generated == 0
        assert result.nodes_generated == 0

    def test_group_nodes_by_domain(self):
        """测试节点按领域分组。"""
        stage = AIDescriptionStage(repo_id="test-repo")

        # 使用正确的节点 ID 格式（包含路径）
        nodes = [
            GraphNode(
                id="class:src/main/java/com/example/service/user/UserService.java",
                type="Service",
                name="UserService",
                properties={"file": "src/main/java/com/example/service/user/UserService.java"},
            ),
            GraphNode(
                id="class:src/main/java/com/example/controller/user/UserController.java",
                type="Controller",
                name="UserController",
                properties={"file": "src/main/java/com/example/controller/user/UserController.java"},
            ),
            GraphNode(
                id="class:src/main/java/com/example/service/order/OrderService.java",
                type="Service",
                name="OrderService",
                properties={"file": "src/main/java/com/example/service/order/OrderService.java"},
            ),
        ]

        groups = stage._group_nodes_by_domain(nodes, None)

        # 应该有两个领域分组
        assert len(groups) == 2
        assert any("user" in k for k in groups.keys())
        assert any("order" in k for k in groups.keys())


class TestDescriptionPrompts:
    """测试 Prompt 模板。"""

    def test_build_domain_description_prompt(self):
        """测试构建领域描述 Prompt。"""
        from backend.llm.prompts.description_prompts import build_domain_description_prompt

        system, user = build_domain_description_prompt(
            domain_name="User",
            domain_key="user",
            nodes=[
                {"id": "service:user:UserService", "type": "Service", "name": "UserService"},
                {"id": "controller:user:UserController", "type": "Controller", "name": "UserController"},
            ],
            edges=[
                {"from": "controller:user:UserController", "to": "service:user:UserService", "type": "calls"},
            ],
        )

        assert "代码分析专家" in system
        assert "User" in user
        assert "user" in user
        assert "UserService" in user

    def test_build_node_description_prompt(self):
        """测试构建节点描述 Prompt。"""
        from backend.llm.prompts.description_prompts import build_node_description_prompt

        system, user = build_node_description_prompt(
            node_id="service:user:UserService",
            node_type="Service",
            node_name="UserService",
            file_path="src/user/UserService.java",
            code_content="public class UserService {}",
        )

        assert "代码分析专家" in system
        assert "Service" in user
        assert "UserService" in user
        assert "public class UserService" in user


class TestAIDescriptionGenerator:
    """测试 AI 描述生成器。"""

    @patch("backend.services.ai_description_generator.get_llm_client")
    @patch("backend.services.ai_description_generator.get_description_cache")
    def test_generate_domain_description_cached(
        self, mock_get_cache, mock_get_llm
    ):
        """测试缓存的领域描述。"""
        from backend.services.ai_description_generator import AIDescriptionGenerator
        from backend.services.description_cache import DomainDescription

        # 设置缓存返回
        cached_desc = DomainDescription(
            domain_id="domain:user",
            summary="用户管理模块",
            core_services=["UserService"],
            data_flow_pattern="Controller → Service → Repository",
            generated_at="2024-01-01T00:00:00",
            confidence=0.85,
        )
        mock_cache_instance = Mock()
        mock_cache_instance.get_domain_description.return_value = cached_desc
        mock_get_cache.return_value = mock_cache_instance

        # LLM 不应该被调用
        mock_llm_instance = Mock()
        mock_get_llm.return_value = mock_llm_instance

        generator = AIDescriptionGenerator(repo_id="test-repo")
        result = generator.generate_domain_description(
            domain_id="domain:user",
            domain_name="User",
            domain_key="user",
            nodes=[],
            edges=[],
        )

        # 应该返回缓存的结果
        assert result is not None
        assert result.summary == "用户管理模块"
        # LLM 不应该被调用
        mock_llm_instance.chat_completion.assert_not_called()

    @patch("backend.services.ai_description_generator.get_llm_client")
    @patch("backend.services.ai_description_generator.get_description_cache")
    def test_generate_domain_description_llm(
        self, mock_get_cache, mock_get_llm
    ):
        """测试 LLM 生成领域描述。"""
        from backend.services.ai_description_generator import AIDescriptionGenerator

        # 设置缓存返回空
        mock_cache_instance = Mock()
        mock_cache_instance.get_domain_description.return_value = None
        mock_cache_instance.set_domain_description = Mock()
        mock_get_cache.return_value = mock_cache_instance

        # 设置 LLM 返回
        mock_llm_instance = Mock()
        mock_llm_instance.chat_completion.return_value = {
            "content": json.dumps({
                "summary": "用户管理模块",
                "core_services": ["UserService", "UserController"],
                "data_flow_pattern": "Controller → Service → Repository",
            }),
            "usage": {"input_tokens": 100, "output_tokens": 50},
        }
        mock_get_llm.return_value = mock_llm_instance

        generator = AIDescriptionGenerator(repo_id="test-repo")
        result = generator.generate_domain_description(
            domain_id="domain:user",
            domain_name="User",
            domain_key="user",
            nodes=[{"id": "svc", "type": "Service", "name": "UserService"}],
            edges=[],
            force=True,  # 强制生成
        )

        # 应该调用 LLM
        assert result is not None
        assert result.summary == "用户管理模块"
        mock_llm_instance.chat_completion.assert_called_once()


class TestDescriptionCache:
    """测试描述缓存。"""

    def test_domain_description_model(self):
        """测试 DomainDescription 模型。"""
        from backend.services.description_cache import DomainDescription

        desc = DomainDescription(
            domain_id="domain:user",
            summary="用户管理",
            core_services=["UserService"],
            data_flow_pattern="flow",
            generated_at="2024-01-01T00:00:00",
            confidence=0.9,
        )

        assert desc.domain_id == "domain:user"
        assert desc.summary == "用户管理"
        assert desc.core_services == ["UserService"]
        assert desc.confidence == 0.9

    def test_node_description_model(self):
        """测试 NodeDescription 模型。"""
        from backend.services.description_cache import NodeDescription

        desc = NodeDescription(
            node_id="service:user:UserService",
            description="用户服务",
            code_snippet="public class UserService {}",
            highlight_lines=[1, 5, 10],
            generated_at="2024-01-01T00:00:00",
            confidence=0.85,
        )

        assert desc.node_id == "service:user:UserService"
        assert desc.description == "用户服务"
        assert desc.highlight_lines == [1, 5, 10]


class TestCodeSnippetService:
    """测试代码片段服务。"""

    def test_extract_snippet(self, tmp_path: Path):
        """测试提取代码片段。"""
        from backend.services.code_snippet_service import CodeSnippetService

        # 创建测试文件
        test_file = tmp_path / "TestService.java"
        test_file.write_text("""
package com.example;

public class TestService {
    public void doSomething() {
        System.out.println("Hello");
    }
}
""")

        service = CodeSnippetService()
        service.set_repo_base_path(str(tmp_path))

        snippet = service.extract_snippet(
            file_path="TestService.java",
            start_line=4,
            context_lines=2,
            max_lines=10,
        )

        assert snippet is not None
        assert "TestService" in snippet.content
        assert len(snippet.highlight_lines) > 0

    def test_language_detection(self):
        """测试语言检测。"""
        from backend.services.code_snippet_service import CodeSnippetService
        from pathlib import Path

        service = CodeSnippetService()

        # 测试 _get_language 方法
        assert service._get_language(Path("Test.java")) == "java"
        assert service._get_language(Path("test.py")) == "python"
        assert service._get_language(Path("test.ts")) == "typescript"
        assert service._get_language(Path("test.js")) == "javascript"
        assert service._get_language(Path("test.go")) == "go"
        assert service._get_language(Path("test.unknown")) == "text"
