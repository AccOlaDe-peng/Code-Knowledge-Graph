# 多 Agent AI 分析增强设计规范

## 概述

本文档描述如何将现有的 `AIFirstPipeline` 增强为多 Agent 协作架构，以提高分析结果的准确度和丰富度。

### 设计目标

1. **准确度提升**：通过多 Agent 交叉验证和迭代精炼减少误判和漏判
2. **丰富度提升**：通过专业化 Agent 和丰富工具集提取更多结构化信息
3. **可扩展性**：支持未来添加新的 Agent 和工具

### 核心设计理念

- **混合划分**：第一层按分析目标划分 Agent（Entity/Service/Flow/Lineage/Topic），每个 Agent 内部有「发现→分析→验证」小循环
- **质量阈值驱动**：只有当结果质量低于阈值时才触发迭代
- **交叉验证触发**：不同 Agent 的结果交叉验证时发现矛盾才触发迭代

---

## 第一部分：整体架构

### 1.1 架构层次图

```
┌─────────────────────────────────────────────────────────────────┐
│                      AIFirstPipelineV2                          │
│  (入口：配置、启动、结果汇总)                                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     AgentOrchestrator                           │
│                                                                 │
│  职责：                                                         │
│  - 调度各领域 Agent 并行执行                                     │
│  - 管理 Agent 间的数据共享（KnowledgeHub）                       │
│  - 处理交叉验证反馈，触发迭代精炼                                 │
│  - 监控整体进度和质量指标                                        │
└─────────────────────────────────────────────────────────────────┘
                              │
         ┌──────────┬─────────┼─────────┬──────────┐
         ▼          ▼         ▼         ▼          ▼
   ┌──────────┐┌──────────┐┌──────────┐┌──────────┐┌──────────┐
   │ Entity   ││ Service  ││  Flow    ││ Lineage  ││  Topic   │
   │  Agent   ││  Agent   ││  Agent   ││  Agent   ││  Agent   │
   └──────────┘└──────────┘└──────────┘└──────────┘└──────────┘
         │          │         │         │          │
         └──────────┴─────────┴─────────┴──────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    CrossValidationLayer                         │
│                                                                 │
│  职责：                                                         │
│  - 检测 Agent 间结果的矛盾                                       │
│  - 计算整体质量分数                                              │
│  - 生成迭代精炼任务                                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   IterationController                           │
│                                                                 │
│  职责：                                                         │
│  - 判断是否需要迭代（质量阈值 / 矛盾数量）                        │
│  - 控制最大迭代次数                                              │
│  - 分发精炼任务给对应 Agent                                      │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 新增核心组件

相比现有架构，新增以下核心组件：

| 组件 | 职责 | 说明 |
|------|------|------|
| **KnowledgeHub** | 知识中枢 | 管理各 Agent 间的数据共享，支持事件订阅和置信度传递 |
| **Arbitrator** | 仲裁器 | 处理 Agent 间的责任归属和冲突解决 |
| **IterationController V2** | 迭代控制器 | 支持增量精炼、收敛检测、优先级队列 |
| **ToolExecutor** | 工具执行器 | 统一管理 Agent 的工具调用权限和执行 |

---

## 第二部分：领域 Agent 设计

### 2.1 Agent 划分

| Agent 名称 | 职责范围 | 输入 | 输出 |
|-----------|---------|------|------|
| **EntityAgent** | JPA 实体识别、字段分析、关系推断 | 仓库路径 | Entity 节点、Field 节点、关系边 |
| **ServiceAgent** | 服务类识别、API 端点提取、依赖分析 | 仓库路径 | Service 节点、APIEndpoint 节点、depends_on 边 |
| **FlowAgent** | 流程定义识别、流程节点提取、触发条件分析 | 仓库路径 | Flow 节点、FlowNode 节点、triggers 边 |
| **LineageAgent** | 字段级血缘推断、数据流追踪 | Entity 结果 + Service 结果 | FieldLineage、flow_to 边 |
| **TopicAgent** | 消息主题识别、生产者/消费者分析 | 仓库路径 | Topic 节点、produces/consumes 边 |

### 2.2 Agent 内部结构

每个 Agent 都遵循统一的三阶段结构：

```
┌─────────────────────────────────────────────────────┐
│                  DomainAgent (基类)                  │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌─────────────┐   ┌─────────────┐   ┌───────────┐ │
│  │  Discovery  │──▶│  Analysis   │──▶│ Validate  │ │
│  │   Phase     │   │   Phase     │   │  Phase    │ │
│  └─────────────┘   └─────────────┘   └───────────┘ │
│        │                 │                 │       │
│        ▼                 ▼                 ▼       │
│  ┌─────────────────────────────────────────────┐   │
│  │              LocalKnowledge                  │   │
│  │  (该 Agent 领域内的中间结果和上下文)           │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Phase 职责说明：**

| Phase | 职责 | 输出 |
|-------|------|------|
| **Discovery** | 扫描、搜索、发现候选目标 | Candidate 列表 |
| **Analysis** | 深入分析每个候选，提取详细信息 | 结构化分析结果 |
| **Validate** | 校验分析结果的完整性和一致性，计算置信度 | 验证报告 + 最终结果 |

### 2.3 Agent 工具权限

不同 Agent 可以使用的工具集合：

```python
AGENT_TOOL_PERMISSIONS = {
    "EntityAgent": [
        # 基础工具
        "list_directory", "search_code", "read_file", "read_lines",
        "find_files", "grep_pattern", "list_imports",
        # 语义工具
        "extract_annotations", "extract_classes", "extract_methods",
        "extract_fields", "analyze_inheritance", "infer_field_mapping",
        # 框架工具
        "jpa_entity_analyzer", "jpa_relation_resolver", "mybatis_mapper",
        # 高级工具
        "resolve_ambiguity", "cross_file_follow",
    ],
    "ServiceAgent": [
        "list_directory", "search_code", "read_file", "read_lines",
        "find_files", "grep_pattern", "list_imports",
        "extract_annotations", "extract_classes", "extract_methods",
        "extract_fields", "extract_call_graph", "detect_patterns",
        "spring_di_resolver", "spring_http_mapping",
        "spring_transaction_boundary", "spring_kafka_listener",
        "cross_file_follow", "trace_data_flow",
    ],
    "LineageAgent": [
        "search_code", "read_file", "read_lines", "grep_pattern",
        "extract_methods", "extract_call_graph",
        "trace_data_flow", "cross_file_follow", "explain_code",
    ],
    "FlowAgent": [
        "list_directory", "search_code", "read_file", "read_lines",
        "find_files", "grep_pattern",
        "extract_annotations", "extract_classes", "extract_methods",
        "detect_patterns",
        "explain_code", "cross_file_follow",
    ],
    "TopicAgent": [
        "search_code", "read_file", "read_lines", "grep_pattern",
        "find_files",
        "extract_annotations", "extract_methods",
        "spring_kafka_listener",
        "cross_file_follow",
    ],
}
```

---

## 第三部分：迭代精炼与交叉验证

### 3.1 迭代触发条件

**质量阈值触发（Agent 内部）：**

| 指标 | 阈值 | 说明 |
|------|------|------|
| 平均置信度 | < 0.75 | 分析结果的平均置信度过低 |
| 覆盖率 | < 80% | 已知范围内未覆盖的候选过多 |
| 完整性 | < 90% | 必要字段缺失率过高 |
| 矛盾率 | > 10% | 内部自检发现的矛盾比例 |

**交叉验证触发（Agent 间）：**

| 验证项 | 触发条件 | 涉及 Agent |
|--------|----------|-----------|
| 关系一致性 | EntityAgent 的关系边与 LineageAgent 的血缘路径矛盾 | EntityAgent ↔ LineageAgent |
| 服务依赖 | ServiceAgent 的 depends_on 与实际代码调用不符 | ServiceAgent ↔ LineageAgent |
| Topic 关联 | TopicAgent 的生产者/消费者与 ServiceAgent 的服务不匹配 | TopicAgent ↔ ServiceAgent |
| 流程触发 | FlowAgent 的触发条件与实际代码逻辑不符 | FlowAgent ↔ ServiceAgent |

### 3.2 交叉验证规则

```python
@dataclass
class CrossValidationRule:
    """交叉验证规则。"""
    rule_id: str                    # 规则 ID
    name: str                       # 规则名称
    source_agent: str               # 源 Agent
    target_agent: str               # 目标 Agent
    check_fn: Callable              # 检查函数
    severity: str                   # "error" | "warning" | "info"
    auto_fix: bool                  # 是否可自动修复
```

**预定义规则：**

| Rule ID | 规则名称 | 检查逻辑 | 严重级别 |
|---------|---------|---------|---------|
| `REL_001` | 关系-血缘一致性 | Entity 的 one_to_many 关系应在 Lineage 中有对应的 flow_to 路径 | error |
| `REL_002` | 外键引用完整性 | Entity 的外键字段引用的实体必须存在 | error |
| `SVC_001` | 服务-Topic 匹配 | Topic 的消费者/生产者必须是已识别的 Service | warning |
| `FLOW_001` | 流程实体关联 | Flow 关联的实体必须存在于 Entity 结果中 | warning |
| `LIN_001` | 血缘端点有效性 | Lineage 的 from/to 字段必须在 Entity 字段中存在 | error |

### 3.3 迭代控制配置

```python
@dataclass
class IterationConfig:
    """迭代控制配置。"""
    max_iterations: int = 3               # 最大迭代次数
    min_improvement: float = 0.05         # 最小改进阈值（5%）
    quality_threshold: float = 0.80       # 质量阈值

    # LLM 预算控制
    max_llm_calls: int = 100              # 单次分析最大 LLM 调用
    llm_budget_per_iteration: int = 30    # 每次迭代最大 LLM 调用
```

### 3.4 收敛检测逻辑

```python
def check_convergence(history: list[QualityMetrics]) -> bool:
    """检测是否已收敛（改进幅度过小）。"""
    if len(history) < 2:
        return False

    current = history[-1]
    previous = history[-2]

    # 各指标改进幅度都 < 5%
    improvements = [
        (current.avg_confidence - previous.avg_confidence) / previous.avg_confidence,
        (current.coverage - previous.coverage) / previous.coverage,
        (current.consistency - previous.consistency) / previous.consistency,
    ]

    return all(imp < 0.05 for imp in improvements)
```

---

## 第四部分：核心组件设计

### 4.1 KnowledgeHub（知识中枢）

```python
@dataclass
class KnowledgeHub:
    """知识中枢：管理 Agent 间的数据共享与事件通知。"""

    # 数据存储
    _entity_data: dict[str, EntityAnalysisResult]
    _service_data: dict[str, ServiceAnalysisResult]
    _flow_data: dict[str, FlowAnalysisResult]
    _lineage_data: list[FieldLineage]
    _topic_data: dict[str, TopicAnalysisResult]

    # 订阅关系
    _subscriptions: dict[str, list[Callable]]

    # 变更记录
    _change_log: list[ChangeRecord]
```

**核心方法：**

| 方法 | 功能 | 说明 |
|------|------|------|
| `publish(agent, data)` | 发布数据 | Agent 完成分析后发布结果 |
| `subscribe(event_type, callback)` | 订阅事件 | Agent 注册感兴趣的事件 |
| `query(agent, query_spec)` | 查询数据 | 按需获取其他 Agent 的结果 |
| `get_confidence(entity_id)` | 获取传播置信度 | 计算考虑依赖链的置信度 |
| `get_changes(since_version)` | 获取增量变更 | 只返回变化的数据 |

**事件类型：**

| 事件 | 触发时机 |
|------|---------|
| `ENTITY_ANALYZED` | EntityAgent 完成实体分析 |
| `SERVICE_ANALYZED` | ServiceAgent 完成服务分析 |
| `RELATIONSHIP_FOUND` | 发现新的实体关系 |
| `LINEAGE_TRACED` | LineageAgent 完成血缘追踪 |
| `TOPIC_DISCOVERED` | TopicAgent 发现新的消息主题 |

### 4.2 Arbitrator（仲裁器）

```python
@dataclass
class ArbitrationResult:
    """仲裁结果。"""
    responsible_agent: str           # 责任 Agent
    action: str                      # 建议动作
    confidence: float                # 仲裁置信度
    reason: str                      # 仲裁理由
    fallback_agents: list[str]       # 备选 Agent

class Arbitrator:
    """仲裁器：处理 Agent 间的责任归属和冲突解决。"""

    def arbitrate(self, conflict: Conflict) -> ArbitrationResult:
        """对冲突进行仲裁。"""
        rule = self._match_rule(conflict)
        if rule:
            return self._apply_rule(rule, conflict)
        else:
            return self._default_arbitration(conflict)
```

**仲裁规则：**

| Rule ID | 冲突类型 | 优先 Agent | 理由 | 修复动作 |
|---------|---------|-----------|------|---------|
| `ARB_001` | 关系-血缘矛盾 | EntityAgent | 注解驱动置信度更高 | LineageAgent 补充血缘 |
| `ARB_002` | 服务-Topic 不匹配 | ServiceAgent | 服务存在性更可信 | TopicAgent 重新检查 |
| `ARB_003` | 流程-实体关联缺失 | EntityAgent | 实体识别更准确 | FlowAgent 更新关联 |
| `ARB_004` | 血缘端点不存在 | LineageAgent | 血缘分析更深入 | EntityAgent 检查漏识别 |
| `ARB_005` | 置信度冲突 | 较高者 | 默认策略 | 较低者重新验证 |

### 4.3 IterationController V2

```python
class IterationController:
    """迭代控制器 V2：增量精炼 + 收敛检测。"""

    def __init__(self, config: IterationConfig):
        self.config = config
        self.iteration_count = 0
        self.quality_history: list[QualityMetrics] = []
        self.llm_call_count = 0
        self.pending_tasks: PriorityQueue[RefinementTask] = PriorityQueue()

    def should_continue(self, current_quality: QualityMetrics) -> bool:
        """判断是否应该继续迭代。"""
        # 检查迭代次数
        if self.iteration_count >= self.config.max_iterations:
            return False
        # 检查 LLM 预算
        if self.llm_call_count >= self.config.max_llm_calls:
            return False
        # 检查质量是否已达阈值
        if current_quality.overall_score >= self.config.quality_threshold:
            return False
        # 检查是否已收敛
        if self._check_convergence(current_quality):
            return False
        return True
```

### 4.4 DomainAgent 基类

```python
class DomainAgent(ABC):
    """领域 Agent 基类。"""

    name: str
    knowledge_hub: KnowledgeHub

    def run(self, context: AgentContext) -> AgentResult:
        """执行完整的分析流程。"""
        # Phase 1: Discovery
        candidates = self.discover(context)
        # Phase 2: Analysis
        analysis_results = self.analyze(candidates, context)
        # Phase 3: Validate
        validated_results = self.validate(analysis_results)
        return AgentResult(
            agent_name=self.name,
            nodes=validated_results.nodes,
            edges=validated_results.edges,
            quality=validated_results.quality,
        )

    def refine(self, task: RefinementTask) -> RefinementResult:
        """增量精炼：只重新分析受影响的部分。"""
        # 1. 定位受影响目标
        targets = self._locate_affected_targets(task)
        # 2. 只对这些目标重新分析
        new_results = [self._analyze_single(t) for t in targets]
        # 3. 局部验证
        validated = self.validate(new_results)
        # 4. 更新缓存
        self._update_cache(validated)
        return RefinementResult(
            refined_count=len(validated),
            quality_delta=self._calculate_quality_delta(validated),
        )

    @abstractmethod
    def discover(self, context: AgentContext) -> list[Candidate]:
        pass

    @abstractmethod
    def analyze(self, candidates: list[Candidate], context: AgentContext) -> list[AnalysisResult]:
        pass

    @abstractmethod
    def validate(self, results: list[AnalysisResult]) -> ValidatedResult:
        pass
```

---

## 第五部分：Agent 间协作流程

### 5.1 整体执行流程

```
Phase 0: 初始化
    │
    ├─▶ 创建 KnowledgeHub
    ├─▶ 创建各 DomainAgent，注入 KnowledgeHub
    ├─▶ 创建 Arbitrator
    └─▶ 创建 IterationController
    │
Phase 1: 并行发现与分析
    │
    ├─▶ EntityAgent.run() ────┐
    ├─▶ ServiceAgent.run() ───┼─▶ 并行执行
    ├─▶ FlowAgent.run() ──────┤
    ├─▶ TopicAgent.run() ─────┘
    │
    └─▶ KnowledgeHub.publish()（触发订阅事件）
    │
Phase 2: 依赖分析
    │
    └─▶ LineageAgent.run()（订阅 EntityAgent 和 ServiceAgent 完成事件）
    │
Phase 3: 交叉验证与迭代精炼
    │
    └─▶ while iteration < max_iterations:
            ├─▶ CrossValidationLayer.execute()
            ├─▶ 检查质量阈值和收敛
            ├─▶ Arbitrator.arbitrate()
            ├─▶ Agent.refine()
            └─▶ KnowledgeHub.update()
    │
Phase 4: 描述生成
    │
    └─▶ DescriptionGenerator.run()
    │
Phase 5: 图谱构建
    │
    └─▶ GraphBuilder.build()
```

### 5.2 知识共享与事件订阅

```
发布事件                              订阅处理
────────                             ────────

EntityAgent                          KnowledgeHub
    │                                     │
    │  ENTITY_ANALYZED ──────────────────▶│ 事件总线
    │                                     │     │
    │                                     │     ├──▶ LineageAgent.on_notify()
    │                                     │     │    (订阅: 实体完成)
    │                                     │     │
ServiceAgent                            │     └──▶ FlowAgent.on_notify()
    │                                     │          (订阅: 实体完成)
    │  SERVICE_ANALYZED ─────────────────▶│
    │                                     │
    │                                     │     ├──▶ LineageAgent.on_notify()
    │                                     │     │
    │                                     │     └──▶ TopicAgent.on_notify()
    │                                     │
TopicAgent                              │
    │                                     │
    │  TOPIC_DISCOVERED ─────────────────▶│
    │                                     │
    │                                     │     └──▶ LineageAgent.on_notify()
```

### 5.3 置信度传递计算

```python
def get_propagated_confidence(node_id: str) -> float:
    """计算传播置信度。"""
    # 获取节点基础置信度
    base_confidence = get_base_confidence(node_id)

    # 获取上游依赖节点
    dependencies = get_upstream_dependencies(node_id)

    # 计算传播置信度
    min_upstream = min(
        get_propagated_confidence(dep)  # 递归计算
        for dep in dependencies
    )

    # 衰减因子
    decay = 0.85 ** dependency_depth(node_id)

    propagated = base_confidence * decay * min_upstream
    return min(propagated, 1.0)
```

**置信度计算示例：**

场景：分析 `OrderItem.orderId` 字段的血缘

1. EntityAgent 分析 `Order` 实体 → 置信度 0.85
2. EntityAgent 分析 `OrderItem` 实体 → 置信度 0.90
3. EntityAgent 分析 `OrderItem.orderId` 外键关系 → 置信度 0.88
4. LineageAgent 分析 `Order.uuid → OrderItem.orderId` 血缘
   - 依赖链：`Order(0.85) → OrderItem(0.90) → orderId(0.88)`
   - 传播置信度 = `0.88 * 0.85 * min(0.85, 0.90) = 0.64`

---

## 第六部分：工具体系设计

### 6.1 工具分层架构

```
┌─────────────────────────────────────────────────────────────────┐
│  第一层：基础探索工具 (所有 Agent 共享)                          │
│  list_directory | search_code | read_file | read_lines         │
│  find_files | grep_pattern | get_file_info | list_imports      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  第二层：语义分析工具                                            │
│  extract_annotations | extract_classes | extract_methods        │
│  extract_fields | extract_call_graph | analyze_inheritance      │
│  infer_field_mapping | detect_patterns                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  第三层：框架专用工具                                            │
│  spring_di_resolver | spring_http_mapping | spring_transaction  │
│  spring_kafka_listener | jpa_entity_analyzer | jpa_relation     │
│  mybatis_mapper                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  第四层：高级推理工具 (需要 LLM 参与)                            │
│  trace_data_flow | infer_biz_semantics | validate_consistency   │
│  explain_code | resolve_ambiguity | cross_file_follow           │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 基础探索工具

| 工具名 | 描述 | 参数 |
|--------|------|------|
| `list_directory` | 列出目录内容 | path, recursive, file_pattern |
| `search_code` | 搜索代码模式 | pattern, file_pattern, context_lines |
| `read_file` | 读取文件全文 | path, max_size |
| `read_lines` | 读取指定行范围 | path, start_line, end_line |
| `find_files` | 查找文件 | pattern, path |
| `grep_pattern` | 正则匹配提取 | path, pattern, extract_groups |
| `get_file_info` | 获取文件元信息 | path |
| `list_imports` | 列出 import 语句 | path |

### 6.3 语义分析工具

| 工具名 | 描述 | 参数 |
|--------|------|------|
| `extract_annotations` | 提取注解 | path, annotation_filter |
| `extract_classes` | 提取类定义 | path |
| `extract_methods` | 提取方法 | path, class_name |
| `extract_fields` | 提取字段 | path, class_name |
| `extract_call_graph` | 提取调用图 | path, method_name, depth |
| `analyze_inheritance` | 分析继承结构 | path, class_name |
| `infer_field_mapping` | 推断字段映射 | path, class_name |
| `detect_patterns` | 检测设计模式 | path, pattern_types |

### 6.4 框架专用工具

| 工具名 | 描述 | 参数 |
|--------|------|------|
| `spring_di_resolver` | 解析 DI 依赖 | path, class_name |
| `spring_http_mapping` | 提取 HTTP 映射 | path, class_name |
| `spring_transaction_boundary` | 分析事务边界 | path, class_name |
| `spring_kafka_listener` | 分析 Kafka 监听器 | path |
| `jpa_entity_analyzer` | 分析 JPA 实体 | path, class_name |
| `jpa_relation_resolver` | 解析 JPA 关系 | path, class_name |
| `mybatis_mapper` | 分析 MyBatis 映射 | mapper_path, xml_path |

### 6.5 高级推理工具

| 工具名 | 描述 | 参数 |
|--------|------|------|
| `trace_data_flow` | 追踪数据流 | start_entity, start_field, max_depth |
| `infer_biz_semantics` | 推断业务语义 | code_snippet, context |
| `validate_consistency` | 验证一致性 | items, consistency_type |
| `explain_code` | 解释代码 | path, start_line, end_line, explain_level |
| `resolve_ambiguity` | 解决歧义 | ambiguous_item, candidates, evidence |
| `cross_file_follow` | 跨文件追踪 | symbol_name, from_file, follow_type |

---

## 第七部分：数据结构定义

### 7.1 精炼任务

```python
@dataclass
class RefinementTask:
    """精炼任务。"""
    task_id: str                           # 任务 ID
    target_agent: str                      # 目标 Agent
    trigger_type: str                      # "quality_threshold" | "cross_validation"
    issue_description: str                 # 问题描述
    related_entities: list[str]            # 相关实体
    suggested_action: str                  # 建议动作
    context: dict                          # 额外上下文
    priority: int = 1                      # 优先级 (1-5)
```

### 7.2 交叉验证结果

```python
@dataclass
class CrossValidationResult:
    """交叉验证结果。"""
    conflicts: list[Conflict]              # 发现的矛盾
    quality_metrics: QualityMetrics        # 质量指标
    total_checks: int                      # 总检查数
    passed_checks: int                     # 通过数
    failed_checks: int                     # 失败数

@dataclass
class Conflict:
    """矛盾项。"""
    conflict_id: str
    conflict_type: str
    source_agent: str
    target_agent: str
    source_data: dict
    target_data: dict | None
    severity: str                          # "error" | "warning" | "info"
    affected_entities: list[str]
    affected_relationships: list[str]
    suggested_fix: str | None
```

### 7.3 质量指标

```python
@dataclass
class QualityMetrics:
    """质量指标。"""
    avg_confidence: float                  # 平均置信度
    coverage: float                        # 覆盖率
    consistency: float                     # 一致性
    overall_score: float                   # 综合评分

    # 详细指标
    entity_count: int
    field_count: int
    relationship_count: int
    lineage_count: int

    # 问题统计
    low_confidence_count: int
    missing_field_count: int
    broken_reference_count: int
```

---

## 第八部分：实现计划

### 8.1 实现阶段

| 阶段 | 内容 | 预估工作量 |
|------|------|-----------|
| **Phase 1** | 基础架构搭建 | 2 天 |
| - | KnowledgeHub 实现 | |
| - | DomainAgent 基类 | |
| - | ToolExecutor 框架 | |
| **Phase 2** | 领域 Agent 实现 | 3 天 |
| - | EntityAgent | |
| - | ServiceAgent | |
| - | LineageAgent | |
| - | FlowAgent | |
| - | TopicAgent | |
| **Phase 3** | 协作机制实现 | 2 天 |
| - | CrossValidationLayer | |
| - | Arbitrator | |
| - | IterationController V2 | |
| **Phase 4** | 工具实现 | 3 天 |
| - | 基础工具 | |
| - | 语义分析工具 | |
| - | 框架专用工具 | |
| - | 高级推理工具 | |
| **Phase 5** | 集成与测试 | 2 天 |
| - | Pipeline 集成 | |
| - | 单元测试 | |
| - | 集成测试 | |

### 8.2 文件结构

```
backend/
├── agent/
│   ├── base_agent.py              # DomainAgent 基类
│   ├── entity_agent.py            # EntityAgent
│   ├── service_agent.py           # ServiceAgent
│   ├── flow_agent.py              # FlowAgent
│   ├── lineage_agent.py           # LineageAgent
│   ├── topic_agent.py             # TopicAgent
│   └── orchestrator.py            # AgentOrchestrator
│
├── tools/
│   ├── base_tools.py              # 基础探索工具
│   ├── semantic_tools.py          # 语义分析工具
│   ├── spring_tools.py            # Spring 框架工具
│   ├── jpa_tools.py               # JPA 工具
│   ├── advanced_tools.py          # 高级推理工具
│   └── executor.py                # ToolExecutor
│
├── validation/
│   ├── cross_validation.py        # CrossValidationLayer
│   ├── arbitrator.py              # Arbitrator
│   └── rules.py                   # 验证规则定义
│
├── knowledge/
│   ├── hub.py                     # KnowledgeHub
│   ├── events.py                  # 事件定义
│   └── confidence.py              # 置信度计算
│
└── pipeline/
    ├── ai_first_pipeline_v2.py    # 新版 Pipeline
    └── iteration_controller.py    # IterationController V2
```

---

## 第九部分：风险与缓解措施

### 9.1 技术风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| LLM 调用过多导致成本增加 | 高 | 预算控制、缓存机制、收敛检测 |
| Agent 间数据不一致 | 中 | KnowledgeHub 统一管理、版本控制 |
| 迭代不收敛 | 中 | 最大迭代次数限制、收敛检测 |
| 工具执行失败 | 低 | 错误处理、降级策略 |

### 9.2 兼容性风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 与现有 Pipeline 冲突 | 中 | 保持接口兼容、渐进式迁移 |
| 数据模型变更 | 中 | 向后兼容、数据迁移脚本 |

---

## 附录：参考文档

- `backend/pipeline/ai_first_pipeline.py` - 现有 AI 优先流水线
- `backend/pipeline/static_first_pipeline.py` - 静态优先流水线
- `backend/agent/` - 现有 Agent 实现
- `backend/graph/graph_schema.py` - 图谱数据模型
