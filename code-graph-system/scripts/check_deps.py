#!/usr/bin/env python3
"""
依赖检查脚本 - 检查哪些依赖已安装，哪些缺失。
"""

import sys
from importlib import import_module

# 核心依赖
CORE_DEPS = {
    "fastapi": "FastAPI Web 框架",
    "uvicorn": "ASGI 服务器",
    "pydantic": "数据验证",
    "networkx": "图计算",
    "tree_sitter": "代码解析（必需）",
}

# 可选依赖
OPTIONAL_DEPS = {
    "tree_sitter_python": "Python 代码解析",
    "tree_sitter_javascript": "JavaScript 代码解析",
    "tree_sitter_typescript": "TypeScript 代码解析",
    "anthropic": "Claude AI 支持",
    "openai": "OpenAI GPT 支持",
    "chromadb": "向量存储",
    "neo4j": "图数据库",
    "git": "Git 仓库支持（gitpython）",
}

def check_dependency(module_name: str) -> tuple[bool, str]:
    """检查单个依赖是否已安装。"""
    try:
        mod = import_module(module_name)
        version = getattr(mod, "__version__", "unknown")
        return True, version
    except ImportError:
        return False, ""

def main():
    print("=" * 60)
    print("AI 代码知识图谱系统 - 依赖检查")
    print("=" * 60)
    print()

    # 检查 Python 版本
    py_version = sys.version_info
    print(f"Python 版本: {py_version.major}.{py_version.minor}.{py_version.micro}")
    if py_version < (3, 9):
        print("⚠️  警告: 推荐使用 Python 3.9 或更高版本")
    else:
        print("✓ Python 版本符合要求")
    print()

    # 检查核心依赖
    print("核心依赖:")
    print("-" * 60)
    core_ok = True
    for module, desc in CORE_DEPS.items():
        installed, version = check_dependency(module)
        if installed:
            print(f"✓ {desc:30} ({module:20} v{version})")
        else:
            print(f"✗ {desc:30} ({module:20} 未安装)")
            core_ok = False
    print()

    if not core_ok:
        print("⚠️  核心依赖缺失，请运行:")
        print("   pip install -r requirements-minimal.txt")
        print()

    # 检查可选依赖
    print("可选依赖:")
    print("-" * 60)
    for module, desc in OPTIONAL_DEPS.items():
        installed, version = check_dependency(module)
        if installed:
            print(f"✓ {desc:30} ({module:20} v{version})")
        else:
            print(f"- {desc:30} ({module:20} 未安装)")
    print()

    # 功能可用性总结
    print("=" * 60)
    print("功能可用性:")
    print("=" * 60)

    features = []
    if check_dependency("tree_sitter")[0]:
        features.append("✓ 代码解析（核心功能）")
    else:
        features.append("✗ 代码解析（核心功能）- 需要安装 tree-sitter")

    if check_dependency("tree_sitter_python")[0]:
        features.append("✓ Python 代码分析")
    else:
        features.append("- Python 代码分析 - 需要安装 tree-sitter-python")

    if check_dependency("anthropic")[0] or check_dependency("openai")[0]:
        features.append("✓ AI 语义分析")
    else:
        features.append("- AI 语义分析 - 需要安装 anthropic 或 openai")

    if check_dependency("chromadb")[0]:
        features.append("✓ 向量检索")
    else:
        features.append("- 向量检索 - 需要安装 chromadb")

    if check_dependency("neo4j")[0]:
        features.append("✓ Neo4j 图数据库")
    else:
        features.append("- Neo4j 图数据库 - 需要安装 neo4j")

    for feature in features:
        print(feature)

    print()
    print("=" * 60)

    if core_ok:
        print("✓ 核心功能可用，可以开始使用！")
        print()
        print("快速开始:")
        print("  python scripts/run_analysis.py /path/to/repo")
    else:
        print("⚠️  请先安装核心依赖")
        print()
        print("安装命令:")
        print("  pip install -r requirements-minimal.txt")

    print("=" * 60)

if __name__ == "__main__":
    main()
