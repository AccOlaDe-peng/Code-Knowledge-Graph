"""graphs.py 三个视图接口的单元测试。"""
import pytest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient


# ─── Fixtures ────────────────────────────────────────────────────────────────

SAMPLE_GRAPH = {
    "nodes": [
        {"id": "n1", "type": "Module", "name": "auth", "properties": {}},
        {"id": "n2", "type": "Service", "name": "user-svc", "properties": {}},
        {"id": "n3", "type": "Function", "name": "login", "properties": {}},
    ],
    "edges": [
        {"from": "n1", "to": "n2", "type": "depends_on"},
        {"from": "n2", "to": "n3", "type": "calls"},
    ],
}

SAMPLE_CALL_SUBGRAPH = {
    "nodes": [{"id": "n3", "type": "Function", "name": "login", "properties": {}}],
    "edges": [{"from": "n3", "to": "n4", "type": "calls"}],
}


@pytest.fixture
def mock_graph_storage():
    storage = MagicMock()
    storage.load_graph.return_value = SAMPLE_GRAPH
    storage.get_subgraph.return_value = SAMPLE_CALL_SUBGRAPH
    return storage


@pytest.fixture
def client(mock_graph_storage):
    from backend.api.server import app
    # Patch the function that the endpoints call directly
    with patch("backend.api.routers.graphs.get_graph_storage", return_value=mock_graph_storage):
        with TestClient(app) as c:
            yield c


# ─── /graph/framework ────────────────────────────────────────────────────────

def test_framework_default_filters_architecture_nodes(client, mock_graph_storage):
    """默认返回架构层节点（Module/Service），过滤掉 Function。"""
    resp = client.get("/graph/framework", params={"repo_id": "my-repo"})
    assert resp.status_code == 200
    data = resp.json()
    types = {n["type"] for n in data["nodes"]}
    assert "Function" not in types
    assert "Module" in types or "Service" in types

def test_framework_node_types_all_returns_everything(client):
    """node_types=all 返回全部节点。"""
    resp = client.get("/graph/framework", params={"repo_id": "my-repo", "node_types": "all"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["node_count"] == 3

def test_framework_custom_node_types(client):
    """指定 node_types 只返回指定类型节点。"""
    resp = client.get("/graph/framework", params={"repo_id": "my-repo", "node_types": "Function"})
    assert resp.status_code == 200
    data = resp.json()
    assert all(n["type"] == "Function" for n in data["nodes"])

def test_framework_edges_only_between_returned_nodes(client):
    """edges 只包含两端节点都在结果集中的边。"""
    resp = client.get("/graph/framework", params={"repo_id": "my-repo", "node_types": "Module"})
    assert resp.status_code == 200
    data = resp.json()
    node_ids = {n["id"] for n in data["nodes"]}
    for edge in data["edges"]:
        assert edge["from"] in node_ids
        assert edge["to"] in node_ids

def test_framework_repo_not_found(client, mock_graph_storage):
    """repo_id 不存在返回 404。"""
    from backend.storage.graph_storage import RepoNotFoundError
    mock_graph_storage.load_graph.side_effect = RepoNotFoundError("missing")
    resp = client.get("/graph/framework", params={"repo_id": "missing"})
    assert resp.status_code == 404
    assert "repo not found" in resp.json()["detail"]


# ─── /graph/call ─────────────────────────────────────────────────────────────

def test_call_returns_call_subgraph(client):
    """无 node_id 时调用 get_subgraph('calls')。"""
    resp = client.get("/graph/call", params={"repo_id": "my-repo"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["repo_id"] == "my-repo"
    assert "nodes" in data and "edges" in data

def test_call_repo_not_found(client, mock_graph_storage):
    from backend.storage.graph_storage import RepoNotFoundError
    mock_graph_storage.get_subgraph.side_effect = RepoNotFoundError("missing")
    resp = client.get("/graph/call", params={"repo_id": "missing"})
    assert resp.status_code == 404


# ─── /graph/lineage ──────────────────────────────────────────────────────────

def test_lineage_returns_lineage_edges(client):
    """默认返回 depends_on 等血缘边。"""
    resp = client.get("/graph/lineage", params={"repo_id": "my-repo"})
    assert resp.status_code == 200
    data = resp.json()
    assert "edge_types" in data
    assert "depends_on" in data["edge_types"]

def test_lineage_custom_edge_types(client):
    """指定 edge_types 只返回指定类型的边。"""
    resp = client.get("/graph/lineage", params={"repo_id": "my-repo", "edge_types": "reads,writes"})
    assert resp.status_code == 200
    data = resp.json()
    assert set(data["edge_types"]) == {"reads", "writes"}
    for edge in data["edges"]:
        assert edge["type"] in {"reads", "writes"}

def test_lineage_repo_not_found(client, mock_graph_storage):
    from backend.storage.graph_storage import RepoNotFoundError
    mock_graph_storage.load_graph.side_effect = RepoNotFoundError("missing")
    resp = client.get("/graph/lineage", params={"repo_id": "missing"})
    assert resp.status_code == 404


# ─── /meta/node-types ─────────────────────────────────────────────────────────

def test_get_node_types(client):
    resp = client.get("/meta/node-types")
    assert resp.status_code == 200
    data = resp.json()
    assert "architecture_types" in data
    assert "structural_edge_types" in data
    assert "call_edge_types" in data
    assert "version" in data
    assert "Module" in data["architecture_types"]
    assert "Service" in data["architecture_types"]
    assert "contains" in data["structural_edge_types"]
    assert "calls" in data["call_edge_types"]
    assert isinstance(data["version"], str)


# ─── /graph/expand ────────────────────────────────────────────────────────────

def test_get_expand_basic(client):
    """展开存在的节点，返回正确结构。"""
    first_node_id = SAMPLE_GRAPH["nodes"][0]["id"]
    resp = client.get(f"/graph/expand?repo_id=test-repo&node_id={first_node_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["node_id"] == first_node_id
    assert "nodes" in data
    assert "edges" in data
    assert "node_count" in data
    assert "edge_count" in data
    assert isinstance(data["has_more"], bool)
    assert all(n["id"] != first_node_id for n in data["nodes"]), "root 节点不应出现在展开结果中"


def test_get_expand_node_not_found(client):
    """展开不存在的节点，返回 404。"""
    resp = client.get("/graph/expand?repo_id=test-repo&node_id=nonexistent-xyz")
    assert resp.status_code == 404


def test_get_expand_repo_not_found(mock_graph_storage):
    """仓库不存在时返回 404。"""
    from backend.storage.graph_storage import RepoNotFoundError
    # 覆盖 fixture 默认行为，让 load_graph 抛出 RepoNotFoundError
    mock_graph_storage.load_graph.side_effect = RepoNotFoundError("no-such-repo")
    from backend.api.server import app
    from unittest.mock import patch
    from fastapi.testclient import TestClient
    with patch("backend.api.routers.graphs.get_graph_storage", return_value=mock_graph_storage):
        with TestClient(app) as c:
            resp = c.get("/graph/expand?repo_id=no-such-repo&node_id=any")
    assert resp.status_code == 404
    assert "repo not found" in resp.json()["detail"]


def test_get_expand_depth_limit(client):
    """depth 超过最大值 3 时返回 422。"""
    first_node_id = SAMPLE_GRAPH["nodes"][0]["id"]
    resp = client.get(f"/graph/expand?repo_id=test-repo&node_id={first_node_id}&depth=4")
    assert resp.status_code == 422
