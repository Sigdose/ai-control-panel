@echo off
REM ============================================================
REM   AI Control Panel - Initial Setup (BAT wrapper)
REM   Calls install.ps1 with bypass execution policy
REM ============================================================
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File "%~dp0install.ps1"
pause
