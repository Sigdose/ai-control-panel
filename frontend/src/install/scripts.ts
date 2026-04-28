// ──────────────────────────────────────────────
// PowerShell 스크립트 생성기 v2
//
// v1과 차이:
//   - prerequisite (Python/Node/Git)을 시작 부분에서 일괄 검증
//   - 누락 항목 자동 설치 시도 → 실패 시 명확히 안내하고 종료
//   - 설치 후 PATH 반영을 위해 새 PowerShell 세션 권장
//   - start.ps1을 bootstrap이 직접 생성 (venv 경로 박힘)
// ──────────────────────────────────────────────

import {
  REPO_URL,
  REPO_BRANCH,
  PYTHON_INSTALLER_URL,
  PYTHON_INSTALLER_VERSION,
} from '../config'

export type NodeType = 'stt' | 'llm' | 'tts'

interface NodeOptions {
  installPath: string
  prefetchModel?: boolean
  startAfterInstall?: boolean
}

// ──────────────────────────────────────────────
// 공통 헤더 + 유틸 함수
// ──────────────────────────────────────────────
function commonHeader(title: string): string {
  return `# ============================================================
#  AI Control Panel — ${title}
#  생성: ${new Date().toISOString()}
#  Repo: ${REPO_URL} (${REPO_BRANCH})
# ============================================================
$ErrorActionPreference = 'Stop'

function Write-Step($msg) { Write-Host ""; Write-Host "─── $msg ───" -ForegroundColor Cyan }
function Write-OK($msg)   { Write-Host "  ✓ $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  ⚠ $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "  ✗ $msg" -ForegroundColor Red }
function Write-Info($msg) { Write-Host "  · $msg" -ForegroundColor Gray }

# 설치 후 PATH 갱신
function Update-Path {
    $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
                [System.Environment]::GetEnvironmentVariable('Path','User')
}
`
}

// ──────────────────────────────────────────────
// Prerequisite 검증 함수들 (재사용)
// ──────────────────────────────────────────────
const checkFunctions = `
# ─── Prerequisite 검증 함수들 ───

function Find-Python310 {
    $candidates = @('py -3.11', 'py -3.10', 'py -3.12', 'python', 'python3')
    foreach ($cmd in $candidates) {
        try {
            $output = & cmd /c "$cmd --version 2>&1"
            if ($output -match 'Python (\\d+)\\.(\\d+)') {
                $major = [int]$Matches[1]; $minor = [int]$Matches[2]
                if ($major -eq 3 -and $minor -ge 10) { return $cmd }
            }
        } catch {}
    }
    return $null
}

function Test-Node {
    try {
        $v = node --version 2>&1
        if ($v -match 'v(\\d+)') {
            $major = [int]$Matches[1]
            if ($major -ge 18) { return $v }
        }
    } catch {}
    return $null
}

function Test-Git {
    try {
        $v = git --version 2>&1
        if ($v -match 'git version') { return $v }
    } catch {}
    return $null
}

function Install-Python {
    Write-Warn "Python 3.10+ 미발견 — 자동 설치"
    $url = '${PYTHON_INSTALLER_URL}'
    $path = "$env:TEMP\\python-${PYTHON_INSTALLER_VERSION}-installer.exe"
    Write-Info "다운로드: $url"
    try {
        Invoke-WebRequest -Uri $url -OutFile $path -UseBasicParsing
    } catch {
        Write-Err "다운로드 실패: $_"
        return $false
    }
    Write-Info "silent 설치 진행 중 (관리자 동의 필요)..."
    $proc = Start-Process -FilePath $path \`
        -ArgumentList '/quiet','InstallAllUsers=0','PrependPath=1','Include_pip=1','Include_launcher=1' \`
        -Wait -PassThru -Verb RunAs
    if ($proc.ExitCode -ne 0) {
        Write-Err "Python 설치 실패 (exit $($proc.ExitCode))"
        return $false
    }
    Update-Path
    return $true
}

function Install-NodeJS {
    Write-Warn "Node.js LTS 미발견 — 자동 설치 시도"
    # winget 우선 시도 (Windows 10 1809+ / 11 기본 탑재)
    try {
        $wingetCheck = winget --version 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Info "winget으로 Node.js LTS 설치..."
            winget install --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
            Update-Path
            return $true
        }
    } catch {}

    # winget 실패 시: 공식 인스톨러 다운로드
    Write-Info "공식 인스톨러로 fallback"
    $nodeUrl = 'https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi'
    $nodePath = "$env:TEMP\\nodejs-installer.msi"
    Write-Info "다운로드: $nodeUrl"
    try {
        Invoke-WebRequest -Uri $nodeUrl -OutFile $nodePath -UseBasicParsing
    } catch {
        Write-Err "Node.js 다운로드 실패: $_"
        return $false
    }
    Write-Info "MSI 설치 진행 중 (관리자 동의 필요)..."
    $proc = Start-Process -FilePath 'msiexec.exe' \`
        -ArgumentList '/i', $nodePath, '/quiet', '/norestart' \`
        -Wait -PassThru -Verb RunAs
    if ($proc.ExitCode -ne 0) {
        Write-Err "Node.js 설치 실패 (exit $($proc.ExitCode))"
        return $false
    }
    Update-Path
    return $true
}

function Install-Git {
    Write-Warn "Git 미발견 — 자동 설치 시도"
    try {
        $wingetCheck = winget --version 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Info "winget으로 Git 설치..."
            winget install --id Git.Git --silent --accept-package-agreements --accept-source-agreements
            Update-Path
            return $true
        }
    } catch {}
    Write-Err "winget 사용 불가 — Git을 수동 설치하세요: https://git-scm.com/download/win"
    return $false
}
`

// ──────────────────────────────────────────────
// Bootstrap에서 쓰는 prerequisite 일괄 검증 (Python + Node + Git)
// ──────────────────────────────────────────────
const bootstrapPrereqCheck = `
# ─── Prerequisite 일괄 검증 ───
Write-Step "환경 검증"
$missing = @()
$needsRestart = $false

# Python
$PythonCmd = Find-Python310
if ($PythonCmd) {
    Write-OK "Python: $PythonCmd"
} else {
    $missing += 'Python'
}

# Node.js
$NodeVer = Test-Node
if ($NodeVer) {
    Write-OK "Node.js: $NodeVer"
} else {
    $missing += 'Node.js'
}

# Git
$GitVer = Test-Git
if ($GitVer) {
    Write-OK "Git: $GitVer"
} else {
    $missing += 'Git'
}

# 누락된 항목 요약 + 자동 설치 동의
if ($missing.Count -gt 0) {
    Write-Host ""
    Write-Warn "다음 도구가 설치되어 있지 않습니다: $($missing -join ', ')"
    Write-Host "  자동 설치를 시도합니다. 각 인스톨러는 관리자 권한 동의 다이얼로그를 띄울 수 있습니다."
    Write-Host ""

    if ($missing -contains 'Python') {
        if (Install-Python) {
            $PythonCmd = Find-Python310
            if ($PythonCmd) { Write-OK "Python 설치 완료: $PythonCmd" }
            else { $needsRestart = $true; Write-Warn "Python 설치됐지만 PATH 반영 필요" }
        } else { exit 1 }
    }

    if ($missing -contains 'Git') {
        if (Install-Git) {
            $GitVer = Test-Git
            if ($GitVer) { Write-OK "Git 설치 완료: $GitVer" }
            else { $needsRestart = $true; Write-Warn "Git 설치됐지만 PATH 반영 필요" }
        } else { exit 1 }
    }

    if ($missing -contains 'Node.js') {
        if (Install-NodeJS) {
            $NodeVer = Test-Node
            if ($NodeVer) { Write-OK "Node.js 설치 완료: $NodeVer" }
            else { $needsRestart = $true; Write-Warn "Node.js 설치됐지만 PATH 반영 필요" }
        } else { exit 1 }
    }

    if ($needsRestart) {
        Write-Host ""
        Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Yellow
        Write-Host "  새로 설치된 도구를 인식하려면 PowerShell을 재시작해야 합니다." -ForegroundColor Yellow
        Write-Host "  현재 창을 닫고 새 PowerShell을 연 다음 이 스크립트를 다시 실행하세요." -ForegroundColor Yellow
        Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Yellow
        Write-Host ""
        Read-Host "Enter 키를 누르면 종료합니다"
        exit 0
    }
}

Write-OK "모든 prerequisite 준비 완료"
`

// ──────────────────────────────────────────────
// Git clone 블록
// ──────────────────────────────────────────────
function gitCloneBlock(installPath: string): string {
  return `
# ─── 리포지토리 클론 ───
Write-Step "리포지토리 클론"
$InstallPath = '${installPath.replace(/'/g, "''")}'

if (Test-Path $InstallPath) {
    if ((Get-ChildItem $InstallPath -Force | Measure-Object).Count -gt 0) {
        Write-Warn "경로가 비어있지 않음: $InstallPath"
        $resp = Read-Host "  계속하면 git pull을 시도합니다. 계속? (y/N)"
        if ($resp -ne 'y' -and $resp -ne 'Y') { exit 0 }
        Set-Location $InstallPath
        git pull
        Write-OK "git pull 완료"
    } else {
        Set-Location $InstallPath
        git clone --branch ${REPO_BRANCH} ${REPO_URL} .
        Write-OK "clone 완료"
    }
} else {
    New-Item -ItemType Directory -Path $InstallPath -Force | Out-Null
    Set-Location $InstallPath
    git clone --branch ${REPO_BRANCH} ${REPO_URL} .
    Write-OK "clone 완료: $InstallPath"
}
`
}

// ──────────────────────────────────────────────
// venv 생성 + pip 설치 (절대경로로 venv python을 호출, 활성화 불필요)
// ──────────────────────────────────────────────
function venvBlock(venvName: string, requirementsFile: string | null, extraPip: string[] = []): string {
  const reqInstall = requirementsFile
    ? `
Write-Step "의존성 설치 (${requirementsFile})"
if (-not (Test-Path '${requirementsFile}')) {
    Write-Err "${requirementsFile} 파일을 찾을 수 없습니다."
    exit 1
}
& $VenvPython -m pip install -r ${requirementsFile} --disable-pip-version-check
Write-OK "${requirementsFile} 설치 완료"
` : ''

  const extraInstall = extraPip.length > 0
    ? `
Write-Step "추가 패키지 설치"
& $VenvPython -m pip install ${extraPip.join(' ')} --disable-pip-version-check
Write-OK "추가 패키지 설치 완료"
` : ''

  return `
# ─── venv: ${venvName} ───
# 활성화 대신 venv의 python.exe를 절대경로로 호출 (서브셸 문제 회피)
Write-Step "가상환경 생성: ${venvName}"
if (-not (Test-Path "${venvName}")) {
    & cmd /c "$PythonCmd -m venv ${venvName}"
    Write-OK "${venvName} 생성"
} else {
    Write-OK "기존 ${venvName} 사용"
}

$VenvPython = Join-Path (Get-Location) '${venvName}\\Scripts\\python.exe'
if (-not (Test-Path $VenvPython)) {
    Write-Err "venv python.exe를 찾을 수 없음: $VenvPython"
    exit 1
}

Write-Step "pip 업그레이드 (${venvName})"
& $VenvPython -m pip install --upgrade pip --disable-pip-version-check
Write-OK "pip 업그레이드 완료"
${reqInstall}${extraInstall}`
}

// ──────────────────────────────────────────────
// (1) Bootstrap — 컨트롤 패널 자체 설치
// ──────────────────────────────────────────────
export function bootstrapScript(installPath: string): string {
  return `${commonHeader('Bootstrap (Control Panel)')}
${checkFunctions}
${bootstrapPrereqCheck}
${gitCloneBlock(installPath)}
${venvBlock('venv-launcher', null, ['flask', 'flask-cors'])}

# ─── Frontend 의존성 ───
Write-Step "Frontend 의존성 설치 (npm install — 1~3분 소요)"
Push-Location frontend
npm install
if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Write-Err "npm install 실패"
    exit 1
}
Pop-Location
Write-OK "Frontend 준비 완료"

# ─── start.ps1 자동 생성 (venv python 경로 박힘) ───
Write-Step "start.ps1 생성"
$LauncherPython = Join-Path (Get-Location) 'venv-launcher\\Scripts\\python.exe'
$startContent = @"
# AI Control Panel — 시작 스크립트 (auto-generated)
\\$root = Split-Path -Parent \\$MyInvocation.MyCommand.Definition
Set-Location \\$root

Write-Host '============================================================' -ForegroundColor Cyan
Write-Host '  AI Control Panel — Launching' -ForegroundColor Cyan
Write-Host '============================================================' -ForegroundColor Cyan

Write-Host '[1/2] Launcher (port 5000)...' -ForegroundColor Yellow
Start-Process powershell -ArgumentList '-NoExit','-Command',\\"cd '\\$root'; & '$LauncherPython' launcher.py\\"

Start-Sleep -Seconds 2

Write-Host '[2/2] Frontend (port 5173) + 브라우저 오픈...' -ForegroundColor Yellow
Start-Process powershell -ArgumentList '-NoExit','-Command',\\"cd '\\$root\\frontend'; npm run dev -- --open\\"

Write-Host ''
Write-Host '두 개의 PowerShell 창이 열렸습니다.' -ForegroundColor Green
Write-Host '종료: 각 창에서 Ctrl+C 또는 창 닫기' -ForegroundColor Gray
"@
Set-Content -Path 'start.ps1' -Value $startContent -Encoding UTF8
Write-OK "start.ps1 생성 완료"

Write-Step "✅ Bootstrap 완료"
Write-Host ""
Write-Host "  설치 경로: $InstallPath" -ForegroundColor Green
Write-Host ""
Write-Host "  실행 방법:" -ForegroundColor Yellow
Write-Host "    .\\start.ps1"
Write-Host ""
Write-Host "  실행 후 브라우저가 열리면 /install 페이지로 이동해서" -ForegroundColor Gray
Write-Host "  STT/LLM/TTS 노드 타입을 선택해 추가 설치하세요." -ForegroundColor Gray
Write-Host ""
`
}

// ──────────────────────────────────────────────
// (2) STT 노드
// ──────────────────────────────────────────────
export function sttNodeScript(opts: NodeOptions): string {
  const prefetch = opts.prefetchModel !== false
  const start = opts.startAfterInstall === true
  return `${commonHeader('STT Node (faster-whisper)')}
${checkFunctions}

# ─── Prerequisite (Python + Git) ───
Write-Step "환경 검증"
$missing = @()
$needsRestart = $false
$PythonCmd = Find-Python310
if ($PythonCmd) { Write-OK "Python: $PythonCmd" } else { $missing += 'Python' }
$GitVer = Test-Git
if ($GitVer) { Write-OK "Git: $GitVer" } else { $missing += 'Git' }

if ($missing.Count -gt 0) {
    Write-Warn "누락: $($missing -join ', ') — 자동 설치"
    if ($missing -contains 'Python') {
        if (Install-Python) { $PythonCmd = Find-Python310; if (-not $PythonCmd) { $needsRestart = $true } } else { exit 1 }
    }
    if ($missing -contains 'Git') {
        if (Install-Git) { $GitVer = Test-Git; if (-not $GitVer) { $needsRestart = $true } } else { exit 1 }
    }
    if ($needsRestart) {
        Write-Warn "PATH 반영을 위해 PowerShell을 재시작 후 다시 실행하세요."
        Read-Host "Enter 키를 누르면 종료"
        exit 0
    }
}
${gitCloneBlock(opts.installPath)}
${venvBlock('venv', 'requirements-stt.txt')}

${prefetch ? `# ─── 모델 미리 다운로드 ───
Write-Step "Whisper large-v3 모델 다운로드 (~2.9GB, 1~5분)"
& $VenvPython -c "from faster_whisper import WhisperModel; m = WhisperModel('large-v3'); print('OK')"
Write-OK "모델 캐시 준비 완료"
` : ''}

# ─── start-stt.ps1 자동 생성 ───
Write-Step "start-stt.ps1 생성"
$startContent = @"
\\$root = Split-Path -Parent \\$MyInvocation.MyCommand.Definition
Set-Location \\$root
& '$VenvPython' stt_server.py
"@
Set-Content -Path 'start-stt.ps1' -Value $startContent -Encoding UTF8
Write-OK "start-stt.ps1 생성"

Write-Step "✅ STT 노드 설치 완료"
Write-Host ""
Write-Host "  설치 경로: $InstallPath" -ForegroundColor Green
Write-Host ""
Write-Host "  서버 실행: .\\start-stt.ps1" -ForegroundColor Yellow
Write-Host ""

$ip = (Get-NetIPAddress -AddressFamily IPv4 -PrefixOrigin Dhcp,Manual -ErrorAction SilentlyContinue \`
       | Where-Object { $_.IPAddress -notmatch '^169\\.254' } \`
       | Select-Object -First 1).IPAddress
Write-Host "  호스트 패널에 등록할 URL:" -ForegroundColor Yellow
if ($ip) { Write-Host "    http://${'$'}ip:5001" -ForegroundColor Cyan }
else     { Write-Host "    http://<이 PC의 LAN IP>:5001" -ForegroundColor Cyan }
Write-Host ""

${start ? `Write-Step "서버 시작"
& $VenvPython stt_server.py
` : ''}
`
}

// ──────────────────────────────────────────────
// (3) LLM 노드 — Ollama
// ──────────────────────────────────────────────
export function llmNodeScript(opts: NodeOptions): string {
  const start = opts.startAfterInstall === true
  return `${commonHeader('LLM Node (Ollama)')}
${checkFunctions}

# ─── Ollama 설치 확인 ───
Write-Step "Ollama 확인"
$ollamaInstalled = $false
try {
    $v = ollama --version 2>&1
    if ($LASTEXITCODE -eq 0) { Write-OK "$v"; $ollamaInstalled = $true }
} catch {}

if (-not $ollamaInstalled) {
    Write-Warn "Ollama 미설치 — 자동 설치"
    $url = 'https://ollama.com/download/OllamaSetup.exe'
    $path = "$env:TEMP\\OllamaSetup.exe"
    Write-Info "다운로드: $url"
    Invoke-WebRequest -Uri $url -OutFile $path -UseBasicParsing
    Write-Info "설치 진행 (사용자 동의 필요)..."
    Start-Process -FilePath $path -Wait
    Update-Path
    Write-OK "Ollama 설치 완료"
}

# ─── 외부 접속 환경변수 (영구) ───
Write-Step "Ollama 외부 접속 설정"
[System.Environment]::SetEnvironmentVariable('OLLAMA_HOST', '0.0.0.0:11434', 'User')
[System.Environment]::SetEnvironmentVariable('OLLAMA_ORIGINS', '*', 'User')
$env:OLLAMA_HOST = '0.0.0.0:11434'
$env:OLLAMA_ORIGINS = '*'
Write-OK "OLLAMA_HOST=0.0.0.0:11434 (영구)"
Write-OK "OLLAMA_ORIGINS=* (영구)"

# ─── 모델 pull ───
Write-Step "기본 모델 다운로드"
Write-Host "  Llama 3.1 (~4.7GB) + Gemma 2 (~1.6GB)"
$resp = Read-Host "  진행? (Y/n)"
if ($resp -ne 'n' -and $resp -ne 'N') {
    ollama pull llama3.1
    Write-OK "llama3.1"
    ollama pull gemma2:2b
    Write-OK "gemma2:2b"
}

Write-Step "✅ LLM 노드 설치 완료"
Write-Host ""
$ip = (Get-NetIPAddress -AddressFamily IPv4 -PrefixOrigin Dhcp,Manual -ErrorAction SilentlyContinue \`
       | Where-Object { $_.IPAddress -notmatch '^169\\.254' } \`
       | Select-Object -First 1).IPAddress
Write-Host "  호스트 패널에 등록할 URL:" -ForegroundColor Yellow
if ($ip) { Write-Host "    http://${'$'}ip:11434" -ForegroundColor Cyan }
else     { Write-Host "    http://<이 PC의 LAN IP>:11434" -ForegroundColor Cyan }
Write-Host ""
Write-Host "  ⚠ 환경변수 반영을 위해 Ollama를 재시작하세요." -ForegroundColor Yellow
Write-Host ""

${start ? `Stop-Process -Name ollama -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Start-Process ollama -ArgumentList 'serve'
Write-OK "Ollama serve 재시작"
` : ''}
`
}

// ──────────────────────────────────────────────
// (4) TTS 노드 — Chatterbox
// ──────────────────────────────────────────────
export function ttsNodeScript(opts: NodeOptions): string {
  const prefetch = opts.prefetchModel !== false
  const start = opts.startAfterInstall === true
  return `${commonHeader('TTS Node (Chatterbox)')}
${checkFunctions}

# ─── Prerequisite (Python + Git) ───
Write-Step "환경 검증"
$missing = @()
$needsRestart = $false
$PythonCmd = Find-Python310
if ($PythonCmd) { Write-OK "Python: $PythonCmd" } else { $missing += 'Python' }
$GitVer = Test-Git
if ($GitVer) { Write-OK "Git: $GitVer" } else { $missing += 'Git' }

if ($missing.Count -gt 0) {
    Write-Warn "누락: $($missing -join ', ') — 자동 설치"
    if ($missing -contains 'Python') {
        if (Install-Python) { $PythonCmd = Find-Python310; if (-not $PythonCmd) { $needsRestart = $true } } else { exit 1 }
    }
    if ($missing -contains 'Git') {
        if (Install-Git) { $GitVer = Test-Git; if (-not $GitVer) { $needsRestart = $true } } else { exit 1 }
    }
    if ($needsRestart) {
        Write-Warn "PATH 반영을 위해 PowerShell을 재시작 후 다시 실행하세요."
        Read-Host "Enter 키를 누르면 종료"
        exit 0
    }
}
${gitCloneBlock(opts.installPath)}
${venvBlock('venv', null, ['chatterbox-tts', 'flask', 'flask-cors', 'num2words', 'soundfile', 'numpy', 'nvidia-ml-py'])}

# ─── PyTorch (CUDA 12 — Blackwell 호환) ───
Write-Step "PyTorch (CUDA 12.x) 설치"
& $VenvPython -m pip install --upgrade torch torchaudio --index-url https://download.pytorch.org/whl/cu128 --disable-pip-version-check
Write-OK "PyTorch 설치 완료"

${prefetch ? `# ─── 모델 미리 다운로드 ───
Write-Step "Chatterbox 모델 다운로드 (~3GB, 5~10분)"
& $VenvPython -c "from chatterbox.mtl_tts import ChatterboxMultilingualTTS; m = ChatterboxMultilingualTTS.from_pretrained(device='cuda'); print('OK')"
Write-OK "모델 캐시 준비 완료"
` : ''}

# ─── start-tts.ps1 자동 생성 ───
Write-Step "start-tts.ps1 생성"
$startContent = @"
\\$root = Split-Path -Parent \\$MyInvocation.MyCommand.Definition
Set-Location \\$root
& '$VenvPython' tts_server.py
"@
Set-Content -Path 'start-tts.ps1' -Value $startContent -Encoding UTF8
Write-OK "start-tts.ps1 생성"

Write-Step "✅ TTS 노드 설치 완료"
Write-Host ""
Write-Host "  설치 경로: $InstallPath" -ForegroundColor Green
Write-Host ""
Write-Host "  서버 실행: .\\start-tts.ps1" -ForegroundColor Yellow
Write-Host ""

$ip = (Get-NetIPAddress -AddressFamily IPv4 -PrefixOrigin Dhcp,Manual -ErrorAction SilentlyContinue \`
       | Where-Object { $_.IPAddress -notmatch '^169\\.254' } \`
       | Select-Object -First 1).IPAddress
Write-Host "  호스트 패널에 등록할 URL:" -ForegroundColor Yellow
if ($ip) { Write-Host "    http://${'$'}ip:5002" -ForegroundColor Cyan }
else     { Write-Host "    http://<이 PC의 LAN IP>:5002" -ForegroundColor Cyan }
Write-Host ""

${start ? `Write-Step "서버 시작"
& $VenvPython tts_server.py
` : ''}
`
}

// ──────────────────────────────────────────────
// 디스패처
// ──────────────────────────────────────────────
export function generateNodeScript(type: NodeType, opts: NodeOptions): string {
  switch (type) {
    case 'stt': return sttNodeScript(opts)
    case 'llm': return llmNodeScript(opts)
    case 'tts': return ttsNodeScript(opts)
  }
}

export const NODE_INFO: Record<NodeType, {
  label: string
  description: string
  size: string
  port: number
  accent: string
}> = {
  stt: {
    label: 'STT Node',
    description: 'faster-whisper · 음성 인식 모델 서버',
    size: 'venv ~3GB + 모델 ~3GB',
    port: 5001,
    accent: 'stt',
  },
  llm: {
    label: 'LLM Node',
    description: 'Ollama · 로컬 언어 모델 서버 (Llama / Gemma)',
    size: 'Ollama ~500MB + 모델 6~7GB',
    port: 11434,
    accent: 'llm',
  },
  tts: {
    label: 'TTS Node',
    description: 'Chatterbox · 음성 합성 모델 서버',
    size: 'venv ~5GB + 모델 ~3GB',
    port: 5002,
    accent: 'tts',
  },
}
