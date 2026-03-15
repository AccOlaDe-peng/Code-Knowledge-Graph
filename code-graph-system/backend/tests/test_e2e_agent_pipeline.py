# code-graph-system/backend/tests/test_e2e_agent_pipeline.py
"""端到端测试 Agent 分析流水线。"""
import tempfile
from pathlib import Path


def test_e2e_module_detector_with_sample_repo():
    """端到端测试：使用示例仓库测试 ModuleDetectorAgent。"""
    from unittest.mock import patch, MagicMock
    from backend.agent.context import AgentContext
    from backend.agent.agents.module_detector import ModuleDetectorAgent
    from backend.llm.client import LLMClient
    from backend.graph.graph_schema import GraphNode

    # 创建临时测试仓库
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)

        # 创建示例文件结构
        (tmp_path / "main.py").write_text("""
from services.user import UserService
from services.auth import AuthService

def main():
    user_service = UserService()
    auth_service = AuthService()

if __name__ == "__main__":
    main()
""")
        (tmp_path / "services").mkdir()
        (tmp_path / "services" / "__init__.py").write_text("")
        (tmp_path / "services" / "user.py").write_text("""
class UserService:
    def get_user(self, user_id):
        pass
""")
        (tmp_path / "services" / "auth.py").write_text("""
class AuthService:
    def login(self, username, password):
        pass
""")
        (tmp_path / "pyproject.toml").write_text("""
[project]
name = "test-app"
version = "0.1.0"
""")

        # 创建 Agent
        context = AgentContext(
            repo_path=str(tmp_path),
            module_id=f"repo:{tmp_path.name}",
        )
        llm_client = LLMClient(provider="anthropic", api_key="test")
        agent = ModuleDetectorAgent(context=context, llm_client=llm_client)

        # 验证工具已注册
        tool_names = [t["name"] for t in agent._tools]
        assert "read_file" in tool_names
        assert "list_directory" in tool_names
        assert "search_code" in tool_names

        # 验证 FileTools 可用
        result = agent._file_tools.list_directory(max_depth=2)
        assert result["success"] == True
        assert any("main.py" in e["path"] for e in result["entries"])


def test_e2e_orchestrator_full_pipeline():
    """端到端测试：完整流水线执行。"""
    from unittest.mock import patch, MagicMock
    from backend.agent.orchestrator import AgentOrchestrator
    from backend.llm.client import LLMClient
    from backend.graph.graph_schema import GraphNode, GraphEdge

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        (tmp_path / "main.py").write_text("def main(): pass")

        llm_client = LLMClient(provider="anthropic", api_key="test")
        orchestrator = AgentOrchestrator(
            repo_path=str(tmp_path),
            llm_client=llm_client,
        )

        # Mock ModuleDetectorAgent
        with patch('backend.agent.orchestrator.ModuleDetectorAgent') as MockAgent:
            mock_instance = MagicMock()
            mock_instance.run.return_value = MagicMock(
                status="success",
                nodes=[
                    GraphNode(
                        id="module:main",
                        type="Module",
                        name="Main",
                        properties={"path": "main.py"}
                    )
                ],
                edges=[],
            )
            MockAgent.return_value = mock_instance

            result = orchestrator.run_all()

            assert result.status == "success"
            assert len(result.nodes) == 1
            assert result.nodes[0].type == "Module"


def test_e2e_schema_validation():
    """端到端测试：验证生成的图谱。"""
    from backend.validation.schema_validator import SchemaValidator
    from backend.graph.graph_schema import GraphNode, GraphEdge

    validator = SchemaValidator()

    # 创建有效的图谱
    nodes = [
        GraphNode(id="module:auth", type="Module", name="Auth"),
        GraphNode(id="module:user", type="Module", name="User"),
        GraphNode(id="func:login", type="Function", name="login"),
    ]
    edges = [
        GraphEdge(from_="module:auth", to="module:user", type="depends_on"),
        GraphEdge(from_="module:auth", to="func:login", type="contains"),
    ]

    result = validator.validate_graph(nodes, edges)
    assert result.valid == True

    # 测试无效图谱（重复 ID）
    nodes_invalid = [
        GraphNode(id="module:dup", type="Module", name="First"),
        GraphNode(id="module:dup", type="Module", name="Second"),
    ]
    result_invalid = validator.validate_graph(nodes_invalid, [])
    assert result_invalid.valid == False