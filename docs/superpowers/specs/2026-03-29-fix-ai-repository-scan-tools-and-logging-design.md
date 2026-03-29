# AI 仓库扫描工具执行修复与日志改进设计

## 问题背景

### 现象

用户使用 `ai_first` 流水线分析仓库时，日志显示：

```
[ai_repository_scan] 完成: 0 实体, 0 流程, 0 服务, 0 Repository, 0 Topic
[WARNING] 未识别到任何实体，跳过后续分析
[WARNING] 仓库不存在，无法更新进度: adms
```

分析耗时 278 秒但返回空结果。

### 根因分析

**问题 1（核心）**：`AIRepositoryScanStage` 调用 `tool_call_loop` 时未传入工具执行器。

```python
# ai_repository_scan.py 第 337-342 行
result = llm_client.tool_call_loop(
    system=SYSTEM_PROMPT,
    messages=messages,
    tools=tools,
    max_iterations=20,
    # ❌ 缺少 tool_executor 或 tool_executor_map
)
```

当 LLM 尝试调用 `list_directory`/`search_code`/`read_file` 时：
- `client.py` 中 `_dispatch_tool` 找不到执行器
- 代码第 598-599 行静默忽略：`except ValueError: pass`
- 工具返回空 `{}`，LLM 无法获取任何代码信息
- 最终输出空结果

**问题 2**：日志可见性不足，工具执行失败静默。

**问题 3**：错误信息传递不完整，前端只看到"未识别到任何实体"。

## 设计方案

### 1. 核心修复：注入工具执行器

**文件**：`backend/pipeline/stages/ai_repository_scan.py`

在 `_call_llm_with_tools` 方法中创建 `FileTools` 实例并传入 `tool_executor_map`：

```python
def _call_llm_with_tools(
    self,
    llm_client: LLMClient,
    repo_path: Path,
    user_prompt: str,
) -> str:
    from backend.agent.tools.file_tools import FileTools

    file_tools = FileTools(str(repo_path))

    tools = self._build_tools(repo_path)
    messages = [{"role": "user", "content": user_prompt}]

    for attempt in range(self.max_retries + 1):
        try:
            result = llm_client.tool_call_loop(
                system=SYSTEM_PROMPT,
                messages=messages,
                tools=tools,
                max_iterations=20,
                tool_executor_map={
                    "list_directory": file_tools,
                    "search_code": file_tools,
                    "read_file": file_tools,
                },
            )
            # ...
```

### 2. 日志改进：工具执行失败警告

**文件**：`backend/llm/client.py`

在 `_dispatch_tool` 函数中添加警告日志：

```python
def _dispatch_tool(
    tool_name: str,
    tool_input: dict,
    tool_executor_map: "dict | None",
    tool_executor: "Any | None",
) -> "Any":
    executor_map = tool_executor_map or {}
    dedicated = executor_map.get(tool_name)
    if dedicated is not None and hasattr(dedicated, tool_name):
        return getattr(dedicated, tool_name)(**tool_input)
    if tool_executor is not None and hasattr(tool_executor, tool_name):
        return getattr(tool_executor, tool_name)(**tool_input)

    # 新增：记录警告日志
    logger.warning(
        "工具执行器未找到: tool_name=%s, available_executors=%s",
        tool_name,
        list(executor_map.keys()) if executor_map else [],
    )
    raise ValueError(f"No executor found for tool: {tool_name}")
```

### 3. 日志改进：工具调用详情

**文件**：`backend/llm/client.py`

在 `tool_call_loop` 中记录每次工具调用的结果摘要：

```python
# 现有代码约 605-613 行，tool_calls.append(...) 后添加
logger.debug(
    "工具调用: tool=%s, input_keys=%s, success=%s, output_size=%d",
    tool_name,
    list(tool_input.keys()),
    success,
    len(json.dumps(tool_output, ensure_ascii=False)),
)
```

### 4. 日志改进：Stage 级别详细日志

**文件**：`backend/pipeline/stages/ai_repository_scan.py`

在 `_call_llm_with_tools` 中添加更多上下文日志：

```python
def _call_llm_with_tools(self, ...):
    logger.info(
        "[ai_repository_scan] 开始 LLM 调用: repo=%s, max_iterations=20",
        repo_path.name,
    )

    for attempt in range(self.max_retries + 1):
        try:
            result = llm_client.tool_call_loop(...)

            # 记录工具调用统计
            tool_stats = {}
            for tc in result.tool_calls:
                tool_stats[tc.tool_name] = tool_stats.get(tc.tool_name, 0) + 1

            logger.info(
                "[ai_repository_scan] LLM 调用完成: status=%s, iterations=%d, "
                "tool_calls=%s, total_tokens=%d",
                result.status,
                result.iterations,
                tool_stats,
                result.total_tokens,
            )

            if result.errors:
                logger.warning(
                    "[ai_repository_scan] LLM 调用有错误: %s",
                    result.errors,
                )
```

### 5. 错误传递：详细失败信息

**文件**：`backend/pipeline/ai_first_pipeline.py`

在返回失败结果时，包含更详细的错误原因：

```python
if not scan_result.entities:
    warning_msg = "未识别到任何实体"
    if scan_result.stats and scan_result.stats.get("elapsed_ms", 0) > 0:
        warning_msg += f"（分析耗时 {scan_result.stats['elapsed_ms'] // 1000}s）"

    logger.warning(
        "[ai_first_pipeline] 扫描结果为空: entities=%d, services=%d, flows=%d",
        len(scan_result.entities),
        len(scan_result.services),
        len(scan_result.flows),
    )

    if on_progress:
        on_progress({
            "step": "ai_repository_scan",
            "status": "failed",
            "message": "AI 仓库扫描未识别到任何实体，可能是代码结构不匹配或工具执行失败",
            "log": f"扫描统计: {scan_result.stats}",
        })

    return AIAnalysisResult(
        graph_id="",
        nodes=[],
        edges=[],
        status="failed",
        failed_modules=[],
        warnings=[warning_msg],
        duration_seconds=time.time() - start,
    )
```

### 6. 状态一致性：改进日志

**文件**：`backend/scheduler/tasks.py`

改进状态更新失败的日志：

```python
# 现有代码中 "仓库不存在，无法更新进度" 的位置
logger.warning(
    "仓库状态更新失败: repo_id=%s, 可能原因: 未先调用 set_analyzing 或已被清理",
    repo_id,
)
```

### 7. 测试验证

**文件**：新增 `backend/tests/test_ai_repository_scan_tools.py`

测试场景：
1. 验证工具执行器被正确注入
2. 验证工具执行失败时产生警告日志
3. 验证扫描结果为空时产生详细警告

## 改动文件汇总

| 文件 | 改动类型 | 改动内容 |
|------|---------|---------|
| `backend/pipeline/stages/ai_repository_scan.py` | 核心修复 | 注入 `FileTools` 到 `tool_executor_map` |
| `backend/llm/client.py` | 日志改进 | `_dispatch_tool` 添加警告日志 |
| `backend/llm/client.py` | 日志改进 | `tool_call_loop` 记录工具调用详情 |
| `backend/pipeline/ai_first_pipeline.py` | 错误传递 | 失败时发送详细错误信息 |
| `backend/scheduler/tasks.py` | 日志改进 | 状态更新失败时记录更详细信息 |
| `backend/tests/test_ai_repository_scan_tools.py` | 新增 | 测试工具执行器注入和日志 |

## 预期效果

修复后正常执行的日志：

```
[INFO] [ai_repository_scan] 开始 LLM 调用: repo=adms, max_iterations=20
[DEBUG] 工具调用: tool=list_directory, input_keys=['path'], success=True, output_size=1234
[DEBUG] 工具调用: tool=search_code, input_keys=['pattern'], success=True, output_size=567
[DEBUG] 工具调用: tool=read_file, input_keys=['path'], success=True, output_size=890
[INFO] [ai_repository_scan] LLM 调用完成: status=completed, iterations=5, tool_calls={'list_directory': 2, 'search_code': 3, 'read_file': 4}, total_tokens=8000
[INFO] [ai_repository_scan] 完成: 15 实体, 3 流程, 8 服务, 5 Repository, 2 Topic
```

如果工具执行器未注入（修复前的 bug），会看到：

```
[WARNING] 工具执行器未找到: tool_name=list_directory, available_executors=[]
```

## 风险评估

- **改动范围**：中等，涉及 5 个文件
- **向后兼容**：完全兼容，不改变接口签名
- **测试覆盖**：新增单元测试验证核心修复
