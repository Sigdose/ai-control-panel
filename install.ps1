# ============================================================
#  AI Control Panel — Initial Setup (run once after git clone)
#  - Python/Node/Git 확인 (없으면 자동 설치)
#  - venv-launcher 생성 + flask 설치
#  - frontend npm install
# ============================================================
$ErrorActionPreference = 'Stop'
$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $RootDir

function Write-Step($msg) { Write-Host ""; Write-Host "─── $msg ───" -ForegroundColor Cyan }
function Write-OK($msg)   { Write-Host "  ✓ $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  ⚠ $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "  ✗ $msg" -ForegroundColor Red }
function Write-Info($msg) { Write-Host "  · $msg" -ForegroundColor Gray }

function Update-Path {
    $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
                [System.Environment]::GetEnvironmentVariable('Path','User')
}

function Find-Python {
    foreach ($cmd in @('py -3.11','py -3.10','py -3.12','python','python3')) {
        try {
            $out = & cmd /c "$cmd --version 2>&1"
            if ($out -match 'Python (\d+)\.(\d+)') {
                if ([int]$Matches[1] -eq 3 -and [int]$Matches[2] -ge 10) { return $cmd }
            }
        } catch {}
    }
    return $null
}

# ─── Prerequisite 확인 ───
Write-Step "환경 검증"
$missing = @()
$needsRestart = $false

$PythonCmd = Find-Python
if ($PythonCmd) { Write-OK "Python: $PythonCmd" } else { $missing += 'Python' }

try { $nv = node --version 2>&1; if ($LASTEXITCODE -eq 0) { Write-OK "Node.js: $nv" } else { $missing += 'Node.js' } }
catch { $missing += 'Node.js' }

try { $gv = git --version 2>&1; if ($LASTEXITCODE -eq 0) { Write-OK "Git: $gv" } else { $missing += 'Git' } }
catch { $missing += 'Git' }

if ($missing.Count -gt 0) {
    Write-Warn "누락: $($missing -join ', ') — 자동 설치"
    Write-Host ""

    if ($missing -contains 'Python') {
        $url = 'https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe'
        $path = "$env:TEMP\python-installer.exe"
        Write-Info "Python 다운로드: $url"
        Invoke-WebRequest -Uri $url -OutFile $path -UseBasicParsing
        Write-Info "Python 설치 (관리자 동의 필요)..."
        $proc = Start-Process -FilePath $path `
            -ArgumentList '/quiet','InstallAllUsers=0','PrependPath=1','Include_pip=1','Include_launcher=1' `
            -Wait -PassThru -Verb RunAs
        if ($proc.ExitCode -ne 0) { Write-Err "Python 설치 실패"; exit 1 }
        Update-Path
        $PythonCmd = Find-Python
        if (-not $PythonCmd) { $needsRestart = $true }
    }

    if ($missing -contains 'Git') {
        try {
            winget --version 2>&1 | Out-Null
            if ($LASTEXITCODE -eq 0) {
                winget install --id Git.Git --silent --accept-package-agreements --accept-source-agreements
                Update-Path
            } else { Write-Err "winget 없음 - Git 수동 설치: https://git-scm.com/download/win"; exit 1 }
        } catch { Write-Err "Git 설치 실패: $_"; exit 1 }
        try { git --version 2>&1 | Out-Null; if ($LASTEXITCODE -ne 0) { $needsRestart = $true } } catch { $needsRestart = $true }
    }

    if ($missing -contains 'Node.js') {
        $installed = $false
        try {
            winget --version 2>&1 | Out-Null
            if ($LASTEXITCODE -eq 0) {
                winget install --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
                Update-Path
                $installed = $true
            }
        } catch {}
        if (-not $installed) {
            $url = 'https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi'
            $path = "$env:TEMP\nodejs.msi"
            Invoke-WebRequest -Uri $url -OutFile $path -UseBasicParsing
            Start-Process msiexec.exe -ArgumentList '/i', $path, '/quiet', '/norestart' -Wait -Verb RunAs
            Update-Path
        }
        try { node --version 2>&1 | Out-Null; if ($LASTEXITCODE -ne 0) { $needsRestart = $true } } catch { $needsRestart = $true }
    }

    if ($needsRestart) {
        Write-Host ""
        Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Yellow
        Write-Host "  새로 설치된 도구가 PATH에 반영되려면 PowerShell 재시작 필요" -ForegroundColor Yellow
        Write-Host "  현재 창을 닫고 새 PowerShell을 연 다음 install.ps1을 다시 실행하세요." -ForegroundColor Yellow
        Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Yellow
        Read-Host "Enter 키를 누르면 종료"
        exit 0
    }
}

# ─── venv-launcher ───
Write-Step "Launcher 가상환경 생성"
if (-not (Test-Path 'venv-launcher')) {
    & cmd /c "$PythonCmd -m venv venv-launcher"
    Write-OK "venv-launcher 생성"
} else {
    Write-OK "기존 venv-launcher 사용"
}

$VenvPython = Join-Path $RootDir 'venv-launcher\Scripts\python.exe'

Write-Step "Launcher 의존성 설치"
& $VenvPython -m pip install --upgrade pip --disable-pip-version-check
& $VenvPython -m pip install -r requirements.txt --disable-pip-version-check
Write-OK "Launcher 의존성 완료"

# ─── Frontend ───
Write-Step "Frontend 의존성 설치 (npm install — 1~3분)"
Push-Location frontend
npm install
$rc = $LASTEXITCODE
Pop-Location
if ($rc -ne 0) { Write-Err "npm install 실패"; exit 1 }
Write-OK "Frontend 준비 완료"

Write-Step "✅ 셋업 완료"
Write-Host ""
Write-Host "  실행: .\start.ps1   (또는 start.bat 더블클릭)" -ForegroundColor Yellow
Write-Host ""
Write-Host "  처음 실행 후 브라우저가 자동으로 열리며," -ForegroundColor Gray
Write-Host "  /install 페이지에서 이 PC가 담당할 역할 (host / STT / TTS)을 선택하세요." -ForegroundColor Gray
Write-Host ""
