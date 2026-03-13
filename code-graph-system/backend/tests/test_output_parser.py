"""OutputParser 单元测试。"""

import json
import pytest

from backend.analyzer.ai.agent.output_parser import OutputParser
from backend.graph.graph_schema import GraphNode, GraphEdge, NodeType, EdgeType


class TestOutputParser:
    """OutputParser 测试套件。"""

    def setup_method(self):
        """每个测试前初始化 parser。"""
        self.parser = OutputParser()

    def test_parse_valid_json(self):
        """测试解析合法 JSON 输出。"""
        json_output = json.dumps({
            "nodes": [
                {
                    "id": "layer1",
                    "type": "Layer",
                    "name": "PresentationLayer",
                    "properties": {"layer_index": 1, "description": "UI layer"}
                },
                {
                    "id": "svc1",
                    "type": "Service",
                    "name": "UserService",
                    "properties": {"responsibility": "User management"}
                }
            ],
            "edges": [
                {
                    "from": "svc1",
                    "to": "layer1",
                    "type": "belongs_to",
                    "properties": {"confidence": 0.9}
                }
            ],
            "exploration_summary": "探索了3个文件"
        })

        result = self.parser.parse(json_output)

        assert "nodes" in result
        assert "edges" in result
        assert "meta" in result
        assert len(result["nodes"]) == 2
        assert len(result["edges"]) == 1

        # 验证节点类型
        assert all(isinstance(n, GraphNode) for n in result["nodes"])
        assert result["nodes"][0].id == "layer1"
        assert result["nodes"][0].type == "Layer"
        assert result["nodes"][0].name == "PresentationLayer"

        # 验证边类型
        assert all(isinstance(e, GraphEdge) for e in result["edges"])
        assert result["edges"][0].from_ == "svc1"
        assert result["edges"][0].to == "layer1"
        assert result["edges"][0].type == "belongs_to"

        # 验证 meta
        assert "exploration_summary" in result["meta"]
        assert result["meta"]["exploration_summary"] == "探索了3个文件"

    def test_filter_invalid_node_types(self):
        """测试过滤非法节点类型。"""
        json_output = json.dumps({
            "nodes": [
                {"id": "n1", "type": "Layer", "name": "ValidLayer", "properties": {}},
                {"id": "n2", "type": "InvalidType", "name": "BadNode", "properties": {}},
                {"id": "n3", "type": "Service", "name": "ValidService", "properties": {}}
            ],
            "edges": []
        })

        result = self.parser.parse(json_output)

        # 只保留合法节点
        assert len(result["nodes"]) == 2
        node_ids = {n.id for n in result["nodes"]}
        assert "n1" in node_ids
        assert "n3" in node_ids
        assert "n2" not in node_ids

    def test_filter_invalid_edge_types(self):
        """测试过滤非法边类型。"""
        json_output = json.dumps({
            "nodes": [
                {"id": "n1", "type": "Layer", "name": "Layer1", "properties": {}},
                {"id": "n2", "type": "Service", "name": "Service1", "properties": {}}
            ],
            "edges": [
                {"from": "n1", "to": "n2", "type": "belongs_to", "properties": {}},
                {"from": "n1", "to": "n2", "type": "invalid_edge", "properties": {}},
                {"from": "n2", "to": "n1", "type": "calls", "properties": {}}
            ]
        })

        result = self.parser.parse(json_output)

        # 只保留合法边
        assert len(result["edges"]) == 2
        edge_types = {e.type for e in result["edges"]}
        assert "belongs_to" in edge_types
        assert "calls" in edge_types
        assert "invalid_edge" not in edge_types

    def test_filter_dangling_edges(self):
        """测试过滤引用不存在节点的边。"""
        json_output = json.dumps({
            "nodes": [
                {"id": "n1", "type": "Layer", "name": "Layer1", "properties": {}},
                {"id": "n2", "type": "Service", "name": "Service1", "properties": {}}
            ],
            "edges": [
                {"from": "n1", "to": "n2", "type": "belongs_to", "properties": {}},
                {"from": "n1", "to": "n999", "type": "calls", "properties": {}},
                {"from": "n888", "to": "n2", "type": "depends_on", "properties": {}}
            ]
        })

        result = self.parser.parse(json_output)

        # 只保留引用存在节点的边
        assert len(result["edges"]) == 1
        assert result["edges"][0].from_ == "n1"
        assert result["edges"][0].to == "n2"

    def test_handle_malformed_json(self):
        """测试处理格式错误的 JSON。"""
        json_output = "{ invalid json }"

        with pytest.raises(ValueError, match="无效的 JSON 格式"):
            self.parser.parse(json_output)

    def test_handle_missing_nodes_key(self):
        """测试处理缺少 nodes 键的情况。"""
        json_output = json.dumps({
            "edges": [],
            "exploration_summary": "test"
        })

        result = self.parser.parse(json_output)

        # 应返回空节点列表
        assert result["nodes"] == []
        assert result["edges"] == []

    def test_handle_missing_edges_key(self):
        """测试处理缺少 edges 键的情况。"""
        json_output = json.dumps({
            "nodes": [
                {"id": "n1", "type": "Layer", "name": "Layer1", "properties": {}}
            ]
        })

        result = self.parser.parse(json_output)

        # 应返回空边列表
        assert len(result["nodes"]) == 1
        assert result["edges"] == []

    def test_preserve_properties(self):
        """测试保留节点和边的 properties。"""
        json_output = json.dumps({
            "nodes": [
                {
                    "id": "n1",
                    "type": "Layer",
                    "name": "DataLayer",
                    "properties": {
                        "layer_index": 3,
                        "description": "Data access layer",
                        "pattern": "Repository"
                    }
                }
            ],
            "edges": [
                {
                    "from": "n1",
                    "to": "n1",
                    "type": "contains",
                    "properties": {
                        "confidence": 0.95,
                        "source": "ai_analysis"
                    }
                }
            ]
        })

        result = self.parser.parse(json_output)

        # 验证 properties 完整保留
        node = result["nodes"][0]
        assert node.properties["layer_index"] == 3
        assert node.properties["description"] == "Data access layer"
        assert node.properties["pattern"] == "Repository"

        edge = result["edges"][0]
        assert edge.properties["confidence"] == 0.95
        assert edge.properties["source"] == "ai_analysis"

    def test_empty_input(self):
        """测试空输入。"""
        json_output = json.dumps({})

        result = self.parser.parse(json_output)

        assert result["nodes"] == []
        assert result["edges"] == []
        assert result["meta"] == {}

    def test_complex_filtering_scenario(self):
        """测试复杂过滤场景：同时存在多种非法情况。"""
        json_output = json.dumps({
            "nodes": [
                {"id": "n1", "type": "Layer", "name": "Layer1", "properties": {}},
                {"id": "n2", "type": "BadType", "name": "Bad", "properties": {}},
                {"id": "n3", "type": "Service", "name": "Service1", "properties": {}},
                {"id": "n4", "type": "Function", "name": "Func1", "properties": {}}
            ],
            "edges": [
                {"from": "n1", "to": "n3", "type": "belongs_to", "properties": {}},
                {"from": "n2", "to": "n3", "type": "calls", "properties": {}},
                {"from": "n3", "to": "n999", "type": "depends_on", "properties": {}},
                {"from": "n1", "to": "n4", "type": "invalid_type", "properties": {}},
                {"from": "n4", "to": "n1", "type": "calls", "properties": {}}
            ],
            "exploration_summary": "Complex test"
        })

        result = self.parser.parse(json_output)

        # n2 被过滤（非法类型）
        assert len(result["nodes"]) == 3
        node_ids = {n.id for n in result["nodes"]}
        assert node_ids == {"n1", "n3", "n4"}

        # 过滤后的边：
        # - n1->n3 (belongs_to): 保留
        # - n2->n3 (calls): 过滤（n2 不存在）
        # - n3->n999 (depends_on): 过滤（n999 不存在）
        # - n1->n4 (invalid_type): 过滤（非法边类型）
        # - n4->n1 (calls): 保留
        assert len(result["edges"]) == 2
        edge_pairs = {(e.from_, e.to, e.type) for e in result["edges"]}
        assert ("n1", "n3", "belongs_to") in edge_pairs
        assert ("n4", "n1", "calls") in edge_pairs
