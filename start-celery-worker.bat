@echo off
REM Celery Worker 启动脚本（使用 MiniMax LLM）
REM 用法：双击运行或在命令行执行

cd /d "%~dp0code-graph-system"

echo ========================================
echo 启动 Celery Worker（MiniMax LLM）
echo ========================================
echo.

REM 覆盖全局环境变量，使用 MiniMax 配置
set ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic
set LLM_PROVIDER=anthropic
set LLM_MODEL=MiniMax-M2.5

echo 检查 Redis 连接...
python -c "import redis; r = redis.Redis(host='localhost', port=6379, db=0); print('Redis 状态:', 'OK' if r.ping() else 'FAILED')"
echo.

if errorlevel 1 (
    echo [错误] Redis 连接失败，请先启动 Redis
    pause
    exit /b 1
)

echo 激活虚拟环境...
call venv\Scripts\activate.bat

echo.
echo 启动 Celery Worker（按 Ctrl+C 停止）...
echo.
celery -A backend.scheduler.celery_app worker --loglevel=info --pool=solo

pause
