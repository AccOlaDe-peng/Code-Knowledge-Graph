# 函数调用关系图 JSON 模板说明

## 概述

`function-call-graph-template.json` 是一个通用的函数调用关系图 JSON 模板，可以适配任何编程语言的项目。

## 模板结构

### 1. 元数据 (Metadata)

```json
{
  "projectName": "项目名称",
  "version": "项目版本号",
  "generatedAt": "生成时间戳",
  "generator": {
    "name": "生成器名称",
    "version": "生成器版本"
  }
}
```

### 2. 统计信息 (Statistics)

```json
{
  "statistics": {
    "totalModules": 0,
    "totalFunctions": 0,
    "totalCallChains": 0,
    "totalCrossModuleCalls": 0
  }
}
```

### 3. 配置项 (Config)

```json
{
  "config": {
    "excludedModules": [],           // 排除的模块
    "excludedPackages": [],          // 排除的包
    "excludedPatterns": [],          // 排除的模式
    "includedPatterns": ["**/*.java"], // 包含的文件模式
    "analysisDepth": 10,             // 分析深度
    "language": "java"               // 主要语言
  }
}
```

### 4. 模块定义 (Modules)

每个模块包含：
- **基本信息**: id, name, displayName, description, path
- **统计**: functionCount, callChainCount
- **函数列表**: functions[]
- **内部调用链**: internalCallChains[]

### 5. 函数定义 (Function)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 函数唯一标识 (func_XXXXXX) |
| name | string | 函数名称 |
| className | string | 所属类名 |
| fullName | string | 完整限定名 |
| type | enum | service/controller/repository/entity/util/config/unknown |
| visibility | enum | public/private/protected/package |
| sourceFile | string | 源文件路径 |
| sourceLine | number | 起始行号 |
| params | array | 参数列表 |
| returnType | object | 返回类型 |
| annotations | array | 注解列表 |
| callerCount | number | 被调用次数 (入度) |
| calleeCount | number | 调用其他函数次数 (出度) |
| static | boolean | 是否静态方法 |

### 6. 调用链 (Call Chain)

| 字段 | 说明 |
|------|------|
| callerId | 调用方函数ID |
| callerName | 调用方完整名称 |
| calleeId | 被调用方函数ID |
| calleeName | 被调用方完整名称 |
| callType | 调用类型: direct/virtual/interface/lambda/reflection |
| sourceLine | 调用发生的行号 |

### 7. 跨模块调用 (Cross Module Calls)

与调用链结构相同，额外包含：
- sourceModule / sourceModuleId
- targetModule / targetModuleId

## 支持的语言

| 语言 | 文件扩展名 |
|------|-----------|
| Java | .java |
| Kotlin | .kt |
| Python | .py |
| TypeScript | .ts, .tsx |
| JavaScript | .js, .jsx |
| Go | .go |

## 函数类型定义

| 类型 | 说明 |
|------|------|
| service | 服务层，业务逻辑处理 |
| controller | 控制层，API 接口 |
| repository | 数据访问层 |
| entity | 实体/模型类 |
| util | 工具类方法 |
| config | 配置类方法 |
| unknown | 未分类 |

## 调用类型定义

| 类型 | 说明 |
|------|------|
| direct | 直接调用 |
| virtual | 虚方法调用 (多态) |
| interface | 接口方法调用 |
| lambda | Lambda 表达式调用 |
| reflection | 反射调用 |

## 使用方式

### 1. 复制模板
```bash
cp function-call-graph-template.json my-project-call-graph.json
```

### 2. 替换占位符
- `${PROJECT_NAME}` - 项目名称
- `${PROJECT_VERSION}` - 项目版本
- `${MODULE_NAME}` - 模块名称
- 等等...

### 3. 填充实际数据
根据项目实际情况填充：
- 模块信息
- 函数定义
- 调用关系

## 示例

参考 `adms-function-call-graph.json` 查看完整示例。
