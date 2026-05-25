# Graphify Skill + API Bridge 设计规格

## 背景

当前后端数据（architecture.json、function-call-graph.json、lineage.json）由用户通过 Claude Code 手动分析代码仓库后生成并放入 `data/graphs/`。需要自动化此流程：前端点击"开始分析"触发 Claude Code 分析，自动生成文件并放入指定位置。

## 整体架构

```
┌─────────────┐  点击"开始分析"  ┌──────────────────────┐
│  前端 UI     │ ──────────────→ │  POST /analyze/graphify │
│  Repository  │ ←── SSE 进度 ── │  (新建 API 端点)        │
└─────────────┘                  └──────────┬───────────┘
                                            │ spawn 子进程
                                            ▼
                                  ┌─────────────────────┐
                                  │  Claude Code CLI     │
                                  │  /graphify /path/to  │
                                  └──────────┬──────────┘
                                             │ skill 执行
                                             ▼
                                  ┌─────────────────────┐
                                  │  1. 读代码仓库        │
                                  │  2. 生成 3 个 JSON    │
                                  │  3. 写入 data/graphs/ │
                                  │  4. 更新 repo store   │
                                  └──────────┬──────────┘
                                             │ 完成
                                             ▼
                                  前端刷新，看到新数据
```

三个核心组件：
1. `/graphify` skill — Claude Code skill，分析代码并生成 JSON
2. `POST /analyze/graphify` API — 后端端点，spawn Claude Code CLI，SSE 推进度
3. 前端对接 — Repository 页面"开始分析"按钮调用新端点

## Skill 设计（`/graphify`）

### 触发方式

```
/graphify /path/to/repo                           # 分析指定仓库
/graphify /path/to/repo --name my-project         # 指定仓库名称
```

### 执行阶段

#### 阶段 1：仓库探测（零 LLM，快速）

Claude Code 直接读目录结构、`pom.xml`/`build.gradle`、`application.yml`，识别：
- 项目名、技术栈版本
- 模块划分（Maven multi-module / Gradle subproject）
- Spring 配置（profiles、数据源、消息队列）

产出：`{name}-architecture.json` 的基础框架（layers 骨架 + techStack）

#### 阶段 2：三路并行分析（3 个 Agent 子进程）

| Agent | 输入 | 产出 |
|-------|------|------|
| **架构分析** | 目录结构 + Controller/Service/Repository 层代码 | 补全 `{name}-architecture.json`（每层的 nodes、dataFlow、moduleDependencies） |
| **调用图分析** | Java 源码文件 | 生成 `{name}-function-call-graph.json`（modules + crossModuleCalls + functions + callChains） |
| **血缘分析** | Entity/Repository/Service 代码 + SQL/MQ 配置 | 生成 `{name}-lineage.json`（modules + dataLineage + dataRelations + keyDataFlows） |

三个 Agent 使用 `subagent_type="general-purpose"`，在同一消息中并行 dispatch。

#### 阶段 3：汇总写入

将 4 个 JSON 文件写入 `code-graph-system/data/graphs/`：
- `{name}.json` — 从三个子文件汇总的完整图谱（nodes + edges + meta）
- `{name}-architecture.json`
- `{name}-function-call-graph.json`
- `{name}-lineage.json`

更新 `data/graphs/index.json` 和 `data/repos/` 状态。

### JSON 格式约束

每个输出严格遵循现有前端消费的格式，与现有 `adms-architecture.json`、`adms-function-call-graph.json`、`adms-lineage.json` 一致。Skill 中嵌入 schema 示例作为 prompt 参考。

**architecture.json 结构：**
```json
{
  "name": "项目名",
  "fullName": "全称",
  "description": "描述",
  "version": "1.0.0",
  "techStack": { "framework": "...", "orm": "...", "database": "..." },
  "layers": [
    {
      "id": "presentation",
      "name": "表现层",
      "alias": "Presentation Layer",
      "description": "...",
      "source": "controller/",
      "technology": "Spring WebFlux",
      "nodes": [
        {
          "id": "xxx-controller",
          "name": "XxxController",
          "displayName": "xxx API",
          "source": "controller/xxx/",
          "description": "...",
          "functions": ["..."],
          "endpoints": ["/api/xxx"]
        }
      ]
    }
  ],
  "dataFlow": { ... },
  "moduleDependencies": { ... }
}
```

**function-call-graph.json 结构：**
```json
{
  "projectName": "项目名",
  "version": "1.0.0",
  "generatedAt": "ISO8601",
  "totalModules": 0,
  "totalFunctions": 0,
  "totalCallChains": 0,
  "excludedModules": [],
  "modules": [
    {
      "id": "module-id",
      "name": "模块名",
      "description": "...",
      "path": "src/main/...",
      "functions": [
        {
          "id": "func-id",
          "name": "methodName",
          "className": "ClassName",
          "signature": "ReturnType methodName(ParamType param)",
          "calls": ["other-func-id"],
          "calledBy": ["caller-func-id"],
          "type": "public|private|protected"
        }
      ]
    }
  ],
  "crossModuleCalls": [
    { "from": "module-a", "to": "module-b", "count": 5 }
  ]
}
```

**lineage.json 结构：**
```json
{
  "meta": { "projectName": "...", "version": "1.0.0", "generatedAt": "ISO8601" },
  "businessGlossary": [
    { "term": "术语", "definition": "定义", "domain": "领域" }
  ],
  "businessRules": [
    { "id": "rule-1", "name": "规则名", "description": "...", "enforcedBy": ["ClassName"] }
  ],
  "modules": [
    {
      "id": "module-id",
      "name": "模块名",
      "description": "...",
      "entities": ["entity-id"],
      "services": ["service-id"],
      "repositories": ["repo-id"]
    }
  ],
  "dataLineage": [
    {
      "id": "lineage-1",
      "source": { "entity": "EntityA", "module": "module-a" },
      "target": { "entity": "EntityB", "module": "module-b" },
      "type": "flow_to|reads|writes|produces|consumes",
      "description": "...",
      "fields": [
        { "fromEntity": "EntityA", "fromField": "field1", "toEntity": "EntityB", "toField": "field2" }
      ]
    }
  ],
  "dataRelations": [...],
  "keyDataFlows": [...],
  "moduleDependencies": [...],
  "flowEngine": { ... }
}
```

## API 桥接设计

### 新端点：`POST /analyze/graphify`

**请求/响应模型：**
```python
class GraphifyRequest(BaseModel):
    repo_path: str       # 本地仓库路径
    repo_name: str = ""  # 仓库名称
    repo_id: str = ""    # 前端 repo_store 中的 ID

class GraphifyResponse(BaseModel):
    task_id: str
    status: str = "pending"
```

**执行流程：**
1. 接收请求，生成 `task_id`，立即返回
2. spawn 子进程：`claude -p "/graphify {repo_path} --name {repo_name}" --output-format json`
3. 监听子进程 stdout，解析进度，通过 Redis Pub/Sub 推 SSE
4. 子进程完成后，验证 `data/graphs/` 下 4 个 JSON 文件存在
5. 更新 `repo_status_store` 状态为 completed

**SSE 进度复用现有通道：** `GET /analyze/stream/{task_id}`，与现有分析任务共用前端进度组件。

### 现有流水线保留策略

- 前端 Repository 页面的"开始分析"按钮增加 `mode` 参数：`graphify`（新）vs `pipeline`（旧）
- `mode=graphify` 走新端点，`mode=pipeline` 走旧端点
- 后续稳定后可移除旧流水线

### 前端改动

`Repository/index.tsx`：
- 分析确认弹窗增加模式选择（默认 graphify）
- 调用新 API：`POST /analyze/graphify`
- SSE 进度复用现有 `usePipelineStore`

## 文件清单

### 新增文件
- `~/.claude/skills/graphify/SKILL.md` — 替换现有 graphify skill
- `backend/api/routers/graphify.py` — 新 API 端点
- `backend/services/graphify_runner.py` — Claude Code CLI 子进程管理

### 修改文件
- `backend/api/server.py` — 注册新 router
- `code-graph-ui/src/pages/Repository/index.tsx` — 分析模式选择
- `code-graph-ui/src/api/graphApi.ts` 或 `core/api/endpoints/` — 新增 graphify API 调用

## 错误处理

- Claude Code CLI 不存在：返回 503，提示需要安装 Claude Code
- 子进程超时（默认 30 分钟）：终止进程，返回 failed 状态
- 部分文件生成失败：标记为 partial，前端提示哪些视图可用
- JSON 格式验证失败：记录警告，仍写入文件，前端容错展示
