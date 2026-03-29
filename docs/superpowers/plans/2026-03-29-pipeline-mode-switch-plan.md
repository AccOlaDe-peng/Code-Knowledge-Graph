# 流水线模式切换实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在前端分析对话框中增加流水线模式切换，让用户可以选择 `static_first` 或 `ai_first` 分析模式。

**Architecture:** 在 `AnalysisConfirmDialog` 组件中新增流水线模式选择区块，修改 API 调用传递 `pipeline_mode` 参数。后端已支持该参数，无需修改。

**Tech Stack:** React, TypeScript, Ant Design

---

## Task 1: 添加 PipelineMode 类型定义

**Files:**
- Modify: `code-graph-ui/src/types/api.ts`

- [ ] **Step 1: 添加 PipelineMode 类型**

在 `AnalysisDepth` 类型定义后添加：

```typescript
/** 分析深度预设 */
export type AnalysisDepth = "quick" | "standard" | "deep";

/** 流水线模式 */
export type PipelineMode = "static_first" | "ai_first";
```

---

## Task 2: 修改 API 调用支持 pipeline_mode 参数

**Files:**
- Modify: `code-graph-ui/src/core/api/endpoints/graph.ts`

- [ ] **Step 1: 导入 PipelineMode 类型**

在文件顶部的 import 中添加 `PipelineMode`：

```typescript
import type {
  GraphListResponse,
  GraphDetailResponse,
  CallGraphResponse,
  LineageGraphResponse,
  EventsGraphResponse,
  ServicesGraphResponse,
  AnalyzeAsyncResponse,
  AnalysisStatusResponse,
  AnalyzeCancelResponse,
  PipelineMode,  // 新增
} from "../../../types/api";
```

- [ ] **Step 2: 修改 analyzeRepository 函数签名**

修改 `analyzeRepository` 函数，添加 `pipeline_mode` 参数：

```typescript
  /**
   * POST /analyze/repository
   * Trigger async repository analysis
   */
  async analyzeRepository(data: {
    repo_path: string;
    repo_name?: string;
    repo_id?: string;
    branch?: string;
    languages?: string[];
    depth?: "quick" | "standard" | "deep";
    pipeline_mode?: PipelineMode;  // 新增
  }): Promise<AnalyzeAsyncResponse> {
    return apiClient.post("/analyze/repository", {
      ...data,
      pipeline_mode: data.pipeline_mode ?? "static_first",  // 默认 static_first
    });
  },
```

---

## Task 3: 修改分析对话框组件

**Files:**
- Modify: `code-graph-ui/src/pages/Repository/components/AnalysisConfirmDialog.tsx`

- [ ] **Step 1: 添加必要的 import**

在文件顶部添加：

```typescript
import {
  ThunderboltOutlined,
  ClockCircleOutlined,
  DashboardOutlined,
  PlayCircleOutlined,
  CodeOutlined,
  BranchesOutlined as GitBranchOutlined,
  ToolOutlined,      // 新增
  RobotOutlined,     // 新增
} from "@ant-design/icons";
import type { AnalysisDepth, RepoInfo, PipelineMode } from "../../../types/api";  // 修改
```

- [ ] **Step 2: 添加流水线模式配置常量**

在 `getDepthConfig` 函数后添加：

```typescript
const PIPELINE_MODE_OPTIONS: Array<{
  value: PipelineMode;
  label: string;
  icon: React.ReactNode;
  description: string;
  tag?: string;
}> = [
  {
    value: "static_first",
    label: "静态分析 + AI 增强",
    icon: <ToolOutlined />,
    description: "高效率，成本低",
    tag: "推荐",
  },
  {
    value: "ai_first",
    label: "纯 AI 分析",
    icon: <RobotOutlined />,
    description: "需要模型支持 function calling",
  },
];
```

- [ ] **Step 3: 修改 Props 接口**

修改 `AnalysisConfirmDialogProps` 接口：

```typescript
interface AnalysisConfirmDialogProps {
  repo: RepoInfo | null;
  depth: AnalysisDepth;
  pipelineMode: PipelineMode;                                        // 新增
  onDepthChange: (depth: AnalysisDepth) => void;
  onPipelineModeChange: (mode: PipelineMode) => void;                // 新增
  onStart: (repo: RepoInfo, depth: AnalysisDepth, pipelineMode: PipelineMode) => void;  // 修改
  onClose: () => void;
}
```

- [ ] **Step 4: 解构新的 props 并修改 handleStart**

```typescript
export const AnalysisConfirmDialog: React.FC<AnalysisConfirmDialogProps> = ({
  repo,
  depth,
  pipelineMode,        // 新增
  onDepthChange,
  onPipelineModeChange, // 新增
  onStart,
  onClose,
}) => {
  const handleStart = () => {
    if (repo) {
      onStart(repo, depth, pipelineMode);  // 修改：传递 pipelineMode
      onClose();
    }
  };
```

- [ ] **Step 5: 添加流水线模式选择 UI**

在分析深度选择区块（`</div>` 关闭标签）之后、Footer 之前添加：

```tsx
      {/* Pipeline Mode Selection */}
      <div style={{ padding: "16px 28px 20px", borderTop: "1px solid var(--b-faint)" }}>
        <div
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 12,
            fontWeight: 500,
            color: "var(--t-secondary)",
            marginBottom: 12,
          }}
        >
          选择分析模式
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          {PIPELINE_MODE_OPTIONS.map((opt) => {
            const isSelected = pipelineMode === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => onPipelineModeChange(opt.value)}
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "12px 14px",
                  background: isSelected
                    ? "rgba(0,212,255,0.08)"
                    : "var(--s-float)",
                  border: isSelected
                    ? "1px solid rgba(0,212,255,0.4)"
                    : "1px solid var(--b-faint)",
                  borderRadius: 8,
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "all 0.15s ease",
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: isSelected
                      ? "rgba(0,212,255,0.15)"
                      : "var(--s-overlay)",
                    borderRadius: 6,
                    color: isSelected ? "var(--t-cyan)" : "var(--t-muted)",
                  }}
                >
                  {opt.icon}
                </div>
                <div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-ui)",
                        fontSize: 13,
                        fontWeight: 500,
                        color: isSelected ? "var(--t-cyan)" : "var(--t-primary)",
                      }}
                    >
                      {opt.label}
                    </span>
                    {opt.tag && (
                      <span
                        style={{
                          fontSize: 10,
                          background: "rgba(0,240,132,0.15)",
                          color: "var(--t-green)",
                          padding: "1px 5px",
                          borderRadius: 3,
                        }}
                      >
                        {opt.tag}
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-ui)",
                      fontSize: 11,
                      color: "var(--t-muted)",
                      marginTop: 2,
                    }}
                  >
                    {opt.description}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
```

---

## Task 4: 修改父组件状态管理

**Files:**
- Modify: `code-graph-ui/src/pages/Repository/index.tsx`

- [ ] **Step 1: 导入 PipelineMode 类型**

```typescript
import type { AnalysisDepth, RepoInfo, PipelineMode } from "../../types/api";
```

- [ ] **Step 2: 添加 pipelineMode 状态**

在 `analysisDepth` 状态定义后添加：

```typescript
const [analysisDepth, setAnalysisDepth] = useState<AnalysisDepth>("standard");
const [pipelineMode, setPipelineMode] = useState<PipelineMode>("static_first");  // 新增
```

- [ ] **Step 3: 修改 startAnalysis 函数**

修改 `startAnalysis` 函数签名和 API 调用：

```typescript
const startAnalysis = useCallback(
  async (repo: RepoInfo, depth: AnalysisDepth = "standard", mode: PipelineMode = "static_first") => {
    if (!repo.repoPath) {
      message.error("缺少仓库路径，无法分析");
      return;
    }
    if (repo.status === "analyzing") {
      message.warning("该仓库正在分析中，请勿重复提交");
      return;
    }

    try {
      const response = await graphEndpoints.analyzeRepository({
        repo_path: repo.repoPath,
        repo_name: repo.repoName,
        repo_id: repo.repoId,
        branch: repo.branch,
        languages: repo.language.length > 0 ? repo.language : undefined,
        depth,
        pipeline_mode: mode,  // 新增
      });
      // ... 其余代码保持不变
```

- [ ] **Step 4: 修改 AnalysisConfirmDialog 组件调用**

找到 `AnalysisConfirmDialog` 组件的使用位置，添加新的 props：

```tsx
        <AnalysisConfirmDialog
          repo={analysisConfirmRepo}
          depth={analysisDepth}
          pipelineMode={pipelineMode}                    // 新增
          onDepthChange={setAnalysisDepth}
          onPipelineModeChange={setPipelineMode}         // 新增
          onStart={startAnalysis}
          onClose={() => setAnalysisConfirmRepo(null)}
        />
```

---

## Task 5: 验证后端 API 支持

**Files:**
- Verify: `backend/api/routers/analysis.py`

- [ ] **Step 1: 确认后端 API 接收 pipeline_mode 参数**

检查 `/analyze/repository` 端点是否接收并传递 `pipeline_mode` 参数。如果已支持则无需修改。

运行以下命令验证：
```bash
grep -n "pipeline_mode" backend/api/routers/analysis.py
```

预期结果：应能看到 `pipeline_mode` 参数被接收和传递。

---

## Task 6: 测试验证

- [ ] **Step 1: 运行前端开发服务器**

```bash
cd code-graph-ui
npm run dev
```

- [ ] **Step 2: 验证 UI 显示**

打开浏览器访问 http://localhost:5173，进入仓库页面，点击分析按钮，确认：
1. 分析对话框中显示"选择分析模式"区块
2. 默认选中"静态分析 + AI 增强"
3. 点击"纯 AI 分析"可切换

- [ ] **Step 3: 验证 API 调用**

在浏览器开发者工具 Network 面板中，确认 POST `/analyze/repository` 请求体包含 `pipeline_mode` 参数。

---

## 改动文件汇总

| 文件 | 改动类型 |
|------|---------|
| `code-graph-ui/src/types/api.ts` | 添加 `PipelineMode` 类型 |
| `code-graph-ui/src/core/api/endpoints/graph.ts` | API 增加 `pipeline_mode` 参数 |
| `code-graph-ui/src/pages/Repository/components/AnalysisConfirmDialog.tsx` | 新增流水线模式选择 UI |
| `code-graph-ui/src/pages/Repository/index.tsx` | 新增状态管理和传递 |
