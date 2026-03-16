@echo off
REM Celery Worker 启动脚本（使用 MiniMax LLM）
REM 用法：双击运行或在命令行执行
REM 日志文件：logs/celery-worker-{日期}.log

cd /d "%~dp0code-graph-system"

REM 创建日志目录
if not exist "logs" mkdir logs

REM 生成日志文件名（带日期时间）
for /f "tokens=1-4 delims=/ " %%a in ('date /t') do (
    set LOG_DATE=%%a-%%b-%%c
)
for /f "tokens=1-2 delims=: " %%a in ('time /t') do (
    set LOG_TIME=%%a-%%b
)
set LOG_FILE=logs\celery-worker-%LOG_DATE%_%LOG_TIME%.log

echo ========================================
echo 启动 Celery Worker（MiniMax LLM）
echo 日志文件: %LOG_FILE%
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
echo 日志同时写入文件: %LOG_FILE%
echo.

REM 启动 Celery，日志同时输出到控制台和文件
celery -A backend.scheduler.celery_app worker --loglevel=info --pool=solo 2>&1 | tee %LOG_FILE%

pause
