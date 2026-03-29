# 流水线模式切换设计

## 需求背景

当前系统支持两种分析流水线：

1. **static_first**：静态分析优先 + AI 增强
   - 先进行 AST 静态分析，产出高置信度结构数据
   - 再用 AI 增强语义信息
   - 效率高、成本低

2. **ai_first**：纯 AI 分析
   - 完全由 AI 驱动分析代码结构
   - 需要模型支持 function calling
   - 支持字段级血缘

后端已支持通过 `pipeline_mode` 参数选择流水线，但前端 UI 缺少切换入口。

## 设计目标

在分析对话框中增加流水线模式选择，让用户可以根据需求选择分析方式。

## 架构设计

```
┌─────────────────────────────────────────────────────────┐
│  AnalysisConfirmDialog                                  │
│  ┌─────────────────────────────────────────────────────┐│
│  │ 分析深度选择（已有）                                 ││
│  │ - quick / standard / deep                           ││
│  └─────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────┐│
│  │ 流水线模式选择（新增）                               ││
│  │ - static_first: 静态分析 + AI 增强（默认）          ││
│  │ - ai_first: 纯 AI 分析                              ││
│  └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│  POST /analyze/repository                               │
│  - repo_path, repo_name, depth                          │
│  - pipeline_mode: "static_first" | "ai_first"           │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│  backend/scheduler/tasks.py                             │
│  根据 pipeline_mode 选择流水线：                         │
│  - static_first → StaticFirstPipeline                   │
│  - ai_first → AIFirstPipeline                           │
└─────────────────────────────────────────────────────────┘
```

## 改动文件

| 文件 | 改动类型 | 改动内容 |
|------|---------|---------|
| `code-graph-ui/src/types/api.ts` | 类型定义 | 新增 `PipelineMode` 类型 |
| `code-graph-ui/src/pages/Repository/components/AnalysisConfirmDialog.tsx` | UI 组件 | 新增流水线模式选择区块 |
| `code-graph-ui/src/pages/Repository/index.tsx` | 状态管理 | 新增 `pipelineMode` 状态，传递给 API |
| `code-graph-ui/src/core/api/endpoints/graph.ts` | API 调用 | `analyzeRepository` 增加 `pipeline_mode` 参数 |

**后端无需修改**：`tasks.py` 已有 `pipeline_mode` 参数处理逻辑。

## 详细设计

### 1. 类型定义

**文件**：`code-graph-ui/src/types/api.ts`

```typescript
// 新增流水线模式类型
export type PipelineMode = "static_first" | "ai_first";
```

### 2. API 调用

**文件**：`code-graph-ui/src/core/api/endpoints/graph.ts`

修改 `analyzeRepository` 函数，增加 `pipeline_mode` 参数：

```typescript
analyzeRepository: async (params: {
  repo_path: string;
  repo_name?: string;
  repo_id?: string;
  branch?: string;
  languages?: string[];
  depth?: AnalysisDepth;
  pipeline_mode?: PipelineMode;  // 新增
}): Promise<{ task_id: string; status: string }> => {
  const response = await apiClient.post("/analyze/repository", {
    repo_path: params.repo_path,
    repo_name: params.repo_name,
    repo_id: params.repo_id,
    branch: params.branch,
    languages: params.languages,
    depth: params.depth ?? "standard",
    pipeline_mode: params.pipeline_mode ?? "static_first",  // 新增，默认 static_first
  });
  return response.data;
};
```

### 3. 分析对话框组件

**文件**：`code-graph-ui/src/pages/Repository/components/AnalysisConfirmDialog.tsx`

#### 3.1 Props 扩展

```typescript
interface AnalysisConfirmDialogProps {
  repo: RepoInfo | null;
  depth: AnalysisDepth;
  pipelineMode: PipelineMode;           // 新增
  onDepthChange: (depth: AnalysisDepth) => void;
  onPipelineModeChange: (mode: PipelineMode) => void;  // 新增
  onStart: (repo: RepoInfo, depth: AnalysisDepth, pipelineMode: PipelineMode) => void;  // 修改
  onClose: () => void;
}
```

#### 3.2 流水线模式配置

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

#### 3.3 UI 结构

在分析深度选择之后、底部按钮之前，新增流水线模式选择区块：

```tsx
{/* Pipeline Mode Selection */}
<div style={{ padding: "20px 28px", borderTop: "1px solid var(--b-faint)" }}>
  <div style={{
    fontFamily: "var(--font-ui)",
    fontSize: 12,
    fontWeight: 500,
    color: "var(--t-secondary)",
    marginBottom: 12,
  }}>
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
            background: isSelected ? "rgba(0,212,255,0.08)" : "var(--s-float)",
            border: isSelected ? "1px solid rgba(0,212,255,0.4)" : "1px solid var(--b-faint)",
            borderRadius: 8,
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <div style={{
            width: 32,
            height: 32,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: isSelected ? "rgba(0,212,255,0.15)" : "var(--s-overlay)",
            borderRadius: 6,
            color: isSelected ? "var(--t-cyan)" : "var(--t-muted)",
          }}>
            {opt.icon}
          </div>
          <div>
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}>
              <span style={{
                fontFamily: "var(--font-ui)",
                fontSize: 13,
                fontWeight: 500,
                color: isSelected ? "var(--t-cyan)" : "var(--t-primary)",
              }}>
                {opt.label}
              </span>
              {opt.tag && (
                <span style={{
                  fontSize: 10,
                  background: "rgba(0,240,132,0.15)",
                  color: "var(--t-green)",
                  padding: "1px 5px",
                  borderRadius: 3,
                }}>
                  {opt.tag}
                </span>
              )}
            </div>
            <div style={{
              fontFamily: "var(--font-ui)",
              fontSize: 11,
              color: "var(--t-muted)",
              marginTop: 2,
            }}>
              {opt.description}
            </div>
          </div>
        </button>
      );
    })}
  </div>
</div>
```

### 4. 父组件状态管理

**文件**：`code-graph-ui/src/pages/Repository/index.tsx`

#### 4.1 新增状态

```typescript
const [pipelineMode, setPipelineMode] = useState<PipelineMode>("static_first");
```

#### 4.2 修改 startAnalysis 函数

```typescript
const startAnalysis = useCallback(
  async (repo: RepoInfo, depth: AnalysisDepth = "standard", pipelineMode: PipelineMode = "static_first") => {
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
        pipeline_mode: pipelineMode,  // 新增
      });
      // ... 其余代码不变
    }
    // ...
  },
  [updateRepo, stages.length],
);
```

### 5. 后端 API 验证

**文件**：`backend/api/routers/analysis.py`

确认 `/analyze/repository` 端点接收并传递 `pipeline_mode` 参数。如果已支持则无需修改。

## 默认值

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `depth` | `standard` | 标准分析深度 |
| `pipeline_mode` | `static_first` | 静态分析 + AI 增强 |

## 测试场景

1. 默认情况下，分析使用 `static_first` 模式
2. 用户切换到 `ai_first` 模式后，分析使用纯 AI 流水线
3. `ai_first` 模式在不支持 function calling 的模型下应有友好错误提示（已在之前修复）

## 风险评估

- **改动范围**：小，仅涉及前端 UI 和 API 调用
- **向后兼容**：完全兼容，默认值保持原有行为
- **后端依赖**：无需修改后端，`tasks.py` 已支持
