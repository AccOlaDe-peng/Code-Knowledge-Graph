# 设计文档：业务领域子图修复与优化

**日期**：2026-03-25
**状态**：已批准（第二版，修订后）

---

## 背景

数据血缘图的业务领域视图（Business Domain View）支持双击领域节点进入该领域的子图（DomainDetailView）。当前实现存在以下问题：

1. 子图节点过滤逻辑与主图聚合逻辑不一致，导致节点大量缺失
2. `SimpleNode` 组件缺少 ReactFlow `Handle`，边连接点渲染异常
3. 双击检测用手动 300ms 计时，部分节点无法可靠进入子图
4. 进入子图后右侧面板默认空白，缺乏领域整体信息

---

## 问题根因

### 问题 1：节点过滤逻辑不一致（核心）

主图聚合（`aggregateToBusinessDomain`）使用 `extractBusinessKey` + `extractClassPrefix` + `matchNodeToDomain` 将节点分配到领域，但只处理 `BUSINESS_NODE_TYPES = ["Service", "Component", "Class", "Function"]`，**排除了 `Repository`、`DAO`、`APIEndpoint`** 等类型。

子图过滤（`DomainDetailView.domainNodes`）仅检查 `nodeId.includes('/${key}/')` 路径包含，两套逻辑双重不一致。

**修复策略**：在聚合时用宽松过滤条件收集所有业务节点（扩展白名单），并把收集到的 `nodeIds` 通过数据流传递给子图，子图直接复用，不再自行推导。

### 问题 2：`SimpleNode` 缺少 Handle

`DomainDetailView` 中自定义节点 `SimpleNode` 未声明 `Handle` 组件，ReactFlow 边无法渲染连接点。

### 问题 3：手动双击检测不可靠

`BusinessDomainView` 用 ref 手动检测 300ms 内两次 `onNodeClick` 判断双击，对时机敏感，部分节点无法稳定触发。

另：`BusinessDomainNode` 内部有展开/折叠功能（`handleToggle` + `e.stopPropagation()`），改用 ReactFlow 原生 `onNodeDoubleClick` 后需避免与折叠交互冲突。

### 问题 4：子图右侧面板默认空白

进入子图时 `DomainInfoPanel` 的 `type=null`，展示空提示。期望默认展示领域统计信息（节点总数、Service/Controller/Repository 分类计数）。

---

## 设计方案

### 数据流

```
aggregateToBusinessDomain
  ├─ 扩展白名单：包含 Repository、DAO、APIEndpoint、Controller 等
  └─ BusinessDomainNode.nodeIds: string[]  (新增：聚合时收集所有分配到本领域的节点 ID)

BusinessDomainView.onDomainDoubleClick(domainId, domain)
  └─ handleDomainDoubleClick (index.tsx)
       └─ DomainInfo { ...existing, nodeIds: domain.nodeIds }  (新增字段)
            └─ navigateToDomain(domainInfo)  (store action 接收 DomainInfo，类型扩展后自动兼容)
                 └─ selectedDomain: DomainInfo  (store 中存储)
                      └─ DomainDetailView(domain = selectedDomain)
                           ├─ domainNodeSet = new Set(domain.nodeIds)
                           ├─ domainNodes = allNodes.filter(n => domainNodeSet.has(n.id))
                           └─ domainEdges = allEdges.filter(
                                e => domainNodeSet.has(e.from) && domainNodeSet.has(e.to)
                              )  // 不限制 edge type，两端都在领域内即保留
```

### Fix 1：`domainAggregation.ts`

- `BusinessDomainNode` 新增 `nodeIds: string[]` 字段
- 扩展节点类型白名单（`BUSINESS_NODE_TYPES`），加入 `Repository`、`DAO`、`APIEndpoint`
  - 这样 `DomainInfoPanel` 中 `EXIT_NODE_TYPES` 识别的出口节点（Repository/DAO）也会出现在子图中
- 聚合循环中，每个成功分配到领域的节点 push 其 `id` 到 `domainNode.nodeIds`

### Fix 2：`lineageStore.ts`

- `DomainInfo` 新增 `nodeIds: string[]` 字段
- `navigateToDomain` action 签名不变（仍接收 `DomainInfo`），类型扩展后自动兼容

### Fix 3：`DataLineage/index.tsx`

- `handleDomainDoubleClick` 构建 `DomainInfo` 时传入 `nodeIds: domain.nodeIds`

### Fix 4：`DomainDetailView.tsx`

**节点和边过滤（两个 `useMemo` 同步改）：**
```ts
// 1. 用 nodeIds 构建集合（O(1) 查找）
const domainNodeSet = useMemo(
  () => new Set(domain.nodeIds),
  [domain.nodeIds]
);

// 2. 节点过滤（原 domainNodes + domainNodeIds 合并为一步）
const domainNodes = useMemo(
  () => allNodes.filter(n => domainNodeSet.has(n.id)),
  [allNodes, domainNodeSet]
);

// 3. 边过滤（原 domainEdges，两端都在领域内即保留，不限 edge type）
const domainEdges = useMemo(
  () => allEdges.filter(e => domainNodeSet.has(e.from) && domainNodeSet.has(e.to)),
  [allEdges, domainNodeSet]
);
```

**`SimpleNode` 添加 Handle：**
```tsx
import { Handle, Position } from "reactflow";
// 在 SimpleNode 组件的顶部和底部各加：
<Handle type="target" position={Position.Top} style={{ ... }} />
<Handle type="source" position={Position.Bottom} style={{ ... }} />
```

**右侧面板默认展示领域统计：**
- `DomainInfoPanel` 已有 `domainInfo?: DomainInfo` prop（但 `DomainDetailView` 未传入）
- 修改为：进入子图时默认传入领域统计，空状态从"点击节点查看信息"改为展示领域概览
- 改法：将 `DomainInfoPanel` 的调用从 `type={selectedNode ? "node" : null}` 改为：
  - 有选中节点时：`type="node"`，显示节点详情
  - 无选中节点时：`type="domain"`，展示从 `domain` 构建的领域统计信息（节点数、分类计数）
- 需要从 `domain` 构建一个 `DomainDescription` 对象用于渲染（复用 `BusinessDomainView` 中的 `domainDescription` 构建逻辑）

### Fix 5：`BusinessDomainView.tsx`

**双击检测改造：**
```tsx
// 删除
const lastClickTimeRef = useRef(0);
const lastClickedNodeRef = useRef<string | null>(null);

// ReactFlow 分别绑定单击和双击
<ReactFlow
  onNodeClick={handleNodeClick}           // 单击：更新 selectedDomainId 显示面板
  onNodeDoubleClick={handleNodeDoubleClick} // 双击：进入子图
  ...
/>
```

**与 `BusinessDomainNode` 展开/折叠的冲突处理：**

`BusinessDomainNode` 内部 `handleToggle` 已有 `e.stopPropagation()`，但 ReactFlow 的 `onNodeDoubleClick` 绑定在 ReactFlow 自身事件层，`stopPropagation` 在 DOM 层面无法可靠拦截。

解决方案：在 `BusinessDomainNode` 的折叠区域（`div` 标题栏）上绑定 `onDoubleClick={e => e.stopPropagation()}`，ReactFlow 的事件是从 ReactFlow 容器捕获到，如果节点内部 DOM 阻止冒泡，则 ReactFlow 的合成双击事件不会触发。此方案依赖 ReactFlow 的事件委托机制，实测有效。

---

## 涉及文件

| 文件 | 变更类型 |
|------|----------|
| `utils/domainAggregation.ts` | 扩展白名单，添加 `nodeIds` 字段，聚合时收集 |
| `store/lineageStore.ts` | `DomainInfo` 添加 `nodeIds: string[]` |
| `DataLineage/index.tsx` | `handleDomainDoubleClick` 传递 `nodeIds` |
| `components/DomainDetailView.tsx` | 用 `nodeIds` 过滤节点和边 + 加 Handle + 修复面板默认状态 |
| `components/BusinessDomainView.tsx` | 换用 `onNodeDoubleClick` + 处理折叠冲突 |

---

## 不在范围内

- 技术架构视图（ModuleView / ServiceView / DetailView）的交互改动
- 后端 API 修改
- 领域配置面板的功能变更
