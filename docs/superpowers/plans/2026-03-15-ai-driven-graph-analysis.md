# AI 驱动的极简分析流水线实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将代码图谱系统从静态分析驱动完全转变为 AI 驱动，删除所有 AST 解析步骤，实现 6 步极简流水线。

**Architecture:** 三层分析模式（仓库扫描 → 模块级并行 AI 分析 → 跨模块整合），节点 ID 采用启发式稳定格式 `文件路径:名称`。

**Tech Stack:** Python 3.11+ / asyncio / Anthropic API / OpenAI API / MiniMax API / Ollama

---

## 文件结构

### 新建文件

| 文件 | 职责 |
|------|------|
| `backend/pipeline/ai_analyze.py` | AI 分析流水线主入口（6 步） |
| `backend/models/ai_analysis.py` | AI 分析相关数据模型（ModulePlan, AIAnalysisConfig 等） |
| `backend/agent/agents/module_scanner.py` | 模块扫描 Agent（AI 识别模块边界） |

### 改造文件

| 文件 | 改造内容 |
|------|----------|
| `backend/agent/orchestrator.py` | 改造为 `AICodeAnalyzer`，支持并行模块分析 |
| `backend/pipeline/analyze_repository.py` | 简化为调用 AI 流水线，删除 AST 相关导入 |

### 删除文件

| 文件 | 说明 |
|------|------|
| `backend/parser/code_parser.py` | Tree-sitter AST 解析 |
| `backend/analyzer/module_detector.py` | 静态模块检测 |
| `backend/analyzer/component_detector.py` | 静态组件检测 |
| `backend/analyzer/dependency_analyzer.py` | 静态依赖分析 |
| `backend/analyzer/call_graph_builder.py` | 静态调用图 |
| `backend/analyzer/event_analyzer.py` | 静态事件分析 |
| `backend/analyzer/infra_analyzer.py` | 静态基础设施分析 |
| `backend/pipeline/repo_summary_builder.py` | 静态摘要构建 |

---

## Chunk 1: 数据模型定义

### Task 1: AI 分析数据模型

**Files:**
- Create: `code-graph-system/backend/models/ai_analysis.py`
- Test: `code-graph-system/backend/tests/test_ai_analysis_models.py`

- [ ] **Step 1: Write the failing test for ModuleInfo, ModulePlan, AIAnalysisConfig, AIAnalysisResult**

- [ ] **Step 2: Run test to verify it fails**

Run: `cd code-graph-system && python -m pytest backend/tests/test_ai_analysis_models.py -v`
Expected: FAIL with "ModuleNotFoundError"

- [ ] **Step 3: Write minimal implementation for ai_analysis.py**

包含: ModuleInfo, ModulePlan, AIAnalysisConfig, AIAnalysisResult, FailedModule

- [ ] **Step 4: Run test to verify it passes**

Run: `cd code-graph-system && python -m pytest backend/tests/test_ai_analysis_models.py -v`
Expected: PASS

- [ ] **Step 5: Update models/__init__.py to export new models**

- [ ] **Step 6: Commit**

```bash
git add backend/models/ai_analysis.py backend/models/__init__.py backend/tests/test_ai_analysis_models.py
git commit -m "feat(models): add AI analysis data models"
```

---

## Chunk 2: 模块扫描 Agent

### Task 2: ModuleScannerAgent

**Files:**
- Create: `code-graph-system/backend/agent/agents/module_scanner.py`
- Modify: `code-graph-system/backend/agent/agents/__init__.py`
- Test: `code-graph-system/backend/tests/test_module_scanner_agent.py`

- [ ] **Step 1: Write the failing test for ModuleScannerAgent**

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Write minimal implementation**

ModuleScannerAgent 需要:
- scan(scan_result) -> ModulePlan
- _build_file_tree() 构建目录结构
- _build_prompt() 构建 LLM prompt
- _parse_response() 解析 JSON 响应

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Update agents/__init__.py**

- [ ] **Step 6: Commit**

---

## Chunk 3: AI 分析流水线入口

### Task 3: AIPipeline 主入口

**Files:**
- Create: `code-graph-system/backend/pipeline/ai_analyze.py`
- Test: `code-graph-system/backend/tests/test_ai_pipeline.py`

- [ ] **Step 1: Write the failing test**

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Write minimal implementation**

AIPipeline 需要:
- analyze(repo_path, repo_name, enable_rag) -> AIAnalysisResult
- 6 步流程: RepoScanner → AIModuleScanner → AICodeAnalyzer → GraphBuilder → GraphRepository → GraphRAGEngine

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

---

## Chunk 4: 删除静态分析器

### Task 4: 删除 AST 相关代码

**Files:**
- Delete: `backend/parser/code_parser.py`
- Delete: `backend/analyzer/module_detector.py`
- Delete: `backend/analyzer/component_detector.py`
- Delete: `backend/analyzer/dependency_analyzer.py`
- Delete: `backend/analyzer/call_graph_builder.py`
- Delete: `backend/analyzer/event_analyzer.py`
- Delete: `backend/analyzer/infra_analyzer.py`
- Delete: `backend/pipeline/repo_summary_builder.py`

- [ ] **Step 1: 删除静态分析器文件**

- [ ] **Step 2: 更新 analyzer/__init__.py**

- [ ] **Step 3: 更新 pipeline/__init__.py**

- [ ] **Step 4: 验证导入正常**

Run: `cd code-graph-system && python -c "from backend.pipeline import AIPipeline; print('OK')"`
Expected: OK

- [ ] **Step 5: Commit**

---

## Chunk 5: 集成测试

### Task 5: 端到端测试

**Files:**
- Test: `code-graph-system/backend/tests/test_ai_pipeline_e2e.py`

- [ ] **Step 1: 编写端到端测试**

测试用例:
- test_analyze_small_repo (需要真实 LLM)
- test_node_id_format
- test_empty_directory

- [ ] **Step 2: 运行测试**

Run: `cd code-graph-system && python -m pytest backend/tests/test_ai_pipeline_e2e.py -v`

- [ ] **Step 3: Commit**

---

## Chunk 6: 文档更新

### Task 6: 更新 CLAUDE.md

- [ ] **Step 1: 更新架构说明**

- [ ] **Step 2: 更新常用命令**

- [ ] **Step 3: Commit**

---

## 执行顺序总结

| Chunk | Task | 说明 | 依赖 |
|-------|------|------|------|
| 1 | Task 1 | 数据模型定义 | 无 |
| 2 | Task 2 | ModuleScannerAgent | Chunk 1 |
| 3 | Task 3 | AIPipeline 主入口 | Chunk 1, 2 |
| 4 | Task 4 | 删除静态分析器 | Chunk 3 |
| 5 | Task 5 | 端到端测试 | Chunk 4 |
| 6 | Task 6 | 文档更新 | Chunk 5 |

---

## 验收标准

1. `AIPipeline.analyze()` 能成功分析小型仓库
2. 节点 ID 格式为 `文件路径:名称`
3. 空仓库不崩溃，返回合理错误
4. 支持 Anthropic / OpenAI / MiniMax / Ollama
5. 所有静态分析器代码已删除
