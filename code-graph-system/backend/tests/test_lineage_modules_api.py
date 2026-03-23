"""测试模块级血缘 API。

测试目标：
1. _extract_module_from_id: 模块归属推断
2. _aggregate_class_to_module_edges: Class → Module 边聚合
3. _get_module_class_level_graph: 模块内 Class 级图
4. API 端点响应格式
"""
import pytest
from unittest.mock import patch, MagicMock


class TestExtractModuleFromId:
    """测试模块归属推断。"""

    def test_extract_from_class_id(self):
        """从 Class ID 提取模块名。"""
        from backend.api.routers.graphs import _extract_module_from_id

        result = _extract_module_from_id(
            "class:adms-api/src/main/java/com/example/UserService.java:UserService"
        )
        assert result == "adms-api"

    def test_extract_from_function_id(self):
        """从 Function ID 提取模块名。"""
        from backend.api.routers.graphs import _extract_module_from_id

        result = _extract_module_from_id(
            "function:adms-repository/src/main/java/com/example/UserRepo.java:UserRepo.findById"
        )
        assert result == "adms-repository"

    def test_extract_from_special_node_returns_none(self):
        """特殊节点类型返回 None。"""
        from backend.api.routers.graphs import _extract_module_from_id

        assert _extract_module_from_id("datasource:primary") is None
        assert _extract_module_from_id("database:primary") is None
        assert _extract_module_from_id("topic:order-events") is None
        assert _extract_module_from_id("module:adms-api") is None

    def test_extract_from_empty_id_returns_none(self):
        """空 ID 返回 None。"""
        from backend.api.routers.graphs import _extract_module_from_id

        assert _extract_module_from_id("") is None
        assert _extract_module_from_id(None) is None


class TestAggregateClassToModuleEdges:
    """测试 Class → Module 边聚合。"""

    def test_aggregate_basic(self):
        """基本聚合测试。"""
        from backend.api.routers.graphs import _aggregate_class_to_module_edges

        nodes = [
            {
                "id": "class:adms-api/src/UserService.java:UserService",
                "type": "Service",
                "name": "UserService",
                "properties": {"annotations": ["@Service"]},
            },
            {
                "id": "class:adms-repository/src/UserRepository.java:UserRepository",
                "type": "Class",
                "name": "UserRepository",  # 符合 Repository 命名约定
                "properties": {},
            },
        ]

        edges = [
            {
                "from": "function:adms-api/src/UserService.java:UserService.getUser",
                "to": "function:adms-repository/src/UserRepository.java:UserRepository.findById",
                "type": "calls",
            }
        ]

        modules, module_edges = _aggregate_class_to_module_edges(nodes, edges)

        # 验证模块
        assert len(modules) == 2
        assert "module:adms-api" in modules
        assert "module:adms-repository" in modules

        # 验证模块边
        flow_edges = [e for e in module_edges if e["type"] == "flow_to"]
        assert len(flow_edges) == 1
        assert flow_edges[0]["from"] == "module:adms-api"
        assert flow_edges[0]["to"] == "module:adms-repository"

    def test_aggregate_ignores_same_module_calls(self):
        """同模块调用不生成模块边。"""
        from backend.api.routers.graphs import _aggregate_class_to_module_edges

        nodes = [
            {
                "id": "class:adms-api/src/UserService.java:UserService",
                "type": "Service",
                "name": "UserService",
                "properties": {},
            },
            {
                "id": "class:adms-api/src/AuthService.java:AuthService",
                "type": "Service",
                "name": "AuthService",
                "properties": {},
            },
        ]

        edges = [
            {
                "from": "function:adms-api/src/UserService.java:UserService.getUser",
                "to": "function:adms-api/src/AuthService.java:AuthService.login",
                "type": "calls",
            }
        ]

        modules, module_edges = _aggregate_class_to_module_edges(nodes, edges)

        # 没有跨模块边
        flow_edges = [e for e in module_edges if e["type"] == "flow_to"]
        assert len(flow_edges) == 0

    def test_aggregate_includes_database_connections(self):
        """包含 Database 连接。"""
        from backend.api.routers.graphs import _aggregate_class_to_module_edges

        nodes = [
            {
                "id": "class:adms-repository/src/UserRepository.java:UserRepository",
                "type": "Class",
                "name": "UserRepository",  # 符合 Repository 命名约定
                "properties": {},
            },
            {
                "id": "datasource:primary",
                "type": "Database",
                "name": "PrimaryDB",
                "properties": {},
            },
        ]

        edges = [
            {
                "from": "class:adms-repository/src/UserRepository.java:UserRepository",
                "to": "datasource:primary",
                "type": "reads",
            }
        ]

        modules, module_edges = _aggregate_class_to_module_edges(nodes, edges)

        # 验证 Database 节点被包含在模块中
        assert "module:adms-repository" in modules
        module = modules["module:adms-repository"]
        assert len(module["databases"]) == 1
        assert module["databases"][0]["name"] == "PrimaryDB"


class TestGetModuleClassLevelGraph:
    """测试模块内 Class 级图生成。"""

    def test_filters_by_module(self):
        """按模块过滤节点。"""
        from backend.api.routers.graphs import _get_module_class_level_graph

        nodes = [
            {
                "id": "class:adms-api/src/UserService.java:UserService",
                "type": "Service",
                "name": "UserService",
                "properties": {},
            },
            {
                "id": "class:adms-repository/src/UserRepo.java:UserRepo",
                "type": "Class",
                "name": "UserRepo",
                "properties": {},
            },
        ]

        edges = []

        result = _get_module_class_level_graph(nodes, edges, "adms-api")

        # 只包含 adms-api 模块的节点
        assert len(result["nodes"]) == 1
        assert result["nodes"][0]["name"] == "UserService"

    def test_filters_test_classes(self):
        """过滤测试类。"""
        from backend.api.routers.graphs import _get_module_class_level_graph

        nodes = [
            {
                "id": "class:adms-api/src/main/java/UserService.java:UserService",
                "type": "Service",
                "name": "UserService",
                "properties": {},
            },
            {
                "id": "class:adms-api/src/test/java/UserServiceTest.java:UserServiceTest",
                "type": "Class",
                "name": "UserServiceTest",
                "properties": {},
            },
        ]

        edges = []

        result = _get_module_class_level_graph(nodes, edges, "adms-api")

        # 测试类被过滤
        assert len(result["nodes"]) == 1
        assert result["nodes"][0]["name"] == "UserService"

    def test_aggregates_function_calls_to_class_calls(self):
        """聚合 Function 级 calls 为 Class 级 calls。"""
        from backend.api.routers.graphs import _get_module_class_level_graph

        nodes = [
            {
                "id": "class:adms-api/src/UserService.java:UserService",
                "type": "Service",
                "name": "UserService",
                "properties": {},
            },
            {
                "id": "class:adms-api/src/AuthService.java:AuthService",
                "type": "Service",
                "name": "AuthService",
                "properties": {},
            },
        ]

        edges = [
            {
                "from": "function:adms-api/src/UserService.java:UserService.method1",
                "to": "function:adms-api/src/AuthService.java:AuthService.method2",
                "type": "calls",
            },
            {
                "from": "function:adms-api/src/UserService.java:UserService.method3",
                "to": "function:adms-api/src/AuthService.java:AuthService.method4",
                "type": "calls",
            },
        ]

        result = _get_module_class_level_graph(nodes, edges, "adms-api")

        # 验证节点数量（两个 Service 节点）
        assert len(result["nodes"]) == 2

        # 两条 Function 级 calls 聚合为一条 Class 级 calls
        assert len(result["edges"]) == 1
        assert result["edges"][0]["type"] == "calls"
        assert result["edges"][0]["properties"]["call_count"] == 2


class TestLineageModulesEndpoint:
    """测试 API 端点。"""

    @pytest.fixture
    def mock_graph_storage(self):
        """Mock graph storage."""
        with patch("backend.api.routers.graphs.get_graph_storage") as mock:
            storage = MagicMock()
            storage.repo_exists.return_value = True
            storage.load_graph.return_value = {
                "nodes": [
                    {
                        "id": "class:adms-api/src/UserService.java:UserService",
                        "type": "Service",
                        "name": "UserService",
                        "properties": {"annotations": ["@Service"]},
                    },
                    {
                        "id": "datasource:primary",
                        "type": "Database",
                        "name": "PrimaryDB",
                        "properties": {},
                    },
                ],
                "edges": [],
            }
            mock.return_value = storage
            yield mock

    def test_endpoint_returns_modules(self, mock_graph_storage):
        """端点返回模块列表。"""
        from fastapi.testclient import TestClient
        from backend.api.server import app

        client = TestClient(app)
        response = client.get("/graph/lineage/modules?repo_id=test-repo")

        assert response.status_code == 200
        data = response.json()
        assert "modules" in data
        assert "edges" in data
        assert "module_count" in data

    def test_endpoint_with_module_filter(self, mock_graph_storage):
        """端点支持 module_id 过滤。"""
        from fastapi.testclient import TestClient
        from backend.api.server import app

        # 更新 mock 数据
        mock_graph_storage.return_value.load_graph.return_value = {
            "nodes": [
                {
                    "id": "class:adms-api/src/UserService.java:UserService",
                    "type": "Service",
                    "name": "UserService",
                    "properties": {"annotations": ["@Service"]},
                },
                {
                    "id": "class:adms-repository/src/UserRepo.java:UserRepo",
                    "type": "Class",
                    "name": "UserRepo",
                    "properties": {},
                },
            ],
            "edges": [],
        }

        client = TestClient(app)
        response = client.get("/graph/lineage?repo_id=test-repo&module_id=adms-api")

        assert response.status_code == 200
        data = response.json()
        assert data["module_id"] == "adms-api"
        assert data["node_count"] >= 0
