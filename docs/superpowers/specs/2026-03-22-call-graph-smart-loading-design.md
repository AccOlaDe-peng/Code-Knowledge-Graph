# 调用图智能加载设计

**日期:** 2026-03-22
**状态:** 待批准
**范围:** 后端 `GraphStorage` + `/graph/call` API，前端可选适配

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

**分析时预生成核心子图，请求时直接返回**

```
分析时（一次性）：
  1. 计算每个节点的 in/out 度数
  2. 找最高度数节点作为推荐入口
  3. 预生成核心子图（入口节点 + 2 层 BFS）→ call-graph-core.json
  4. 将度数写入 call-graph.json 的节点属性（不影响原始 graph.json）

请求时：
  GET /graph/call?repo_id=xxx

  后端判断：
    if 存在 call-graph-core.json:
      直接返回预生成的核心子图（零计算）
    elif 节点数 ≤ THRESHOLD:
      返回 call-graph.json 全量数据
    else:
      降级：运行时 BFS（旧数据兼容）

前端：
  可选择性适配 meta.auto_focus，直接使用返回的聚焦状态
  度数信息直接从 node.properties.degrees 读取
```

---

## 架构设计

### 存储结构

```
graph-storage/
├── <repo-id>/
│   ├── graph.json              — 完整图谱（所有节点 + 所有边）
│   ├── call-graph.json         — calls 边 + 相关节点（含度数 + meta）
│   ├── call-graph-core.json    — [新增] 预生成的核心子图（大图谱专用）
│   └── module-graph.json       — contains / imports 边
└── index.json
```

### 数据流

```
分析流水线
    ↓
GraphStorage.save_graph()
    ↓ _derive_subgraphs()
    ├─ 生成 call-graph.json（含度数 + meta.entry_node_id）
    └─ if 节点数 > THRESHOLD:
         生成 call-graph-core.json（预计算 BFS 子图）
    ↓
API 请求 GET /graph/call?repo_id=xxx
    ↓
get_call() 判断：
    ├─ 存在 call-graph-core.json → 直接返回（最快）
    ├─ 节点数 ≤ THRESHOLD → 返回 call-graph.json
    └─ 否则 → 运行时 BFS（兼容旧数据）
    ↓
前端渲染
```

### 文件变更

| 操作 | 文件 | 职责 |
|------|------|------|
| 修改 | `backend/storage/graph_storage.py` | `_derive_subgraphs()` 预计算度数 + 核心子图 |
| 修改 | `backend/api/routers/graphs.py` | `get_call()` 读取预生成文件 |
| 新增 | `backend/config.py` | 统一配置 `LARGE_GRAPH_THRESHOLD` |
| 可选 | `code-graph-ui/src/pages/CallGraph/index.tsx` | 简化前端逻辑 |

---

## 数据格式

### call-graph.json 结构

```json
{
  "meta": {
    "entry_node_id": "function:src/service/OrderService.java:OrderService.createOrder",
    "node_count": 6500,
    "edge_count": 4200
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

### call-graph-core.json 结构（新增）

```json
{
  "meta": {
    "auto_focus": true,
    "focus_node_id": "function:src/service/OrderService.java:OrderService.createOrder",
    "focus_depth": 2,
    "total_nodes": 6500,
    "total_edges": 4200
  },
  "nodes": [...],
  "edges": [...]
}
```

**设计要点：**
- `call-graph-core.json` 仅在大图谱（节点数 > THRESHOLD）时生成
- 体积约 ~500KB（vs 全量 ~10MB）
- 包含完整 meta 信息，API 可直接返回

### API 响应格式

**大图谱（存在 core 文件）：**
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

**小图谱（无 core 文件）：**
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

### Task 1: 配置统一

**文件：** `backend/config.py`

```python
# 调用图阈值配置
LARGE_GRAPH_THRESHOLD = 3000      # 节点数超过此值视为大图谱
DEFAULT_FOCUS_DEPTH = 2           # 默认聚焦深度
```

### Task 2: GraphStorage 预计算

**文件：** `backend/storage/graph_storage.py`

**修改点：** `_derive_subgraphs()` 方法

```python
import copy
from backend.config import LARGE_GRAPH_THRESHOLD, DEFAULT_FOCUS_DEPTH

def _derive_subgraphs(
    self,
    repo_dir: Path,
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
) -> list[str]:
    """从完整图谱派生所有子图文件，返回已写入的文件名列表。"""
    # ... 现有逻辑（收集边类型、准备 node_map）...

    # ── 特殊处理：call-graph.json ────────────────────────────────
    if "call-graph.json" in files_to_generate:
        call_edges = [e for e in edges if e.get("type") == "calls"]

        # 边界情况：无 calls 边
        if not call_edges:
            logger.debug("  跳过 call-graph.json：无 calls 边")
            return written

        # 1. 计算度数
        degrees: dict[str, dict[str, int]] = {}
        for e in call_edges:
            src, tgt = e.get("from"), e.get("to")
            if src:
                degrees.setdefault(src, {"in": 0, "out": 0})["out"] += 1
            if tgt:
                degrees.setdefault(tgt, {"in": 0, "out": 0})["in"] += 1

        # 2. 找最高度数节点作为推荐入口
        entry_node_id = None
        max_total = -1
        for nid, deg in degrees.items():
            total = deg["in"] + deg["out"]
            if total > max_total:
                max_total = total
                entry_node_id = nid

        # 3. 生成 call-graph.json（深拷贝节点，避免污染原始数据）
        call_node_ids = set()
        for e in call_edges:
            if e.get("from"): call_node_ids.add(e["from"])
            if e.get("to"):   call_node_ids.add(e["to"])

        call_nodes = []
        for n in nodes:
            if n.get("id") in call_node_ids:
                node_copy = copy.deepcopy(n)
                nid = n.get("id")
                if nid in degrees:
                    node_copy.setdefault("properties", {})["degrees"] = degrees[nid]
                call_nodes.append(node_copy)

        call_subgraph = {
            "meta": {
                "entry_node_id": entry_node_id,
                "node_count": len(call_nodes),
                "edge_count": len(call_edges),
            },
            "nodes": call_nodes,
            "edges": call_edges,
        }
        path = repo_dir / "call-graph.json"
        _write_json(path, call_subgraph)
        written.append("call-graph.json")

        # 4. 大图谱：预生成核心子图
        if len(call_nodes) > LARGE_GRAPH_THRESHOLD and entry_node_id:
            core_subgraph = self._generate_core_subgraph(
                nodes, edges, entry_node_id, DEFAULT_FOCUS_DEPTH, degrees, len(call_nodes), len(call_edges)
            )
            core_path = repo_dir / "call-graph-core.json"
            _write_json(core_path, core_subgraph)
            written.append("call-graph-core.json")
            logger.debug(
                "  预生成核心子图: %d nodes / %d edges",
                len(core_subgraph["nodes"]), len(core_subgraph["edges"]),
            )

    # ... 其他子图生成逻辑 ...
    return written

def _generate_core_subgraph(
    self,
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
    entry_node_id: str,
    depth: int,
    degrees: dict[str, dict[str, int]],
    total_nodes: int,
    total_edges: int,
) -> dict[str, Any]:
    """生成核心子图（entry_node_id + depth 层 BFS）。"""
    node_map = {n.get("id"): n for n in nodes if n.get("id")}

    # BFS
    visited: set[str] = set()
    edge_set: list[dict] = []
    queue: list[tuple[str, int]] = [(entry_node_id, 0)]

    while queue:
        current_id, current_depth = queue.pop(0)
        if current_id in visited:
            continue
        visited.add(current_id)

        if current_depth < depth:
            for e in edges:
                if e.get("type") != "calls":
                    continue
                neighbor = None
                if e.get("from") == current_id:
                    neighbor = e.get("to")
                elif e.get("to") == current_id:
                    neighbor = e.get("from")
                if neighbor and neighbor not in visited:
                    edge_set.append(e)
                    queue.append((neighbor, current_depth + 1))
                elif neighbor and e not in edge_set:
                    edge_set.append(e)

    # 构建节点（含度数）
    core_nodes = []
    for nid in visited:
        if nid in node_map:
            node_copy = copy.deepcopy(node_map[nid])
            if nid in degrees:
                node_copy.setdefault("properties", {})["degrees"] = degrees[nid]
            core_nodes.append(node_copy)

    return {
        "meta": {
            "auto_focus": True,
            "focus_node_id": entry_node_id,
            "focus_depth": depth,
            "total_nodes": total_nodes,
            "total_edges": total_edges,
        },
        "nodes": core_nodes,
        "edges": edge_set,
    }
```

### Task 3: API 智能读取

**文件：** `backend/api/routers/graphs.py`

```python
from backend.config import LARGE_GRAPH_THRESHOLD, DEFAULT_FOCUS_DEPTH

@router.get("/graph/call", tags=["图谱视图"])
def get_call(
    repo_id: str = Query(description="仓库 ID"),
    node_id: Optional[str] = Query(default=None, description="起点节点 ID"),
    depth: int = Query(default=2, ge=1, le=5, description="BFS 深度"),
) -> dict[str, Any]:
    storage = get_graph_storage()

    # 用户指定起点：运行时 BFS
    if node_id is not None:
        graph = _storage_load_or_404(repo_id)
        result = _bfs_subgraph(
            graph.get("nodes", []),
            graph.get("edges", []),
            node_id,
            frozenset({"calls"}),
            depth,
        )
        return {
            "repo_id": repo_id,
            "node_count": len(result["nodes"]),
            "edge_count": len(result["edges"]),
            "nodes": result["nodes"],
            "edges": result["edges"],
        }

    # 无指定起点：尝试读取预生成文件
    try:
        repo_dir = storage._repo_dir(storage._safe_id(repo_id))
        core_path = repo_dir / "call-graph-core.json"

        # 优先返回核心子图（最快路径）
        if core_path.exists():
            core_data = _read_json(core_path)
            return {
                "repo_id": repo_id,
                "node_count": len(core_data.get("nodes", [])),
                "edge_count": len(core_data.get("edges", [])),
                "nodes": core_data.get("nodes", []),
                "edges": core_data.get("edges", []),
                "meta": core_data.get("meta", {}),
            }

        # 回退：读取完整 call-graph.json
        subgraph = storage.get_subgraph(repo_id, "calls")
        nodes = subgraph.get("nodes", [])
        edges = subgraph.get("edges", [])
        meta = subgraph.get("meta", {})

        # 大图谱但无 core 文件：运行时 BFS（兼容旧数据）
        if len(nodes) > LARGE_GRAPH_THRESHOLD:
            entry_node_id = meta.get("entry_node_id")
            if entry_node_id:
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

        # 小图谱或无入口：返回全量
        return {
            "repo_id": repo_id,
            "node_count": len(nodes),
            "edge_count": len(edges),
            "nodes": nodes,
            "edges": edges,
        }

    except RepoNotFoundError:
        raise HTTPException(status_code=404, detail=f"repo not found: {repo_id}")
```

---

## 前端适配

### 方案 A：最小改动（推荐）

前端保持现有逻辑不变，后端已返回聚焦子图，前端直接渲染即可。

现有的大图谱检测逻辑会自然跳过（因为收到的节点数已小于阈值）。

### 方案 B：利用 meta 优化

```typescript
// 移除本地度数计算，直接读取 properties.degrees
const degreeMap = useMemo(() => {
  const map = new Map<string, { in: number; out: number }>()
  rawData.nodes.forEach((n) => {
    const deg = n.properties?.degrees
    if (deg) map.set(n.id, deg)
  })
  return map
}, [rawData])

// 响应 meta.auto_focus，直接设置聚焦状态
useEffect(() => {
  if (rawData && rawData.length > 0) {
    // 检查 API 返回的 meta
    const meta = (rawData as any).meta
    if (meta?.auto_focus && meta?.focus_node_id) {
      setFocusNodeId(meta.focus_node_id)
      setDepth(meta.focus_depth ?? 2)
      setLargeGraphHint(true)
    }
  }
}, [rawData])
```

---

## 性能对比

| 场景 | 优化前 | 优化后 |
|------|--------|--------|
| 大图谱首屏网络传输 | ~10MB JSON | ~500KB JSON |
| 大图谱首屏后端处理 | 读取 + BFS（~100ms） | 直接读取（~5ms） |
| 大图谱首屏前端计算 | O(V+E) 度数 + BFS | O(1) 直接渲染 |
| 大图谱首屏总时间 | 2-5 秒 | < 0.5 秒 |
| 小图谱体验 | 正常 | 不变 |
| 分析时额外开销 | 无 | 度数计算 + 核心子图生成（~200ms） |

---

## 边界情况处理

| 情况 | 处理方式 |
|------|----------|
| 无 calls 边 | 不生成 call-graph.json，API 返回空图 |
| 旧数据无 meta | 降级：小图谱返回全量，大图谱运行时 BFS |
| 旧数据无 core 文件 | 降级：运行时 BFS |
| entry_node_id 不存在 | 忽略，返回全量 |
| 用户指定 node_id | 直接运行时 BFS，不走预生成逻辑 |

---

## 向后兼容

| 兼容场景 | 行为 |
|----------|------|
| 旧版 call-graph.json（无 meta） | 小图谱返回全量，大图谱运行时 BFS |
| 无 call-graph-core.json | 降级到 call-graph.json 或运行时 BFS |
| 前端不改动 | 正常工作，只是度数计算仍在前端 |
| `node_id` 参数请求 | 行为不变，运行时 BFS |

---

## 验收标准

| 检查项 | 预期 |
|-------|------|
| 大图谱（>3000 节点）首屏加载 | < 0.5 秒 |
| 大图谱生成 call-graph-core.json | ✅ |
| call-graph.json 节点含 properties.degrees | ✅ |
| 小图谱（≤3000 节点）不生成 core 文件 | ✅ |
| 无 calls 边的仓库不报错 | ✅ |
| 旧数据兼容（无 meta/core） | ✅ 正常降级 |
| 前端不改动仍可正常工作 | ✅ |

---

## 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| 核心子图存储空间 | 每个 ~500KB，10 个仓库 ~5MB，可接受 |
| 分析时间增加 | 度数 + BFS 约增加 200ms，可忽略 |
| 入口节点不理想 | 用户可点击其他节点切换，前端保留交互能力 |
| 阈值配置分散 | 统一到 `backend/config.py` |
