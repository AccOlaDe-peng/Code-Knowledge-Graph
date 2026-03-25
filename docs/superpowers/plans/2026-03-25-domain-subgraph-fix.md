# 业务领域子图修复 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复业务领域视图双击进入子图后节点缺失、边连接异常、双击不可靠、面板空白四个问题。

**Architecture:** 在聚合阶段收集每个领域实际包含的 `nodeIds`，通过 `DomainInfo` 向下游传递，子图直接复用这个集合过滤节点和边，消除两套不一致的过滤逻辑；同时修复 ReactFlow 事件绑定和节点 Handle 缺失。

**Tech Stack:** React 19 + TypeScript + ReactFlow + Zustand（前端，无单元测试框架）

---

## 文件变更清单

| 文件 | 操作 | 改动说明 |
|------|------|----------|
| `src/pages/DataLineage/utils/domainAggregation.ts` | 修改 | 扩展白名单，`BusinessDomainNode` 加 `nodeIds` 字段，聚合时收集 |
| `src/store/lineageStore.ts` | 修改 | `DomainInfo` 加 `nodeIds: string[]` |
| `src/pages/DataLineage/index.tsx` | 修改 | `handleDomainDoubleClick` 传递 `nodeIds` |
| `src/pages/DataLineage/components/DomainDetailView.tsx` | 修改 | 用 `nodeIds` 过滤节点和边，加 Handle，修复面板默认状态 |
| `src/pages/DataLineage/components/BusinessDomainView.tsx` | 修改 | 换用 `onNodeDoubleClick` |
| `src/pages/DataLineage/components/BusinessDomainNode.tsx` | 修改 | 标题栏加 `onDoubleClick` stopPropagation |

---

## Chunk 1: 数据模型与聚合层

### Task 1: 扩展 `BusinessDomainNode` 并在聚合时收集 `nodeIds`

**Files:**
- Modify: `code-graph-ui/src/pages/DataLineage/utils/domainAggregation.ts`

**背景：** `BusinessDomainNode` 接口目前没有 `nodeIds` 字段；`aggregateToBusinessDomain` 的 `BUSINESS_NODE_TYPES` 白名单只包含 `Service/Component/Class/Function`，排除了 `Repository` 和 `DAO` 等类型，导致子图过滤不到这些节点。

- [ ] **Step 1: 在 `BusinessDomainNode` 接口中新增 `nodeIds` 字段**

  打开 `code-graph-ui/src/pages/DataLineage/utils/domainAggregation.ts`，找到 `BusinessDomainNode` 接口（约第 24 行），在末尾新增一个字段：

  ```ts
  export interface BusinessDomainNode {
    id: string;
    key: string;
    name: string;
    color: string;
    nodeCount: number;
    services: NodeSummary[];
    controllers: NodeSummary[];
    repositories: NodeSummary[];
    inModules: string[];
    databases: string[];
    nodeIds: string[];   // ← 新增：属于本领域的所有节点 ID
  }
  ```

- [ ] **Step 2: 扩展 `BUSINESS_NODE_TYPES` 白名单**

  找到约第 270 行的常量定义，改为：

  ```ts
  const BUSINESS_NODE_TYPES = new Set([
    "Service",
    "Component",
    "Class",
    "Function",
    "Repository",   // ← 新增
    "DAO",          // ← 新增
    "APIEndpoint",  // ← 新增
  ]);
  ```

- [ ] **Step 3: 初始化 `domainNode` 时加入 `nodeIds: []`**

  在 `aggregateToBusinessDomain` 内部，找到初始化 `domainNodes` 的代码（约第 355-368 行）：

  ```ts
  domainNodes.set(domainId, {
    id: domainId,
    key: domainDef?.key || "",
    name: domainDef?.name || domainId,
    color: domainDef?.color || DOMAIN_COLORS[domainNodes.size % DOMAIN_COLORS.length],
    nodeCount: 0,
    services: [],
    controllers: [],
    repositories: [],
    inModules: [],
    databases: [],
    nodeIds: [],   // ← 新增
  });
  ```

- [ ] **Step 4: 聚合循环中 push nodeId**

  在同一函数内，找到 `domainNode.nodeCount++` 的下方（约第 372 行），加一行：

  ```ts
  domainNode.nodeCount++;
  domainNode.nodeIds.push(nodeId);   // ← 新增
  ```

- [ ] **Step 5: 处理 `Repository` 节点的分类**

  白名单扩展后，`Repository` 类型的节点会进入聚合循环，但原来的分类逻辑没有 `nodeType === "Repository"` 的 case（`DAO` 同理）。找到约第 388-406 行的节点分类代码，补充这两个类型：

  ```ts
  if (nodeType === "Service") {
    domainNode.services.push(nodeSummary);
  } else if (nodeType === "Component") {
    const annotations = (node.properties?.annotations as string[]) || [];
    if (annotations.includes("@RestController") || annotations.includes("@Controller")) {
      domainNode.controllers.push(nodeSummary);
    }
  } else if (nodeType === "Class" || nodeType === "Repository" || nodeType === "DAO") {
    // ↑ 将 Repository/DAO 也纳入 repositories 统计
    const name = nodeName.toLowerCase();
    if (
      name.includes("repository") ||
      name.includes("mapper") ||
      name.includes("dao") ||
      nodeType === "Repository" ||   // ← 新增：类型本身是 Repository 直接归入
      nodeType === "DAO"             // ← 新增
    ) {
      domainNode.repositories.push(nodeSummary);
    }
  } else if (nodeType === "APIEndpoint") {
    // APIEndpoint 视为 controller 类型
    domainNode.controllers.push(nodeSummary);
  }
  ```

- [ ] **Step 6: 验证 TypeScript 编译通过**

  ```bash
  cd code-graph-ui && npm run build 2>&1 | head -30
  ```

  预期：无 TypeScript 错误（可能有其他不相关的 warning，忽略即可）。

- [ ] **Step 7: 提交**

  ```bash
  cd code-graph-ui
  git add src/pages/DataLineage/utils/domainAggregation.ts
  git commit -m "feat: 扩展领域聚合白名单，BusinessDomainNode 新增 nodeIds 字段"
  ```

---

### Task 2: 在 `DomainInfo` 中传递 `nodeIds`

**Files:**
- Modify: `code-graph-ui/src/store/lineageStore.ts`
- Modify: `code-graph-ui/src/pages/DataLineage/index.tsx`

**背景：** `DomainInfo` 是从 `BusinessDomainNode` 转换而来并存入 Zustand Store 的精简格式，`DomainDetailView` 从 Store 取出后使用。需要在这条链路上带上 `nodeIds`。

- [ ] **Step 1: `DomainInfo` 接口新增 `nodeIds` 字段**

  打开 `code-graph-ui/src/store/lineageStore.ts`，找到 `DomainInfo` 接口（约第 71 行），新增字段：

  ```ts
  export interface DomainInfo {
    id: string;
    key: string;
    name: string;
    color: string;
    nodeCount: number;
    serviceCount: number;
    controllerCount: number;
    repositoryCount: number;
    crossDomainCalls: number;
    nodeIds: string[];   // ← 新增
  }
  ```

- [ ] **Step 2: `handleDomainDoubleClick` 传入 `nodeIds`**

  打开 `code-graph-ui/src/pages/DataLineage/index.tsx`，找到 `handleDomainDoubleClick`（约第 137 行），在构建 `DomainInfo` 对象时加入：

  ```ts
  const domainInfo: DomainInfo = {
    id: domain.id,
    key: domain.key,
    name: domain.name,
    color: domain.color,
    nodeCount: domain.nodeCount,
    serviceCount: domain.services.length,
    controllerCount: domain.controllers.length,
    repositoryCount: domain.repositories.length,
    crossDomainCalls: 0,
    nodeIds: domain.nodeIds,   // ← 新增
  };
  ```

- [ ] **Step 3: 验证 TypeScript 编译通过**

  ```bash
  cd code-graph-ui && npm run build 2>&1 | head -30
  ```

  预期：无新增 TypeScript 错误。`BusinessDomainView.tsx` 中的 `domainInfo` 对象（约第 138-150 行）也使用了 `DomainInfo` 类型，同样需要补上 `nodeIds`。检查该文件：

  ```bash
  grep -n "nodeIds\|DomainInfo" code-graph-ui/src/pages/DataLineage/components/BusinessDomainView.tsx
  ```

  如果 `BusinessDomainView.tsx` 中构建 `DomainInfo` 的代码报 TypeScript 错误（缺少 `nodeIds` 字段），在该文件约第 138-150 行补上：

  ```ts
  const domainInfo: DomainInfo | undefined = selectedDomain
    ? {
        id: selectedDomain.id,
        key: selectedDomain.key,
        name: selectedDomain.name,
        color: selectedDomain.color,
        nodeCount: selectedDomain.nodeCount,
        serviceCount: selectedDomain.services.length,
        controllerCount: selectedDomain.controllers.length,
        repositoryCount: selectedDomain.repositories.length,
        crossDomainCalls: 0,
        nodeIds: selectedDomain.nodeIds,   // ← 新增
      }
    : undefined;
  ```

- [ ] **Step 4: 再次验证编译**

  ```bash
  cd code-graph-ui && npm run build 2>&1 | head -30
  ```

  预期：无 TypeScript 错误。

- [ ] **Step 5: 提交**

  ```bash
  cd code-graph-ui
  git add src/store/lineageStore.ts src/pages/DataLineage/index.tsx src/pages/DataLineage/components/BusinessDomainView.tsx
  git commit -m "feat: DomainInfo 新增 nodeIds 字段，handleDomainDoubleClick 传递 nodeIds"
  ```

---

## Chunk 2: DomainDetailView 修复

### Task 3: 用 `nodeIds` 替换子图节点/边过滤逻辑

**Files:**
- Modify: `code-graph-ui/src/pages/DataLineage/components/DomainDetailView.tsx`

**背景：** 目前 `domainNodes` 用 `nodeId.includes('/${key}/')` 路径字符串过滤，与聚合逻辑不一致，导致节点缺失。需要改为直接使用 `domain.nodeIds` 集合。

- [ ] **Step 1: 新增 `domainNodeSet` 的 `useMemo`，替换 `domainNodes` 计算逻辑**

  打开 `code-graph-ui/src/pages/DataLineage/components/DomainDetailView.tsx`，找到约第 242-265 行的两个 `useMemo`：

  ```ts
  // 当前代码（需要替换）
  const domainNodes = useMemo(() => {
    const keys = [domain.key].map((k) => k.toLowerCase());
    return allNodes.filter((node) => {
      const nodeId = node.id.toLowerCase();
      for (const key of keys) {
        if (nodeId.includes(`/${key}/`) || nodeId.includes(`\\${key}\\`)) {
          return true;
        }
      }
      return false;
    });
  }, [allNodes, domain.key]);

  const domainNodeIds = useMemo(
    () => new Set(domainNodes.map((n) => n.id)),
    [domainNodes]
  );
  ```

  将这两个 `useMemo` 替换为：

  ```ts
  // 直接用聚合阶段确定的 nodeIds 集合，不再自行推导
  const domainNodeSet = useMemo(
    () => new Set(domain.nodeIds),
    [domain.nodeIds]
  );

  const domainNodes = useMemo(
    () => allNodes.filter((n) => domainNodeSet.has(n.id)),
    [allNodes, domainNodeSet]
  );
  ```

- [ ] **Step 2: 更新 `domainEdges` 改用 `domainNodeSet`**

  找到约第 261-265 行的 `domainEdges`：

  ```ts
  // 当前代码
  const domainEdges = useMemo(() => {
    return allEdges.filter(
      (edge) => domainNodeIds.has(edge.from) && domainNodeIds.has(edge.to)
    );
  }, [allEdges, domainNodeIds]);
  ```

  改为：

  ```ts
  const domainEdges = useMemo(
    () => allEdges.filter((e) => domainNodeSet.has(e.from) && domainNodeSet.has(e.to)),
    [allEdges, domainNodeSet]
  );
  ```

- [ ] **Step 3: 移除不再使用的 `domain.key` 依赖（如有 lint 警告）**

  检查文件中是否还有其他地方使用旧的 `domainNodeIds` 变量名，如有则统一改为 `domainNodeSet`：

  ```bash
  grep -n "domainNodeIds" code-graph-ui/src/pages/DataLineage/components/DomainDetailView.tsx
  ```

  如果有结果，逐一替换为 `domainNodeSet`。

- [ ] **Step 4: 编译验证**

  ```bash
  cd code-graph-ui && npm run build 2>&1 | head -30
  ```

  预期：无 TypeScript 错误。

- [ ] **Step 5: 提交**

  ```bash
  cd code-graph-ui
  git add src/pages/DataLineage/components/DomainDetailView.tsx
  git commit -m "fix: DomainDetailView 改用 nodeIds 集合过滤子图节点和边"
  ```

---

### Task 4: 给 `SimpleNode` 加 Handle，修复右侧面板默认状态

**Files:**
- Modify: `code-graph-ui/src/pages/DataLineage/components/DomainDetailView.tsx`

**背景：**
1. `SimpleNode` 自定义节点没有 `Handle` 组件，ReactFlow 的边无法渲染连接点
2. 进入子图后右侧面板 `DomainInfoPanel` 因 `type=null` 显示空白，应默认展示领域统计

- [ ] **Step 1: 在 `SimpleNode` 中导入并添加 Handle**

  在文件顶部 reactflow 导入语句中，加入 `Handle` 和 `Position`（如果还没有的话）：

  ```ts
  import ReactFlow, {
    // ...已有的导入...
    Handle,      // ← 确保已导入
    Position,    // ← 确保已导入
    // ...
  } from "reactflow";
  ```

  找到 `SimpleNode` 组件返回的 JSX（约第 90-168 行），在根 `<div>` 的内部末尾加入两个 Handle：

  ```tsx
  return (
    <div style={{ ... }}>
      {/* 现有内容保持不变... */}

      {/* 新增：连接点 */}
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: color, width: 5, height: 5, border: "none", top: -3 }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: color, width: 5, height: 5, border: "none", bottom: -3 }}
      />
    </div>
  );
  ```

  注意：`color` 变量在 `SimpleNode` 内已有定义（`const color = getNodeColor()`），直接复用。

- [ ] **Step 2: 修复右侧面板默认状态**

  找到约第 610-626 行的 `DomainInfoPanel` 调用：

  ```tsx
  // 当前代码
  <DomainInfoPanel
    type={selectedNode ? "node" : null}
    data={nodeDetail}
    loading={false}
    onViewDetail={handleViewDetail}
  />
  ```

  在 `DomainDetailView` 组件内，先构建一个领域描述对象（用于面板默认显示），然后修改 `DomainInfoPanel` 的 props：

  ```tsx
  // 在 return 语句之前（useMemo 区域），新增领域描述
  const defaultDomainDescription = useMemo(() => ({
    domainId: domain.id,
    summary: `${domain.name} 包含 ${domain.nodeCount} 个节点，涵盖 ${domain.serviceCount} 个服务。`,
    coreServices: [],
    dataFlowPattern: "Controller → Service → Repository",
    generatedAt: new Date().toISOString(),
    confidence: 0.85,
  }), [domain]);

  // 构建传给面板的 domainInfo（用于统计展示）
  const domainInfoForPanel = useMemo(() => ({
    id: domain.id,
    key: domain.key,
    name: domain.name,
    color: domain.color,
    nodeCount: domain.nodeCount,
    serviceCount: domain.serviceCount,
    controllerCount: domain.controllerCount,
    repositoryCount: domain.repositoryCount,
    crossDomainCalls: domain.crossDomainCalls,
    nodeIds: domain.nodeIds,
  }), [domain]);
  ```

  然后修改 `DomainInfoPanel` 的调用：

  ```tsx
  <DomainInfoPanel
    type={selectedNode ? "node" : "domain"}
    data={selectedNode ? nodeDetail : defaultDomainDescription}
    domainInfo={!selectedNode ? domainInfoForPanel : undefined}
    loading={false}
    onViewDetail={handleViewDetail}
  />
  ```

- [ ] **Step 3: 编译验证**

  ```bash
  cd code-graph-ui && npm run build 2>&1 | head -30
  ```

  预期：无 TypeScript 错误。如有类型报错，检查 `DomainDescription` 接口（在 `lineageStore.ts` 第 83-90 行）与 `defaultDomainDescription` 对象字段是否匹配。

- [ ] **Step 4: 提交**

  ```bash
  cd code-graph-ui
  git add src/pages/DataLineage/components/DomainDetailView.tsx
  git commit -m "fix: SimpleNode 添加 Handle，子图右侧面板默认展示领域统计"
  ```

---

## Chunk 3: 双击事件修复

### Task 5: `BusinessDomainView` 换用 ReactFlow 原生 `onNodeDoubleClick`

**Files:**
- Modify: `code-graph-ui/src/pages/DataLineage/components/BusinessDomainView.tsx`

**背景：** 现有手动双击检测（`lastClickTimeRef` + 300ms 比对）对时机敏感，导致部分领域节点无法稳定触发进入子图。ReactFlow 提供原生 `onNodeDoubleClick` 事件，更可靠。

- [ ] **Step 1: 删除手动双击检测的 ref 和逻辑**

  打开 `code-graph-ui/src/pages/DataLineage/components/BusinessDomainView.tsx`，找到约第 119-121 行：

  ```ts
  // 删除这两行
  const lastClickTimeRef = useRef(0);
  const lastClickedNodeRef = useRef<string | null>(null);
  ```

  以及 import 中的 `useRef`（如果只有这里用到的话，删除导入；如果还有其他地方用到，保留）：

  ```bash
  grep -n "useRef" code-graph-ui/src/pages/DataLineage/components/BusinessDomainView.tsx
  ```

- [ ] **Step 2: 将 `handleNodeClick` 改为纯单击逻辑**

  找到约第 221-248 行的 `handleNodeClick`，将其中的双击检测部分全部删除，只保留单击的面板更新逻辑：

  ```ts
  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (node.type !== "businessDomain") return;
      setSelectedDomainId(node.id);
    },
    []
  );
  ```

- [ ] **Step 3: 新增 `handleNodeDoubleClick` 函数**

  在 `handleNodeClick` 下方新增：

  ```ts
  const handleNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (node.type !== "businessDomain") return;
      const domain = domainData.domains.find((d) => d.id === node.id);
      if (domain && onDomainDoubleClick) {
        onDomainDoubleClick(node.id, domain);
      }
    },
    [domainData.domains, onDomainDoubleClick]
  );
  ```

- [ ] **Step 4: 在 `ReactFlow` 组件上绑定 `onNodeDoubleClick`**

  找到约第 362-394 行的 `<ReactFlow>` 标签，加上 `onNodeDoubleClick` prop：

  ```tsx
  <ReactFlow
    nodes={rfNodes}
    edges={rfEdges}
    onNodesChange={onNodesChange}
    onEdgesChange={onEdgesChange}
    onNodeClick={handleNodeClick}
    onNodeDoubleClick={handleNodeDoubleClick}   // ← 新增
    nodeTypes={nodeTypes}
    fitView
    minZoom={0.1}
    maxZoom={2}
    proOptions={{ hideAttribution: true }}
  >
  ```

- [ ] **Step 5: 编译验证**

  ```bash
  cd code-graph-ui && npm run build 2>&1 | head -30
  ```

  预期：无 TypeScript 错误。

- [ ] **Step 6: 提交**

  ```bash
  cd code-graph-ui
  git add src/pages/DataLineage/components/BusinessDomainView.tsx
  git commit -m "fix: BusinessDomainView 换用 ReactFlow 原生 onNodeDoubleClick"
  ```

---

### Task 6: `BusinessDomainNode` 标题栏阻止双击冒泡

**Files:**
- Modify: `code-graph-ui/src/pages/DataLineage/components/BusinessDomainNode.tsx`

**背景：** `BusinessDomainNode` 标题栏有展开/折叠功能，`handleToggle` 绑定 `onClick` + `stopPropagation`。用户双击标题栏展开时会同时触发 `onNodeDoubleClick`（进入子图），需要阻止标题栏区域的双击事件冒泡。

- [ ] **Step 1: 在标题栏 div 上加 `onDoubleClick` 阻止冒泡**

  打开 `code-graph-ui/src/pages/DataLineage/components/BusinessDomainNode.tsx`，找到约第 99-146 行的标题栏 div：

  ```tsx
  <div
    onClick={handleToggle}
    style={{ ... }}
  >
  ```

  加上 `onDoubleClick`：

  ```tsx
  <div
    onClick={handleToggle}
    onDoubleClick={(e) => e.stopPropagation()}   // ← 新增：防止双击标题进入子图
    style={{ ... }}
  >
  ```

- [ ] **Step 2: 编译验证**

  ```bash
  cd code-graph-ui && npm run build 2>&1 | head -30
  ```

  预期：无 TypeScript 错误。

- [ ] **Step 3: 提交**

  ```bash
  cd code-graph-ui
  git add src/pages/DataLineage/components/BusinessDomainNode.tsx
  git commit -m "fix: 标题栏双击阻止冒泡，防止折叠时误触进入子图"
  ```

---

## Chunk 4: 集成验证

### Task 7: 端到端手动验证

**Files:**（无新增文件，全局回归验证）

**前置条件：** 后端 API 服务已启动（`cd code-graph-system && python -m uvicorn backend.api.server:app --port 8000 --reload`），前端开发服务器已启动（`cd code-graph-ui && npm run dev`）。

- [ ] **Step 1: 启动前端开发服务器**

  ```bash
  cd code-graph-ui && npm run dev
  ```

  打开 `http://localhost:5173`，选择一个有数据的仓库。

- [ ] **Step 2: 验证业务领域主图正常加载**

  切换到「数据血缘」→「业务领域视图」，确认：
  - 领域节点气泡显示（含节点数量标记）
  - 主图中跨领域边正常渲染（箭头可见）
  - 单击领域节点，右侧面板显示领域统计信息（不再空白）

- [ ] **Step 3: 验证双击进入子图**

  双击某个领域节点气泡（注意：双击领域名称区域，不是标题折叠箭头位置），确认：
  - 切换到子图视图（`DomainDetailView`）
  - 子图中节点数量与主图领域卡片标注的数量基本一致
  - 节点之间有边连接（箭头可见）

- [ ] **Step 4: 验证节点点击和右侧面板**

  在子图内：
  - 进入子图后，右侧面板默认显示领域统计（节点总数、服务数）
  - 单击某个节点后，右侧面板切换为节点详情（名称、类型、调用数）

- [ ] **Step 5: 验证标题折叠不误触进入子图**

  在业务领域主图中，双击某个领域节点的**标题折叠箭头区域**，确认：
  - 节点展开/折叠（显示 Service 列表）
  - 不会跳转到子图视图

- [ ] **Step 6: 验证返回主图**

  在子图视图中，点击左上角「返回」按钮，确认回到业务领域主图，主图状态正常。

- [ ] **Step 7: 最终提交**

  如果以上验证全部通过，确认所有文件已提交：

  ```bash
  cd code-graph-ui && git log --oneline -8
  ```

  预期输出类似：
  ```
  <hash> fix: 标题栏双击阻止冒泡，防止折叠时误触进入子图
  <hash> fix: BusinessDomainView 换用 ReactFlow 原生 onNodeDoubleClick
  <hash> fix: SimpleNode 添加 Handle，子图右侧面板默认展示领域统计
  <hash> fix: DomainDetailView 改用 nodeIds 集合过滤子图节点和边
  <hash> feat: DomainInfo 新增 nodeIds 字段，handleDomainDoubleClick 传递 nodeIds
  <hash> feat: 扩展领域聚合白名单，BusinessDomainNode 新增 nodeIds 字段
  ```
