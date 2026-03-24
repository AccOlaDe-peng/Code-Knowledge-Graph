"""
业务领域视图集成测试。

测试流程：
1. 获取领域配置
2. 保存领域配置
3. 推断业务领域
4. 获取血缘数据并验证聚合

注意：由于 TestClient 不运行 lifespan，部分依赖 GraphStorage 的测试需要使用真实服务器。
"""
import pytest
from fastapi.testclient import TestClient
from backend.api.server import app
from backend.storage.graph_storage import GraphStorage
from backend.api.deps import set_graph_storage


@pytest.fixture
def client():
    """创建测试客户端并初始化存储。"""
    # 初始化 GraphStorage
    storage = GraphStorage()
    set_graph_storage(storage)

    with TestClient(app) as test_client:
        yield test_client


class TestDomainConfigAPI:
    """领域配置 API 测试。"""

    def test_get_domain_config_default(self, client):
        """测试获取默认领域配置。"""
        response = client.get(
            "/graph/lineage/domains/config",
            params={"repo_id": "non-existent-repo"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "repo_id" in data
        assert "domains" in data
        assert isinstance(data["domains"], list)

    def test_save_and_get_domain_config(self, client):
        """测试保存和获取领域配置。"""
        repo_id = "test-domain-config"

        # 保存配置
        save_response = client.post(
            "/graph/lineage/domains/config",
            params={"repo_id": repo_id},
            json={
                "repoId": repo_id,
                "version": 1,
                "domains": [
                    {
                        "id": "domain:drs",
                        "key": "drs",
                        "name": "数据报表服务",
                        "aliases": ["report", "drsdata"],
                        "color": "#00d4ff"
                    },
                    {
                        "id": "domain:mdm",
                        "key": "mdm",
                        "name": "主数据管理",
                        "aliases": ["master"],
                        "color": "#00f084"
                    }
                ]
            }
        )
        assert save_response.status_code == 200
        saved_data = save_response.json()
        assert len(saved_data["domains"]) == 2
        assert saved_data["domains"][0]["key"] == "drs"

        # 获取配置
        get_response = client.get(
            "/graph/lineage/domains/config",
            params={"repo_id": repo_id}
        )
        assert get_response.status_code == 200
        get_data = get_response.json()
        assert len(get_data["domains"]) == 2

    def test_domain_config_with_empty_domains(self, client):
        """测试保存空领域配置。"""
        repo_id = "test-empty-domains"

        response = client.post(
            "/graph/lineage/domains/config",
            params={"repo_id": repo_id},
            json={
                "repoId": repo_id,
                "version": 1,
                "domains": []
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data["domains"]) == 0


class TestDomainInferenceAPI:
    """领域推断 API 测试。"""

    def test_infer_domains_nonexistent_repo(self, client):
        """测试对不存在的仓库推断领域。"""
        response = client.get(
            "/graph/lineage/domains/infer",
            params={"repo_id": "non-existent-repo-xyz"}
        )
        # 应该返回错误或空结果
        assert response.status_code in [200, 404]

    @pytest.mark.skipif(
        True,  # 需要真实仓库数据，默认跳过
        reason="需要真实仓库数据"
    )
    def test_infer_domains_real_repo(self, client):
        """测试对真实仓库推断领域。"""
        response = client.get(
            "/graph/lineage/domains/infer",
            params={"repo_id": "adms"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "inferred" in data
        assert len(data["inferred"]) > 0

        # 检查推断领域结构
        inferred = data["inferred"][0]
        assert "key" in inferred
        assert "suggested_name" in inferred
        assert "confidence" in inferred
        assert "node_count" in inferred
        assert "suggested_color" in inferred


class TestLineageDataAPI:
    """血缘数据 API 测试。"""

    def test_get_lineage_view_default(self, client):
        """测试获取血缘视图默认数据。"""
        response = client.get(
            "/graph/lineage",
            params={"repo_id": "adms"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "nodes" in data
        assert "edges" in data
        assert isinstance(data["nodes"], list)
        assert isinstance(data["edges"], list)

    def test_get_lineage_view_with_calls(self, client):
        """测试获取包含调用关系的血缘视图。"""
        response = client.get(
            "/graph/lineage",
            params={
                "repo_id": "adms",
                "include_calls": True
            }
        )
        assert response.status_code == 200
        data = response.json()
        # 应该有更多数据
        assert len(data["nodes"]) > 0
        assert len(data["edges"]) > 0

    def test_lineage_node_structure(self, client):
        """测试血缘节点数据结构。"""
        response = client.get(
            "/graph/lineage",
            params={"repo_id": "adms", "include_calls": True}
        )
        assert response.status_code == 200
        data = response.json()

        if len(data["nodes"]) > 0:
            node = data["nodes"][0]
            assert "id" in node
            assert "type" in node
            # name 是可选的
            assert "properties" in node or node.get("name") is not None

    def test_lineage_edge_structure(self, client):
        """测试血缘边数据结构。"""
        response = client.get(
            "/graph/lineage",
            params={"repo_id": "adms", "include_calls": True}
        )
        assert response.status_code == 200
        data = response.json()

        if len(data["edges"]) > 0:
            edge = data["edges"][0]
            assert "from" in edge
            assert "to" in edge
            assert "type" in edge
