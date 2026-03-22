"""数据血缘分析 API 测试。"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock

from backend.api.server import app


client = TestClient(app)


class TestLineageImpactAPI:
    """变更影响评估 API 测试。"""

    def test_impact_invalid_change_type(self):
        """测试无效的 change_type 参数。"""
        response = client.post("/lineage/impact", json={
            "repo_id": "test-repo",
            "node_id": "service:TestService",
            "change_type": "invalid",
        })
        assert response.status_code == 400
        assert "无效的 change_type" in response.json()["detail"]

    @patch("backend.api.routers.graphs.get_graph_storage")
    def test_impact_repo_not_found(self, mock_get_storage):
        """测试仓库不存在的情况。"""
        from backend.storage.graph_storage import RepoNotFoundError
        mock_storage = MagicMock()
        mock_storage.load_graph.side_effect = RepoNotFoundError("not found")
        mock_get_storage.return_value = mock_storage

        response = client.post("/lineage/impact", json={
            "repo_id": "non-existent-repo",
            "node_id": "service:TestService",
            "change_type": "modify",
        })
        assert response.status_code == 404
        assert "repo not found" in response.json()["detail"]

    @patch("backend.api.routers.graphs.get_graph_storage")
    def test_impact_node_not_found(self, mock_get_storage):
        """测试节点不存在的情况。"""
        mock_storage = MagicMock()
        mock_storage.load_graph.return_value = {
            "nodes": [{"id": "service:Other", "type": "Service", "name": "Other"}],
            "edges": [],
        }
        mock_get_storage.return_value = mock_storage

        response = client.post("/lineage/impact", json={
            "repo_id": "test-repo",
            "node_id": "service:TestService",
            "change_type": "modify",
        })
        assert response.status_code == 404
        assert "节点不存在" in response.json()["detail"]

    @patch("backend.api.routers.graphs.get_graph_storage")
    def test_impact_success(self, mock_get_storage):
        """测试成功的变更影响评估。"""
        mock_storage = MagicMock()
        mock_storage.load_graph.return_value = {
            "nodes": [
                {"id": "service:TestService", "type": "Service", "name": "TestService"},
                {"id": "service:DownstreamService", "type": "Service", "name": "DownstreamService"},
                {"id": "api:GET:/test", "type": "APIEndpoint", "name": "GET /test"},
            ],
            "edges": [
                {"from": "service:TestService", "to": "service:DownstreamService", "type": "flow_to"},
                {"from": "service:DownstreamService", "to": "api:GET:/test", "type": "produces"},
            ],
        }
        mock_get_storage.return_value = mock_storage

        response = client.post("/lineage/impact", json={
            "repo_id": "test-repo",
            "node_id": "service:TestService",
            "change_type": "modify",
        })
        assert response.status_code == 200
        data = response.json()
        assert data["changed_node_id"] == "service:TestService"
        assert data["change_type"] == "modify"
        assert "risk_level" in data
        assert "affected_nodes" in data
        assert len(data["affected_apis"]) == 1


class TestLineageTraceAPI:
    """根因追溯 API 测试。"""

    def test_trace_invalid_type(self):
        """测试无效的 trace_type 参数。"""
        response = client.post("/lineage/trace", json={
            "repo_id": "test-repo",
            "node_id": "service:TestService",
            "trace_type": "invalid",
        })
        assert response.status_code == 400
        assert "无效的 trace_type" in response.json()["detail"]

    @patch("backend.api.routers.graphs.get_graph_storage")
    def test_trace_repo_not_found(self, mock_get_storage):
        """测试仓库不存在的情况。"""
        from backend.storage.graph_storage import RepoNotFoundError
        mock_storage = MagicMock()
        mock_storage.load_graph.side_effect = RepoNotFoundError("not found")
        mock_get_storage.return_value = mock_storage

        response = client.post("/lineage/trace", json={
            "repo_id": "non-existent-repo",
            "node_id": "service:TestService",
            "trace_type": "source",
        })
        assert response.status_code == 404
        assert "repo not found" in response.json()["detail"]

    @patch("backend.api.routers.graphs.get_graph_storage")
    def test_trace_source_only(self, mock_get_storage):
        """测试仅追溯数据源。"""
        mock_storage = MagicMock()
        # 注意：upstream 追踪是反向的，边应该从 source → target
        # 所以 Database → Service 才能被 upstream 找到
        mock_storage.load_graph.return_value = {
            "nodes": [
                {"id": "service:TestService", "type": "Service", "name": "TestService"},
                {"id": "db:primary", "type": "Database", "name": "PrimaryDB"},
            ],
            "edges": [
                # reads 边：Service reads from Database
                # upstream 追踪时，从 Service 找 Database 需要边是 Database → Service
                # 但 reads 边是 Service → Database，所以 upstream 找不到
                # 应该用正确的语义：Repository reads Database
                {"from": "db:primary", "to": "service:TestService", "type": "flow_to", "properties": {"confidence": 0.9}},
            ],
        }
        mock_get_storage.return_value = mock_storage

        response = client.post("/lineage/trace", json={
            "repo_id": "test-repo",
            "node_id": "service:TestService",
            "trace_type": "source",
        })
        assert response.status_code == 200
        data = response.json()
        assert data["trace_type"] == "source"
        assert "source_nodes" in data
        # 找到 Database 作为数据源
        assert len(data["source_nodes"]) == 1
        assert data["source_nodes"][0]["type"] == "Database"


class TestRiskLevelCalculation:
    """风险等级计算测试。"""

    def test_low_risk(self):
        """低风险场景。"""
        from backend.api.routers.graphs import _calculate_risk_level
        result = _calculate_risk_level(
            affected_count=3,
            has_api_impact=False,
            has_database_impact=False,
        )
        assert result == "low"

    def test_medium_risk(self):
        """中风险场景。"""
        from backend.api.routers.graphs import _calculate_risk_level
        result = _calculate_risk_level(
            affected_count=8,
            has_api_impact=True,
            has_database_impact=False,
        )
        assert result == "medium"

    def test_high_risk(self):
        """高风险场景。"""
        from backend.api.routers.graphs import _calculate_risk_level
        result = _calculate_risk_level(
            affected_count=25,
            has_api_impact=True,
            has_database_impact=True,
        )
        assert result == "high"

    def test_api_impact_escalates(self):
        """API 影响提升风险。"""
        from backend.api.routers.graphs import _calculate_risk_level
        # 6 个节点 (> 5, score +1) + API 影响 (score +2) = score 3 (medium)
        result = _calculate_risk_level(
            affected_count=6,
            has_api_impact=True,
            has_database_impact=False,
        )
        assert result == "medium"

    def test_database_impact_escalates(self):
        """数据库影响提升风险。"""
        from backend.api.routers.graphs import _calculate_risk_level
        # 6 个节点 (> 5, score +1) + 数据库影响 (score +2) = score 3 (medium)
        result = _calculate_risk_level(
            affected_count=6,
            has_api_impact=False,
            has_database_impact=True,
        )
        assert result == "medium"

    def test_low_count_with_api_is_low(self):
        """少量节点 + API 影响仍是低风险。"""
        from backend.api.routers.graphs import _calculate_risk_level
        # 5 个节点 (= 5, score 0) + API 影响 (score +2) = score 2 (low)
        result = _calculate_risk_level(
            affected_count=5,
            has_api_impact=True,
            has_database_impact=False,
        )
        assert result == "low"


class TestTransformationChain:
    """转换链构建测试。"""

    def test_empty_chain(self):
        """空链路测试。"""
        from backend.api.routers.graphs import _build_transformation_chain
        result = _build_transformation_chain(
            target_node_id="service:Test",
            nodes=[],
            edges=[],
        )
        assert result == []

    def test_single_node_chain(self):
        """单节点链路测试。"""
        from backend.api.routers.graphs import _build_transformation_chain
        nodes = [
            {"id": "service:Test", "name": "TestService", "type": "Service"},
        ]
        edges = []
        result = _build_transformation_chain(
            target_node_id="service:Test",
            nodes=nodes,
            edges=edges,
        )
        assert len(result) == 1
        assert result[0]["name"] == "TestService"


class TestTraceConfidence:
    """追溯置信度计算测试。"""

    def test_empty_graph(self):
        """空图谱置信度。"""
        from backend.api.routers.graphs import _calculate_trace_confidence
        result = _calculate_trace_confidence(nodes=[], edges=[])
        assert result == 0.5

    def test_with_source(self):
        """有数据源的置信度。"""
        from backend.api.routers.graphs import _calculate_trace_confidence
        nodes = [
            {"id": "db:primary", "type": "Database", "name": "PrimaryDB"},
            {"id": "service:Test", "type": "Service", "name": "TestService"},
        ]
        edges = [
            {"from": "service:Test", "to": "db:primary", "type": "reads", "properties": {"confidence": 0.9}},
        ]
        result = _calculate_trace_confidence(nodes=nodes, edges=edges)
        assert result >= 0.9  # 高置信度
