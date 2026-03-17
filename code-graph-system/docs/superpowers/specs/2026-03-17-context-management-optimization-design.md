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

## 数据结构定义

### ContextState（上下文状态）

```python
@dataclass
class ContextState:
    """上下文状态"""
    status: str              # "normal" | "warning" | "critical" | "exceeded"
    usage_ratio: float       # 当前使用率 (0.0 - 1.0)
    input_tokens: int        # 累计输入 token
    output_tokens: int       # 累计输出 token
    max_context: int         # 模型的最大上下文窗口
```

### TokenUsage（Token 使用记录）

```python
@dataclass
class TokenUsage:
    """单次请求的 token 使用记录"""
    request_input: int       # 本次请求输入 token
    request_output: int      # 本次请求输出 token
    cumulative_input: int    # 累计输入 token
    cumulative_output: int   # 累计输出 token
```

### ModuleCheckpoint（模块检查点）

```python
@dataclass
class ModuleCheckpoint:
    """模块分析检查点"""
    module_id: str
    module_name: str
    nodes: list[dict]           # 已发现的节点
    edges: list[dict]           # 已发现的边
    knowledge: dict             # 共享知识快照
    status: str                 # completed | partial | failed
    created_at: str
    token_usage: TokenUsage     # token 使用统计（结构化）
```

---

## Provider 差异化处理

### Token 字段映射

不同 LLM Provider 返回的 token 使用信息字段名称不同：

| Provider | 输入 Token 字段 | 输出 Token 字段 |
|----------|-----------------|-----------------|
| Anthropic | `response.usage.input_tokens` | `response.usage.output_tokens` |
| OpenAI | `response.usage.prompt_tokens` | `response.usage.completion_tokens` |
| MiniMax | `response.usage.prompt_tokens` | `response.usage.completion_tokens` |
| Ollama | 不支持（返回空或无） | 不支持 |

### 消息格式差异

**Anthropic 格式**:
```python
# Assistant 消息（包含 tool_use）
{"role": "assistant", "content": [
    {"type": "text", "text": "..."},
    {"type": "tool_use", "id": "...", "name": "read_file", "input": {...}}
]}

# User 消息（包含 tool_result）
{"role": "user", "content": [
    {"type": "tool_result", "tool_use_id": "...", "content": "..."}
]}
```

**OpenAI 格式**:
```python
# Assistant 消息
{"role": "assistant", "content": "...", "tool_calls": [
    {"id": "...", "type": "function", "function": {"name": "read_file", "arguments": "..."}}
]}

# Tool 消息
{"role": "tool", "tool_call_id": "...", "content": "..."}
```

### 统一提取函数

```python
def extract_token_usage(response, provider: str) -> tuple[int, int]:
    """从 API 响应中提取 token 使用量

    Returns:
        (input_tokens, output_tokens)
    """
    if not hasattr(response, 'usage') or response.usage is None:
        return 0, 0

    if provider == "anthropic":
        return response.usage.input_tokens, response.usage.output_tokens
    else:  # OpenAI 兼容接口
        return (
            getattr(response.usage, 'prompt_tokens', 0),
            getattr(response.usage, 'completion_tokens', 0),
        )
```

---

## 模型上下文窗口配置

### 默认窗口大小

| Provider | 模型 | 上下文窗口 |
|----------|------|-----------|
| Anthropic | claude-sonnet-4-6 | 200,000 |
| Anthropic | claude-opus-4-6 | 200,000 |
| OpenAI | gpt-4o | 128,000 |
| OpenAI | gpt-4-turbo | 128,000 |
| MiniMax | MiniMax-M2.5 | 128,000 |
| Ollama | llama3.2 | 32,000（默认）|

### 配置方式

```python
# 方式 1：自动检测（推荐）
CONTEXT_WINDOWS = {
    ("anthropic", "claude-sonnet-4-6"): 200000,
    ("anthropic", "claude-opus-4-6"): 200000,
    ("openai", "gpt-4o"): 128000,
    ("minimax", "MiniMax-M2.5"): 128000,
}

def get_context_window(provider: str, model: str) -> int:
    return CONTEXT_WINDOWS.get((provider, model), 128000)  # 默认 128K

# 方式 2：用户配置（优先级更高）
# 环境变量: LLM_CONTEXT_WINDOW=200000
# API 参数: context_window=200000
```

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

### 组件职责说明

| 组件 | 职责 | Phase |
|------|------|-------|
| **ContextMonitor** | 追踪 token 使用量，判断上下文状态 | Phase 1 |
| **SlidingWindow** | 截断早期消息历史 | Phase 1 |
| **ContextManager** | 整合 Monitor + SlidingWindow + Summarizer，统一入口 | Phase 3 |
| **HistorySummarizer** | LLM 压缩早期历史 | Phase 3 |
| **CheckpointManager** | 模块级检查点保存/恢复 | Phase 2 |

**组件关系**：
- Phase 1：`ContextMonitor` 和 `SlidingWindow` 独立使用
- Phase 3：`ContextManager` 聚合所有组件，提供统一接口

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
    def __init__(self, max_tokens: int = 128000):
        self.max_tokens = max_tokens
        self.total_input = 0
        self.total_output = 0

    def record_usage(self, input_tokens: int, output_tokens: int) -> ContextState:
        """记录本次请求的 token 使用（参数为单次请求值）"""
        self.total_input += input_tokens
        self.total_output += output_tokens
        return self.get_state()

    def get_state(self) -> ContextState:
        """获取当前上下文状态"""
        ratio = self.total_input / self.max_tokens
        # ... 返回 ContextState

    def should_apply_sliding_window(self) -> bool:
        """是否应该应用滑动窗口"""
        return self.get_state().status in ("critical", "exceeded")

    def reset(self):
        """重置累计值（用于模块间重置）"""
        self.total_input = 0
        self.total_output = 0
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

**"轮"的定义**:
- 1 轮 = 1 次 assistant 消息 + 1 次 user/tool 消息
- Anthropic: `{"role": "assistant"}` + `{"role": "user"}`
- OpenAI: `{"role": "assistant"}` + `{"role": "tool"}`

**配置**:
| 参数 | 默认值 | 说明 |
|------|--------|------|
| keep_recent_rounds | 5 | 保留最近的轮数 |
| keep_first_messages | 1 | 保留最初的消息数 |

**核心实现**:
```python
class SlidingWindow:
    def apply(self, messages: list[dict], provider: str) -> tuple[list[dict], bool]:
        """应用滑动窗口

        Returns:
            (裁剪后的消息列表, 是否进行了裁剪)
        """
        if len(messages) <= (self.keep_first_messages + self.keep_recent_rounds * 2):
            return messages, False

        first_part = messages[:self.keep_first_messages]
        recent_part = messages[-(self.keep_recent_rounds * 2):]

        # 占位符消息
        placeholder = {
            "role": "user",
            "content": f"[系统] 已裁剪 {len(messages) - len(first_part) - len(recent_part)} 条早期历史以节省上下文空间。",
        }

        return first_part + [placeholder] + recent_part, True
```

### 1.4 tool_call_loop 集成

**文件**: `backend/llm/client.py`（修改）

**修改点**:
1. 新增可选参数 `context_monitor: ContextMonitor = None`（向后兼容）
2. 从 API 响应提取 token 使用量（使用 `extract_token_usage` 函数）
3. 每次迭代检查是否需要应用滑动窗口
4. 记录 token 使用日志

**代码示例**:
```python
def tool_call_loop(
    self,
    system: str,
    messages: list[dict],
    tools: list[dict],
    max_iterations: int = 20,
    tool_executor: Any = None,
    context_monitor: ContextMonitor = None,  # 可选，向后兼容
) -> ToolCallLoopResult:
    # ...
    while iterations < max_iterations:
        # 检查滑动窗口
        if context_monitor and context_monitor.should_apply_sliding_window():
            current_messages, truncated = sliding_window.apply(current_messages, self.provider)
            if truncated:
                logger.warning(f"应用滑动窗口")

        # ... LLM 调用 ...

        # 记录 token 使用
        if context_monitor:
            input_tok, output_tok = extract_token_usage(response, self.provider)
            state = context_monitor.record_usage(input_tok, output_tok)
            logger.debug(f"Token 使用: {state.input_tokens} ({state.usage_ratio:.1%})")
```

---

## Phase 2: 模块级检查点

### 2.1 ModuleCheckpoint（模块检查点）

**文件**: `backend/agent/checkpoint.py`

### 2.2 CheckpointManager（检查点管理器）

**职责**:
- 保存/加载检查点
- 合并所有检查点的结果
- 聚合共享知识
- 列出待恢复的模块

**存储**: `data/checkpoints/{repo_name}_{module_id}.json`

**核心接口**:
```python
class CheckpointManager:
    def save(self, checkpoint: ModuleCheckpoint) -> str
    def load(self, module_id: str) -> Optional[ModuleCheckpoint]
    def get_all_results(self) -> tuple[list[dict], list[dict]]
    def get_aggregated_knowledge(self) -> dict

    # 新增：检查点恢复相关
    def list_completed_modules(self) -> list[str]
        """列出已完成的模块 ID"""

    def list_pending_modules(self, all_modules: list[str]) -> list[str]
        """列出待分析的模块 ID"""

    def clear(self):
        """清理所有检查点（分析完成后调用）"""
```

### 2.3 检查点恢复流程

```
分析开始
    ↓
检查是否存在检查点目录
    ↓ 存在
加载所有已完成的模块 ID
    ↓
与待分析模块列表对比
    ↓
跳过已完成模块，从断点继续
    ↓
分析完成 → 清理检查点
```

### 2.4 AgentOrchestrator 集成

**文件**: `backend/agent/orchestrator.py`（修改）

**修改点**:
1. 新增 `enable_checkpoint` 和 `checkpoint_interval` 参数
2. 每个模块分析完成后保存检查点
3. 模块间重置 ContextMonitor
4. 新模块开始时注入聚合的共享知识
5. 分析完成后清理检查点

### 2.5 用户可配置分析深度

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

**失败降级**:
```python
def compress(self, messages: list[dict]) -> CompressionResult:
    try:
        summary = self._generate_summary(history_text)
    except Exception as e:
        # 摘要生成失败，直接降级到滑动窗口
        logger.warning(f"摘要生成失败，降级到滑动窗口: {e}")
        return self._fallback_sliding_window(messages)

    # ...
```

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

**核心接口**:
```python
class ContextManager:
    def __init__(
        self,
        config: ContextConfig = None,
        llm_client: LLMClient = None,
    ):
        self.monitor = ContextMonitor(...)
        self.sliding_window = SlidingWindow(...)
        self.summarizer = HistorySummarizer(llm_client) if llm_client else None

    def record_usage(self, input_tokens: int, output_tokens: int) -> ContextState:
        return self.monitor.record_usage(input_tokens, output_tokens)

    def process_messages(self, messages: list[dict], provider: str) -> tuple[list[dict], str]:
        """根据上下文状态处理消息

        Returns:
            (处理后的消息列表, 采取的策略名称)
        """
        state = self.monitor.get_state()

        if state.status in ("critical", "exceeded"):
            if self.summarizer and state.status == "critical":
                # 尝试摘要压缩
                result = self.summarizer.compress(messages)
                if result.compression_ratio < 0.7:  # 有效压缩
                    return result.compressed_messages, "summary"

            # 降级到滑动窗口
            compressed, _ = self.sliding_window.apply(messages, provider)
            return compressed, "sliding_window"

        return messages, "none"
```

### 3.3 配置化开关

**扩展配置**（整合 Phase 2.4）:
```python
ANALYSIS_PRESETS = {
    "quick": {
        "max_modules": 10,
        "max_iterations_per_module": 5,
        "agents": ["module_detector", "architecture"],
        "context_management": {
            "enable_summary": False,
            "sliding_window_threshold": 0.9,
        },
    },
    "standard": {
        "max_modules": 50,
        "max_iterations_per_module": 15,
        "agents": ["module_detector", "architecture", "call_graph", "api_endpoint"],
        "context_management": {
            "enable_summary": True,
            "sliding_window_threshold": 0.75,
        },
    },
    "deep": {
        "max_modules": None,
        "max_iterations_per_module": 20,
        "agents": "all",
        "context_management": {
            "enable_summary": True,
            "sliding_window_threshold": 0.75,
            "summary_threshold": 0.85,
        },
    },
}
```

**配置优先级**（从高到低）:
1. API 参数: `POST /analyze/repository?depth=deep`
2. 环境变量: `ANALYSIS_DEPTH=deep`
3. 代码配置: `AnalysisConfig(preset="deep")`
4. 默认值: `standard`

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
| 摘要压缩 LLM 调用失败 | 失败时直接降级到滑动窗口，不重试 |
| 摘要压缩加剧 token 消耗 | 设置 `max_tokens=2000` 限制摘要长度 |

---

## 测试策略

### Phase 1 测试场景
1. **Token 监控准确性**
   - 模拟 API 响应，验证 token 累计计算
   - 验证不同 Provider 的字段提取

2. **滑动窗口触发**
   - 模拟 75% 阈值触发
   - 验证消息裁剪的正确性
   - 验证 Anthropic 和 OpenAI 格式分别处理

3. **工具输出限制**
   - 读取超过 500 行的文件，验证截断
   - 搜索返回超过 50 条结果，验证截断

### Phase 2 测试场景
1. **检查点保存/加载**
   - 模拟模块分析完成，验证检查点文件生成
   - 模拟中断恢复，验证从检查点继续

2. **模块间重置**
   - 验证 ContextMonitor 在模块间正确重置
   - 验证共享知识正确传递

### Phase 3 测试场景
1. **摘要压缩质量**
   - 构造长历史，验证摘要包含关键信息
   - 对比压缩前后的分析结果质量

2. **降级逻辑**
   - 模拟摘要 LLM 调用失败，验证滑动窗口降级
   - 验证降级后分析可继续

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