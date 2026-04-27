# Data Lineage JSON 文件说明

## 概述

`data-lineage.json` 用于描述系统的数据血缘关系，包括业务模块、数据流转、实体关系、模块依赖等，帮助 AI 助手理解系统的数据架构和业务逻辑。

## 文件结构

### 1. meta 元信息

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 数据血缘图名称 |
| `version` | string | 是 | 文档版本 |
| `generatedAt` | string | 是 | 生成日期 |
| `description` | string | 是 | 系统描述 |

### 2. businessGlossary 业务术语表

定义系统中使用的业务术语缩写。

```json
"businessGlossary": {
  "description": "业务术语表",
  "terms": [
    {
      "term": "DRS",
      "fullName": "Database Recovery Service",
      "description": "数据库检测服务说明"
    }
  ]
}
```

### 3. businessRules 业务规则

定义系统的核心业务规则。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 规则唯一标识，用于在其他地方引用 |
| `name` | string | 规则名称 |
| `description` | string | 规则描述 |
| `formula` | string | 计算公式（可选） |
| `weights` | object | 权重配置（可选） |
| `conditions` | array | 条件列表（可选） |
| `mapping` | object | 映射关系（可选） |
| `algorithms` | object | 算法说明（可选） |

### 4. modules 业务模块（核心）

这是文件的核心部分，描述系统的各个业务模块。

#### Module 结构

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 模块唯一标识 |
| `name` | string | 是 | 模块中文名称 |
| `fullName` | string | 是 | 模块英文全称 |
| `description` | string | 是 | 模块功能描述 |
| `icon` | string | 否 | 图标标识（用于可视化） |
| `position` | object | 否 | 可视化位置 {x, y} |
| `color` | string | 否 | 模块颜色（用于可视化） |
| `dependsOn` | array | 是 | 依赖的模块ID列表 |
| `providesTo` | array | 是 | 提供服务的模块ID列表 |
| `entities` | array | 是 | 模块包含的实体列表 |
| `businessFlows` | array | 是 | 业务流程列表 |
| `subFunctions` | array | 是 | 子功能列表 |
| `serviceDependencies` | object | 否 | 服务依赖说明 |
| `businessTypeMapping` | object | 否 | 业务类型映射 |

#### Entity 结构

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 实体唯一标识 |
| `name` | string | 是 | 实体类名 |
| `tableName` | string | 是 | 数据库表名 |
| `description` | string | 是 | 实体描述 |
| `fields` | array | 是 | 关键字段列表 |
| `sourceFile` | string | 是 | 源码文件路径 |
| `relations` | array | 否 | 实体关联关系 |

#### BusinessFlow 结构

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 流程唯一标识 |
| `name` | string | 是 | 流程名称 |
| `description` | string | 是 | 流程描述 |
| `trigger` | string | 是 | 触发方式 |
| `businessContext` | string | 是 | 业务场景说明 |
| `steps` | array | 是 | 流程步骤列表 |
| `dataInputs` | array | 是 | 输入数据列表 |
| `dataOutputs` | array | 是 | 输出数据列表 |
| `relatedServices` | array | 否 | 相关服务列表 |
| `businessRules` | array | 否 | 引用的业务规则ID |

#### Step 结构

| 字段 | 类型 | 说明 |
|------|------|------|
| `step` | number | 步骤序号 |
| `name` | string | 步骤名称 |
| `description` | string | 步骤描述 |
| `input` | array | 输入数据 |
| `output` | array | 输出数据 |
| `serviceCall` | string | 调用的服务方法 |

#### SubFunction 结构

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 功能唯一标识 |
| `name` | string | 功能名称 |
| `description` | string | 功能描述 |
| `apiEndpoint` | string | API端点路径 |
| `inputSource` | array | 输入来源 |
| `outputTarget` | array | 输出目标 |
| `relatedEntities` | array | 相关实体 |
| `relatedServices` | array | 相关服务 |
| `relatedDAO` | array | 相关DAO |

### 5. dataLineage 数据血缘

描述数据节点和节点之间的流向关系。

#### Node 结构

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 节点唯一标识 |
| `name` | string | 节点名称 |
| `type` | string | 节点类型：entity/service/external/view/storage |
| `module` | string | 所属模块 |
| `description` | string | 节点描述 |

#### Edge 结构

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 边唯一标识 |
| `source` | string | 源节点ID |
| `target` | string | 目标节点ID |
| `label` | string | 边标签（显示名称） |
| `flowType` | string | 流类型 |
| `description` | string | 边描述 |

**flowType 可选值：**
- `api` - API调用
- `sync` - 数据同步
- `trigger` - 触发
- `relation` - 关联关系
- `process` - 处理
- `aggregate` - 聚合
- `auth` - 授权
- `netty` - Netty通信
- `register` - 注册
- `response` - 响应

### 6. dataRelations 数据关联

描述数据库层面的关联关系。

#### foreignKeyRelations 外键关系

```json
{
  "source": "源表名",
  "sourceField": "源字段",
  "target": "目标表名",
  "targetField": "目标字段",
  "description": "关联说明"
}
```

#### entityInheritance 实体继承

描述实体的继承层次结构。

#### sharedResources 共享资源

描述被多个模块共享的核心实体。

### 7. keyDataFlows 关键数据链路

描述系统中的核心数据流转路径。

```json
{
  "id": "flow-id",
  "name": "链路名称",
  "description": "链路描述",
  "steps": [
    { "step": 1, "entity": "实体", "action": "动作", "description": "描述" }
  ]
}
```

### 8. moduleDependencies 模块依赖

描述模块之间的依赖关系。

| 字段 | 类型 | 说明 |
|------|------|------|
| `from` | string | 源模块 |
| `to` | string | 目标模块 |
| `type` | string | 依赖类型 |
| `description` | string | 依赖说明 |
| `detail` | string | 详细描述 |

**type 可选值：**
- `data` - 数据依赖
- `config` - 配置依赖
- `service` - 服务依赖
- `auth` - 认证授权依赖
- `aggregate` - 数据聚合依赖

### 9. flowEngine 工作流引擎

描述工作流引擎的组件和流程类型。

### 10. externalIntegrations 外部集成（可选）

描述与外部系统的集成。

## 使用建议

1. **模块划分**：按业务领域划分模块，每个模块应有清晰的职责边界
2. **业务流程**：详细描述核心业务流程的每个步骤，包括输入输出
3. **数据血缘**：准确描述数据节点和流向，便于理解数据流转
4. **规则引用**：业务规则定义后可在多个流程中引用
5. **保持更新**：系统变更时及时更新此文件

## 与 architecture.json 的区别

| 文件 | 侧重 | 用途 |
|------|------|------|
| `architecture.json` | 技术架构 | 描述代码结构、层次、技术栈 |
| `data-lineage.json` | 业务架构 | 描述业务流程、数据流转、模块关系 |

两个文件互为补充，共同描述系统的完整视图。
