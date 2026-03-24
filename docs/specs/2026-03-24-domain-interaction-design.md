# 业务领域视图交互增强设计文档

> 创建日期：2026-03-24

## 1. 概述

### 1.1 背景

当前业务领域视图（BusinessDomainView）只是一个静态展示，用户无法与领域节点进行有意义的交互。需要增加交互功能，让用户能够：
- 了解每个业务领域的功能描述
- 深入探索领域内部的节点和数据流向
- 查看节点的详细信息（含 AI 生成的描述和代码片段）

### 1.2 目标

| 交互 | 行为 |
|------|------|
| **单击领域节点** | 右侧固定面板显示简要统计，点击「查看详情」展开完整抽屉 |
| **双击领域节点** | 进入领域子图（核心数据流视图），支持详细度调节 |
| **子图中单击节点** | 右侧固定面板显示节点简要信息，点击「查看详情」展开完整抽屉 |

### 1.3 范围

- 前端：BusinessDomainView 组件增强、新增子图视图、信息面板/抽屉组件
- 后端：领域描述 API、节点批量信息 API、代码片段 API、AI 描述预生成逻辑

---

## 2. 交互设计

### 2.1 交互流程

```
┌─────────────────────────────────────────────────────────────────┐
│                        业务领域主图                               │
│                                                                  │
│   ┌──────────┐     ┌──────────┐     ┌──────────┐               │
│   │   DRS    │────→│   MDM    │────→│   FRS    │               │
│   │ 数据报表  │     │ 主数据   │     │ 风险扫描  │               │
│   └──────────┘     └──────────┘     └──────────┘               │
│        │                                                        │
│        │ 单击                                                   │
│        ↓                                                        │
│   ┌─────────────────────────────────┐                           │
│   │  右侧固定面板 (InfoPanel)        │                           │
│   │  ─────────────────────────────  │                           │
│   │  领域: DRS 数据报表服务          │                           │
│   │  节点: 895                      │                           │
│   │  跨领域调用: 12                 │                           │
│   │  [查看详情] ──────→ 打开抽屉     │                           │
│   └─────────────────────────────────┘                           │
│        │                                                        │
│        │ 双击                                                   │
│        ↓                                                        │
├─────────────────────────────────────────────────────────────────┤
│                        领域子图视图                               │
│                                                                  │
│   [← 返回]  [简洁 ○───●───○ 详细]  Tag: 模块 > DRS              │
│                                                                  │
│   ┌──────────┐     ┌──────────┐     ┌──────────┐               │
│   │Controller│────→│ Service  │────→│Repository│               │
│   │   入口    │     │  核心逻辑 │     │  数据访问 │               │
│   └──────────┘     └──────────┘     └──────────┘               │
│        │                                                        │
│        │ 单击节点                                               │
│        ↓                                                        │
│   ┌─────────────────────────────────┐                           │
│   │  右侧固定面板                    │                           │
│   │  ─────────────────────────────  │                           │
│   │  节点: DatabaseDetectionCtrl    │                           │
│   │  类型: Controller               │                           │
│   │  调用: 5  被调用: 0             │                           │
│   │  [查看详情] ──────→ 打开抽屉     │                           │
│   └─────────────────────────────────┘                           │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 交互时序

**双击进入子图：**

```
用户双击领域节点
    │
    ├─→ [同步，~50ms] 前端过滤该领域节点
    │                   → 应用核心路径算法
    │                   → 渲染子图
    │
    ├─→ [同步] 更新 Tag 层级指示器
    │
    └─→ [异步，~500-2000ms] POST /nodes/batch-info
                            ← 返回所有节点的 AI 描述
                            → 逐步填充节点悬浮信息
```

---

## 3. 数据模型

### 3.1 领域描述

```typescript
interface DomainDescription {
  domainId: string;

  // AI 生成的描述（预生成）
  summary: string;              // 功能摘要，100-200 字
  coreServices: string[];       // 核心服务名称列表
  dataFlowPattern: string;      // 数据流向模式描述

  // 元数据
  generatedAt: string;          // ISO 时间戳
  confidence: number;           // 生成置信度 0-1
}
```

### 3.2 节点详情

```typescript
interface NodeDetail {
  nodeId: string;

  // 基础信息（来自图谱）
  name: string;
  type: "Service" | "Controller" | "Repository" | "Function" | "Class";
  file: string;                 // 文件路径
  signature?: string;           // 方法签名
  line?: number;                // 起始行号
  endLine?: number;             // 结束行号

  // AI 增强信息（预生成）
  aiDescription?: string;       // AI 生成的功能描述，50-100 字
  codeSnippet?: CodeSnippet;    // 代码片段

  // 关系统计（运行时计算）
  callCount: number;            // 调用其他节点数
  calledByCount: number;        // 被调用次数
  dependencies: string[];       // 依赖的节点 ID 列表

  // 元数据
  generatedAt?: string;
}

interface CodeSnippet {
  language: string;             // java, typescript, python 等
  content: string;              // 代码内容
  startLine: number;            // 起始行号
  highlightLines: number[];     // 需要高亮的行号（方法签名、return 等）
}
```

### 3.3 批量请求响应

```typescript
interface BatchNodeInfoRequest {
  repoId: string;
  domainId: string;
  nodeIds: string[];
}

interface BatchNodeInfoResponse {
  domainId: string;
  domainDescription?: DomainDescription;  // 同时返回领域描述
  nodes: NodeDetail[];
  cached: boolean;            // 是否来自缓存
}
```

---

## 4. 前端组件设计

### 4.1 组件结构

```
src/pages/DataLineage/
├── components/
│   ├── BusinessDomainView.tsx      # 主图（现有，增强）
│   ├── BusinessDomainNode.tsx      # 领域节点组件（现有）
│   ├── DomainDetailView.tsx        # 新增：领域子图视图
│   ├── DomainInfoPanel.tsx         # 新增：右侧固定信息面板
│   ├── DomainInfoDrawer.tsx        # 新增：领域详情抽屉
│   └── NodeInfoDrawer.tsx          # 新增：节点详情抽屉
├── utils/
│   ├── domainAggregation.ts        # 现有
│   └── domainFilter.ts             # 新增：子图核心路径过滤
└── index.tsx                       # 主页面（增强）
```

### 4.2 状态管理（lineageStore.ts 扩展）

```typescript
interface LineageState {
  // 现有状态...

  // 新增：领域交互状态
  selectedDomain: DomainInfo | null;      // 当前选中的领域
  domainLevel: "main" | "subgraph";       // 当前层级

  // 信息面板状态
  infoPanelData: {
    type: "domain" | "node" | null;
    data: DomainDescription | NodeDetail | null;
  };

  // 抽屉状态
  domainDrawerVisible: boolean;
  nodeDrawerVisible: boolean;
  domainDrawerData: DomainDescription | null;
  nodeDrawerData: NodeDetail | null;

  // 子图详细度
  detailLevel: "compact" | "standard" | "detailed";
}
```

### 4.3 DomainDetailView（子图视图）

```tsx
interface DomainDetailViewProps {
  repoId: string;
  domainId: string;
  nodes: RawNode[];           // 该领域的所有节点
  edges: RawEdge[];           // 该领域的所有边
  domainDescription?: DomainDescription;
  onBack: () => void;
  onNodeClick: (nodeId: string, node: NodeDetail) => void;
}
```

**详细度滑块逻辑：**

| 级别 | 显示节点 | 说明 |
|------|---------|------|
| compact | 入口节点 + 主路径节点（被调用 ≥ 5 次） | 快速浏览核心流程 |
| standard | 入口节点 + 主路径节点 + 被调用 ≥ 3 次 | 平衡信息量 |
| detailed | 领域内所有节点 | 完整视图 |

### 4.4 DomainInfoPanel（固定信息面板）

```tsx
interface InfoPanelProps {
  type: "domain" | "node" | null;
  data: DomainDescription | NodeDetail | null;
  loading?: boolean;
  onViewDetail: () => void;   // 点击「查看详情」
}
```

**布局：**
- 固定在页面右侧，宽度 280px
- 始终可见，内容随选中项变化
- 底部「查看详情」按钮打开抽屉

### 4.5 DomainInfoDrawer（领域详情抽屉）

```tsx
interface DomainInfoDrawerProps {
  visible: boolean;
  domain: DomainDescription | null;
  onClose: () => void;
}
```

**内容结构：**
1. 领域名称 + 颜色标识
2. AI 生成的功能摘要
3. 核心服务列表
4. 数据流向模式描述
5. 统计信息（节点数、跨领域调用数）
6. 主要 Controller/Service/Repository 列表

### 4.6 NodeInfoDrawer（节点详情抽屉）

```tsx
interface NodeInfoDrawerProps {
  visible: boolean;
  node: NodeDetail | null;
  onClose: () => void;
}
```

**内容结构：**
1. 节点名称 + 类型标签
2. 基础信息（文件、签名）
3. AI 生成的功能描述
4. 代码片段（带行号、高亮关键行）
5. 关系统计（调用数、被调用数）
6. 依赖节点列表（可点击跳转）

---

## 5. 子图核心路径过滤算法

### 5.1 算法目标

识别并保留数据流的核心路径，过滤次要节点。

### 5.2 算法步骤

```typescript
function filterCorePathNodes(
  nodes: GraphNode[],
  edges: GraphEdge[],
  detailLevel: "compact" | "standard" | "detailed"
): GraphNode[] {
  // 1. 详细级别直接返回全部
  if (detailLevel === "detailed") {
    return nodes;
  }

  // 2. 识别入口节点（Controller、API Endpoint）
  const entryNodes = nodes.filter(n =>
    n.type === "Controller" || n.type === "APIEndpoint"
  );

  // 3. 识别出口节点（Repository、DAO、Database）
  const exitNodes = nodes.filter(n =>
    n.type === "Repository" || n.type === "DAO" || n.type === "Database"
  );

  // 4. 从入口节点 BFS 遍历，记录路径
  const pathNodes = new Set<string>();
  const queue = [...entryNodes.map(n => n.id)];

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    pathNodes.add(nodeId);

    // 查找该节点的所有出边
    const outEdges = edges.filter(e => e.from === nodeId);
    for (const edge of outEdges) {
      if (!pathNodes.has(edge.to)) {
        queue.push(edge.to);
      }
    }
  }

  // 5. 根据详细度过滤
  const minCallCount = detailLevel === "compact" ? 5 : 3;

  return nodes.filter(node => {
    // 保留入口和出口节点
    if (entryNodes.includes(node) || exitNodes.includes(node)) {
      return true;
    }
    // 保留主路径上的节点
    if (pathNodes.has(node.id)) {
      return true;
    }
    // 保留高调用数节点
    const calledByCount = edges.filter(e => e.to === node.id).length;
    return calledByCount >= minCallCount;
  });
}
```

---

## 6. 后端 API 设计

### 6.1 获取领域描述

```
GET /graph/lineage/domains/{domain_id}/description
```

**Query 参数：**
- `repo_id`: 仓库 ID（必需）

**响应：**
```json
{
  "domainId": "domain:drs",
  "summary": "DRS 数据报表服务负责生成和管理各类业务报表...",
  "coreServices": ["ReportGenerator", "DataService", "ExportService"],
  "dataFlowPattern": "Controller 接收请求 → Service 处理业务逻辑 → Repository 访问数据",
  "generatedAt": "2026-03-24T10:30:00Z",
  "confidence": 0.92
}
```

### 6.2 批量获取节点信息

```
POST /graph/lineage/nodes/batch-info
```

**请求体：**
```json
{
  "repoId": "adms",
  "domainId": "domain:drs",
  "nodeIds": [
    "function:adms-api/.../DatabaseDetectionController",
    "function:adms-api/.../DrsServiceImpl"
  ]
}
```

**响应：**
```json
{
  "domainId": "domain:drs",
  "domainDescription": { ... },
  "nodes": [
    {
      "nodeId": "function:adms-api/.../DatabaseDetectionController",
      "name": "DatabaseDetectionController",
      "type": "Controller",
      "file": "adms-api/src/main/java/.../DatabaseDetectionController.java",
      "signature": "ResponseResult create(DatabaseDetectionDto dto)",
      "line": 45,
      "aiDescription": "处理数据库检测备份相关的 HTTP 请求...",
      "codeSnippet": {
        "language": "java",
        "content": "@RestController\n@RequestMapping(\"/api/detection\")\npublic class DatabaseDetectionController {...}",
        "startLine": 45,
        "highlightLines": [47, 48]
      },
      "callCount": 5,
      "calledByCount": 0
    }
  ],
  "cached": true
}
```

### 6.3 获取单个节点代码片段

```
GET /graph/lineage/nodes/{node_id}/code
```

**Query 参数：**
- `repo_id`: 仓库 ID（必需）
- `highlight`: 是否高亮关键行（默认 true）

**响应：**
```json
{
  "nodeId": "function:adms-api/.../DatabaseDetectionController",
  "language": "java",
  "content": "...",
  "startLine": 45,
  "endLine": 80,
  "highlightLines": [47, 48, 75, 78]
}
```

---

## 7. AI 描述预生成

### 7.1 触发时机

在代码分析流水线（StaticFirstPipeline）的最后阶段，新增 `AIDescriptionStage`：

```
FileIndexStage → DeepStaticAnalysisStage → ... → AIDescriptionStage
```

### 7.2 领域描述生成

**输入：**
- 领域内所有节点的名称、类型、注解
- 节点间的调用关系
- 领域的关键字（如 `drs`）

**Prompt 模板：**
```
你是一个代码分析专家。请分析以下业务领域的代码结构，生成功能描述。

领域名称: {domain_name}
关键字: {domain_key}

节点列表:
{node_list}

调用关系:
{call_relations}

请输出:
1. 功能摘要（100-200字）
2. 核心服务列表
3. 数据流向模式描述
```

**输出：**
- 存储在 `data/ai_descriptions/{repo_id}/domains/{domain_id}.json`

### 7.3 节点描述生成

**输入：**
- 节点代码文件内容
- 节点签名、注解
- 调用关系上下文

**Prompt 模板：**
```
分析以下代码节点，生成功能描述。

节点类型: {node_type}
节点名称: {node_name}
文件路径: {file_path}

代码:
{code_content}

请输出:
1. 功能描述（50-100字）
2. 关键代码片段（不超过20行）
3. 需要高亮的行号
```

**输出：**
- 存储在 `data/ai_descriptions/{repo_id}/nodes/{node_hash}.json`

### 7.4 缓存策略

| 场景 | 策略 |
|------|------|
| 首次分析 | 流水线末尾批量生成，存入缓存 |
| 增量更新 | 仅重新生成变更文件的节点描述 |
| 手动触发 | 提供 API 强制重新生成 |

---

## 8. 错误处理

### 8.1 AI 描述生成失败

- 后端返回 `aiDescription: null`，前端显示占位文本
- 提供「重新生成」按钮

### 8.2 代码文件不存在

- 返回 `codeSnippet: null`，前端不显示代码区域

### 8.3 网络请求失败

- 子图仍可正常显示（使用前端数据）
- 信息面板显示「加载中...」+ 重试按钮

---

## 9. 性能考虑

### 9.1 前端

| 场景 | 优化措施 |
|------|---------|
| 子图渲染 | 使用 ReactFlow 虚拟化，节点 > 100 时启用 |
| 详细度切换 | 防抖 300ms，避免频繁重渲染 |
| 批量请求 | 单次请求最多 200 个节点，超出时分批 |

### 9.2 后端

| 场景 | 优化措施 |
|------|---------|
| AI 生成 | 预生成 + 缓存，避免实时调用 LLM |
| 批量请求 | 单次响应压缩，启用 gzip |
| 代码读取 | 文件内容缓存，避免重复 I/O |

---

## 10. 实现计划

### Phase 1: 前端交互框架（2天）
- 扩展 lineageStore 状态管理
- 实现 DomainInfoPanel 固定面板组件
- 实现 DomainInfoDrawer 和 NodeInfoDrawer 抽屉组件
- BusinessDomainView 增加单击/双击事件处理

### Phase 2: 子图视图（2天）
- 实现 DomainDetailView 组件
- 实现核心路径过滤算法
- 实现详细度滑块交互
- 增加子图导航（Tag 指示器 + 返回按钮）

### Phase 3: 后端 API（2天）
- 实现领域描述 API
- 实现节点批量信息 API
- 实现代码片段 API
- 增加缓存层

### Phase 4: AI 描述预生成（3天）
- 设计 AI 描述生成 Prompt
- 实现 AIDescriptionStage 流水线阶段
- 实现增量更新逻辑
- 测试生成质量

### Phase 5: 集成测试（1天）
- 端到端流程测试
- 性能测试（大规模节点）
- 错误场景测试

---

## 11. 验收标准

1. **单击领域节点**：右侧面板正确显示统计信息，点击「查看详情」打开抽屉
2. **双击领域节点**：正确进入子图，显示核心数据流
3. **详细度滑块**：切换时节点正确增减
4. **节点单击**：面板和抽屉正确显示节点信息
5. **AI 描述**：预生成内容正确显示，失败时有占位提示
6. **代码片段**：正确显示，关键行高亮，行号正确
7. **性能**：子图加载 < 500ms，批量 API 响应 < 2s
