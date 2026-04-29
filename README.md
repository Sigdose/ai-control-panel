# AI Control Panel

STT · LLM · TTS 모델을 분산 환경에서 통합 관리하는 컨트롤 패널.

```
┌──────────────────────────────────────────────┐
│  Browser (React UI)           :5173          │
│                                              │
│   ─[데이터 경로]── fetch 직결 ─→ STT :5001    │
│                               ─→ LLM :11434  │
│                               ─→ TTS :5002   │
│                                              │
│   ─[제어 경로]── role install/start ─→ Launcher :5000│
│                                       │      │
│                                       └─ subprocess ─→ STT/TTS
└──────────────────────────────────────────────┘
```

**핵심 컨셉**: 모든 PC가 같은 코드를 받음. UI에서 그 PC가 담당할 역할(host / STT / TTS)을 유동적으로 선택. 한 PC가 여러 역할 동시 가능.

## 폴더 구조

```
ai-control-panel/
├── README.md
├── .gitignore
│
├── install.ps1 / install.bat       ← 최초 1회 셋업 (Python/Node/Git + venv-launcher + npm install)
├── start.ps1   / start.bat         ← 매번 실행 (launcher + frontend)
│
├── launcher.py                     ← 호스트 (모든 PC) 항상 실행
├── stt_server.py                   ← STT role 활성화 시 launcher가 실행
├── tts_server.py                   ← TTS role 활성화 시 launcher가 실행
│
├── requirements.txt                ← launcher 자체 (flask)
├── requirements-stt.txt            ← STT role venv용
├── requirements-tts.txt            ← TTS role venv용
│
├── venv-launcher/                  ← install.ps1이 생성
├── venvs/                          ← Roles 페이지에서 install 시 생성
│   ├── venv-stt/
│   └── venv-tts/
│
└── frontend/                       ← React UI
    └── ...
```

## 설치 (모든 PC 공통)

```powershell
# 1) Repo clone
git clone https://github.com/YOUR_USERNAME/ai-control-panel.git
cd ai-control-panel

# 2) 셋업 (Python/Node/Git 자동 설치 + venv-launcher + npm install)
.\install.ps1
# 또는: install.bat 더블클릭
```

## 실행 (매번)

```powershell
.\start.ps1
# 또는: start.bat 더블클릭
```

→ 브라우저가 자동으로 `http://localhost:5173`을 열고, **Roles 페이지**로 이동해서 이 PC가 담당할 역할(STT/TTS)을 활성화.

## 사용 흐름

### 시나리오 1: 단일 PC에 모두 설치

1. `install.ps1` → `start.ps1`
2. **Roles 페이지** → STT role "Install" → 설치 완료 후 "Start"
3. **Roles 페이지** → TTS role "Install" → 설치 완료 후 "Start"
4. LLM은 [Ollama](https://ollama.com/download) 별도 설치 + `ollama pull llama3.1`
5. **Overview 페이지**에서 모든 서비스 초록불 확인 → 통합 파이프라인 사용

### 시나리오 2: 분산 (호스트 + STT 노드 PC)

호스트 PC:
```powershell
git clone https://github.com/YOUR_USERNAME/ai-control-panel.git
cd ai-control-panel
.\install.ps1
.\start.ps1
```

다른 PC를 노드로 합류시키려면 호스트에서 Cloudflare Tunnel:
```cmd
npx cloudflared tunnel --url http://localhost:5173
```

생성된 `https://xxx.trycloudflare.com` 주소를 노드 PC 브라우저에서 열기 → **Roles 페이지** → "다른 PC를 노드로 합류" 섹션의 install 명령어 복사 → 노드 PC PowerShell에 붙여넣기.

설치 완료 후 노드 PC에서 `.\start.ps1` 실행 → 노드 PC의 Roles 페이지에서 STT role install. 

호스트로 돌아와서 **Overview 페이지**의 STT 카드 Endpoint를 노드 PC IP (예: `http://192.168.0.10:5001`)로 변경.

## 주요 페이지

| 페이지 | 설명 |
|--------|------|
| Overview (`/`) | 좌중우 STT/LLM/TTS 카드 + 통합 파이프라인 |
| STT (`/stt`) | 독립 테스트 + 설정 + 로그 |
| LLM (`/llm`) | 모델 선택 + 스트리밍 응답 |
| TTS (`/tts`) | 텍스트 입력 + 음성 합성 |
| **Roles (`/roles`)** | **이 PC의 역할 설치/시작/중지 + install 로그** |

## 트러블슈팅

### `cublas64_12.dll` 에러 (RTX 50 시리즈)

`stt_server.py`가 시작 시 자동으로 venv의 nvidia DLL을 LoadLibrary로 미리 로드함. 그래도 안 되면:
```powershell
venvs\venv-stt\Scripts\pip install --upgrade ctranslate2 nvidia-cublas-cu12 nvidia-cudnn-cu12
```

### Cloudflare Tunnel 호스트 차단

`vite.config.ts`의 `allowedHosts`에 `.trycloudflare.com`이 들어있는지 확인.

### PowerShell 실행 정책

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

또는 `install.bat` / `start.bat` 사용 (자동으로 `-ExecutionPolicy Bypass` 적용).

### Ollama 외부 접속

```cmd
set OLLAMA_HOST=0.0.0.0:11434
set OLLAMA_ORIGINS=*
ollama serve
```
