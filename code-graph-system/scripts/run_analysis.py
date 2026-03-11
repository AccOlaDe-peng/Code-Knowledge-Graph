#!/usr/bin/env python3
"""
代码仓库分析命令行工具。

用法:
    python run_analysis.py /path/to/repo
    python run_analysis.py /path/to/repo --languages python javascript
    python run_analysis.py /path/to/repo --enable-ai
"""

import argparse
import logging
import sys
from pathlib import Path

# 添加项目根目录到 Python 路径
sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.graph.schema import AnalysisRequest
from backend.pipeline.analyze_repository import AnalysisPipeline


def main():
    parser = argparse.ArgumentParser(
        description="分析代码仓库并构建知识图谱",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "repo_path",
        help="代码仓库路径（本地目录）",
    )
    parser.add_argument(
        "--languages",
        nargs="+",
        help="指定要分析的编程语言（如 python javascript），默认全部",
    )
    parser.add_argument(
        "--enable-ai",
        action="store_true",
        help="启用 AI 语义分析和向量化（需要配置 LLM API Key）",
    )
    parser.add_argument(
        "--incremental",
        action="store_true",
        help="增量更新模式（仅分析变更文件）",
    )
    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="显示详细日志",
    )

    args = parser.parse_args()

    # 配置日志
    log_level = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(
        level=log_level,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )

    # 验证路径
    repo_path = Path(args.repo_path).resolve()
    if not repo_path.exists():
        print(f"错误: 路径不存在: {repo_path}", file=sys.stderr)
        sys.exit(1)

    # 构建请求
    request = AnalysisRequest(
        repo_path=str(repo_path),
        languages=args.languages or [],
        enable_ai=args.enable_ai,
        incremental=args.incremental,
    )

    print(f"\n{'='*60}")
    print(f"代码知识图谱分析工具")
    print(f"{'='*60}")
    print(f"仓库路径: {repo_path}")
    print(f"语言过滤: {args.languages or '全部'}")
    print(f"AI 增强: {'是' if args.enable_ai else '否'}")
    print(f"增量模式: {'是' if args.incremental else '否'}")
    print(f"{'='*60}\n")

    # 执行分析
    pipeline = AnalysisPipeline()
    response = pipeline.analyze(request)

    # 输出结果
    print(f"\n{'='*60}")
    print(f"分析结果")
    print(f"{'='*60}")
    print(f"状态: {response.status}")
    print(f"消息: {response.message}")

    if response.stats:
        print(f"\n统计信息:")
        print(f"  节点总数: {response.stats.node_count}")
        print(f"  边总数: {response.stats.edge_count}")
        print(f"  语言分布: {response.stats.language_distribution}")
        print(f"  分析耗时: {response.stats.analysis_duration_seconds:.2f}s")

    if response.repo_id:
        print(f"\n图谱 ID: {response.repo_id}")
        print(f"数据已保存到: ./data/graphs/{response.repo_id}.json")

    print(f"{'='*60}\n")

    # 返回状态码
    sys.exit(0 if response.status == "completed" else 1)


if __name__ == "__main__":
    main()
