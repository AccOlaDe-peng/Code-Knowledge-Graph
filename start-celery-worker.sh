#!/bin/bash
# Celery Worker 启动脚本（使用 MiniMax LLM）
# 用法：./start-celery-worker.sh
# 日志文件：logs/celery-worker-{日期}.log

cd "$(dirname "$0")/code-graph-system"

# 创建日志目录
mkdir -p logs

# 生成日志文件名（带日期时间）
LOG_FILE="logs/celery-worker-$(date +%Y-%m-%d_%H-%M).log"

echo "========================================"
echo "启动 Celery Worker（MiniMax LLM）"
echo "日志文件: $LOG_FILE"
echo "========================================"
echo ""

# 覆盖全局环境变量，使用 MiniMax 配置
export ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic
export LLM_PROVIDER=anthropic
export LLM_MODEL=MiniMax-M2.5

echo "检查 Redis 连接..."
python3 -c "import redis; r = redis.Redis(host='localhost', port=6379, db=0); print('Redis 状态:', 'OK' if r.ping() else 'FAILED')"
echo ""

if [ $? -ne 0 ]; then
    echo "[错误] Redis 连接失败，请先启动 Redis"
    read -p "按回车键退出..."
    exit 1
fi

# 关闭已有的 Celery Worker 进程
EXISTING_PIDS=$(pgrep -f "celery.*worker" 2>/dev/null)
if [ -n "$EXISTING_PIDS" ]; then
    echo "发现已有 Celery Worker 进程（PID: $EXISTING_PIDS），正在关闭..."
    kill $EXISTING_PIDS 2>/dev/null
    # 等待进程退出，最多 10 秒
    for i in $(seq 1 10); do
        sleep 1
        if ! pgrep -f "celery.*worker" > /dev/null 2>&1; then
            echo "旧进程已退出。"
            break
        fi
        if [ $i -eq 10 ]; then
            echo "等待超时，强制终止..."
            kill -9 $EXISTING_PIDS 2>/dev/null
        fi
    done
else
    echo "无已有 Celery Worker 进程。"
fi
echo ""

# 激活虚拟环境
source venv/bin/activate

echo ""
echo "启动 Celery Worker（按 Ctrl+C 停止）..."
echo "日志同时写入文件: $LOG_FILE"
echo ""

# 启动 Celery，日志同时输出到控制台和文件
celery -A backend.scheduler.celery_app worker --loglevel=info --pool=solo 2>&1 | tee "$LOG_FILE"
