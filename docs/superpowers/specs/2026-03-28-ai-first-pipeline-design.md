# AI 优先分析流水线设计

> 创建日期: 2026-03-28
> 状态: 草案
> 目标: 替代静态优先流水线，使用 AI 直接分析代码结构，产出实体级、字段级、血缘级的精确图谱

---

## 一、背景与目标

### 1.1 当前问题

现有静态优先流水线存在以下局限：

1. **模块边界识别不准** — 目录聚类无法识别真正的逻辑模块边界
2. **AST 解析覆盖不全** — 无法识别反射调用、动态代理、Spring AOP 等
3. **缺少实体级分析** — 无法识别 JPA 实体、表映射、字段定义
4. **缺少字段级血缘** — 只能推断表级依赖，无法追踪字段流转路径

### 1.2 目标效果

参考 `adms-data-lineage-analysis.md` 报告，期望产出：

- **实体级节点**：识别所有 JPA 实体、表名、主键、关键字段
- **关系级边**：完整的一对一、一对多、多对多关系（含中间表）
- **字段级血缘**：追踪字段在系统中的流转路径
- **AI 生成描述**：每个实体、字段、流程都有业务语义说明
- **实体重要性评分**：识别核心实体和辅助实体
- **数据流向标注**：标注关系的数据流向和驱动模式

---

## 二、整体架构

### 2.1 流水线概览

```
代码仓库
  │
  ├─► Stage 1: AIRepositoryScanStage
  │     AI 探索仓库结构，识别实体类、表定义、流程定义、服务类
  │
  ├─► Stage 2: AIEntityAnalysisStage
  │     AI 分析每个实体的字段、注解、关系（并行处理）
  │
  ├─► Stage 3: AIFieldLineageStage
  │     AI 推断字段级数据血缘，追踪字段流转路径
  │
  ├─► Stage 4: AIDescriptionStage
  │     AI 生成实体、字段、流程的业务语义描述
  │
  └─► Stage 5: GraphBuildStage
        构建图谱节点和边，计算重要性评分，输出结构化数据
```

### 2.2 与现有流水线对比

| 维度 | 静态优先流水线 | AI 优先流水线 |
|------|---------------|---------------|
| 模块识别 | 目录聚类（零 LLM） | AI 探索识别逻辑边界 |
| 实体识别 | 仅识别类名和注解 | AI 识别 JPA 实体、表名、字段 |
| 关系识别 | 基于注解和命名约定 | AI 分析代码语义推断关系 |
| 血缘分析 | 表级推断 | 字段级追踪 |
| 描述生成 | 后处理阶段 | 内置在分析阶段 |
| 准确度 | 结构层数据高置信度 | 取决于 AI 能力和 prompt 设计 |
| 成本 | LLM 调用量少 | LLM 调用量大，但更深入 |
| 可复现性 | 相同 commit 结果一致 | 可能因 LLM 随机性产生差异 |

---

## 三、节点与边 Schema 设计

### 3.1 节点类型

| 类型 | 说明 | 属性示例 |
|------|------|----------|
| `Entity` | JPA 实体类 | `name`, `table_name`, `primary_key`, `description`, `importance_score` |
| `Table` | 数据库表 | `name`, `schema`, `description` |
| `Field` | 实体字段 | `name`, `type`, `column_name`, `description`, `is_primary_key`, `is_foreign_key` |
| `Flow` | 业务流程定义 | `name`, `key`, `type`, `description` |
| `FlowNode` | 流程节点 | `name`, `key`, `type`, `description` |
| `Service` | 业务服务 | `name`, `type`, `description`, `importance_score` |
| `Repository` | 数据仓库 | `name`, `entity_type`, `description` |
| `Topic` | 消息主题 | `name`, `message_queue`, `description` |
| `APIEndpoint` | API 端点 | `name`, `http_method`, `path`, `description` |

### 3.2 边类型

| 类型 | 说明 | 属性示例 |
|------|------|----------|
| `maps_to` | Entity 映射 Table | `source: "static"` |
| `has_field` | Entity 包含 Field | `source: "static"` |
| `one_to_one` | 一对一关系 | `foreign_key`, `description` |
| `one_to_many` | 一对多关系 | `foreign_key`, `description` |
| `many_to_many` | 多对多关系 | `join_table`, `description` |
| `flow_to` | 字段级数据流转 | `from_field`, `to_field`, `flow_type`, `description` |
| `contains` | 包含关系 | `source: "static"` |
| `depends_on` | 依赖关系 | `type`, `description` |
| `produces` | 生产关系 | `description` |
| `consumes` | 消费关系 | `description` |

### 3.3 属性说明

**通用属性：**
- `source`: 数据来源 (`ai_analyzed` / `static`)
- `confidence`: 置信度 (0.0 - 1.0)
- `description`: AI 生成的业务语义描述

**Entity 节点专属：**
- `table_name`: 映射的数据库表名
- `primary_key`: 主键字段名
- `importance_score`: 重要性评分 (1-10)
- `importance_reason`: 重要性原因说明

**Field 节点专属：**
- `type`: 字段类型
- `column_name`: 映射的数据库列名
- `is_primary_key`: 是否主键
- `is_foreign_key`: 是否外键
- `references`: 外键引用的实体和字段

**flow_to 边专属：**
- `from_field`: 源字段完整路径 (如 `Policy.uuid`)
- `to_field`: 目标字段完整路径 (如 `Frs.fullPolicyId`)
- `flow_type`: 流转类型 (`direct` / `transformed` / `conditional`)
- `flow_pattern`: 流转模式 (`策略驱动` / `事件触发` / `定时调度`)

---

## 四、Stage 详细设计

### 4.1 Stage 1: AIRepositoryScanStage

**职责：** AI 探索仓库结构，识别实体类、表定义、流程定义、服务类

**输入：**
- 仓库路径
- 文件列表（可选，用于限制范围）

**AI 任务：**
1. 探索仓库目录结构，识别源码目录
2. 搜索并识别所有 `@Entity` 注解的类
3. 搜索并识别流程定义类（如 `Flow`, `Playbook`）
4. 搜索并识别服务类（如 `@Service`, `@Component`）
5. 输出结构化的节点候选列表

**Prompt 设计：**

```
你是一个代码结构分析专家。请探索以下代码仓库，识别所有关键的结构元素。

仓库路径: {repo_path}

任务目标：
1. 识别所有 JPA 实体类（@Entity 注解）
2. 识别所有流程定义类（如 Flow, Playbook, FlowNode）
3. 识别所有业务服务类（@Service, @Component）
4. 识别所有 Repository 类（@Repository）
5. 识别所有消息主题定义（@KafkaListener, KafkaTemplate）

探索策略：
- 使用 list_directory 了解目录结构
- 使用 search_code 搜索关键注解
- 使用 read_file 阅读具体文件确认

输出格式（JSON）：
{
  "entities": [
    {
      "class_name": "AdmsApplication",
      "file_path": "adms-core/.../entity/AdmsApplication.java",
      "table_name": "adms_application",
      "primary_key": "uuid",
      "brief_description": "在线应用管理实体"
    }
  ],
  "flows": [...],
  "services": [...],
  "repositories": [...],
  "topics": [...]
}
```

**输出：**
- 实体候选列表
- 流程候选列表
- 服务候选列表
- 其他结构元素

---

### 4.2 Stage 2: AIEntityAnalysisStage

**职责：** AI 分析每个实体的字段、注解、关系

**输入：**
- Stage 1 输出的实体候选列表

**AI 任务（并行处理每个实体）：**
1. 读取实体类源码
2. 识别所有字段及其注解（`@Column`, `@JoinColumn`, `@OneToMany` 等）
3. 推断实体间的关系（一对一、一对多、多对多）
4. 识别中间关系表
5. 输出结构化的字段列表和关系列表

**Prompt 设计：**

```
你是一个 JPA 实体分析专家。请分析以下实体类的完整结构。

实体名称: {entity_name}
文件路径: {file_path}

任务目标：
1. 识别所有字段及其类型
2. 识别字段的数据库列映射（@Column）
3. 识别实体关系：
   - @OneToOne: 一对一关系
   - @OneToMany: 一对多关系
   - @ManyToOne: 多对一关系
   - @ManyToMany: 多对多关系
4. 识别外键字段和引用目标
5. 识别中间关系表

输出格式（JSON）：
{
  "entity_name": "AdmsApplication",
  "table_name": "adms_application",
  "primary_key": "uuid",
  "fields": [
    {
      "name": "name",
      "type": "String",
      "column_name": "name",
      "is_primary_key": false,
      "is_foreign_key": false,
      "description": "应用名称"
    },
    {
      "name": "businessUuid",
      "type": "String",
      "column_name": "business_uuid",
      "is_foreign_key": true,
      "references": {
        "entity": "AdmsBusiness",
        "field": "uuid"
      },
      "description": "关联的业务UUID"
    }
  ],
  "relationships": [
    {
      "type": "one_to_one",
      "target_entity": "AdmsBusiness",
      "foreign_key": "businessUuid",
      "description": "应用归属业务"
    },
    {
      "type": "many_to_many",
      "target_entity": "Application",
      "join_table": "adms_application_backup_relation",
      "description": "在线应用与备份应用关联"
    }
  ]
}
```

**输出：**
- 字段节点列表
- 关系边列表（one_to_one, one_to_many, many_to_many）

---

### 4.3 Stage 3: AIFieldLineageStage

**职责：** AI 推断字段级数据血缘，追踪字段流转路径

**输入：**
- Stage 2 输出的实体和字段信息
- 流程定义信息

**AI 任务：**
1. 分析服务类中的字段赋值逻辑
2. 追踪字段在方法调用间的传递
3. 识别字段值的来源和去向
4. 推断字段级流转路径
5. 标注流转类型（直接传递、转换、条件流转）

**Prompt 设计：**

```
你是一个数据血缘分析专家。请分析以下系统中字段级数据流转关系。

已知实体和字段：
{entities_and_fields}

已知服务和方法：
{services_and_methods}

任务目标：
1. 追踪字段在服务调用间的传递路径
2. 识别字段值的来源（来自哪个实体的哪个字段）
3. 识别字段值的去向（传递到哪个实体的哪个字段）
4. 标注流转类型：
   - direct: 直接传递，值不变
   - transformed: 经过转换
   - conditional: 条件性传递
5. 标注流转模式：
   - 策略驱动: 策略配置触发数据流转
   - 事件触发: 事件驱动数据流转
   - 定时调度: 定时任务触发数据流转

输出格式（JSON）：
{
  "field_lineages": [
    {
      "from_entity": "Policy",
      "from_field": "uuid",
      "to_entity": "Frs",
      "to_field": "fullPolicyId",
      "flow_type": "direct",
      "flow_pattern": "策略驱动",
      "description": "策略UUID传递给文件检测服务作为全量策略ID"
    },
    {
      "from_entity": "AdmsApplication",
      "from_field": "uuid",
      "to_entity": "DatabaseDetection",
      "to_field": "admsApplicationId",
      "flow_type": "direct",
      "flow_pattern": "配置关联",
      "description": "在线应用UUID传递给数据库检测作为应用ID"
    }
  ]
}
```

**输出：**
- 字段级血缘边列表（flow_to）

---

### 4.4 Stage 4: AIDescriptionStage

**职责：** AI 生成实体、字段、流程的业务语义描述

**输入：**
- 所有节点信息

**AI 任务（并行处理）：**
1. 为每个实体生成业务语义描述
2. 为每个关键字段生成业务含义说明
3. 为每个流程生成执行逻辑说明
4. 为每个服务生成功能描述

**Prompt 设计（实体描述）：**

```
你是一个业务文档专家。请为以下实体生成业务语义描述。

实体名称: {entity_name}
实体字段: {fields}
实体关系: {relationships}

任务目标：
1. 生成实体功能摘要（50-100字）
2. 说明实体在系统中的作用
3. 列出核心字段（3-5个）
4. 评估实体重要性（1-10分）并说明原因

输出格式（JSON）：
{
  "entity_name": "FlowJob",
  "summary": "流程作业实体，记录作业执行的完整生命周期，包括名称、状态、进度、关联策略等。",
  "role_in_system": "所有作业类型的汇聚点，是任务执行的统一入口",
  "core_fields": ["name", "status", "progress", "policyUuid", "processId"],
  "importance_score": 9,
  "importance_reason": "核心枢纽节点，连接策略、剧本、任务三个关键实体"
}
```

**输出：**
- 完善的节点属性（包含 description）

---

### 4.5 Stage 5: GraphBuildStage

**职责：** 构建图谱节点和边，计算重要性评分

**输入：**
- Stage 1-4 输出的所有结构化数据

**处理逻辑：**
1. 创建所有节点（Entity, Table, Field, Flow, FlowNode, Service 等）
2. 创建所有边（maps_to, has_field, one_to_one, flow_to 等）
3. 计算节点的 PageRank 和度指标
4. 生成质量报告

**输出：**
- `BuiltGraph` 对象
- 质量报告

---

## 五、并发与性能设计

### 5.1 并发策略

| Stage | 并发策略 | 说明 |
|-------|---------|------|
| Stage 1 | 单次调用 | 探索仓库结构，一次完成 |
| Stage 2 | 模块级并行 | 每个实体独立分析，可并行 |
| Stage 3 | 批量分析 | 字段血缘需要跨实体分析，按领域分组 |
| Stage 4 | 节点级并行 | 描述生成可并行 |
| Stage 5 | 无需 LLM | 纯计算 |

### 5.2 上下文管理

- 使用现有的 `ContextMonitor` 监控 token 使用
- 大文件使用分段读取策略
- 实体分析时，只传递必要的上下文（类定义、相关依赖）

### 5.3 缓存策略

- 分析结果按 `(repo_name, commit_sha)` 缓存
- 增量分析：只分析变更文件相关的实体

---

## 六、前端适配

### 6.1 新增节点类型展示

需要在前端添加以下节点类型的渲染：

| 节点类型 | 图标建议 | 颜色建议 |
|---------|---------|---------|
| `Entity` | 📦 数据库实体 | 紫色 |
| `Table` | 📋 数据库表 | 灰色 |
| `Field` | 📝 字段 | 浅蓝 |
| `Flow` | 🔄 流程 | 绿色 |
| `FlowNode` | ⚙️ 节点 | 浅绿 |
| `Service` | 🔧 服务 | 橙色 |

### 6.2 新增边类型展示

| 边类型 | 线型建议 | 说明 |
|-------|---------|------|
| `maps_to` | 虚线 | Entity 映射 Table |
| `has_field` | 细实线 | 包含关系 |
| `one_to_one` | 粗实线 + 1:1 标签 | 一对一 |
| `one_to_many` | 粗实线 + 1:N 标签 | 一对多 |
| `many_to_many` | 粗实线 + M:N 标签 | 多对多 |
| `flow_to` | 带箭头 + 流转类型标签 | 字段级血缘 |

### 6.3 节点详情面板

需要扩展 `NodeDetailPanel` 组件以展示：

1. **实体节点详情**
   - 实体名称、描述、表名
   - 字段列表（含类型、说明）
   - 关系列表（含关系类型、目标实体）
   - 重要性评分

2. **字段节点详情**
   - 字段名称、类型、列名
   - 是否主键/外键
   - 外键引用目标
   - 字段级血缘（流入/流出）

3. **流程节点详情**
   - 流程名称、描述
   - 包含的节点列表
   - 执行逻辑说明

---

## 七、API 设计

### 7.1 新增端点

**获取实体图谱：**
```
GET /graph/entities?repo_id={repo_id}
```
返回：所有实体节点及其关系

**获取字段血缘：**
```
GET /graph/field-lineage?repo_id={repo_id}&entity={entity_name}&field={field_name}
```
返回：指定字段的流入/流出血缘

**获取实体详情：**
```
GET /graph/entity/{entity_id}
```
返回：实体完整信息（含字段、关系、描述）

### 7.2 扩展现有端点

**获取架构图视图：**
```
GET /graph/framework?repo_id={repo_id}&node_types=Entity,Flow,Service
```
支持按 `node_types` 参数过滤节点类型

---

## 八、实现计划

### Phase 1: 核心 Stage 实现（预计 3-4 天）

1. 实现 `AIRepositoryScanStage`
2. 实现 `AIEntityAnalysisStage`
3. 实现 `AIFieldLineageStage`
4. 实现 `AIDescriptionStage`
5. 实现 `GraphBuildStage`

### Phase 2: 流水线集成（预计 1-2 天）

1. 创建 `AIFirstPipeline` 类
2. 集成到现有 API
3. 添加配置开关（可选择静态优先或 AI 优先）

### Phase 3: 前端适配（预计 2-3 天）

1. 扩展节点类型渲染
2. 扩展边类型渲染
3. 扩展节点详情面板
4. 新增字段血缘视图

### Phase 4: 测试与优化（预计 1-2 天）

1. 单元测试
2. 集成测试
3. 性能优化
4. 文档更新

---

## 九、风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| LLM API 成本高 | 大仓库分析成本高 | 支持增量分析、缓存结果、按需深入 |
| 分析结果不稳定 | 相同代码可能产生不同结果 | 设置低 temperature、多次验证关键关系 |
| 超出 context window | 无法分析大文件或大模块 | 分段读取、摘要压缩 |
| 前端渲染性能 | 节点过多时卡顿 | LOD 策略、按需加载 |

---

## 十、后续优化方向

1. **缺失关系提示** — AI 发现可能存在但代码中未明确定义的关系
2. **变更影响分析** — 结合 Git 历史，标注高频变更实体
3. **SQL 解析** — 解析 Mapper XML 中的 SQL，补充字段映射
4. **配置文件分析** — 解析 application.yml，识别数据源配置
5. **跨仓库血缘** — 支持微服务架构下的跨仓库血缘追踪

---

*设计文档完成，待用户审核后开始实现*
