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

### 8. 模型兼容性检测（新增）

**问题**：某些 LLM 提供商（如腾讯云 GLM-5 代理）不支持 function calling，导致 `tool_call_loop` 无限循环后返回空结果。

**现象**：
- 返回文本而非工具调用
- 或返回 500 错误（`model engine error`）

**文件**：`backend/llm/client.py`

**检测 1：首次响应无工具调用**

```python
# Anthropic 分支：首次响应无工具调用时检测
if not valid_tool_uses:
    text_content = ""
    if response.content:
        for block in response.content:
            if hasattr(block, 'text'):
                text_content += block.text

    # 如果模型返回了文本但没有工具调用，可能是不支持 function calling
    if text_content and iterations == 1:
        logger.warning(
            "模型可能不支持 function calling: provider=%s, model=%s, "
            "响应包含文本而非工具调用。建议使用支持 function calling 的模型。",
            self.provider,
            self.model,
        )
        # 直接返回文本结果，不再循环
        return ToolCallLoopResult(
            status="no_tool_support",
            final_message=text_content,
            tool_calls=tool_calls,
            total_tokens=total_tokens,
            iterations=iterations,
            errors=["模型不支持 function calling，无法执行工具"],
        )
```

**检测 2：API 返回模型引擎错误（500）**

```python
# 检查是否是模型引擎错误（通常表示不支持 tools 参数）
# 腾讯云代理返回 500 + 'model engine error' 表示不支持 function calling
if "model engine error" in error_msg.lower() or (
    "500" in error_msg and "runtime_error" in error_msg
):
    errors.append(f"API 返回模型引擎错误，可能是模型不支持 function calling: {error_msg}")
    logger.error(
        "tool_call_loop 迭代 %d 出错（模型引擎错误）: %s。"
        "这通常表示当前模型/API 代理不支持 function calling。"
        "建议使用支持工具调用的模型，如 Claude、GPT-4 或智谱 GLM-4。",
        iterations,
        e,
    )
    return ToolCallLoopResult(
        status="no_tool_support",
        final_message=None,
        tool_calls=tool_calls,
        total_tokens=total_tokens,
        iterations=iterations,
        errors=errors,
    )
```

**文件**：`backend/pipeline/stages/ai_repository_scan.py`

处理 `no_tool_support` 状态：

```python
if result.status == "completed" and result.final_message:
    return result.final_message

if result.status == "no_tool_support":
    logger.error(
        "[ai_repository_scan] 模型不支持 function calling: %s, 请使用支持工具调用的模型",
        llm_client.model,
    )
    # 返回空结果，但包含明确的错误信息
    return '{"entities": [], "flows": [], "flow_nodes": [], "services": [], "repositories": [], "topics": []}'
```

### 9. 前端提示改进（新增）

**文件**：`backend/pipeline/ai_first_pipeline.py`

当检测到模型不支持 function calling 时，返回更友好的错误信息：

```python
if not scan_result.entities:
    # 检查是否是模型不支持工具调用的情况
    if scan_result.stats and scan_result.stats.get("tool_calls", 0) == 0:
        warning_msg = (
            "当前模型可能不支持工具调用（function calling），"
            "AI 仓库扫描需要此能力。请使用支持工具调用的模型，"
            "如 Claude、GPT-4 或智谱 GLM-4。"
        )
    else:
        warning_msg = "未识别到任何实体"
        if scan_result.stats and scan_result.stats.get("elapsed_ms", 0) > 0:
            warning_msg += f"（分析耗时 {scan_result.stats['elapsed_ms'] // 1000}s）"

    # ... 其余代码
```

## 改动文件汇总

| 文件 | 改动类型 | 改动内容 |
|------|---------|---------|
| `backend/pipeline/stages/ai_repository_scan.py` | 核心修复 | 注入 `FileTools` 到 `tool_executor_map` |
| `backend/llm/client.py` | 日志改进 | `_dispatch_tool` 添加警告日志 |
| `backend/llm/client.py` | 模型兼容性 | 检测模型是否支持 function calling |
| `backend/llm/client.py` | 日志改进 | `tool_call_loop` 记录工具调用详情 |
| `backend/pipeline/ai_first_pipeline.py` | 错误传递 | 失败时发送详细错误信息 |
| `backend/pipeline/ai_first_pipeline.py` | 前端提示 | 模型不支持时的友好提示 |
| `backend/scheduler/tasks.py` | 日志改进 | 状态更新失败时记录更详细信息 |
| `backend/tests/test_ai_repository_scan_tools.py` | 新增 | 测试工具执行器注入和日志 |

## 风险评估

- **改动范围**：中等，涉及 5 个文件
- **向后兼容**：完全兼容，不改变接口签名
- **测试覆盖**：新增单元测试验证核心修复

## 模型兼容性说明

`ai_first` 流水线需要 LLM 支持 **function calling**（工具调用）能力。

**支持的模型**：
- Anthropic Claude 系列（Claude 3.5+）
- OpenAI GPT-4 / GPT-3.5-turbo
- 智谱 GLM-4（需使用官方 API `https://open.bigmodel.cn/api/paas/v4/`）
- 其他兼容 OpenAI API 的模型

**不支持的模型**：
- 腾讯云 GLM-5 代理（当前配置）
- 纯文本生成模型

**解决方案**：
1. 使用 `static_first` 流水线（不依赖 function calling）
2. 切换到支持 function calling 的模型
3. 使用智谱官方 API 而非代理
