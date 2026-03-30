"""
数据血缘 API 路由。

提供 data-lineage.json 文件的读取接口。
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/data-lineage", tags=["数据血缘"])

# 数据文件路径
DATA_DIR = Path(__file__).parent.parent.parent.parent / "data" / "graphs"
DATA_LINEAGE_FILE = DATA_DIR / "data-lineage.json"


@router.get("")
async def get_data_lineage():
    """获取数据血缘图数据。

    返回 data-lineage.json 文件内容，包含：
    - meta: 元数据
    - modules: 模块列表（含实体、业务流程、功能）
    - dataFlow: 数据流节点和边
    - moduleDependencies: 模块依赖关系
    - flowEngine: 工作流引擎组件
    """
    if not DATA_LINEAGE_FILE.exists():
        logger.warning("数据血缘文件不存在: %s", DATA_LINEAGE_FILE)
        raise HTTPException(
            status_code=404,
            detail="数据血缘数据文件不存在，请先生成 data-lineage.json"
        )

    try:
        with open(DATA_LINEAGE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        logger.info("成功加载数据血缘数据，模块数: %d", len(data.get("modules", [])))
        return data
    except json.JSONDecodeError as e:
        logger.error("解析数据血缘文件失败: %s", e)
        raise HTTPException(
            status_code=500,
            detail=f"数据血缘文件格式错误: {e}"
        )
    except Exception as e:
        logger.error("读取数据血缘文件失败: %s", e)
        raise HTTPException(
            status_code=500,
            detail=f"读取数据血缘文件失败: {e}"
        )
