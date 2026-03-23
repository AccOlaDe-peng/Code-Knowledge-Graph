# 数据血缘三层视图设计文档

## 一、背景与目标

### 问题现状

当前血缘图内容单薄，存在以下问题：

1. **只有类级数据流**：Service → Database，缺少完整的调用链路
2. **缺少模块概念**：无法看到模块边界和模块间数据流
3. **层级跳跃大**：从全图直接跳到单一 Service，没有中间过渡

### 目标

实现三层渐进式血缘视图：

```
层级 1: 模块级主图 ──点击模块──▶ 层级 2: 模块内视图 ──点击 Service──▶ 层级 3: 详细血缘
```

---

## 二、数据盘点结果

### 2.1 现有数据（可直接利用）

| 数据项 | 数量 | 来源 |
|-------|------|------|
| Service 节点 | 288 | 静态分析（@Service 注解 + 命名约定） |
| Controller 节点 | 89 | Component 类型（@RestController 注解） |
| Repository/Mapper | 182 | Class 类型（命名约定） |
| Database 节点 | 1 | 动态推断（PrimaryDB） |
| Function 级 calls 边 | 6,271 | AST 分析 |
| Controller → Service 调用 | 576 条 | Function 级 calls 边聚合 |
| Service → Service 调用 | 155 条 | Function 级 calls 边聚合 |
| 跨模块调用 | 21 条 | 从文件路径推断 |
| reads/writes 边 | 320 条 | Mapper → Database |

### 2.2 模块归属（从文件路径推断）

```
Service ID: class:adms-api/src/main/java/.../UserService.java:UserService
模块归属: adms-api
```

当前模块分布：
- adms-api: 142 个 Service
- adms-repository: 89 个 Service
- adms-flow: 17 个 Service
- adms-integration: 13 个 Service
- adms-email: 10 个 Service
- 其他: 17 个 Service

### 2.3 缺失数据

| 数据项 | 解决方案 |
|-------|---------|
| Module 节点 | 动态推断，不存入图谱 |
| APIEndpoint 节点 | 后端补充（可选，P2 优先级） |
| Module 级边 | 从 Class 级边聚合 |

---

## 三、三层视图设计

### 3.1 层级 1：模块级主图

**节点：**
- `Module`：模块容器（从文件路径动态推断）
- `Database`：数据库节点
- `Topic`：消息主题（如有）

**边：**
- `Module → Module flow_to`：跨模块数据流（从 Service → Service 聚合）
- `Module → Database reads/writes`：模块访问的数据源

**视觉设计：**
```
┌──────────────────┐      ┌──────────────────┐
│   adms-api       │      │   adms-repo      │
│ ┌──────────────┐ │      │ ┌──────────────┐ │
│ │ UserService  │─┼──────┼▶│ UserRepository│ │
│ │ AuthService  │ │ 虚线  │ │ OrgRepository │ │
│ │ ... (139)    │ │      │ └──────────────┘ │
│ └──────────────┘ │      │                  │
│      PrimaryDB   │      └──────────────────┘
└──────────────────┘
```

**交互：**
- 点击模块：进入层级 2（模块内视图）
- 悬停模块：显示统计信息（Service 数量、跨模块依赖数）
- 点击模块间边：高亮涉及的 Service 调用

### 3.2 层级 2：模块内视图

**节点：**
- `Controller`：控制器类
- `Service`：业务服务
- `Repository`：数据访问层
- `Database`：数据库

**边：**
- `Controller → Service calls`：控制器调用服务
- `Service → Service calls`：服务间调用
- `Service → Repository calls`：服务调用数据层
- `Repository → Database reads/writes`：数据读写

**视觉设计：**
```
┌─────────────────────────────────────────────────────┐
│                    adms-api 模块详情                 │
│                                                     │
│  Controller 层       Service 层        数据层       │
│  ┌─────────────┐    ┌──────────────┐               │
│  │MdmController│───▶│MdmLibService │───┐           │
│  └─────────────┘    └──────────────┘   │           │
│  ┌─────────────┐    ┌──────────────┐   ▼           │
│  │UserController───▶│UserService   │───▶PrimaryDB  │
│  └─────────────┘    └──────────────┘               │
│                            │                        │
│                            ▼ 跨模块调用（虚线）      │
│                      ┌──────────────┐               │
│                      │OrderService  │ [adms-order]  │
│                      └──────────────┘               │
└─────────────────────────────────────────────────────┘
```

**跨模块调用展示：**
- 右侧面板显示"跨模块依赖"列表
- 点击可定位到目标 Service

**交互：**
- 点击 Service：进入层级 3（详细血缘）
- 双击空白处：返回层级 1

### 3.3 层级 3：单 Service 详细血缘

**节点：**
- `Function`：具体方法（Controller 方法、Service 方法、Repository 方法）
- `Database`：数据库

**边：**
- Function 级 `calls` 边
- `reads/writes` 边

**视觉设计：**
```
GET /users/{id}
     │
     ▼
UserController.getUser()
     │
     ▼
UserService.getUser()  ─────▶ OrderService.getOrders() [外部模块]
     │
     ▼
UserRepository.findById()
     │
     ▼
users 表 (PrimaryDB)
```

---

## 四、技术实现

### 4.1 后端实现

#### 4.1.1 新增 API：`GET /graph/lineage/modules`

返回模块级血缘视图：

```python
@router.get("/graph/lineage/modules")
def get_lineage_modules(repo_id: str) -> dict:
    """
    模块级血缘视图。

    Returns:
        {
            "modules": [
                {
                    "id": "module:adms-api",
                    "name": "adms-api",
                    "service_count": 142,
                    "services": ["UserService", "AuthService", ...],
                    "databases": ["PrimaryDB"],
                    "cross_module_calls": 15
                }
            ],
            "edges": [
                {
                    "from": "module:adms-api",
                    "to": "module:adms-repository",
                    "type": "flow_to",
                    "service_pairs": [
                        ["UserService", "UserRepository"],
                        ["AuthService", "OrgRepository"]
                    ],
                    "call_count": 12
                }
            ]
        }
    """
```

#### 4.1.2 扩展现有 API：`GET /graph/lineage`

新增参数：
- `module_id`：过滤指定模块内的血缘
- `view_level`：`module` | `service` | `detail`

#### 4.1.3 聚合逻辑

```python
def aggregate_to_module_level(nodes: list, edges: list) -> dict:
    """将 Class 级数据聚合为 Module 级。"""

    # 1. 从 Class ID 提取模块归属
    def get_module_id(class_id: str) -> str:
        # class:adms-api/src/... -> module:adms-api
        parts = class_id.split('/')
        return f"module:{parts[0].replace('class:', '')}"

    # 2. 聚合 Service → Service 边为 Module → Module 边
    module_edges = defaultdict(lambda: {"service_pairs": [], "count": 0})
    for edge in edges:
        if edge["type"] == "calls":
            from_module = get_module_id(edge["from"])
            to_module = get_module_id(edge["to"])
            if from_module != to_module:
                key = (from_module, to_module)
                module_edges[key]["service_pairs"].append(
                    (edge["from_class"], edge["to_class"])
                )
                module_edges[key]["count"] += 1

    # 3. 构建 Module 节点
    modules = {}
    for node in nodes:
        if node["type"] == "Service":
            module_id = get_module_id(node["id"])
            if module_id not in modules:
                modules[module_id] = {
                    "id": module_id,
                    "name": module_id.replace("module:", ""),
                    "services": [],
                }
            modules[module_id]["services"].append(node)

    return {"modules": list(modules.values()), "edges": module_edges}
```

### 4.2 前端实现

#### 4.2.1 状态管理

```typescript
// src/store/lineageStore.ts
interface LineageState {
  // 视图层级
  level: 'module' | 'service' | 'detail';

  // 当前选中的模块/服务
  selectedModuleId: string | null;
  selectedServiceId: string | null;

  // 数据缓存
  moduleData: ModuleData | null;
  serviceData: ServiceData | null;
  detailData: DetailData | null;

  // 加载状态
  loading: boolean;
  error: string | null;
}
```

#### 4.2.2 组件结构

```
src/pages/DataLineage/
├── index.tsx              # 主页面，管理三层视图切换
├── components/
│   ├── ModuleView.tsx     # 层级 1：模块级主图
│   ├── ServiceView.tsx    # 层级 2：模块内视图
│   ├── DetailView.tsx     # 层级 3：详细血缘
│   ├── ModuleNode.tsx     # 模块分组节点
│   ├── CrossModuleEdge.tsx # 跨模块边（虚线动画）
│   └── CrossModulePanel.tsx # 跨模块依赖面板
├── hooks/
│   ├── useModuleData.ts   # 加载模块级数据
│   ├── useServiceData.ts  # 加载服务级数据
│   └── useAggregation.ts  # 本地聚合逻辑（备用）
└── utils/
    ├── moduleAggregation.ts # 模块归属推断
    └── edgeAggregation.ts   # 边聚合逻辑
```

#### 4.2.3 核心交互逻辑

```typescript
// 三层导航
const navigateToModule = (moduleId: string) => {
  setLevel('service');
  setSelectedModuleId(moduleId);
  loadServiceData(moduleId);
};

const navigateToService = (serviceId: string) => {
  setLevel('detail');
  setSelectedServiceId(serviceId);
  loadDetailData(serviceId);
};

const navigateBack = () => {
  if (level === 'detail') {
    setLevel('service');
    setSelectedServiceId(null);
  } else if (level === 'service') {
    setLevel('module');
    setSelectedModuleId(null);
  }
};

// 双击返回上一层
const handleDoubleClick = () => {
  navigateBack();
};
```

---

## 五、实现计划

### 阶段 1：后端模块级 API（2-3 小时）

- [ ] 新增 `GET /graph/lineage/modules` 端点
- [ ] 实现模块归属推断逻辑
- [ ] 实现 Class → Module 边聚合
- [ ] 添加单元测试

### 阶段 2：前端层级 1 - 模块主图（3-4 小时）

- [ ] 创建 `ModuleView` 组件
- [ ] 实现 `ModuleNode` 分组节点
- [ ] 实现跨模块边样式（虚线 + 动画）
- [ ] 添加点击进入模块详情的交互

### 阶段 3：前端层级 2 - 模块内视图（2-3 小时）

- [ ] 创建 `ServiceView` 组件
- [ ] 复用现有血缘图渲染逻辑
- [ ] 添加跨模块依赖面板
- [ ] 实现双击返回交互

### 阶段 4：前端层级 3 - 详细血缘（1-2 小时）

- [ ] 创建 `DetailView` 组件
- [ ] 展示 Function 级调用链
- [ ] 标注跨模块调用

### 阶段 5：集成测试（1-2 小时）

- [ ] 端到端测试三层导航
- [ ] 性能测试（大型图谱）
- [ ] 交互体验调优

---

## 六、验收标准

1. **层级 1：模块主图**
   - 显示所有模块及其 Service 数量
   - 跨模块边用虚线清晰标注
   - 点击模块可进入模块详情

2. **层级 2：模块内视图**
   - 显示 Controller → Service → Repository 链路
   - 跨模块调用在右侧面板清晰展示
   - 双击可返回模块主图

3. **层级 3：详细血缘**
   - 显示 Function 级完整调用链
   - 标注跨模块调用来源

4. **性能**
   - 模块主图加载 < 1 秒
   - 模块内视图加载 < 2 秒
   - 详细血缘加载 < 1 秒
