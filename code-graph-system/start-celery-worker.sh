#!/bin/bash
# Celery Worker 启动脚本
# 使用腾讯云 Coding Plan GLM-5 配置

set -e

cd "$(dirname "$0")"

echo "================================"
echo "Celery Worker 启动"
echo "================================"

# 停止所有其他 Celery worker 进程
echo "检查并停止其他 Celery worker 进程..."
pkill -f "celery.*worker" 2>/dev/null && echo "已停止旧进程" || echo "无旧进程"
sleep 2

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

# 清除 Redis 队列和任务结果
echo "清除 Redis 任务队列和结果..."
BROKER_DB=$(echo "${CELERY_BROKER_URL:-redis://localhost:6379/0}" | grep -oE '[0-9]+$')
BACKEND_DB=$(echo "${CELERY_RESULT_BACKEND:-redis://localhost:6379/1}" | grep -oE '[0-9]+$')
BROKER_DB=${BROKER_DB:-0}
BACKEND_DB=${BACKEND_DB:-1}

FLUSH1=$(redis-cli -n "$BROKER_DB"  FLUSHDB 2>&1); EXIT1=$?
FLUSH2=$(redis-cli -n "$BACKEND_DB" FLUSHDB 2>&1); EXIT2=$?

if [ $EXIT1 -eq 0 ] && [ $EXIT2 -eq 0 ]; then
    echo "Redis 已清除 (broker db=$BROKER_DB, result db=$BACKEND_DB)"
else
    echo "ERROR: Redis 清除失败！为避免执行残留任务，Worker 不会启动。" >&2
    echo "  broker flush: exit=$EXIT1 output=$FLUSH1" >&2
    echo "  result flush: exit=$EXIT2 output=$FLUSH2" >&2
    echo "请确认 redis-cli 已安装且 Redis 正在运行。" >&2
    exit 1
fi
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
