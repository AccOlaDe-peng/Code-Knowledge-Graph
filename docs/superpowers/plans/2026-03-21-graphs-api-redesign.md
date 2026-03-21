# Graph API 重设计实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 清理 graphs.py 双轨 API，统一到 GraphStorage（repo_id），暴露框架图/调用图/血缘图三个语义清晰的视图接口。

**Architecture:** Celery 任务在 GraphRepository.save() 后同时写入 GraphStorage，使其成为 API serving 层。graphs.py 完全重写为 3 个纯只读 GET 接口。前端迁移 7 处调用点，统一参数名为 repo_id。

**Tech Stack:** Python 3.x / FastAPI / Pydantic v2 / Celery / TypeScript / Zustand / Axios

**Spec:** `docs/superpowers/specs/2026-03-21-graphs-api-redesign.md`

---

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `code-graph-system/backend/graph/graph_schema.py` | 修改 | 新增 `ARCHITECTURE_NODE_TYPES` 常量 |
| `code-graph-system/backend/scheduler/tasks.py` | 修改 | 2 处 `graph_repo.save()` 后追加 GraphStorage 写入 |
| `code-graph-system/backend/api/routers/graphs.py` | 重写 | 3 个新接口替换全部旧接口 |
| `code-graph-system/backend/api/routers/repos.py` | 修改 | DELETE 扩展：增加 GraphStorage + repo_status_store 清理 |
| `code-graph-system/backend/tests/test_graphs_api.py` | 新建 | 三个视图接口的单元测试 |
| `code-graph-ui/src/api/graphApi.ts` | 修改 | 新增 framework/call/lineage 方法，移除旧方法 |
| `code-graph-ui/src/store/graphStore.ts` | 修改 | 使用新接口，移除 fallback 逻辑 |
| `code-graph-ui/src/graph-engine/loader/GraphLoader.ts` | 修改 | `/graph/summary` → `/graph/framework?node_types=Repository,Module` |
| `code-graph-ui/src/core/api/endpoints/graph.ts` | 修改 | 同步新接口，移除旧端点 |

---

## Task 1：新增 ARCHITECTURE_NODE_TYPES 常量

**Files:**
- Modify: `code-graph-system/backend/graph/graph_schema.py`（在 `_VALID_NODE_TYPES` 附近添加）

- [ ] **Step 1：写失败测试**

在 `code-graph-system/backend/tests/` 中找到或新建 `test_graph_schema.py`，加入：

```python
# code-graph-system/backend/tests/test_graph_schema.py
def test_architecture_node_types_exist():
    from backend.graph.graph_schema import ARCHITECTURE_NODE_TYPES, NodeType
    assert isinstance(ARCHITECTURE_NODE_TYPES, frozenset)
    # 每个值必须是合法的 NodeType
    valid = {t.value for t in NodeType}
    for t in ARCHITECTURE_NODE_TYPES:
        assert t in valid, f"'{t}' 不在 NodeType 枚举中"

def test_architecture_node_types_excludes_code_detail():
    from backend.graph.graph_schema import ARCHITECTURE_NODE_TYPES
    # Class 和 Function 是细粒度代码元素，不应在架构层
    assert "Class" not in ARCHITECTURE_NODE_TYPES
    assert "Function" not in ARCHITECTURE_NODE_TYPES
    assert "File" not in ARCHITECTURE_NODE_TYPES
```

- [ ] **Step 2：运行确认失败**

```bash
cd code-graph-system
source venv/bin/activate
pytest backend/tests/test_graph_schema.py -v
```

预期：`ImportError: cannot import name 'ARCHITECTURE_NODE_TYPES'`

- [ ] **Step 3：在 graph_schema.py 中添加常量**

在 `_VALID_NODE_TYPES` 行（约第 122 行）后面添加：

```python
# 架构视图默认展示的节点类型（高层节点，不含 Class/Function 等细粒度元素）
ARCHITECTURE_NODE_TYPES: frozenset[str] = frozenset({
    "Module", "Component", "Service", "API", "APIEndpoint",
    "Database", "Layer", "Domain", "BoundedContext",
    "DataSource", "DataSink", "ExternalAPI",
})
```

- [ ] **Step 4：运行确认通过**

```bash
pytest backend/tests/test_graph_schema.py -v
```

预期：2 个测试 PASS

- [ ] **Step 5：提交**

```bash
git add backend/graph/graph_schema.py backend/tests/test_graph_schema.py
git commit -m "feat: add ARCHITECTURE_NODE_TYPES constant to graph_schema"
```

---

## Task 2：Celery 主任务写入 GraphStorage（analyze_repository）

**Files:**
- Modify: `code-graph-system/backend/scheduler/tasks.py`（第 540 行 `built = result.built` 之后）

- [ ] **Step 1：写失败测试**

```python
# code-graph-system/backend/tests/test_tasks_graph_storage.py
from unittest.mock import MagicMock, patch

def test_analyze_repository_writes_to_graph_storage(tmp_path):
    """analyze_repository 成功后应写入 GraphStorage。"""
    # 用 mock 替换 GraphStorage，断言 save_graph 被调用
    mock_storage = MagicMock()

    with patch("backend.storage.graph_storage.GraphStorage") as MockStorage:
        MockStorage.return_value = mock_storage
        # 直接测试写入辅助函数（_write_to_graph_storage 中使用局部 import，
        # patch 目标是类本身，MockStorage.return_value 才是实例）
        from backend.scheduler.tasks import _write_to_graph_storage
        from backend.graph.graph_schema import GraphNode, GraphEdge

        nodes = [GraphNode(id="n1", type="Module", name="auth")]
        edges = [GraphEdge(from_="n1", to="n2", type="depends_on")]
        _write_to_graph_storage("my-repo", nodes, edges)

    mock_storage.save_graph.assert_called_once()
    call_kwargs = mock_storage.save_graph.call_args
    assert call_kwargs.kwargs["repo_id"] == "my-repo"
    assert "nodes" in call_kwargs.kwargs["graph"]
    assert "edges" in call_kwargs.kwargs["graph"]
```

- [ ] **Step 2：运行确认失败**

```bash
pytest backend/tests/test_tasks_graph_storage.py -v
```

预期：`ImportError: cannot import name '_write_to_graph_storage'`

- [ ] **Step 3：在 tasks.py 中添加辅助函数和写入调用**

在 `tasks.py` 顶部 import 区域后面（文件头部附近）添加辅助函数：

```python
def _write_to_graph_storage(repo_name: str, nodes: list, edges: list) -> None:
    """将 BuiltGraph 节点/边写入 GraphStorage（API serving 层）。

    失败只记录 warning，不中断主流程。
    """
    try:
        from backend.storage.graph_storage import GraphStorage
        graph_storage = GraphStorage()  # 直接实例化，Celery Worker 中 lifespan 未执行
        graph_storage.save_graph(
            repo_id=repo_name,
            graph={
                "nodes": [n.model_dump() for n in nodes],
                "edges": [e.model_dump(by_alias=True) for e in edges],
            },
        )
        logger.info("GraphStorage 写入成功: repo=%s  nodes=%d  edges=%d",
                    repo_name, len(nodes), len(edges))
    except Exception as exc:
        logger.warning("GraphStorage 写入失败（不影响主流程）repo=%s: %s", repo_name, exc)
```

然后在 `analyze_repository` 任务的成功路径（约第 540 行 `built = result.built` 之后）插入调用：

```python
built = result.built
duration = round(time.time() - t_start, 3)

# 同时写入 GraphStorage（API serving 层）
if built is not None:
    _write_to_graph_storage(repo_name or path.name, built.nodes, built.edges)
```

- [ ] **Step 4：运行确认通过**

```bash
pytest backend/tests/test_tasks_graph_storage.py -v
```

预期：PASS

- [ ] **Step 5：提交**

```bash
git add backend/scheduler/tasks.py backend/tests/test_tasks_graph_storage.py
git commit -m "feat: write BuiltGraph to GraphStorage after analyze_repository"
```

---

## Task 3：Celery 增量任务写入 GraphStorage（_run_full_and_wrap）

**Files:**
- Modify: `code-graph-system/backend/scheduler/tasks.py`（第 833 行 `graph_repo.save()` 之后）

- [ ] **Step 1：扩展测试**

在 `test_tasks_graph_storage.py` 追加：

```python
def test_write_to_graph_storage_handles_failure_gracefully():
    """GraphStorage 写入失败时不应抛出异常。"""
    with patch("backend.storage.graph_storage.GraphStorage") as MockStorage:
        MockStorage.return_value.save_graph.side_effect = RuntimeError("disk full")
        from backend.scheduler.tasks import _write_to_graph_storage
        from backend.graph.graph_schema import GraphNode, GraphEdge
        # 不应抛出异常
        _write_to_graph_storage("repo", [], [])
```

- [ ] **Step 2：运行确认通过**（`_write_to_graph_storage` 已有 try/except）

```bash
pytest backend/tests/test_tasks_graph_storage.py -v
```

预期：所有测试 PASS

- [ ] **Step 3：在 `_run_full_and_wrap` 中添加写入**

在约第 833 行 `graph_repo.save(built, repo_name=repo_name)` 之后：

```python
graph_repo.save(built, repo_name=repo_name)
# 同时写入 GraphStorage（API serving 层）
if built is not None:
    _write_to_graph_storage(repo_name, built.nodes, built.edges)
```

- [ ] **Step 4：提交**

```bash
git add backend/scheduler/tasks.py backend/tests/test_tasks_graph_storage.py
git commit -m "feat: write BuiltGraph to GraphStorage in incremental_update path"
```

---

## Task 4：重写 graphs.py

**Files:**
- Rewrite: `code-graph-system/backend/api/routers/graphs.py`
- Create: `code-graph-system/backend/tests/test_graphs_api.py`

- [ ] **Step 1：写失败测试**

```python
# code-graph-system/backend/tests/test_graphs_api.py
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
    from backend.api import deps
    with patch.object(deps, "get_graph_storage", return_value=mock_graph_storage):
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
```

- [ ] **Step 2：运行确认失败**

```bash
pytest backend/tests/test_graphs_api.py -v
```

预期：多个测试失败（`/graph/framework` 等端点不存在）

- [ ] **Step 3：重写 graphs.py**

用以下内容**完整替换** `backend/api/routers/graphs.py`：

```python
"""图谱视图 API：三个语义清晰的只读视图接口。

路由：
  GET /graph/framework  — 架构图（高层节点，可过滤类型）
  GET /graph/call       — 调用图（calls 边 + 相关节点，可 BFS 展开）
  GET /graph/lineage    — 血缘图（depends_on/reads/writes 等边，可 BFS 展开）
"""
from __future__ import annotations

import logging
from collections import deque
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query

from backend.api.deps import get_graph_storage
from backend.graph.graph_schema import ARCHITECTURE_NODE_TYPES
from backend.storage.graph_storage import RepoNotFoundError

logger = logging.getLogger(__name__)
router = APIRouter()

_LINEAGE_EDGE_TYPES = frozenset({
    "depends_on", "reads", "writes", "produces", "consumes", "imports",
})


# ── Helpers ───────────────────────────────────────────────────────────────────


def _storage_load_or_404(repo_id: str) -> dict[str, Any]:
    try:
        return get_graph_storage().load_graph(repo_id)
    except RepoNotFoundError:
        raise HTTPException(status_code=404, detail=f"repo not found: {repo_id}")
    except Exception as exc:
        logger.exception("GraphStorage 读取失败: %s", repo_id)
        raise HTTPException(status_code=500, detail=str(exc))


def _bfs_subgraph(
    nodes: list[dict],
    edges: list[dict],
    root_id: str,
    edge_types: frozenset[str],
    depth: int,
) -> dict[str, Any]:
    """从 root_id 出发，BFS 展开指定边类型的子图，最多 depth 层。"""
    node_map = {n["id"]: n for n in nodes if n.get("id")}
    if root_id not in node_map:
        raise HTTPException(status_code=404, detail=f"node not found: {root_id}")

    visited: set[str] = {root_id}
    queue: deque[tuple[str, int]] = deque([(root_id, 0)])
    result_edges: list[dict] = []

    while queue:
        current_id, current_depth = queue.popleft()
        if current_depth >= depth:
            continue
        for edge in edges:
            if edge.get("type") not in edge_types:
                continue
            neighbor = None
            if edge.get("from") == current_id:
                neighbor = edge.get("to")
            elif edge.get("to") == current_id:
                neighbor = edge.get("from")
            if neighbor and neighbor not in visited:
                visited.add(neighbor)
                result_edges.append(edge)
                queue.append((neighbor, current_depth + 1))
            elif neighbor and edge not in result_edges:
                result_edges.append(edge)

    result_nodes = [node_map[nid] for nid in visited if nid in node_map]
    return {"nodes": result_nodes, "edges": result_edges}


def _filter_by_edge_types(
    nodes: list[dict],
    edges: list[dict],
    edge_types: frozenset[str],
) -> dict[str, Any]:
    """返回指定边类型的边及其涉及的节点。"""
    filtered_edges = [e for e in edges if e.get("type") in edge_types]
    involved_ids: set[str] = set()
    for e in filtered_edges:
        if e.get("from"):
            involved_ids.add(e["from"])
        if e.get("to"):
            involved_ids.add(e["to"])
    node_map = {n["id"]: n for n in nodes if n.get("id")}
    filtered_nodes = [node_map[nid] for nid in involved_ids if nid in node_map]
    return {"nodes": filtered_nodes, "edges": filtered_edges}


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.get("/graph/framework", tags=["图谱视图"])
def get_framework(
    repo_id: str = Query(description="仓库 ID"),
    node_types: Optional[str] = Query(
        default=None,
        description="逗号分隔的节点类型（PascalCase）；不传使用架构层默认集合；传 'all' 返回全部节点",
    ),
) -> dict[str, Any]:
    """
    架构图视图。

    返回高层架构节点及其连接关系。默认过滤掉 Class/Function 等细粒度节点。
    edges 只包含两端节点都在结果集内的边。

    - ``node_types`` 不传：返回 ARCHITECTURE_NODE_TYPES 定义的架构层节点
    - ``node_types=all``：返回全部节点（替代旧 /graph/data）
    - ``node_types=Module,File``：只返回指定类型（替代旧 /graph/module）
    """
    graph = _storage_load_or_404(repo_id)
    all_nodes: list[dict] = graph.get("nodes", [])
    all_edges: list[dict] = graph.get("edges", [])

    if node_types == "all":
        result_nodes = all_nodes
    else:
        target_types = (
            {t.strip() for t in node_types.split(",") if t.strip()}
            if node_types
            else ARCHITECTURE_NODE_TYPES
        )
        result_nodes = [n for n in all_nodes if n.get("type") in target_types]

    result_node_ids = {n["id"] for n in result_nodes if n.get("id")}
    result_edges = [
        e for e in all_edges
        if e.get("from") in result_node_ids and e.get("to") in result_node_ids
    ]

    return {
        "repo_id": repo_id,
        "node_count": len(result_nodes),
        "edge_count": len(result_edges),
        "nodes": result_nodes,
        "edges": result_edges,
    }


@router.get("/graph/call", tags=["图谱视图"])
def get_call(
    repo_id: str = Query(description="仓库 ID"),
    node_id: Optional[str] = Query(default=None, description="起点节点 ID；指定后 BFS 展开调用子图"),
    depth: int = Query(default=2, ge=1, le=5, description="BFS 深度（仅 node_id 有效时生效）"),
) -> dict[str, Any]:
    """
    调用图视图。

    - 不传 ``node_id``：返回全图 calls 边及相关节点（读预生成 call-graph.json）
    - 传入 ``node_id``：从该节点 BFS 展开调用子图
    """
    storage = get_graph_storage()

    if node_id is None:
        try:
            subgraph = storage.get_subgraph(repo_id, "calls")
        except RepoNotFoundError:
            raise HTTPException(status_code=404, detail=f"repo not found: {repo_id}")
        except Exception as exc:
            logger.exception("get_subgraph(calls) 失败: %s", repo_id)
            raise HTTPException(status_code=500, detail=str(exc))
        nodes = subgraph.get("nodes", [])
        edges = subgraph.get("edges", [])
    else:
        graph = _storage_load_or_404(repo_id)
        result = _bfs_subgraph(
            graph.get("nodes", []),
            graph.get("edges", []),
            node_id,
            frozenset({"calls"}),
            depth,
        )
        nodes = result["nodes"]
        edges = result["edges"]

    return {
        "repo_id": repo_id,
        "node_count": len(nodes),
        "edge_count": len(edges),
        "nodes": nodes,
        "edges": edges,
    }


@router.get("/graph/lineage", tags=["图谱视图"])
def get_lineage(
    repo_id: str = Query(description="仓库 ID"),
    edge_types: Optional[str] = Query(
        default=None,
        description="逗号分隔的边类型，默认全部血缘边类型",
    ),
    node_id: Optional[str] = Query(default=None, description="起点节点 ID；指定后 BFS 展开血缘子图"),
    depth: int = Query(default=2, ge=1, le=5, description="BFS 深度（仅 node_id 有效时生效）"),
) -> dict[str, Any]:
    """
    数据血缘视图。

    默认追踪：depends_on / reads / writes / produces / consumes / imports。

    - 不传 ``node_id``：返回全图血缘边及相关节点
    - 传入 ``node_id``：从该节点 BFS 展开血缘路径
    """
    target_types = (
        frozenset(t.strip() for t in edge_types.split(",") if t.strip())
        if edge_types
        else _LINEAGE_EDGE_TYPES
    )

    graph = _storage_load_or_404(repo_id)
    all_nodes = graph.get("nodes", [])
    all_edges = graph.get("edges", [])

    if node_id is not None:
        result = _bfs_subgraph(all_nodes, all_edges, node_id, target_types, depth)
    else:
        result = _filter_by_edge_types(all_nodes, all_edges, target_types)

    return {
        "repo_id":    repo_id,
        "edge_types": sorted(target_types),
        "node_count": len(result["nodes"]),
        "edge_count": len(result["edges"]),
        "nodes":      result["nodes"],
        "edges":      result["edges"],
    }
```

- [ ] **Step 4：运行测试确认通过**

```bash
pytest backend/tests/test_graphs_api.py -v
```

预期：所有测试 PASS

- [ ] **Step 5：提交**

```bash
git add backend/api/routers/graphs.py backend/tests/test_graphs_api.py
git commit -m "feat: rewrite graphs.py with framework/call/lineage endpoints"
```

---

## Task 5：扩展 repos.py DELETE（增加 GraphStorage 清理）

**Files:**
- Modify: `code-graph-system/backend/api/routers/repos.py`（`delete_repo` 函数，约第 134 行）

- [ ] **Step 1：写失败测试**

```python
# code-graph-system/backend/tests/test_repos_delete.py
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient


def test_delete_repo_cleans_graph_storage():
    """DELETE /repos/{repo_id} 应调用 GraphStorage.delete_repo。"""
    mock_storage = MagicMock()
    mock_repo_store = MagicMock()
    mock_analysis_store = MagicMock()
    mock_analysis_store.list_by_repo.return_value = []

    with patch("backend.storage.graph_storage.GraphStorage") as MockGS, \
         patch("backend.store.repo_store.get_repo_store", return_value=mock_repo_store), \
         patch("backend.store.analysis_store.get_analysis_store", return_value=mock_analysis_store):
        MockGS.return_value = mock_storage
        from backend.api.server import app
        client = TestClient(app)
        client.delete("/repos/test-repo")

    mock_storage.delete_repo.assert_called_once_with("test-repo")
```

- [ ] **Step 2：运行确认失败**

```bash
pytest backend/tests/test_repos_delete.py -v
```

预期：`AssertionError: Expected call not found`（当前 delete_repo 未调用 GraphStorage）

- [ ] **Step 3：修改 delete_repo 函数**

在 `analysis_store.delete_by_repo(repo_id)` 和 `store.delete(repo_id)` 之前，插入：

```python
    # 删除 GraphStorage 中的图谱文件（新体系）
    try:
        from backend.storage.graph_storage import GraphStorage
        GraphStorage().delete_repo(repo_id)
    except Exception as exc:
        logger.warning("删除 GraphStorage 失败 repo_id=%s: %s", repo_id, exc)

    # 删除运行时状态记录
    try:
        from backend.store.repo_status_store import get_repo_status_store
        get_repo_status_store().delete(repo_id)
    except Exception as exc:
        logger.warning("删除 repo_status_store 失败 repo_id=%s: %s", repo_id, exc)
```

- [ ] **Step 4：运行确认全部测试通过**

```bash
pytest backend/tests/test_repos_delete.py backend/tests/test_repos_api.py -v
```

预期：全部 PASS（新增逻辑有 try/except 保护，不影响现有测试）

- [ ] **Step 5：提交**

```bash
git add backend/api/routers/repos.py backend/tests/test_repos_delete.py
git commit -m "feat: extend DELETE /repos/{repo_id} to clean GraphStorage and status store"
```

---

## Task 6：前端——更新 graphApi.ts

**Files:**
- Modify: `code-graph-ui/src/api/graphApi.ts`

- [ ] **Step 1：新增三个视图方法，移除旧方法**

在 `graphApi` 对象中：
- **移除**：`getCallGraph`、`getLineageGraph`、`getCallSubgraph`、`getModuleSubgraph`、`getGraphData`
- **新增**：`getFramework`、`getCallView`、`getLineageView`
- **保留**：`listGraphs`（切换为调用 `/repos`）、`getGraph`（改为调用 `/graph/framework?node_types=all`）

```typescript
// graphApi.ts 中替换相关方法

  /**
   * GET /repos — 替代旧 GET /graph（列表模式）
   */
  async listGraphs(): Promise<GraphListResponse> {
    const now = Date.now()
    if (graphListCache && now - graphListCache.at < GRAPH_LIST_CACHE_WINDOW_MS) {
      return graphListCache.data
    }
    if (graphListInFlight) return graphListInFlight

    graphListInFlight = (async () => {
      const raw: { repos: Record<string, unknown>[] } = await httpClient.get('/repos')
      const data: GraphListResponse = {
        graphs: (raw.repos ?? []).map((g) => ({
          repoId:          g.id as string,
          graphId:         (g.graph_id ?? g.id) as string,
          repoName:        g.name as string,
          language:        (g.language ?? []) as string[],
          createdAt:       g.created_at as string,
          updatedAt:       (g.updated_at ?? g.created_at) as string,
          nodeCount:       (g.node_count ?? 0) as number,
          edgeCount:       (g.edge_count ?? 0) as number,
          sourceMode:      (g.source_mode ?? 'local') as 'local' | 'git' | 'zip',
          repoPath:        g.path as string | undefined,
          status:          (g.status ?? 'completed') as string,
          taskId:          g.task_id as string | undefined,
          analysisStage:   g.stage as string | undefined,
          analysisStep:    g.step as number | undefined,
          analysisTotal:   g.total as number | undefined,
          analysisMessage: g.message as string | undefined,
          error:           g.error as string | undefined,
        })),
      }
      graphListCache = { at: Date.now(), data }
      return data
    })()

    try { return await graphListInFlight } finally { graphListInFlight = null }
  },

  /**
   * GET /graph/framework?node_types=all — 替代旧 GET /graph?graph_id=
   */
  getGraph(repoId: string): Promise<GraphDetailResponse> {
    return httpClient.get('/graph/framework', { params: { repo_id: repoId, node_types: 'all' } })
  },

  /**
   * GET /graph/framework — 架构图视图
   */
  getFramework(repoId: string, nodeTypes?: string): Promise<{
    repo_id: string; node_count: number; edge_count: number;
    nodes: RawNode[]; edges: RawEdge[];
  }> {
    return httpClient.get('/graph/framework', {
      params: { repo_id: repoId, ...(nodeTypes ? { node_types: nodeTypes } : {}) },
    })
  },

  /**
   * GET /graph/call — 调用图视图
   */
  getCallView(repoId: string, nodeId?: string, depth?: number): Promise<{
    repo_id: string; node_count: number; edge_count: number;
    nodes: RawNode[]; edges: RawEdge[];
  }> {
    return httpClient.get('/graph/call', {
      params: { repo_id: repoId, ...(nodeId ? { node_id: nodeId, depth } : {}) },
    })
  },

  /**
   * GET /graph/lineage — 血缘视图
   */
  getLineageView(repoId: string, opts?: { edgeTypes?: string; nodeId?: string; depth?: number }): Promise<{
    repo_id: string; edge_types: string[]; node_count: number; edge_count: number;
    nodes: RawNode[]; edges: RawEdge[];
  }> {
    return httpClient.get('/graph/lineage', {
      params: { repo_id: repoId, ...opts && {
        ...(opts.edgeTypes ? { edge_types: opts.edgeTypes } : {}),
        ...(opts.nodeId ? { node_id: opts.nodeId, depth: opts.depth } : {}),
      }},
    })
  },
```

- [ ] **Step 2：运行 lint**

```bash
cd code-graph-ui
npm run lint
```

预期：无类型错误

- [ ] **Step 3：提交**

```bash
git add src/api/graphApi.ts
git commit -m "feat: update graphApi.ts to use new framework/call/lineage endpoints"
```

---

## Task 7：前端——更新 graphStore.ts

**Files:**
- Modify: `code-graph-ui/src/store/graphStore.ts`

- [ ] **Step 1：更新 store loaders**

替换以下函数：

```typescript
  // 替换 loadGraph：使用 /graph/framework?node_types=all
  // 注：原 loadGraph 使用内联规范化（raw.label ?? raw.name ?? id-derived），
  // rawNodeToGraphNode 等价（label = n.name || id-derived），可直接替换。
  loadGraph: async (repoId) => {
    set({ graph: { data: null, loading: true, error: null } })
    try {
      const res = await graphApi.getFramework(repoId, 'all')
      const data = {
        nodes: res.nodes.map(rawNodeToGraphNode),
        edges: res.edges.map(rawEdgeToGraphEdge),
      }
      set({ graph: { data, loading: false, error: null } })
    } catch (e) {
      set({ graph: { data: null, loading: false, error: String(e) } })
    }
  },

  // 替换 loadCallGraph：移除 fallback，直接用 /graph/call
  loadCallGraph: async (repoId) => {
    set({ callGraph: { data: null, loading: true, error: null } })
    try {
      const res = await graphApi.getCallView(repoId)
      const graph = {
        nodes: res.nodes.map(rawNodeToGraphNode),
        edges: res.edges.map(rawEdgeToGraphEdge),
      }
      set({ callGraph: { data: graph, loading: false, error: null } })
    } catch (e) {
      set({ callGraph: { data: null, loading: false, error: String(e) } })
    }
  },

  // 替换 loadLineage：使用 /graph/lineage
  loadLineage: async (repoId) => {
    set({ lineageGraph: { data: null, loading: true, error: null } })
    try {
      const res = await graphApi.getLineageView(repoId)
      const graph = {
        nodes: res.nodes.map(rawNodeToGraphNode),
        edges: res.edges.map(rawEdgeToGraphEdge),
      }
      set({ lineageGraph: { data: graph, loading: false, error: null } })
    } catch (e) {
      set({ lineageGraph: { data: null, loading: false, error: String(e) } })
    }
  },

  // 替换 loadModuleGraph：使用 /graph/framework?node_types=Module,File
  loadModuleGraph: async (repoId) => {
    set({ moduleGraph: { data: null, loading: true, error: null } })
    try {
      const res = await graphApi.getFramework(repoId, 'Module,File')
      const graph = {
        nodes: res.nodes.map(rawNodeToGraphNode),
        edges: res.edges.map(rawEdgeToGraphEdge),
      }
      set({ moduleGraph: { data: graph, loading: false, error: null } })
    } catch (e) {
      set({ moduleGraph: { data: null, loading: false, error: String(e) } })
    }
  },

  // 替换 loadFullGraph：使用 /graph/framework?node_types=all
  loadFullGraph: async (repoId) => {
    set({ fullGraph: { data: null, loading: true, error: null } })
    try {
      const res = await graphApi.getFramework(repoId, 'all')
      const graph = {
        nodes: res.nodes.map(rawNodeToGraphNode),
        edges: res.edges.map(rawEdgeToGraphEdge),
      }
      set({ fullGraph: { data: graph, loading: false, error: null } })
    } catch (e) {
      set({ fullGraph: { data: null, loading: false, error: String(e) } })
    }
  },
```

注意：
- `loadEvents` 函数体**不变**（`/events` 端点不在本次范围，保留现有调用方式），只修改参数名 `graphId` → `repoId`。
- 所有其他 loader 函数体替换为上方版本。

- [ ] **Step 2：更新 GraphStore 类型中的函数签名**

```typescript
  // 所有 loader 参数名从 graphId 改为 repoId
  loadGraph:       (repoId: string) => Promise<void>
  loadCallGraph:   (repoId: string) => Promise<void>
  loadLineage:     (repoId: string) => Promise<void>
  loadEvents:      (repoId: string) => Promise<void>
  loadModuleGraph: (repoId: string) => Promise<void>
  loadFullGraph:   (repoId: string) => Promise<void>
```

- [ ] **Step 3：运行 lint**

```bash
npm run lint
```

预期：无 TypeScript 错误（如有调用方传 graphId 的地方，一并修改）

- [ ] **Step 4：提交**

```bash
git add src/store/graphStore.ts
git commit -m "feat: update graphStore.ts to use new graph endpoints, remove fallback"
```

---

## Task 8：前端——更新 GraphLoader.ts 和 core/api/endpoints/graph.ts

**Files:**
- Modify: `code-graph-ui/src/graph-engine/loader/GraphLoader.ts`
- Modify: `code-graph-ui/src/core/api/endpoints/graph.ts`

- [ ] **Step 1：更新 `types.ts` 中的 `SummaryParams` 类型**

`/graph/framework` 响应格式与旧 `SummaryResponse` 字段不同（`repo_id` vs `graph_id`，`node_count` vs `total_node_count`）。
先更新 `src/graph-engine/loader/types.ts` 中的 `SummaryParams`：

```typescript
// 旧：
// export type SummaryParams = {
//   graph_id: string
// }

// 新：
export type SummaryParams = {
  repo_id: string
}
```

`SummaryResponse` 类型保持不变（内部仍用 `graph_id`/`total_node_count`），在 `fetchSummary` 中手动映射新响应字段（见下方 Step 2）。

- [ ] **Step 2：更新 `GraphLoader.ts` 中的 `fetchSummary` 和 `fetchSummaryFallback`**

**`fetchSummary`**（约第 276-292 行）：

```typescript
private async fetchSummary(): Promise<SummaryResponse> {
  const signal = this.abortController?.signal

  type FrameworkRaw = {
    repo_id:    string
    node_count: number
    edge_count: number
    nodes:      RawNode[]
    edges:      RawEdge[]
  }

  try {
    const raw = await apiClient.get<FrameworkRaw>('/graph/framework', {
      params: { repo_id: this.graphId, node_types: 'Repository,Module' },
      signal,
    })
    // 映射新字段名到 SummaryResponse 结构（保持下游消费者不变）
    return {
      graph_id:          this.graphId,
      nodes:             raw.nodes,
      edges:             raw.edges,
      total_node_count:  raw.node_count,
      total_edge_count:  raw.edge_count,
    }
  } catch (err) {
    if (isNotFound(err)) {
      return this.fetchSummaryFallback(signal)
    }
    throw err
  }
}
```

**`fetchSummaryFallback`**（约第 298-333 行）：

```typescript
private async fetchSummaryFallback(
  signal?: AbortSignal,
): Promise<SummaryResponse> {
  type FrameworkRaw = {
    repo_id: string; node_count: number; edge_count: number;
    nodes: RawNode[]; edges: RawEdge[]
  }

  const raw = await apiClient.get<FrameworkRaw>('/graph/framework', {
    params: { repo_id: this.graphId, node_types: 'all' },
    signal,
  })

  const summaryTypes = new Set(['Repository', 'Module'])
  let summaryNodes = raw.nodes.filter(n => summaryTypes.has(n.type))
  let summaryEdges: RawEdge[]

  if (summaryNodes.length === 0) {
    summaryNodes = raw.nodes
    summaryEdges = raw.edges
  } else {
    const summaryNodeIds = new Set(summaryNodes.map(n => n.id))
    summaryEdges = raw.edges.filter(
      e => summaryNodeIds.has(e.from) && summaryNodeIds.has(e.to),
    )
  }

  return {
    graph_id:         this.graphId,
    nodes:            summaryNodes,
    edges:            summaryEdges,
    total_node_count: raw.node_count,
    total_edge_count: raw.edge_count,
  }
}
```

注意：`GraphLoader` 的 `graphId` 字段在构造时传入的值即为 `repoId`，字段名可保持不变（避免大范围重构）。

- [ ] **Step 3：更新 core/api/endpoints/graph.ts**

在 `graphEndpoints` 中：
- 将 `listGraphs()` 改为调用 `/repos`（同 graphApi.ts 的修改方式，详见 Task 6）
- 将 `getGraph()` 改为调用 `/graph/framework?node_types=all`
- 将 `getCallGraph()` 改为调用 `/graph/call`，参数改为 `repo_id`
- 将 `getLineageGraph()` 改为调用 `/graph/lineage`，参数改为 `repo_id`
- **`getEventsGraph` 和 `getServicesGraph` 保留不动**（`/events`、`/services` 不在本次范围）

```typescript
  async getGraph(repoId: string): Promise<GraphDetailResponse> {
    return apiClient.get('/graph/framework', { params: { repo_id: repoId, node_types: 'all' } })
  },

  async getCallGraph(repoId: string): Promise<CallGraphResponse> {
    return apiClient.get('/graph/call', { params: { repo_id: repoId } })
  },

  async getLineageGraph(repoId: string): Promise<LineageGraphResponse> {
    return apiClient.get('/graph/lineage', { params: { repo_id: repoId } })
  },
```

- [ ] **Step 4：运行 lint**

```bash
npm run lint
```

预期：无类型错误

- [ ] **Step 5：提交**

```bash
git add src/graph-engine/loader/types.ts src/graph-engine/loader/GraphLoader.ts src/core/api/endpoints/graph.ts
git commit -m "feat: update GraphLoader and core endpoints to use new graph API"
```

---

## Task 9：集成验证

- [ ] **Step 1：启动后端，确认新接口可访问**

```bash
cd code-graph-system
source venv/bin/activate
python -m uvicorn backend.api.server:app --port 8000 --reload
```

访问 http://localhost:8000/docs，确认：
- `GET /graph/framework` 存在
- `GET /graph/call` 存在
- `GET /graph/lineage` 存在
- 旧的 `GET /callgraph`、`GET /lineage`、`GET /graph/data` **不存在**

- [ ] **Step 2：运行后端全部相关测试**

```bash
pytest backend/tests/test_graphs_api.py backend/tests/test_tasks_graph_storage.py backend/tests/test_graph_schema.py backend/tests/test_repos_api.py backend/tests/test_repos_delete.py -v
```

预期：全部 PASS

- [ ] **Step 3：启动前端，确认页面正常加载**

```bash
cd code-graph-ui
npm run dev
```

访问 http://localhost:5173，打开 Architecture / CallGraph / DataLineage 页面，确认数据正常加载，无 404 错误。

- [ ] **Step 4：最终提交（更新 CLAUDE.md）**

更新 `CLAUDE.md` 中 API 端点表格，删除已不存在的旧接口（`/callgraph`、`/lineage`（旧）、`/graph/data`、`/graph/module`），反映最新接口清单。

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md to reflect new graph API endpoints"
```
