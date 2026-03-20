# Celery Worker Startup Script (Windows PowerShell)

Set-Location $PSScriptRoot

Write-Host "================================" -ForegroundColor Cyan
Write-Host "Celery Worker Starting" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan

# Stop other Celery worker processes
Write-Host "Checking and stopping other Celery worker processes..." -ForegroundColor Yellow
$celeryProcesses = Get-Process -Name "*celery*" -ErrorAction SilentlyContinue
if ($celeryProcesses) {
    $celeryProcesses | Stop-Process -Force
    Write-Host "Stopped $($celeryProcesses.Count) old processes" -ForegroundColor Green
} else {
    Write-Host "No old processes found" -ForegroundColor Gray
}
Start-Sleep -Seconds 2

# Activate virtual environment
$venvActivate = Join-Path $PSScriptRoot "venv\Scripts\Activate.ps1"
if (Test-Path $venvActivate) {
    . $venvActivate
} else {
    Write-Host "Error: Virtual environment not found. Please run: python -m venv venv" -ForegroundColor Red
    exit 1
}

# Load .env file
$envFile = Join-Path $PSScriptRoot ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match "^([^#][^=]+)=(.*)$") {
            $name = $matches[1].Trim()
            $value = $matches[2].Trim()
            Set-Item -Path "env:$name" -Value $value
        }
    }
} else {
    Write-Host "Warning: .env file not found" -ForegroundColor Yellow
}

# Display current config
Write-Host ""
Write-Host "LLM_PROVIDER: $env:LLM_PROVIDER"
Write-Host "ANTHROPIC_BASE_URL: $env:ANTHROPIC_BASE_URL"
if ($env:ANTHROPIC_API_KEY) {
    $apiKeyPreview = $env:ANTHROPIC_API_KEY.Substring(0, [Math]::Min(20, $env:ANTHROPIC_API_KEY.Length)) + "..."
    Write-Host "ANTHROPIC_API_KEY: $apiKeyPreview"
} else {
    Write-Host "ANTHROPIC_API_KEY: Not set"
}
Write-Host "LLM_MODEL: $env:LLM_MODEL"
Write-Host ""

# Create logs directory
$logsDir = Join-Path $PSScriptRoot "logs"
if (-not (Test-Path $logsDir)) {
    New-Item -ItemType Directory -Path $logsDir | Out-Null
}

# Log file path
$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm"
$logFile = Join-Path $logsDir "celery-worker-$timestamp.log"

Write-Host "Starting Celery Worker..." -ForegroundColor Green
Write-Host "Log file: $logFile"
Write-Host ""

# Start Celery Worker (output to console and log file)
celery -A backend.scheduler.celery_app worker --loglevel=info --pool=solo 2>&1 | Tee-Object -FilePath $logFile
