@echo off
chcp 65001 >nul
REM Celery Worker 启动脚本 (Windows)
REM 使用腾讯云 Coding Plan GLM-5 配置

cd /d "%~dp0"

echo ================================
echo Celery Worker 启动
echo ================================

REM 停止所有其他 Celery worker 进程
echo 检查并停止其他 Celery worker 进程...
taskkill /F /FI "WINDOWTITLE eq celery*" 2>nul
for /f "tokens=2" %%i in ('tasklist ^| findstr /i "celery"') do (
    taskkill /F /PID %%i 2>nul
)
echo 已检查旧进程
timeout /t 2 /nobreak >nul

REM 激活虚拟环境
if exist venv\Scripts\activate.bat (
    call venv\Scripts\activate.bat
) else (
    echo 错误: 未找到虚拟环境，请先运行 python -m venv venv
    exit /b 1
)

REM 加载 .env 文件中的环境变量
if exist .env (
    for /f "usebackq tokens=1,* delims==" %%a in (".env") do (
        REM 跳过注释行和空行
        echo %%a | findstr /r "^#" >nul || set "%%a=%%b"
    )
) else (
    echo 警告: 未找到 .env 文件
)

REM 显示当前配置
echo LLM_PROVIDER: %LLM_PROVIDER%
echo ANTHROPIC_BASE_URL: %ANTHROPIC_BASE_URL%
if defined ANTHROPIC_API_KEY (
    echo ANTHROPIC_API_KEY: %ANTHROPIC_API_KEY:~0,20%...
) else (
    echo ANTHROPIC_API_KEY: 未设置
)
echo LLM_MODEL: %LLM_MODEL%
echo.

REM 清除 Redis 队列和任务结果
echo 清除 Redis 任务队列和结果...
if not defined CELERY_BROKER_URL set CELERY_BROKER_URL=redis://localhost:6379/0
if not defined CELERY_RESULT_BACKEND set CELERY_RESULT_BACKEND=redis://localhost:6379/1

redis-cli -n 0 FLUSHDB
if errorlevel 1 (
    echo ERROR: Redis broker 队列清除失败！为避免执行残留任务，Worker 不会启动。
    echo 请确认 redis-cli 已安装并在 PATH 中，且 Redis 正在运行。
    exit /b 1
)
redis-cli -n 1 FLUSHDB
if errorlevel 1 (
    echo ERROR: Redis result 清除失败！为避免执行残留任务，Worker 不会启动。
    echo 请确认 redis-cli 已安装并在 PATH 中，且 Redis 正在运行。
    exit /b 1
)
echo Redis 已清除 ^(broker db=0, result db=1^)
echo.

REM 创建日志目录
if not exist logs mkdir logs

REM 日志文件路径（使用 WMIC 获取可靠的时间格式）
for /f "tokens=1-6 delims=/:. " %%a in ('wmic datetime get localdatetime ^| findstr ^[0-9]') do (
    set LOG_TIMESTAMP=%%a-%%b-%%c_%%d-%%e
)
set LOG_FILE=logs\celery-worker-%LOG_TIMESTAMP%.log

REM 启动 Celery Worker
echo 启动 Celery Worker...
echo 日志文件: %LOG_FILE%
echo.

REM Windows 下使用 solo pool 或 threads pool
REM 直接启动（日志输出到控制台，同时重定向到文件）
celery -A backend.scheduler.celery_app worker --loglevel=info --pool=solo
