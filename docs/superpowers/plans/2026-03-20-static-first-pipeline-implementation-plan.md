# 静态优先、AI 增强流水线实施计划

**设计文档**：`docs/superpowers/specs/2026-03-20-static-first-ai-enhanced-pipeline-design.md`
**目标**：将现有 OptimizedPipeline（5 阶段）升级为新架构（6 阶段），实现静态优先、AI 增强的分析流水线。

---

## 实施分阶段

### Phase 1：基础设施层（不涉及 LLM，可独立验证）

| 任务 | 描述 | 预估工作量 | 依赖 |
|------|------|-----------|------|
| **1.1 数据模型定义** | 定义 `StaticAnalysisResult`、`ModuleCandidate`、`FrameworkPattern`、`QualityReport` 等 dataclass | 2h | 无 |
| **1.2 AnalysisObserver** | 实现线程安全事件队列 + asyncio 桥接 + SSE endpoint | 4h | 无 |
| **1.3 Stage 0 改造** | 改用 asyncio + aiofiles；增量检测逻辑（git diff 优先） | 3h | 无 |
| **1.4 Stage 2 目录聚类** | 实现 `DirectoryClusterStage`（零 LLM，纯算法） | 4h | 无 |

### Phase 2：静态分析增强

| 任务 | 描述 | 预估工作量 | 依赖 |
|------|------|-----------|------|
| **2.1 Stage 1 重构** | 新建 `DeepStaticAnalysisStage`，产出 A/B 两类数据，使用 ProcessPoolExecutor | 6h | 1.1 |
| **2.2 SpringFrameworkAnalyzer** | 实现 Spring 注解检测（Bean/DI/Event/Kafka） | 8h | 2.1 |
| **2.3 置信度体系** | 在 GraphNode/GraphEdge 的 properties 中增加 source 和 confidence 字段；更新 GraphBuilder.merge_graph() 支持字段级合并 | 3h | 2.1 |
| **2.4 Stage 4a 静态解析** | 实现 `SpringDIEventStaticStage`（零 LLM，解析 DI/Event） | 6h | 2.2 |

### Phase 3：AI 增强层

| 任务 | 描述 | 预估工作量 | 依赖 |
|------|------|-----------|------|
| **3.1 Stage 3 AI 语义增强** | 实现 `AISemanticEnhanceStage`，拆分为调用 A（必发）+ 调用 B（按需），Pydantic 输出约束 | 8h | 2.1, 1.4 |
| **3.2 Stage 4b AI 解析歧义** | 实现 `SpringDIEventAIStage`，批处理 + max_items_per_batch | 4h | 2.4 |
| **3.3 并行调度改造** | 修改 OptimizedPipeline 使 Stage 3 和 Stage 4a 并行执行 | 3h | 3.1, 2.4 |

### Phase 4：合并与质量评分

| 任务 | 描述 | 预估工作量 | 依赖 |
|------|------|-----------|------|
| **4.1 Stage 5 图谱合并** | 实现 `GraphMergeWithQualityStage`，节点/边分离写入，字段级合并 | 4h | 3.1, 3.2 |
| **4.2 QualityReport 集成** | 生成质量报告 + 告警阈值判断 + 双路径传递（返回值 + Observer） | 3h | 4.1, 1.2 |

### Phase 5：增量分析与缓存

| 任务 | 描述 | 预估工作量 | 依赖 |
|------|------|-----------|------|
| **5.1 模块级增量缓存** | 扩展 StageCacheManager 支持模块级缓存键；实现增量模式调度逻辑 | 4h | 1.3, 3.1 |
| **5.2 Stage 2 增量优化** | 实现目录变化检测，无新目录时跳过重跑 | 2h | 5.1 |

### Phase 6：集成与测试

| 任务 | 描述 | 预估工作量 | 依赖 |
|------|------|-----------|------|
| **6.1 OptimizedPipeline 串接** | 替换现有 Stage 调用为新 Stage，保持 analyze() 接口兼容 | 4h | 全部 |
| **6.2 单元测试** | 各 Stage 独立测试 + Spring fixture 准备 | 8h | 6.1 |
| **6.3 集成测试** | 端到端测试（项目自身 + Spring 示例仓库） | 4h | 6.2 |
| **6.4 文档更新** | 更新 CLAUDE.md、API 文档 | 2h | 6.3 |

---

## 任务详情

### 1.1 数据模型定义

**文件**：`backend/models/static_analysis.py`（新建）

```python
@dataclass
class FrameworkPattern:
    pattern_type: str  # "di" | "event" | "kafka" | "feign"
    source_file: str
    source_element: str  # 类名或方法名
    target_hint: str | None  # 目标提示（如 @Qualifier 值、topic 名称）
    raw_code: str  # 原始代码片段
    line_number: int
    confidence: float

@dataclass
class StaticAnalysisResult:
    # 产出 A（持久化）
    structural_nodes: list[GraphNode]
    structural_edges: list[GraphEdge]
    # 产出 B（临时）
    import_graph: dict[str, list[str]]
    framework_patterns: list[FrameworkPattern]
    low_confidence_edges: list[GraphEdge]
    parse_warnings: list[str]  # Java 14+ 降级警告

@dataclass
class ModuleCandidate:
    id: str
    name: str
    files: list[str]
    boundary_confidence: float
    boundary_warnings: list[str]

@dataclass
class QualityReport:
    modules: list[ModuleQuality]
    low_confidence_edge_ratio: float
    failed_modules: list[str]
    static_node_ratio: float
    ai_node_ratio: float
    stage_metrics: dict[str, StageMetrics]
```

**修改**：`backend/graph/graph_schema.py` — 在 GraphNode/GraphEdge 的 properties 中约定 `source` 和 `confidence` 字段（文档约定，不修改类定义）

---

### 1.2 AnalysisObserver

**文件**：`backend/pipeline/observer.py`（新建）

```python
class AnalysisEvent:
    event_type: str
    timestamp: float
    data: dict

class StreamEnd(AnalysisEvent): ...

class StageStarted(AnalysisEvent): ...
class StageCompleted(AnalysisEvent): ...
class ModuleAnalysisStarted(AnalysisEvent): ...
class ModuleAnalysisCompleted(AnalysisEvent): ...
class ModuleAnalysisFailed(AnalysisEvent): ...
class AnalysisCompleted(AnalysisEvent): ...

class AnalysisObserver:
    def __init__(self):
        self._sync_queue = queue.Queue()
        self._task_id = str(uuid4())[:8]

    def emit(self, event: AnalysisEvent):
        self._sync_queue.put(event)
        # 同时落盘到 logs/analysis-{task_id}.jsonl

    async def stream(self):
        loop = asyncio.get_running_loop()
        while True:
            event = await loop.run_in_executor(None, self._sync_queue.get)
            if isinstance(event, StreamEnd):
                break
            yield event
```

**API 端点**：`backend/api/server.py` 新增 `GET /analysis/stream/{task_id}`

---

### 1.3 Stage 0 改造

**文件**：`backend/pipeline/stages/file_index.py`

**改动**：
1. `run()` 改为 `async def run_async()`
2. 使用 `aiofiles` 并发读取文件元数据
3. 新增增量检测逻辑：
   ```python
   async def _detect_changed_files(self, repo_path, last_commit_sha) -> set[str]:
       if last_commit_sha:
           # git diff --name-only <sha> HEAD
       # fallback to mtime comparison
   ```
4. 返回 `FileIndexResult`（新增 `is_incremental` 和 `changed_files` 字段）

---

### 1.4 Stage 2 目录聚类

**文件**：`backend/pipeline/stages/directory_cluster.py`（新建）

```python
class DirectoryClusterStage(StageBase):
    name = "directory_cluster"

    def run(
        self,
        all_files: dict[str, FileInfo],
        import_graph: dict[str, list[str]],
        config: ClusterConfig,
    ) -> list[ModuleCandidate]:
        # Step 1: 目录层级聚类
        # Step 2: 导入图验证
        # 返回模块候选列表
```

**ClusterConfig**：
```python
@dataclass
class ClusterConfig:
    dir_depth: int = 2
    coupling_threshold: int = 5
    skip_dirs: list[str] = field(default_factory=lambda: ["utils", "common", "config"])
    java_maven_normalize: bool = True  # 是否剥离 Maven 前缀
```

---

### 2.1 Stage 1 重构

**文件**：`backend/pipeline/stages/deep_static_analysis.py`（新建）

```python
class DeepStaticAnalysisStage(StageBase):
    name = "deep_static_analysis"

    def run(
        self,
        repo_path: Path,
        file_index: dict[str, FileInfo],
        changed_files: set[str] | None = None,  # 增量模式
        on_progress: Callable | None = None,
    ) -> StaticAnalysisResult:
        # 1. 使用 ProcessPoolExecutor 并行 AST 解析
        # 2. 调用 SpringFrameworkAnalyzer
        # 3. 产出 structural_nodes, structural_edges, import_graph, framework_patterns, low_confidence_edges
```

---

### 2.2 SpringFrameworkAnalyzer

**文件**：`backend/analyzer/spring_analyzer.py`（新建）

```python
class SpringFrameworkAnalyzer:
    def analyze(self, file_path: Path, skeleton: FileSkeleton) -> list[FrameworkPattern]:
        # 检测 @Service/@Component/@Repository/@Controller
        # 检测 @Autowired/@Inject/@Qualifier/@Primary
        # 检测 @EventListener/@TransactionalEventListener
        # 检测 @KafkaListener/KafkaTemplate.send()
        # 检测 @FeignClient
        # 检测 @Configuration @Bean
```

---

### 2.3 置信度体系

**修改文件**：`backend/graph/graph_builder.py`

**改动**：
1. 在 `merge_graph()` 中增加字段级合并逻辑：
   ```python
   def _merge_node_properties(static_node: GraphNode, ai_node: GraphNode) -> dict:
       # 静态节点的 source 和 confidence 保持不变
       # AI 节点的 purpose/layer/technology 追加到静态节点
   ```

---

### 2.4 Stage 4a 静态解析

**文件**：`backend/pipeline/stages/spring_di_event_static.py`（新建）

```python
class SpringDIEventStaticStage(StageBase):
    name = "spring_di_event_static"

    def run(
        self,
        framework_patterns: list[FrameworkPattern],
        application_yml_path: Path | None,
    ) -> tuple[list[GraphEdge], list[FrameworkPattern]]:  # (已解析边, 歧义列表)
        # 1. 构建 Bean Registry
        # 2. 构建 Topic Registry
        # 3. 解析 application.yml 中的 @Value 占位符
        # 4. 返回已解析边 + 无法解析的歧义列表
```

---

### 3.1 Stage 3 AI 语义增强

**文件**：`backend/pipeline/stages/ai_semantic_enhance.py`（新建）

```python
class AISemanticEnhanceStage(StageBase):
    name = "ai_semantic_enhance"

    def run(
        self,
        module_candidates: list[ModuleCandidate],
        static_result: StaticAnalysisResult,
        llm_client: LLMClient,
        observer: AnalysisObserver,
    ) -> list[ModuleEnhancement]:
        # 对每个模块：
        #   调用 A（必发）：边界 + 语义
        #   调用 B（按需）：低置信度边验证
        # 并发调度（继承 IntelligentScheduler）
```

**Pydantic 输出模型**：
```python
class ModuleEnhancement(BaseModel):
    module_id: str
    confirmed_files: list[str]
    name: str
    purpose: str
    layer: str
    technology: list[str]
    validated_edges: list[EdgeValidation]
    new_relationships: list[NewRelationship]
```

---

### 3.2 Stage 4b AI 解析歧义

**文件**：`backend/pipeline/stages/spring_di_event_ai.py`（新建）

```python
class SpringDIEventAIStage(StageBase):
    name = "spring_di_event_ai"

    def run(
        self,
        ambiguities: list[FrameworkPattern],
        llm_client: LLMClient,
        max_items_per_batch: int = 20,
    ) -> list[GraphEdge]:
        # 按类型分组（DI/Kafka/Event）
        # 每批最多 20 个
        # 返回解析后的边
```

---

### 3.3 并行调度改造

**修改文件**：`backend/pipeline/optimized_pipeline.py`

```python
async def _run_parallel_stages(self, ...):
    # Stage 3 和 Stage 4a 并行
    stage3_task = asyncio.create_task(
        asyncio.to_thread(self._stage3.run, ...)
    )
    stage4a_result = self._stage4a.run(...)  # 同步，零 LLM

    stage3_result = await stage3_task

    # 合并歧义列表
    ambiguities = stage4a_result.ambiguities + stage3_result.unresolved_edges

    # Stage 4b
    stage4b_result = self._stage4b.run(ambiguities, ...)
```

---

### 4.1 Stage 5 图谱合并

**文件**：`backend/pipeline/stages/graph_merge_with_quality.py`（新建）

```python
class GraphMergeWithQualityStage(StageBase):
    name = "graph_merge_with_quality"

    def run(
        self,
        structural_nodes: list[GraphNode],
        structural_edges: list[GraphEdge],
        module_enhancements: list[ModuleEnhancement],
        di_event_edges: list[GraphEdge],
        observer: AnalysisObserver,
    ) -> tuple[BuiltGraph, QualityReport]:
        # 1. 节点先写（structural + AI 补充，字段级合并）
        # 2. 边后写（structural + AI 验证 + DI/Event）
        # 3. 更新 module_id（AI 修正文件归属）
        # 4. 生成质量报告
```

---

### 5.1 模块级增量缓存

**修改文件**：`backend/pipeline/stage_cache.py`

```python
# 新增模块级缓存键
def module_cache_key(repo_name: str, commit_sha: str, module_id: str) -> str:
    return f"{repo_name}:{commit_sha[:8]}:module_{module_id}"
```

**增量调度逻辑**：
```python
def _get_modules_to_reanalyze(
    self,
    module_candidates: list[ModuleCandidate],
    changed_files: set[str],
) -> list[ModuleCandidate]:
    # 返回包含 changed_files 的模块
```

---

## 验收标准

### 功能验收

- [ ] 分析 2000+ 文件 Spring 仓库，LLM 调用量减少 > 50%
- [ ] 相同 commit SHA 重跑，模块边界 100% 可复现
- [ ] Stage 4a 对 Spring DI/Event 静态解析覆盖率 > 70%
- [ ] SSE 实时推送进度，失败时能查看 raw_llm_output
- [ ] 增量模式：只修改一个文件时，只重新分析包含该文件的模块

### 质量验收

- [ ] 单元测试覆盖所有新 Stage
- [ ] 集成测试：项目自身 + Spring 示例仓库
- [ ] QualityReport 告警阈值正常触发

---

## 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| javalang 解析 Java 14+ 失败 | 置信度下降，但功能可用 | 自动降级为 regex + 记录 parse_warnings |
| Stage 3 并发时 LLM 限速 | 耗时增加 | 继承现有 ConcurrencyController 429 处理 |
| AI 修正文件归属频繁 | module_id 更新逻辑复杂 | 记录变更日志，Stage 5 统一处理 |

---

## 时间线

| 阶段 | 预估时间 | 里程碑 |
|------|---------|-------|
| Phase 1 | 2 天 | 基础设施可用，Stage 0/2 可独立测试 |
| Phase 2 | 3 天 | 静态分析产出 A/B 数据，Spring 分析器可用 |
| Phase 3 | 2 天 | AI 增强可用，Stage 3/4a 并行 |
| Phase 4 | 1 天 | 图谱合并 + 质量报告 |
| Phase 5 | 1 天 | 增量缓存生效 |
| Phase 6 | 2 天 | 集成测试通过，文档更新 |

**总计**：约 11 个工作日
