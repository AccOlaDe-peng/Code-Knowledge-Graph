# AI 分析流水线性能优化设计文档

## 概述

### 问题背景

当前 AI 分析流水线在处理大型仓库（1000+ 文件）时存在性能瓶颈，主要问题包括：

1. **重复扫描**：Step 2（ModuleScannerAgent）和 Step 3（AgentOrchestrator）各自独立扫描仓库
2. **文件重复读取**：同一文件可能被多个 Agent 重复读取，浪费 I/O 和 LLM Token
3. **并发策略固定**：并发度固定为 2-5，无法根据 API 响应动态调整
4. **小模块开销大**：每个模块独立 LLM 调用，小型模块的 API 往返开销占比高
5. **失败重跑成本高**：任意阶段失败需要全量重跑，缺乏细粒度缓存

### 优化目标

针对大型仓库（1000+ 文件）的首次分析场景，实现：

- **吞吐量提升 2-3 倍**
- **Token 消耗降低 20-30%**
- **支持断点续跑**
- **GLM API 速率自适应**

---

## 架构设计

### 整体架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Pipeline Orchestrator                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────┐    ┌─────────────────┐    ┌─────────────────────────┐ │
│  │   Stage 0   │    │     Stage 1     │    │        Stage 2          │ │
│  │ FileIndex   │───▶│ StructureParse  │───▶│ ModuleBoundary (AI)     │ │
│  │ (静态扫描)  │    │ (骨架解析+缓存) │    │ (模块边界识别+缓存)     │ │
│  └─────────────┘    └─────────────────┘    └─────────────────────────┘ │
│         │                   │                        │                  │
│         ▼                   ▼                        ▼                  │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    SharedKnowledgePool                           │   │
│  │  • FileIndex (路径 → 文件元信息)                                 │   │
│  │  • StructureIndex (路径 → 类/方法骨架)                           │   │
│  │  • ContentCache (路径 → 文件内容 LRU 缓存)                       │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                    │                                    │
│                                    ▼                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    Stage 3: ParallelAnalysis                     │   │
│  │  ┌───────────────────────────────────────────────────────────┐  │   │
│  │  │              IntelligentScheduler                          │  │   │
│  │  │  • 按模块预估复杂度排序 (小优先)                          │  │   │
│  │  │  • 动态并发度 (GLM 速率自适应)                             │  │   │
│  │  │  • 批次合并 (Token ≤ 8000 合并调用)                       │  │   │
│  │  └───────────────────────────────────────────────────────────┘  │   │
│  │                              │                                   │   │
│  │                              ▼                                   │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐               │   │
│  │  │ Agent 1 │ │ Agent 2 │ │ Agent 3 │ │ Agent N │  (并行)       │   │
│  │  │ Module A│ │ Module B│ │ Module C│ │ Module N│               │   │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘               │   │
│  │       │           │           │           │                     │   │
│  │       └───────────┴───────────┴───────────┘                     │   │
│  │                           │                                      │   │
│  │                           ▼                                      │   │
│  │              ModuleResultCache (模块级缓存)                      │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                    │                                    │
│                                    ▼                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    Stage 4: GraphMerge                           │   │
│  │  • 合并所有模块结果                                              │   │
│  │  • 计算 PageRank / 度指标                                        │   │
│  │  • 持久化 (JSON + Neo4j)                                         │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 阶段定义

| Stage | 名称 | 输入 | 输出 | 缓存 | 耗时占比 |
|-------|------|------|------|------|----------|
| 0 | FileIndex | repo_path | FileIndex | 可选持久化 | 1-2% |
| 1 | StructureParse | FileIndex | StructureIndex | 可选持久化 | 5-10% |
| 2 | ModuleBoundary | StructureIndex | ModulePlan | 可选持久化 | 10-15% |
| 3 | ParallelAnalysis | ModulePlan + SharedPool | ModuleResults | 模块级缓存 | 60-75% |
| 4 | GraphMerge | ModuleResults | BuiltGraph | 无 | 5-10% |

---

## 核心组件设计

### 1. SharedKnowledgePool（共享知识池）

**职责**：统一管理分析过程中的共享数据，避免重复计算和 I/O。

**数据结构**：

```python
@dataclass
class FileInfo:
    """文件元信息"""
    path: str                    # 相对路径
    absolute_path: Path          # 绝对路径
    language: str                # 语言类型
    size_bytes: int              # 文件大小
    line_count: int              # 行数
    modified_time: float         # mtime

@dataclass
class SharedKnowledgePool:
    """共享知识池"""

    # 文件索引：路径 → FileInfo
    file_index: dict[str, FileInfo]

    # 结构索引：复用现有 StructureIndexer
    structure_indexer: StructureIndexer

    # 文件内容缓存：LRU 策略
    content_cache: LRUCache[str, str]

    # 配置
    max_content_cache_bytes: int = 100 * 1024 * 1024  # 100MB

    def get_file_info(self, path: str) -> FileInfo | None:
        """获取文件元信息"""

    def get_structure(self, path: str) -> FileSkeleton | None:
        """获取文件骨架（类/方法）"""

    def get_content(self, path: str) -> str | None:
        """获取文件内容（自动缓存）"""

    def estimate_tokens(self, paths: list[str]) -> int:
        """估算一组文件的 Token 数"""
```

**文件内容缓存策略**：
- LRU 淘汰策略，最大 100MB
- 读取时自动缓存，后续读取直接从内存返回
- 提供手动预加载接口 `preload_contents(paths)`

### 2. StageCacheManager（阶段缓存管理器）

**职责**：管理各阶段的缓存，支持断点续跑。

**数据结构**：

```python
@dataclass
class StageCacheEntry:
    """阶段缓存条目"""
    stage_name: str              # 阶段名称
    repo_name: str               # 仓库名称
    commit_sha: str              # Git commit SHA
    created_at: datetime         # 创建时间
    data: Any                    # 缓存数据
    checksum: str                # 数据校验和

class StageCacheManager:
    """阶段缓存管理器"""

    def __init__(self, cache_dir: Path = Path("data/cache")):
        self.cache_dir = cache_dir
        self._memory_cache: dict[str, StageCacheEntry] = {}

    def get_cache_key(self, repo_name: str, commit_sha: str, stage: str) -> str:
        """生成缓存 Key"""
        return f"{repo_name}:{commit_sha[:8]}:{stage}"

    def load(self, repo_name: str, commit_sha: str, stage: str) -> StageCacheEntry | None:
        """加载阶段缓存（内存 → 磁盘）"""

    def save(self, entry: StageCacheEntry, persist: bool = False) -> None:
        """保存阶段缓存"""

    def clear(self, repo_name: str) -> None:
        """清除指定仓库的所有缓存"""
```

**缓存策略**：
- 内存缓存：分析期间所有阶段数据都在内存中
- 可选持久化：分析完成后可选择持久化到 `data/cache/{repo_name}/`
- 校验和验证：加载缓存时校验数据完整性

### 3. IntelligentScheduler（智能调度器）

**职责**：根据模块特征智能调度分析任务，优化 GLM API 调用效率。

**数据结构**：

```python
@dataclass
class ModuleScheduleInfo:
    """模块调度信息"""
    module_id: str
    module_name: str
    file_count: int
    estimated_tokens: int        # 预估 Token 数
    complexity_score: float      # 复杂度评分 (0-1)
    priority: int                # 调度优先级

@dataclass
class SchedulerConfig:
    """调度器配置"""
    initial_concurrency: int = 3         # 初始并发度
    max_concurrency: int = 8             # 最大并发度
    min_concurrency: int = 1             # 最小并发度
    batch_token_threshold: int = 8000    # 批次合并阈值
    response_time_threshold_ms: int = 3000  # 响应时间阈值
    rate_limit_backoff_base: float = 5.0    # 速率限制退避基数

class IntelligentScheduler:
    """智能调度器"""

    def __init__(self, config: SchedulerConfig, pool: SharedKnowledgePool):
        self.config = config
        self.pool = pool
        self.current_concurrency = config.initial_concurrency
        self.response_times: deque[float] = deque(maxlen=10)
        self.rate_limit_count = 0

    def schedule(self, modules: list[ModuleInfo]) -> list[ModuleBatch]:
        """生成调度计划"""

    def adjust_concurrency(self, response_time_ms: float) -> None:
        """根据响应时间调整并发度"""

    def on_rate_limit(self) -> float:
        """处理速率限制，返回等待时间"""

    def on_success(self, response_time_ms: float) -> None:
        """处理成功响应"""
```

**调度策略**：

1. **优先级排序**：
   - 按 `complexity_score` 升序排序（小模块优先）
   - 复杂度计算：`complexity_score = estimated_tokens / max_tokens + file_count / 100`

2. **批次合并**：
   - 相邻的小型模块（Token ≤ 8000）合并为单次 LLM 调用
   - 合并后的总 Token 不超过 16000

3. **自适应并发**：
   - 响应时间 < 3s：并发度 +1（不超过 max）
   - 响应时间 > 5s：并发度 -1（不低于 min）
   - 连续 3 次 429：并发度减半，退避等待

### 4. 批次合并调用

**职责**：将多个小型模块合并为单次 LLM 调用，减少 API 往返。

**数据结构**：

```python
@dataclass
class ModuleBatch:
    """模块批次"""
    batch_id: str
    modules: list[ModuleInfo]
    total_estimated_tokens: int
    is_merged: bool              # 是否合并批次

    def to_prompt(self, pool: SharedKnowledgePool) -> str:
        """生成合并后的提示词"""

    def parse_response(self, response: str) -> dict[str, ModuleResult]:
        """解析合并后的响应"""
```

**合并提示词模板**：

```
请分析以下 {N} 个代码模块，提取类、函数、调用关系。

## 模块列表

{for each module}
### 模块 {i}: {module_name}
职责: {module_purpose}
文件: {file_list}

{file_contents}
{end for}

## 输出格式

请以 JSON 格式输出，按模块 ID 组织：

```json
{
  "{module_id_1}": {
    "functions": [...],
    "classes": [...],
    "calls": [...]
  },
  "{module_id_2}": {
    ...
  }
}
```

只输出 JSON，不要其他解释。
```

---

## 数据流详细设计

### Stage 0: FileIndex

**输入**：`repo_path: Path`

**处理**：
```python
def run_stage_0(repo_path: Path) -> FileIndex:
    scanner = RepoScanner()
    scan_result = scanner.scan(repo_path)

    file_index = {}
    for file_info in scan_result.files:
        absolute_path = repo_path / file_info.path
        file_index[file_info.path] = FileInfo(
            path=file_info.path,
            absolute_path=absolute_path,
            language=detect_language(file_info.path),
            size_bytes=absolute_path.stat().st_size,
            line_count=count_lines(absolute_path),
            modified_time=absolute_path.stat().st_mtime,
        )

    return file_index
```

**输出**：`FileIndex: dict[str, FileInfo]`

**耗时预估**：< 5s（1000 文件）

### Stage 1: StructureParse

**输入**：`FileIndex`

**处理**：
```python
def run_stage_1(file_index: FileIndex) -> StructureIndexer:
    indexer = StructureIndexer(depth="standard")
    indexer.build_index_from_file_index(file_index)
    return indexer
```

**输出**：`StructureIndexer`（已构建索引）

**耗时预估**：10-30s（1000 文件，取决于语言分布）

### Stage 2: ModuleBoundary

**输入**：`FileIndex + StructureIndexer`

**处理**：
```python
def run_stage_2(pool: SharedKnowledgePool, llm_client: LLMClient) -> ModulePlan:
    # 使用结构索引辅助模块识别
    context = AgentContext(
        repo_path=pool.repo_path,
        module_id="scanner",
        shared_knowledge=SharedKnowledgeBase(),
    )

    # 注入结构索引到 context
    context.structure_indexer = pool.structure_indexer

    agent = ModuleScannerAgent(context=context, llm_client=llm_client)
    scan_result = ScanResult(
        repo_path=str(pool.repo_path),
        files=[f for f in pool.file_index.values()],
    )

    return agent.scan(scan_result)
```

**输出**：`ModulePlan`（模块列表 + 架构提示）

**耗时预估**：30-60s（1 次 LLM 调用）

### Stage 3: ParallelAnalysis

**输入**：`ModulePlan + SharedKnowledgePool`

**处理**：
```python
def run_stage_3(
    modules: list[ModuleInfo],
    pool: SharedKnowledgePool,
    llm_client: LLMClient,
    config: SchedulerConfig,
) -> list[ModuleResult]:
    scheduler = IntelligentScheduler(config, pool)

    # 生成调度计划
    batches = scheduler.schedule(modules)

    results = []
    for batch in batches:
        if batch.is_merged:
            # 批次合并调用
            prompt = batch.to_prompt(pool)
            response = llm_client.complete(prompt, max_tokens=8192)
            batch_results = batch.parse_response(response)
            results.extend(batch_results.values())
        else:
            # 单模块 Agent 分析
            for module in batch.modules:
                result = run_agent_for_module(module, pool, llm_client)
                results.append(result)

                # 更新调度器状态
                scheduler.on_success(result.execution_time_ms)

    return results
```

**输出**：`list[ModuleResult]`

**耗时预估**：主要耗时阶段，取决于模块数量和 GLM API 速率

### Stage 4: GraphMerge

**输入**：`list[ModuleResult]`

**处理**：
```python
def run_stage_4(results: list[ModuleResult]) -> BuiltGraph:
    builder = GraphBuilder()

    for result in results:
        for node in result.nodes:
            builder.add_node(node)
        for edge in result.edges:
            builder.add_edge(edge)

    return builder.build()
```

**输出**：`BuiltGraph`

**耗时预估**：< 10s

---

## 性能优化对比

### 优化前 vs 优化后

| 指标 | 优化前 | 优化后 | 提升 |
|------|--------|--------|------|
| 文件扫描次数 | 2 次 | 1 次 | 50% |
| 文件读取次数 | N × M（N 模块 × M 重复读取） | N（每文件最多 1 次） | 60-80% |
| LLM 调用次数 | 模块数 | 模块数 - 合并数 | 10-30% |
| 并发效率 | 固定并发 | 自适应并发 | 15-25% |
| 失败恢复 | 全量重跑 | 阶段级断点续跑 | 可靠性提升 |

### 预期整体提升

- **吞吐量**：2-3 倍
- **Token 消耗**：降低 20-30%
- **首次分析耗时**：1000 文件仓库从 ~30 分钟降至 ~10-15 分钟

---

## 文件结构

```
backend/
├── pipeline/
│   ├── __init__.py
│   ├── ai_analyze.py              # 重构后的入口
│   ├── optimized_pipeline.py      # 新的优化流水线
│   ├── stages/
│   │   ├── __init__.py
│   │   ├── base.py                # Stage 基类
│   │   ├── file_index.py          # Stage 0: 文件索引
│   │   ├── structure_parse.py     # Stage 1: 结构解析
│   │   ├── module_boundary.py     # Stage 2: 模块边界
│   │   ├── parallel_analysis.py   # Stage 3: 并行分析
│   │   └── graph_merge.py         # Stage 4: 图谱合并
│   └── stage_cache.py             # 阶段缓存管理
│
├── cache/
│   ├── __init__.py
│   ├── shared_knowledge_pool.py   # 共享知识池
│   ├── content_cache.py           # 文件内容 LRU 缓存
│   └── stage_cache_manager.py     # 阶段缓存管理器
│
├── scheduler/
│   ├── __init__.py
│   ├── intelligent_scheduler.py   # 智能调度器
│   └── module_batch.py            # 模块批次
│
└── agent/
    ├── orchestrator.py            # 重构：使用 SharedKnowledgePool
    └── agents/
        └── architecture.py        # 重构：从池中获取文件内容
```

---

## 兼容性设计

### 向后兼容

1. **保留原有 API**：`AIPipeline.analyze()` 接口不变
2. **配置切换**：通过 `enable_optimization=True/False` 切换新旧流程
3. **渐进式迁移**：新组件先实现，稳定后替换旧组件

### 配置项

```python
@dataclass
class OptimizationConfig:
    """优化配置"""

    # 是否启用优化流程
    enable_optimization: bool = True

    # 缓存配置
    enable_stage_cache: bool = True
    persist_cache: bool = False          # 是否持久化缓存
    max_content_cache_mb: int = 100      # 内容缓存最大 MB

    # 调度配置
    initial_concurrency: int = 3
    max_concurrency: int = 8
    batch_token_threshold: int = 8000

    # GLM 专属配置
    glm_rate_limit_backoff: float = 5.0
    glm_max_retries: int = 5
```

---

## 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 内存占用增加 | 大仓库可能 OOM | LRU 缓存 + 最大内存限制 |
| 批次合并质量下降 | 分析结果不完整 | 保守合并策略 + Token 阈值 |
| GLM API 变化 | 速率限制策略失效 | 可配置退避参数 + 监控告警 |
| 阶段缓存损坏 | 断点续跑失败 | 校验和验证 + 自动降级 |

---

## 实施计划

### Phase 1：基础设施（1-2 天）

1. 实现 `SharedKnowledgePool`
2. 实现 `ContentCache`（LRU）
3. 实现 `StageCacheManager`

### Phase 2：调度器（1-2 天）

1. 实现 `IntelligentScheduler`
2. 实现 `ModuleBatch`
3. 单元测试

### Phase 3：阶段重构（2-3 天）

1. 重构 Stage 0/1/2
2. 重构 Stage 3（核心）
3. 集成测试

### Phase 4：集成与测试（1-2 天）

1. 重构 `AIPipeline` 入口
2. 端到端测试
3. 性能基准测试

---

## 验收标准

1. **功能正确性**：优化后的分析结果与原流程一致
2. **性能提升**：1000 文件仓库分析时间降低 50% 以上
3. **稳定性**：连续运行 10 次无崩溃，断点续跑正常
4. **兼容性**：原有 API 调用方式不变
