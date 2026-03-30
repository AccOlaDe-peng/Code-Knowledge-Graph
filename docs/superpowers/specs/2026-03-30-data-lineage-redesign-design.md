# 数据血缘页面重构设计

## 概述

重构 DataLineage 页面，使用 `data-lineage.json` 作为数据源，实现模块依赖图 + 详情面板的交互模式，全面展示模块、实体、业务流程、功能等数据血缘信息。

## 数据源

**文件路径：** `code-graph-system/data/graphs/data-lineage.json`

**数据结构：**
```typescript
interface DataLineageJSON {
  meta: {
    name: string;
    version: string;
    generatedAt: string;
    description: string;
  };
  modules: Module[];
  dataFlow: {
    nodes: DataFlowNode[];
    edges: DataFlowEdge[];
  };
  moduleDependencies: {
    dependencies: ModuleDependency[];
  };
  flowEngine: {
    components: FlowComponent[];
    flowTypes: FlowType[];
  };
}

interface Module {
  id: string;
  name: string;
  fullName: string;
  description: string;
  icon: string;
  position: { x: number; y: number };
  color: string;
  entities: Entity[];
  businessFlows: BusinessFlow[];
  subFunctions: SubFunction[];
}

interface Entity {
  id: string;
  name: string;
  tableName: string;
  description: string;
  fields: string[];
  sourceFile: string;
}

interface BusinessFlow {
  id: string;
  name: string;
  description: string;
  trigger: string;
  steps: FlowStep[];
  dataInputs: string[];
  dataOutputs: string[];
  relatedServices: string[];
}

interface FlowStep {
  step: number;
  name: string;
  description: string;
  input: string[];
  output: string[];
}

interface SubFunction {
  id: string;
  name: string;
  description: string;
  apiEndpoint: string;
  inputSource: string[];
  outputTarget: string[];
  relatedEntities: string[];
  relatedServices: string[];
  relatedDAO: string[];
}

interface DataFlowNode {
  id: string;
  name: string;
  type: 'entity' | 'service' | 'external' | 'storage' | 'view' | 'trigger';
  module: string;
  description: string;
}

interface DataFlowEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  flowType: 'api' | 'sync' | 'trigger' | 'process' | 'relation' | 'response' | 'netty' | 'aggregate';
  description: string;
}

interface ModuleDependency {
  from: string;
  to: string;
  type: 'data' | 'config' | 'service' | 'auth' | 'aggregate';
  description: string;
}
```

## 架构设计

### 前端架构

```
src/pages/DataLineage/
├── index.tsx                    # 主页面（重构）
├── components/
│   ├── ModuleGraph/             # 模块依赖图（ReactFlow）
│   │   ├── index.tsx
│   │   └── ModuleNode.tsx       # 模块节点组件
│   ├── ModuleDetailPanel/       # 模块详情面板
│   │   ├── index.tsx
│   │   ├── EntityTab.tsx        # 实体 Tab
│   │   ├── BusinessFlowTab.tsx  # 业务流程 Tab
│   │   └── FunctionTab.tsx      # 功能 Tab
│   └── FlowStepTimeline.tsx     # 业务流程步骤时间线
├── utils/
│   └── dataLineageLoader.ts     # 数据加载和转换
└── types/
    └── dataLineage.ts           # 类型定义
```

### 后端架构

新增 API 端点：

```
GET /data-lineage
返回 data-lineage.json 文件内容
```

**实现方式：**
- 在 `backend/api/routers/` 新增 `data_lineage.py`
- 读取 `data/graphs/data-lineage.json` 文件并返回
- 不依赖 repo_id，直接返回静态数据

## 组件设计

### 1. 主页面 (index.tsx)

**职责：**
- 加载数据血缘数据
- 管理选中模块状态
- 布局：上部模块图 + 下部详情面板（可折叠）

**状态：**
```typescript
const [data, setData] = useState<DataLineageJSON | null>(null);
const [selectedModule, setSelectedModule] = useState<Module | null>(null);
const [panelExpanded, setPanelExpanded] = useState(true);
```

### 2. ModuleGraph 组件

**职责：**
- 渲染模块依赖图
- 节点 = 模块，边 = 依赖关系
- 支持节点点击选中

**布局：**
- 使用 dagre 布局算法
- 优先使用 JSON 中的 position 作为初始位置
- 支持用户拖拽调整

**边样式：**
| 依赖类型 | 颜色 | 样式 |
|---------|------|------|
| data | 青色 | 实线 |
| config | 紫色 | 虚线 |
| service | 绿色 | 实线 |
| auth | 橙色 | 点线 |
| aggregate | 灰色 | 实线 |

### 3. ModuleDetailPanel 组件

**职责：**
- 展示选中模块的详情
- 三个 Tab：实体 / 业务流程 / 功能

**布局：**
```
┌─────────────────────────────────────────────────────────┐
│ DRS - 数据库检测服务                              [折叠] │
├─────────────────────────────────────────────────────────┤
│ [实体] [业务流程] [功能]                                │
├─────────────────────────────────────────────────────────┤
│ Tab 内容区域                                            │
│                                                         │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 4. EntityTab 组件

**展示内容：**
- 实体名称 + 表名
- 字段列表（可折叠）
- 描述
- 来源文件（点击可跳转）

**交互：**
- 点击实体高亮相关的数据流节点

### 5. BusinessFlowTab 组件

**展示内容：**
- 流程名称 + 描述
- 触发条件
- 步骤时间线（垂直布局）
- 输入/输出数据
- 关联服务

**交互：**
- 点击步骤展开详情
- 点击输入/输出跳转到相关实体

### 6. FunctionTab 组件

**展示内容：**
- 功能名称 + API 端点
- 描述
- 输入来源 / 输出目标
- 关联实体 / 服务 / DAO

## 数据流

```
┌─────────────┐     GET /data-lineage     ┌─────────────┐
│   Backend   │ ─────────────────────────▶│  Frontend   │
│ JSON File   │                           │  Main Page  │
└─────────────┘                           └──────┬──────┘
                                                 │
                                                 ▼
                                          ┌─────────────┐
                                          │ ModuleGraph │
                                          │ (依赖图渲染) │
                                          └──────┬──────┘
                                                 │ click
                                                 ▼
                                          ┌─────────────┐
                                          │ DetailPanel │
                                          │ (模块详情)   │
                                          └─────────────┘
```

## 样式设计

沿用现有 Mission Control Dark 设计系统：

**模块节点颜色：**
- 从 JSON 的 `color` 字段读取
- 默认按模块类型分配

**面板样式：**
- 背景：`rgba(10, 15, 22, 0.95)`
- 边框：`1px solid var(--b-subtle)`
- Tab 激活色：`var(--a-cyan)`

## 错误处理

1. **数据加载失败：** 显示错误提示 + 重试按钮
2. **文件不存在：** 显示"暂无数据血缘数据"占位
3. **数据格式错误：** 前端校验并降级显示可用数据

## 迁移计划

### 阶段 1：后端 API
1. 新增 `/data-lineage` 端点
2. 读取并返回 JSON 文件

### 阶段 2：前端类型
1. 创建 `types/dataLineage.ts`
2. 定义所有接口类型

### 阶段 3：前端组件
1. 重构主页面
2. 实现 ModuleGraph 组件
3. 实现 ModuleDetailPanel 组件（含三个 Tab）

### 阶段 4：清理
1. 移除旧的数据加载逻辑
2. 移除不再使用的组件（ModuleView, ServiceView, DetailView 等）
3. 清理不再使用的 API 调用

## 验收标准

1. 首屏正确展示模块依赖图
2. 点击模块节点显示详情面板
3. 三个 Tab 内容正确渲染
4. 边样式按依赖类型区分
5. 响应式布局适配不同屏幕尺寸
