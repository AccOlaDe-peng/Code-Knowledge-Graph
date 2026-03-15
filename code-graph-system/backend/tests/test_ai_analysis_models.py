# code-graph-system/backend/tests/test_ai_analysis_models.py
"""测试 AI 分析数据模型。"""


def test_module_info_creation():
    """测试 ModuleInfo 可以创建。"""
    from backend.models.ai_analysis import ModuleInfo

    module = ModuleInfo(
        id="module:user-service",
        name="UserService",
        files=["services/user/main.py", "services/user/models.py"],
        purpose="用户管理服务，处理用户注册、登录、资料管理",
        language="python",
        confidence=0.85
    )

    assert module.id == "module:user-service"
    assert module.name == "UserService"
    assert len(module.files) == 2
    assert "services/user/main.py" in module.files
    assert module.purpose == "用户管理服务，处理用户注册、登录、资料管理"
    assert module.language == "python"
    assert module.confidence == 0.85


def test_module_info_defaults():
    """测试 ModuleInfo 默认值。"""
    from backend.models.ai_analysis import ModuleInfo

    module = ModuleInfo(
        id="module:auth",
        name="Auth",
        files=["auth.py"],
        purpose="认证模块"
    )

    assert module.language == ""
    assert module.confidence == 1.0


def test_module_plan_creation():
    """测试 ModulePlan 可以创建。"""
    from backend.models.ai_analysis import ModulePlan, ModuleInfo

    modules = [
        ModuleInfo(
            id="module:api",
            name="API",
            files=["api/"],
            purpose="API 层"
        ),
        ModuleInfo(
            id="module:service",
            name="Service",
            files=["service/"],
            purpose="业务逻辑层"
        )
    ]

    plan = ModulePlan(
        modules=modules,
        architecture_hints={"pattern": "layered", "layers": 3},
        confidence=0.9
    )

    assert len(plan.modules) == 2
    assert plan.modules[0].name == "API"
    assert plan.architecture_hints["pattern"] == "layered"
    assert plan.confidence == 0.9


def test_module_plan_defaults():
    """测试 ModulePlan 默认值。"""
    from backend.models.ai_analysis import ModulePlan

    plan = ModulePlan(modules=[])

    assert plan.architecture_hints == {}
    assert plan.confidence == 1.0


def test_ai_analysis_config_defaults():
    """测试 AIAnalysisConfig 默认值。"""
    from backend.models.ai_analysis import AIAnalysisConfig

    config = AIAnalysisConfig()

    assert config.provider == "anthropic"
    assert config.model == ""
    assert config.max_tokens == 16384
    assert config.temperature == 0.1
    assert config.max_parallel_modules == 5
    assert config.max_files_per_module == 50
    assert config.max_tokens_per_module == 32000
    assert config.cache_enabled == True
    assert config.cache_dir == "data/ai_cache"
    assert config.retry_count == 2
    assert config.retry_delay_seconds == 2.0
    assert config.timeout_seconds == 120.0


def test_ai_analysis_config_custom():
    """测试 AIAnalysisConfig 自定义值。"""
    from backend.models.ai_analysis import AIAnalysisConfig

    config = AIAnalysisConfig(
        provider="openai",
        model="gpt-4",
        max_tokens=32768,
        temperature=0.2,
        max_parallel_modules=10,
        cache_enabled=False
    )

    assert config.provider == "openai"
    assert config.model == "gpt-4"
    assert config.max_tokens == 32768
    assert config.temperature == 0.2
    assert config.max_parallel_modules == 10
    assert config.cache_enabled == False


def test_failed_module_creation():
    """测试 FailedModule 可以创建。"""
    from backend.models.ai_analysis import FailedModule

    failed = FailedModule(
        module_id="module:legacy",
        reason="文件过大，超出 token 限制",
        files_attempted=["legacy/huge_file.py", "legacy/another.py"]
    )

    assert failed.module_id == "module:legacy"
    assert failed.reason == "文件过大，超出 token 限制"
    assert len(failed.files_attempted) == 2


def test_failed_module_defaults():
    """测试 FailedModule 默认值。"""
    from backend.models.ai_analysis import FailedModule

    failed = FailedModule(
        module_id="module:test",
        reason="测试失败"
    )

    assert failed.files_attempted == []


def test_ai_analysis_result_creation():
    """测试 AIAnalysisResult 可以创建。"""
    from backend.models.ai_analysis import AIAnalysisResult
    from backend.graph.graph_schema import GraphNode, GraphEdge

    nodes = [
        GraphNode(id="func:login", type="Function", name="login", properties={}),
        GraphNode(id="func:logout", type="Function", name="logout", properties={})
    ]
    edges = [
        GraphEdge(from_="func:login", to="func:logout", type="calls", properties={})
    ]

    result = AIAnalysisResult(
        graph_id="graph-123",
        nodes=nodes,
        edges=edges,
        status="success",
        duration_seconds=15.5
    )

    assert result.graph_id == "graph-123"
    assert result.node_count == 2
    assert result.edge_count == 1
    assert result.status == "success"
    assert result.duration_seconds == 15.5


def test_ai_analysis_result_properties():
    """测试 AIAnalysisResult 的属性。"""
    from backend.models.ai_analysis import AIAnalysisResult
    from backend.graph.graph_schema import GraphNode

    result = AIAnalysisResult(
        graph_id="graph-456",
        nodes=[
            GraphNode(id="n1", type="Function", name="f1", properties={}),
            GraphNode(id="n2", type="Class", name="c1", properties={}),
            GraphNode(id="n3", type="Module", name="m1", properties={})
        ],
        edges=[],
        status="partial"
    )

    assert result.node_count == 3
    assert result.edge_count == 0


def test_ai_analysis_result_with_failures():
    """测试 AIAnalysisResult 包含失败模块。"""
    from backend.models.ai_analysis import AIAnalysisResult, FailedModule
    from backend.graph.graph_schema import GraphNode

    result = AIAnalysisResult(
        graph_id="graph-789",
        nodes=[GraphNode(id="n1", type="Function", name="f1", properties={})],
        edges=[],
        status="partial",
        failed_modules=[
            FailedModule(module_id="module:legacy", reason="Token 限制"),
            FailedModule(module_id="module:external", reason="解析错误")
        ],
        warnings=["部分模块分析失败"]
    )

    assert result.status == "partial"
    assert len(result.failed_modules) == 2
    assert result.failed_modules[0].module_id == "module:legacy"
    assert len(result.warnings) == 1


def test_ai_analysis_result_defaults():
    """测试 AIAnalysisResult 默认值。"""
    from backend.models.ai_analysis import AIAnalysisResult

    result = AIAnalysisResult(
        graph_id="graph-default",
        nodes=[],
        edges=[],
        status="success"
    )

    assert result.failed_modules == []
    assert result.warnings == []
    assert result.duration_seconds == 0.0
