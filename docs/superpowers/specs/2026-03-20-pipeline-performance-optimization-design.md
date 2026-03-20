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

class SharedKnowledgePool:
    """共享知识池（线程安全）"""

    def __init__(
        self,
        repo_path: Path,
        max_content_cache_bytes: int = 100 * 1024 * 1024,  # 100MB
    ):
        self.repo_path = repo_path
        self.file_index: dict[str, FileInfo] = {}

        # 结构索引：复用现有 StructureIndexer，build_index() 在 Stage 1 调用
        self.structure_indexer: StructureIndexer = StructureIndexer(depth="standard")

        # 文件内容缓存：线程安全 LRU（使用 threading.Lock + OrderedDict 实现）
        self._content_cache: dict[str, str] = {}
        self._cache_lock = threading.Lock()
        self._max_cache_bytes = max_content_cache_bytes
        self._current_cache_bytes = 0

    def get_file_info(self, path: str) -> FileInfo | None:
        """获取文件元信息"""

    def get_structure(self, path: str) -> FileSkeleton | None:
        """获取文件骨架（类/方法），直接委托给 structure_indexer._index"""

    def get_content(self, path: str) -> str | None:
        """获取文件内容（自动缓存，线程安全）"""

    def estimate_tokens(self, paths: list[str]) -> int:
        """估算一组文件的 Token 数（GLM 计算规则：中文字符 / 1.6，其余字节 / 4）"""
```

**线程安全说明**：
- `file_index` 在 Stage 1 构建后只读，无需加锁
- `structure_indexer._index` 在 Stage 1 构建后只读，无需加锁
- `_content_cache` 并发读写需加锁，使用 `threading.Lock` 保护

**文件内容缓存策略**：
- LRU 淘汰策略，最大 100MB（按字节计）
- 读取时自动缓存，后续读取直接从内存返回，多线程竞争时仅第一个线程读磁盘
- 提供手动预加载接口 `preload_contents(paths)` 在 Stage 3 开始前预热

**GLM Token 估算公式**：
```python
def estimate_tokens(self, paths: list[str]) -> int:
    total = 0
    for path in paths:
        content = self.get_content(path) or ""
        # GLM Token 规则：1 Token ≈ 1.6 中文字符，英文约 4 字节/Token
        chinese_chars = sum(1 for c in content if '\u4e00' <= c <= '\u9fff')
        other_bytes = len(content.encode("utf-8")) - chinese_chars * 3
        total += int(chinese_chars / 1.6) + int(other_bytes / 4)
    return total
```

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
- **非 Git 仓库降级**：`commit_sha` 为空时，Key 改用目录 mtime 哈希：
  ```python
  def get_cache_key(self, repo_name: str, commit_sha: str, stage: str) -> str:
      sha = commit_sha[:8] if commit_sha else f"mtime{self._dir_mtime_hash(repo_name)}"
      return f"{repo_name}:{sha}:{stage}"
  ```
  与现有 `AnalysisCache.put()` 一致：非 Git 仓库跳过磁盘持久化，仅保留内存缓存。

### 3. IntelligentScheduler（智能调度器）

**职责**：根据模块特征智能调度分析任务，优化 GLM API 调用效率。

**GLM API 速率限制（设计依据）**：
- GLM-4 / GLM-4-Plus：**2 并发**（新用户默认，可申请提升）
- GLM-4-Flash：**200 并发**
- 并发限制触发 429 错误，非 RPM 限制
- 因此初始并发度从 **2** 开始（而非文档草稿中的 3），避免立刻触发限速

**数据结构**：

```python
@dataclass
class ModuleScheduleInfo:
    """模块调度信息"""
    module_id: str
    module_name: str
    file_count: int
    estimated_tokens: int        # 预估 Token 数（GLM 计算规则）
    complexity_score: float      # 复杂度评分 (0-1)
    priority: int                # 调度优先级

@dataclass
class SchedulerConfig:
    """调度器配置"""
    initial_concurrency: int = 2         # 初始并发度（GLM-4 默认 2 并发）
    max_concurrency: int = 5             # 最大并发度（与现有 ConcurrencyController 一致）
    min_concurrency: int = 1             # 最小并发度
    batch_token_threshold: int = 8000    # 批次合并阈值
    response_time_threshold_fast_ms: int = 3000   # 响应时间快阈值（增加并发）
    response_time_threshold_slow_ms: int = 8000   # 响应时间慢阈值（降低并发）
    rate_limit_backoff_base: float = 5.0    # 速率限制退避基数（秒）
    rate_limit_max_consecutive: int = 3     # 最大连续 429 次数后减半并发

class IntelligentScheduler:
    """智能调度器（基于 ThreadPoolExecutor，与现有 AgentOrchestrator 一致）"""

    def __init__(self, config: SchedulerConfig, pool: SharedKnowledgePool):
        self.config = config
        self.pool = pool
        self.current_concurrency = config.initial_concurrency
        self.response_times: deque[float] = deque(maxlen=10)
        self._rate_limit_count = 0
        self._lock = threading.Lock()   # 保护 current_concurrency 的并发修改

    def schedule(self, modules: list[ModuleInfo]) -> list[ModuleBatch]:
        """生成调度计划（排序 + 分批）"""

    def adjust_concurrency(self, response_time_ms: float) -> None:
        """根据响应时间调整并发度（加锁保护）"""

    def on_rate_limit(self) -> float:
        """处理速率限制，返回等待时间（指数退避）"""

    def on_success(self, response_time_ms: float) -> None:
        """处理成功响应，重置 rate_limit_count"""
```

**调度策略**：

1. **优先级排序**：
   - 按 `complexity_score` 升序排序（小模块优先完成，快速释放 slot）
   - 复杂度计算：`complexity_score = estimated_tokens / 16000 + file_count / 50`

2. **批次合并**：
   - 相邻的小型模块（单模块 Token ≤ 8000）合并为单次 LLM `complete()` 调用
   - 合并后总 Token 上限 16000（GLM-4 标准上下文的安全区间）
   - 批次合并使用简化的 `complete()` 而非 Agent tool_call_loop，适合结构清晰的小模块

3. **自适应并发（基于 ThreadPoolExecutor）**：
   - 响应时间 < 3s（连续 3 次）：并发度 +1（不超过 max）
   - 响应时间 > 8s（连续 3 次）：并发度 -1（不低于 min）
   - 连续 3 次 429：并发度减半，指数退避等待（5s, 10s, 20s...）
   - `current_concurrency` 变化时动态调整 `ThreadPoolExecutor.max_workers`

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

**批次合并失败的降级策略**：

批次合并失败（JSON 解析错误、模块 key 缺失等）时，执行两步降级：

```
Level 1 降级：尝试解析合并响应中已存在的模块 key，跳过缺失/错误的模块
    ↓（Level 1 也失败，或缺失模块数 > 50%）
Level 2 降级：将失败的模块拆分回单独请求，逐个重新分析
    ↓（单个模块也失败）
Level 3 降级：记录 FailedModule，继续下一个模块（与现有 AIPipeline 行为一致）
```

实现要点：
- `ModuleBatch.parse_response()` 负责 Level 1 降级，返回 `{module_id: result | None}`
- `ParallelAnalysis.run_stage_3()` 检测 `None` 结果，触发 Level 2 降级（重新入队）
- Level 2 降级复用现有 `AgentOrchestrator` 逻辑，无需额外实现

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

现有 `StructureIndexer.build_index(repo_path: Path)` 内部自行遍历文件系统。为复用 Stage 0 已构建的 FileIndex，需为 `StructureIndexer` 新增一个接受文件列表的重载方法（不改变现有接口）：

```python
# 新增方法（不修改现有 build_index）
def build_index_from_files(self, repo_path: Path, file_paths: list[str]) -> None:
    """从已知文件列表构建索引，跳过目录遍历。

    与 build_index() 的区别：不再 rglob 整个目录，
    直接遍历 file_paths 中已过滤好的路径列表。
    """
    self._index.clear()
    for rel_path in file_paths:
        file_path = repo_path / rel_path
        suffix = file_path.suffix.lower()
        skeleton = None
        if suffix == ".java":
            skeleton = self._scan_java(file_path)
        elif suffix == ".py":
            skeleton = self._scan_python(file_path)
        else:
            skeleton = self._scan_generic(file_path)
        if skeleton is not None:
            skeleton.relative_path = rel_path
            self._index[rel_path] = skeleton
```

```python
def run_stage_1(pool: SharedKnowledgePool) -> None:
    # 直接使用 Stage 0 的文件列表，避免二次遍历
    pool.structure_indexer.build_index_from_files(
        pool.repo_path,
        list(pool.file_index.keys()),
    )
```

**输出**：`pool.structure_indexer`（原地构建，通过 SharedKnowledgePool 传递）

**耗时预估**：10-30s（1000 文件，取决于语言分布）

### Stage 2: ModuleBoundary

**输入**：`SharedKnowledgePool`（含 FileIndex + StructureIndexer）

**处理**：

`AgentContext` 是 `@dataclass`，不支持动态添加字段。为传递 `StructureIndexer`，需在 `AgentContext` 中新增可选字段（保持向后兼容）：

```python
# backend/agent/context.py 修改
@dataclass
class AgentContext:
    repo_path: str
    module_id: str
    shared_knowledge: SharedKnowledgeBase = field(default_factory=SharedKnowledgeBase)
    discoveries: DiscoveryRegistry = field(default_factory=DiscoveryRegistry)
    max_iterations: int = 20
    timeout_seconds: int = 300
    context_monitor: Optional["ContextMonitor"] = None
    structure_indexer: Optional["StructureIndexer"] = None   # 新增（可选）
```

```python
def run_stage_2(pool: SharedKnowledgePool, llm_client: LLMClient) -> ModulePlan:
    context = AgentContext(
        repo_path=str(pool.repo_path),
        module_id="scanner",
        shared_knowledge=SharedKnowledgeBase(),
        structure_indexer=pool.structure_indexer,   # 传入预构建索引
    )

    agent = ModuleScannerAgent(context=context, llm_client=llm_client)
    scan_result = ScanResult(
        repo_path=str(pool.repo_path),
        files=list(pool.file_index.values()),
    )

    return agent.scan(scan_result)
```

`ModuleScannerAgent` 内部检查 `context.structure_indexer`：若非 None，直接使用预构建索引（跳过内部的 `build_index()` 调用）。

**输出**：`ModulePlan`（模块列表 + 架构提示）

**耗时预估**：30-60s（1 次 LLM 调用）

### Stage 3: ParallelAnalysis

**输入**：`ModulePlan + SharedKnowledgePool`

**并行实现方式**：使用 `ThreadPoolExecutor`，与现有 `AgentOrchestrator` 保持一致，避免引入 asyncio 依赖。

**处理**：
```python
def run_stage_3(
    modules: list[ModuleInfo],
    pool: SharedKnowledgePool,
    llm_client: LLMClient,
    config: SchedulerConfig,
) -> list[ModuleResult]:
    scheduler = IntelligentScheduler(config, pool)

    # 生成调度计划（排序 + 分批）
    batches = scheduler.schedule(modules)

    results: list[ModuleResult] = []
    retry_queue: list[ModuleInfo] = []   # Level 2 降级队列

    # 并行执行所有批次
    with ThreadPoolExecutor(max_workers=scheduler.current_concurrency) as executor:
        future_to_batch = {
            executor.submit(_execute_batch, batch, pool, llm_client): batch
            for batch in batches
        }

        for future in as_completed(future_to_batch):
            batch = future_to_batch[future]
            start_time = time.time()
            try:
                batch_results = future.result()
                elapsed_ms = (time.time() - start_time) * 1000
                scheduler.on_success(elapsed_ms)

                # Level 1 降级：收集解析失败的模块进入重试队列
                for module_id, result in batch_results.items():
                    if result is None:
                        failed_module = batch.get_module(module_id)
                        if failed_module:
                            retry_queue.append(failed_module)
                    else:
                        results.append(result)

            except RateLimitExhaustedError:
                wait = scheduler.on_rate_limit()
                time.sleep(wait)
                # 重新提交该批次
                retry_queue.extend(batch.modules)

    # Level 2 降级：逐个重分析失败模块
    if retry_queue:
        for module in retry_queue:
            result = _run_agent_for_single_module(module, pool, llm_client)
            if result:
                results.append(result)

    return results
```

**注意**：`ThreadPoolExecutor.max_workers` 不支持运行时动态修改。自适应并发通过以下方式实现：当 `scheduler.current_concurrency` 发生变化时，在当前 Executor 耗尽后以新的 `max_workers` 重建 Executor（分批提交策略），不需要实时修改运行中的线程池。

**输出**：`list[ModuleResult]`

**耗时预估**：主要耗时阶段，1000 文件（~20 模块）× GLM 平均响应 15s / 并发 2 ≈ 2.5 分钟

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
│   ├── ai_analyze.py              # 重构后的入口（保持 AIPipeline 接口不变）
│   ├── optimized_pipeline.py      # 新的优化流水线（OptimizedPipeline）
│   ├── stages/
│   │   ├── __init__.py
│   │   ├── base.py                # Stage 基类（StageBase）
│   │   ├── file_index.py          # Stage 0: 文件索引
│   │   ├── structure_parse.py     # Stage 1: 结构解析
│   │   ├── module_boundary.py     # Stage 2: 模块边界
│   │   ├── parallel_analysis.py   # Stage 3: 并行分析
│   │   └── graph_merge.py         # Stage 4: 图谱合并
│   ├── stage_cache.py             # 阶段缓存管理
│   └── pipeline_scheduler.py      # 智能调度器（避免与 Celery scheduler/ 冲突）
│
├── cache/
│   ├── __init__.py
│   ├── shared_knowledge_pool.py   # 共享知识池
│   └── content_cache.py           # 文件内容 LRU 缓存（线程安全）
│
├── scheduler/                     # 【保持不变】Celery 相关（celery_app.py, tasks.py）
│
└── agent/
    ├── context.py                 # 新增 structure_indexer 可选字段
    ├── orchestrator.py            # 重构：接受 SharedKnowledgePool 参数
    └── structure_indexer.py       # 新增 build_index_from_files() 方法
```

**注意**：智能调度器放在 `backend/pipeline/pipeline_scheduler.py`，而非 `backend/scheduler/`，避免与现有 Celery scheduler 目录混淆。

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

### 功能正确性
- 优化后的图谱节点数、边数与原流程误差 ≤ 5%（允许 Agent 随机性）
- `AIPipeline.analyze()` 接口签名不变，返回类型 `AIAnalysisResult` 不变
- 断点续跑：中途停止后重新运行，Stage 0-2 的缓存命中，不重复 LLM 调用

### 性能基准测试方案

**测试仓库**：使用项目自身 `code-graph-system/` 作为基准（约 80 个 Python 文件），大型测试用 `code-graph-system/` + 外部仓库 [spring-petclinic](https://github.com/spring-projects/spring-petclinic)（约 50 个 Java 文件）模拟混合场景。

**测量指标**：
| 指标 | 测量方式 | 目标 |
|------|----------|------|
| 挂钟时间 | `time.time()` 首尾差值 | 降低 ≥ 50% |
| LLM 调用次数 | `ToolCallRecord` 计数 | 降低 ≥ 20%（批次合并效果） |
| Token 消耗 | `extract_token_usage()` 累计 | 降低 ≥ 20% |
| 文件读取次数 | 在 `get_content()` 中插桩计数 | 磁盘读取次数降低 ≥ 60% |

**基准测试脚本**：`backend/tests/benchmark_pipeline.py`
```python
# 运行方式
pytest backend/tests/benchmark_pipeline.py -v -s --benchmark
```

**对比基线**：优化前后各运行 3 次取中位数，使用相同的 `repo_path` 和 LLM 配置。

### 稳定性
- 模拟网络中断（mock 429 响应），确认退避重试正常
- 模拟 Stage 2 中途停止，重新运行后 Stage 0/1 缓存命中
- ContentCache 并发读写：10 线程同时访问同一文件，无数据竞争

### 回归测试
- 现有测试 `backend/tests/test_ai_pipeline.py` 全部通过（无修改）
- 现有测试 `backend/tests/test_ai_pipeline_e2e.py` 全部通过（需要 LLM API Key）
