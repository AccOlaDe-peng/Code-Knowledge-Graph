@echo off
REM API 服务器启动脚本（使用 MiniMax LLM）
REM 用法：双击运行或在命令行执行

cd /d "%~dp0code-graph-system"

echo ========================================
echo 启动 API 服务器（MiniMax LLM）
echo ========================================
echo.

REM 覆盖全局环境变量，使用 MiniMax 配置
set ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic
set LLM_PROVIDER=anthropic
set LLM_MODEL=MiniMax-M2.5

echo 检查配置...
python -c "import os; print('Provider:', os.getenv('LLM_PROVIDER')); print('Model:', os.getenv('LLM_MODEL')); print('Base URL:', os.getenv('ANTHROPIC_BASE_URL'))"
echo.

echo 激活虚拟环境...
call venv\Scripts\activate.bat

echo.
echo 启动 API 服务器（按 Ctrl+C 停止）...
echo 访问: http://localhost:8000/docs
echo.
python -m uvicorn backend.api.server:app --host 0.0.0.0 --port 8000 --reload

pause
