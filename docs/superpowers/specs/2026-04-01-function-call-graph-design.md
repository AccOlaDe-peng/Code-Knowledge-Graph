# 函数调用图功能设计规格

## 概述

为代码知识图谱系统添加函数调用图可视化功能，支持从模块总览到函数详情的三层级浏览，以及路径追踪能力。

## 数据模型

### 源数据结构 (`{repo}-function-call-graph.json`)

```typescript
interface FunctionCallGraph {
  projectName: string;
  version: string;
  generatedAt: string;
  totalModules: number;
  totalFunctions: number;
  totalCallChains: number;
  excludedModules: string[];
  modules: Module[];
  callChains: CallChain[];
}

interface Module {
  id: string;           // "mod_000"
  name: string;         // "adms-integration"
  displayName: string;  // "外部集成"
  description: string;
  path: string;
  functionCount: number;
  callChainCount: number;
  functions: Function[];
}

interface Function {
  id: string;           // "func_000000"
  name: string;         // "getPoliciesDetailUrl"
  className: string;    // "NbuProp"
  fullName: string;     // "com.activeio.adms.nbu.prop.NbuProp.getPoliciesDetailUrl"
  type: FunctionType;
  visibility: "public" | "private" | "protected";
  description: string;
  sourceFile: string;
  sourceLine: number;
  params: Param[];
  returnType: ReturnType;
  annotations: string[];
  callerCount: number;  // 被调用次数
  calleeCount: number;  // 调用他人次数
  static: boolean;
}

type FunctionType =
  | "service"      // 服务层
  | "controller"   // 控制器
  | "repository"   // 数据访问
  | "dto"          // 数据传输对象
  | "entity"       // 实体
  | "util"         // 工具类
  | "handler"      // 处理器
  | "config"       // 配置
  | "mapper";      // 映射器

interface CallChain {
  sourceModule: string;
  sourceModuleId: string;
  sourceFunctionId: string;
  sourceFunctionName: string;
  targetModule: string;
  targetModuleId: string;
  targetFunctionId: string;
  targetFunctionName: string;
  callType: "direct" | "interface";
  sourceLine: number;
}
```

---

## 后端 API 设计

### 新增路由

#### 1. 获取函数调用图完整数据

```
GET /graph/function-call?repo_id={repo_id}
```

**响应：**
```typescript
{
  repo_id: string;
  project_name: string;
  total_modules: number;
  total_functions: number;
  total_call_chains: number;
  modules: Module[];
  call_chains: CallChain[];
  // 聚合数据：模块间调用统计
  module_calls: {
    from: string;    // source module id
    to: string;      // target module id
    count: number;
  }[];
}
```

**实现逻辑：**
1. 根据 `repo_id` 构造文件路径：`data/graphs/{repo_id}-function-call-graph.json`
2. 解析 JSON，计算模块间调用统计（`module_calls`）
3. 返回完整数据

#### 2. 路径追踪

```
GET /graph/function-call/path?repo_id={repo_id}&from={func_id}&to={func_id}
```

**响应：**
```typescript
{
  found: boolean;
  paths: {
    nodes: Function[];   // 路径上的函数
    edges: CallChain[];  // 路径上的调用链
    length: number;
  }[];
  max_depth_reached?: boolean;
}
```

**实现逻辑：**
1. 使用 BFS 从起点搜索到终点
2. 支持多条路径（最多返回 5 条）
3. 最大深度限制：10 层

---

## 前端设计

### 页面路由

```
/callgraph                    # 函数调用图页面（保持原路由）
```

### 视图层级

```
┌─────────────────────────────────────────────────────────────────┐
│ View Level 1: 模块总览 (Module Overview)                        │
│ - 模块节点 + 模块间调用边                                        │
│ - 全局搜索入口                                                  │
│ - 统计概览                                                      │
└─────────────────────────────────────────────────────────────────┘
                              ↓ 点击模块节点
┌─────────────────────────────────────────────────────────────────┐
│ View Level 2: 模块详情 (Module Detail)                          │
│ - 左侧：模块树导航 + 函数列表                                    │
│ - 右侧：函数调用图 (Dagre 布局)                                  │
│ - 路径追踪入口                                                  │
└─────────────────────────────────────────────────────────────────┘
                              ↓ 点击函数节点
┌─────────────────────────────────────────────────────────────────┐
│ View Level 3: 函数详情 (Function Detail)                        │
│ - 右侧抽屉                                                      │
│ - 函数签名、参数、返回值                                         │
│ - Callers / Callees 列表                                        │
│ - 路径追踪起点/终点设置                                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## 组件结构

```
src/pages/FunctionCallGraph/
├── index.tsx                    # 主页面容器
├── components/
│   ├── ModuleOverview/          # 第一层：模块总览
│   │   ├── index.tsx            # 主组件
│   │   ├── ModuleNode.tsx       # 模块节点渲染
│   │   └── ModuleEdge.tsx       # 模块间边渲染
│   ├── ModuleDetail/            # 第二层：模块详情
│   │   ├── index.tsx            # 主组件（左右分栏）
│   │   ├── ModuleTree.tsx       # 左侧模块树
│   │   ├── FunctionList.tsx     # 左侧函数列表
│   │   └── FunctionGraph.tsx    # 右侧函数调用图
│   ├── FunctionDrawer/          # 第三层：函数详情抽屉
│   │   └── index.tsx
│   ├── PathTrace/               # 路径追踪面板
│   │   └── index.tsx
│   └── GlobalSearch/            # 全局搜索组件
│       └── index.tsx
├── hooks/
│   ├── useFunctionCallData.ts   # 数据加载 Hook
│   └── usePathTrace.ts          # 路径追踪 Hook
├── utils/
│   ├── layout.ts                # Dagre 布局计算
│   └── transform.ts             # 数据转换
└── types.ts                     # 类型定义
```

---

## 交互设计

### 第一层：模块总览

**视觉：**
- 模块节点：圆角矩形卡片，大小与函数数量成正比
- 节点颜色：按模块类型区分（service/api/core/util 等）
- 边：贝塞尔曲线，粗细与调用次数成正比
- 布局：力导向布局 (force-directed)

**节点信息：**
```
┌──────────────────────────────┐
│ 📦 adms-api                  │  ← 模块名
│ API 接口层                    │  ← 显示名
│ ────────────────────         │
│ 函数: 4,841                   │  ← 函数数量
│ 调用: 5,566                   │  ← 调用链数量
│ ▓▓▓▓▓▓░░░░                   │  ← 调用热度（相对占比）
└──────────────────────────────┘
```

**交互：**
- 点击模块：进入该模块详情
- 悬停边：显示调用次数
- 全局搜索：输入函数名，下拉结果点击跳转

### 第二层：模块详情

**布局：**
- 左侧面板（240px）：模块树 + 函数列表
- 右侧面板（剩余）：函数调用图

**左侧面板：**
```
┌─────────────────────┐
│ 🔍 搜索函数...       │
├─────────────────────┤
│ 📁 模块树            │
│  ├─ adms-api    ●   │  ← 当前选中
│  │  ├─ controller   │
│  │  ├─ service      │
│  │  └─ handler      │
│  ├─ adms-core       │
│  ├─ adms-web        │
│  └─ ...             │
├─────────────────────┤
│ 📋 函数列表          │
│ 类型过滤: [全部 ▼]  │
│  ○ getUserById      │
│  ○ createUser       │
│  ○ updateUser       │
│  ○ ...              │
└─────────────────────┘
```

**函数调用图：**
- 布局：Dagre（从左到右层级布局）
- 节点：函数名 + 类型标签
- 边：调用关系，实线=同模块，虚线=跨模块
- 颜色：按函数类型区分

**交互：**
- 点击节点：打开函数详情抽屉
- 双击节点：将该函数设为路径追踪起点
- 右键节点：设为路径追踪终点
- 拖拽节点：调整位置
- 缩放/平移：浏览大型图

### 第三层：函数详情抽屉

**内容：**
```
┌─────────────────────────────────┐
│ ✕  getUserById                  │
├─────────────────────────────────┤
│ 🏷️ SERVICE   🔓 public          │
│                                 │
│ 📦 所属模块                      │
│ adms-api > API 接口层           │
│                                 │
│ 📄 签名                          │
│ User getUserById(Long id)       │
│                                 │
│ 📍 位置                          │
│ UserController.java:45          │
│ [查看源码 →]                     │
│                                 │
│ 📥 参数                          │
│ • id: Long - 用户ID             │
│                                 │
│ 📤 返回值                        │
│ User - 用户实体                  │
├─────────────────────────────────┤
│ 📥 被调用 (4)                    │
│ ┌─────────────────────────────┐│
│ │ createUser     [Service]    ││
│ │ updateUser     [Service]    ││
│ │ getUserProfile [Controller] ││
│ │ deleteUser     [Service]    ││
│ └─────────────────────────────┘│
├─────────────────────────────────┤
│ 📤 调用目标 (3)                  │
│ ┌─────────────────────────────┐│
│ │ findUser       [Repository] ││
│ │ cacheUser      [Cache]      ││
│ │ logAccess      [Logger]     ││
│ └─────────────────────────────┘│
├─────────────────────────────────┤
│ 🔗 路径追踪                      │
│ [设为起点]  [设为终点]           │
└─────────────────────────────────┘
```

### 路径追踪功能

**入口：**
1. 函数详情抽屉中的"设为起点/终点"按钮
2. 右键菜单："设为路径起点"、"设为路径终点"

**面板：**
```
┌─────────────────────────────────────────┐
│ 🔍 路径追踪                              │
├─────────────────────────────────────────┤
│ 起点: getUserById         [清除]        │
│ 终点: saveToDatabase      [清除]        │
│                                         │
│ [查找路径]                               │
├─────────────────────────────────────────┤
│ 找到 2 条路径:                          │
│                                         │
│ 路径 1 (3跳):                           │
│ getUserById → findUser →                │
│ validateUser → saveToDatabase           │
│                        [显示 →]         │
│                                         │
│ 路径 2 (5跳):                           │
│ getUserById → cacheUser → ...           │
│                        [显示 →]         │
└─────────────────────────────────────────┘
```

**展示：**
- 选择路径后，图中高亮显示该路径
- 其他节点/边淡化
- 支持切换多条路径

---

## 性能优化

### 数据加载
- **一次性加载**：512KB JSON 一次性加载到前端
- **前端缓存**：使用 Zustand store 缓存，切换模块不重新请求
- **懒加载详情**：函数详情按需从已加载数据中提取

### 图渲染优化
- **虚拟节点**：超过 500 个函数时，默认隐藏部分节点
- **LOD（Level of Detail）**：缩放级别低时显示简化节点
- **WebWorker**：Dagre 布局计算放在 WebWorker 中

### 交互优化
- **防抖搜索**：搜索输入 300ms 防抖
- **增量渲染**：只重绘变化的部分

---

## 配色方案

### 函数类型颜色

| 类型 | 主色 | 用途 |
|------|------|------|
| service | `#00d4ff` (青色) | 服务层函数 |
| controller | `#00f084` (绿色) | 控制器方法 |
| repository | `#b08eff` (紫色) | 数据访问层 |
| dto | `#ffc145` (琥珀) | DTO getter/setter |
| entity | `#ff66cc` (粉色) | 实体方法 |
| handler | `#ff6b6b` (红色) | 事件处理器 |
| util | `#7888a8` (灰色) | 工具函数 |

### 边类型颜色

| 类型 | 样式 | 说明 |
|------|------|------|
| 同模块调用 | 实线 `#00d4ff` | 源和目标在同一模块 |
| 跨模块调用 | 虚线 `#ffc145` | 源和目标在不同模块 |
| 接口调用 | 点线 `#b08eff` | 通过接口调用 |

---

## 错误处理

### 后端
- 文件不存在：返回 404 + 提示"该仓库尚未生成函数调用图"
- 文件解析失败：返回 500 + 错误详情

### 前端
- 加载失败：显示错误提示 + 重试按钮
- 无数据：显示"请先分析仓库生成函数调用图"
- 路径未找到：显示"未找到两个函数之间的调用路径"

---

## 实现优先级

### P0（核心功能）
1. 后端 API：`GET /graph/function-call`
2. 前端：模块总览视图
3. 前端：模块详情视图（函数调用图）
4. 前端：函数详情抽屉

### P1（增强功能）
5. 后端 API：`GET /graph/function-call/path`
6. 前端：路径追踪功能
7. 前端：全局搜索

### P2（优化）
8. 图渲染性能优化
9. 大规模数据虚拟化
10. 导出功能（PNG/SVG/JSON）
