# AI Control Panel — PowerShell 시작 스크립트
# 사용: 우클릭 → "PowerShell로 실행" 또는 `powershell -ExecutionPolicy Bypass -File start.ps1`

$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $root

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  AI Control Panel — Launching" -ForegroundColor Cyan
Write-Host "============================================================`n" -ForegroundColor Cyan

# Launcher
Write-Host "[1/2] Launcher (port 5000)..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root'; python launcher.py"

Start-Sleep -Seconds 2

# Frontend (자동 브라우저 오픈)
Write-Host "[2/2] Frontend (port 5173) + 브라우저 오픈..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\frontend'; npm run dev -- --open"

Write-Host "`n두 개의 PowerShell 창이 열렸습니다." -ForegroundColor Green
Write-Host "종료: 각 창에서 Ctrl+C 또는 창 닫기`n" -ForegroundColor Gray
