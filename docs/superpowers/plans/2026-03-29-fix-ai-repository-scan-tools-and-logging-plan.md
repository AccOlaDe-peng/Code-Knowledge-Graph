# AI 仓库扫描工具执行修复与日志改进实现计划

> 创建日期: 2026-03-29
> 设计文档: `docs/superpowers/specs/2026-03-29-fix-ai-repository-scan-tools-and-logging-design.md`
> 预计工期: 0.5 天

---

## 实现步骤

### Step 1: 核心修复 - 注入工具执行器

**文件:** `backend/pipeline/stages/ai_repository_scan.py`

**任务:**
- [ ] 1.1 在 `_call_llm_with_tools` 方法顶部导入 `FileTools`
- [ ] 1.2 创建 `FileTools` 实例，传入 `repo_path`
- [ ] 1.3 在 `tool_call_loop` 调用中添加 `tool_executor_map` 参数
- [ ] 1.4 验证工具名称映射正确 (`list_directory`, `search_code`, `read_file`)

**依赖:** 无

**关键改动位置:**
- 第 321-353 行 `_call_llm_with_tools` 方法

---

### Step 2: 日志改进 - 工具执行失败警告

**文件:** `backend/llm/client.py`

**任务:**
- [ ] 2.1 在 `_dispatch_tool` 函数中添加 `logger.warning` 调用
- [ ] 2.2 日志内容包含 `tool_name` 和 `available_executors`
- [ ] 2.3 确保警告在 `raise ValueError` 之前输出

**依赖:** 无

**关键改动位置:**
- 第 172-191 行 `_dispatch_tool` 函数

---

### Step 3: 日志改进 - 工具调用详情

**文件:** `backend/llm/client.py`

**任务:**
- [ ] 3.1 在 `tool_call_loop` 中，`tool_calls.append(...)` 后添加 `logger.debug`
- [ ] 3.2 日志内容包含 `tool_name`, `input_keys`, `success`, `output_size`

**依赖:** 无

**关键改动位置:**
- 第 605-614 行（Anthropic 分支）
- 第 724-733 行（OpenAI 分支）

---

### Step 4: 日志改进 - Stage 级别详细日志

**文件:** `backend/pipeline/stages/ai_repository_scan.py`

**任务:**
- [ ] 4.1 在 `_call_llm_with_tools` 开始处添加 `logger.info` 记录仓库信息
- [ ] 4.2 在 `tool_call_loop` 返回后，统计工具调用次数
- [ ] 4.3 添加 `logger.info` 记录调用完成信息（status, iterations, tool_calls, tokens）
- [ ] 4.4 如有错误，添加 `logger.warning` 记录

**依赖:** Step 1

**关键改动位置:**
- 第 335-353 行 `_call_llm_with_tools` 方法

---

### Step 5: 错误传递 - 详细失败信息

**文件:** `backend/pipeline/ai_first_pipeline.py`

**任务:**
- [ ] 5.1 在 `scan_result.entities` 为空时，构建详细警告信息
- [ ] 5.2 添加 `logger.warning` 记录扫描结果统计
- [ ] 5.3 通过 `on_progress` 发送详细错误事件
- [ ] 5.4 返回的 `AIAnalysisResult` 包含详细警告

**依赖:** 无

**关键改动位置:**
- 第 131-141 行 `analyze` 方法

---

### Step 6: 状态一致性 - 改进日志

**文件:** `backend/scheduler/tasks.py`

**任务:**
- [ ] 6.1 搜索 "仓库不存在，无法更新进度" 日志位置
- [ ] 6.2 改进日志格式，包含更多上下文信息

**依赖:** 无

---

### Step 7: 测试验证

**文件:** `backend/tests/test_ai_repository_scan_tools.py`（新增）

**任务:**
- [ ] 7.1 创建测试文件
- [ ] 7.2 测试 `test_tool_executor_injected`: 验证工具执行器被正确注入
- [ ] 7.3 测试 `test_tool_execution_logged`: 验证工具执行失败时产生警告日志
- [ ] 7.4 测试 `test_empty_result_detailed_warning`: 验证扫描结果为空时产生详细警告

**依赖:** Step 1-6

---

## 执行顺序

```
Step 1 ─────────────────────────────────────────────────────────┐
                                                                │
Step 2 ─────────────────────────────────────────────────────────┤
                                                                │
Step 3 ─────────────────────────────────────────────────────────┤
                                                                │
Step 4 ───(依赖 Step 1)─────────────────────────────────────────┤
                                                                │
Step 5 ─────────────────────────────────────────────────────────┤
                                                                │
Step 6 ─────────────────────────────────────────────────────────┤
                                                                │
Step 7 ───(依赖 Step 1-6)───────────────────────────────────────┘
```

Step 1-6 可并行执行，Step 4 依赖 Step 1，Step 7 依赖所有前置步骤。

---

## 验证清单

- [ ] 运行 `pytest backend/tests/test_ai_repository_scan_tools.py -v`
- [ ] 手动测试：分析一个小型仓库，检查日志输出
- [ ] 确认日志中显示工具调用详情
- [ ] 确认扫描结果非空（如果仓库有代码）

---

## 回滚方案

如果出现问题，可以：
1. 回退 `ai_repository_scan.py` 的改动，工具执行器注入不会影响其他模块
2. 日志改动是纯增量，不影响功能逻辑
