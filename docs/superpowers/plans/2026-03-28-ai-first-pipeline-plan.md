# AI 优先分析流水线实现计划

> 创建日期: 2026-03-28
> 设计文档: `docs/superpowers/specs/2026-03-28-ai-first-pipeline-design.md`
> 预计工期: 7-11 天

---

## 实现步骤

### Step 1: 定义数据模型

**文件:** `backend/models/ai_first_analysis.py`

**任务:**
- [ ] 1.1 定义 `EntityCandidate` 模型（实体候选）
- [ ] 1.2 定义 `FieldInfo` 模型（字段信息）
- [ ] 1.3 定义 `RelationshipInfo` 模型（关系信息）
- [ ] 1.4 定义 `FieldLineage` 模型（字段血缘）
- [ ] 1.5 定义 `EntityDescription` 模型（实体描述）
- [ ] 1.6 定义 `RepositoryScanResult` 模型（扫描结果）
- [ ] 1.7 定义 `EntityAnalysisResult` 模型（实体分析结果）

**依赖:** 无

---

### Step 2: 扩展 GraphSchema

**文件:** `backend/graph/graph_schema.py`

**任务:**
- [ ] 2.1 添加新节点类型到 `NodeType`: `Entity`, `Table`, `Field`, `Flow`, `FlowNode`
- [ ] 2.2 添加新边类型到 `EdgeType`: `maps_to`, `has_field`, `one_to_one`, `one_to_many`, `many_to_many`, `flow_to`
- [ ] 2.3 更新 `validate_graph()` 方法支持新类型

**依赖:** Step 1

---

### Step 3: 实现 AIRepositoryScanStage

**文件:** `backend/pipeline/stages/ai_repository_scan.py`

**任务:**
- [ ] 3.1 创建 `AIRepositoryScanStage` 类，继承 `StageBase`
- [ ] 3.2 实现 `run()` 方法入口
- [ ] 3.3 定义 System Prompt（仓库探索专家）
- [ ] 3.4 定义 User Prompt 模板
- [ ] 3.5 实现 `Pydantic` 输出模型 `RepositoryScanResponse`
- [ ] 3.6 实现 JSON 提取和校验逻辑
- [ ] 3.7 添加进度回调支持
- [ ] 3.8 添加 Observer 事件发射

**依赖:** Step 1

**关键代码结构:**
```python
class RepositoryScanResponse(BaseModel):
    entities: list[EntityCandidate]
    flows: list[FlowCandidate]
    services: list[ServiceCandidate]
    repositories: list[RepositoryCandidate]
    topics: list[TopicCandidate]

class AIRepositoryScanStage(StageBase):
    name = "ai_repository_scan"

    def run(self, repo_path: Path, llm_client: LLMClient, ...) -> RepositoryScanResult:
        # 构建 prompt
        # 调用 LLM
        # 解析响应
        # 返回结果
```

---

### Step 4: 实现 AIEntityAnalysisStage

**文件:** `backend/pipeline/stages/ai_entity_analysis.py`

**任务:**
- [ ] 4.1 创建 `AIEntityAnalysisStage` 类，继承 `StageBase`
- [ ] 4.2 实现 `run()` 方法入口（并行处理实体）
- [ ] 4.3 定义 System Prompt（JPA 实体分析专家）
- [ ] 4.4 定义 User Prompt 模板
- [ ] 4.5 实现 `Pydantic` 输出模型 `EntityAnalysisResponse`
- [ ] 4.6 实现并发调度（ThreadPoolExecutor）
- [ ] 4.7 实现失败重试逻辑
- [ ] 4.8 添加进度回调支持

**依赖:** Step 1, Step 3

**关键代码结构:**
```python
class EntityAnalysisResponse(BaseModel):
    entity_name: str
    table_name: str
    primary_key: str
    fields: list[FieldInfo]
    relationships: list[RelationshipInfo]

class AIEntityAnalysisStage(StageBase):
    name = "ai_entity_analysis"

    def run(self, candidates: list[EntityCandidate], llm_client: LLMClient, ...) -> list[EntityAnalysisResult]:
        # 并发处理每个实体
        with ThreadPoolExecutor(max_workers=self.max_concurrency) as executor:
            futures = {executor.submit(self._analyze_entity, c, llm_client): c for c in candidates}
            # 收集结果
```

---

### Step 5: 实现 AIFieldLineageStage

**文件:** `backend/pipeline/stages/ai_field_lineage.py`

**任务:**
- [ ] 5.1 创建 `AIFieldLineageStage` 类，继承 `StageBase`
- [ ] 5.2 实现 `run()` 方法入口
- [ ] 5.3 定义 System Prompt（数据血缘分析专家）
- [ ] 5.4 定义 User Prompt 模板（包含实体和字段摘要）
- [ ] 5.5 实现 `Pydantic` 输出模型 `FieldLineageResponse`
- [ ] 5.6 实现字段血缘边的构建逻辑
- [ ] 5.7 添加进度回调支持

**依赖:** Step 1, Step 4

**关键代码结构:**
```python
class FieldLineageResponse(BaseModel):
    field_lineages: list[FieldLineage]

class AIFieldLineageStage(StageBase):
    name = "ai_field_lineage"

    def run(self, entity_results: list[EntityAnalysisResult], service_candidates: list[ServiceCandidate], llm_client: LLMClient, ...) -> list[FieldLineage]:
        # 构建上下文摘要
        # 调用 LLM
        # 解析响应
```

---

### Step 6: 实现 AIDescriptionStage（增强版）

**文件:** `backend/pipeline/stages/ai_description_stage.py`（已存在，需扩展）

**任务:**
- [ ] 6.1 扩展现有 `AIDescriptionStage` 支持实体描述
- [ ] 6.2 添加字段描述生成逻辑
- [ ] 6.3 添加实体重要性评分逻辑
- [ ] 6.4 实现并发处理（实体级并行）
- [ ] 6.5 更新输出模型包含 `importance_score` 和 `importance_reason`

**依赖:** Step 1, Step 4

---

### Step 7: 实现 GraphBuildStage

**文件:** `backend/pipeline/stages/ai_graph_build.py`

**任务:**
- [ ] 7.1 创建 `AIGraphBuildStage` 类
- [ ] 7.2 实现 `_create_entity_nodes()` 方法
- [ ] 7.3 实现 `_create_table_nodes()` 方法
- [ ] 7.4 实现 `_create_field_nodes()` 方法
- [ ] 7.5 实现 `_create_flow_nodes()` 方法
- [ ] 7.6 实现 `_create_relationship_edges()` 方法
- [ ] 7.7 实现 `_create_lineage_edges()` 方法
- [ ] 7.8 实现 PageRank 计算
- [ ] 7.9 实现质量报告生成

**依赖:** Step 2, Step 4, Step 5, Step 6

**关键代码结构:**
```python
class AIGraphBuildStage(StageBase):
    name = "ai_graph_build"

    def run(self, scan_result, entity_results, lineages, descriptions, ...) -> tuple[BuiltGraph, QualityReport]:
        nodes = []
        edges = []

        # 创建节点
        nodes.extend(self._create_entity_nodes(entity_results, descriptions))
        nodes.extend(self._create_table_nodes(entity_results))
        nodes.extend(self._create_field_nodes(entity_results))

        # 创建边
        edges.extend(self._create_maps_to_edges(entity_results))
        edges.extend(self._create_has_field_edges(entity_results))
        edges.extend(self._create_relationship_edges(entity_results))
        edges.extend(self._create_lineage_edges(lineages))

        # 计算指标
        metrics = self._calculate_metrics(nodes, edges)

        return BuiltGraph(nodes=nodes, edges=edges, metrics=metrics), quality_report
```

---

### Step 8: 实现 AIFirstPipeline

**文件:** `backend/pipeline/ai_first_pipeline.py`

**任务:**
- [ ] 8.1 创建 `AIFirstPipeline` 类
- [ ] 8.2 实现 `analyze()` 方法（编排所有 Stage）
- [ ] 8.3 实现进度回调集成
- [ ] 8.4 实现 Observer 事件集成
- [ ] 8.5 实现缓存支持（可选）
- [ ] 8.6 实现增量分析支持（可选）
- [ ] 8.7 添加配置选项（开关、并发数等）

**依赖:** Step 3, Step 4, Step 5, Step 6, Step 7

**关键代码结构:**
```python
class AIFirstPipeline:
    def __init__(self, config: AIAnalysisConfig = None, ...):
        self.config = config or AIAnalysisConfig()

    def analyze(self, repo_path: Path, repo_name: str, enable_rag: bool = False, ...) -> AIAnalysisResult:
        # Stage 1: 仓库扫描
        scan_result = self._run_stage1(repo_path, llm_client)

        # Stage 2: 实体分析（并行）
        entity_results = self._run_stage2(scan_result.entities, llm_client)

        # Stage 3: 字段血缘
        lineages = self._run_stage3(entity_results, scan_result.services, llm_client)

        # Stage 4: 描述生成
        descriptions = self._run_stage4(entity_results, llm_client)

        # Stage 5: 构建图谱
        built, quality = self._run_stage5(scan_result, entity_results, lineages, descriptions)

        # 持久化
        graph_id = self._repo.save(built, repo_name=repo_name)

        return AIAnalysisResult(graph_id=graph_id, nodes=built.nodes, edges=built.edges, ...)
```

---

### Step 9: 集成到 API

**文件:** `backend/api/routers/analysis.py`

**任务:**
- [ ] 9.1 添加 `pipeline_mode` 参数到 `/analyze/repository` 端点
- [ ] 9.2 实现流水线选择逻辑（`static_first` / `ai_first`）
- [ ] 9.3 更新 API 文档

**文件:** `backend/api/routers/graphs.py`

**任务:**
- [ ] 9.4 添加 `/graph/entities` 端点
- [ ] 9.5 添加 `/graph/field-lineage` 端点
- [ ] 9.6 添加 `/graph/entity/{entity_id}` 端点
- [ ] 9.7 更新 `/graph/framework` 支持 `node_types` 过滤

**依赖:** Step 8

---

### Step 10: 前端 - 扩展节点类型渲染

**文件:** `code-graph-ui/src/components/graph/GraphViewer/`

**任务:**
- [ ] 10.1 添加新节点类型的样式定义（Entity, Table, Field, Flow, FlowNode）
- [ ] 10.2 更新 `nodeColors` 和 `nodeShapes` 配置
- [ ] 10.3 添加节点图标映射

**依赖:** 无（可与后端并行）

---

### Step 11: 前端 - 扩展边类型渲染

**文件:** `code-graph-ui/src/components/graph/GraphViewer/`

**任务:**
- [ ] 11.1 添加新边类型的样式定义（maps_to, has_field, one_to_one, flow_to）
- [ ] 11.2 实现边标签显示（1:1, 1:N, M:N）
- [ ] 11.3 实现不同线型（虚线、实线、带箭头）

**依赖:** Step 10

---

### Step 12: 前端 - 扩展节点详情面板

**文件:** `code-graph-ui/src/components/NodeDetailPanel/`

**任务:**
- [ ] 12.1 添加 Entity 节点详情展示（表名、字段列表、关系列表、重要性评分）
- [ ] 12.2 添加 Field 节点详情展示（类型、列名、是否主键/外键、血缘）
- [ ] 12.3 添加 Flow 节点详情展示（包含节点、执行逻辑）
- [ ] 12.4 添加描述文本展示

**依赖:** Step 10

---

### Step 13: 前端 - 新增字段血缘视图

**文件:** `code-graph-ui/src/pages/FieldLineage/`

**任务:**
- [ ] 13.1 创建 `FieldLineage` 页面组件
- [ ] 13.2 实现字段选择器（实体 + 字段下拉）
- [ ] 13.3 实现血缘图展示（流入/流出）
- [ ] 13.4 添加路由配置

**依赖:** Step 11, Step 12

---

### Step 14: 单元测试

**文件:** `backend/tests/test_ai_first_pipeline.py`

**任务:**
- [ ] 14.1 编写 `AIRepositoryScanStage` 测试
- [ ] 14.2 编写 `AIEntityAnalysisStage` 测试
- [ ] 14.3 编写 `AIFieldLineageStage` 测试
- [ ] 14.4 编写 `AIGraphBuildStage` 测试
- [ ] 14.5 编写 `AIFirstPipeline` 集成测试

**依赖:** Step 8

---

### Step 15: 文档更新

**文件:** `CLAUDE.md`, `README.md`

**任务:**
- [ ] 15.1 更新 CLAUDE.md 添加 AI 优先流水线说明
- [ ] 15.2 更新 API 文档
- [ ] 15.3 更新前端文档

**依赖:** Step 13, Step 14

---

## 依赖关系图

```
Step 1 (数据模型)
  │
  ├─► Step 2 (Schema)
  │     │
  │     └─► Step 7 (GraphBuild)
  │
  ├─► Step 3 (RepositoryScan)
  │     │
  │     └─► Step 8 (Pipeline)
  │
  ├─► Step 4 (EntityAnalysis)
  │     │
  │     ├─► Step 5 (FieldLineage)
  │     │     │
  │     │     └─► Step 7 (GraphBuild)
  │     │
  │     ├─► Step 6 (Description)
  │     │     │
  │     │     └─► Step 7 (GraphBuild)
  │     │
  │     └─► Step 7 (GraphBuild)
  │
  └─► Step 5, 6 (见上)

Step 7 (GraphBuild) ─► Step 8 (Pipeline) ─► Step 9 (API)

Step 10, 11, 12, 13 (前端，可并行)
  │
  └─► Step 15 (文档)

Step 14 (测试) 可在 Step 8 完成后开始
```

---

## 执行顺序建议

**Phase 1: 后端核心（Day 1-4）**
1. Step 1 → Step 2 → Step 3 → Step 4 → Step 5 → Step 6 → Step 7 → Step 8

**Phase 2: API 集成（Day 5）**
2. Step 9

**Phase 3: 前端适配（Day 5-7，可与 Phase 2 并行）**
3. Step 10 → Step 11 → Step 12 → Step 13

**Phase 4: 测试与文档（Day 8-9）**
4. Step 14 → Step 15

---

## 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| LLM 输出格式不稳定 | 使用 Pydantic 强校验 + 重试机制 |
| 大仓库超出 context | 分批处理 + 摘要压缩 |
| 并发调用 API 限速 | 使用 ConcurrencyController 动态调整 |

---

*计划完成，待审核后开始实施*
