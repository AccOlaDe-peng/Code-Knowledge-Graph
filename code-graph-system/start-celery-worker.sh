#!/bin/bash
# Celery Worker 启动脚本
# 使用腾讯云 Coding Plan GLM-5 配置

set -e

cd "$(dirname "$0")"

echo "================================"
echo "Celery Worker 启动"
echo "================================"

# 激活虚拟环境
source venv/bin/activate

# 加载 .env 文件中的环境变量
export $(grep -v '^#' .env | xargs)

# 显示当前配置
echo "LLM_PROVIDER: $LLM_PROVIDER"
echo "ANTHROPIC_BASE_URL: $ANTHROPIC_BASE_URL"
echo "ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:0:20}..."
echo "LLM_MODEL: $LLM_MODEL"
echo ""

# 创建日志目录
mkdir -p logs

# 日志文件路径
LOG_FILE="logs/celery-worker-$(date +%Y-%m-%d_%H-%M).log"

# 启动 Celery Worker，输出到日志文件
echo "启动 Celery Worker..."
echo "日志文件: $LOG_FILE"
echo ""

exec celery -A backend.scheduler.celery_app worker --loglevel=info --pool=solo 2>&1 | tee "$LOG_FILE"
