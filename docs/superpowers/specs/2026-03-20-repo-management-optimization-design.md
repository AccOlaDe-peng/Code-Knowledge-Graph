# 仓库管理系统全面优化设计

**日期：** 2026-03-20
**状态：** 待实施
**方案：** 契约驱动优化（根治根因，而非逐个打补丁）

---

## 背景与问题

通过对现有代码的全面分析，发现以下根因性问题：

| 症状 | 根因 |
|------|------|
| 进度条永远不显示当前 Stage | 前后端 Stage key 各自维护，没有共同契约 |
| 仓库 ID 双轨制混乱 | Repo 配置和 Graph 输出被当作同一个实体 |
| 大仓库分析频繁 429 | 184 个模块各自独立 retry，无全局并发上限 |
| 并发写入状态文件可能竞态 | RepoStatusStore 用单个 JSON 文件，无锁 |
| server.py 1440 行难以维护 | 路由、依赖注入、请求模型全混在一起 |
| Repository/index.tsx 1187 行 | 表单、列表、进度面板、业务逻辑全在一文件 |
| 无法编辑已保存仓库配置 | AddRepoModal 仅支持新增模式 |
| 无法查看分析历史 | 无 Analysis 历史记录表，Celery 状态会过期 |

---

## 优化范围与优先级

| 优先级 | 内容 | 核心收益 |
|--------|------|----------|
| P0 | 数据模型：Repo + Analysis SQLite | ID 混乱根治，并发安全，分析历史 |
| P0 | Pipeline Stage 契约 API | 进度条永远正确，流水线变化自动同步 |
| P0.5 | LLM 并发信号量 | 消除 429 叠加，大仓库分析稳定 |
| P1 | server.py 拆分为 routers | 代码可维护，职责清晰 |
| P1 | Stage 日志 key 一致化 | 排查问题直观，与 SSE 事件对应 |
| P2 | 前端 RepoInfo 类型拆分 | 组件重构不卡壳，类型安全 |
| P2 | Repository 页组件化 | 可维护，支持编辑 + 分析历史展示 |
| P2 | API 过渡策略（/graph 向后兼容） | 重构期间其他页面不崩 |

---

## 第一节：数据模型重设计

### 设计原则

三个不同生命周期的实体必须分开存储：

- **Repo**（仓库配置）：用户创建，永久存在，与分析无关
- **Analysis**（分析历史）：每次触发分析产生一条，终态时持久化
- **Graph**（图谱数据）：分析产出，由现有 `GraphRepository` 管理

### SQLite Schema

```sql
-- Repo 表：仓库配置
CREATE TABLE repo (
    id          TEXT PRIMARY KEY,     -- 前端生成，如 repo-{timestamp}-{random}
    name        TEXT NOT NULL,
    path        TEXT NOT NULL,        -- 本地路径 / Git URL / ZIP 文件名
    branch      TEXT,
    source_mode TEXT NOT NULL DEFAULT 'local',  -- local | git | zip
    language    TEXT NOT NULL DEFAULT '[]',     -- JSON array
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

-- Analysis 表：分析历史（仅在终态时写入）
CREATE TABLE analysis (
    id              TEXT PRIMARY KEY,  -- = Celery task_id
    repo_id         TEXT NOT NULL REFERENCES repo(id),
    depth           TEXT NOT NULL DEFAULT 'standard',  -- quick | standard | deep
    status          TEXT NOT NULL,     -- completed | failed | canceled
    graph_id        TEXT,              -- 完成时关联 GraphRepository 里的图谱
    node_count      INTEGER DEFAULT 0,
    edge_count      INTEGER DEFAULT 0,
    error           TEXT,
    started_at      TEXT NOT NULL,
    finished_at     TEXT
);

CREATE INDEX idx_analysis_repo_id ON analysis(repo_id);
CREATE INDEX idx_analysis_started_at ON analysis(started_at DESC);
```

### 实时分析状态（不进数据库）

分析进行中的 `status / stage_key / step / message` 继续走 Celery + Redis Pub/Sub，这是它们最擅长的场景。Analysis 表只在任务结束时写入一条终态记录。

### Graph 元数据扩展

`GraphRepository` 现有 JSON 文件的 `meta` 字段加入 `repo_id` 和 `analysis_id`：

```json
{
  "graph_id": "graph-xxx",
  "repo_id": "repo-xxx",
  "analysis_id": "celery-task-id",
  "node_count": 22445,
  "edge_count": 19613,
  "git_commit": "abc123",
  "created_at": "2026-03-20T14:44:28Z"
}
```

### ZIP 上传的 Repo 归属

ZIP 来源的 `path` 字段存原始文件名（如 `adms.zip`），`source_mode = zip`，不要求 path 可重新访问，仅作为展示用。重新分析时提示用户重新上传文件。

### 迁移策略

启动时 `database.py` 检查 `data/repos/status.json` 是否存在：

1. `status=completed` → 转为 Repo + Analysis 终态记录写入 SQLite
2. `status=saved` → 仅创建 Repo 记录，无 Analysis 记录（用户保存了仓库但从未分析）
3. `status=analyzing` → 服务重启时残留的僵死任务，创建 Repo 记录 + 写入 Analysis 记录（`status=failed`，`error="服务重启，任务中断"`）
4. `status=failed` / `status=canceled` → 创建 Repo 记录 + 写入对应终态 Analysis 记录
5. 已有图谱 JSON 但无对应 status.json 记录的（历史 CLI 分析）→ 自动创建 Repo 记录（`source_mode=local`），无 Analysis 记录
6. 迁移完成后将 `status.json` 重命名为 `status.json.migrated`

### 并发分析与孤儿记录处理

同一仓库在进行中时用户发起第二次分析：
- 后端在提交新任务前检查是否有 `status=analyzing` 的进行中任务
- 若有，将旧 task_id 对应的 Analysis 记录写入终态（`status=failed`，`error="被新任务取代"`，`finished_at=now`）
- 然后创建新任务，返回新 `task_id`

### 新增 API 端点

```
GET    /repos                    → 列出所有仓库（Repo 列表，含 latestAnalysis 摘要）
POST   /repos                    → 创建仓库配置（替代 /repos/save）
                                   若请求体未提供 repo_id，后端生成；后端校验 path 唯一性
PUT    /repos/{repo_id}          → 编辑仓库配置（新增，支持修改 name/branch/language）
DELETE /repos/{repo_id}          → 删除仓库：级联删除 Repo 记录 + 所有 Analysis 记录
                                   + 每个 graph_id 对应的 Graph JSON 文件 + ChromaDB 集合
GET    /repos/{repo_id}/analyses → 获取该仓库的分析历史（含当前进行中任务）
```

**`GET /repos/{repo_id}/analyses` 的"进行中任务"处理：**
- 查询 Analysis 表返回历史终态记录
- 同时检查 `repo_id` 关联的当前 `task_id`（来自 Celery/Redis）
- 若有进行中任务，拼接一条 `status=analyzing` 的虚拟记录放在列表首位
- 前端可据此在历史列表顶部展示当前任务进度，与其他历史记录一起呈现

---

## 第二节：Pipeline Stage 契约 API

### 问题

前端 `PIPELINE_STAGES` 定义的 key（`scanner`、`module_scanner`、`code_analyzer`…）与后端 `StaticFirstPipeline` 实际发出的 stage key（`file_index`、`deep_static_analysis`、`ai_semantic_enhance`…）完全不一致，导致进度条永远找不到当前阶段。

### 解决方案

后端暴露 Stage 定义接口，前端动态获取，不再写死。

**新增端点：**

```
GET /api/pipeline/stages
```

**响应示例（与 `StaticFirstPipeline` 实际发出的 `step` key 严格对齐）：**

```json
{
  "stages": [
    { "key": "file_index",           "label": "扫描文件",        "description": "扫描代码仓库文件，Git 增量检测" },
    { "key": "deep_static_analysis", "label": "静态分析",        "description": "AST 解析 + 框架模式识别" },
    { "key": "parallel_stage",       "label": "模块聚类 + DI解析","description": "目录聚类与 Spring DI/Event 静态解析（并行，零 LLM）" },
    { "key": "ai_semantic_enhance",  "label": "AI 语义增强",     "description": "AI 增强模块描述与边界验证" },
    { "key": "spring_di_event_ai",   "label": "AI 歧义解析",     "description": "AI 解析 DI/Event 歧义（无歧义时跳过）" },
    { "key": "repository",           "label": "持久化存储",      "description": "保存图谱到存储" }
  ],
  "total": 6
}
```

**后端实现：** Stage 定义集中维护在 `backend/pipeline/stage_registry.py`，`StaticFirstPipeline` 发出 SSE 事件时直接使用 registry 里的 key，确保一致。

**前端消费：** `useRepoList` hook 初始化时调用一次，结果存入 Zustand store（`pipelineStore`），`AnalysisProgressPanel` 从 store 读取，不再写死 `PIPELINE_STAGES` 数组。未来流水线加减 Stage，前端自动适配。

---

## 第三节：LLM 并发信号量

### 问题

日志显示 184 个模块并发调 LLM 时频繁出现 429 Too Many Requests 和 500 错误（如 `边界调用失败 (attempt 0): Error code: 429`），每个模块独立重试互不协调，高峰期叠加触发限流。

### 解决方案

`AISemanticEnhanceStage` 已使用 `ThreadPoolExecutor` 实现同步并发（`LLMClient.complete()` 是同步阻塞调用），**不引入 asyncio**，在现有架构上最小改动：

```python
# backend/pipeline/stages/ai_semantic_enhance.py

# 当前：MAX_POOL_SIZE = 8（已定义），但构造函数默认 max_concurrency=3
# 修改：默认值改为 8，并支持环境变量覆盖

import os

class AISemanticEnhanceStage:
    def __init__(
        self,
        max_concurrency: int = int(os.getenv("LLM_MAX_CONCURRENCY", "8")),
    ):
        self.max_concurrency = max_concurrency
```

这是一行默认值修改，`ThreadPoolExecutor(max_workers=self.max_concurrency)` 的结构不变。环境变量 `LLM_MAX_CONCURRENCY` 可按实际 API 限额调整。

---

## 第四节：后端代码组织

### 4a. server.py 拆分

```
backend/api/
├── server.py           # app 初始化 + lifespan，~80 行
├── deps.py             # 依赖注入（get_graph_repo, get_rag_engine…）
└── routers/
    ├── repos.py        # /repos/* — 仓库配置 CRUD + /api/pipeline/stages
    ├── analysis.py     # /analyze/* — 提交任务、SSE 流、状态查询、取消
    ├── graphs.py       # /graph/*, /callgraph, /lineage, /events, /services
    └── query.py        # /query — GraphRAG 自然语言查询
```

每个 router 文件预计 150~250 行，职责单一。`server.py` 仅负责 `app = FastAPI(...)` + `lifespan` + `include_router`。

### 4b. Store 层重建

```
backend/store/
├── database.py         # SQLite 连接、建表 DDL、迁移逻辑
├── repo_store.py       # Repo 表 CRUD（get/list/create/update/delete）
└── analysis_store.py   # Analysis 表（write_completed, list_by_repo）
```

`get_repo_status_store()` 全局单例保留，内部切换为 SQLite 实现，对 Celery 任务代码透明。

### 4c. Stage 日志一致性

统一使用 stage key 替代数字编号：

```python
# 改前（混乱）
logger.info("Stage 1 完成: %d 文件", len(files))
logger.info("Stage 1 完成: %d 节点", len(nodes))  # 两个 Stage 1！

# 改后（清晰）
logger.info("[file_index] 完成: %d 文件, 增量=%s", len(files), is_incremental)
logger.info("[deep_static_analysis] 完成: %d 节点, %d 边", len(nodes), len(edges))
logger.info("[directory_cluster] 完成: %d 个模块候选", len(candidates))
logger.info("[ai_semantic_enhance] 完成: %d/%d 模块", success, total)
```

日志里的 stage key 与 SSE 事件里的 `stage` 字段完全一致，排查问题时直接对应。

---

## 第五节：前端重构

### 5a. RepoInfo 类型拆分

当前 `RepoInfo` 混合三种实体字段，先拆类型再重构组件，避免级联报错：

```typescript
// src/types/api.ts

// 仓库配置（对应后端 Repo 表）
interface Repo {
  repoId:     string;
  repoName:   string;
  repoPath:   string;
  branch?:    string;
  sourceMode: "local" | "git" | "zip";
  language:   string[];
  createdAt:  string;
  updatedAt:  string;
}

// 分析任务状态（含 Celery completed_partial）
type AnalysisStatus =
  | "saved"
  | "pending"
  | "analyzing"
  | "completed"
  | "completed_partial"  // 部分模块成功，图谱仍有输出
  | "failed"
  | "canceled";

// 最近一次分析摘要（展示用，从 Analysis 表 + 实时状态合并）
interface LatestAnalysis {
  taskId?:          string;
  status:           AnalysisStatus;
  graphId?:         string;
  nodeCount:        number;
  edgeCount:        number;
  depth?:           AnalysisDepth;
  analysisStage?:   string;
  analysisStep?:    number;
  analysisTotal?:   number;
  analysisMessage?: string;
  lastAnalyzedAt?:  string;
  error?:           string;
}

// 页面展示用（组合）
type RepoInfo = Repo & { latestAnalysis?: LatestAnalysis };
```

`repoStore.ts` 同步更新，`Repo` 和 `LatestAnalysis` 分开存储和更新。

### 5b. Repository 页组件拆分

```
src/pages/Repository/
├── index.tsx                      # 页面组装 + 顶层状态，~120 行
├── components/
│   ├── RepoCard.tsx               # 单个仓库卡片（状态徽章 + 操作按钮）
│   ├── AddRepoModal.tsx           # 新增/编辑仓库表单（prop: repo? 区分模式）
│   ├── AnalysisConfirmDialog.tsx  # 深度选择 + 确认对话框
│   ├── AnalysisProgressPanel.tsx  # 进度时间轴（从 stage store 读取定义）
│   └── RepoDetailDrawer.tsx       # 详情抽屉（统计 + 分析历史列表）
├── hooks/
│   ├── useRepoList.ts             # 拉取同步仓库列表，管理缓存（用 useRef）
│   └── useAnalysisProgress.ts    # SSE 事件流 → repoStore 状态更新
└── constants.ts                   # LANGS、DEPTH_OPTIONS 等静态常量
```

**关键改动：**
- `repoListCache` / `repoListInFlight` 模块级变量移入 `useRepoList` 的 `useRef`，随组件生命周期管理
- `AddRepoModal` 传入 `repo` prop 时为编辑模式（支持修改 branch/language），为空时为新增
- `RepoDetailDrawer` 调用 `GET /repos/:id/analyses`，展示历史分析列表（时间、深度、节点数、耗时），点击跳转对应图谱

### 5c. API 过渡策略（/graph 向后兼容）

Dashboard、Architecture、CallGraph 等页面依赖 `GET /graph` 获取图谱列表，重构期间不能中断：

1. **阶段一（本次重构）**：新增 `GET /repos` 端点，保留 `GET /graph` 原样不动
2. **阶段二（下次迭代）**：各页面逐步迁移到 `GET /repos`，完成后废弃 `GET /graph` 中的 list 功能
3. `GET /graph?graph_id=xxx`（获取单个图谱）永远保留，不受影响

---

## 实施顺序

```
P0  后端
    1. database.py + repo_store.py + analysis_store.py（SQLite）
    2. 迁移逻辑（status.json → SQLite）
    3. /repos CRUD 端点（repos.py router）
    4. stage_registry.py + /api/pipeline/stages 端点
    5. StaticFirstPipeline stage key 对齐 registry
    6. Stage 日志格式统一

P0.5 后端
    7. AISemanticEnhanceStage 并发信号量

P1  后端
    8. server.py 拆分为 4 个 router 文件

P2  前端
    9.  RepoInfo 类型拆分 + repoStore 更新
    10. useRepoList + useAnalysisProgress hooks 抽取
    11. Repository 页 5 个子组件拆分
    12. AnalysisProgressPanel 动态读取 pipeline stages
    13. AddRepoModal 编辑模式
    14. RepoDetailDrawer 分析历史列表
```

---

## 不在本次范围内

- 批量分析能力
- 分析结果对比（多次图谱 diff）
- 定时自动重分析
- 其他页面（Dashboard、Architecture 等）迁移到新 /repos API
