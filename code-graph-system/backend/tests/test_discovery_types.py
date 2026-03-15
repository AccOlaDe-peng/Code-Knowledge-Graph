# code-graph-system/backend/tests/test_discovery_types.py
"""测试 Discovery 数据模型。"""


def test_module_discovery_creation():
    """测试 ModuleDiscovery 可以创建。"""
    from backend.models.discovery import ModuleDiscovery

    module = ModuleDiscovery(
        module_id="module:user-service",
        name="UserService",
        path="services/user",
        module_type="service",
        language="python",
        framework="fastapi",
        entry_points=["main.py"],
        dependencies=["module:auth"],
        confidence=0.85
    )

    assert module.module_id == "module:user-service"
    assert module.name == "UserService"
    assert module.path == "services/user"
    assert module.confidence == 0.85


def test_function_discovery_creation():
    """测试 FunctionDiscovery 可以创建。"""
    from backend.models.discovery import FunctionDiscovery

    func = FunctionDiscovery(
        function_id="func:login",
        name="login",
        file_path="auth/login.py",
        line_start=10,
        line_end=25,
        signature="def login(username: str, password: str) -> Token",
        is_async=False,
        is_entry_point=True,
        side_effects=["db_read", "db_write"],
        calls_to=["func:validate_user"],
        called_by=[],
        confidence=0.9
    )

    assert func.function_id == "func:login"
    assert func.is_entry_point == True
    assert "db_read" in func.side_effects


def test_discovery_registry_query():
    """测试 DiscoveryRegistry 可以查询。"""
    from backend.models.discovery import (
        DiscoveryRegistry,
        ModuleDiscovery,
        FunctionDiscovery,
    )

    registry = DiscoveryRegistry()
    registry.modules.append(ModuleDiscovery(
        module_id="module:auth",
        name="AuthService",
        path="services/auth",
        module_type="service",
        language="python",
    ))
    registry.functions.append(FunctionDiscovery(
        function_id="func:login",
        name="login",
        file_path="auth/login.py",
        line_start=10,
        line_end=25,
    ))

    # 查询所有模块
    modules = registry.query("modules")
    assert len(modules) == 1
    assert modules[0].name == "AuthService"

    # 查询所有函数
    functions = registry.query("functions")
    assert len(functions) == 1
    assert functions[0].name == "login"
