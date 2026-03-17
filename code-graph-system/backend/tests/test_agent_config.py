"""
分析配置模块测试
"""

import pytest

from backend.agent.config import (
    ANALYSIS_PRESETS,
    AnalysisConfig,
    AnalysisPreset,
    get_preset_description,
    list_available_presets,
)


class TestAnalysisPreset:
    """AnalysisPreset 枚举测试"""

    def test_preset_values(self) -> None:
        """测试预设枚举值"""
        assert AnalysisPreset.QUICK.value == "quick"
        assert AnalysisPreset.STANDARD.value == "standard"
        assert AnalysisPreset.DEEP.value == "deep"

    def test_preset_is_string_enum(self) -> None:
        """测试预设是字符串枚举"""
        assert isinstance(AnalysisPreset.QUICK, str)
        assert AnalysisPreset.QUICK == "quick"


class TestAnalysisPresets:
    """预设定义测试"""

    def test_all_presets_defined(self) -> None:
        """测试所有预设都已定义"""
        assert "quick" in ANALYSIS_PRESETS
        assert "standard" in ANALYSIS_PRESETS
        assert "deep" in ANALYSIS_PRESETS

    def test_preset_structure(self) -> None:
        """测试预设结构正确"""
        required_keys = [
            "description",
            "max_modules",
            "max_iterations_per_module",
            "agents",
            "checkpoint_interval",
            "context_management",
        ]

        for preset_name, preset_config in ANALYSIS_PRESETS.items():
            for key in required_keys:
                assert key in preset_config, f"预设 {preset_name} 缺少 {key} 字段"

    def test_context_management_structure(self) -> None:
        """测试上下文管理配置结构"""
        for preset_name, preset_config in ANALYSIS_PRESETS.items():
            context_mgmt = preset_config.get("context_management", {})
            assert "sliding_window_threshold" in context_mgmt, (
                f"预设 {preset_name} 缺少 sliding_window_threshold"
            )

    def test_quick_preset_values(self) -> None:
        """测试 quick 预设值"""
        quick = ANALYSIS_PRESETS["quick"]
        assert quick["max_modules"] == 10
        assert quick["max_iterations_per_module"] == 5
        assert quick["agents"] == ["module_detector", "architecture"]
        assert quick["checkpoint_interval"] == 5
        assert quick["context_management"]["enable_summary"] is False

    def test_standard_preset_values(self) -> None:
        """测试 standard 预设值"""
        standard = ANALYSIS_PRESETS["standard"]
        assert standard["max_modules"] == 50
        assert standard["max_iterations_per_module"] == 15
        assert standard["checkpoint_interval"] == 3
        assert standard["context_management"]["enable_summary"] is True

    def test_deep_preset_values(self) -> None:
        """测试 deep 预设值"""
        deep = ANALYSIS_PRESETS["deep"]
        assert deep["max_modules"] is None
        assert deep["max_iterations_per_module"] == 20
        assert deep["agents"] == "all"
        assert deep["checkpoint_interval"] == 1


class TestAnalysisConfig:
    """AnalysisConfig 类测试"""

    def test_default_preset(self) -> None:
        """测试默认使用 standard 预设"""
        config = AnalysisConfig()
        assert config.preset == AnalysisPreset.STANDARD

    def test_from_preset_quick(self) -> None:
        """测试从 quick 预设创建配置"""
        config = AnalysisConfig.from_preset("quick")
        assert config.preset == AnalysisPreset.QUICK
        assert config.max_modules == 10
        assert config.max_iterations_per_module == 5
        assert config.agents == ["module_detector", "architecture"]
        assert config.checkpoint_interval == 5
        assert config.enable_summary is False
        assert config.sliding_window_threshold == 0.9

    def test_from_preset_standard(self) -> None:
        """测试从 standard 预设创建配置"""
        config = AnalysisConfig.from_preset("standard")
        assert config.preset == AnalysisPreset.STANDARD
        assert config.max_modules == 50
        assert config.max_iterations_per_module == 15
        assert "module_detector" in config.agents
        assert "architecture" in config.agents
        assert config.checkpoint_interval == 3
        assert config.enable_summary is True
        assert config.sliding_window_threshold == 0.75

    def test_from_preset_deep(self) -> None:
        """测试从 deep 预设创建配置"""
        config = AnalysisConfig.from_preset("deep")
        assert config.preset == AnalysisPreset.DEEP
        assert config.max_modules is None
        assert config.max_iterations_per_module == 20
        # deep 预设的 agents 是 "all"，应该转换为所有 agent 列表
        assert len(config.agents) == 6
        assert config.checkpoint_interval == 1
        assert config.enable_summary is True

    def test_from_preset_with_enum(self) -> None:
        """测试使用枚举创建配置"""
        config = AnalysisConfig.from_preset(AnalysisPreset.QUICK)
        assert config.preset == AnalysisPreset.QUICK

    def test_from_preset_invalid(self) -> None:
        """测试无效预设名称"""
        with pytest.raises(ValueError, match="无效的预设名称"):
            AnalysisConfig.from_preset("invalid")

    def test_custom_values(self) -> None:
        """测试自定义值覆盖预设"""
        config = AnalysisConfig(
            preset=AnalysisPreset.STANDARD,
            max_modules=100,
            max_iterations_per_module=30,
            agents=["custom_agent"],
        )
        assert config.max_modules == 100
        assert config.max_iterations_per_module == 30
        assert config.agents == ["custom_agent"]

    def test_context_management_config(self) -> None:
        """测试上下文管理配置"""
        config = AnalysisConfig.from_preset("deep")
        assert config.enable_summary is True
        assert config.sliding_window_threshold == 0.75
        assert config.summary_threshold == 0.85

    def test_to_dict(self) -> None:
        """测试转换为字典"""
        config = AnalysisConfig.from_preset("quick")
        data = config.to_dict()
        assert data["preset"] == "quick"
        assert data["max_modules"] == 10
        assert isinstance(data["agents"], list)

    def test_from_dict(self) -> None:
        """测试从字典创建配置"""
        data = {
            "preset": "quick",
            "max_modules": 20,
            "custom_field": "ignored",
        }
        config = AnalysisConfig.from_dict(data)
        assert config.preset == AnalysisPreset.QUICK
        assert config.max_modules == 20

    def test_validate_valid_config(self) -> None:
        """测试验证有效配置"""
        config = AnalysisConfig.from_preset("standard")
        errors = config.validate()
        assert errors == []

    def test_validate_invalid_config(self) -> None:
        """测试验证无效配置"""
        config = AnalysisConfig(
            max_modules=0,
            max_iterations_per_module=-1,
            checkpoint_interval=0,
            sliding_window_threshold=1.5,
            summary_threshold=0,
            context_window=100,
        )
        errors = config.validate()
        assert len(errors) > 0

    def test_validate_max_modules_none(self) -> None:
        """测试 max_modules 为 None 时验证通过"""
        config = AnalysisConfig(max_modules=None)
        errors = config.validate()
        # max_modules 为 None 应该不报错
        max_modules_errors = [e for e in errors if "max_modules" in e]
        assert max_modules_errors == []


class TestHelperFunctions:
    """辅助函数测试"""

    def test_get_preset_description(self) -> None:
        """测试获取预设描述"""
        assert "快速扫描" in get_preset_description("quick")
        assert "标准分析" in get_preset_description("standard")
        assert "深度分析" in get_preset_description("deep")

    def test_get_preset_description_with_enum(self) -> None:
        """测试使用枚举获取预设描述"""
        desc = get_preset_description(AnalysisPreset.QUICK)
        assert "快速扫描" in desc

    def test_get_preset_description_unknown(self) -> None:
        """测试获取未知预设描述"""
        desc = get_preset_description("unknown")
        assert desc == "未知预设"

    def test_list_available_presets(self) -> None:
        """测试列出所有预设"""
        presets = list_available_presets()
        assert len(presets) == 3
        preset_names = [p["name"] for p in presets]
        assert "quick" in preset_names
        assert "standard" in preset_names
        assert "deep" in preset_names

    def test_list_available_presets_structure(self) -> None:
        """测试预设列表结构"""
        presets = list_available_presets()
        for preset in presets:
            assert "name" in preset
            assert "description" in preset
            assert "max_modules" in preset
            assert "agents" in preset
