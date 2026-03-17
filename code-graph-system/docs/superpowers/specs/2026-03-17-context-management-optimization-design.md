# 上下文管理优化设计

## 问题背景

### 现象
分析大型代码仓库时（如 2714 个文件的 Java 项目），Agent 的 `tool_call_loop` 出现上下文超限错误：
```
anthropic.BadRequestError: Error code: 400 - context window exceeds limit (2013)
```

### 根因
1. 每次工具调用（如 `read_file`）的返回结果被完整加入消息历史
2. Agent 在分析过程中多次读取文件，累积的内容导致上下文窗口超限
3. 当前代码检测到超限后直接失败，没有降级处理机制

### 影响
- 大型仓库分析失败
- 用户体验差，无法获得任何分析结果

---

## 设计目标

1. **稳定性**：确保大型仓库分析一定能完成
2. **分析质量**：在资源限制内最大化保留关键上下文
3. **可配置性**：用户可选择分析深度（快速/标准/深度）
4. **渐进式**：分阶段实现，每阶段独立可用

---

## 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      tool_call_loop                              │
├─────────────────────────────────────────────────────────────────┤
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                 ContextManager                           │   │
│   │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │   │
│   │  │  Monitor    │  │ SlidingWin  │  │   Summarizer    │  │   │
│   │  │  (监控)     │  │  (滑动窗口) │  │   (摘要压缩)    │  │   │
│   │  └─────────────┘  └─────────────┘  └─────────────────┘  │   │
│   └─────────────────────────────────────────────────────────┘   │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │              FileTools (工具输出限制)                     │   │
│   └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                   AgentOrchestrator                              │
├─────────────────────────────────────────────────────────────────┤
│   模块1 → Checkpoint → 重置 → 模块2 → Checkpoint → 重置 → ...   │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │              CheckpointManager                           │   │
│   └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Token 监控 + 工具输出限制 + 滑动窗口

### 1.1 ContextMonitor（上下文监控器）

**文件**: `backend/llm/context_monitor.py`

**职责**:
- 追踪每次 LLM 调用的 token 使用量
- 判断当前上下文状态（normal/warning/critical/exceeded）

**阈值配置**:
| 状态 | 阈值 | 说明 |
|------|------|------|
| normal | < 60% | 正常运行 |
| warning | 60% - 75% | 记录日志 |
| critical | 75% - 100% | 触发滑动窗口/摘要压缩 |
| exceeded | > 100% | 强制滑动窗口 |

**核心接口**:
```python
class ContextMonitor:
    def record_usage(self, input_tokens: int, output_tokens: int) -> ContextState
    def get_state(self) -> ContextState
    def should_apply_sliding_window(self) -> bool
```

### 1.2 ToolOutputLimiter（工具输出限制）

**文件**: `backend/agent/tools/file_tools.py`（修改）

**职责**: 从源头控制 token 增长

**配置**:
| 参数 | 默认值 | 说明 |
|------|--------|------|
| MAX_FILE_LINES | 500 | 单次读取最大行数 |
| MAX_SEARCH_RESULTS | 50 | 搜索结果最大数量 |
| MAX_LINE_LENGTH | 500 | 单行最大长度 |

**返回值扩展**:
- 新增 `truncated: bool` 字段，标记结果是否被截断
- 新增 `total_lines` / `total_count` 字段，返回原始总数

### 1.3 SlidingWindow（滑动窗口）

**文件**: `backend/llm/sliding_window.py`

**职责**: 当上下文接近超限时，截断早期历史

**策略**:
- 保留最初的 N 条消息（任务说明）
- 保留最近的 M 轮对话
- 中间部分添加摘要占位符

**配置**:
| 参数 | 默认值 | 说明 |
|------|--------|------|
| keep_recent | 10 | 保留最近的轮数 |
| keep_first | 2 | 保留最初的消息数 |

### 1.4 tool_call_loop 集成

**文件**: `backend/llm/client.py`（修改）

**修改点**:
1. 新增 `context_monitor: ContextMonitor` 参数
2. 从 API 响应提取 `usage.input_tokens` 和 `usage.output_tokens`
3. 每次迭代检查是否需要应用滑动窗口
4. 记录 token 使用日志

---

## Phase 2: 模块级检查点

### 2.1 ModuleCheckpoint（模块检查点）

**文件**: `backend/agent/checkpoint.py`

**数据结构**:
```python
@dataclass
class ModuleCheckpoint:
    module_id: str
    module_name: str
    nodes: list[dict]           # 已发现的节点
    edges: list[dict]           # 已发现的边
    knowledge: dict             # 共享知识快照
    status: str                 # completed | partial | failed
    created_at: str
    token_usage: dict           # token 使用统计
```

### 2.2 CheckpointManager（检查点管理器）

**职责**:
- 保存/加载检查点
- 合并所有检查点的结果
- 聚合共享知识

**存储**: `data/checkpoints/{repo_name}_{module_id}.json`

**核心接口**:
```python
class CheckpointManager:
    def save(self, checkpoint: ModuleCheckpoint) -> str
    def load(self, module_id: str) -> Optional[ModuleCheckpoint]
    def get_all_results(self) -> tuple[list[dict], list[dict]]
    def get_aggregated_knowledge(self) -> dict
```

### 2.3 AgentOrchestrator 集成

**文件**: `backend/agent/orchestrator.py`（修改）

**修改点**:
1. 新增 `enable_checkpoint` 和 `checkpoint_interval` 参数
2. 每个模块分析完成后保存检查点
3. 模块间重置 ContextMonitor
4. 新模块开始时注入聚合的共享知识

### 2.4 用户可配置分析深度

**文件**: `backend/agent/config.py`

**预设配置**:
| 预设 | 快速扫描 | 标准分析 | 深度分析 |
|------|----------|----------|----------|
| `max_modules` | 10 | 50 | 无限制 |
| `max_iterations_per_module` | 5 | 15 | 20 |
| `agents` | 基础 2 个 | 核心 4 个 | 全部 6 个 |
| `checkpoint_interval` | 5 | 3 | 1 |

**API 调用**:
```bash
POST /analyze/repository?depth=quick
POST /analyze/repository?depth=standard  # 默认
POST /analyze/repository?depth=deep
```

---

## Phase 3: 智能摘要压缩

### 3.1 HistorySummarizer（历史摘要压缩器）

**文件**: `backend/llm/summarizer.py`

**职责**: 使用 LLM 将早期工具调用历史压缩为简洁摘要

**触发条件**:
- 上下文使用率 > 85%
- 消息数 >= 6 条
- 有可压缩的历史（排除最近 2 轮）

**压缩策略**:
- 保留第一条消息（任务说明）
- 保留最近 2 轮对话
- 中间历史压缩为摘要

**摘要内容要求**:
1. 已分析的文件
2. 发现的类/方法
3. 识别的依赖关系
4. 待确认的问题

### 3.2 ContextManager（统一上下文管理器）

**文件**: `backend/llm/context_manager.py`

**职责**: 整合所有策略，根据状态自动选择

**策略选择逻辑**:
| 状态 | 策略 |
|------|------|
| normal | 无处理 |
| warning | 记录日志 |
| critical | 摘要压缩 → 滑动窗口（降级） |
| exceeded | 强制滑动窗口 |

### 3.3 配置化开关

**扩展配置**:
```python
ANALYSIS_PRESETS = {
    "quick": {
        "context_management": {
            "enable_summary": False,
            "sliding_window_threshold": 0.9,
        },
    },
    "standard": {
        "context_management": {
            "enable_summary": True,
            "sliding_window_threshold": 0.75,
        },
    },
    "deep": {
        "context_management": {
            "enable_summary": True,
            "sliding_window_threshold": 0.75,
            "summary_threshold": 0.85,
        },
    },
}
```

---

## 实现计划

### Phase 1（1-2 天）
- [ ] 创建 `context_monitor.py`
- [ ] 创建 `sliding_window.py`
- [ ] 修改 `file_tools.py` 添加输出限制
- [ ] 修改 `client.py` 集成监控和滑动窗口
- [ ] 单元测试

### Phase 2（2-3 天）
- [ ] 创建 `checkpoint.py`
- [ ] 修改 `orchestrator.py` 集成检查点
- [ ] 创建 `config.py` 分析预设
- [ ] 修改 API 支持深度参数
- [ ] 集成测试

### Phase 3（2-3 天）
- [ ] 创建 `summarizer.py`
- [ ] 创建 `context_manager.py` 整合组件
- [ ] 修改 `client.py` 集成完整上下文管理
- [ ] 性能测试和调优

---

## 风险和缓解

| 风险 | 缓解措施 |
|------|----------|
| 摘要压缩丢失关键信息 | 保留最重要的上下文，摘要包含关键发现 |
| 滑动窗口导致重复查询 | 共享知识库传递关键信息 |
| 检查点保存失败 | 内存 + 磁盘双写，失败时继续内存分析 |
| Token 估算不准确 | 使用 API 返回的实际值，阈值留有余量 |

---

## 验收标准

1. **Phase 1**:
   - 2714 文件的仓库分析不再崩溃
   - 日志显示 token 使用监控信息
   - 工具输出被正确限制

2. **Phase 2**:
   - 模块间上下文正确重置
   - 检查点文件正确生成
   - `depth=quick` 参数生效

3. **Phase 3**:
   - 摘要压缩正确触发
   - 压缩后分析可继续进行
   - 分析质量无明显下降
