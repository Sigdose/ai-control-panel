@echo off
REM ============================================================
REM   AI Control Panel - Start (single entry point)
REM ============================================================
setlocal
cd /d "%~dp0"

set "ROOT_DIR=%~dp0"
set "VENV_PYTHON=%ROOT_DIR%venv-launcher\Scripts\python.exe"
set "FRONTEND_DIR=%ROOT_DIR%frontend"

echo ============================================================
echo   AI Control Panel
echo ============================================================
echo.

if not exist "%VENV_PYTHON%" (
    echo   X venv-launcher가 없습니다.
    echo   먼저 install.bat을 실행하세요.
    pause
    exit /b 1
)
if not exist "%FRONTEND_DIR%\node_modules" (
    echo   X frontend\node_modules가 없습니다.
    echo   먼저 install.bat을 실행하세요.
    pause
    exit /b 1
)

echo [1/2] Launcher (port 5000)...
start "AI Panel - Launcher" cmd /k "cd /d %ROOT_DIR% && "%VENV_PYTHON%" launcher.py"

timeout /t 2 /nobreak >nul

echo [2/2] Frontend (port 5173) + browser open...
start "AI Panel - Frontend" cmd /k "cd /d %FRONTEND_DIR% && npm run dev -- --open"

echo.
echo   두 개의 cmd 창이 열렸습니다.
echo   종료: 각 창에서 Ctrl+C 또는 창 닫기
echo.

timeout /t 3 /nobreak >nul
endlocal
