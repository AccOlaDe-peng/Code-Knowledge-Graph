# 多 Agent AI 分析增强实现计划

## 概述

本计划基于 `docs/superpowers/specs/2026-03-30-multi-agent-ai-analysis-enhancement-design.md` 设计规范，将现有的 `AIFirstPipeline` 增强为多 Agent 协作架构。

## 现有代码分析

### 可复用的组件

| 组件 | 文件 | 可复用程度 | 说明 |
|------|------|-----------|------|
| `BaseAgent` | `backend/agent/base.py` | 高 | 抽象基类，可扩展 |
| `SharedKnowledgeBase` | `backend/agent/context.py` | 中 | 需扩展为 KnowledgeHub |
| `FileTools` | `backend/agent/tools/file_tools.py` | 高 | 基础工具，直接复用 |
| `AgentOrchestrator` | `backend/agent/orchestrator.py` | 中 | 架构不同，需重写 |
| `AIRepositoryScanStage` | `backend/pipeline/stages/ai_repository_scan.py` | 高 | 可封装为 EntityAgent |
| `AIEntityAnalysisStage` | `backend/pipeline/stages/ai_entity_analysis.py` | 高 | 可复用核心逻辑 |
| `AIFieldLineageStage` | `backend/pipeline/stages/ai_field_lineage.py` | 高 | 可复用核心逻辑 |

### 需要新建的目录结构

```
backend/
├── agent_v2/                      # 新版 Agent 系统
│   ├── __init__.py
│   ├── base_agent.py              # DomainAgent 基类
│   ├── entity_agent.py            # EntityAgent
│   ├── service_agent.py           # ServiceAgent
│   ├── flow_agent.py              # FlowAgent
│   ├── lineage_agent.py           # LineageAgent
│   ├── topic_agent.py             # TopicAgent
│   └── orchestrator.py            # AgentOrchestrator V2
│
├── knowledge/                     # 知识中枢
│   ├── __init__.py
│   ├── hub.py                     # KnowledgeHub
│   ├── events.py                  # 事件类型定义
│   └── confidence.py              # 置信度计算
│
├── tools/                         # 工具系统
│   ├── __init__.py
│   ├── base_tools.py              # 基础探索工具
│   ├── semantic_tools.py          # 语义分析工具
│   ├── spring_tools.py            # Spring 框架工具
│   ├── jpa_tools.py               # JPA 工具
│   ├── advanced_tools.py          # 高级推理工具
│   └── executor.py                # ToolExecutor
│
├── validation/                    # 验证系统
│   ├── __init__.py
│   ├── cross_validation.py        # CrossValidationLayer
│   ├── arbitrator.py              # Arbitrator
│   └── rules.py                   # 验证规则定义
│
└── pipeline/
    └── ai_first_pipeline_v2.py    # 新版 Pipeline
```

---

## Phase 1: 基础架构搭建

### Task 1.1: 创建知识中枢 (KnowledgeHub)

**文件:** `backend/knowledge/__init__.py`, `backend/knowledge/hub.py`, `backend/knowledge/events.py`

**依赖:** 无

**实现要点:**
1. 定义事件类型枚举 (`KnowledgeEventType`)
2. 实现 `KnowledgeHub` 类，包含:
   - 数据存储：entity_data, service_data, flow_data, lineage_data, topic_data
   - 订阅管理：subscriptions 字典
   - 变更记录：change_log
   - 核心方法：publish, subscribe, query, get_confidence

**验收标准:**
- [ ] KnowledgeHub 可发布和订阅事件
- [ ] 支持置信度查询和传播计算
- [ ] 单元测试通过

---

### Task 1.2: 创建置信度计算模块

**文件:** `backend/knowledge/confidence.py`

**依赖:** Task 1.1

**实现要点:**
1. 实现 `calculate_propagated_confidence` 函数
2. 衰减因子：0.85^depth
3. 支持递归计算依赖链置信度

**验收标准:**
- [ ] 置信度传播计算正确
- [ ] 支持多级依赖链

---

### Task 1.3: 创建 DomainAgent 基类

**文件:** `backend/agent_v2/__init__.py`, `backend/agent_v2/base_agent.py`

**依赖:** Task 1.1

**实现要点:**
1. 定义抽象方法：`discover`, `analyze`, `validate`
2. 实现 `run` 方法：Discovery → Analysis → Validate
3. 实现 `refine` 方法：增量精炼
4. 集成 KnowledgeHub 引用
5. 集成 ToolExecutor 引用

**验收标准:**
- [ ] 基类可被子类继承
- [ ] run 方法执行三阶段流程
- [ ] refine 方法支持增量精炼

---

### Task 1.4: 创建 ToolExecutor 框架

**文件:** `backend/tools/__init__.py`, `backend/tools/executor.py`

**依赖:** 无

**实现要点:**
1. 定义 `AGENT_TOOL_PERMISSIONS` 配置
2. 实现 `ToolExecutor` 类:
   - `execute(tool_name, params)` 方法
   - `get_tool_definitions_for_llm()` 方法
   - 权限检查逻辑
   - 缓存机制

**验收标准:**
- [ ] ToolExecutor 可执行已注册工具
- [ ] 权限检查生效
- [ ] 缓存机制工作正常

---

## Phase 2: 工具实现

### Task 2.1: 实现基础探索工具

**文件:** `backend/tools/base_tools.py`

**依赖:** Task 1.4

**实现要点:**
1. 从 `backend/agent/tools/file_tools.py` 迁移并扩展
2. 实现工具：
   - `list_directory`：列出目录内容
   - `search_code`：搜索代码模式
   - `read_file`：读取文件全文
   - `read_lines`：读取指定行范围
   - `find_files`：查找文件
   - `grep_pattern`：正则匹配提取
   - `get_file_info`：获取文件元信息
   - `list_imports`：列出 import 语句

**验收标准:**
- [ ] 所有基础工具可正常执行
- [ ] 返回 ToolResult 结构
- [ ] 单元测试覆盖

---

### Task 2.2: 实现语义分析工具

**文件:** `backend/tools/semantic_tools.py`

**依赖:** Task 2.1

**实现要点:**
1. 实现工具：
   - `extract_annotations`：提取注解及属性
   - `extract_classes`：提取类定义
   - `extract_methods`：提取方法定义
   - `extract_fields`：提取字段定义
   - `extract_call_graph`：提取调用图
   - `analyze_inheritance`：分析继承结构
   - `infer_field_mapping`：推断字段映射
   - `detect_patterns`：检测设计模式

**验收标准:**
- [ ] Java 代码解析正确
- [ ] 注解属性提取完整
- [ ] 单元测试覆盖

---

### Task 2.3: 实现框架专用工具

**文件:** `backend/tools/spring_tools.py`, `backend/tools/jpa_tools.py`

**依赖:** Task 2.2

**实现要点:**
1. Spring 工具：
   - `spring_di_resolver`：解析 DI 依赖
   - `spring_http_mapping`：提取 HTTP 映射
   - `spring_transaction_boundary`：分析事务边界
   - `spring_kafka_listener`：分析 Kafka 监听器

2. JPA 工具：
   - `jpa_entity_analyzer`：分析 JPA 实体
   - `jpa_relation_resolver`：解析 JPA 关系
   - `mybatis_mapper`：分析 MyBatis 映射

**验收标准:**
- [ ] Spring 注解解析正确
- [ ] JPA 关系推断准确
- [ ] 单元测试覆盖

---

### Task 2.4: 实现高级推理工具

**文件:** `backend/tools/advanced_tools.py`

**依赖:** Task 2.2

**实现要点:**
1. 实现工具：
   - `trace_data_flow`：追踪数据流
   - `cross_file_follow`：跨文件追踪符号
   - `resolve_ambiguity`：解决歧义（需要 LLM）
   - `explain_code`：解释代码（需要 LLM）

**验收标准:**
- [ ] 数据流追踪逻辑正确
- [ ] LLM 调用正常工作

---

## Phase 3: 领域 Agent 实现

### Task 3.1: 实现 EntityAgent

**文件:** `backend/agent_v2/entity_agent.py`

**依赖:** Phase 2 完成

**实现要点:**
1. Discovery Phase：
   - 搜索 @Entity、@Table 注解
   - 发现实体候选列表

2. Analysis Phase：
   - 分析字段定义和类型
   - 提取 @Column、@Id 等注解
   - 分析关系注解（@OneToOne 等）
   - 识别外键引用

3. Validate Phase：
   - 检查主键存在性
   - 检查外键引用完整性
   - 计算置信度

**工具权限:**
- 基础工具：list_directory, search_code, read_file, read_lines, find_files, grep_pattern, list_imports
- 语义工具：extract_annotations, extract_classes, extract_methods, extract_fields, analyze_inheritance, infer_field_mapping
- 框架工具：jpa_entity_analyzer, jpa_relation_resolver, mybatis_mapper
- 高级工具：resolve_ambiguity, cross_file_follow

**验收标准:**
- [ ] 可识别 JPA 实体
- [ ] 字段和关系提取正确
- [ ] 验证逻辑生效

---

### Task 3.2: 实现 ServiceAgent

**文件:** `backend/agent_v2/service_agent.py`

**依赖:** Phase 2 完成

**实现要点:**
1. Discovery Phase：
   - 搜索 @Service、@Controller 等注解
   - 发现服务候选列表

2. Analysis Phase：
   - 提取公共方法列表
   - 分析依赖注入
   - 提取 API 端点
   - 分析事务边界

3. Validate Phase：
   - 检查依赖注入目标存在性
   - 检查 API 路径唯一性

**验收标准:**
- [ ] 可识别 Spring 服务
- [ ] API 端点提取正确
- [ ] DI 关系分析正确

---

### Task 3.3: 实现 FlowAgent

**文件:** `backend/agent_v2/flow_agent.py`

**依赖:** Phase 2 完成

**实现要点:**
1. Discovery Phase：
   - 搜索 Flow、Job、Workflow 关键词
   - 发现流程候选列表

2. Analysis Phase：
   - 提取流程定义（步骤、条件、分支）
   - 分析触发条件
   - 识别流程节点

3. Validate Phase：
   - 检查流程节点完整性
   - 检查触发条件有效性

**验收标准:**
- [ ] 可识别流程定义
- [ ] 触发条件分析正确

---

### Task 3.4: 实现 LineageAgent

**文件:** `backend/agent_v2/lineage_agent.py`

**依赖:** Task 3.1, Task 3.2, Phase 2 完成

**实现要点:**
1. 订阅事件：
   - ENTITY_ANALYZED
   - SERVICE_ANALYZED

2. Discovery Phase：
   - 发现字段赋值语句
   - 发现 DTO 转换逻辑

3. Analysis Phase：
   - 追踪字段在方法调用链中的传递
   - 识别转换逻辑
   - 标注流转模式

4. Validate Phase：
   - 检查血缘端点有效性
   - 与 Entity 关系对比

**验收标准:**
- [ ] 可追踪字段级血缘
- [ ] 流转模式标注正确

---

### Task 3.5: 实现 TopicAgent

**文件:** `backend/agent_v2/topic_agent.py`

**依赖:** Phase 2 完成

**实现要点:**
1. Discovery Phase：
   - 搜索 @KafkaListener 注解
   - 搜索 KafkaTemplate 使用

2. Analysis Phase：
   - 提取 Topic 名称
   - 识别生产者和消费者
   - 分析消息格式

3. Validate Phase：
   - 检查 Topic 名称合法性
   - 检查生产者/消费者存在性

**验收标准:**
- [ ] 可识别 Kafka Topic
- [ ] 生产者/消费者关系正确

---

## Phase 4: 协作机制实现

### Task 4.1: 实现交叉验证规则

**文件:** `backend/validation/__init__.py`, `backend/validation/rules.py`

**依赖:** Phase 3 完成

**实现要点:**
1. 定义 `CrossValidationRule` 数据类
2. 实现预定义规则：
   - `REL_001`：关系-血缘一致性
   - `REL_002`：外键引用完整性
   - `SVC_001`：服务-Topic 匹配
   - `FLOW_001`：流程实体关联
   - `LIN_001`：血缘端点有效性

**验收标准:**
- [ ] 规则定义完整
- [ ] 可扩展新规则

---

### Task 4.2: 实现 CrossValidationLayer

**文件:** `backend/validation/cross_validation.py`

**依赖:** Task 4.1

**实现要点:**
1. 实现 `CrossValidationLayer` 类：
   - `execute(all_agent_results)` 方法
   - 遍历所有规则执行检查
   - 收集矛盾项
   - 计算质量指标

2. 数据结构：
   - `CrossValidationResult`
   - `Conflict`

**验收标准:**
- [ ] 可检测 Agent 间矛盾
- [ ] 质量指标计算正确

---

### Task 4.3: 实现 Arbitrator

**文件:** `backend/validation/arbitrator.py`

**依赖:** Task 4.2

**实现要点:**
1. 实现 `Arbitrator` 类：
   - `arbitrate(conflict)` 方法
   - 规则匹配逻辑
   - 默认仲裁策略

2. 仲裁规则：
   - `ARB_001`：关系-血缘矛盾
   - `ARB_002`：服务-Topic 不匹配
   - `ARB_003`：流程-实体关联缺失
   - `ARB_004`：血缘端点不存在
   - `ARB_005`：置信度冲突

3. 数据结构：
   - `ArbitrationResult`
   - `RefinementTask`

**验收标准:**
- [ ] 可判断矛盾责任归属
- [ ] 可生成精炼任务

---

### Task 4.4: 实现 IterationController V2

**文件:** `backend/pipeline/iteration_controller.py`

**依赖:** Task 4.3

**实现要点:**
1. 实现 `IterationController` 类：
   - `should_continue(quality_metrics)` 方法
   - `check_convergence()` 方法
   - `prioritize_tasks()` 方法

2. 配置：
   - `IterationConfig` 数据类

**验收标准:**
- [ ] 迭代控制逻辑正确
- [ ] 收敛检测生效

---

## Phase 5: 集成与测试

### Task 5.1: 实现 AgentOrchestrator V2

**文件:** `backend/agent_v2/orchestrator.py`

**依赖:** Phase 3, Phase 4 完成

**实现要点:**
1. 实现 `AgentOrchestrator` 类：
   - 调度 Agent 并行执行
   - 管理 KnowledgeHub
   - 处理迭代精炼

2. 执行流程：
   - Phase 0：初始化
   - Phase 1：并行发现与分析
   - Phase 2：依赖分析（LineageAgent）
   - Phase 3：交叉验证与迭代精炼

**验收标准:**
- [ ] Agent 调度正确
- [ ] 迭代精炼流程工作

---

### Task 5.2: 实现 AIFirstPipelineV2

**文件:** `backend/pipeline/ai_first_pipeline_v2.py`

**依赖:** Task 5.1

**实现要点:**
1. 实现 `AIFirstPipelineV2` 类：
   - 与现有 `AIFirstPipeline` 接口兼容
   - 使用 AgentOrchestrator V2

2. 流程：
   - 初始化组件
   - 执行 Agent 分析
   - 生成描述
   - 构建图谱

**验收标准:**
- [ ] 接口与现有 Pipeline 兼容
- [ ] 可完成完整分析流程

---

### Task 5.3: 单元测试

**文件:** `backend/tests/test_knowledge_hub.py`, `backend/tests/test_tools.py`, `backend/tests/test_agents_v2.py`

**依赖:** Phase 1-5 实现

**实现要点:**
1. KnowledgeHub 测试
2. 工具测试
3. Agent 测试
4. 验证测试

**验收标准:**
- [ ] 测试覆盖率 > 80%
- [ ] 所有测试通过

---

### Task 5.4: 集成测试

**文件:** `backend/tests/test_ai_first_pipeline_v2.py`

**依赖:** Task 5.3

**实现要点:**
1. 端到端测试
2. 使用小型测试仓库
3. 验证输出正确性

**验收标准:**
- [ ] 端到端测试通过
- [ ] 输出图谱结构正确

---

## 执行顺序

```
Phase 1: 基础架构
├── Task 1.1: KnowledgeHub
├── Task 1.2: 置信度计算
├── Task 1.3: DomainAgent 基类
└── Task 1.4: ToolExecutor

Phase 2: 工具实现
├── Task 2.1: 基础工具
├── Task 2.2: 语义工具
├── Task 2.3: 框架工具
└── Task 2.4: 高级工具

Phase 3: Agent 实现
├── Task 3.1: EntityAgent
├── Task 3.2: ServiceAgent
├── Task 3.3: FlowAgent
├── Task 3.4: LineageAgent
└── Task 3.5: TopicAgent

Phase 4: 协作机制
├── Task 4.1: 验证规则
├── Task 4.2: CrossValidationLayer
├── Task 4.3: Arbitrator
└── Task 4.4: IterationController

Phase 5: 集成测试
├── Task 5.1: Orchestrator V2
├── Task 5.2: Pipeline V2
├── Task 5.3: 单元测试
└── Task 5.4: 集成测试
```

---

## 风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| LLM 调用过多 | IterationController 预算控制 + 收敛检测 |
| Agent 间数据不一致 | KnowledgeHub 统一管理 + 版本控制 |
| 与现有代码冲突 | 新建 agent_v2 目录，保持接口兼容 |
| 测试覆盖不足 | 每个 Task 包含验收标准和测试 |
