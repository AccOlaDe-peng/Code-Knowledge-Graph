# 数据血缘图谱实现计划

## 已完成功能

### P0 优先级 ✅

| 功能 | 状态 | 说明 |
|------|------|------|
| Schema 扩展 | ✅ 完成 | 新增 `queries`/`flow_to` 边类型，血缘相关常量 |
| LineageExtractionResult | ✅ 完成 | 数据模型定义 |
| DataLineageExtractionStage | ✅ 完成 | 血缘提取核心逻辑 |
| 集成到 StaticFirstPipeline | ✅ 完成 | Stage 5 位置 |
| `/graph/lineage` 增强 | ✅ 完成 | 支持 direction 参数 |

### P1 优先级 ✅

| 功能 | 状态 | 说明 |
|------|------|------|
| 变更影响评估 API | ✅ 完成 | `POST /lineage/impact` |
| 根因追溯 API | ✅ 完成 | `POST /lineage/trace` |

---

## 目标

实现数据血缘图谱的核心功能：
1. Schema 扩展（节点/边类型）
2. DataLineageExtractionStage 实现
3. API 端点 `/graph/lineage` 增强

## Step 1: Schema 扩展

### 1.1 扩展边类型（`backend/graph/graph_schema.py`）

新增血缘边类型：
- `READS = "reads"` — 数据读取（Repository → Database）
- `WRITES = "writes"` — 数据写入（Repository → Database）
- `QUERIES = "queries"` — 查询关系（Service → Repository）
- `FLOW_TO = "flow_to"` — 数据流向（Service → Service）

### 1.2 新增血缘相关常量

```python
# 数据血缘边类型
LINEAGE_EDGE_TYPES = frozenset({
    "reads", "writes", "produces", "consumes",
    "queries", "flow_to", "transforms",
    "depends_on", "imports",
})

# 数据源节点类型
DATA_SOURCE_TYPES = frozenset({
    "Database", "ExternalAPI", "MessageQueue", "DataSource",
})

# 数据处理节点类型
DATA_PROCESSOR_TYPES = frozenset({
    "Service", "Repository", "Component",
})

# 数据输出节点类型
DATA_SINK_TYPES = frozenset({
    "APIEndpoint", "Topic", "DataSink",
})
```

## Step 2: DataLineageExtractionStage 实现

### 2.1 新建文件 `backend/pipeline/stages/data_lineage_extraction.py`

Stage 职责：
- 从 structural_nodes 提取 Service/Repository 节点
- 从 DI 边推断 Service → Service 数据流向
- 从 Repository 节点推断 reads/writes 关系
- 从 Controller 节点提取 APIEndpoint 节点
- 从 Kafka Event 边提取 produces/consumes 关系

### 2.2 输入输出定义

**输入：**
- `structural_nodes: list[GraphNode]` — 静态分析产出的节点
- `structural_edges: list[GraphEdge]` — 静态分析产出的边
- `di_edges: list[GraphEdge]` — Spring DI 边（来自 Stage 4a/4b）
- `framework_patterns: list[FrameworkPattern]` — Spring 注解模式

**输出：**
- `LineageExtractionResult`
  - `lineage_nodes: list[GraphNode]` — 新增的 DataSource/APIEndpoint/Topic 节点
  - `lineage_edges: list[GraphEdge]` — 血缘边（reads/writes/flow_to/produces/consumes）
  - `stats: dict` — 统计信息

### 2.3 核心解析逻辑

#### 2.3.1 Repository → Database 血缘

```python
def _extract_repository_lineage(self, nodes, patterns):
    """从 Repository 节点提取数据库血缘。"""
    for node in nodes:
        if self._is_repository(node):
            # 从注解或命名推断数据源
            # @Repository, XxxRepository → Database
            db_node = self._infer_database(node)
            edges.append(GraphEdge(
                from_=node.id,
                to=db_node.id,
                type="reads",  # 或 "writes"
            ))
```

#### 2.3.2 Service → Service 数据流

```python
def _extract_service_flow(self, nodes, di_edges):
    """从 DI 关系推断数据流向。"""
    for edge in di_edges:
        if edge.type == "depends_on":
            # Service 依赖 Service → 数据流向
            if self._is_service(edge.from_) and self._is_service(edge.to):
                edges.append(GraphEdge(
                    from_=edge.from_,
                    to=edge.to,
                    type="flow_to",
                ))
```

#### 2.3.3 Controller → APIEndpoint 血缘

```python
def _extract_api_lineage(self, nodes, patterns):
    """从 Controller 提取 API 端点。"""
    for pattern in patterns:
        if pattern.pattern_type in ("controller", "rest_controller"):
            # @GetMapping, @PostMapping → APIEndpoint
            api_node = GraphNode(
                id=f"api:{pattern.source_element}",
                type="APIEndpoint",
                name=pattern.source_element,
            )
            edges.append(GraphEdge(
                from_=pattern.source_element,
                to=api_node.id,
                type="produces",
            ))
```

## Step 3: 集成到流水线

### 3.1 修改 `backend/pipeline/static_first_pipeline.py`

在 Stage 4a/4b 完成后，Stage 5 之前插入 DataLineageExtractionStage：

```
Stage 1: FileIndexStage
Stage 2: DeepStaticAnalysisStage
Stage 3: DirectoryClusterStage || SpringDIEventStaticStage (并行)
Stage 3b: AISemanticEnhanceStage
Stage 4b: SpringDIEventAIStage
Stage 5: DataLineageExtractionStage  ← 新增
Stage 6: GraphMergeWithQualityStage
```

### 3.2 修改 `backend/models/static_analysis.py`

新增数据模型：

```python
@dataclass
class LineageExtractionResult:
    """Stage 5 输出：数据血缘提取结果。"""
    lineage_nodes: list[GraphNode] = field(default_factory=list)
    lineage_edges: list[GraphEdge] = field(default_factory=list)
    stats: dict[str, Any] = field(default_factory=dict)
```

## Step 4: API 端点增强

### 4.1 修改 `backend/api/routers/graphs.py`

增强 `/graph/lineage` 端点：

```python
@router.get("/graph/lineage", tags=["图谱视图"])
def get_lineage(
    repo_id: str = Query(description="仓库 ID"),
    node_id: Optional[str] = Query(default=None, description="起点节点 ID"),
    direction: str = Query(default="downstream", description="追踪方向: downstream | upstream | both"),
    depth: int = Query(default=3, ge=1, le=5, description="BFS 深度"),
    edge_types: Optional[str] = Query(default=None, description="边类型过滤"),
):
    """
    数据血缘视图。

    - downstream: 追踪下游影响（数据去向）
    - upstream: 追溯上游来源（数据来源）
    - both: 双向展开
    """
```

### 4.2 实现方向感知 BFS

```python
def _bfs_lineage_subgraph(
    nodes, edges, root_id, direction, depth
):
    """方向感知的血缘 BFS。"""
    if direction == "downstream":
        # 只追踪 from → to 方向
        edge_filter = lambda e: e.from_ == current
    elif direction == "upstream":
        # 只追踪 to → from 方向（反向）
        edge_filter = lambda e: e.to == current
    else:
        # 双向
        edge_filter = lambda e: e.from_ == current or e.to == current
```

## Step 5: 测试

### 5.1 单元测试 `backend/tests/test_data_lineage_stage.py`

- 测试 Repository → Database 血缘提取
- 测试 Service → Service 数据流推断
- 测试 Controller → APIEndpoint 提取

### 5.2 集成测试

- 运行完整流水线，验证血缘节点/边产出
- 验证 API 端点返回正确数据

## 文件变更清单

| 文件 | 操作 |
|------|------|
| `backend/graph/graph_schema.py` | 修改：新增边类型和常量 |
| `backend/models/static_analysis.py` | 修改：新增 LineageExtractionResult |
| `backend/pipeline/stages/data_lineage_extraction.py` | 新增：Stage 实现 |
| `backend/pipeline/static_first_pipeline.py` | 修改：集成新 Stage |
| `backend/api/routers/graphs.py` | 修改：增强 lineage 端点 |
| `backend/tests/test_data_lineage_stage.py` | 新增：单元测试 |

## 预期产出

对于一个典型的 Spring 项目：

```
输入：
- 10 个 @Service 类
- 5 个 @Repository 类
- 3 个 @RestController 类
- 20 个 @Autowired 注入

输出：
- 2 个 Database 节点（推断）
- 15 个 APIEndpoint 节点
- 30 条 flow_to 边
- 10 条 reads/writes 边
- 15 条 produces 边
```
