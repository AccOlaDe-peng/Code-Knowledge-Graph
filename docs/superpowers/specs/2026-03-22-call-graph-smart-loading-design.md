# 调用图智能加载设计

**日期:** 2026-03-22
**状态:** 待批准
**范围:** 后端 `GraphStorage` + `/graph/call` API，前端无需改动

---

## 问题陈述

调用图页面在打开大型仓库（6000+ 节点、4000+ 边）时，初始加载缓慢，用户体验差。

**根本原因：**
1. **全量数据传输** — 前端请求 `/graph/call?repo_id=xxx` 时，后端返回完整的 `call-graph.json`（~10MB JSON）
2. **主线程计算** — 前端收到数据后，需要遍历所有边计算度数、查找最高度数节点、构建邻接表并 BFS 过滤
3. **渲染延迟** — 上述步骤完成后才开始渲染

**期望：** 用户打开页面后，直接看到有意义的子图（推荐入口节点 + 2 层调用链），无需等待。

---

## 解决方案

**混合优化方案：分析时预计算 + 请求时智能默认**

```
分析时（一次性）：
  1. 预计算每个节点的 in/out 度数 → 存入 node.properties.degrees
  2. 预计算推荐入口节点（最高度数）→ 存入 call-graph.json 的 meta.entry_node_id
  3. （可选）预生成核心子图

请求时：
  GET /graph/call?repo_id=xxx

  后端判断：
    if 节点数 > LARGE_THRESHOLD (3000):
      使用 meta.entry_node_id 进行 BFS(depth=2)
      返回子图 + { auto_focus: true, focus_node_id: "xxx" }
    else:
      返回全图（保持现状）

前端：
  无需改动，收到即渲染
  度数信息直接从 node.properties.degrees 读取，无需计算
```

---

## 架构设计

### 数据流

```
分析流水线
    ↓
GraphStorage.save_graph()
    ↓ _derive_subgraphs()
call-graph.json 生成时：
    ├─ 计算节点度数 → 写入 node.properties.degrees
    ├─ 找最高度数节点 → 写入 meta.entry_node_id
    └─ 写入文件
    ↓
API 请求 GET /graph/call?repo_id=xxx
    ↓
get_call() 判断：
    if 节点数 > THRESHOLD and 无 node_id 参数:
        使用 entry_node_id 进行 BFS(depth=2)
        返回子图
    else:
        返回全图或指定 node_id 的 BFS 子图
    ↓
前端渲染（无改动）
```

### 文件变更

| 操作 | 文件 | 职责 |
|------|------|------|
| 修改 | `backend/storage/graph_storage.py` | `_derive_subgraphs()` 中计算度数 + 推荐入口 |
| 修改 | `backend/api/routers/graphs.py` | `get_call()` 中智能默认逻辑 |

---

## 数据格式变更

### call-graph.json 结构

```json
{
  "meta": {
    "entry_node_id": "function:src/service/OrderService.java:OrderService.createOrder",
    "entry_node_degree": { "in": 15, "out": 8, "total": 23 }
  },
  "nodes": [
    {
      "id": "function:src/service/OrderService.java:OrderService.createOrder",
      "type": "Function",
      "name": "createOrder",
      "properties": {
        "degrees": { "in": 15, "out": 8 }
      }
    }
  ],
  "edges": [...]
}
```

**字段说明：**
- `meta.entry_node_id` — 推荐入口节点 ID（最高总度数）
- `meta.entry_node_degree` — 入口节点的度数信息（可选，便于前端展示）
- `node.properties.degrees` — 每个节点的入度/出度（前端可直接读取，无需计算）

### API 响应格式

**大图谱（自动聚焦）：**
```json
{
  "repo_id": "adms",
  "node_count": 150,
  "edge_count": 200,
  "nodes": [...],
  "edges": [...],
  "meta": {
    "auto_focus": true,
    "focus_node_id": "function:src/service/OrderService.java:OrderService.createOrder",
    "focus_depth": 2,
    "total_nodes": 6500,
    "total_edges": 4200
  }
}
```

**小图谱（全量返回）：**
```json
{
  "repo_id": "small-project",
  "node_count": 500,
  "edge_count": 300,
  "nodes": [...],
  "edges": [...]
}
```

---

## 实现细节

### Task 1: GraphStorage 度数预计算

**文件：** `backend/storage/graph_storage.py`

**修改点：** `_derive_subgraphs()` 方法

```python
def _derive_subgraphs(
    self,
    repo_dir: Path,
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
) -> list[str]:
    """从完整图谱派生所有子图文件，返回已写入的文件名列表。"""
    # ... 现有逻辑 ...

    # 为 call-graph.json 特殊处理：计算度数 + 推荐入口
    if "call-graph.json" in files_to_generate:
        call_edges = [e for e in edges if e.get("type") == "calls"]

        # 1. 计算度数
        degrees: dict[str, dict[str, int]] = {}
        for e in call_edges:
            src, tgt = e.get("from"), e.get("to")
            if src:
                degrees.setdefault(src, {"in": 0, "out": 0})["out"] += 1
            if tgt:
                degrees.setdefault(tgt, {"in": 0, "out": 0})["in"] += 1

        # 2. 将度数写入节点的 properties.degrees
        for node in nodes:
            nid = node.get("id")
            if nid in degrees:
                node.setdefault("properties", {})["degrees"] = degrees[nid]

        # 3. 找最高度数节点作为推荐入口
        entry_node_id = None
        max_total = -1
        for nid, deg in degrees.items():
            total = deg["in"] + deg["out"]
            if total > max_total:
                max_total = total
                entry_node_id = nid

        # 4. 写入 call-graph.json 时附带 meta
        call_subgraph = _filter_subgraph_multi(nodes, edges, {"calls"}, node_map)
        if call_subgraph["edges"]:
            call_subgraph["meta"] = {
                "entry_node_id": entry_node_id,
                "entry_node_degree": degrees.get(entry_node_id) if entry_node_id else None,
            }
            path = repo_dir / "call-graph.json"
            _write_json(path, call_subgraph)
            written.append("call-graph.json")

    return written
```

### Task 2: API 智能默认逻辑

**文件：** `backend/api/routers/graphs.py`

**修改点：** `get_call()` 端点

```python
LARGE_GRAPH_THRESHOLD = 3000
DEFAULT_FOCUS_DEPTH = 2

@router.get("/graph/call", tags=["图谱视图"])
def get_call(
    repo_id: str = Query(description="仓库 ID"),
    node_id: Optional[str] = Query(default=None, description="起点节点 ID"),
    depth: int = Query(default=2, ge=1, le=5, description="BFS 深度"),
) -> dict[str, Any]:
    storage = get_graph_storage()

    if node_id is not None:
        # 用户指定了起点，按原逻辑 BFS
        graph = _storage_load_or_404(repo_id)
        result = _bfs_subgraph(...)
        return result

    # 无 node_id，尝试从子图文件读取
    try:
        subgraph = storage.get_subgraph(repo_id, "calls")
    except RepoNotFoundError:
        raise HTTPException(status_code=404, detail=f"repo not found: {repo_id}")

    nodes = subgraph.get("nodes", [])
    edges = subgraph.get("edges", [])
    meta = subgraph.get("meta", {})

    # 大图谱智能聚焦
    if len(nodes) > LARGE_GRAPH_THRESHOLD:
        entry_node_id = meta.get("entry_node_id")
        if entry_node_id:
            # 从完整图谱 BFS（因为子图不包含完整边信息）
            graph = _storage_load_or_404(repo_id)
            result = _bfs_subgraph(
                graph.get("nodes", []),
                graph.get("edges", []),
                entry_node_id,
                frozenset({"calls"}),
                DEFAULT_FOCUS_DEPTH,
            )
            return {
                "repo_id": repo_id,
                "node_count": len(result["nodes"]),
                "edge_count": len(result["edges"]),
                "nodes": result["nodes"],
                "edges": result["edges"],
                "meta": {
                    "auto_focus": True,
                    "focus_node_id": entry_node_id,
                    "focus_depth": DEFAULT_FOCUS_DEPTH,
                    "total_nodes": len(nodes),
                    "total_edges": len(edges),
                },
            }

    # 小图谱或无推荐入口，返回全量
    return {
        "repo_id": repo_id,
        "node_count": len(nodes),
        "edge_count": len(edges),
        "nodes": nodes,
        "edges": edges,
    }
```

---

## 前端适配（可选）

前端无需强制改动，但可利用新数据优化体验：

### 读取预计算度数

```typescript
// 现有：前端计算度数
const degreeMap = useMemo(() => {
  const map = new Map<string, { in: number; out: number }>()
  rawData.nodes.forEach((n) => map.set(n.id, { in: 0, out: 0 }))
  rawData.edges.forEach((e) => { ... })
  return map
}, [rawData])

// 优化：直接读取 properties.degrees
const degreeMap = useMemo(() => {
  const map = new Map<string, { in: number; out: number }>()
  rawData.nodes.forEach((n) => {
    const deg = n.properties?.degrees
    if (deg) map.set(n.id, deg)
  })
  return map
}, [rawData])
```

### 响应 meta.auto_focus

```typescript
// API 响应中如果有 meta.auto_focus，直接使用
useEffect(() => {
  if (res.meta?.auto_focus && res.meta?.focus_node_id) {
    setFocusNodeId(res.meta.focus_node_id)
    setDepth(res.meta.focus_depth ?? 2)
    setLargeGraphHint(true)
  }
}, [res.meta])
```

---

## 性能预估

| 场景 | 优化前 | 优化后 |
|------|--------|--------|
| 大图谱首屏加载 | ~10MB JSON + 主线程计算 | ~500KB 子图 JSON |
| 网络传输时间 | 2-5 秒 | 0.1-0.3 秒 |
| 前端计算 | O(V+E) 遍历 | O(1) 直接读取 |
| 小图谱体验 | 正常 | 不变 |

---

## 向后兼容

- **现有请求** `GET /graph/call?repo_id=xxx&node_id=xxx` 行为不变
- **小图谱**（节点数 ≤ 3000）仍返回全量数据
- **旧版 call-graph.json**（无 meta 字段）降级为返回全量数据
- **前端无需改动**，但可选择性适配 meta 信息

---

## 验收标准

| 检查项 | 预期 |
|-------|------|
| 大图谱（6000+ 节点）首屏加载 | < 1 秒 |
| 小图谱（< 3000 节点）行为 | 不变 |
| call-graph.json 包含 meta.entry_node_id | ✅ |
| 节点包含 properties.degrees | ✅ |
| API 响应包含 meta.auto_focus | ✅（大图谱时） |
| 前端无需改动即可正常工作 | ✅ |

---

## 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| 旧数据无 meta 字段 | 降级返回全量数据，不影响功能 |
| 度数计算增加分析时间 | 度数计算为 O(E)，对分析总时间影响可忽略 |
| 入口节点不是用户想要的 | 用户可通过点击其他节点切换入口 |
