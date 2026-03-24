"""业务领域视图交互 API 集成测试。"""
import json
import pytest
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock
from fastapi.testclient import TestClient

from backend.api.server import app
from backend.services.description_cache import (
    DescriptionCache,
    DomainDescription,
    NodeDescription,
    get_description_cache,
)
from backend.services.code_snippet_service import (
    CodeSnippetService,
    CodeSnippet,
    get_code_snippet_service,
)


@pytest.fixture
def client():
    """创建测试客户端。"""
    return TestClient(app)


@pytest.fixture
def temp_cache_dir(tmp_path: Path):
    """创建临时缓存目录。"""
    cache_dir = tmp_path / "ai_descriptions"
    cache_dir.mkdir(parents=True)
    return cache_dir


@pytest.fixture
def mock_cache(temp_cache_dir: Path):
    """创建 mock 缓存服务。"""
    cache = DescriptionCache(base_path=str(temp_cache_dir))
    return cache


class TestDomainDescriptionAPI:
    """测试领域描述 API。"""

    def test_get_domain_description_not_found(self, client: TestClient):
        """测试获取不存在的领域描述。"""
        # 使用不存在的 domain_id
        response = client.get(
            "/graph/lineage/domains/nonexistent-domain/description",
            params={"repo_id": "test-repo"},
        )

        # 应该返回占位描述（不是 404）
        assert response.status_code == 200
        data = response.json()
        assert data["domain_id"] == "nonexistent-domain"
        assert "暂无 AI 生成的描述" in data["summary"]
        assert data["confidence"] == 0.0

    @patch("backend.api.routers.domains.get_description_cache")
    def test_get_domain_description_cached(
        self, mock_get_cache, client: TestClient, mock_cache: DescriptionCache
    ):
        """测试获取缓存的领域描述。"""
        # 设置缓存
        cached_desc = DomainDescription(
            domain_id="domain:user",
            summary="用户管理模块，处理用户注册、登录、权限等功能",
            core_services=["UserService", "UserController", "UserRepository"],
            data_flow_pattern="Controller → Service → Repository → Database",
            generated_at="2024-01-01T00:00:00",
            confidence=0.85,
        )
        mock_cache.set_domain_description("test-repo", "domain:user", cached_desc)
        mock_get_cache.return_value = mock_cache

        response = client.get(
            "/graph/lineage/domains/domain:user/description",
            params={"repo_id": "test-repo"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["domain_id"] == "domain:user"
        assert "用户管理" in data["summary"]
        assert len(data["core_services"]) == 3
        assert data["confidence"] == 0.85


class TestNodeBatchInfoAPI:
    """测试节点批量信息 API。"""

    def test_get_batch_node_info(
        self, client: TestClient
    ):
        """测试批量获取节点信息。"""
        # 这个测试需要 mock 复杂的存储层，简化为测试 API 响应格式
        with patch("backend.api.routers.domains.get_graph_storage") as mock_storage:
            # Mock 图谱存储
            mock_store = Mock()
            mock_store.repo_exists.return_value = True
            mock_store.load_graph.return_value = {
                "nodes": [
                    {
                        "id": "class:service/user/UserService.java",
                        "type": "Service",
                        "name": "UserService",
                        "properties": {
                            "file": "src/service/user/UserService.java",
                            "line": 10,
                        },
                    },
                    {
                        "id": "class:controller/user/UserController.java",
                        "type": "Controller",
                        "name": "UserController",
                        "properties": {
                            "file": "src/controller/user/UserController.java",
                            "line": 15,
                        },
                    },
                ],
                "edges": [],
            }
            mock_storage.return_value = mock_store

            response = client.post(
                "/graph/lineage/nodes/batch-info",
                json={
                    "repo_id": "test-repo",
                    "domain_id": "domain:user",
                    "node_ids": [
                        "class:service/user/UserService.java",
                        "class:controller/user/UserController.java",
                    ],
                },
            )

            assert response.status_code == 200
            data = response.json()
            assert data["domain_id"] == "domain:user"

    def test_get_batch_node_info_empty(self, client: TestClient):
        """测试空节点列表。"""
        with patch("backend.api.routers.domains.get_graph_storage") as mock_storage:
            mock_store = Mock()
            mock_store.repo_exists.return_value = True
            mock_store.load_graph.return_value = {"nodes": [], "edges": []}
            mock_storage.return_value = mock_store

            response = client.post(
                "/graph/lineage/nodes/batch-info",
                json={
                    "repo_id": "test-repo",
                    "domain_id": "domain:test",
                    "node_ids": [],
                },
            )

            assert response.status_code == 200
            data = response.json()
            assert len(data["nodes"]) == 0


class TestCodeSnippetAPI:
    """测试代码片段 API。"""

    def test_get_node_code_snippet(
        self, client: TestClient, tmp_path: Path
    ):
        """测试获取节点代码片段。"""
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

        # Mock 图谱存储
        with patch("backend.api.routers.domains.get_graph_storage") as mock_storage:
            mock_store = Mock()
            mock_store.repo_exists.return_value = True
            mock_store.load_graph.return_value = {
                "nodes": [
                    {
                        "id": "test-node",
                        "type": "Service",
                        "name": "TestService",
                        "properties": {
                            "file": "TestService.java",
                            "line": 4,
                        },
                    },
                ],
                "edges": [],
            }
            mock_storage.return_value = mock_store

            # Mock 代码片段服务
            with patch("backend.services.code_snippet_service.get_code_snippet_service") as mock_get_service:
                service = CodeSnippetService(repo_base_path=str(tmp_path))
                mock_get_service.return_value = service

                response = client.get(
                    "/graph/lineage/nodes/test-node/code",
                    params={"repo_id": "test-repo"},
                )

                assert response.status_code == 200
                data = response.json()
                assert "TestService" in data["content"]
                assert data["language"] == "java"

    def test_get_node_code_repo_not_found(self, client: TestClient):
        """测试仓库不存在时返回 404。"""
        with patch("backend.api.routers.domains.get_graph_storage") as mock_storage:
            mock_store = Mock()
            mock_store.repo_exists.return_value = False
            mock_storage.return_value = mock_store

            # Mock analysis store 返回空
            with patch("backend.store.analysis_store.get_analysis_store") as mock_analysis:
                mock_analysis_store = Mock()
                mock_analysis_store.get_latest.return_value = None
                mock_analysis.return_value = mock_analysis_store

                response = client.get(
                    "/graph/lineage/nodes/nonexistent-node/code",
                    params={"repo_id": "test-repo"},
                )

                # 仓库不存在应该返回 404
                assert response.status_code == 404


class TestAIDescriptionGeneratorIntegration:
    """测试 AI 描述生成器集成。"""

    @patch("backend.services.ai_description_generator.get_llm_client")
    @patch("backend.services.ai_description_generator.get_description_cache")
    def test_generate_domain_description_full_flow(
        self, mock_get_cache, mock_get_llm, temp_cache_dir: Path
    ):
        """测试完整的领域描述生成流程。"""
        from backend.services.ai_description_generator import AIDescriptionGenerator

        # 设置缓存
        cache = DescriptionCache(base_path=str(temp_cache_dir))
        mock_get_cache.return_value = cache

        # 设置 LLM 返回
        mock_llm = Mock()
        mock_llm.chat_completion.return_value = {
            "content": json.dumps({
                "summary": "用户管理模块，负责用户注册、认证、权限管理",
                "core_services": ["UserService", "UserController"],
                "data_flow_pattern": "HTTP → Controller → Service → Repository",
            }),
            "usage": {"input_tokens": 200, "output_tokens": 50},
        }
        mock_get_llm.return_value = mock_llm

        # 创建生成器并生成
        generator = AIDescriptionGenerator(repo_id="test-repo")
        result = generator.generate_domain_description(
            domain_id="domain:user",
            domain_name="User",
            domain_key="user",
            nodes=[
                {"id": "svc1", "type": "Service", "name": "UserService"},
                {"id": "ctrl1", "type": "Controller", "name": "UserController"},
            ],
            edges=[
                {"from": "ctrl1", "to": "svc1", "type": "calls"},
            ],
            force=True,
        )

        # 验证结果
        assert result is not None
        assert "用户管理" in result.summary
        assert len(result.core_services) == 2
        assert result.confidence >= 0.8

        # 验证缓存已保存
        cached = cache.get_domain_description("test-repo", "domain:user")
        assert cached is not None
        assert cached.summary == result.summary

    @patch("backend.services.ai_description_generator.get_llm_client")
    @patch("backend.services.ai_description_generator.get_description_cache")
    @patch("backend.services.ai_description_generator.get_code_snippet_service")
    def test_generate_node_description_full_flow(
        self, mock_get_code_service, mock_get_cache, mock_get_llm, tmp_path: Path
    ):
        """测试完整的节点描述生成流程。"""
        from backend.services.ai_description_generator import AIDescriptionGenerator

        # 创建测试代码文件
        test_file = tmp_path / "UserService.java"
        test_file.write_text("""
package com.example.service;

public class UserService {
    public User findById(Long id) {
        return userRepository.findById(id);
    }
}
""")

        # 设置代码片段服务
        code_service = CodeSnippetService(repo_base_path=str(tmp_path))
        mock_get_code_service.return_value = code_service

        # 设置缓存
        cache_dir = tmp_path / "cache"
        cache_dir.mkdir()
        cache = DescriptionCache(base_path=str(cache_dir))
        mock_get_cache.return_value = cache

        # 设置 LLM 返回
        mock_llm = Mock()
        mock_llm.chat_completion.return_value = {
            "content": json.dumps({
                "description": "用户查询服务，提供根据 ID 查询用户的功能",
                "highlight_lines": [4, 5, 6],
            }),
            "usage": {"input_tokens": 150, "output_tokens": 30},
        }
        mock_get_llm.return_value = mock_llm

        # 创建生成器并生成
        generator = AIDescriptionGenerator(repo_id="test-repo", repo_path=str(tmp_path))
        result = generator.generate_node_description(
            node_id="class:UserService.java",
            node_type="Service",
            node_name="UserService",
            file_path="UserService.java",
            line=4,
            force=True,
        )

        # 验证结果
        assert result is not None
        assert "用户查询" in result.description
        assert len(result.highlight_lines) > 0


class TestDescriptionCacheIntegration:
    """测试描述缓存集成。"""

    def test_cache_roundtrip(self, tmp_path: Path):
        """测试缓存存取往返。"""
        cache = DescriptionCache(base_path=str(tmp_path))

        # 创建描述
        desc = DomainDescription(
            domain_id="domain:test",
            summary="测试领域",
            core_services=["ServiceA"],
            data_flow_pattern="A → B",
            generated_at="2024-01-01T00:00:00",
            confidence=0.9,
        )

        # 保存
        cache.set_domain_description("test-repo", "domain:test", desc)

        # 读取
        loaded = cache.get_domain_description("test-repo", "domain:test")

        assert loaded is not None
        assert loaded.domain_id == desc.domain_id
        assert loaded.summary == desc.summary
        assert loaded.confidence == desc.confidence

    def test_cache_invalidation(self, tmp_path: Path):
        """测试缓存失效。"""
        cache = DescriptionCache(base_path=str(tmp_path))

        # 创建并保存描述
        desc = DomainDescription(
            domain_id="domain:test",
            summary="测试领域",
            core_services=[],
            data_flow_pattern="",
            generated_at="2024-01-01T00:00:00",
            confidence=0.9,
        )
        cache.set_domain_description("test-repo", "domain:test", desc)

        # 失效
        cache.invalidate_repo("test-repo")

        # 读取应返回空
        loaded = cache.get_domain_description("test-repo", "domain:test")
        assert loaded is None


class TestPerformanceRequirements:
    """性能要求测试。"""

    def test_subgraph_filter_performance(self):
        """测试子图过滤性能（< 300ms）。"""
        import time
        import sys
        sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent / "code-graph-ui"))

        # 由于前端代码无法在 Python 中直接运行，这里测试算法模拟
        # 创建大量节点和边
        nodes = [
            {"id": f"node_{i}", "type": "Service" if i % 2 == 0 else "Controller"}
            for i in range(500)
        ]
        edges = [
            {"from": f"node_{i}", "to": f"node_{i+1}", "type": "calls"}
            for i in range(400)
        ]

        start = time.time()

        # 模拟过滤逻辑
        entry_types = {"Controller", "APIEndpoint"}
        exit_types = {"Repository", "DAO", "Database"}

        entry_nodes = {n["id"] for n in nodes if n["type"] in entry_types}
        exit_nodes = {n["id"] for n in nodes if n["type"] in exit_types}

        # BFS 遍历
        visited = set()
        for entry in entry_nodes:
            queue = [entry]
            while queue:
                current = queue.pop(0)
                if current in visited:
                    continue
                visited.add(current)

                for e in edges:
                    if e["from"] == current and e["to"] not in visited:
                        queue.append(e["to"])

        elapsed = time.time() - start

        # 应该在 300ms 内完成
        assert elapsed < 0.3, f"过滤耗时 {elapsed}s，超过 300ms 阈值"

    def test_cache_read_performance(self, tmp_path: Path):
        """测试缓存读取性能（< 10ms）。"""
        import time

        cache = DescriptionCache(base_path=str(tmp_path))

        # 创建并保存描述
        desc = DomainDescription(
            domain_id="domain:perf-test",
            summary="性能测试领域",
            core_services=["Service1", "Service2", "Service3"],
            data_flow_pattern="A → B → C",
            generated_at="2024-01-01T00:00:00",
            confidence=0.85,
        )
        cache.set_domain_description("test-repo", "domain:perf-test", desc)

        # 测量读取时间
        start = time.time()
        for _ in range(100):
            cache.get_domain_description("test-repo", "domain:perf-test")
        elapsed = time.time() - start

        # 100 次读取应该在 1 秒内（平均每次 < 10ms）
        assert elapsed < 1.0, f"100 次缓存读取耗时 {elapsed}s，超过阈值"


class TestErrorScenarios:
    """错误场景测试。"""

    @patch("backend.services.ai_description_generator.get_llm_client")
    def test_llm_call_failure(self, mock_get_llm):
        """测试 LLM 调用失败时的处理。"""
        from backend.services.ai_description_generator import AIDescriptionGenerator

        # 模拟 LLM 调用失败
        mock_llm = Mock()
        mock_llm.chat_completion.side_effect = Exception("LLM service unavailable")
        mock_get_llm.return_value = mock_llm

        with patch("backend.services.ai_description_generator.get_description_cache") as mock_cache:
            mock_cache_instance = Mock()
            mock_cache_instance.get_domain_description.return_value = None
            mock_cache.return_value = mock_cache_instance

            generator = AIDescriptionGenerator(repo_id="test-repo")
            result = generator.generate_domain_description(
                domain_id="domain:test",
                domain_name="Test",
                domain_key="test",
                nodes=[],
                edges=[],
                force=True,
            )

            # 应该返回 None，不抛出异常
            assert result is None

    def test_code_file_not_found(self, tmp_path: Path):
        """测试代码文件不存在时的处理。"""
        service = CodeSnippetService(repo_base_path=str(tmp_path))

        result = service.extract_snippet(
            file_path="nonexistent/File.java",
            start_line=10,
        )

        # 应该返回 None，不抛出异常
        assert result is None

    def test_malformed_node_id(self):
        """测试畸形节点 ID 的处理。"""
        from backend.services.domain_inference_service import extract_business_key

        # 各种畸形 ID
        assert extract_business_key("") is None
        assert extract_business_key(None) is None
        assert extract_business_key("   ") is None

        # 特殊前缀应该跳过
        assert extract_business_key("datasource:mysql") is None
        assert extract_business_key("database:postgres") is None
        assert extract_business_key("topic:kafka-events") is None
