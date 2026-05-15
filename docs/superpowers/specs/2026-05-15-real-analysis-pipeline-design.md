# Real Analysis Pipeline Design

## 背景

后端 `AnalysisService.simulateAnalysis()` 使用 `setTimeout` 模拟 5 阶段分析，不产生真实图谱数据。需要替换为真实流水线：判断本地路径 → git 准备 → 调用 graphify CLI → 导入结果到 GraphStore。

## 方案

**Service 层直接重构（方案 A）**：在现有 Service→Store 架构内新增 `GitService` 和 `GraphifyService`，重构 `AnalysisService` 编排三者。

## 架构

### 新增模块

| 模块 | 路径 | 职责 |
|------|------|------|
| `GitService` | `src/services/git.service.ts` | 判断路径类型、git clone/fetch/pull |
| `GraphifyService` | `src/services/graphify.service.ts` | 调用 graphify CLI、解析进度、返回结果路径 |

### 修改模块

| 模块 | 变更 |
|------|------|
| `AnalysisService` | 替换 `simulateAnalysis` → 真实流水线编排 |
| `app.ts` | 创建 GitService/GraphifyService 实例，注入 AnalysisService |
| `routes/analyze.ts` | 请求体增加 `branch` 字段，传递给 AnalysisService |
| `types/api.ts` | `AnalyzeRequest` 增加 `branch` 字段 |

## 详细设计

### 1. GitService

```typescript
class GitService {
  constructor(private repoCacheDir: string) {}  // DATA_DIR/repo-cache/

  async prepareLocalPath(repoPath: string, branch?: string): Promise<GitPrepareResult>
}

interface GitPrepareResult {
  localPath: string      // 最终本地代码路径
  gitCommit: string      // 当前 HEAD commit hash
  isClone: boolean       // 是否是新 clone 的
}
```

**逻辑：**

1. `fs.existsSync(repoPath)` 判断是否本地路径
2. **本地路径已存在：**
   - 如指定 branch → `git -C <path> checkout <branch>`
   - 获取当前 commit → `git -C <path> rev-parse HEAD`
   - 返回 `{ localPath: repoPath, gitCommit, isClone: false }`
3. **非本地路径（当作 Git URL）：**
   - 计算缓存路径：`repoCacheDir/<repoName>/`
   - 缓存已存在：`git fetch --all` + `git checkout <branch>` + `git pull`
   - 缓存不存在：`git clone [-b <branch>] <url> <cachePath>`
   - 返回 `{ localPath: cachePath, gitCommit, isClone: true }`
4. **Branch 不存在时**：尝试 main，再尝试 master，均失败则报错

**错误处理：**
- clone/checkout 失败 → 抛出 `GitError`（包含 stderr），调用方标记任务 `failed`

### 2. GraphifyService

```typescript
class GraphifyService {
  constructor(private defaultTimeout: number = 30 * 60 * 1000) {}

  async run(localPath: string, options: GraphifyOptions): Promise<GraphifyResult>
}

interface GraphifyOptions {
  mode: 'normal' | 'deep'    // 默认 'deep'
  update: boolean             // 是否增量
  directed: boolean           // 是否有向图
}

interface GraphifyResult {
  graphJsonPath: string       // graphify-out/graph.json
  reportPath: string          // graphify-out/GRAPH_REPORT.md
  htmlPath: string            // graphify-out/graph.html
  nodeCount: number
  edgeCount: number
}
```

**调用方式：**
```
spawn('graphify', [localPath, '--mode', 'deep', '--update', ...])
```

**进度映射（stdout 解析）：**
- graphify CLI 输出包含步骤标记，解析后映射到 SSE 阶段：
  - `detect` → `scanning`
  - `extract` → `static_analysis`
  - `semantic` → `semantic_analysis`
  - `build` → `graph_building`
  - `report` → `reporting`

**回调接口：** `onProgress?: (stage: string, step: number, total: number, message: string) => void`

**错误处理：**
- graphify 未安装 → 进程 spawn 失败，返回明确错误提示 `pip install graphifyy`
- 超时 → `process.kill()`，标记 `failed`
- 非零退出码 → 标记 `failed`，记录 stderr 最后 500 字符

### 3. 结果导入

新增函数 `importToGraphStore(result: GraphifyResult, repoId: string, graphStore: GraphStore): void`

**转换逻辑：**
1. 读取 `graphify-out/graph.json`
2. graphify node → GraphNode：
   - `id`: 保持原值
   - `label`: node.label
   - `type`: node.type（graphify 的 type 体系与后端 NodeTypes 部分重叠，不匹配的归入 `metadata.originalType`）
   - `file`: 从 node 属性中提取（如 `source_file`）
   - `confidence`: node.confidence
   - `metadata`: 保留 graphify 原始属性 + `{ community, cohesionScore, originalType }`
3. graphify edge → GraphEdge：
   - `id`: `${source}-${type}-${target}`（确保唯一）
   - `source`, `target`, `type`, `confidence`, `weight`
   - `metadata`: 保留原始属性
4. 逐个 `graphStore.addNode(repoId, node)` / `graphStore.addEdge(repoId, edge)`
5. `graphStore.save(repoId)` 持久化

### 4. AnalysisService 流水线编排

替换 `simulateAnalysis`，新增 `executePipeline` 私有方法：

```
submitAnalysis(repoId, repoName, repoPath, branch?)
  → 创建 AnalysisTask (status=pending)
  → 异步调用 executePipeline(taskId, repoPath, branch)

executePipeline(taskId, repoPath, branch):
  1. 更新 task status=running, SSE: stage=scanning
     GitService.prepareLocalPath(repoPath, branch)
     → 得到 localPath, gitCommit

  2. SSE: stage=static_analysis
     判断是否增量：GraphStore 有数据 + graphify-out/ 存在 → update=true
     GraphifyService.run(localPath, { mode:'deep', update, directed:false })
     onProgress 回调实时推送 SSE 进度
     → 得到 GraphifyResult

  3. SSE: stage=reporting
     importToGraphStore(result, repoId, graphStore)
     更新 RepoInfo: nodeCount, edgeCount, gitCommit, status=completed, lastAnalyzedAt
     更新 AnalysisTask: status=completed, graphId, nodeCount, edgeCount
     SSE: event=done
```

**并发控制：** 同一仓库不并发分析（检查该 repo 是否已有 running 状态的 task）。

**取消支持：** `cancelAnalysis` 时 kill graphify 子进程（通过 AbortController 传递 signal 到 spawn）。

### 5. API 变更

**`POST /analyze/repository`** 请求体：

```typescript
{
  repo_path: string     // 必填：本地路径或 Git URL
  repo_id?: string      // 可选
  repo_name?: string    // 可选
  branch?: string       // 新增：Git 分支
}
```

**`POST /repos`** 请求体不变。`repo_path` 存储在 RepoInfo 中，分析时使用。

### 6. 依赖注入变更（app.ts）

```typescript
const gitService = new GitService(join(DATA_DIR, 'repo-cache'))
const graphifyService = new GraphifyService()
const analysisService = new AnalysisService(analysisStore, gitService, graphifyService, graphStore)
```

AnalysisService 构造函数新增 `gitService`, `graphifyService`, `graphStore` 三个依赖。

## 不在范围内

- 前端 UI 变更（当前 API 兼容，前端无需改动）
- graphify HTML/报告的前端展示
- graphify `--watch` 模式
- graphify `--neo4j` 模式
- 多仓库并行分析队列
