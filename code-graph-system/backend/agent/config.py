"""
分析配置模块

定义分析预设配置，支持 quick/standard/deep 三种分析深度。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Union


class AnalysisPreset(str, Enum):
    """分析预设枚举"""

    QUICK = "quick"
    STANDARD = "standard"
    DEEP = "deep"


# 分析预设定义
ANALYSIS_PRESETS: dict[str, dict[str, Any]] = {
    "quick": {
        "description": "快速扫描，仅分析核心模块",
        "max_modules": 10,
        "max_iterations_per_module": 5,
        "agents": ["module_detector", "architecture"],
        "checkpoint_interval": 5,
        "context_management": {
            "enable_summary": False,
            "sliding_window_threshold": 0.9,
        },
    },
    "standard": {
        "description": "标准分析，平衡速度和深度",
        "max_modules": 50,
        "max_iterations_per_module": 15,
        "agents": ["module_detector", "architecture", "call_graph", "api_endpoint"],
        "checkpoint_interval": 3,
        "context_management": {
            "enable_summary": True,
            "sliding_window_threshold": 0.75,
        },
    },
    "deep": {
        "description": "深度分析，完整扫描所有模块",
        "max_modules": None,  # 无限制
        "max_iterations_per_module": 20,
        "agents": "all",
        "checkpoint_interval": 1,
        "context_management": {
            "enable_summary": True,
            "sliding_window_threshold": 0.75,
            "summary_threshold": 0.85,
        },
    },
}


@dataclass
class AnalysisConfig:
    """分析配置类"""

    preset: AnalysisPreset = AnalysisPreset.STANDARD
    max_modules: Optional[int] = None
    max_iterations_per_module: int = 15
    agents: list[str] = field(default_factory=list)
    checkpoint_interval: int = 3
    enable_summary: bool = True
    sliding_window_threshold: float = 0.75
    summary_threshold: float = 0.85
    context_window: int = 128000

    def __post_init__(self) -> None:
        """从预设加载默认值"""
        self._load_from_preset()

    def _load_from_preset(self) -> None:
        """根据预设加载默认配置"""
        preset_name = self.preset.value if isinstance(self.preset, AnalysisPreset) else self.preset
        preset_config = ANALYSIS_PRESETS.get(preset_name, {})

        context_mgmt = preset_config.get("context_management", {})

        # 只在值为默认值时才从预设加载
        if self.max_modules is None:
            self.max_modules = preset_config.get("max_modules")

        if self.max_iterations_per_module == 15:
            self.max_iterations_per_module = preset_config.get(
                "max_iterations_per_module", 15
            )

        if not self.agents:
            agents = preset_config.get("agents", [])
            if agents == "all":
                self.agents = [
                    "module_detector",
                    "architecture",
                    "call_graph",
                    "data_lineage",
                    "api_endpoint",
                    "cross_module",
                ]
            else:
                self.agents = list(agents)

        if self.checkpoint_interval == 3:
            self.checkpoint_interval = preset_config.get("checkpoint_interval", 3)

        if context_mgmt:
            if self.enable_summary:
                self.enable_summary = context_mgmt.get("enable_summary", True)
            if self.sliding_window_threshold == 0.75:
                self.sliding_window_threshold = context_mgmt.get(
                    "sliding_window_threshold", 0.75
                )
            if self.summary_threshold == 0.85:
                self.summary_threshold = context_mgmt.get("summary_threshold", 0.85)

    @classmethod
    def from_preset(cls, preset: str | AnalysisPreset) -> "AnalysisConfig":
        """从预设名称创建配置

        Args:
            preset: 预设名称，可以是字符串或 AnalysisPreset 枚举

        Returns:
            AnalysisConfig 实例

        Raises:
            ValueError: 预设名称无效时抛出
        """
        if isinstance(preset, AnalysisPreset):
            preset_enum = preset
        else:
            try:
                preset_enum = AnalysisPreset(preset)
            except ValueError:
                valid_presets = [p.value for p in AnalysisPreset]
                raise ValueError(
                    f"无效的预设名称: {preset}，有效预设: {valid_presets}"
                )

        return cls(preset=preset_enum)

    def to_dict(self) -> dict[str, Any]:
        """转换为字典格式

        Returns:
            包含所有配置项的字典
        """
        return {
            "preset": self.preset.value,
            "max_modules": self.max_modules,
            "max_iterations_per_module": self.max_iterations_per_module,
            "agents": self.agents,
            "checkpoint_interval": self.checkpoint_interval,
            "enable_summary": self.enable_summary,
            "sliding_window_threshold": self.sliding_window_threshold,
            "summary_threshold": self.summary_threshold,
            "context_window": self.context_window,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "AnalysisConfig":
        """从字典创建配置

        Args:
            data: 配置字典

        Returns:
            AnalysisConfig 实例
        """
        preset = data.get("preset", "standard")
        config = cls.from_preset(preset)

        # 覆盖自定义值
        if "max_modules" in data:
            config.max_modules = data["max_modules"]
        if "max_iterations_per_module" in data:
            config.max_iterations_per_module = data["max_iterations_per_module"]
        if "agents" in data:
            config.agents = data["agents"]
        if "checkpoint_interval" in data:
            config.checkpoint_interval = data["checkpoint_interval"]
        if "enable_summary" in data:
            config.enable_summary = data["enable_summary"]
        if "sliding_window_threshold" in data:
            config.sliding_window_threshold = data["sliding_window_threshold"]
        if "summary_threshold" in data:
            config.summary_threshold = data["summary_threshold"]
        if "context_window" in data:
            config.context_window = data["context_window"]

        return config

    def validate(self) -> list[str]:
        """验证配置有效性

        Returns:
            错误消息列表，空列表表示验证通过
        """
        errors = []

        if self.max_modules is not None and self.max_modules < 1:
            errors.append("max_modules 必须为正整数或 None")

        if self.max_iterations_per_module < 1:
            errors.append("max_iterations_per_module 必须为正整数")

        if self.checkpoint_interval < 1:
            errors.append("checkpoint_interval 必须为正整数")

        if not 0 < self.sliding_window_threshold <= 1:
            errors.append("sliding_window_threshold 必须在 (0, 1] 范围内")

        if not 0 < self.summary_threshold <= 1:
            errors.append("summary_threshold 必须在 (0, 1] 范围内")

        if self.context_window < 1000:
            errors.append("context_window 必须至少为 1000")

        return errors


def get_preset_description(preset: str | AnalysisPreset) -> str:
    """获取预设的描述信息

    Args:
        preset: 预设名称

    Returns:
        预设描述字符串
    """
    preset_name = preset.value if isinstance(preset, AnalysisPreset) else preset
    return ANALYSIS_PRESETS.get(preset_name, {}).get("description", "未知预设")


def list_available_presets() -> list[dict[str, Any]]:
    """列出所有可用的预设

    Returns:
        预设信息列表
    """
    return [
        {
            "name": name,
            "description": config.get("description", ""),
            "max_modules": config.get("max_modules"),
            "agents": config.get("agents"),
        }
        for name, config in ANALYSIS_PRESETS.items()
    ]
