# 架构图层级划分实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现架构图标准四层划分（API/业务/数据/基础设施），修复当前所有节点归入 unknown 层的问题。

**Architecture:** 采用混合策略识别层级（注解 > 包名 > 类名后缀），在后端 frontend.ts 路由中重构架构图生成逻辑。

**Tech Stack:** TypeScript, Bun, Fastify

---

## 文件结构

| 文件 | 职责 |
|-----|------|
| `code-graph-ts/src/graph/schema.ts` | 新增 LayerConfig 常量和类型定义 |
| `code-graph-ts/src/api/routes/frontend.ts` | 重构 `/graph/architecture/:repoId` 路由，实现层级检测 |
| `code-graph-ts/tests/architecture.test.ts` | 新增架构层级识别测试 |

---

### Task 1: 新增层级配置常量

**Files:**
- Modify: `code-graph-ts/src/graph/schema.ts` (文件末尾)

- [ ] **Step 1: 在 schema.ts 末尾添加 LayerConfig 常量**

在文件末尾 export 部分之前添加：

```typescript
// ── Architecture Layer Config ─────────────────────────────────

const LayerId = {
  api: 'api',
  business: 'business',
  data: 'data',
  infrastructure: 'infrastructure',
} as const;

type LayerId = (typeof LayerId)[keyof typeof LayerId];

const LayerConfig = {
  api: { name: 'API 层', color: '#00d4ff' },
  business: { name: '业务层', color: '#00f084' },
  data: { name: '数据层', color: '#ffc145' },
  infrastructure: { name: '基础设施层', color: '#ff6b9d' },
} as const;
```

- [ ] **Step 2: 在 export 块中导出新常量**

在文件末尾的 export 块中添加：

```typescript
export {
  // ... existing exports ...
  LayerId,
  LayerConfig,
};

export type {
  // ... existing type exports ...
  LayerId as LayerIdType,
};
```

- [ ] **Step 3: 提交更改**

```bash
git add code-graph-ts/src/graph/schema.ts
git commit -m "feat: 新增架构层级配置常量 LayerConfig"
```

---

### Task 2: 实现层级检测函数

**Files:**
- Modify: `code-graph-ts/src/api/routes/frontend.ts` (文件顶部 import 之后)

- [ ] **Step 1: 在 frontend.ts 顶部添加 import**

在现有 import 语句后添加：

```typescript
import { LayerId, LayerConfig, type GraphNode, type GraphData } from '../../graph/schema.ts';
```

- [ ] **Step 2: 添加 detectLayer 函数**

在 import 语句之后、路由定义之前添加：

```typescript
// ── Architecture Layer Detection ─────────────────────────────────

function detectLayer(node: GraphNode): LayerId {
  // 1. 注解检测（最高优先级）
  const annotations = (node.metadata?.annotations as string[] | undefined) ?? [];
  if (annotations.some(a => /Controller|RestController|Endpoint/.test(a))) return LayerId.api;
  if (annotations.some(a => /Service|Component/.test(a))) return LayerId.business;
  if (annotations.some(a => /Repository|Dao|Mapper/.test(a))) return LayerId.data;

  // 2. 包名检测
  const pkg = node.file.replace(/\\/g, '/');
  if (/\/(controller|endpoint|api|rest)\//.test(pkg)) return LayerId.api;
  if (/\/(service|biz|business|facade)\//.test(pkg)) return LayerId.business;
  if (/\/(repository|dao|mapper)\//.test(pkg)) return LayerId.data;
  if (/\/(config|util|helper|common|constant)\//.test(pkg)) return LayerId.infrastructure;

  // 3. 类名后缀检测
  if (/Controller$|Endpoint$|Api$/.test(node.label)) return LayerId.api;
  if (/Service$|Facade$|Manager$/.test(node.label)) return LayerId.business;
  if (/Repository$|Dao$|Mapper$/.test(node.label)) return LayerId.data;

  // 4. 兜底规则
  return LayerId.infrastructure;
}
```

- [ ] **Step 3: 提交更改**

```bash
git add code-graph-ts/src/api/routes/frontend.ts
git commit -m "feat: 实现 detectLayer 层级检测函数"
```

---

### Task 3: 重构架构图路由逻辑

**Files:**
- Modify: `code-graph-ts/src/api/routes/frontend.ts:629-652`

- [ ] **Step 1: 替换原有的层级分组逻辑**

将第 629-652 行的代码替换为：

```typescript
      const nodes = graph.nodes;
      const edges = graph.edges;

      // 初始化四层结构
      const layerNodes: Record<LayerId, ArchitectureNode[]> = {
        [LayerId.api]: [],
        [LayerId.business]: [],
        [LayerId.data]: [],
        [LayerId.infrastructure]: [],
      };

      // 构建节点 ID 到节点对象的映射（用于提取方法）
      const nodeMap = new Map<string, GraphNode>();
      for (const node of nodes) {
        nodeMap.set(node.id, node);
      }

      // 遍历节点，分配层级
      for (const node of nodes) {
        if (node.type !== 'Class' && node.type !== 'Interface') continue;

        const layerId = detectLayer(node);
        const archNode: ArchitectureNode = {
          id: node.id,
          name: node.label,
          type: node.type.toLowerCase() as 'class' | 'interface',
          file: node.file,
        };

        // 提取该类的方法（通过 defines 边）
        const methods = edges
          .filter(e => e.source === node.id && e.type === 'defines')
          .map(e => nodeMap.get(e.target)?.label)
          .filter((m): m is string => Boolean(m))
          .slice(0, 10); // 最多展示 10 个方法

        if (methods.length > 0) {
          archNode.methods = methods;
        }

        layerNodes[layerId].push(archNode);
      }

      // 构建层级数据
      const layers = Object.entries(LayerConfig).map(([id, config]) => ({
        id,
        name: config.name,
        color: config.color,
        nodes: layerNodes[id as LayerId],
      }));

      // 过滤架构相关边
      const archEdges = edges
        .filter(e => e.type === 'calls' || e.type === 'depends_on')
        .map(e => ({
          from: e.source,
          to: e.target,
          type: e.type,
        }));

      // 统计信息
      const stats = {
        total_nodes: nodes.length,
        total_edges: edges.length,
        by_layer: {
          api: layerNodes[LayerId.api].length,
          business: layerNodes[LayerId.business].length,
          data: layerNodes[LayerId.data].length,
          infrastructure: layerNodes[LayerId.infrastructure].length,
        },
      };

      return {
        repo_id: repoId,
        layers,
        edges: archEdges,
        stats,
      };
```

- [ ] **Step 2: 在文件顶部添加 ArchitectureNode 类型定义**

在 detectLayer 函数之前添加：

```typescript
interface ArchitectureNode {
  id: string;
  name: string;
  type: 'class' | 'interface';
  file: string;
  methods?: string[];
}
```

- [ ] **Step 3: 提交更改**

```bash
git add code-graph-ts/src/api/routes/frontend.ts
git commit -m "feat: 重构架构图路由，实现四层架构分组"
```

---

### Task 4: 新增架构层级测试

**Files:**
- Create: `code-graph-ts/tests/architecture.test.ts`

- [ ] **Step 1: 创建测试文件**

```typescript
import { describe, it, expect } from 'bun:test';
import { detectLayer, LayerId } from '../src/api/routes/frontend.ts';
import type { GraphNode } from '../src/graph/schema.ts';

// 导出 detectLayer 用于测试（需要在 frontend.ts 底部添加 export）
// 此测试假设 detectLayer 已导出

describe('detectLayer', () => {
  const makeNode = (label: string, file: string, annotations?: string[]): GraphNode => ({
    id: `test:${label}`,
    label,
    type: 'Class',
    file,
    metadata: annotations ? { annotations } : {},
  });

  it('识别 @Controller 注解为 API 层', () => {
    const node = makeNode('UserController', '/src/controller/UserController.java', ['@Controller', '@RequestMapping']);
    expect(detectLayer(node)).toBe(LayerId.api);
  });

  it('识别 @Service 注解为业务层', () => {
    const node = makeNode('UserService', '/src/service/UserService.java', ['@Service']);
    expect(detectLayer(node)).toBe(LayerId.business);
  });

  it('识别 @Repository 注解为数据层', () => {
    const node = makeNode('UserRepository', '/src/repository/UserRepository.java', ['@Repository']);
    expect(detectLayer(node)).toBe(LayerId.data);
  });

  it('通过包名识别 API 层', () => {
    const node = makeNode('OrderApi', '/src/api/rest/OrderApi.java');
    expect(detectLayer(node)).toBe(LayerId.api);
  });

  it('通过包名识别业务层', () => {
    const node = makeNode('PaymentFacade', '/src/facade/PaymentFacade.java');
    expect(detectLayer(node)).toBe(LayerId.business);
  });

  it('通过包名识别数据层', () => {
    const node = makeNode('ProductDao', '/src/dao/ProductDao.java');
    expect(detectLayer(node)).toBe(LayerId.data);
  });

  it('通过类名后缀识别 API 层', () => {
    const node = makeNode('HealthEndpoint', '/src/misc/HealthEndpoint.java');
    expect(detectLayer(node)).toBe(LayerId.api);
  });

  it('通过类名后缀识别业务层', () => {
    const node = makeNode('CacheManager', '/src/misc/CacheManager.java');
    expect(detectLayer(node)).toBe(LayerId.business);
  });

  it('未匹配节点归入基础设施层', () => {
    const node = makeNode('StringUtils', '/src/misc/StringUtils.java');
    expect(detectLayer(node)).toBe(LayerId.infrastructure);
  });
});
```

- [ ] **Step 2: 在 frontend.ts 底部导出 detectLayer 函数**

在文件末尾添加：

```typescript
export { detectLayer };
```

- [ ] **Step 3: 运行测试验证失败**

```bash
cd code-graph-ts && bun test tests/architecture.test.ts
```

Expected: 测试通过（detectLayer 已实现）

- [ ] **Step 4: 提交更改**

```bash
git add code-graph-ts/tests/architecture.test.ts code-graph-ts/src/api/routes/frontend.ts
git commit -m "test: 新增架构层级识别测试"
```

---

### Task 5: 集成测试验证

**Files:**
- N/A (手动测试)

- [ ] **Step 1: 启动后端服务**

```bash
cd code-graph-ts && bun start
```

- [ ] **Step 2: 测试架构图 API**

```bash
curl -s "http://localhost:8848/graph/architecture/adms_moy22l2c" | jq '.stats'
```

Expected: 返回包含 `by_layer` 统计信息，显示四个层级的节点数量

- [ ] **Step 3: 验证层级分布**

```bash
curl -s "http://localhost:8848/graph/architecture/adms_moy22l2c" | jq '.layers[].nodes | length'
```

Expected: 四个层级都有节点分布，不再全是 unknown

- [ ] **Step 4: 前端验证**

访问 http://localhost:5173/architecture?repo_id=adms_moy22l2c，确认架构图正确展示四层结构

---

### Task 6: 最终提交

- [ ] **Step 1: 确认所有测试通过**

```bash
cd code-graph-ts && bun test
```

- [ ] **Step 2: 确认代码格式**

```bash
cd code-graph-ts && bun run lint
```

- [ ] **Step 3: 推送更改**

```bash
git push origin dev/v3
```

---

## 自检清单

- [x] Spec 覆盖：所有设计文档要求都对应了任务
- [x] 无占位符：每个步骤都有完整代码
- [x] 类型一致：LayerId、ArchitectureNode 在各任务中定义一致
