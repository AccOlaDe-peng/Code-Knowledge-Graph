"""
业务领域配置服务。

提供业务领域配置的存储和管理功能。
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

# 默认配置存储目录
DEFAULT_CONFIG_DIR = Path(__file__).parent.parent.parent / "data" / "domain_configs"

# 中文名称推断规则
DOMAIN_NAME_INFERENCE = {
    # 缩写展开
    "drs": "数据报表服务",
    "mdm": "主数据管理",
    "frs": "风险扫描",
    "bav": "资产漏洞检测",
    "srs": "安全报告服务",
    "agm": "资产管理集成",
    "nbu": "备份服务",
    # 常见词翻译
    "permission": "权限管理",
    "engine": "引擎服务",
    "dashboard": "仪表盘",
    "dashbord": "仪表盘",
    "email": "邮件服务",
    "report": "报表服务",
    "white": "白名单管理",
    "application": "应用管理",
    "preAnalysis": "预分析服务",
    "preanalysis": "预分析服务",
    "config": "配置管理",
    "log": "日志服务",
    "auth": "认证服务",
    "policy": "策略管理",
    "sharding": "分片配置",
    "direct": "直连服务",
    "flow": "流程服务",
    "utils": "工具服务",
    "handler": "处理器",
    "factory": "工厂服务",
    "test": "测试模块",
    "process": "流程处理",
    "data": "数据服务",
    "http": "HTTP服务",
}

# 领域颜色预设
DOMAIN_COLORS = [
    "#00d4ff",  # 青色
    "#00f084",  # 绿色
    "#ffc145",  # 琥珀色
    "#b08eff",  # 紫色
    "#ff6b6b",  # 红色
    "#7ed957",  # 浅绿
    "#ffcc44",  # 黄色
    "#44aaff",  # 浅蓝
    "#ff9f43",  # 橙色
    "#a55eea",  # 深紫
]


class DomainConfigService:
    """业务领域配置服务。"""

    def __init__(self, config_dir: Optional[Path] = None):
        self.config_dir = config_dir or DEFAULT_CONFIG_DIR
        self.config_dir.mkdir(parents=True, exist_ok=True)

    def _config_path(self, repo_id: str) -> Path:
        """获取仓库配置文件路径。"""
        # 清理 repo_id 中的特殊字符
        safe_repo_id = repo_id.replace("/", "_").replace("\\", "_")
        return self.config_dir / f"{safe_repo_id}.json"

    def load_config(self, repo_id: str) -> dict[str, Any]:
        """加载仓库的业务领域配置。

        如果配置不存在，返回默认配置。
        """
        config_path = self._config_path(repo_id)

        if config_path.exists():
            try:
                with open(config_path, encoding="utf-8") as f:
                    return json.load(f)
            except (json.JSONDecodeError, IOError) as e:
                logger.warning("加载领域配置失败 %s: %s, 使用默认配置", repo_id, e)

        return self.get_default_config(repo_id)

    def save_config(self, repo_id: str, config: dict[str, Any]) -> None:
        """保存仓库的业务领域配置。"""
        config_path = self._config_path(repo_id)

        # 更新版本和时间戳
        config["repo_id"] = repo_id
        config["version"] = config.get("version", 0) + 1
        config["last_modified"] = datetime.utcnow().isoformat()

        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(config, f, ensure_ascii=False, indent=2)

        logger.info("保存领域配置: %s (v%d)", repo_id, config["version"])

    def get_default_config(self, repo_id: str) -> dict[str, Any]:
        """获取默认的空配置。"""
        return {
            "repo_id": repo_id,
            "version": 0,
            "last_modified": datetime.utcnow().isoformat(),
            "domains": [],
        }

    def infer_domain_name(self, key: str) -> str:
        """推断业务领域的中文名称。"""
        # 先尝试精确匹配
        if key in DOMAIN_NAME_INFERENCE:
            return DOMAIN_NAME_INFERENCE[key]

        # 尝试小写匹配
        lower_key = key.lower()
        if lower_key in DOMAIN_NAME_INFERENCE:
            return DOMAIN_NAME_INFERENCE[lower_key]

        # 默认处理：驼峰转空格
        import re
        name = re.sub(r"([A-Z])", r" \1", key).strip()
        return name if name else key


# 全局单例
_domain_config_service: Optional[DomainConfigService] = None


def get_domain_config_service() -> DomainConfigService:
    """获取领域配置服务单例。"""
    global _domain_config_service
    if _domain_config_service is None:
        _domain_config_service = DomainConfigService()
    return _domain_config_service
