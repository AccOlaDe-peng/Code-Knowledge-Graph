# Architecture JSON 文件说明

## 概述

`architecture.json` 用于描述软件系统的架构结构，便于 AI 助手理解项目架构，提供更准确的代码分析和开发建议。

## 文件结构

### 1. 基本信息

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 系统缩写，如 "ADMS" |
| `fullName` | string | 是 | 系统全称，如 "ActiveIO Data Management System" |
| `description` | string | 是 | 系统简要描述 |
| `version` | string | 是 | 当前架构文档版本 |

### 2. techStack 技术栈

描述系统使用的技术栈，键名可根据项目实际情况调整。

```json
"techStack": {
  "framework": "Spring Boot 3.1.6",
  "web": "Spring WebFlux",
  "orm": "Spring Data JPA",
  "database": "PostgreSQL",
  "cache": "Redis (Redisson 3.24.2)"
}
```

### 3. layers 架构分层

这是核心部分，描述系统的分层架构。

#### Layer 结构

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 层的唯一标识，如 "presentation"、"service" |
| `name` | string | 是 | 层的中文名称 |
| `alias` | string | 否 | 层的英文名称 |
| `description` | string | 是 | 层的作用描述 |
| `source` | string | 是 | 该层源码的根路径 |
| `technology` | string | 是 | 该层使用的技术 |
| `nodes` | array | 是 | 该层包含的组件节点列表 |

#### Node 结构

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 节点的唯一标识 |
| `name` | string | 是 | 类名或组件名 |
| `displayName` | string | 是 | 显示名称（中文） |
| `source` | string | 是 | 相对于层路径的源码位置 |
| `description` | string | 是 | 该节点的功能描述 |
| `functions` | array | 是 | 功能列表（字符串数组） |
| `endpoints` | array | 否 | API 端点列表（仅 Controller 层） |
| `dependencies` | array | 否 | 依赖的其他组件 ID 列表 |
| `attributes` | array | 否 | 关键属性列表（实体类常用） |

### 4. dataFlow 数据流

描述系统中数据的流动路径。

```json
"dataFlow": {
  "description": "系统数据流描述",
  "flows": [
    {
      "name": "HTTP 请求流",
      "path": ["Web UI", "Controller", "Service", "Repository", "Database"]
    }
  ]
}
```

### 5. moduleDependencies 模块依赖

描述项目模块之间的依赖关系（适用于多模块项目）。

```json
"moduleDependencies": {
  "description": "模块依赖关系",
  "modules": [
    {
      "name": "adms-api",
      "type": "主应用入口",
      "dependencies": ["adms-core", "adms-flow", "adms-repository"]
    }
  ]
}
```

### 6. 可选扩展字段

根据项目需要，可以添加以下字段：

- `externalIntegrations`：外部系统集成描述
- `supportedFeatures`：支持的功能特性
- `supportedDatabases`：支持的数据库类型（数据库相关项目）

## 常见分层模板

### 表现层 (presentation)
- 包含所有 Controller/API 端点
- 关键字段：`endpoints`

### 服务层 (service)
- 包含业务逻辑 Service
- 关键字段：`dependencies`

### 领域层 (domain)
- 包含实体、DTO、枚举
- 关键字段：`attributes`

### 数据访问层 (repository)
- 包含 Repository 接口
- 关键字段：`dependencies`（指向数据库）

### 基础设施层 (infrastructure)
- 包含配置、安全、日志等
- 关键字段：`dependencies`

### 数据存储层 (data)
- 描述外部存储系统
- 关键字段：`attributes`（存储特性）

## 使用建议

1. **保持更新**：当架构发生变化时，及时更新此文件
2. **合理分层**：根据项目实际架构划分层次
3. **完整描述**：每个节点都应该有清晰的功能描述
4. **依赖关系**：准确标注组件间的依赖关系，便于 AI 理解系统结构
