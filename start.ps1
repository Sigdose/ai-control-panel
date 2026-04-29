# ============================================================
#  AI Control Panel — Start (단일 진입점)
#  Launcher + Frontend dev 서버를 두 PowerShell 창으로 분리 실행
#  브라우저 자동 오픈
# ============================================================
$ErrorActionPreference = 'Stop'
$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $RootDir

$VenvPython = Join-Path $RootDir 'venv-launcher\Scripts\python.exe'
$FrontendDir = Join-Path $RootDir 'frontend'

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  AI Control Panel" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# ─── 사전 검증 ───
if (-not (Test-Path $VenvPython)) {
    Write-Host ""
    Write-Host "  ✗ venv-launcher가 없습니다." -ForegroundColor Red
    Write-Host "  먼저 install.ps1 (또는 install.bat)을 실행하세요." -ForegroundColor Yellow
    Read-Host "Enter 키를 누르면 종료"
    exit 1
}
if (-not (Test-Path "$FrontendDir\node_modules")) {
    Write-Host ""
    Write-Host "  ✗ frontend\node_modules가 없습니다." -ForegroundColor Red
    Write-Host "  먼저 install.ps1을 실행하세요." -ForegroundColor Yellow
    Read-Host "Enter 키를 누르면 종료"
    exit 1
}

Write-Host ""
Write-Host "[1/2] Launcher (port 5000)..." -ForegroundColor Yellow
$cmd1 = "Set-Location '$RootDir'; & '$VenvPython' launcher.py"
Start-Process powershell -ArgumentList '-NoExit', '-NoProfile', '-Command', $cmd1

Start-Sleep -Seconds 2

Write-Host "[2/2] Frontend (port 5173) + 브라우저 오픈..." -ForegroundColor Yellow
$cmd2 = "Set-Location '$FrontendDir'; npm run dev -- --open"
Start-Process powershell -ArgumentList '-NoExit', '-NoProfile', '-Command', $cmd2

Write-Host ""
Write-Host "  두 개의 PowerShell 창이 열렸습니다." -ForegroundColor Green
Write-Host "  종료: 각 창에서 Ctrl+C 또는 창 닫기" -ForegroundColor Gray
Write-Host ""
