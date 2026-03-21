# Graph API 重设计规格

**日期：** 2026-03-21
**状态：** 待实现
**范围：** `backend/api/routers/graphs.py` 及相关文件

---

## 背景

当前 `graphs.py` 存在两个问题：

1. **双轨并行**：旧接口使用 `graph_id` + `GraphRepository`，新接口使用 `repo_id` + `GraphStorage`，前端有显式 fallback 逻辑。
2. **职责模糊**：`/callgraph`、`/lineage`、`/graph/data`、`/graph/module`、`/graph/call` 等接口功能重叠，命名不清晰。

**根本原因（架构问题）：** `GraphStorage` 目前只由 `POST /analyze/graph`（轻量 GraphPipeline）写入，主流程 `POST /analyze/repository`（Celery）只写 `GraphRepository`，导致两套存储各自为政。

本次重构分两层：
- **存储层**：让主流程 Celery 任务在 `GraphRepository.save()` 后同时写入 `GraphStorage`，使其成为统一的 API serving 层
- **API 层**：清理旧接口，以框架图、调用图、数据血缘图三个视图为核心，全部基于 `GraphStorage`（`repo_id`）

---

## 决策

- 主流程分析结果同时写入 `GraphStorage`（`repo_id = repo_name`）
- 节点类型统一使用 PascalCase（直接沿用 `graph_schema.NodeType` 枚举值，无需转换）
- URL 风格：扁平命名，`repo_id` 作为 query param
- `GET /graph`（列表）删除，列表功能由 `GET /repos` 承担
- DELETE 操作移入 `repos.py`，`graphs.py` 变为纯只读
- `/events`、`/services` 不在本次范围内
- **破坏性变更**：前后端必须同步部署，不提供旧接口兼容层

---

## 最终接口清单

### `graphs.py`（纯只读，3 个接口）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/graph/framework` | 架构图视图 |
| GET | `/graph/call` | 调用图视图 |
| GET | `/graph/lineage` | 数据血缘视图 |

### `repos.py`（吸收删除逻辑）

| 方法 | 路径 | 说明 |
|------|------|------|
| DELETE | `/repos/{repo_id}` | 一站式删除（已有，扩展逻辑） |

---

## 接口规格

节点 `type` 字段为 PascalCase（`Module`、`Function`、`API` 等），与 `graph_schema.NodeType` 枚举值一致。

**错误响应约定：**
- `repo_id` 不存在：`404 {"detail": "repo not found: <repo_id>"}`
- `node_id` 不存在：`404 {"detail": "node not found: <node_id>"}`
- `depth` 传入但 `node_id` 未传：静默忽略

---

### GET `/graph/framework`

**用途：** 架构图视图，返回系统高层结构节点及其连接关系。

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `repo_id` | string | 是 | 仓库 ID |
| `node_types` | string | 否 | 逗号分隔的节点类型（PascalCase），默认架构层节点集合，传 `all` 返回全部节点 |

**默认 `node_types`（来自 `graph_schema.ARCHITECTURE_NODE_TYPES`）：**
`Module, Component, Service, API, APIEndpoint, Database, Layer, Domain, BoundedContext, DataSource, DataSink, ExternalAPI`

**响应：**
```json
{
  "repo_id": "my-project",
  "node_count": 24,
  "edge_count": 31,
  "nodes": [{ "id": "...", "type": "Module", "name": "...", ... }],
  "edges": [{ "from": "...", "to": "...", "type": "depends_on" }]
}
```

edges 只包含两端节点都在结果集内的边。

**数据来源：** `GraphStorage.load_graph()` + 内存节点类型过滤。

**替代旧接口：** `/graph/data`（`node_types=all`）、`/graph/module`（`node_types=Module,File`）、`/graph/summary`（`node_types=Repository,Module`）、`GET /graph?graph_id=xxx`

---

### GET `/graph/call`

**用途：** 调用图视图，返回函数/API 节点及调用关系。

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `repo_id` | string | 是 | 仓库 ID |
| `node_id` | string | 否 | 起点节点 ID，指定后返回以该节点为根的调用子图 |
| `depth` | int | 否 | BFS 展开深度，默认 2，范围 1-5（仅 `node_id` 指定时生效） |

**响应：**
```json
{
  "repo_id": "my-project",
  "node_count": 18,
  "edge_count": 22,
  "nodes": [{ "id": "...", "type": "Function", "name": "...", ... }],
  "edges": [{ "from": "...", "to": "...", "type": "calls" }]
}
```

**数据来源：**
- 无 `node_id`：`GraphStorage.get_subgraph(repo_id, "calls")` → 读预生成 `call-graph.json`，不存在则从 `load_graph()` 实时过滤。`call-graph.json` 由 `GraphStorage.save_graph()` 通过 `_derive_subgraphs()` 自动生成。
- 有 `node_id`：`GraphStorage.load_graph()` 全量加载，内存中 BFS 展开。

**替代旧接口：** `/callgraph`

---

### GET `/graph/lineage`

**用途：** 数据血缘视图，返回数据流向相关节点和边。

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `repo_id` | string | 是 | 仓库 ID |
| `edge_types` | string | 否 | 逗号分隔的边类型，默认全部血缘边类型 |
| `node_id` | string | 否 | 起点节点 ID，指定后返回以该节点为根的血缘子图 |
| `depth` | int | 否 | BFS 展开深度，默认 2，范围 1-5（仅 `node_id` 指定时生效） |

**默认 `edge_types`：** `depends_on, reads, writes, produces, consumes, imports`

**响应：**
```json
{
  "repo_id": "my-project",
  "edge_types": ["depends_on", "reads", "writes", "produces", "consumes", "imports"],
  "node_count": 15,
  "edge_count": 19,
  "nodes": [{ "id": "...", "type": "Module", "name": "...", ... }],
  "edges": [{ "from": "...", "to": "...", "type": "reads" }]
}
```

**数据来源：** `GraphStorage.load_graph()` + 内存边类型过滤（始终全量加载，不依赖 `get_subgraph`）。

**替代旧接口：** `/lineage`（旧，`graph_id` 体系）

---

## 需要修改的文件

### 1. `backend/scheduler/tasks.py`（核心变更）

在 Celery 分析任务的 `graph_repo.save(built, repo_name=repo_name)` 之后，追加 `GraphStorage` 写入：

```python
# 现有代码（保持不变）
graph_repo.save(built, repo_name=repo_name)

# 新增：同时写入 GraphStorage，供 API 读取
from backend.storage.graph_storage import GraphStorage
from backend.api.deps import get_graph_storage

try:
    from backend.storage.graph_storage import GraphStorage
    graph_storage = GraphStorage()  # 直接实例化，不用 FastAPI 单例（Celery Worker 中 lifespan 未执行）
    graph_storage.save_graph(
        repo_id=repo_name,
        graph={
            "nodes": [n.model_dump() for n in built.nodes],
            "edges": [e.model_dump(by_alias=True) for e in built.edges],
        },
    )
except Exception as exc:
    logger.warning("GraphStorage 写入失败（不影响主流程）: %s", exc)
```

写入失败只 warn，不 raise——不影响主分析任务。`save_graph` 会自动派生 `call-graph.json`、`module-graph.json` 等子图文件。

此改动同样适用于 `incremental_update` 任务中的 `graph_repo.save()` 调用。

### 2. `backend/graph/graph_schema.py`

新增常量（值与 `NodeType` 枚举一致，均为 PascalCase）：

```python
ARCHITECTURE_NODE_TYPES: frozenset[str] = frozenset({
    "Module", "Component", "Service", "API", "APIEndpoint",
    "Database", "Layer", "Domain", "BoundedContext",
    "DataSource", "DataSink", "ExternalAPI",
})
```

> `"Infrastructure"` 不在 `NodeType` 枚举中，已移除。

### 3. `backend/api/routers/graphs.py`

完全重写：
- 删除所有旧接口（`/graph`、`/callgraph`、`/lineage`、`/graph/data`、`/graph/module`、`/graph/summary`、`/graph/export`、`DELETE /graph/{graph_id}`、`DELETE /repo/{repo_id}`）
- 实现 3 个新接口（`/graph/framework`、`/graph/call`、`/graph/lineage`）

### 4. `backend/api/routers/repos.py`

`DELETE /repos/{repo_id}` 扩展，一站式清理所有关联数据：
- 删除仓库配置（`repo_store`）
- 删除分析历史（`analysis_store`）
- 删除图谱存储（`GraphStorage.delete_repo(repo_id)`）
- 删除向量集合（`VectorStore`）
- 删除状态记录（`repo_status_store`）

> `GraphRepository` 不再参与删除流程。存量旧数据（`data/graphs/`）可单独清理，不在本次范围内。

### 5. 前端迁移（`code-graph-ui/`）

| 旧调用 | 新调用 | 影响位置 |
|--------|--------|---------|
| `GET /graph`（列表） | `GET /repos` | `graphApi.listGraphs()` |
| `GET /graph?graph_id=xxx` | `GET /graph/framework?node_types=all` | `graphApi.getGraph()` → `getFramework(repoId, "all")` |
| `GET /callgraph` | `GET /graph/call` | `graphStore.loadCallGraph()` fallback 删除 |
| `GET /lineage` | `GET /graph/lineage` | `graphStore.loadLineage()` |
| `GET /graph/data` | `GET /graph/framework?node_types=all` | `graphStore.loadFullGraph()` |
| `GET /graph/module` | `GET /graph/framework?node_types=Module,File` | `graphStore.loadModuleGraph()` |
| `GET /graph/summary` | `GET /graph/framework?node_types=Repository,Module` | `graph-engine/loader/GraphLoader.ts` |
| `DELETE /graph/{graph_id}` | `DELETE /repos/{repo_id}` | 删除操作调用方 |
| `DELETE /repo/{repo_id}` | `DELETE /repos/{repo_id}` | 删除操作调用方 |

所有视图接口参数名从 `graph_id` 统一改为 `repo_id`。

---

## 不在范围内

- `/events` 和 `/services` 接口：保持现状，不做修改
- `graph-engine` LOD 展开逻辑：`GraphLoader.ts` 只需更新 API 调用地址，LOD 机制本身不变
- 存量 `GraphRepository` 旧数据（`data/graphs/`）迁移
- `_EDGE_TYPE_TO_SUBGRAPH` 映射修改（`/graph/lineage` 不依赖预生成文件，无需变更）
