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

```python
def record_usage(self, input_tokens: int, output_tokens: int) -> ContextState:
    # 修复：用最近一次请求的 input_tokens（= 实际 context 大小）
    # 废弃：self._total_input += input_tokens（累计值与 API 限制无关）
    self._last_input_tokens = input_tokens
    usage_ratio = input_tokens / self.max_tokens
    ...
```

#### 1.2 Token 估算

在发送前对 `current_messages` 做快速估算：

```python
def _estimate_tokens(messages: list[dict]) -> int:
    """UTF-8 字节数 / 4，比 chars/3 更准确（适合中英混合代码）"""
    total = 0
    for msg in messages:
        content = msg.get("content", "")
        if isinstance(content, str):
            total += len(content.encode("utf-8"))
        elif isinstance(content, list):
            for block in content:
                if isinstance(block, dict):
                    total += len(str(block).encode("utf-8"))
    return total // 4
```

接近阈值（>90%）时可调用 Anthropic `count_tokens` API 精确计数，避免误压缩。

#### 1.3 分级压缩策略

在 `client.py` 的 `tool_call_loop` 中，每次发送前执行：

```
估算 current_messages token 数
         ↓
    < 70% → 直接发送
    70-85% → Level 1：滑动窗口裁剪旧轮次消息（现有逻辑）
    85-95% → Level 2：对保留轮次中超过 2K chars 的 tool result
                       替换为压缩占位符
    > 95%  → Level 3：仅保留 system prompt + 最近 1 轮，
                       其余全部压缩
```

#### 1.4 Tool Result 压缩占位符

Level 2/3 压缩不做语言解析，统一替换为：

```python
COMPRESSED_PLACEHOLDER = (
    "[已压缩] 原始 tool result 已被移除以节省上下文。"
    "如需重新查看，请使用 search_structure() 获取结构信息，"
    "或使用指定行号的 read_file() 精准读取。"
)
```

这样 Agent 知道可以通过工具重新获取所需信息，无需复杂的内容解析。

---

### 二、StructureIndexer + search_structure 工具

**核心原则**：用零 LLM 调用的静态分析替代 Agent 的探索性工具调用。

#### 2.1 StructureIndexer

**新文件**：`backend/agent/structure_indexer.py`

```python
@dataclass
class ClassInfo:
    name: str
    class_type: str          # class / interface / abstract / enum
    annotations: list[str]   # @Service, @RestController 等
    methods: list[MethodInfo]
    base_classes: list[str]  # extends / implements
    line_start: int

@dataclass
class MethodInfo:
    name: str
    signature: str           # 含参数类型和返回类型
    annotations: list[str]
    line_start: int
    visibility: str          # public / protected / private

@dataclass
class FileSkeleton:
    relative_path: str
    language: str
    classes: list[ClassInfo]
    top_imports: list[str]   # 最多 10 个
    line_count: int

class StructureIndexer:
    def build_index(self, repo_path: Path) -> dict[str, FileSkeleton]:
        """扫描整个仓库，构建文件骨架索引（无 LLM 调用）"""

    def _scan_java(self, file_path: Path) -> FileSkeleton:
        """Java：正则提取 class/interface/method/annotation/import"""

    def _scan_python(self, file_path: Path) -> FileSkeleton:
        """Python：AST 提取 class/function/import"""

    def _scan_generic(self, file_path: Path) -> FileSkeleton:
        """其他语言：仅提取注释行和行数"""
```

#### 2.2 Java 骨架提取示例

输入：300 行 Java Controller
输出（~200 字符）：

```
[adms-api/UserController.java] 280行
@RestController @RequestMapping("/api/users")
class UserController extends BaseController
  deps: UserService, UserRepository
  + getUserById(Long id): ResponseEntity<UserDTO>      @GetMapping("/id")  L45
  + createUser(@RequestBody UserDTO dto): ResponseEntity @PostMapping      L67
  + deleteUser(Long id): void                          @DeleteMapping      L89
```

#### 2.3 search_structure 工具

注册为 Agent 可调用的工具，查询预构建索引：

```python
def search_structure(
    self,
    annotation: str = None,      # 按注解过滤：@RestController
    base_class: str = None,      # 按父类/接口过滤：UserService
    keyword: str = None,         # 按类名/方法名关键词
    file_pattern: str = None,    # 按文件路径模式：*/controller/*
    module_path: str = None,     # 限定在某目录下
) -> dict:
    """
    返回匹配文件的骨架，包含精确行号。
    Agent 拿到行号后可用 read_file(start, end) 精准读取。
    """
```

**典型 Agent 工作流变化**：

```
# 修改前：探索式（20+ 次工具调用）
list_directory("src/") → list_directory("api/") → read_file("UserController.java") → ...

# 修改后：精准式（3-5 次工具调用）
search_structure(annotation="@RestController")  → 获取所有 Controller 骨架+行号
search_structure(base_class="UserService")      → 获取实现类位置
read_file("UserController.java", start=45, end=90)  → 精准读取目标方法
```

#### 2.4 按分析深度调整骨架详细度

| 深度 | 骨架内容 | 估算 tokens/模块 |
|---|---|---|
| quick | 类名 + 注解 | ~500 |
| standard | 类 + 公共方法签名 | ~2K |
| deep | 类 + 全部方法 + 依赖 + 行号 | ~5K |

---

### 三、Orchestrator 集成

修改 `backend/agent/orchestrator.py`：

```python
def run_module_analysis(self, modules, repo_name=None):
    # [新增] 一次性构建整个仓库的结构索引（无 LLM 调用）
    indexer = StructureIndexer()
    self._structure_index = indexer.build_index(self.repo_path)

    for module in modules:
        # [新增] 为 agent 注册 search_structure 工具
        # indexer 持有索引引用，search 方法按模块路径过滤
        output = self._run_agent_for_module(module, indexer=indexer)
        ...

def _run_agent_for_module(self, module, indexer=None):
    agent = ArchitectureAgent(context=context, llm_client=self.llm_client)
    if indexer:
        agent.register_tool(
            name="search_structure",
            description="查询代码结构索引，获取类/方法骨架和精确行号",
            input_schema={...},
            executor=indexer,
        )
    return agent.run()
```

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
         ├─ agent.register_tool("search_structure", indexer.search)  [新增]
         │
         ├─ agent.run()
         │    └─ llm_client.tool_call_loop()
         │         │
         │         ├─ [新增] 发送前 token 估算
         │         ├─ [新增] 按级别压缩（Level 1/2/3）
         │         ├─ 调用 LLM API
         │         ├─ [修复] context_monitor.record_usage(last_input_tokens)
         │         ├─ 执行工具
         │         │    ├─ search_structure() → 骨架 + 行号  [新增]
         │         │    ├─ read_file(start, end) → 精准读取  [优化]
         │         │    └─ search_code()                      [不变]
         │         └─ [新增] tool result 写入历史前 token 预算截断
         │
         ├─ 保存 checkpoint
         └─ reset context_monitor
```

---

## 文件变更清单

| 文件 | 变更类型 | 核心改动 |
|---|---|---|
| `backend/llm/context_monitor.py` | 修改 | 改用 `last_input_tokens` 替代累计值 |
| `backend/llm/client.py` | 修改 | 发送前 token 估算 + 分级压缩 + tool result 截断 |
| `backend/llm/sliding_window.py` | 修改 | 新增 Level 2/3 占位符压缩逻辑 |
| `backend/agent/structure_indexer.py` | **新增** | StructureIndexer + Java/Python 提取器 |
| `backend/agent/orchestrator.py` | 修改 | 构建索引 + 注册 search_structure 工具 |
| `backend/agent/agents/architecture.py` | 修改 | 接受并注册 search_structure 工具 |
| `backend/agent/tools/file_tools.py` | 修改 | 新增 search_structure 方法 |

---

## 测试策略

### 单元测试

| 测试文件 | 测试内容 |
|---|---|
| `tests/test_context_monitor.py` | 验证使用 last_input_tokens，usage_ratio 准确 |
| `tests/test_sliding_window.py` | Level 1/2/3 分别触发，占位符内容正确 |
| `tests/test_structure_indexer.py` | Java/Python 骨架提取准确性，行号正确 |
| `tests/test_search_structure.py` | 按注解/基类/关键词查询返回预期结果 |

### 集成测试

用小型 Java 项目（<50 文件）端到端验证：
- Agent 调用 `search_structure` 次数 ≥ 1，`read_file` 调用次数 < 10
- 单次请求 context 使用率始终 < 90%
- 产出节点数比修改前提升 5x 以上

---

## 第二期（后续优化）

批量并发执行：将 96 个模块分批（每批 5 个），批内并发，批间根据 429 情况动态调整间隔。预计总时长进一步从 45 分钟降至 10-15 分钟。
