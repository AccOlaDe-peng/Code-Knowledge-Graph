# 架构图层级划分设计

## 背景

当前 `/graph/architecture/:repoId` 接口返回所有节点都归入 `unknown` 层，导致前端架构图无法正确展示系统的分层结构。

**现状问题：**
```json
{
  "repo_id": "adms_moy22l2c",
  "layers": [{ "id": "unknown", "name": "unknown", "nodes": [...] }]
}
```

## 目标

设计后端架构图数据结构，实现标准四层架构：
- **API 层** — Controller/Endpoint，处理 HTTP 请求
- **业务层** — Service，业务逻辑处理
- **数据层** — Repository/DAO，数据访问
- **基础设施层** — Config/Utils，配置和工具

## 数据结构

### 响应格式

```typescript
interface ArchitectureResponse {
  repo_id: string;
  layers: Layer[];
  edges: ArchitectureEdge[];
  stats: {
    total_nodes: number;
    total_edges: number;
    by_layer: Record<string, number>;
  };
}

interface Layer {
  id: 'api' | 'business' | 'data' | 'infrastructure';
  name: string;
  color: string;
  nodes: ArchitectureNode[];
}

interface ArchitectureNode {
  id: string;
  name: string;
  type: 'class' | 'interface';
  file: string;
  methods?: string[];
}

interface ArchitectureEdge {
  from: string;
  to: string;
  type: 'calls' | 'depends_on';
}
```

### 层级配置

```typescript
const LayerConfig = {
  api: { name: 'API 层', color: '#00d4ff' },
  business: { name: '业务层', color: '#00f084' },
  data: { name: '数据层', color: '#ffc145' },
  infrastructure: { name: '基础设施层', color: '#ff6b9d' }
} as const;
```

## 层级识别规则

采用混合策略，优先级：**注解 > 包名 > 类名后缀**

### 1. 注解检测（最高优先级）

从 `node.metadata.annotations` 提取：

| 注解模式 | 层级 |
|---------|------|
| `@Controller`, `@RestController`, `@Endpoint` | api |
| `@Service`, `@Component` | business |
| `@Repository`, `@Dao`, `@Mapper` | data |

### 2. 包名检测

从 `node.file` 路径推断：

| 包名模式 | 层级 |
|---------|------|
| `/controller/`, `/endpoint/`, `/api/`, `/rest/` | api |
| `/service/`, `/biz/`, `/business/`, `/facade/` | business |
| `/repository/`, `/dao/`, `/mapper/` | data |
| `/config/`, `/util/`, `/helper/`, `/common/` | infrastructure |

### 3. 类名后缀检测

从 `node.label` 推断：

| 后缀模式 | 层级 |
|---------|------|
| `*Controller`, `*Endpoint`, `*Api` | api |
| `*Service`, `*Facade`, `*Manager` | business |
| `*Repository`, `*Dao`, `*Mapper` | data |

### 4. 兜底规则

未匹配的 Class/Interface 默认归入 `infrastructure` 层。

## 实现细节

### 文件修改

1. **schema.ts** — 新增 `LayerConfig` 常量和类型定义
2. **frontend.ts** — 重构 `/graph/architecture/:repoId` 路由逻辑

### 核心函数

```typescript
function detectLayer(node: GraphNode): LayerId {
  // 1. 注解检测
  const annotations = node.metadata?.annotations ?? [];
  if (annotations.some(a => /Controller|RestController|Endpoint/.test(a))) return 'api';
  if (annotations.some(a => /Service|Component/.test(a))) return 'business';
  if (annotations.some(a => /Repository|Dao|Mapper/.test(a))) return 'data';
  
  // 2. 包名检测
  const pkg = node.file.replace(/\\/g, '/');
  if (/\/(controller|endpoint|api|rest)\//.test(pkg)) return 'api';
  if (/\/(service|biz|business|facade)\//.test(pkg)) return 'business';
  if (/\/(repository|dao|mapper)\//.test(pkg)) return 'data';
  if (/\/(config|util|helper|common|constant)\//.test(pkg)) return 'infrastructure';
  
  // 3. 类名后缀检测
  if (/Controller|Endpoint|Api$/.test(node.label)) return 'api';
  if (/Service|Facade|Manager$/.test(node.label)) return 'business';
  if (/Repository|Dao|Mapper$/.test(node.label)) return 'data';
  
  return 'infrastructure';
}
```

### 边过滤

只保留架构相关的边：
- `calls` — 方法调用
- `depends_on` — 依赖关系

## 统计信息

```typescript
const stats = {
  total_nodes: graph.nodes.length,
  total_edges: graph.edges.length,
  by_layer: {
    api: layers.api.length,
    business: layers.business.length,
    data: layers.data.length,
    infrastructure: layers.infrastructure.length
  }
};
```

## 前端适配

前端 `ArchitectureData` 类型已支持新结构，无需修改类型定义。

`LayeredArchitecture.tsx` 需确保使用 `layer.id` 匹配 `LAYER_COLORS` 配色。

## 测试验证

1. 启动后端服务
2. 访问 `/graph/architecture/adms_moy22l2c`
3. 验证响应包含 4 个层级
4. 验证层级节点数量与代码库结构匹配

## 范围

- 修改后端 `frontend.ts` 路由逻辑
- 新增 `schema.ts` 常量定义
- 可选：前端样式微调
