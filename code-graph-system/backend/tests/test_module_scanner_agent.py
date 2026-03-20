"""测试 ModuleScannerAgent。"""

import json
from unittest.mock import MagicMock, patch

import pytest

from backend.agent.context import AgentContext
from backend.llm.client import LLMClient
from backend.models.ai_analysis import ModuleInfo, ModulePlan
from backend.scanner.repo_scanner import FileInfo, ScanResult


class TestModuleScannerAgentCreation:
    """测试 ModuleScannerAgent 创建。"""

    def test_agent_creation_with_mock_llm(self):
        """测试使用 mock LLM 客户端创建 agent。"""
        from backend.agent.agents.module_scanner import ModuleScannerAgent

        context = AgentContext(repo_path="/test/repo", module_id="module:root")
        llm_client = MagicMock(spec=LLMClient)

        agent = ModuleScannerAgent(context=context, llm_client=llm_client)

        assert agent.agent_type == "module_scanner"
        assert agent.context == context
        assert agent.llm_client == llm_client

    def test_agent_has_system_prompt(self):
        """测试 agent 有系统提示词。"""
        from backend.agent.agents.module_scanner import ModuleScannerAgent

        context = AgentContext(repo_path="/test/repo", module_id="module:root")
        llm_client = MagicMock(spec=LLMClient)

        agent = ModuleScannerAgent(context=context, llm_client=llm_client)

        system_prompt = agent.get_system_prompt()
        assert isinstance(system_prompt, str)
        assert len(system_prompt) > 0
        assert "module" in system_prompt.lower() or "模块" in system_prompt


class TestModuleScannerAgentFileTree:
    """测试文件树构建。"""

    def test_build_file_tree_basic(self):
        """测试基本文件树构建。"""
        from backend.agent.agents.module_scanner import ModuleScannerAgent

        context = AgentContext(repo_path="/test/repo", module_id="module:root")
        llm_client = MagicMock(spec=LLMClient)

        agent = ModuleScannerAgent(context=context, llm_client=llm_client)

        files = [
            FileInfo(path="src/main.py", abs_path="/test/repo/src/main.py", language="python"),
            FileInfo(path="src/utils.py", abs_path="/test/repo/src/utils.py", language="python"),
            FileInfo(path="tests/test_main.py", abs_path="/test/repo/tests/test_main.py", language="python"),
        ]

        tree = agent._build_file_tree(files)

        assert "src/" in tree
        assert "main.py" in tree
        assert "utils.py" in tree
        assert "tests/" in tree

    def test_build_file_tree_empty(self):
        """测试空文件列表返回空字符串。"""
        from backend.agent.agents.module_scanner import ModuleScannerAgent

        context = AgentContext(repo_path="/test/repo", module_id="module:root")
        llm_client = MagicMock(spec=LLMClient)

        agent = ModuleScannerAgent(context=context, llm_client=llm_client)

        tree = agent._build_file_tree([])

        assert tree == ""

    def test_build_file_tree_includes_language(self):
        """测试文件树包含语言信息。"""
        from backend.agent.agents.module_scanner import ModuleScannerAgent

        context = AgentContext(repo_path="/test/repo", module_id="module:root")
        llm_client = MagicMock(spec=LLMClient)

        agent = ModuleScannerAgent(context=context, llm_client=llm_client)

        files = [
            FileInfo(path="app.py", abs_path="/test/repo/app.py", language="python"),
            FileInfo(path="index.ts", abs_path="/test/repo/index.ts", language="typescript"),
        ]

        tree = agent._build_file_tree(files)

        assert "python" in tree
        assert "typescript" in tree


class TestModuleScannerAgentScan:
    """测试 scan 方法。"""

    def test_scan_returns_module_plan(self):
        """测试 scan 返回 ModulePlan。"""
        from backend.agent.agents.module_scanner import ModuleScannerAgent

        context = AgentContext(repo_path="/test/repo", module_id="module:root")
        llm_client = MagicMock(spec=LLMClient)

        # 模拟 LLM 返回
        llm_response = json.dumps({
            "modules": [
                {
                    "id": "module:api",
                    "name": "API",
                    "files": ["src/api/handlers.py"],
                    "purpose": "REST API handlers",
                    "language": "python",
                    "confidence": 0.9
                }
            ],
            "architecture_hints": {
                "pattern": "layered",
                "layers": ["api", "service", "data"]
            }
        })
        llm_client.complete.return_value = llm_response

        agent = ModuleScannerAgent(context=context, llm_client=llm_client)

        # 创建 ScanResult
        scan_result = ScanResult(
            repo_path="/test/repo",
            repo_name="test-repo",
            files=[
                FileInfo(path="src/api/handlers.py", abs_path="/test/repo/src/api/handlers.py", language="python"),
            ],
            language_stats={"python": 1},
        )

        plan = agent.scan(scan_result)

        assert isinstance(plan, ModulePlan)
        assert len(plan.modules) == 1
        assert plan.modules[0].id == "module:api"
        assert plan.modules[0].name == "API"
        assert plan.architecture_hints["pattern"] == "layered"

    def test_scan_with_empty_files_returns_empty_plan(self):
        """测试空文件列表返回空 ModulePlan。"""
        from backend.agent.agents.module_scanner import ModuleScannerAgent

        context = AgentContext(repo_path="/test/repo", module_id="module:root")
        llm_client = MagicMock(spec=LLMClient)

        agent = ModuleScannerAgent(context=context, llm_client=llm_client)

        scan_result = ScanResult(
            repo_path="/test/repo",
            repo_name="empty-repo",
            files=[],
        )

        plan = agent.scan(scan_result)

        assert isinstance(plan, ModulePlan)
        assert len(plan.modules) == 0

    def test_scan_handles_llm_failure_gracefully(self):
        """测试 LLM 失败时优雅处理。"""
        from backend.agent.agents.module_scanner import ModuleScannerAgent

        context = AgentContext(repo_path="/test/repo", module_id="module:root")
        llm_client = MagicMock(spec=LLMClient)

        # 模拟 LLM 抛出异常
        llm_client.complete.side_effect = Exception("LLM service unavailable")

        agent = ModuleScannerAgent(context=context, llm_client=llm_client)

        scan_result = ScanResult(
            repo_path="/test/repo",
            repo_name="test-repo",
            files=[
                FileInfo(path="main.py", abs_path="/test/repo/main.py", language="python"),
            ],
        )

        # 不应该抛出异常，返回空 plan
        plan = agent.scan(scan_result)

        assert isinstance(plan, ModulePlan)
        assert len(plan.modules) == 0


class TestModuleScannerAgentResponseParsing:
    """测试 LLM 响应解析。"""

    def test_parse_valid_json_response(self):
        """测试解析有效 JSON 响应。"""
        from backend.agent.agents.module_scanner import ModuleScannerAgent

        context = AgentContext(repo_path="/test/repo", module_id="module:root")
        llm_client = MagicMock(spec=LLMClient)

        agent = ModuleScannerAgent(context=context, llm_client=llm_client)

        response = json.dumps({
            "modules": [
                {
                    "id": "module:core",
                    "name": "Core",
                    "files": ["core/main.py"],
                    "purpose": "Core business logic",
                    "language": "python",
                    "confidence": 0.95
                }
            ],
            "architecture_hints": {}
        })

        plan = agent._parse_response(response)

        assert isinstance(plan, ModulePlan)
        assert len(plan.modules) == 1
        assert plan.modules[0].name == "Core"
        assert plan.modules[0].confidence == 0.95

    def test_parse_json_in_code_blocks(self):
        """测试解析代码块中的 JSON。"""
        from backend.agent.agents.module_scanner import ModuleScannerAgent

        context = AgentContext(repo_path="/test/repo", module_id="module:root")
        llm_client = MagicMock(spec=LLMClient)

        agent = ModuleScannerAgent(context=context, llm_client=llm_client)

        response = """Here is the analysis result:

```json
{
    "modules": [
        {
            "id": "module:utils",
            "name": "Utils",
            "files": ["utils/helpers.py"],
            "purpose": "Utility functions",
            "language": "python"
        }
    ]
}
```
"""
        plan = agent._parse_response(response)

        assert isinstance(plan, ModulePlan)
        assert len(plan.modules) == 1
        assert plan.modules[0].name == "Utils"

    def test_parse_invalid_json_returns_empty_plan(self):
        """测试无效 JSON 返回空 ModulePlan。"""
        from backend.agent.agents.module_scanner import ModuleScannerAgent

        context = AgentContext(repo_path="/test/repo", module_id="module:root")
        llm_client = MagicMock(spec=LLMClient)

        agent = ModuleScannerAgent(context=context, llm_client=llm_client)

        response = "This is not valid JSON at all!"

        plan = agent._parse_response(response)

        assert isinstance(plan, ModulePlan)
        assert len(plan.modules) == 0

    def test_parse_partial_json_returns_partial_plan(self):
        """测试部分有效 JSON 返回部分结果。"""
        from backend.agent.agents.module_scanner import ModuleScannerAgent

        context = AgentContext(repo_path="/test/repo", module_id="module:root")
        llm_client = MagicMock(spec=LLMClient)

        agent = ModuleScannerAgent(context=context, llm_client=llm_client)

        # 缺少某些字段但有 modules
        response = json.dumps({
            "modules": [
                {
                    "id": "module:partial",
                    "name": "Partial",
                    "files": ["partial.py"],
                    "purpose": "Partial module"
                    # 缺少 language 和 confidence
                }
            ]
        })

        plan = agent._parse_response(response)

        assert isinstance(plan, ModulePlan)
        assert len(plan.modules) == 1
        assert plan.modules[0].language == ""  # 默认值
        assert plan.modules[0].confidence == 1.0  # 默认值


class TestModuleScannerAgentPromptBuilding:
    """测试提示词构建。"""

    def test_build_prompt_includes_file_tree(self):
        """测试提示词包含文件树。"""
        from backend.agent.agents.module_scanner import ModuleScannerAgent

        context = AgentContext(repo_path="/test/repo", module_id="module:root")
        llm_client = MagicMock(spec=LLMClient)

        agent = ModuleScannerAgent(context=context, llm_client=llm_client)

        file_tree = "src/\n  main.py (python)\n  utils.py (python)"
        languages = ["python"]

        prompt = agent._build_prompt(file_tree, languages)

        assert file_tree in prompt
        assert "python" in prompt

    def test_build_prompt_includes_languages(self):
        """测试提示词包含语言信息。"""
        from backend.agent.agents.module_scanner import ModuleScannerAgent

        context = AgentContext(repo_path="/test/repo", module_id="module:root")
        llm_client = MagicMock(spec=LLMClient)

        agent = ModuleScannerAgent(context=context, llm_client=llm_client)

        file_tree = "src/\n  app.py (python)\n  index.ts (typescript)"
        languages = ["python", "typescript"]

        prompt = agent._build_prompt(file_tree, languages)

        assert "python" in prompt
        assert "typescript" in prompt


class TestAgentContextStructureIndexer:
    """测试 AgentContext 支持预构建 StructureIndexer。"""

    def test_context_accepts_structure_indexer(self):
        """AgentContext 接受 structure_indexer 可选字段。"""
        from backend.agent.structure_indexer import StructureIndexer

        indexer = StructureIndexer(depth="standard")
        ctx = AgentContext(
            repo_path="/tmp",
            module_id="test",
            structure_indexer=indexer,
        )
        assert ctx.structure_indexer is indexer

    def test_context_structure_indexer_defaults_to_none(self):
        """不传 structure_indexer 时默认为 None（向后兼容）。"""
        ctx = AgentContext(repo_path="/tmp", module_id="test")
        assert ctx.structure_indexer is None