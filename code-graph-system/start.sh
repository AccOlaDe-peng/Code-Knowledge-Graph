#!/bin/bash
# 快速启动脚本

set -e

echo "================================"
echo "AI 代码知识图谱系统 - 快速启动"
echo "================================"
echo ""

# 检查 Python 版本
python_version=$(python3 --version 2>&1 | awk '{print $2}')
echo "✓ Python 版本: $python_version"

# 检查依赖
if [ ! -d "venv" ]; then
    echo ""
    echo "创建虚拟环境..."
    python3 -m venv venv
fi

echo "激活虚拟环境..."
source venv/bin/activate

echo ""
echo "安装依赖..."
pip install -q --upgrade pip
pip install -q -r requirements.txt

echo ""
echo "✓ 依赖安装完成"
echo ""

# 创建数据目录
mkdir -p data/graphs data/chroma

echo "================================"
echo "启动选项:"
echo "================================"
echo "1. 启动 API 服务器"
echo "2. 分析代码仓库"
echo "3. 运行测试"
echo "4. 退出"
echo ""

read -p "请选择 (1-4): " choice

case $choice in
    1)
        echo ""
        echo "启动 FastAPI 服务器..."
        echo "访问 http://localhost:8000/docs 查看 API 文档"
        echo ""
        cd backend/api && python server.py
        ;;
    2)
        echo ""
        read -p "请输入代码仓库路径: " repo_path
        read -p "是否启用 AI 分析? (y/n): " enable_ai

        if [ "$enable_ai" = "y" ]; then
            python scripts/run_analysis.py "$repo_path" --enable-ai -v
        else
            python scripts/run_analysis.py "$repo_path" -v
        fi
        ;;
    3)
        echo ""
        echo "运行测试..."
        pytest backend/tests/test_basic.py -v
        ;;
    4)
        echo "退出"
        exit 0
        ;;
    *)
        echo "无效选择"
        exit 1
        ;;
esac
