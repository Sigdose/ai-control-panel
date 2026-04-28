@echo off
REM ─────────────────────────────────────────────────────────────
REM AI Control Panel — 통합 시작 스크립트
REM   1) Launcher (별도 cmd 창)
REM   2) Frontend dev server + 브라우저 자동 오픈 (별도 cmd 창)
REM 각 창에서 Ctrl+C로 개별 종료, 창 닫으면 해당 프로세스 종료.
REM ─────────────────────────────────────────────────────────────

setlocal
cd /d "%~dp0"

echo ============================================================
echo   AI Control Panel — Launching
echo ============================================================
echo.

REM ─── 1. Launcher ───
echo [1/2] Launcher 시작 (port 5000)...
start "AI Panel · Launcher" cmd /k "cd /d %~dp0 && python launcher.py"

REM 런처가 먼저 떠야 frontend가 health check 시작할 수 있으니 잠깐 대기
timeout /t 2 /nobreak >nul

REM ─── 2. Frontend (자동 브라우저 오픈) ───
echo [2/2] Frontend 시작 (port 5173) + 브라우저 오픈...
start "AI Panel · Frontend" cmd /k "cd /d %~dp0\frontend && npm run dev -- --open"

echo.
echo ============================================================
echo   두 개의 창이 새로 열렸습니다:
echo     - AI Panel · Launcher    (port 5000)
echo     - AI Panel · Frontend    (port 5173, 브라우저 자동 오픈)
echo.
echo   종료: 각 창에서 Ctrl+C 또는 창 닫기
echo ============================================================

REM 이 메인 창은 메시지 보여주고 자동 종료
timeout /t 3 /nobreak >nul
endlocal
