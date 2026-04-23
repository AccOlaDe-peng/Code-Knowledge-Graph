---
name: Agent-Based Knowledge Graph Pipeline Redesign
description: Replace 5 pipeline implementations with unified TypeScript Agent architecture, integrating Claude-Code Agent capabilities and graphify analysis patterns
type: project
created: 2026-04-22
---

# Agent-Based Knowledge Graph Pipeline Redesign

## 1. 背景

Code-Knowledge-Graph 项目当前存在 5 种流水线实现（StaticFirst, AIFirst, Optimized, Graph, MultiAgent），22 个 Stage 文件，多层分散缓存，Spring 框架特化逻辑硬编码在默认流水线中。整体架构复杂、维护成本高、扩展困难。

**目标**：删除所有现有流水线代码，用 TypeScript 全栈重写，集成 Claude-Code 的 Agent 子进程系统和 Coordinator 编排模式，参考 graphify 的三阶段分析流程，构建统一的 Agent 架构。

## 2. 分析模式（Coordinator 自动决策）

Coordinator 根据运行条件自动决定启动哪些 Agent，无需用户手动选择模式：

| 条件 | 启动的 Agent | 理由 |
|------|-------------|------|
| 首次全量分析 | Scanner → Static + Semantic(并行) → Lineage → GraphBuild → Report | 完整三阶段 |
| 增量更新（`--update`） | Scanner → 仅对未缓存文件运行 Static/Semantic → GraphBuild → Report | 跳过已缓存 |
| 纯代码仓库（代码文件占比 >95%） | Scanner → Static → GraphBuild → Report | 跳过语义（graphify fast path） |
| 无 LLM API Key | Scanner → Static → GraphBuild → Report | 自动降级为纯静态 |

用户只需指定仓库路径和是否增量，Coordinator 自行编排。

**纯代码仓库判断逻辑**：
```typescript
// 在 ScannerAgent 中计算代码文件占比
const codeFileRatio = scanResult.codeFileCount / scanResult.totalFileCount;
const isPureCodeRepo = codeFileRatio > 0.95;  // 超过 95% 是代码文件
```

## 3. 成功标准

- **简化架构**：5 种流水线 → 1 套 Agent 系统，代码复杂度显著降低
- **性能提升**：并行 Agent 执行，LLM 调用通过缓存减少
- **结果可信**：每条边标注 EXTRACTED/INFERRED/AMBIGUOUS 可信度，不臆造关系
- **增量更新**：只重新处理变更文件，利用缓存加速

## 4. 整体架构

```
┌─────────────────────────────────────────────────┐
│                   React Frontend                │
│         (保持现有 UI + 新增 Agent 状态面板)       │
└──────────────────────┬──────────────────────────┘
                       │ HTTP/WebSocket
┌──────────────────────┴──────────────────────────┐
│                 Fastify API Layer                │
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────┴──────────────────────────┐
│              Coordinator (指挥官)                 │
│  - 接收分析请求                                   │
│  - 创建任务列表                                   │
│  - 派发 Agent 执行                                │
│  - 监控进度/处理错误                               │
│  - 合并 Agent 结果（确定性优先级）                  │
└───────┬──────────┬──────────┬───────────────────┘
        │          │          │  SendMessage
   ┌────┴───┐ ┌───┴────┐ ┌──┴─────┐
   │Scanner │ │Static  │ │GraphBuild│  ... 更多 Agent
   │ Agent  │ │Agent   │ │ Agent    │
   └────────┘ └────────┘ └──────────┘
        │          │          │
   ┌────┴──────────┴──────────┴───────────────────┐
   │              Shared Tool Pool                  │
   │  TreeSitterParser │ LLMClient │ GraphStore    │
   │  FileScanner      │ Cache     │ TaskTracker   │
   └───────────────────────────────────────────────┘
```

**核心设计原则：**

1. **Coordinator 单一入口**：所有分析请求经过 Coordinator，它只有 3 个能力——派发 Agent、接收消息、停止任务
2. **Agent 各司其职**：每个 Agent 有明确的职责边界和独立工具集
3. **共享工具池**：AST 解析器、LLM 客户端、图谱存储等作为共享工具，Agent 按需获取
4. **参考 graphify 三阶段**：确定性 AST → LLM 语义提取 → 图谱构建聚类

## 5. 项目结构

```
code-graph-system/
├── src/
│   ├── coordinator/          # Coordinator 编排层
│   │   ├── Coordinator.ts    # 指挥官主逻辑
│   │   ├── Merger.ts        # 确定性合并逻辑
│   │   ├── TaskTracker.ts    # 基于文件的任务追踪
│   │   └── types.ts          # 编排类型定义
│   ├── agents/               # Agent 系统
│   │   ├── BaseAgent.ts      # Agent 基类（生命周期、工具池、通信）
│   │   ├── AgentRunner.ts    # Agent 执行引擎
│   │   ├── AgentPool.ts      # Agent 池管理
│   │   ├── ForkAgent.ts      # Fork 子代理机制
│   │   ├── AgentContext.ts   # 上下文（只读配置，不共享写入）
│   │   ├── tools/            # 共享工具定义
│   │   │   ├── TreeSitterTool.ts
│   │   │   ├── LLMTool.ts
│   │   │   ├── GraphStoreTool.ts
│   │   │   ├── FileScanTool.ts
│   │   │   └── CacheTool.ts
│   │   └── specialized/      # 专用 Agent
│   │       ├── ScannerAgent.ts    # 仓库扫描
│   │       ├── StaticAgent.ts     # 静态 AST 分析
│   │       ├── SemanticAgent.ts   # LLM 语义增强
│   │       ├── LineageAgent.ts    # 数据血缘提取
│   │       ├── GraphBuildAgent.ts # 图谱构建+聚类
│   │       └── ReportAgent.ts     # 报告生成
│   ├── graph/                # 图谱层
│   │   ├── schema.ts         # 节点/边类型定义
│   │   ├── GraphEngine.ts    # 图谱引擎（graphology）
│   │   ├── CommunityDetector.ts  # Leiden 社区检测
│   │   └── store/            # 存储后端
│   │       ├── LocalFileStore.ts
│   │       ├── Neo4jStore.ts
│   │       └── ChromaStore.ts
│   ├── parser/               # AST 解析层
│   │   ├── TreeSitterParser.ts
│   │   └── languages/        # 多语言支持
│   ├── api/                  # Fastify API 层
│   ├── llm/                  # LLM 客户端
│   ├── cache/                # 缓存管理
│   ├── errors/               # 错误类型与恢复
│   ├── logging/              # 结构化日志
│   └── index.ts              # 入口
├── package.json              # Bun 项目
└── tsconfig.json
```

## 6. Agent 系统核心

### 6.1 Agent 基类

```typescript
interface AgentConfig {
  name: string;
  description: string;
  tools: string[];                    // 必须显式列出，不允许通配符
  disallowedTools?: string[];
  model?: 'opus' | 'sonnet' | 'haiku';
  maxConcurrency?: number;
}

abstract class BaseAgent {
  protected context: AgentContext;   // 只读配置
  protected toolPool: Tool[];

  async initialize(): Promise<void>;
  async execute(task: Task): Promise<AgentResult>;  // 返回独立结果，不直接写共享 Map
  async terminate(): Promise<void>;

  async sendMessage(to: string, message: Message): Promise<void>;
  async receiveMessage(from: string, message: Message): Promise<void>;

  abstract onTaskStart(task: Task): Promise<void>;
  abstract onTaskComplete(result: AgentResult): Promise<void>;
  abstract onError(error: Error): Promise<void>;
}
```

### 6.2 Agent 结果与合并（解决并发问题）

**核心设计：每个 Agent 返回独立结果，Coordinator 负责确定性合并。**

```typescript
// Agent 执行结果（独立，不共享写入）
interface AgentResult {
  agentId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  metadata: {
    confidence: Confidence;
    source: 'ast' | 'semantic' | 'lineage';
    filesProcessed: string[];
    tokensUsed?: number;
  };
}

// Agent 上下文（只读配置，不包含共享写入的 Map）
interface AgentContext {
  sessionId: string;
  workingDirectory: string;
  cache: CacheManager;      // 只读：检查缓存命中
  taskTracker: TaskTracker; // 只读：查询任务状态
}
```

**Merger 确定性合并逻辑：**

```typescript
// 全局优先级定义（节点和边共用）
const CONFIDENCE_PRIORITY: Record<Confidence, number> = {
  EXTRACTED: 3,
  INFERRED: 2,
  AMBIGUOUS: 1
} as const;

// 来源优先级（数字越大优先级越高）
const SOURCE_PRIORITY: Record<string, number> = {
  ast: 10,       // AST 解析最可信
  lineage: 5,    // 血缘推断次之
  semantic: 1,   // 语义推断最低
} as const;

class Merger {
  /**
   * 合并多个 Agent 结果，遵循确定性的优先级规则：
   * 1. 节点去重：相同 id 的节点，高置信度优先
   * 2. 边去重：相同 source+target+type 的边，EXTRACTED > INFERRED > AMBIGUOUS
   * 3. metadata 合并：高置信度数据不被低置信度数据覆盖
   */
  merge(results: AgentResult[]): GraphData {
    const merged = new Map<string, GraphNode>();
    const mergedEdges = new Map<string, GraphEdge>();

    // 按 source 优先级排序（显式定义，不依赖字母顺序）
    const sortedResults = results.sort((a, b) => 
      (SOURCE_PRIORITY[b.metadata.source] ?? 0) - (SOURCE_PRIORITY[a.metadata.source] ?? 0)
    );

    for (const result of sortedResults) {
      for (const node of result.nodes) {
        const existing = merged.get(node.id);
        if (!existing || this.shouldOverride(existing, node)) {
          merged.set(node.id, node);
        }
      }
      for (const edge of result.edges) {
        const key = `${edge.source}:${edge.target}:${edge.type}`;
        const existing = mergedEdges.get(key);
        if (!existing || this.shouldOverrideEdge(existing, edge)) {
          mergedEdges.set(key, edge);
        }
      }
    }

    return { nodes: [...merged.values()], edges: [...mergedEdges.values()] };
  }

  private shouldOverride(existing: GraphNode, incoming: GraphNode): boolean {
    // 与边使用相同的优先级逻辑
    const existingPriority = CONFIDENCE_PRIORITY[existing.confidence ?? 'AMBIGUOUS'] ?? 0;
    const incomingPriority = CONFIDENCE_PRIORITY[incoming.confidence ?? 'AMBIGUOUS'] ?? 0;
    return incomingPriority > existingPriority;
  }

  private shouldOverrideEdge(existing: GraphEdge, incoming: GraphEdge): boolean {
    const existingPriority = CONFIDENCE_PRIORITY[existing.confidence] ?? 0;
    const incomingPriority = CONFIDENCE_PRIORITY[incoming.confidence] ?? 0;
    return incomingPriority > existingPriority;
  }
}
```

### 6.3 Fork 子代理（带生命周期管理）

```typescript
interface ForkConfig {
  maxConcurrency: number;   // 最大并行 Fork 数，默认 5
  timeoutMs: number;        // 单个 Fork 超时，默认 60000ms
  retryLimit: number;       // 失败重试次数，默认 1
}

class AgentPool {
  private active: Set<string> = new Set();
  private queue: ForkRequest[] = [];

  async fork(parent: BaseAgent, config: Partial<AgentConfig>, forkConfig?: Partial<ForkConfig>): Promise<BaseAgent> {
    const fc = { maxConcurrency: 5, timeoutMs: 60000, retryLimit: 1, ...forkConfig };

    // 背压：超过并发上限时排队等待
    if (this.active.size >= fc.maxConcurrency) {
      await new Promise<void>(resolve => this.queue.push(resolve));
    }

    const forked = new ForkedAgent({
      ...parent.config,
      ...config,
      context: parent.context,      // 继承只读上下文
      toolPool: parent.toolPool,    // 继承工具池
      parentAgentId: parent.id,
    });

    this.active.add(forked.id);

    // 超时保护
    const timeout = setTimeout(() => forked.terminate(), fc.timeoutMs);

    // 完成时清理资源
    forked.onComplete(() => {
      clearTimeout(timeout);
      this.active.delete(forked.id);
      const next = this.queue.shift();
      next?.();
    });

    return forked;
  }

  // Coordinator 完成时清理所有活跃 Fork
  async terminateAll(): Promise<void> {
    const terminations = [...this.active].map(id => this.terminateById(id));
    await Promise.all(terminations);
    this.queue.forEach(resolve => resolve()); // 释放排队等待者
    this.queue = [];
  }
}
```

### 6.4 专用 Agent 定义

| Agent | 职责 | 工具集 | 模型 | 输出置信度 |
|-------|------|--------|------|-----------|
| ScannerAgent | 文件扫描、Git 增量检测 | FileScanTool | haiku | N/A |
| StaticAgent | AST 解析、结构提取 | TreeSitterTool, CacheTool | 无 LLM | EXTRACTED |
| SemanticAgent | LLM 语义增强、模块边界 | LLMTool, CacheTool | sonnet | INFERRED/AMBIGUOUS |
| LineageAgent | 数据血缘推断 | LLMTool, GraphStoreTool | sonnet | INFERRED |
| GraphBuildAgent | 社区检测、图谱构建 | GraphStoreTool | 无 LLM | N/A |
| ReportAgent | 报告生成 | LLMTool | haiku | N/A |

### 6.5 Agent 通信协议

```typescript
interface Message {
  type: 'task_result' | 'progress' | 'error' | 'query' | 'response';
  fromAgentId: string;
  toAgentId: string | 'coordinator' | 'broadcast';
  payload: unknown;
  timestamp: number;
}

interface Task {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  agentId?: string;
  result?: AgentResult;
  error?: string;
  blockedBy?: string[];
}

class TaskTracker {
  private tasksFile: string;  // ~/.code-graph/tasks/{sessionId}.json
  private tasks: Map<string, Task> = new Map();
  private dirty: Set<string> = new Set();
  private flushInterval: NodeJS.Timeout;

  constructor(tasksFile: string) {
    this.tasksFile = tasksFile;
    // 每 5 秒批量刷新脏任务到磁盘
    this.flushInterval = setInterval(() => this.flush(), 5000);
  }

  async createTask(task: Task): Promise<void>;
  async updateTask(taskId: string, update: Partial<Task>): Promise<void> {
    const task = this.tasks.get(taskId);
    if (task) Object.assign(task, update);
    this.dirty.add(taskId);
    // 不立即写磁盘，等批量刷新
  }
  async getPendingTasks(): Promise<Task[]>;
  async getBlockedTasks(): Promise<Task[]>;

  // 批量刷新脏任务到磁盘
  private async flush(): Promise<void> {
    if (this.dirty.size === 0) return;
    const toFlush = [...this.dirty];
    this.dirty.clear();
    const data = Object.fromEntries(
      toFlush.map(id => [id, this.tasks.get(id)])
    );
    await fs.writeFile(this.tasksFile, JSON.stringify(data));
  }

  // Coordinator 完成时强制刷新
  async forceFlush(): Promise<void> {
    clearInterval(this.flushInterval);
    await this.flush();
  }
}
```

## 7. 分析流程

### 7.1 完整分析流程

```
用户请求 ──→ Coordinator
                │
                ├─ 1. 创建任务列表
                │
                ├─ 2. ScannerAgent
                │     ├─ 文件检测（类型、数量）
                │     ├─ Git 增量检测
                │     ├─ 缓存检查
                │     └─ 返回：文件列表 + 变更集
                │
                ├─ 3. StaticAgent 和 SemanticAgent 并行启动
                │     │
                │     ├─ StaticAgent（独立执行）
                │     │     ├─ Tree-sitter AST 解析
                │     │     ├─ 提取：类、函数、导入、调用关系
                │     │     ├─ 输出置信度：EXTRACTED
                │     │     └─ 返回：AgentResult（独立）
                │     │
                │     └─ SemanticAgent（独立执行）
                │           ├─ 缓存命中检查
                │           ├─ 未命中文件分块（20-25 文件/块）
                │           ├─ 并行 Fork 子代理处理各块
                │           ├─ 提取：语义关系、模块边界、设计理由
                │           ├─ 输出置信度：INFERRED / AMBIGUOUS
                │           └─ 返回：AgentResult（独立）
                │
                ├─ 4. Merger 合并（确定性优先级）
                │     ├─ 等待 StaticAgent 和 SemanticAgent 都完成
                │     ├─ 节点去重：EXTRACTED 优先
                │     └─ 边去重：EXTRACTED > INFERRED > AMBIGUOUS
                │
                ├─ 5. LineageAgent
                │     ├─ 基于 Merger 合并后的结果推断数据血缘
                │     ├─ 实体级 + 字段级血缘
                │     └─ 返回：血缘边（INFERRED）
                │
                ├─ 6. GraphBuildAgent
                │     ├─ 接收所有 Agent 结果 + Lineage 结果
                │     ├─ Leiden 社区检测
                │     ├─ God Nodes 识别
                │     ├─ Surprising Connections 发现
                │     └─ 返回：完整图谱
                │
                ├─ 7. ReportAgent
                │     ├─ 社区标签命名
                │     ├─ 生成分析报告
                │     └─ 返回：报告 + 建议问题
                │
                └─ 8. 返回结果
```

### 7.2 并行策略与同步点

```
时间线 ────────────────────────────────────────────→

ScannerAgent    ████████████
                               ↓ 结果就绪，触发并行
StaticAgent                  ████████████████  ─┐
SemanticAgent                ████████████████████ ├─ 并行执行，独立输出
                             └─ Fork 子代理并行   │
                                                  ─┘
Merger（同步点）                                ████  ← 等待两者都完成
LineageAgent                                         ████████████
GraphBuildAgent                                                    ████████
ReportAgent                                                                 ████
```

**关键设计：**
- StaticAgent 和 SemanticAgent **完全并行**，各自返回独立的 `AgentResult`
- **Merger 作为同步点**，等待两者都完成后，按确定性优先级合并
- LineageAgent 只在 Merger 合并后才启动，确保输入数据一致

### 7.3 增量更新流程

```
用户请求（--update）───→ Coordinator
                          │
                          ├─ ScannerAgent：Git diff 检测变更文件
                          ├─ CacheTool：标记缓存命中/未命中
                          ├─ 仅对未命中文件执行 Static + Semantic
                          ├─ 备份旧图谱 → Merger 合并新旧结果
                          ├─ GraphBuildAgent：graph_diff() 显示差异
                          └─ ReportAgent：增量报告
```

### 7.4 可信度标注

| 标签 | 含义 | 来源 |
|------|------|------|
| EXTRACTED | 源码中明确存在 | AST 解析、import 语句 |
| INFERRED | 合理推断 | LLM 语义分析 |
| AMBIGUOUS | 不确定，标记而非省略 | LLM 低置信度推断 |

## 8. 图谱引擎

### 8.1 Schema

```typescript
type NodeType =
  | 'Module' | 'Class' | 'Function' | 'Method' | 'Interface'
  | 'Service' | 'Controller' | 'Repository' | 'Entity' | 'Table'
  | 'Field' | 'Endpoint' | 'Event' | 'Config' | 'Community';

type EdgeType =
  | 'imports' | 'calls' | 'implements' | 'extends' | 'references'
  | 'depends_on' | 'contains' | 'flow_to' | 'one_to_one'
  | 'shares_data_with' | 'conceptually_related_to' | 'belongs_to_community';

type Confidence = 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS';

interface GraphNode {
  id: string;
  label: string;
  type: NodeType;
  file: string;
  location?: SourceLocation;
  confidence?: Confidence;
  metadata: Record<string, unknown>;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  confidence: Confidence;
  weight: number;
  file?: string;
  location?: SourceLocation;
}
```

### 8.2 GraphEngine（graphology）

```typescript
class GraphEngine {
  addNode(node: GraphNode): void;
  addEdge(edge: GraphEdge): void;
  merge(other: GraphEngine): void;

  detectCommunities(): Map<string, string>;
  findGodNodes(): GraphNode[];
  findSurprisingConnections(): GraphEdge[];
  shortestPath(from: string, to: string): string[];

  toJSON(): GraphData;
  toGraphML(): string;
  toCypher(): string[];
  toHTML(): string;
}
```

选择 graphology 的原因：纯 JavaScript、无 native 依赖、与 Bun 兼容、内置社区检测、支持百万级节点。

### 8.3 TypeScript 限制

前端 React 项目开启了 `erasableSyntaxOnly: true`，禁止使用 TypeScript `enum`。因此：

- 后端 TypeScript 代码使用 `const` 对象 + `as const` 代替 `enum`
- Schema 类型定义使用联合字面量类型（`type NodeType = 'Module' | 'Class' | ...`），不使用 `enum`
- 示例：`const NodeType = { Module: 'Module', Class: 'Class', ... } as const`

### 8.4 存储后端

```typescript
interface GraphStore {
  save(graph: GraphEngine): Promise<void>;
  load(sessionId: string): Promise<GraphEngine>;
  delete(sessionId: string): Promise<void>;
}

class LocalFileStore implements GraphStore { ... }    // JSON（默认）
class Neo4jStore implements GraphStore { ... }         // Neo4j（可选）
class ChromaStore implements GraphStore { ... }        // ChromaDB（可选）
```

### 8.5 缓存系统（带 TTL 和 Schema 版本）

```typescript
// Schema 版本：GraphNode 格式变化时必须更新
const CACHE_SCHEMA_VERSION = '2026-04-22-v1';

// 各类型缓存的 TTL 配置
const CACHE_TTL = {
  ast: 7 * 24 * 60 * 60 * 1000,      // 7 天（结构稳定）
  semantic: 24 * 60 * 60 * 1000,     // 1 天（可能变化）
  lineage: 3 * 24 * 60 * 60 * 1000,  // 3 天
} as const;

interface CacheEntry {
  key: string;              // SHA256(文件路径 + 内容hash)
  result: unknown;
  createdAt: number;
  type: 'ast' | 'semantic' | 'lineage';
  schemaVersion: string;    // 必须匹配 CACHE_SCHEMA_VERSION
  ttlMs: number;           // 超时时间
}

class CacheManager {
  private store: Map<string, CacheEntry> = new Map();

  check(filePaths: string[]): { hit: string[]; miss: string[] };
  
  get(key: string): CacheEntry | null {
    const entry = this.store.get(key);
    if (!entry) return null;

    // TTL 检查：过期则删除
    if (Date.now() > entry.createdAt + entry.ttlMs) {
      this.store.delete(key);
      return null;
    }

    // Schema 版本检查：版本不匹配则删除
    if (entry.schemaVersion !== CACHE_SCHEMA_VERSION) {
      this.store.delete(key);
      return null;
    }

    return entry;
  }
  
  set(key: string, result: unknown, type: CacheEntry['type']): void {
    this.store.set(key, {
      key,
      result,
      createdAt: Date.now(),
      type,
      schemaVersion: CACHE_SCHEMA_VERSION,
      ttlMs: CACHE_TTL[type],
    });
  }
  
  detectChanges(baseDir: string): string[];
  saveToFile(path: string): void;
  loadFromFile(path: string): void;
}
```

统一替代现有 4 层分散缓存（StageCacheManager + ModuleCacheEntry + Git diff + AI 分析缓存）。

## 9. API 层

### 9.1 REST API

```
POST /analyze
  Body: { 
    path: string;
    update?: boolean;           # 是否增量更新
    enableLineage?: boolean;    # 是否启用血缘分析
    languages?: string[];        # 指定要解析的语言，如 ['typescript', 'python']
    budget?: number;             # LLM 预算上限（美元），默认 10.0
  }
  Response: { sessionId, status: 'started' }

GET /analyze/:sessionId/status
  Response: { 
    status: 'running' | 'completed' | 'failed';
    progress: { scanner, static, semantic, lineage, graph, report };
    errors?: string[];
  }

GET /analyze/:sessionId/result
  Response: { graph, report }

POST /query
  Body: { sessionId, question, mode: 'bfs'|'dfs', budget? }
  Response: { answer, citations }

GET /export/:sessionId/:format
  Format: 'json' | 'graphml' | 'cypher' | 'svg' | 'html'
```

**说明**：
- 无 `mode` 参数，Coordinator 根据条件自动选择启动哪些 Agent（见第 2 节）
- `update: true` 触发增量更新模式

### 9.2 WebSocket

```
ws://localhost:3000/ws/:sessionId

推送消息：
{ type: 'agent_progress'|'agent_complete'|'error'|'task_created', agent, data }
```

### 9.3 前后端字段统一

统一使用 `source`/`target`（不再有 `from_`/`to` 映射），统一使用 `label`（不再有 `name`→`label` 转换）。

### 9.4 前端改动

- 新增：`<AgentStatusPanel />`、`<TaskQueuePanel />`、`<TokenUsageMeter />`
- 保持：Dashboard、Repository、GraphViewer、DataLineage、FunctionCallGraph 页面

## 10. 错误处理

### 10.1 错误分类

```typescript
class AgentError extends Error {
  constructor(
    public code: ErrorCode,
    public agent: string,
    public recoverable: boolean,
    public context?: unknown
  ) { super(message); }
}

const ErrorCode = {
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',     // 可恢复：跳过
  PARSE_FAILED: 'PARSE_FAILED',         // 可恢复：跳过
  LLM_RATE_LIMIT: 'LLM_RATE_LIMIT',     // 可恢复：等待重试
  TIMEOUT: 'TIMEOUT',                   // 可恢复：Fork 重试（最多 3 次）
  BUDGET_EXCEEDED: 'BUDGET_EXCEEDED',   // 不可恢复：LLM 预算超限
  INVALID_REPOSITORY: 'INVALID_REPOSITORY', // 不可恢复
  NO_FILES_FOUND: 'NO_FILES_FOUND',     // 不可恢复
  LLM_API_ERROR: 'LLM_API_ERROR',       // 不可恢复
} as const;
```

### 10.2 断点续跑（块级别）

```typescript
// 块级别的检查点，支持 SemanticAgent 多块并行时单独追踪
interface Checkpoint {
  sessionId: string;
  phases: {
    [phaseName: string]: {
      status: 'pending' | 'running' | 'completed';
      items: {
        [itemId: string]: {
          status: 'pending' | 'completed' | 'failed';
          result?: AgentResult;
        }
      }
    }
  }
  createdAt: number;
}

// 示例：SemanticAgent 处理 4 个块时的检查点状态
// phases: {
//   semantic: {
//     status: 'running',
//     items: {
//       'chunk-001': { status: 'completed', result: {...} },
//       'chunk-002': { status: 'completed', result: {...} },
//       'chunk-003': { status: 'failed' },
//       'chunk-004': { status: 'pending' },
//     }
//   }
// }

class CheckpointManager {
  private checkpointFile: string;  // ~/.code-graph/checkpoints/{sessionId}.json

  save(checkpoint: Checkpoint): void;
  load(sessionId: string): Checkpoint | null;
  
  // 恢复时只重试 failed 和 pending 的块
  async resume(sessionId: string): Promise<void> {
    const checkpoint = this.load(sessionId);
    if (!checkpoint) throw new Error('No checkpoint found');

    for (const [phaseName, phase] of Object.entries(checkpoint.phases)) {
      if (phase.status !== 'completed') {
        const pendingItems = Object.entries(phase.items)
          .filter(([_, item]) => item.status === 'pending' || item.status === 'failed')
          .map(([id, _]) => id);
        
        // 只重试未完成/失败的块
        await this.retryItems(phaseName, pendingItems, checkpoint);
      }
    }
  }
}
```

## 11. 成本控制（Token 预算追踪）

### 12.1 成本追踪器

```typescript
interface LLMCostTracker {
  sessionId: string;
  totalTokens: number;
  totalCost: number;
  budget: number;  // 美元上限
  byAgent: Map<string, { tokens: number; cost: number }>;
}

// 各模型的定价（每 1K tokens）
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  opus: { input: 0.015, output: 0.075 },
  sonnet: { input: 0.003, output: 0.015 },
  haiku: { input: 0.00025, output: 0.00125 },
};

class CostTracker {
  private tracker: LLMCostTracker;

  constructor(sessionId: string, budget: number = 10.0) {
    this.tracker = {
      sessionId,
      totalTokens: 0,
      totalCost: 0,
      budget,
      byAgent: new Map(),
    };
  }

  // 检查预算是否超限
  checkBudget(): boolean {
    return this.tracker.totalCost < this.tracker.budget;
  }

  // 记录 Agent 的 token 使用
  recordUsage(agentId: string, tokens: number, model: string): void {
    // 假设 input/output 比例为 50/50
    const avgPrice = (MODEL_PRICING[model].input + MODEL_PRICING[model].output) / 2;
    const cost = (tokens * avgPrice) / 1000;

    this.tracker.totalTokens += tokens;
    this.tracker.totalCost += cost;

    const agentUsage = this.tracker.byAgent.get(agentId) || { tokens: 0, cost: 0 };
    agentUsage.tokens += tokens;
    agentUsage.cost += cost;
    this.tracker.byAgent.set(agentId, agentUsage);
  }

  // 获取当前消耗报告
  getReport(): LLMCostTracker {
    return { ...this.tracker };
  }
}
```

### 12.2 Coordinator 中的预算检查

```typescript
class Coordinator {
  private costTracker: CostTracker;

  async executeAgent(agent: BaseAgent, task: Task): Promise<AgentResult> {
    // 预检查：预算超限则抛出错误
    if (!this.costTracker.checkBudget()) {
      throw new AgentError('BUDGET_EXCEEDED', agent.id, false);
    }

    const result = await agent.execute(task);

    // 记录 token 使用（如果 Agent 返回了）
    if (result.metadata?.tokensUsed) {
      this.costTracker.recordUsage(
        agent.id,
        result.metadata.tokensUsed,
        agent.config.model ?? 'sonnet'
      );
    }

    return result;
  }
}
```

## 12. 测试策略

```
┌─────────────────────────────────────────┐
│              E2E Tests (10%)             │
│   完整仓库分析 → 验证图谱输出             │
├─────────────────────────────────────────┤
│          Integration Tests (30%)         │
│   Agent 协作、API 端点、WebSocket         │
├─────────────────────────────────────────┤
│            Unit Tests (60%)              │
│   各 Agent、Tool、GraphEngine、Cache      │
└─────────────────────────────────────────┘
```

关键测试场景：
- **单文件 AST 解析**：验证 TreeSitterTool 输出
- **Agent 并行执行**：验证 StaticAgent 和 SemanticAgent 独立运行、Merger 正确合并
- **合并优先级**：验证 EXTRACTED > INFERRED > AMBIGUOUS 的确定性合并
- **增量更新正确性**：对比全量 vs 增量结果一致性
- **错误恢复**：注入各种错误，验证恢复机制
- **可信度标注**：验证每条边都有正确的 confidence 字段
- **社区检测**：验证 Leiden 社区检测输出
- **API 端点**：验证 REST API 和 WebSocket 推送
- **成本控制**：验证预算超限时 AgentError('BUDGET_EXCEEDED') 正确抛出

## 13. 性能目标

| 场景 | 目标 | 仓库规模 |
|------|--------|-------------|
| 仅静态分析 | <30 秒 | 500 文件 |
| 完整分析（含 LLM） | <5 分钟 | 500 文件 |
| 增量更新（10% 变更） | <端到端 20% 时间 | 500 文件 |
| 单文件 AST 解析 | <100ms | 任意 |
| 社区检测（Leiden） | <10 秒 | 10,000 节点 |

**测量方法**：在 M1 MacBook Pro 上，使用 `time bun run analyze /path/to/repo` 测量端到端时间。

## 14. 技术选型汇总

| 层 | 技术 | 替换 |
|----|------|------|
| 运行时 | Bun | Python |
| 语言 | TypeScript | Python |
| Web 框架 | Fastify | FastAPI |
| 图谱引擎 | graphology | NetworkX (自定义) |
| AST 解析 | tree-sitter (WASM) | tree-sitter (Python) |
| 社区检测 | graphology-communities | 自定义 |
| LLM 客户端 | @anthropic-ai/sdk | anthropic (Python) |
| 缓存 | SHA256 + JSON 文件 | 4 层分散缓存 |
| 任务追踪 | 基于文件的任务列表 | PipelineScheduler |
| 前端 | React + Zustand | React + Zustand (保持) |
