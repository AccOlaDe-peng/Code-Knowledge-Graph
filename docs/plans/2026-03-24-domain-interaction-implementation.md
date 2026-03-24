# 业务领域视图交互增强实现计划

> 基于设计文档：`docs/specs/2026-03-24-domain-interaction-design.md`

## 实现概览

| Phase | 内容 | 预估工时 |
|-------|------|---------|
| Phase 1 | 前端交互框架 | 2 天 |
| Phase 2 | 子图视图 | 2 天 |
| Phase 3 | 后端 API | 2 天 |
| Phase 4 | AI 描述预生成 | 3 天 |
| Phase 5 | 集成测试 | 1 天 |

---

## Phase 1: 前端交互框架

### 任务 1.1: 扩展 lineageStore 状态管理

**文件**: `code-graph-ui/src/store/lineageStore.ts`

**新增状态**:
```typescript
// 领域交互状态
selectedDomain: DomainInfo | null;
domainLevel: "main" | "subgraph";

// 信息面板状态
infoPanelData: {
  type: "domain" | "node" | null;
  data: DomainDescription | NodeDetail | null;
  loading: boolean;
};

// 抽屉状态
domainDrawerVisible: boolean;
nodeDrawerVisible: boolean;
domainDrawerData: DomainDescription | null;
nodeDrawerData: NodeDetail | null;

// 子图详细度
detailLevel: "compact" | "standard" | "detailed";
```

**新增 Actions**:
- `setSelectedDomain(domain: DomainInfo | null)`
- `setDomainLevel(level: "main" | "subgraph")`
- `setInfoPanelData(data)`
- `openDomainDrawer(data: DomainDescription)`
- `closeDomainDrawer()`
- `openNodeDrawer(data: NodeDetail)`
- `closeNodeDrawer()`
- `setDetailLevel(level)`

**新增 Hooks**:
- `useDomainInteraction()`
- `useInfoPanel()`
- `useDetailLevel()`

---

### 任务 1.2: 实现 DomainInfoPanel 组件

**文件**: `code-graph-ui/src/pages/DataLineage/components/DomainInfoPanel.tsx`

**功能**:
- 固定在页面右侧，宽度 280px
- 显示简要统计信息
- 底部「查看详情」按钮

**布局**:
```
┌─────────────────────────────┐
│ ◆ DRS 数据报表服务           │  ← 领域信息
│ ─────────────────────────── │
│ 节点: 895                    │
│ 服务: 12                     │
│ 控制器: 8                    │
│ 跨领域调用: 12               │
│ ─────────────────────────── │
│ [查看详情]                   │  ← 打开抽屉
└─────────────────────────────┘
```

**或节点信息**:
```
┌─────────────────────────────┐
│ ◇ DatabaseDetectionCtrl     │  ← 节点信息
│ ─────────────────────────── │
│ 类型: Controller             │
│ 文件: ...Controller.java     │
│ 调用: 5  被调用: 0           │
│ ─────────────────────────── │
│ [查看详情]                   │
└─────────────────────────────┘
```

---

### 任务 1.3: 实现 DomainInfoDrawer 组件

**文件**: `code-graph-ui/src/pages/DataLineage/components/DomainInfoDrawer.tsx`

**功能**:
- 右侧抽屉，宽度 480px
- 显示完整的领域信息

**内容结构**:
1. 领域名称 + 颜色标识
2. AI 生成的功能摘要（加载中占位）
3. 核心服务列表
4. 数据流向模式描述
5. 统计信息
6. 主要服务列表（可展开）

---

### 任务 1.4: 实现 NodeInfoDrawer 组件

**文件**: `code-graph-ui/src/pages/DataLineage/components/NodeInfoDrawer.tsx`

**功能**:
- 右侧抽屉，宽度 520px
- 显示完整的节点信息

**内容结构**:
1. 节点名称 + 类型标签
2. 基础信息（文件路径、签名、行号）
3. AI 功能描述
4. 代码片段（带行号、高亮）
5. 关系统计
6. 依赖节点列表

**代码高亮**:
- 使用 `<pre>` + 行号
- 高亮关键行背景色

---

### 任务 1.5: BusinessDomainView 增加事件处理

**文件**: `code-graph-ui/src/pages/DataLineage/components/BusinessDomainView.tsx`

**修改**:
1. 增加 `onNodeClick` 处理 → 设置 infoPanelData
2. 增加 `onNodeDoubleClick` 处理 → 进入子图
3. 集成 DomainInfoPanel 组件
4. 集成 DomainInfoDrawer 组件

**双击检测**:
```typescript
const [lastClickTime, setLastClickTime] = useState(0);
const DOUBLE_CLICK_DELAY = 300; // ms

const handleNodeClick = (event, node) => {
  const now = Date.now();
  if (now - lastClickTime < DOUBLE_CLICK_DELAY) {
    // 双击 → 进入子图
    handleNodeDoubleClick(node);
  } else {
    // 单击 → 显示面板
    showInfoPanel(node);
  }
  setLastClickTime(now);
};
```

---

## Phase 2: 子图视图

### 任务 2.1: 实现核心路径过滤算法

**文件**: `code-graph-ui/src/pages/DataLineage/utils/domainFilter.ts`

**函数**:
```typescript
export function filterCorePathNodes(
  nodes: RawNode[],
  edges: RawEdge[],
  detailLevel: "compact" | "standard" | "detailed"
): { nodes: RawNode[], edges: RawEdge[] }
```

**算法步骤**:
1. 详细级别直接返回全部
2. 识别入口节点（Controller、APIEndpoint）
3. 识别出口节点（Repository、DAO、Database）
4. BFS 遍历记录主路径节点
5. 根据详细度过滤

---

### 任务 2.2: 实现 DomainDetailView 组件

**文件**: `code-graph-ui/src/pages/DataLineage/components/DomainDetailView.tsx`

**功能**:
- 显示领域内节点和边
- 支持详细度滑块
- 显示层级导航

**工具栏**:
- 返回按钮
- 详细度滑块（简洁/标准/详细）
- Tag 层级指示器

---

### 任务 2.3: 实现详细度滑块

**组件**: Slider 或 Radio.Group

**选项**:
- 简洁: 入口 + 主路径 + 被调用 ≥ 5
- 标准: 入口 + 主路径 + 被调用 ≥ 3
- 详细: 全部节点

**交互**:
- 切换时防抖 300ms
- 重新应用过滤算法
- 保持视图中心

---

### 任务 2.4: 子图导航集成

**文件**: `code-graph-ui/src/pages/DataLineage/index.tsx`

**修改**:
1. 增加领域层级判断逻辑
2. 渲染 DomainDetailView
3. Tag 指示器显示层级路径

---

## Phase 3: 后端 API

### 任务 3.1: 实现领域描述 API

**文件**: `code-graph-system/backend/api/routers/domains.py`

**端点**: `GET /graph/lineage/domains/{domain_id}/description`

**逻辑**:
1. 从缓存读取领域描述 JSON
2. 如果缓存不存在，返回空描述（待 AI 生成）
3. 如果有预生成描述，返回

---

### 任务 3.2: 实现节点批量信息 API

**文件**: `code-graph-system/backend/api/routers/graphs.py`

**端点**: `POST /graph/lineage/nodes/batch-info`

**请求体**:
```json
{
  "repoId": "adms",
  "domainId": "domain:drs",
  "nodeIds": ["node1", "node2"]
}
```

**逻辑**:
1. 从图谱获取节点基础信息
2. 从缓存读取 AI 描述
3. 计算关系统计（调用数、被调用数）
4. 返回批量结果

---

### 任务 3.3: 实现代码片段 API

**文件**: `code-graph-system/backend/api/routers/graphs.py`

**端点**: `GET /graph/lineage/nodes/{node_id}/code`

**逻辑**:
1. 从节点信息获取文件路径和行号
2. 读取代码文件
3. 提取指定行范围的代码
4. 识别高亮行（方法签名、return 语句）
5. 返回代码片段

---

### 任务 3.4: 增加缓存层

**文件**: `code-graph-system/backend/services/description_cache.py`

**缓存结构**:
```
data/ai_descriptions/
├── {repo_id}/
│   ├── domains/
│   │   └── {domain_id}.json
│   └── nodes/
│       └── {node_hash}.json
```

**缓存管理**:
- `get_domain_description(repo_id, domain_id)`
- `set_domain_description(repo_id, domain_id, description)`
- `get_node_description(repo_id, node_id)`
- `set_node_description(repo_id, node_id, description)`
- `invalidate_repo(repo_id)`

---

## Phase 4: AI 描述预生成

### 任务 4.1: 设计 AI 描述生成 Prompt

**文件**: `code-graph-system/backend/llm/prompts/description_prompts.py`

**领域描述 Prompt**:
```
你是一个代码分析专家。请分析以下业务领域的代码结构，生成功能描述。

领域名称: {domain_name}
关键字: {domain_key}

节点列表:
{node_list}

调用关系:
{call_relations}

请以 JSON 格式输出:
{{
  "summary": "功能摘要（100-200字）",
  "coreServices": ["服务1", "服务2"],
  "dataFlowPattern": "数据流向模式描述"
}}
```

**节点描述 Prompt**:
```
分析以下代码节点，生成功能描述。

节点类型: {node_type}
节点名称: {node_name}
文件路径: {file_path}

代码:
{code_content}

请以 JSON 格式输出:
{{
  "description": "功能描述（50-100字）",
  "highlightLines": [行号1, 行号2]
}}
```

---

### 任务 4.2: 实现 AIDescriptionStage

**文件**: `code-graph-system/backend/pipeline/stages/ai_description_stage.py`

**类**: `AIDescriptionStage`

**输入**: GraphMergeStage 的输出（图谱数据）

**处理流程**:
1. 按领域分组节点
2. 对每个领域调用 LLM 生成描述
3. 对每个关键节点调用 LLM 生成描述
4. 存储到缓存

**配置**:
```python
class AIDescriptionConfig:
    enabled: bool = True
    max_nodes_per_domain: int = 50  # 每个领域最多处理的节点数
    batch_size: int = 10            # 批量调用大小
    concurrency: int = 3            # 并发数
```

---

### 任务 4.3: 实现增量更新逻辑

**文件**: `code-graph-system/backend/pipeline/stages/ai_description_stage.py`

**逻辑**:
1. 检查哪些文件有变更
2. 只重新生成变更文件相关的节点描述
3. 如果领域内节点变更超过 30%，重新生成领域描述

---

### 任务 4.4: 测试生成质量

**测试用例**:
1. 小型领域（< 50 节点）生成测试
2. 大型领域（> 200 节点）生成测试
3. 增量更新测试
4. 错误处理测试（LLM 调用失败）

---

## Phase 5: 集成测试

### 任务 5.1: 端到端流程测试

**测试流程**:
1. 启动后端服务
2. 启动前端服务
3. 选择仓库
4. 切换到业务领域视图
5. 单击领域节点 → 验证面板显示
6. 点击「查看详情」→ 验证抽屉显示
7. 双击领域节点 → 验证子图显示
8. 调节详细度滑块 → 验证节点增减
9. 单击子图节点 → 验证节点信息显示

---

### 任务 5.2: 性能测试

**测试场景**:
1. 大规模领域（500+ 节点）子图加载
2. 批量 API 响应时间（200 节点）
3. 详细度切换响应时间

**性能指标**:
- 子图加载 < 500ms
- 批量 API 响应 < 2s
- 详细度切换 < 300ms

---

### 任务 5.3: 错误场景测试

**测试场景**:
1. AI 描述未生成 → 显示占位文本
2. 代码文件不存在 → 不显示代码区域
3. 网络请求失败 → 显示重试按钮
4. 后端服务不可用 → 子图仍可用（前端数据）

---

## 文件清单

### 前端新增文件

| 文件 | 说明 |
|------|------|
| `components/DomainInfoPanel.tsx` | 右侧固定信息面板 |
| `components/DomainInfoDrawer.tsx` | 领域详情抽屉 |
| `components/NodeInfoDrawer.tsx` | 节点详情抽屉 |
| `components/DomainDetailView.tsx` | 领域子图视图 |
| `utils/domainFilter.ts` | 核心路径过滤算法 |

### 前端修改文件

| 文件 | 修改内容 |
|------|---------|
| `store/lineageStore.ts` | 新增状态和 actions |
| `components/BusinessDomainView.tsx` | 增加交互事件 |
| `index.tsx` | 集成子图视图 |

### 后端新增文件

| 文件 | 说明 |
|------|------|
| `services/description_cache.py` | 描述缓存服务 |
| `pipeline/stages/ai_description_stage.py` | AI 描述生成阶段 |
| `llm/prompts/description_prompts.py` | 描述生成 Prompt |

### 后端修改文件

| 文件 | 修改内容 |
|------|---------|
| `api/routers/domains.py` | 新增领域描述 API |
| `api/routers/graphs.py` | 新增节点批量信息和代码片段 API |

---

## 依赖关系

```
Phase 1 (前端框架)
    │
    ├──→ Phase 2 (子图视图) ──→ Phase 5 (测试)
    │                              ↑
    └──→ Phase 3 (后端 API) ───────┤
                │                  │
                └──→ Phase 4 (AI) ─┘
```

**建议实现顺序**:
1. Phase 1 → 前端可以先独立开发，使用 mock 数据
2. Phase 3 → 后端 API 可以独立开发
3. Phase 2 → 依赖 Phase 1
4. Phase 4 → 依赖 Phase 3
5. Phase 5 → 所有功能完成后测试
