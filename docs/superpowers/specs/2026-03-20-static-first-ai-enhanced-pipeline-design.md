# 静态优先、AI 增强流水线设计

**日期**：2026-03-20
**状态**：已批准
**背景**：针对 2000+ 文件超大型仓库（以 Spring 为主要框架），解决当前流水线的三大痛点：速度慢、结果质量不稳定、可观测性差。

---

## 一、核心设计思路

**现有问题**：当前 OptimizedPipeline 的 Stage 2（模块识别）和 Stage 3（图谱生成）完全依赖 AI 从零生成，导致：
- LLM 调用量大（每模块一次完整分析）
- 模块边界不稳定（AI 随机性，不同运行结果不同）
- 节点/边可能遗漏（AI 推断 ≠ 代码事实）
- 无法诊断失败原因

**新思路**：将分析职责明确分为两层：

```
结构层（静态分析）：保底，确保不遗漏
  → 高召回、高确定性
  → 产出：类/函数/API 节点、显式依赖边、Spring Bean/Event/Kafka 关系

语义层（AI 增强）：补盲区，提升质量
  → 高精确、填补静态盲区
  → 产出：模块语义命名、低置信度边验证、动态关系（多实现 DI、动态 topic）
```

---

## 二、新流水线架构（六阶段）

```
Stage 0: 文件索引         asyncio IO + 增量检测（git diff / mtime）
    ↓
Stage 1: 深度静态分析     ProcessPoolExecutor + 多语言 AST + Spring 专项分析
    ↓
Stage 2: 目录聚类         目录层级主信号 + 导入图验证，零 LLM，可复现
    ↓
Stage 3: AI 语义增强      并发，Pydantic 约束输出，仅增量增强（非全量生成）
    ↓
Stage 4: Spring DI/Event  4a 静态解析（75-80%）→ 4b AI 解析歧义（20-25%）
    ↓
Stage 5: 图谱合并         节点先写/边后写，质量评分，流式写入

横切关注点：AnalysisObserver 事件总线（SSE 实时推送）
```

### 与现有 OptimizedPipeline 的对应关系

| 现有 Stage | 新 Stage | 主要变化 |
|-----------|---------|---------|
| Stage 0: FileIndex | Stage 0 | 改用 asyncio；增量检测改为 git diff 优先 |
| Stage 1: StructureParse | Stage 1 | 增加 Spring 专项分析器；产出分为 A/B 两类 |
| Stage 2: ModuleBoundary（AI） | Stage 2 | **改为纯静态目录聚类，移除 LLM 调用** |
| Stage 3: ParallelAnalysis（全量生成） | Stage 3 | **改为 AI 增量增强，仅处理 confidence < 0.80 部分** |
| 无 | Stage 4 | 新增 Spring DI/Event 专项解析（4a 静态 + 4b AI）|
| Stage 4: GraphMerge | Stage 5 | 增加质量评分 + 节点/边分离写入 |

---

## 三、Stage 详细设计

### Stage 0：文件索引

**职责**：确定本次需要分析的文件范围

**输入**：`repo_path`, `last_commit_sha`（可空）

**输出**：
```python
@dataclass
class FileIndexResult:
    all_files: dict[str, FileInfo]    # 全量文件元数据
    changed_files: set[str]           # 本次变更文件（增量模式）
    is_incremental: bool              # 是否增量分析
```

**增量检测逻辑**（优先级顺序）：
1. 有 `last_commit_sha` → `git diff --name-only <sha> HEAD` 精确获取变更文件
2. 无 git，有上次记录 → 对比文件 mtime 与上次记录
3. 首次分析 → `is_incremental=False`，全量处理

**性能优化**：文件元数据（stat + 行数统计）改用 `asyncio + aiofiles` 并发读取，替代现有串行 `open + readlines`。

---

### Stage 1：深度静态分析

**职责**：产出两类性质不同的数据，必须严格区分

**完整输出容器**（`StaticAnalysisResult`）：
```python
@dataclass
class StaticAnalysisResult:
    # 产出 A（持久化，直接入图谱）
    structural_nodes: list[GraphNode]          # 类、函数、API、数据模型（confidence ≥ 0.80）
    structural_edges: list[GraphEdge]          # 含跨模块 depends_on（来自显式 import）

    # 产出 B（临时，供后续 Stage 消费，分析完可丢弃）
    import_graph: dict[str, list[str]]         # file → 它 import 的文件列表
    framework_patterns: list[FrameworkPattern] # Spring 候选关系（DI/Event/Kafka）
    low_confidence_edges: list[GraphEdge]      # confidence < 0.80 的边，待 AI 验证
```

`StaticAnalysisResult` 由 `OptimizedPipeline` 传递给 Stage 2、3、4，Stage 5 合并时只消费产出 A。

**迁移策略**：新 Stage 1 完全替换现有 `StructureParseStage`；`SharedKnowledgePool` 增加 `static_analysis_result` 字段承载 `StaticAnalysisResult`；现有 `ModuleBoundaryStage` 和 `ParallelAnalysisStage` 被新 Stage 2/3 替换，不需要适配旧接口。

**置信度计算规则**（明确，不使用魔法数字）：

| 来源 | 置信度 |
|------|-------|
| 直接 import 语句 | 0.95 |
| 注解驱动（@app.route, @GetMapping 等） | 0.90 |
| 类型推断的方法调用 | 0.85 |
| 框架模式匹配 | 0.80 |
| 目录同级启发 | 0.65 |
| AI 验证通过（原低置信） | 0.75 |
| AI 新发现 | 0.70 |

**并行化**：`ProcessPoolExecutor`（CPU-bound AST 解析）；增量模式只解析 `changed_files` 涉及模块的文件。

**语言策略**：
- Python → `ast` 模块 + mypy 类型推断（可选，需安装）
- Java → `javalang` 优先；Java 14+ 新语法（record、sealed class 等）解析失败时自动降级为 regex fallback，置信度降至 0.65，并在 `StaticAnalysisResult` 中记录 `parse_warnings`；备选方案为 tree-sitter-java（更好的 Java 17/21 支持，列入后续 spike）
- TypeScript → TypeScript Compiler API（列入后续 spike，当前 regex fallback）
- 其他 → regex fallback（confidence 自动降级至 0.65）

**Spring 专项分析器**（`SpringFrameworkAnalyzer`）：
```python
class SpringFrameworkAnalyzer:
    detect_beans()              # @Service/@Component/@Repository/@Controller
    detect_config_beans()       # @Configuration + @Bean 方法（显式绑定，0.98）
    detect_injections()         # @Autowired / @Inject 注入点
    detect_event_publishers()   # ApplicationEventPublisher.publishEvent()
    detect_event_listeners()    # @EventListener / @TransactionalEventListener
    detect_event_classes()      # extends ApplicationEvent 的子类
    detect_kafka_producers()    # KafkaTemplate.send()
    detect_kafka_consumers()    # @KafkaListener(topics=...)
    detect_feign_clients()      # @FeignClient(name="...")
```

所有检测结果写入产出 B 的 `framework_patterns`，供 Stage 4 消费。

---

### Stage 2：目录聚类 → 模块候选

**职责**：零 LLM，纯算法，产出可复现的模块候选列表

**输入**：`all_files`（Stage 0），`import_graph`（Stage 1 产出 B）

**输出**：
```python
@dataclass
class ModuleCandidate:
    id: str
    name: str
    files: list[str]
    boundary_confidence: float
    boundary_warnings: list[str]   # 如"发现跨目录强耦合，建议 AI 关注"
```

**聚类算法**（两步，取代 Louvain）：

Step 1 — 目录层级聚类（主信号，确定性 100%）：
- 按配置的目录深度切割（默认 2 层），每个子目录 = 一个模块候选
- 特殊目录标记（不参与聚类）：`utils/`, `common/`, `constants/`, `exceptions/`, `config/`, `test/`
- **Java/Maven 项目目录规范化**：在聚类前检测并剥离公共前缀路径（`src/main/java/{package_prefix}/`），将实际业务目录归一化到相对根目录后再套用 `dir_depth`，避免整个 `src/main/java/com/example` 被视为同一模块

Step 2 — 导入图验证（辅助信号）：
- 扫描候选模块间的 import 密度
- 若两个不同目录间 import 次数 > 阈值（默认 5 次），标记 `boundary_warnings`
- `boundary_warnings` 作为提示传给 Stage 3 的 AI，不自动合并模块

**参数预设**（三档）：
```python
SmallRepoConfig:       dir_depth=2, coupling_threshold=3
MediumRepoConfig:      dir_depth=2, coupling_threshold=5   # 默认
LargeRepoConfig:       dir_depth=3, coupling_threshold=8   # 2000+ 文件
LargeJavaRepoConfig:   dir_depth=2, coupling_threshold=8   # 2000+ 文件 Java，剥离 Maven 前缀后使用
```

---

### Stage 3：AI 语义增强

**职责**：在静态图谱基础上做增量增强，不从零生成

**每个模块候选独立发起一次 AI 调用**，AI 被要求完成三件事：
1. 确认/调整模块边界（若有 `boundary_warnings`）
2. 补充 `low_confidence_edges` 中属于该模块的低置信度边的验证结果
3. 添加模块语义描述（name、purpose、layer、technology）

**低置信度边的分发规则**：
- 按边的 `from_` 节点所在文件归属到对应模块
- 跨模块的边（`from_` 和 `to` 分属不同模块）归属到 `from_` 端所在模块处理
- 分发后的边列表随 `ModuleCandidate` 一同传入该模块的 AI 调用 prompt

**AI 修正文件归属的冲突处理**：
- `confirmed_files` 与 Stage 2 聚类结果不一致时（AI 将某文件移入/移出该模块），Stage 5 合并时以 AI 的修正为准
- 被移动的文件对应的静态节点（产出 A）同步更新 `module_id` 属性
- 不触发级联重分析：被移入的文件已在其原模块中被 AI 分析过，直接保留其节点/边数据，仅更新 `module_id`

**输出格式**（Pydantic Model 约束）：
```python
class ModuleEnhancement(BaseModel):
    module_id: str
    confirmed_files: list[str]          # 确认/修正后的文件列表
    name: str                           # 语义命名
    purpose: str                        # 模块用途描述
    layer: str                          # 架构层（controller/service/repository/...）
    technology: list[str]               # 技术栈（spring-boot, kafka, ...）
    validated_edges: list[EdgeValidation]  # 对低置信度边的验证结果
    new_relationships: list[NewRelationship]  # AI 发现的额外关系
```

**格式校验失败**：直接重试（最多 2 次），不在代码里手工修 JSON。

**并发策略**：继承现有 `IntelligentScheduler` + `ConcurrencyController`，`boundary_warnings` 非空的模块优先调度。

---

### Stage 4：Spring DI/Event 关系解析

#### Stage 4a：静态解析（零 LLM）

**输入**：Stage 1 产出 B 的 `framework_patterns`，application.yml / .properties

**静态可解的场景（覆盖约 75-80%）**：

| 场景 | 处理方式 | 置信度 |
|------|---------|-------|
| `@Autowired` + 单实现 | 直接绑定 | 0.90 |
| `@Autowired` + `@Qualifier` | 直接绑定 | 0.95 |
| `@Configuration @Bean` 显式声明 | 直接绑定 | 0.98 |
| `@Primary` 标注默认实现 | 直接绑定 | 0.88 |
| `@EventListener` + 具体事件类 | 类名精确匹配 | 0.92 |
| `@KafkaListener` + 字符串常量 topic | 追踪常量定义 | 0.90 |
| `@Value` 注入的 topic | 解析 application.yml 替换后匹配 | 0.85 |
| `@FeignClient(name=...)` | name 映射到服务名 | 0.88 |

**构建 Topic Registry**：
```
扫描所有 produce 点 → topic 名称 → 对应模块
扫描所有 consume 点 → topic 名称 → 对应模块
按 topic 精确匹配 → 生成 produces/consumes 边
```

**多环境配置文件解析策略**：
- 优先加载：`application.yml` → `application-default.yml`
- 次级加载：`application-dev.yml`（仅作参考，不覆盖主配置）
- 无法从配置文件解析的 `@Value` 注入 topic → 标记为 `dynamic_topic`，移入 Stage 4b 歧义列表，**不静默忽略**

**输出**：已解析的 DI/Event 边 + 无法静态解析的"歧义列表"（交 Stage 4b）

#### Stage 4b：AI 解析歧义（LLM）

**只处理 Stage 4a 无法确定的三类场景**：

| 类型 | 例子 | AI 任务 |
|------|------|---------|
| 多实现 DI | `@Autowired PaymentService`（AliPay/WechatPay 两个实现） | 根据 `@Conditional/@Profile` 推断实际注入 |
| 动态 topic | `kafkaTemplate.send(topicPrefix + "-" + env, ...)` | 推断 topic 的实际值 |
| 事件多态 | `@EventListener` 监听父类，子类也触发 | 识别所有子类发布者 |

**批处理策略**：按类型分组（DI 歧义一批、Kafka 动态 topic 一批、事件多态一批），prompt 小且聚焦。

**若 Stage 4a 的 `framework_patterns` 为空**：Stage 4 直接跳过。

---

### Stage 5：图谱合并 + 质量评分

**写入顺序**（保证边的引用完整性）：
1. 先写所有节点（产出 A + Stage 3 补充节点）
2. 再写所有边（静态边 + Stage 3 验证边 + Stage 4 DI/Event 边）

**节点去重策略**：当 Stage 3 补充节点与 Stage 1 产出 A 存在相同 `id` 时，合并属性（AI 补充的 `purpose`、`layer`、`technology` 字段追加到静态节点，静态节点的 `source=static` 和 `confidence` 保持不变）。与现有 `GraphBuilder.merge_graph()` 的"后者覆盖"规则不同，此处采用**字段级合并**而非整体覆盖，以保留静态分析的高置信度元数据。

**节点元数据**（新增字段）：
```python
properties["source"] = "static" | "ai_enhanced"
properties["confidence"] = 0.0 ~ 1.0
```

**质量报告**（每次分析完成后输出）：
```python
@dataclass
class QualityReport:
    # 模块级
    modules: list[ModuleQuality]
        # module_id, boundary_confidence, node_coverage
        # ai_correction_count（AI 修正了多少静态结论）
        # low_confidence_edge_count

    # 图谱级
    low_confidence_edge_ratio: float    # < 0.7 的边占比
    failed_modules: list[str]           # Stage 3/4 失败的模块
    static_node_ratio: float            # 静态产出节点占比
    ai_node_ratio: float                # AI 产出节点占比
    stage_metrics: dict[str, StageMetrics]  # 每阶段耗时、LLM 调用次数、cache 命中率
```

**告警阈值**：

| 指标 | WARNING | ERROR |
|------|---------|-------|
| `low_confidence_edge_ratio` | > 0.30 | > 0.50 |
| `failed_modules` 占比 | > 0.10 | > 0.20 |
| `ai_correction_count`（单模块） | > 5 次 | > 10 次 |

**消费路径**：`QualityReport` 同时通过两条路径传递：
1. 包含在 `AIPipeline.analyze()` 返回的 `AnalysisResult` 中（供调用方程序消费）
2. 通过 `AnalysisObserver.emit(AnalysisCompleted(quality_report))` 推送给 SSE 订阅方（供前端展示）

---

## 四、横切关注点：AnalysisObserver

**技术方案**：线程安全同步队列 + asyncio 桥接 + FastAPI SSE

分析流水线运行在 `ThreadPoolExecutor`（Stage 1/3）和 `ProcessPoolExecutor`（Stage 1 AST）中，FastAPI SSE endpoint 运行在 asyncio 事件循环中，两者需要通过桥接连接：

```python
class AnalysisObserver:
    def __init__(self):
        self._sync_queue = queue.Queue()   # 供分析线程（Thread/Process）put 事件

    def emit(self, event: AnalysisEvent):
        self._sync_queue.put(event)        # 任意线程调用，非阻塞

    async def stream(self):               # FastAPI async generator，供 SSE endpoint 使用
        loop = asyncio.get_event_loop()
        while True:
            # 在 executor 中阻塞等待，不阻塞 asyncio 事件循环
            event = await loop.run_in_executor(None, self._sync_queue.get)
            yield event
```

`GET /analysis/stream/{task_id}` SSE endpoint 消费 `observer.stream()`，每个分析任务对应一个独立 observer 实例。

**终止信号**：分析完成时 `emit(StreamEnd(task_id))` 作为哨兵，`stream()` 收到后 `break` 并关闭生成器，客户端收到 `StreamEnd` 后断开连接。

**事件类型**（覆盖三个痛点维度）：

```python
# 实时进度
StageStarted(stage, file_count, is_incremental)
ModuleAnalysisStarted(module_id, file_count, has_warnings)
ModuleAnalysisCompleted(module_id, node_count, edge_count, elapsed_ms, source)
StageCompleted(stage, elapsed_ms, cache_hit)

# 失败诊断
ModuleAnalysisFailed(module_id, stage, reason, raw_llm_output, retry_count)
LowConfidenceWarning(module_id, edge_id, confidence, description)
BoundaryWarning(module_id, message)

# 质量与性能
AnalysisCompleted(quality_report)
StageMetrics(stage, duration_ms, llm_calls, cache_hits, token_count)
```

**API 端点**：`GET /analysis/stream/{task_id}` — SSE 长连接，前端实时订阅

**日志落盘**：所有事件同时写入 `logs/analysis-{task_id}.jsonl`，供事后离线诊断。

---

## 五、增量分析机制

**模块级增量**（核心）：
- `changed_files`（Stage 0 输出）→ 找到包含这些文件的模块候选
- 只重新分析这些模块（Stage 3/4）
- 未变更模块直接从 `StageCacheManager` 加载上次结果

**缓存键设计**：
```
Stage 0/1/2：{repo_name}:{commit_sha[:8]}:stage_{n}
Stage 3/4（模块级）：{repo_name}:{commit_sha[:8]}:module_{module_id}
```

**注意**：Stage 2（目录聚类）在增量模式下仍需全量重跑（因为新文件可能改变目录结构），但因为是零 LLM 的纯算法，耗时可忽略不计（< 1 秒）。

---

## 六、预期收益（针对 2000+ 文件 Spring 仓库）

| 指标 | 当前 OptimizedPipeline | 新方案 |
|------|----------------------|-------|
| LLM 调用次数（全量分析） | N 次（每模块一次完整分析） | ~N/3 次（仅增强低置信 + DI/Event 歧义） |
| 模块边界可复现性 | 低（AI 随机） | 高（目录聚类确定性 100%） |
| 节点遗漏率 | 中（AI 可能遗漏） | 极低（静态 AST 保底） |
| Spring DI/Event 覆盖率 | 依赖 AI 发现 | 75-80% 静态确定，剩余 AI 补充 |
| 失败可诊断性 | 低（日志不完整） | 高（Observer 全程记录含 raw LLM 输出） |
| 重复分析耗时（代码无变更） | 跳过（StageCacheManager） | 同上，缓存颗粒度更细（模块级）|

---

## 七、测试策略

### 单元测试（各 Stage 独立）

| Stage | 测试方式 | Fixture 数据来源 |
|-------|---------|----------------|
| Stage 0 | 临时目录 + mock git diff 输出 | `tmp_path` pytest fixture |
| Stage 1 (Python) | 小型 Python 文件样本 | `backend/tests/fixtures/` 新建 |
| Stage 1 (Java/Spring) | 典型 Spring 注解样本（@Service/@Autowired/@KafkaListener） | `backend/tests/fixtures/spring/` 新建 |
| Stage 2 | 构造文件列表 + import_graph 字典 | 直接构造，无需真实文件 |
| Stage 3 | Mock LLM（继承现有 `MockLLMClient` 模式） | 复用 `backend/tests/` 中的 mock pattern |
| Stage 4a | Spring 代码 fixture + mock application.yml | `backend/tests/fixtures/spring/` |
| Stage 4b | Mock LLM + 歧义场景样本 | 手工构造歧义列表 |
| Stage 5 | 构造 nodes/edges 列表，验证写入顺序和质量报告 | 直接构造 |

### 集成测试

- **参照仓库**：使用项目自身（`code-graph-system/`）作为端到端测试输入
- **Spring 场景测试**：准备一个小型 Spring Boot 示例仓库（含 `@Autowired`、`@KafkaListener`、`@EventListener`），验证 Stage 4a 静态解析覆盖率
- **增量分析测试**：模拟两次提交（首次全量 → 修改一个文件 → 增量），验证只有变更模块被重新分析

### AnalysisObserver 测试

- 验证 `emit()` 在多线程并发调用时不丢事件
- 验证 `stream()` 的 asyncio 桥接不阻塞事件循环（使用 `asyncio.wait_for` 超时断言）

---

## 八、不在本期范围内

- mypy 类型推断集成（Stage 1 Python 增强，独立 spike）
- TypeScript Compiler API 集成（独立 spike）
- ProcessPoolExecutor → Ray/Dask 分布式扩展
- 前端实时图谱流式渲染（依赖 SSE 端点，前端独立任务）
