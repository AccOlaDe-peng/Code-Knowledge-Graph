"""Discovery 类型定义。

Agent 发现的结构化记录，供后续 Agent 查询。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class FileDiscovery:
    """文件发现记录。"""
    path: str                          # 相对路径
    file_type: str                     # "entry" | "config" | "source" | "test"
    language: str                      # "python" | "typescript" | "go"
    purpose: str                       # AI 推断的用途
    key_symbols: list[str] = field(default_factory=list)  # 关键符号
    confidence: float = 1.0


@dataclass
class ModuleDiscovery:
    """模块发现记录。"""
    module_id: str                     # "module:user-service"
    name: str                          # "UserService"
    path: str                          # "services/user"
    module_type: str                   # "service" | "library" | "shared" | "config"
    language: str                      # "python" | "typescript" | "go"
    framework: str = ""                # "fastapi" | "express" | "gin"
    entry_points: list[str] = field(default_factory=list)
    dependencies: list[str] = field(default_factory=list)
    confidence: float = 1.0


@dataclass
class LayerDiscovery:
    """架构层发现记录。"""
    layer_id: str                      # 节点 ID
    layer_type: str                    # "presentation" | "business" | "data" | "infrastructure"
    name: str
    description: str = ""
    modules: list[str] = field(default_factory=list)
    entry_points: list[str] = field(default_factory=list)
    confidence: float = 1.0


@dataclass
class ServiceDiscovery:
    """服务发现记录。"""
    service_id: str                    # 节点 ID
    name: str
    description: str = ""
    layer_id: str = ""
    entry_file: str = ""
    api_endpoints: list[str] = field(default_factory=list)
    dependencies: list[str] = field(default_factory=list)
    confidence: float = 1.0


@dataclass
class FunctionDiscovery:
    """函数发现记录。"""
    function_id: str                   # 节点 ID
    name: str
    file_path: str
    line_start: int
    line_end: int
    signature: str = ""
    is_async: bool = False
    is_entry_point: bool = False
    side_effects: list[str] = field(default_factory=list)
    calls_to: list[str] = field(default_factory=list)
    called_by: list[str] = field(default_factory=list)
    confidence: float = 1.0


@dataclass
class APIEndpointDiscovery:
    """API 端点发现记录。"""
    endpoint_id: str                   # 节点 ID
    method: str                        # "GET" | "POST" | "PUT" | "DELETE"
    path: str                          # "/api/users/{id}"
    handler_function: str = ""         # 处理函数 ID
    module_id: str = ""                # 所属模块
    confidence: float = 1.0


@dataclass
class DataObjectDiscovery:
    """数据对象发现记录。"""
    object_id: str                     # 节点 ID
    name: str
    object_type: str                   # "dto" | "entity" | "vo" | "model"
    file_path: str = ""
    fields: list[dict[str, Any]] = field(default_factory=list)
    transforms_to: list[str] = field(default_factory=list)
    transforms_from: list[str] = field(default_factory=list)
    confidence: float = 1.0


@dataclass
class CallChainDiscovery:
    """调用链发现记录。"""
    chain_id: str
    start_function: str                # 起始函数 ID
    end_function: str                  # 终止函数 ID
    path: list[str] = field(default_factory=list)  # 路径上的函数 ID
    is_cross_service: bool = False
    is_async: bool = False
    depth: int = 0
    confidence: float = 1.0


@dataclass
class DataFlowDiscovery:
    """数据流发现记录。"""
    flow_id: str
    source_type: str                   # "database" | "api" | "file" | "user_input"
    source_location: str
    sink_type: str                     # "database" | "api" | "file" | "log"
    sink_location: str
    transformations: list[str] = field(default_factory=list)
    functions_involved: list[str] = field(default_factory=list)
    confidence: float = 1.0


@dataclass
class DiscoveryRegistry:
    """Agent 发现的结构化记录，供后续 Agent 查询。"""

    # 文件发现
    entry_points: list[FileDiscovery] = field(default_factory=list)
    config_files: list[FileDiscovery] = field(default_factory=list)

    # 结构发现
    layers: list[LayerDiscovery] = field(default_factory=list)
    services: list[ServiceDiscovery] = field(default_factory=list)
    modules: list[ModuleDiscovery] = field(default_factory=list)

    # 代码发现
    functions: list[FunctionDiscovery] = field(default_factory=list)
    data_objects: list[DataObjectDiscovery] = field(default_factory=list)
    api_endpoints: list[APIEndpointDiscovery] = field(default_factory=list)

    # 关系发现
    call_chains: list[CallChainDiscovery] = field(default_factory=list)
    data_flows: list[DataFlowDiscovery] = field(default_factory=list)

    def query(self, discovery_type: str, filters: dict[str, Any] | None = None) -> list[Any]:
        """查询特定类型的发现。

        Args:
            discovery_type: 发现类型名称（如 "functions", "modules"）
            filters: 过滤条件字典

        Returns:
            匹配的发现记录列表
        """
        type_map = {
            "entry_points": self.entry_points,
            "config_files": self.config_files,
            "layers": self.layers,
            "services": self.services,
            "modules": self.modules,
            "functions": self.functions,
            "data_objects": self.data_objects,
            "api_endpoints": self.api_endpoints,
            "call_chains": self.call_chains,
            "data_flows": self.data_flows,
        }

        items = type_map.get(discovery_type, [])
        if not filters:
            return items

        # 简单过滤实现
        result = []
        for item in items:
            match = True
            for key, value in filters.items():
                if hasattr(item, key):
                    if getattr(item, key) != value:
                        match = False
                        break
            if match:
                result.append(item)

        return result