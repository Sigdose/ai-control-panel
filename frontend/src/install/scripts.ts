// ──────────────────────────────────────────────
// PowerShell 스크립트 생성기
//
// 4종류:
//   - bootstrap : 새 PC에 컨트롤 패널 자체 설치 (frontend 포함)
//   - stt-node  : STT 노드 셋업 (faster-whisper)
//   - llm-node  : LLM 노드 셋업 (Ollama)
//   - tts-node  : TTS 노드 셋업 (Chatterbox)
//
// 모든 스크립트는:
//   - Python 3.10+ 체크 (없으면 winget → 공식 인스톨러)
//   - 경로 생성, git clone
//   - venv 생성, pip 설치
//   - 모델 미리 다운로드 (옵션)
//   - 서비스 시작 (옵션)
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
  prefetchModel?: boolean   // 모델 미리 다운로드 여부 (기본 true)
  startAfterInstall?: boolean  // 설치 후 자동 실행 (기본 false)
}

// ──────────────────────────────────────────────
// 공통 헤더 (모든 스크립트의 시작 부분)
// ──────────────────────────────────────────────
function commonHeader(title: string): string {
  return `# ============================================================
#  AI Control Panel — ${title}
#  생성 시각: ${new Date().toISOString()}
#  Repo:      ${REPO_URL} (${REPO_BRANCH})
# ============================================================
$ErrorActionPreference = 'Stop'

function Write-Step($msg) {
    Write-Host ""
    Write-Host "─── $msg ───" -ForegroundColor Cyan
}
function Write-OK($msg)    { Write-Host "  ✓ $msg" -ForegroundColor Green }
function Write-Warn($msg)  { Write-Host "  ⚠ $msg" -ForegroundColor Yellow }
function Write-Err($msg)   { Write-Host "  ✗ $msg" -ForegroundColor Red }
`
}

// ──────────────────────────────────────────────
// Python 3.10+ 보장 (winget → 공식 인스톨러 fallback)
// ──────────────────────────────────────────────
const ensurePythonBlock = `
# ─── Python 3.10+ 확인 / 자동 설치 ───
Write-Step "Python 3.10+ 확인"

function Test-Python310 {
    $candidates = @('py -3.11', 'py -3.10', 'py -3.12', 'python', 'python3')
    foreach ($cmd in $candidates) {
        try {
            $output = & cmd /c "$cmd --version 2>&1"
            if ($output -match 'Python (\\d+)\\.(\\d+)') {
                $major = [int]$Matches[1]; $minor = [int]$Matches[2]
                if ($major -eq 3 -and $minor -ge 10) {
                    return $cmd
                }
            }
        } catch {}
    }
    return $null
}

$PythonCmd = Test-Python310
if ($PythonCmd) {
    Write-OK "사용 가능한 Python: $PythonCmd"
} else {
    Write-Warn "Python 3.10+ 미발견 — 공식 인스톨러로 자동 설치"

    $installerUrl = '${PYTHON_INSTALLER_URL}'
    $installerPath = "$env:TEMP\\python-${PYTHON_INSTALLER_VERSION}-installer.exe"

    Write-Host "  다운로드: $installerUrl"
    try {
        Invoke-WebRequest -Uri $installerUrl -OutFile $installerPath -UseBasicParsing
        Write-OK "다운로드 완료: $installerPath"
    } catch {
        Write-Err "다운로드 실패: $_"
        Write-Host "  수동 설치: https://www.python.org/downloads/"
        exit 1
    }

    Write-Host "  silent 설치 진행 중... (관리자 동의 다이얼로그가 뜰 수 있음)"
    # /quiet : UI 없음, InstallAllUsers=0 : 현재 사용자만, PrependPath=1 : PATH 자동 추가
    $proc = Start-Process -FilePath $installerPath \`
        -ArgumentList '/quiet', 'InstallAllUsers=0', 'PrependPath=1', 'Include_pip=1', 'Include_launcher=1' \`
        -Wait -PassThru -Verb RunAs
    if ($proc.ExitCode -ne 0) {
        Write-Err "Python 설치 실패 (exit $($proc.ExitCode))"
        exit 1
    }
    Write-OK "Python ${PYTHON_INSTALLER_VERSION} 설치 완료"

    # 설치 직후엔 현재 셸의 PATH에 반영 안 되니 새로 검색
    $env:Path = [System.Environment]::GetEnvironmentVariable('Path','User') + ';' + \`
                [System.Environment]::GetEnvironmentVariable('Path','Machine')
    $PythonCmd = Test-Python310
    if (-not $PythonCmd) {
        Write-Err "설치는 됐지만 PATH에 반영되지 않음. PowerShell을 재시작 후 스크립트 다시 실행하세요."
        exit 1
    }
}
`

// ──────────────────────────────────────────────
// Git 확인 + clone
// ──────────────────────────────────────────────
function gitCloneBlock(installPath: string): string {
  return `
# ─── Git 확인 ───
Write-Step "Git 확인"
try {
    $gitVersion = git --version
    Write-OK "$gitVersion"
} catch {
    Write-Err "Git이 설치되어 있지 않습니다."
    Write-Host "  설치: https://git-scm.com/download/win"
    Write-Host "  또는: winget install Git.Git"
    exit 1
}

# ─── 설치 경로 + clone ───
Write-Step "리포지토리 클론"
$InstallPath = '${installPath.replace(/'/g, "''")}'

if (Test-Path $InstallPath) {
    if ((Get-ChildItem $InstallPath -Force | Measure-Object).Count -gt 0) {
        Write-Warn "경로가 비어있지 않음: $InstallPath"
        $resp = Read-Host "  계속 진행하면 그 안에서 git pull을 시도합니다. 계속할까요? (y/N)"
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
// venv 생성 + pip 설치 (공통)
// ──────────────────────────────────────────────
function venvBlock(requirementsFile: string): string {
  return `
# ─── 가상환경 생성 ───
Write-Step "가상환경 생성 (venv)"
if (-not (Test-Path "venv")) {
    & cmd /c "$PythonCmd -m venv venv"
    Write-OK "venv 생성 완료"
} else {
    Write-OK "기존 venv 사용"
}

$VenvPython = Join-Path (Get-Location) 'venv\\Scripts\\python.exe'
$VenvPip    = Join-Path (Get-Location) 'venv\\Scripts\\pip.exe'

# ─── pip 업그레이드 ───
Write-Step "pip 업그레이드"
& $VenvPython -m pip install --upgrade pip --disable-pip-version-check
Write-OK "pip 업그레이드 완료"

# ─── 의존성 설치 ───
Write-Step "의존성 설치 (${requirementsFile})"
if (-not (Test-Path '${requirementsFile}')) {
    Write-Err "${requirementsFile} 파일을 찾을 수 없습니다."
    exit 1
}
& $VenvPip install -r ${requirementsFile} --disable-pip-version-check
Write-OK "의존성 설치 완료"
`
}

// ──────────────────────────────────────────────
// (1) Bootstrap — 컨트롤 패널 자체 설치
// 노드 PC가 처음 받는 스크립트. frontend + launcher + 기본 서버 코드 다 받음.
// ──────────────────────────────────────────────
export function bootstrapScript(installPath: string): string {
  return `${commonHeader('Bootstrap (Control Panel)')}
${ensurePythonBlock}
${gitCloneBlock(installPath)}

# ─── Node.js 확인 ───
Write-Step "Node.js 확인"
try {
    $nodeVersion = node --version
    Write-OK "Node.js $nodeVersion"
} catch {
    Write-Err "Node.js가 설치되어 있지 않습니다."
    Write-Host "  설치: https://nodejs.org/ (LTS 권장)"
    Write-Host "  또는: winget install OpenJS.NodeJS.LTS"
    $resp = Read-Host "  계속하려면 Node.js 설치 후 다시 실행하세요. 종료 (Enter)"
    exit 1
}

# ─── 런처용 venv (frontend랑 별개로 가벼운 환경) ───
Write-Step "런처 의존성 설치"
& cmd /c "$PythonCmd -m venv venv-launcher"
$LauncherPython = Join-Path (Get-Location) 'venv-launcher\\Scripts\\python.exe'
& $LauncherPython -m pip install --upgrade pip --disable-pip-version-check
& $LauncherPython -m pip install flask flask-cors --disable-pip-version-check
Write-OK "런처 의존성 설치 완료"

# ─── Frontend 의존성 ───
Write-Step "Frontend 의존성 설치 (npm install — 1~3분 소요)"
Push-Location frontend
npm install
Pop-Location
Write-OK "Frontend 준비 완료"

Write-Step "✅ 완료"
Write-Host ""
Write-Host "  컨트롤 패널 설치가 완료되었습니다." -ForegroundColor Green
Write-Host ""
Write-Host "  실행 방법:" -ForegroundColor Yellow
Write-Host "    .\\start.ps1"
Write-Host ""
Write-Host "  또는 수동:" -ForegroundColor Yellow
Write-Host "    창 1) venv-launcher\\Scripts\\python.exe launcher.py"
Write-Host "    창 2) cd frontend; npm run dev -- --open"
Write-Host ""
`
}

// ──────────────────────────────────────────────
// (2) STT 노드 — faster-whisper
// ──────────────────────────────────────────────
export function sttNodeScript(opts: NodeOptions): string {
  const prefetch = opts.prefetchModel !== false
  const start = opts.startAfterInstall === true
  return `${commonHeader('STT Node (faster-whisper)')}
${ensurePythonBlock}
${gitCloneBlock(opts.installPath)}
${venvBlock('requirements-stt.txt')}

${prefetch ? `# ─── 모델 미리 다운로드 (large-v3, ~2.9GB) ───
Write-Step "Whisper large-v3 모델 다운로드 (첫 실행, 1~5분)"
& $VenvPython -c "from faster_whisper import WhisperModel; m = WhisperModel('large-v3'); print('OK')"
Write-OK "모델 캐시 준비 완료"
` : ''}

Write-Step "✅ STT 노드 설치 완료"
Write-Host ""
Write-Host "  설치 경로: $InstallPath" -ForegroundColor Green
Write-Host ""
Write-Host "  서버 실행:" -ForegroundColor Yellow
Write-Host "    venv\\Scripts\\python.exe stt_server.py"
Write-Host ""
Write-Host "  호스트 패널에 등록할 URL:" -ForegroundColor Yellow
$ip = (Get-NetIPAddress -AddressFamily IPv4 -PrefixOrigin Dhcp,Manual -ErrorAction SilentlyContinue \`
       | Where-Object { $_.IPAddress -notmatch '^169\\.254' } \`
       | Select-Object -First 1).IPAddress
if ($ip) {
    Write-Host "    http://${'$'}ip:5001" -ForegroundColor Cyan
} else {
    Write-Host "    http://<이 PC의 LAN IP>:5001" -ForegroundColor Cyan
}
Write-Host ""

${start ? `Write-Step "서버 시작"
& $VenvPython stt_server.py
` : ''}
`
}

// ──────────────────────────────────────────────
// (3) LLM 노드 — Ollama (Python 거의 안 씀)
// ──────────────────────────────────────────────
export function llmNodeScript(opts: NodeOptions): string {
  const start = opts.startAfterInstall === true
  return `${commonHeader('LLM Node (Ollama)')}

# Ollama는 Python 의존성 없음. 자체 인스톨러로 설치.

# ─── Ollama 설치 확인 ───
Write-Step "Ollama 확인"
$ollamaInstalled = $false
try {
    $ollamaVersion = ollama --version 2>&1
    Write-OK "$ollamaVersion"
    $ollamaInstalled = $true
} catch {
    Write-Warn "Ollama 미설치 — 자동 설치 진행"
}

if (-not $ollamaInstalled) {
    $installerUrl = 'https://ollama.com/download/OllamaSetup.exe'
    $installerPath = "$env:TEMP\\OllamaSetup.exe"

    Write-Host "  다운로드: $installerUrl"
    try {
        Invoke-WebRequest -Uri $installerUrl -OutFile $installerPath -UseBasicParsing
        Write-OK "다운로드 완료"
    } catch {
        Write-Err "다운로드 실패: $_"
        Write-Host "  수동 설치: https://ollama.com/download/windows"
        exit 1
    }

    Write-Host "  설치 진행 중... (사용자 동의 필요)"
    Start-Process -FilePath $installerPath -Wait
    Write-OK "Ollama 설치 완료"

    # PATH 갱신
    $env:Path = [System.Environment]::GetEnvironmentVariable('Path','User') + ';' + \`
                [System.Environment]::GetEnvironmentVariable('Path','Machine')
}

# ─── 외부 접속 허용 환경변수 (영구) ───
Write-Step "Ollama 외부 접속 설정"
[System.Environment]::SetEnvironmentVariable('OLLAMA_HOST', '0.0.0.0:11434', 'User')
[System.Environment]::SetEnvironmentVariable('OLLAMA_ORIGINS', '*', 'User')
$env:OLLAMA_HOST = '0.0.0.0:11434'
$env:OLLAMA_ORIGINS = '*'
Write-OK "OLLAMA_HOST=0.0.0.0:11434 설정 (영구)"
Write-OK "OLLAMA_ORIGINS=* 설정 (영구)"

# ─── 모델 pull ───
Write-Step "기본 모델 다운로드"
Write-Host "  Llama 3.1 (~4.7GB) 와 Gemma 2 (~1.6GB) 받습니다."
$resp = Read-Host "  진행할까요? (Y/n)"
if ($resp -ne 'n' -and $resp -ne 'N') {
    Write-Host "  Llama 3.1 다운로드..."
    ollama pull llama3.1
    Write-OK "llama3.1 완료"
    Write-Host "  Gemma 2 다운로드..."
    ollama pull gemma2:2b
    Write-OK "gemma2:2b 완료"
}

Write-Step "✅ LLM 노드 설치 완료"
Write-Host ""
Write-Host "  Ollama 서비스가 백그라운드에서 자동 실행됩니다." -ForegroundColor Green
Write-Host "  (시작프로그램에 등록되어 있음)"
Write-Host ""
Write-Host "  호스트 패널에 등록할 URL:" -ForegroundColor Yellow
$ip = (Get-NetIPAddress -AddressFamily IPv4 -PrefixOrigin Dhcp,Manual -ErrorAction SilentlyContinue \`
       | Where-Object { $_.IPAddress -notmatch '^169\\.254' } \`
       | Select-Object -First 1).IPAddress
if ($ip) {
    Write-Host "    http://${'$'}ip:11434" -ForegroundColor Cyan
} else {
    Write-Host "    http://<이 PC의 LAN IP>:11434" -ForegroundColor Cyan
}
Write-Host ""

${start ? `Write-Step "Ollama 재시작 (환경변수 반영)"
Stop-Process -Name ollama -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Start-Process ollama -ArgumentList 'serve'
Write-OK "Ollama serve 시작"
` : 'Write-Host "  ⚠ 환경변수 반영을 위해 Ollama를 한 번 재시작하세요." -ForegroundColor Yellow'}
`
}

// ──────────────────────────────────────────────
// (4) TTS 노드 — Chatterbox
// ──────────────────────────────────────────────
export function ttsNodeScript(opts: NodeOptions): string {
  const prefetch = opts.prefetchModel !== false
  const start = opts.startAfterInstall === true
  return `${commonHeader('TTS Node (Chatterbox)')}
${ensurePythonBlock}
${gitCloneBlock(opts.installPath)}

# ─── 가상환경 + pip ───
Write-Step "가상환경 생성"
if (-not (Test-Path "venv")) {
    & cmd /c "$PythonCmd -m venv venv"
    Write-OK "venv 생성"
} else {
    Write-OK "기존 venv 사용"
}
$VenvPython = Join-Path (Get-Location) 'venv\\Scripts\\python.exe'
$VenvPip    = Join-Path (Get-Location) 'venv\\Scripts\\pip.exe'

Write-Step "pip 업그레이드"
& $VenvPython -m pip install --upgrade pip --disable-pip-version-check

Write-Step "Chatterbox 의존성 설치 (수 분 소요)"
& $VenvPip install --disable-pip-version-check \`
    chatterbox-tts flask flask-cors num2words \`
    soundfile numpy
# torch는 별도 인덱스 (CUDA 12 사용자 — Blackwell 호환)
Write-Step "PyTorch (CUDA 12.x) 설치"
& $VenvPip install --upgrade torch torchaudio --index-url https://download.pytorch.org/whl/cu128 --disable-pip-version-check
Write-OK "의존성 설치 완료"

${prefetch ? `# ─── 모델 미리 다운로드 (~3GB) ───
Write-Step "Chatterbox 모델 다운로드 (첫 실행, 5~10분)"
& $VenvPython -c "from chatterbox.mtl_tts import ChatterboxMultilingualTTS; m = ChatterboxMultilingualTTS.from_pretrained(device='cuda'); print('OK')"
Write-OK "모델 캐시 준비 완료"
` : ''}

Write-Step "✅ TTS 노드 설치 완료"
Write-Host ""
Write-Host "  설치 경로: $InstallPath" -ForegroundColor Green
Write-Host ""
Write-Host "  서버 실행:" -ForegroundColor Yellow
Write-Host "    venv\\Scripts\\python.exe tts_server.py"
Write-Host ""
Write-Host "  호스트 패널에 등록할 URL:" -ForegroundColor Yellow
$ip = (Get-NetIPAddress -AddressFamily IPv4 -PrefixOrigin Dhcp,Manual -ErrorAction SilentlyContinue \`
       | Where-Object { $_.IPAddress -notmatch '^169\\.254' } \`
       | Select-Object -First 1).IPAddress
if ($ip) {
    Write-Host "    http://${'$'}ip:5002" -ForegroundColor Cyan
} else {
    Write-Host "    http://<이 PC의 LAN IP>:5002" -ForegroundColor Cyan
}
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
