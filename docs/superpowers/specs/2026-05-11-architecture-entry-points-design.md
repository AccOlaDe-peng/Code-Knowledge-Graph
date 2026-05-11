# 架构图入口节点精简设计

**日期**: 2026-05-11
**状态**: 待实现

---

## 问题背景

当前架构图展示所有 Class/Interface 节点，导致：
- 大型仓库节点数量过多，视觉拥挤
- 难以快速识别系统核心结构
- 缺乏节点功能说明，理解成本高

---

## 目标

1. 精简架构图节点，仅展示入口节点（对外的关键类）
2. 为每个节点提供功能说明，便于理解其职责

---

## 设计方案

### 1. 入口节点判断规则

每个节点通过两个条件判断是否为入口节点（满足任一即可）：

**条件 A：跨层调用**
- 节点被其他层的节点通过 `calls` 或 `depends_on` 边调用

**条件 B：特定注解**

| 层级 | 入口注解 |
|------|---------|
| API | `@Controller`, `@RestController`, `@Endpoint`, `@RequestMapping` |
| 业务 | `@Service`, `@Component`, `@Facade` |
| 数据 | `@Repository`, `@Dao`, `@Mapper` |
| 基础设施 | 无特定注解（仅靠跨层调用判断） |

**示例判断：**

```
UserController (API层)
  ├─ 有 @RestController 注解 → 入口节点 ✓

UserServiceImpl (业务层)
  ├─ 有 @Service 注解 → 入口节点 ✓
  └─ 被 UserController 调用（跨层） → 也满足

UserRepository (数据层)
  ├─ 有 @Repository 注解 → 入口节点 ✓

UserMapperHelper (数据层，无注解)
  └─ 仅被 UserRepository 内部调用 → 非入口节点 ✗
```

---

### 2. 功能说明获取

**优先级顺序：**

```
1. 类注释摘要（最高优先级）
   └── 提取 Javadoc/JSDoc 首行非空文本

2. 关键方法名展示（备选）
   └── 无注释时，展示 2-3 个代表性方法名
```

**注释提取规则：**

| 语言 | 注释格式 | 提取逻辑 |
|------|---------|---------|
| Java | `/** ... */` | 提取首行 `@summary` 或第一句描述（截至 `.` 或 `。`） |
| TypeScript | `/** ... */` | 同 Java |
| Python | `""" ... """` 或类前 `#` 注释 | 提取首行描述 |
| Go | 类前 `//` 注释块 | 提取首行 |

**关键方法筛选规则：**

```typescript
// 篮选优先级
1. 公开方法（public 前缀）
2. 业务语义方法名（get*, save*, update*, delete*, process*, handle*）
3. 取前 3 个展示

// 示例
methods: ['getUser', 'saveUser', 'deleteUser', 'internalHelper']
// 展示: "getUser, saveUser, deleteUser"
```

---

### 3. 数据结构扩展

```typescript
// ArchitectureNode 新增字段
interface ArchitectureNode {
  id: string
  name: string
  displayName: string
  description?: string      // 功能说明（注释提取）
  isEntryPoint?: boolean    // 入口节点标记
  keyMethods?: string[]     // 关键方法展示（备选）
  source?: string
  functions?: string[]
  dependencies?: string[]
  endpoints?: string[]
  attributes?: string[]
}
```

---

## 实现细节

### 后端实现

**修改文件：**

| 文件 | 修改内容 |
|------|---------|
| `code-graph-ts/src/agents/tools/TreeSitterTool.ts` | 扩展 AST 提取，增加 `annotations` 和 `docComment` 字段 |
| `code-graph-ts/src/api/routes/frontend.ts` | 修改 `/graph/architecture/:repoId` 端点，添加入口节点筛选逻辑 |
| `code-graph-ts/src/graph/schema.ts` | 扩展 `ArchitectureNode` 类型定义 |

#### Step 0: 扩展 TreeSitterTool 提取注解和注释

当前 `TreeSitterTool` 的 `metadata` 为空对象，需要补充提取逻辑：

```typescript
// TreeSitterTool.ts 新增提取函数

// 提取 Java 注解
function extractJavaAnnotations(node: any): string[] {
  const annotations: string[] = [];
  // 遍历 modifiers 中的 annotation 节点
  for (const child of node.children ?? []) {
    if (child.type === 'marker_annotation') {
      annotations.push(child.text); // @Service
    } else if (child.type === 'annotation') {
      annotations.push(child.childForFieldName('name')?.text ?? child.text);
    }
  }
  return annotations;
}

// 提取类注释
function extractDocComment(node: any, sourceCode: string): string | null {
  // 类声明前一个兄弟节点可能是 comment
  const prevSibling = node.previousSibling;
  if (prevSibling?.type === 'block_comment' || prevSibling?.type === 'comment') {
    return prevSibling.text;
  }
  return null;
}

// 在 extractClassLike 函数中填充 metadata
metadata: {
  annotations: extractJavaAnnotations(node),
  docComment: extractDocComment(node, sourceCode),
}
```

**支持的语言：**

| 语言 | 注解提取 | 注释提取 |
|------|---------|---------|
| Java | `@Service`, `@Controller` 等 | `/** ... */` |
| TypeScript | 装饰器 `@Controller` 等 | `/** ... */` |
| Python | 装饰器 `@dataclass` 等 | `""" ... """` |

**实现流程：**

```
1. 加载图谱数据（现有逻辑）
      ↓
2. 遍历节点，执行层级检测（现有 detectLayer）
      ↓
3. 构建跨层调用关系图
   - 遍历 edges，记录每个节点的调用者层级
   - 判断调用者是否来自其他层
      ↓
4. 标记入口节点
   - 检查注解（metadata.annotations）
   - 检查跨层调用
   - 设置 isEntryPoint = true
      ↓
5. 提取功能说明
   - 从 metadata.docComment 提取注释摘要
   - 无注释时从 methods 筛选关键方法
      ↓
6. 过滤非入口节点
   - 仅返回 isEntryPoint = true 的节点
      ↓
7. 返回精简后的架构数据
```

**核心函数：**

```typescript
// 判断是否为入口节点
function isEntryPoint(
  node: GraphNode,
  crossLayerCallers: Map<string, Set<LayerId>>,
  nodeLayer: LayerId
): boolean {
  // 条件 1: 特定注解
  const annotations = (node.metadata?.annotations as string[]) ?? []
  const entryAnnotations: Record<LayerId, RegExp[]> = {
    [LayerId.api]: [/Controller/, /RestController/, /Endpoint/],
    [LayerId.business]: [/Service/, /Component/, /Facade/],
    [LayerId.data]: [/Repository/, /Dao/, /Mapper/],
    [LayerId.infrastructure]: [],
  }

  const layerPatterns = entryAnnotations[nodeLayer] ?? []
  if (annotations.some(a => layerPatterns.some(p => p.test(a)))) {
    return true
  }

  // 条件 2: 跨层调用
  const callers = crossLayerCallers.get(node.id)
  if (callers && [...callers].some(callerLayer => callerLayer !== nodeLayer)) {
    return true
  }

  return false
}

// 提取功能说明
function extractDescription(node: GraphNode, methods: string[]): {
  description?: string
  keyMethods?: string[]
} {
  // 优先从注释提取
  const docComment = node.metadata?.docComment as string | undefined
  if (docComment) {
    const summary = extractDocSummary(docComment)
    if (summary) {
      return { description: summary }
    }
  }

  // 备选: 关键方法名
  const keyMethods = filterKeyMethods(methods)
  if (keyMethods.length > 0) {
    return { keyMethods: keyMethods.slice(0, 3) }
  }

  return {}
}

// 提取注释摘要
function extractDocSummary(docComment: string): string | null {
  // 提取 @summary 标签
  const summaryMatch = docComment.match(/@summary\s+(.+)/)
  if (summaryMatch) {
    return summaryMatch[1].trim()
  }

  // 提取首行描述（截至句号）
  const lines = docComment.split('\n').filter(l => l.trim() && !l.startsWith('@'))
  if (lines.length > 0) {
    const firstLine = lines[0].trim()
    const sentenceEnd = firstLine.search(/[.。]/)
    if (sentenceEnd > 0) {
      return firstLine.slice(0, sentenceEnd + 1)
    }
    return firstLine.slice(0, 50) // 限制长度
  }

  return null
}

// 篮选关键方法
function filterKeyMethods(methods: string[]): string[] {
  const businessPatterns = /^(get|save|update|delete|process|handle|create|find|query)/i
  return methods.filter(m => businessPatterns.test(m))
}
```

---

### 前端实现

**修改文件：**

| 文件 | 修改内容 |
|------|---------|
| `code-graph-ui/src/components/graph/LayeredArchitecture/NodeCard.tsx` | 调整节点卡片样式，展示功能说明 |
| `code-graph-ui/src/types/architecture.ts` | 扩展 `ArchitectureNode` 类型定义 |

**节点卡片展示布局：**

```
┌─────────────────────────────────────┐
│  UserController                       │  ← displayName（加粗）
│  ─────────────────────────────────── │
│  用户登录、注册和权限校验接口           │  ← description（新增）
│  ─────────────────────────────────── │
│  [GET] /api/users  [POST] /api/login  │  ← endpoints（如有）
└─────────────────────────────────────┘

无 description 时展示 keyMethods：

┌─────────────────────────────────────┐
│  UserRepository                      │  ← displayName（加粗）
│  ─────────────────────────────────── │
│  findById, save, delete              │  ← keyMethods（新增）
│  ─────────────────────────────────── │
│  3 functions                          │  ← 现有标签
└─────────────────────────────────────┘
```

**NodeCard 组件修改要点：**

```tsx
// 展示优先级
const renderDescription = () => {
  // 1. 功能说明（注释提取）
  if (node.description) {
    return (
      <div style={{ fontSize: 11, color: 'var(--t-secondary)', marginTop: 4 }}>
        {node.description}
      </div>
    )
  }

  // 2. 关键方法名（备选）
  if (node.keyMethods?.length) {
    return (
      <div style={{ fontSize: 11, color: 'var(--t-muted)', marginTop: 4 }}>
        {node.keyMethods.join(', ')}
      </div>
    )
  }

  return null
}
```

---

## 测试验证

### 单元测试

1. `isEntryPoint` 函数测试
   - 有注解的节点返回 true
   - 有跨层调用的节点返回 true
   - 内部辅助类返回 false

2. `extractDocSummary` 函数测试
   - 提取 `@summary` 标签
   - 提取首句描述
   - 无注释返回 null

3. `filterKeyMethods` 函数测试
   - 筛选业务语义方法名
   - 忽略私有/辅助方法

### 集成测试

1. 分析已知仓库，验证架构图节点数量减少
2. 检查入口节点是否正确标记
3. 检查功能说明是否正确展示

---

## 边界情况

1. **无入口节点的层** → 该层显示为空（保留层标题）
2. **注释为空或格式不规范** → 使用 keyMethods 备选
3. **无业务语义方法名** → 不展示功能说明，仅显示节点名
4. **基础设施层节点** → 仅通过跨层调用判断，可能较多或较少

---

## 后续扩展（不在当前范围）

1. 点击入口节点展开查看该层详细节点
2. 前端参数控制精简级别（入口节点 / 全量节点）
3. 节点功能说明支持多语言