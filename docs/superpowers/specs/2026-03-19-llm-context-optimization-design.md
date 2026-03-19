# LLM 上下文优化与结构预索引设计

**日期**：2026-03-19
**状态**：待实现
**优先级**：高
**背景**：基于 2026-03-18 生产日志分析，adms 仓库（2716 文件，96 模块）分析耗时 ~5 小时，仅产出 31 节点，存在严重的上下文溢出和 API 限速问题。

---

## 问题诊断

### 问题一：ContextMonitor 度量错误（根因）

`ContextMonitor.record_usage()` 将每次请求的 `input_tokens + output_tokens` 累加：

```
第 1 次：input=60K → 累计 60K（47%）
第 10 次：input=65K → 累计 650K（508%）← 虚高，API 不会拒绝
```

API 限制的是**单次请求的 input 大小**，不是累计值。导致：
- 日志显示 183%→1118% 的虚高数字，触发无效的滑动窗口操作
- 真正的 400 错误（单次请求确实超限）偶发，且无法被正确预防

### 问题二：滑动窗口无效

当前滑动窗口只删消息（14→12 条），不处理消息内容。被保留的「最近 5 轮」可能包含大量 `read_file` 结果（每次最多 500 行 × 500 字符 ≈ 80K tokens），删两条消息对实际 context 大小影响微乎其微。

### 问题三：Agent 探索效率低

Agent 通过大量 `list_directory` + `read_file` 探索模块结构，每个模块需要 20+ 次工具调用。96 个模块顺序执行 5 小时，最终因 429 Rate Limit 耗尽而失败，3 个模块完全跳过。

---

## 设计目标

| 目标 | 当前 | 目标值 |
|---|---|---|
| 单模块 API 调用次数 | 20+ 次 | 3-8 次 |
| 单次请求 context 使用率 | 常超 100% | 控制在 85% 以内 |
| 96 模块总分析时长 | ~5 小时 | ~45 分钟 |
| 产出节点数（adms） | 31 | 300-500（按深度） |
| 400/溢出错误 | 频繁 | 0 |

---

## 方案概述

**第一期（核心）**：
1. **Pre-flight Token Check** — 发送前主动估算并分级压缩，替代被动感知
2. **search_structure 工具** — 预计算结构索引，Agent 按需查询骨架

**第二期（后续）**：
3. 批量并发执行（5 模块/批）

---

## 设计详情

### 一、Pre-flight Token Check（主动分级压缩）

**核心原则**：在每次 API 调用**之前**估算 token 数，超出阈值先压缩再发送，从根本上杜绝超限请求。

#### 1.1 ContextMonitor 修复

修改 `backend/llm/context_monitor.py`：

**字段变更**：废弃 `_total_input` / `_total_output` 和旧阈值常量 `WARNING_THRESHOLD = 0.6` / `CRITICAL_THRESHOLD = 0.75`，改为追踪最近一次请求的值：

```python
class ContextMonitor:
    def __init__(self, max_tokens: int = 128000):
        self.max_tokens = max_tokens
        self._last_input_tokens: int = 0
        self._last_output_tokens: int = 0

    def _calc_status(self, usage_ratio: float) -> str:
        """共享状态计算逻辑，record_usage 和 get_state 均调用此方法。"""
        if usage_ratio >= 1.0:
            return "exceeded"
        elif usage_ratio >= 0.85:
            return "critical"
        elif usage_ratio >= 0.70:
            return "warning"
        return "normal"

    def record_usage(self, input_tokens: int, output_tokens: int) -> ContextState:
        self._last_input_tokens = input_tokens
        self._last_output_tokens = output_tokens
        usage_ratio = input_tokens / self.max_tokens if self.max_tokens > 0 else 0.0
        return ContextState(
            status=self._calc_status(usage_ratio),
            usage_ratio=usage_ratio,
            input_tokens=input_tokens,    # 语义：本次请求的 input tokens（非累计）
            output_tokens=output_tokens,
            max_context=self.max_tokens,
        )

    def get_state(self) -> ContextState:
        """基于最近一次记录的值重新计算状态，不触发额外副作用。"""
        usage_ratio = (
            self._last_input_tokens / self.max_tokens
            if self.max_tokens > 0 else 0.0
        )
        return ContextState(
            status=self._calc_status(usage_ratio),
            usage_ratio=usage_ratio,
            input_tokens=self._last_input_tokens,
            output_tokens=self._last_output_tokens,
            max_context=self.max_tokens,
        )

    def reset(self) -> None:
        self._last_input_tokens = 0
        self._last_output_tokens = 0
```

**旧 `should_apply_sliding_window()` 处理**：该方法**删除**。`tool_call_loop` 中原有的调用点替换为新的 pre-flight 分级压缩逻辑（见 1.3 节）。旧阈值常量 `WARNING_THRESHOLD`、`CRITICAL_THRESHOLD` 同步删除。

**`ContextState` 字段语义调整**（`backend/llm/types.py`）：
- `input_tokens`：注释改为"本次请求的 input tokens（非累计）"
- `output_tokens`：注释改为"本次请求的 output tokens（非累计）"
- `client.py` 中打印 `state.input_tokens` 的 debug log 同步更新为 `"本次请求 input tokens: {state.input_tokens}"`

#### 1.2 Token 估算（发送前）

在 `tool_call_loop` 发送前估算整体 context 大小，**包含 system prompt**：

```python
def _estimate_tokens(system: str, messages: list[dict]) -> int:
    """
    UTF-8 字节数 / 4，比 chars/3 更准确（适合中英混合代码）。
    包含 system prompt，避免遗漏导致阈值偏低。
    """
    total_bytes = len(system.encode("utf-8"))
    for msg in messages:
        content = msg.get("content", "")
        if isinstance(content, str):
            total_bytes += len(content.encode("utf-8"))
        elif isinstance(content, list):
            for block in content:
                if isinstance(block, dict):
                    total_bytes += len(str(block).encode("utf-8"))
    return total_bytes // 4
```

接近阈值（估算值 > 90% max_tokens）时，可调用 Anthropic `count_tokens` API 精确计数后再决策，避免误压缩。

#### 1.3 分级压缩策略

**职责划分**：
- `_estimate_tokens()` 独立函数，放在 `backend/llm/client.py`
- 分级判断逻辑放在 `tool_call_loop` 内（替换原有 `should_apply_sliding_window` 调用）
- `SlidingWindow` 新增 `level` 参数，支持 Level 1 / Level 2 / Level 3

```python
# tool_call_loop 中，每次发送前：
estimated = _estimate_tokens(system, current_messages)
ratio = estimated / self.context_window

if ratio >= 0.95:
    current_messages = _apply_compression(current_messages, level=3, provider=self.provider)
elif ratio >= 0.85:
    current_messages = _apply_compression(current_messages, level=2, provider=self.provider)
elif ratio >= 0.70:
    current_messages = _apply_compression(current_messages, level=1, provider=self.provider)
# else: 直接发送
```

```
Level 1（70-85%）：SlidingWindow 裁剪旧轮次消息（现有逻辑）
Level 2（85-95%）：Level 1 + 对保留轮次中超过 2K chars 的 tool result 替换占位符
Level 3（>95%）  ：仅保留 system prompt + 最近 1 轮完整消息，其余全部替换占位符
```

#### 1.4 Tool Result 占位符压缩（Level 2/3）

**Anthropic 消息格式兼容性保证**：

Anthropic 要求 `tool_use`（在 assistant 消息中）与 `tool_result`（在 user 消息中）必须成对存在，否则返回 400。

- **Level 2**：只替换 `tool_result` 的 `content` 字段，保留 `tool_use_id`，assistant 消息中的 `tool_use` block 不动。配对关系不受影响。
- **Level 3**：`SlidingWindow` 删除旧轮次时，**必须以「完整轮」为单位删除**，即一对相邻的 `{role: assistant}` + `{role: user}` 消息始终一起保留或一起删除。`SlidingWindow._count_rounds()` 已按 `assistant` 消息数计算轮数，`apply()` 已按 2 条/轮从末尾截取，此逻辑**不需要修改**。但需在 `SlidingWindow` 加断言验证：裁剪后首条消息不能是 `tool_result` 类型的 user 消息（否则说明配对被破坏），遇到此情况则多删一轮。

压缩函数实现：

```python
def _apply_compression(
    messages: list[dict],
    level: int,
    provider: str = "anthropic",
) -> list[dict]:
    if level == 1:
        sw = SlidingWindow(keep_recent_rounds=5, keep_first_messages=1)
        compressed, _ = sw.apply(messages, provider)
        return compressed

    if level == 2:
        # 先做 Level 1，再压缩保留轮次中的大 tool result（上限 2000 chars）
        compressed = _apply_compression(messages, level=1, provider=provider)
        return _compress_large_tool_results(compressed, max_chars=2000)

    if level == 3:
        # 仅保留首条 + 最近 1 轮（SlidingWindow 保证配对完整性）
        sw = SlidingWindow(keep_recent_rounds=1, keep_first_messages=1)
        compressed, _ = sw.apply(messages, provider)
        # 对保留轮的 tool result 也压缩（上限 500 chars）
        return _compress_large_tool_results(compressed, max_chars=500)

def _compress_large_tool_results(
    messages: list[dict], max_chars: int
) -> list[dict]:
    """替换超限 tool result content，保留 tool_use_id 确保配对完整"""
    result = []
    for msg in messages:
        if msg.get("role") != "user":
            result.append(msg)
            continue
        content = msg.get("content", [])
        if not isinstance(content, list):
            result.append(msg)
            continue
        new_content = []
        for block in content:
            if (
                isinstance(block, dict)
                and block.get("type") == "tool_result"
                and isinstance(block.get("content"), str)
                and len(block["content"]) > max_chars
            ):
                new_content.append({
                    **block,
                    "content": COMPRESSED_PLACEHOLDER,
                })
            else:
                new_content.append(block)
        result.append({**msg, "content": new_content})
    return result

COMPRESSED_PLACEHOLDER = (
    "[已压缩] 原始结果已移除以节省上下文。"
    "如需重新查看，请使用 search_structure() 获取结构信息，"
    "或使用指定行号的 read_file() 精准读取。"
)
```

---

### 二、StructureIndexer + search_structure 工具

**核心原则**：用零 LLM 调用的静态分析替代 Agent 的探索性工具调用。

#### 2.1 StructureIndexer

**新文件**：`backend/agent/structure_indexer.py`

```python
@dataclass
class MethodInfo:
    name: str
    signature: str        # 含参数类型和返回类型
    annotations: list[str]
    line_start: int
    visibility: str       # public / protected / private

@dataclass
class ClassInfo:
    name: str
    class_type: str       # class / interface / abstract / enum
    annotations: list[str]
    methods: list[MethodInfo]
    base_classes: list[str]  # extends / implements
    line_start: int

@dataclass
class FileSkeleton:
    relative_path: str
    language: str
    classes: list[ClassInfo]
    top_imports: list[str]   # 最多 10 个
    line_count: int

class StructureIndexer:
    def __init__(self, depth: str = "standard"):
        # depth 控制 build_index 时提取骨架的详细程度
        # quick: 仅类名+注解 / standard: +公共方法签名+行号 / deep: +全部方法+依赖
        self.depth = depth
        self._index: dict[str, FileSkeleton] = {}

    def build_index(self, repo_path: Path) -> None:
        """扫描整个仓库，将结果存入 self._index（无 LLM 调用）。"""

    def search(
        self,
        annotation: str = None,
        base_class: str = None,
        keyword: str = None,
        file_pattern: str = None,
        module_path: str = None,
        max_results: int = 30,         # 结果文件数上限
        max_output_tokens: int = 4096, # 输出 token 预算（chars = tokens × 4）
    ) -> dict:
        """查询 self._index，返回匹配骨架 + 精确行号。"""

    def _scan_java(self, file_path: Path) -> FileSkeleton | None:
        """优先使用 javalang 解析；失败时降级正则；再失败返回 None"""

    def _scan_python(self, file_path: Path) -> FileSkeleton | None:
        """使用标准库 ast 模块解析"""

    def _scan_generic(self, file_path: Path) -> FileSkeleton | None:
        """其他语言：仅提取注释行和行数"""
```

#### 2.2 Java 解析策略

**优先使用 `javalang`**（`pip install javalang`）进行 AST 解析，可以可靠处理泛型、多行注解、匿名内部类等复杂场景。

当 `javalang` 解析失败（文件存在语法错误、编码问题等）时，**降级为正则提取**，只提取类名、注解、行数，不尝试提取方法签名。

降级策略：

```
javalang AST  →（失败）→  正则（类级别）→（失败）→  仅文件名+行数
```

若 `javalang` 未安装，打印一次 WARNING，全程使用正则降级。

**Java 骨架输出示例**（standard 深度）：

```
[adms-api/UserController.java] 280行
@RestController @RequestMapping("/api/users")
class UserController extends BaseController
  deps: UserService, UserRepository
  + getUserById(Long id): ResponseEntity<UserDTO>  @GetMapping  L45
  + createUser(UserDTO dto): ResponseEntity        @PostMapping L67
  + deleteUser(Long id): void                      @DeleteMapping L89
```

#### 2.3 search_structure 输出 token 预算

查询结果可能匹配大量文件（例如 `keyword="Service"` 命中数百个类）。搜索方法按以下规则截断输出：

1. 按 `max_results`（默认 30）限制返回文件数
2. 单次返回的总字符数不超过 `max_output_tokens × 4`（约 16K chars）
3. 截断时在末尾添加说明：`"... 还有 N 个文件匹配，请用 file_pattern 或 module_path 缩小范围"`
4. 按重要性排序（优先返回有 @Controller/@Service 等核心注解的文件）

#### 2.4 按分析深度调整骨架详细度

| 深度 | 骨架内容 | 估算 tokens/模块 |
|---|---|---|
| quick | 类名 + 注解 | ~500 |
| standard | 类 + 公共方法签名 + 行号 | ~2K |
| deep | 类 + 全部方法 + 依赖 + 行号 | ~5K |

---

### 三、工具执行器架构改造

#### 3.1 问题

现有 `tool_call_loop` 的工具分发机制使用单一 `tool_executor` 对象：

```python
if tool_executor and hasattr(tool_executor, tool_name):
    result = getattr(tool_executor, tool_name)(**tool_input)
```

注入 `search_structure` 需要支持**每个工具有独立的 executor**。

#### 3.2 改造方案

在 `BaseAgent` 中引入 `_tool_executors` 映射，`tool_call_loop` 改为按工具名路由：

```python
# backend/agent/base.py
class BaseAgent:
    def __init__(self, ...):
        self._tools: list[dict] = []
        self._tool_executors: dict[str, Any] = {}  # 新增：工具名 → executor 对象

    def register_tool(
        self,
        name: str,
        description: str,
        input_schema: dict,
        executor: Any = None,      # 新增可选参数
    ) -> None:
        self._tools.append({...})
        if executor is not None:
            self._tool_executors[name] = executor
```

```python
# backend/llm/client.py  —  tool_call_loop 新增参数
# tool_executor_map: dict[str, Any] = None
#
# 工具分发逻辑（Anthropic 分支和 OpenAI 分支共用同一段 dispatch helper）：

def _dispatch_tool(
    tool_name: str,
    tool_input: dict,
    tool_executor_map: dict | None,
    tool_executor: Any | None,
) -> Any:
    """统一工具路由，Anthropic 和 OpenAI 分支都调用此函数，避免分支遗漏。"""
    executor_map = tool_executor_map or {}
    dedicated = executor_map.get(tool_name)
    if dedicated and hasattr(dedicated, tool_name):
        return getattr(dedicated, tool_name)(**tool_input)
    if tool_executor and hasattr(tool_executor, tool_name):
        return getattr(tool_executor, tool_name)(**tool_input)
    raise ValueError(f"No executor found for tool: {tool_name}")
```

将现有 Anthropic 分支和 OpenAI 分支中各自的工具执行代码统一替换为 `_dispatch_tool(...)` 调用，确保两条分支行为一致，且 `search_structure` 在所有 provider 下都能正确路由。

`ArchitectureAgent.run()` 在调用 `tool_call_loop` 时传入 `tool_executor_map=self._tool_executors`。

---

### 四、Orchestrator 集成

修改 `backend/agent/orchestrator.py`：

```python
def run_module_analysis(self, modules, repo_name=None):
    # [新增] 一次性构建整个仓库的结构索引（无 LLM 调用）
    # depth 从 preset 映射：quick/standard/deep 字符串传入 StructureIndexer
    indexer = StructureIndexer(depth=self.config.preset.value)  # "quick"/"standard"/"deep"
    indexer.build_index(self.repo_path)   # 结果存入 indexer._index，无返回值
    self._structure_indexer = indexer

    for module in modules:
        output = self._run_agent_for_module(module)
        ...

def _run_agent_for_module(self, module):
    agent = ArchitectureAgent(context=context, llm_client=self.llm_client)
    # [新增] 注册 search_structure 工具，executor 指向 indexer
    agent.register_tool(
        name="search_structure",
        description=(
            "查询代码结构索引，获取类/方法骨架和精确行号。"
            "支持按注解、父类、关键词、路径模式过滤。"
        ),
        input_schema={
            "type": "object",
            "properties": {
                "annotation":    {"type": "string", "description": "按注解过滤，如 @RestController"},
                "base_class":    {"type": "string", "description": "按父类或接口名过滤"},
                "keyword":       {"type": "string", "description": "按类名或方法名关键词"},
                "file_pattern":  {"type": "string", "description": "文件路径模式，如 */controller/*"},
                "module_path":   {"type": "string", "description": "限定目录范围"},
            },
        },
        executor=self._structure_indexer,
    )
    return agent.run()
```

**`file_tools.py` 不需要修改**：`search_structure` 方法直接定义在 `StructureIndexer` 类上，通过 executor 机制路由，无需在 `FileTools` 中代理。

---

## 数据流总览

```
orchestrator.run_module_analysis(modules)
    │
    ├─ [新增] StructureIndexer.build_index(repo_path)   # 零 LLM，一次性
    │           → {file_path: FileSkeleton} 索引
    │
    └─ for each module:
         │
         ├─ agent.register_tool("search_structure", executor=indexer)  [新增]
         │
         ├─ agent.run()
         │    └─ llm_client.tool_call_loop(tool_executor_map=...)
         │         │
         │         ├─ [新增] 发送前 _estimate_tokens(system, messages)
         │         ├─ [新增] 按 ratio 触发 Level 1/2/3 压缩
         │         ├─ 调用 LLM API
         │         ├─ [修复] context_monitor.record_usage(last_input_tokens)
         │         ├─ 按工具名路由执行工具 [改造]
         │         │    ├─ search_structure() → 骨架 + 行号  [新增]
         │         │    ├─ read_file(start, end) → 精准读取
         │         │    └─ search_code()
         │         └─ tool result 写入历史（超 2K chars 则立即截断）
         │
         ├─ 保存 checkpoint
         └─ reset context_monitor（清零峰值记录）
```

---

## 文件变更清单

| 文件 | 变更类型 | 核心改动 |
|---|---|---|
| `backend/llm/context_monitor.py` | 修改 | 改用 `last_input_tokens`，废弃累计值 |
| `backend/llm/types.py` | 修改 | `ContextState.input_tokens` 语义注释更新 |
| `backend/llm/client.py` | 修改 | 新增 `_estimate_tokens`、`_apply_compression`、`tool_executor_map` 参数 |
| `backend/llm/sliding_window.py` | 修改 | 支持 `keep_recent_rounds=1` 的 Level 3 模式 |
| `backend/agent/base.py` | 修改 | `register_tool` 新增 `executor` 参数，维护 `_tool_executors` 映射 |
| `backend/agent/structure_indexer.py` | **新增** | `StructureIndexer`、`FileSkeleton`、`ClassInfo`、`MethodInfo` |
| `backend/agent/orchestrator.py` | 修改 | 构建索引 + 注册 `search_structure` 工具 |
| `backend/agent/agents/architecture.py` | 修改 | `run()` 传入 `tool_executor_map` |

---

## 测试策略

### 单元测试

| 测试文件 | 测试内容 |
|---|---|
| `tests/test_context_monitor.py` | `last_input_tokens` 正确，`reset()` 清零，`usage_ratio` 基于单次值 |
| `tests/test_compression.py` | Level 1/2/3 分别触发，Level 2/3 的 `tool_use`/`tool_result` 配对完整性 |
| `tests/test_structure_indexer_java.py` | `javalang` 解析正确提取类、方法、注解、行号；降级正则能提取类名 |
| `tests/test_structure_indexer_python.py` | AST 提取 class/function/import 准确 |
| `tests/test_search_structure.py` | 按注解/基类/关键词查询准确；超出 `max_results` 时正确截断并附说明 |
| `tests/test_tool_executor_map.py` | `tool_executor_map` 优先于 `tool_executor`，向后兼容 |

### 集成测试

用小型 Java 项目（<50 文件）端到端验证：
- Agent 调用 `search_structure` 次数 ≥ 1，`read_file` 调用次数 < 10
- 单次请求 context 使用率始终 < 90%
- 不出现 400 上下文超限错误
- 产出节点数比修改前提升 5x 以上

---

## 第二期（后续优化）

批量并发执行：将 96 个模块分批（每批 5 个），批内并发，批间根据 429 情况动态调整间隔。预计总时长进一步从 45 分钟降至 10-15 分钟。
