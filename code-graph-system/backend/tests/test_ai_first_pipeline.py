"""AI 优先分析流水线单元测试。

测试各 Stage 的核心功能：
- AIRepositoryScanStage
- AIEntityAnalysisStage
- AIFieldLineageStage
- AIEntityDescriptionStage
- AIGraphBuildStage
- AIFirstPipeline
"""
from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock, patch, AsyncMock

import pytest

from backend.models.ai_first_analysis import (
    EntityCandidate,
    FieldInfo,
    RelationshipInfo,
    EntityAnalysisResult,
    FieldLineage,
    FieldLineageResult,
    EntityDescription,
    DescriptionResult,
    RepositoryScanResult,
)
from backend.graph.graph_schema import NodeType, EdgeType, GraphNode, GraphEdge


# ─────────────────────────────────────────────────────────────────────────────
# Test Fixtures
# ─────────────────────────────────────────────────────────────────────────────


@pytest.fixture
def sample_entity_candidate() -> EntityCandidate:
    """创建示例实体候选。"""
    return EntityCandidate(
        class_name="TestEntity",
        file_path="src/main/java/com/example/TestEntity.java",
        table_name="test_entity",
        primary_key="id",
        brief_description="测试实体",
    )


@pytest.fixture
def sample_field_info() -> FieldInfo:
    """创建示例字段信息。"""
    return FieldInfo(
        name="testField",
        type="String",
        column_name="test_field",
        is_primary_key=False,
        is_foreign_key=True,
        references_entity="OtherEntity",
        references_field="id",
        description="测试字段",
    )


@pytest.fixture
def sample_relationship_info() -> RelationshipInfo:
    """创建示例关系信息。"""
    return RelationshipInfo(
        relation_type="one_to_many",
        target_entity="OtherEntity",
        source_field="otherId",
        target_field="id",
        description="一对多关系",
    )


@pytest.fixture
def sample_entity_analysis_result() -> EntityAnalysisResult:
    """创建示例实体分析结果。"""
    return EntityAnalysisResult(
        entity_name="TestEntity",
        file_path="src/main/java/com/example/TestEntity.java",
        table_name="test_entity",
        primary_key="id",
        fields=[
            FieldInfo(name="id", type="Long", is_primary_key=True),
            FieldInfo(name="name", type="String"),
        ],
        relationships=[
            RelationshipInfo(
                relation_type="one_to_many",
                target_entity="OtherEntity",
            ),
        ],
    )


@pytest.fixture
def sample_field_lineage() -> FieldLineage:
    """创建示例字段血缘。"""
    return FieldLineage(
        from_entity="SourceEntity",
        from_field="sourceField",
        to_entity="TargetEntity",
        to_field="targetField",
        flow_type="direct",
        flow_pattern="API调用",
        description="直接传递",
    )


# ─────────────────────────────────────────────────────────────────────────────
# Test: Data Models
# ─────────────────────────────────────────────────────────────────────────────


class TestDataModels:
    """测试数据模型。"""

    def test_entity_candidate_creation(self, sample_entity_candidate: EntityCandidate):
        """测试实体候选创建。"""
        assert sample_entity_candidate.class_name == "TestEntity"
        assert sample_entity_candidate.table_name == "test_entity"
        assert sample_entity_candidate.primary_key == "id"

    def test_field_info_creation(self, sample_field_info: FieldInfo):
        """测试字段信息创建。"""
        assert sample_field_info.name == "testField"
        assert sample_field_info.is_foreign_key is True
        assert sample_field_info.references_entity == "OtherEntity"

    def test_relationship_info_creation(self, sample_relationship_info: RelationshipInfo):
        """测试关系信息创建。"""
        assert sample_relationship_info.relation_type == "one_to_many"
        assert sample_relationship_info.target_entity == "OtherEntity"

    def test_entity_analysis_result_creation(self, sample_entity_analysis_result: EntityAnalysisResult):
        """测试实体分析结果创建。"""
        assert sample_entity_analysis_result.entity_name == "TestEntity"
        assert len(sample_entity_analysis_result.fields) == 2
        assert len(sample_entity_analysis_result.relationships) == 1

    def test_field_lineage_creation(self, sample_field_lineage: FieldLineage):
        """测试字段血缘创建。"""
        assert sample_field_lineage.from_entity == "SourceEntity"
        assert sample_field_lineage.to_entity == "TargetEntity"
        assert sample_field_lineage.flow_type == "direct"

    def test_repository_scan_result(self):
        """测试仓库扫描结果。"""
        result = RepositoryScanResult(
            entities=[
                EntityCandidate(class_name="Entity1", file_path="path1"),
                EntityCandidate(class_name="Entity2", file_path="path2"),
            ],
            services=[],
        )
        assert len(result.entities) == 2
        assert result.stats == {}


# ─────────────────────────────────────────────────────────────────────────────
# Test: AIRepositoryScanStage
# ─────────────────────────────────────────────────────────────────────────────


class TestAIRepositoryScanStage:
    """测试 AI 仓库扫描 Stage。"""

    def test_stage_name(self):
        """测试 Stage 名称。"""
        from backend.pipeline.stages.ai_repository_scan import AIRepositoryScanStage
        stage = AIRepositoryScanStage()
        assert stage.name == "ai_repository_scan"

    @patch("backend.pipeline.stages.ai_repository_scan.AIRepositoryScanStage._call_llm_with_tools")
    def test_run_with_empty_response(self, mock_llm_call, tmp_path: Path):
        """测试空响应情况。"""
        from backend.pipeline.stages.ai_repository_scan import AIRepositoryScanStage

        # 返回 (response, stats) 元组
        mock_llm_call.return_value = (
            '{"entities": [], "flows": [], "flow_nodes": [], "services": [], "repositories": [], "topics": []}',
            {"status": "completed", "tool_calls": 5},
        )

        stage = AIRepositoryScanStage()
        mock_client = MagicMock()

        result = stage.run(
            repo_path=tmp_path,
            llm_client=mock_client,
        )

        assert result.entities == []
        assert result.flows == []
        assert result.services == []

    def test_extract_json_from_markdown(self):
        """测试从 Markdown 中提取 JSON。"""
        from backend.pipeline.stages.ai_repository_scan import AIRepositoryScanStage

        stage = AIRepositoryScanStage()

        # Markdown 代码块
        text = '```json\n{"entities": []}\n```'
        assert stage._extract_json(text) == '{"entities": []}'

        # 直接 JSON
        text = '{"entities": []}'
        assert stage._extract_json(text) == '{"entities": []}'

        # 混合文本
        text = '这是一些文本 {"entities": [{"name": "Test"}]} 更多文本'
        assert '{"entities": [{"name": "Test"}]}' in stage._extract_json(text)


# ─────────────────────────────────────────────────────────────────────────────
# Test: AIEntityAnalysisStage
# ─────────────────────────────────────────────────────────────────────────────


class TestAIEntityAnalysisStage:
    """测试 AI 实体分析 Stage。"""

    def test_stage_name(self):
        """测试 Stage 名称。"""
        from backend.pipeline.stages.ai_entity_analysis import AIEntityAnalysisStage
        stage = AIEntityAnalysisStage()
        assert stage.name == "ai_entity_analysis"

    def test_build_tools(self, tmp_path: Path):
        """测试工具构建。"""
        from backend.pipeline.stages.ai_entity_analysis import AIEntityAnalysisStage

        stage = AIEntityAnalysisStage()
        tools = stage._build_tools(tmp_path)

        assert len(tools) == 2
        assert tools[0]["function"]["name"] == "read_file"
        assert tools[1]["function"]["name"] == "search_code"

    def test_parse_response(self, sample_entity_candidate: EntityCandidate):
        """测试响应解析。"""
        from backend.pipeline.stages.ai_entity_analysis import AIEntityAnalysisStage

        stage = AIEntityAnalysisStage()

        response = json.dumps({
            "entity_name": "TestEntity",
            "table_name": "test_entity",
            "primary_key": "id",
            "fields": [
                {"name": "id", "type": "Long", "is_primary_key": True}
            ],
            "relationships": []
        })

        result = stage._parse_response(response, sample_entity_candidate)

        assert result is not None
        assert result.entity_name == "TestEntity"
        assert result.table_name == "test_entity"
        assert len(result.fields) == 1


# ─────────────────────────────────────────────────────────────────────────────
# Test: AIFieldLineageStage
# ─────────────────────────────────────────────────────────────────────────────


class TestAIFieldLineageStage:
    """测试 AI 字段血缘 Stage。"""

    def test_stage_name(self):
        """测试 Stage 名称。"""
        from backend.pipeline.stages.ai_field_lineage import AIFieldLineageStage
        stage = AIFieldLineageStage()
        assert stage.name == "ai_field_lineage"

    def test_build_entities_summary(self, sample_entity_analysis_result: EntityAnalysisResult):
        """测试实体摘要构建。"""
        from backend.pipeline.stages.ai_field_lineage import AIFieldLineageStage

        stage = AIFieldLineageStage()
        summary = stage._build_entities_summary([sample_entity_analysis_result])

        assert "TestEntity" in summary
        assert "test_entity" in summary

    def test_count_flow_types(self, sample_field_lineage: FieldLineage):
        """测试流转类型统计。"""
        from backend.pipeline.stages.ai_field_lineage import AIFieldLineageStage

        stage = AIFieldLineageStage()

        lineages = [
            FieldLineage(from_entity="A", from_field="f1", to_entity="B", to_field="f2", flow_type="direct"),
            FieldLineage(from_entity="B", from_field="f2", to_entity="C", to_field="f3", flow_type="transformed"),
            FieldLineage(from_entity="C", from_field="f3", to_entity="D", to_field="f4", flow_type="direct"),
        ]

        counts = stage._count_flow_types(lineages)

        assert counts["direct"] == 2
        assert counts["transformed"] == 1


# ─────────────────────────────────────────────────────────────────────────────
# Test: AIEntityDescriptionStage
# ─────────────────────────────────────────────────────────────────────────────


class TestAIEntityDescriptionStage:
    """测试 AI 实体描述 Stage。"""

    def test_stage_name(self):
        """测试 Stage 名称。"""
        from backend.pipeline.stages.ai_entity_description import AIEntityDescriptionStage
        stage = AIEntityDescriptionStage()
        assert stage.name == "ai_entity_description"

    def test_parse_entity_description(self, sample_entity_analysis_result: EntityAnalysisResult):
        """测试实体描述解析。"""
        from backend.pipeline.stages.ai_entity_description import AIEntityDescriptionStage

        stage = AIEntityDescriptionStage()

        response = json.dumps({
            "entity_name": "TestEntity",
            "summary": "测试实体摘要",
            "role_in_system": "测试用途",
            "core_fields": ["id", "name"],
            "importance_score": 8,
            "importance_reason": "核心实体",
        })

        result = stage._parse_entity_description(response, sample_entity_analysis_result)

        assert result is not None
        assert result.entity_name == "TestEntity"
        assert result.importance_score == 8
        assert "id" in result.core_fields


# ─────────────────────────────────────────────────────────────────────────────
# Test: AIGraphBuildStage
# ─────────────────────────────────────────────────────────────────────────────


class TestAIGraphBuildStage:
    """测试 AI 图谱构建 Stage。"""

    def test_stage_name(self):
        """测试 Stage 名称。"""
        from backend.pipeline.stages.ai_graph_build import AIGraphBuildStage
        stage = AIGraphBuildStage()
        assert stage.name == "ai_graph_build"

    def test_create_entity_nodes(self, sample_entity_analysis_result: EntityAnalysisResult):
        """测试创建实体节点。"""
        from backend.pipeline.stages.ai_graph_build import AIGraphBuildStage

        stage = AIGraphBuildStage()

        entity_desc_map = {
            "TestEntity": EntityDescription(
                entity_name="TestEntity",
                summary="测试实体",
                role_in_system="测试用途",
                importance_score=7,
            )
        }

        nodes = stage._create_entity_nodes([sample_entity_analysis_result], entity_desc_map)

        assert len(nodes) == 1
        assert nodes[0].type == NodeType.ENTITY.value
        assert nodes[0].name == "TestEntity"
        assert nodes[0].properties["table_name"] == "test_entity"

    def test_create_field_nodes(self, sample_entity_analysis_result: EntityAnalysisResult):
        """测试创建字段节点。"""
        from backend.pipeline.stages.ai_graph_build import AIGraphBuildStage

        stage = AIGraphBuildStage()

        nodes = stage._create_field_nodes([sample_entity_analysis_result], {})

        assert len(nodes) == 2  # id 和 name 字段
        assert all(n.type == NodeType.FIELD.value for n in nodes)

    def test_create_relationship_edges(self, sample_entity_analysis_result: EntityAnalysisResult):
        """测试创建关系边。"""
        from backend.pipeline.stages.ai_graph_build import AIGraphBuildStage

        stage = AIGraphBuildStage()

        edges = stage._create_relationship_edges([sample_entity_analysis_result])

        assert len(edges) == 1
        assert edges[0].type == EdgeType.ONE_TO_MANY.value

    def test_create_lineage_edges(self, sample_field_lineage: FieldLineage):
        """测试创建血缘边。"""
        from backend.pipeline.stages.ai_graph_build import AIGraphBuildStage

        stage = AIGraphBuildStage()

        lineage_result = FieldLineageResult(lineages=[sample_field_lineage])
        edges = stage._create_lineage_edges(lineage_result)

        assert len(edges) == 1
        assert edges[0].type == EdgeType.FLOW_TO.value
        assert edges[0].properties["flow_type"] == "direct"


# ─────────────────────────────────────────────────────────────────────────────
# Test: AIFirstPipeline
# ─────────────────────────────────────────────────────────────────────────────


class TestAIFirstPipeline:
    """测试 AI 优先流水线。"""

    def test_pipeline_initialization(self):
        """测试流水线初始化。"""
        from backend.pipeline.ai_first_pipeline import AIFirstPipeline

        pipeline = AIFirstPipeline()

        assert pipeline.max_workers == 3
        assert pipeline._repo is not None

    def test_pipeline_with_custom_config(self):
        """测试自定义配置。"""
        from backend.pipeline.ai_first_pipeline import AIFirstPipeline
        from backend.models.ai_analysis import AIAnalysisConfig

        config = AIAnalysisConfig(max_tokens=2000)
        pipeline = AIFirstPipeline(config=config, max_workers=5)

        assert pipeline.max_workers == 5

    @patch("backend.pipeline.ai_first_pipeline.AIFirstPipeline._create_llm_client")
    @patch("backend.pipeline.stages.ai_repository_scan.AIRepositoryScanStage.run")
    def test_pipeline_returns_empty_result_when_no_entities(
        self,
        mock_scan_run,
        mock_create_client,
        tmp_path: Path,
    ):
        """测试无实体时返回空结果。"""
        from backend.pipeline.ai_first_pipeline import AIFirstPipeline

        # Mock 扫描结果为空（但有工具调用，表示模型支持 function calling）
        mock_result = RepositoryScanResult(entities=[])
        mock_result.stats = {"tool_calls": 10}  # 有工具调用
        mock_scan_run.return_value = mock_result
        mock_create_client.return_value = MagicMock()

        pipeline = AIFirstPipeline()

        result = pipeline.analyze(
            repo_path=tmp_path,
            repo_name="test",
        )

        assert result.status == "failed"
        assert "未识别到任何实体" in result.warnings[0]


# ─────────────────────────────────────────────────────────────────────────────
# Test: Graph Schema Extension
# ─────────────────────────────────────────────────────────────────────────────


class TestGraphSchemaExtension:
    """测试图谱 Schema 扩展。"""

    def test_new_node_types_exist(self):
        """测试新节点类型存在。"""
        assert NodeType.ENTITY.value == "Entity"
        assert NodeType.FIELD.value == "Field"
        assert NodeType.FLOW_NODE.value == "FlowNode"

    def test_new_edge_types_exist(self):
        """测试新边类型存在。"""
        assert EdgeType.MAPS_TO.value == "maps_to"
        assert EdgeType.HAS_FIELD.value == "has_field"
        assert EdgeType.ONE_TO_ONE.value == "one_to_one"
        assert EdgeType.ONE_TO_MANY.value == "one_to_many"
        assert EdgeType.MANY_TO_ONE.value == "many_to_one"
        assert EdgeType.MANY_TO_MANY.value == "many_to_many"
        assert EdgeType.FLOW_TO.value == "flow_to"

    def test_graph_node_with_entity_type(self):
        """测试实体节点创建。"""
        node = GraphNode(
            id="entity:TestEntity",
            type=NodeType.ENTITY.value,
            name="TestEntity",
            properties={
                "table_name": "test_entity",
                "primary_key": "id",
            },
        )

        assert node.type == "Entity"
        assert node.properties["table_name"] == "test_entity"

    def test_graph_edge_with_flow_to_type(self):
        """测试血缘边创建。"""
        edge = GraphEdge(
            from_="field:EntityA.field1",
            to="field:EntityB.field2",
            type=EdgeType.FLOW_TO.value,
            properties={
                "flow_type": "direct",
                "flow_pattern": "API调用",
            },
        )

        assert edge.type == "flow_to"
        assert edge.properties["flow_type"] == "direct"
