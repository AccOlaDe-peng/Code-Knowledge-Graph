"""
数据血缘 API 路由。

提供 {name}-lineage.json 文件的读取接口。
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/data-lineage", tags=["数据血缘"])

# 数据文件路径
DATA_DIR = Path(__file__).parent.parent.parent.parent / "data" / "graphs"


@router.get("")
async def get_data_lineage(
    name: str = Query(..., description="数据库名称，如 'adms'，对应文件 {name}-lineage.json")
):
    """获取数据血缘图数据。

    参数：
        name: 数据库名称，用于匹配 {name}-lineage.json 文件

    返回文件内容，包含：
    - meta: 元数据
    - modules: 模块列表（含实体、业务流程、功能）
    - dataFlow: 数据流节点和边
    - moduleDependencies: 模块依赖关系
    - flowEngine: 工作流引擎组件
    """
    # 安全校验：只允许字母数字和下划线
    if not name.replace("_", "").replace("-", "").isalnum():
        raise HTTPException(
            status_code=400,
            detail="name 参数只能包含字母、数字、下划线和连字符"
        )

    file_path = DATA_DIR / f"{name}-lineage.json"

    if not file_path.exists():
        logger.warning("数据血缘文件不存在: %s", file_path)
        raise HTTPException(
            status_code=404,
            detail=f"数据血缘文件不存在: {name}-lineage.json"
        )

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        logger.info("成功加载数据血缘数据 [%s]，模块数: %d", name, len(data.get("modules", [])))
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
