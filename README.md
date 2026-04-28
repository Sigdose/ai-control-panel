# AI Control Panel

STT · LLM · TTS 통합 컨트롤 패널. 로컬 환경에서 세 모델을 한곳에서 테스트하고, 메인 페이지에서 음성 → 텍스트 → 응답 → 음성 파이프라인을 한 번에 돌려볼 수 있는 대시보드. 더불어 **런처 백엔드**가 각 서비스 프로세스를 UI에서 시작/중지할 수 있게 해줌.

```
┌──────────────────────────────────────────────┐
│  Browser (React / Vite)       :5173          │
│                                              │
│   ─[데이터 경로]── fetch 직결 ─→ STT :5001    │
│                               ─→ LLM :11434  │
│                               ─→ TTS :5002   │
│                                              │
│   ─[제어 경로]── Start/Stop ──→ Launcher :5000│
│                                 │            │
│                                 └─ subprocess ─→ STT/LLM/TTS
└──────────────────────────────────────────────┘
```

**데이터 경로 vs 제어 경로는 완전히 분리.** 런처는 `subprocess.Popen`으로 서비스를 띄우고 죽이기만 하고, 실제 추론 호출(데이터)은 브라우저가 각 서버에 직접 때림.

분산 PC 환경: 각 서비스 URL은 UI에서 즉시 변경 (localStorage 저장). **런처는 로컬 전용** — 원격 PC 프로세스는 관리 불가 (Remote 모드에선 URL만 등록).

---

## 디렉토리 구조

```
ai-control-panel/
├── stt_server.py              # faster-whisper Flask 서버 (포트 5001)
├── tts_server.py              # 기존 Chatterbox TTS 서버 (포트 5002)
├── requirements-stt.txt
└── frontend/
    ├── package.json
    ├── vite.config.ts
    ├── tailwind.config.js
    ├── index.html
    └── src/
        ├── main.tsx                  # 진입점 (BrowserRouter)
        ├── App.tsx                   # 라우팅 + health polling 시작
        ├── index.css                 # Tailwind + 커스텀 토큰
        ├── types.ts                  # 모든 타입
        ├── store/serverStore.ts      # Zustand: URL persist + health 상태
        ├── api/                      # 서버별 fetch 클라이언트
        │   ├── stt.ts
        │   ├── llm.ts                # Ollama (스트리밍 지원)
        │   └── tts.ts
        ├── hooks/
        │   ├── useHealthCheck.ts     # 5초마다 3개 서버 ping
        │   └── useAudioRecorder.ts   # MediaRecorder 래퍼
        ├── components/
        │   ├── Layout.tsx
        │   ├── Sidebar.tsx           # 좌측 네비 + 전역 상태 표시
        │   ├── PageHeader.tsx
        │   ├── EndpointCard.tsx      # URL 편집 + 상태
        │   ├── StatusDot.tsx         # 글로우 있는 상태 점
        │   ├── VramBar.tsx           # VRAM 바
        │   ├── LogsTable.tsx         # 공통 로그 테이블
        │   └── ServerCard.tsx        # 메인 페이지 좌/중/우 카드
        └── pages/
            ├── MainPage.tsx          # 통합 파이프라인
            ├── SttPage.tsx
            ├── LlmPage.tsx
            └── TtsPage.tsx
```

---

## 사용 흐름

**최초 1회:**
1. `python launcher.py` (백그라운드 상주)
2. `cd frontend && npm install && npm run dev`
3. 브라우저 → `http://localhost:5173`
4. 메인페이지의 각 서비스 카드에서 Mode 토글 → `local`로 두고, "▼" 눌러서 명령어·작업 디렉토리 확인/수정
5. 기본값은 도승2 환경 기준으로 `D:\Git\whisper\...`, `D:\Git\ChatterBox\...` 경로가 들어가 있음. 다르면 수정 후 다음번엔 localStorage에 저장되어 있음.

**매일:**
1. 런처 떠있는지 확인 (사이드바 하단 `● launcher :5000` 초록불)
2. 헤더의 **▶ Start All** 클릭 → STT → LLM → TTS 순차적으로 spawn, 각 서비스 health 통과 대기
3. 사용
4. 끝나면 **■ Stop All**

**개별 서비스만 띄우고 싶다면** — 각 서비스 페이지(`/stt`, `/llm`, `/tts`)의 Control 섹션에서 단독 Start/Stop 가능.

---

## 런처 API 요약

브라우저가 호출하는 경로 (필요시 직접 curl로 테스트 가능):

| Method | Path | 설명 |
|--------|------|------|
| `GET`  | `/health` | 런처 상태 |
| `GET`  | `/services` | 3개 서비스 현재 상태 (pid, uptime, exit_code) |
| `POST` | `/start` | `{service, command, cwd, env}` → spawn |
| `POST` | `/stop` | `{service, timeout?}` → graceful stop |
| `GET`  | `/logs/<service>?tail=N` | subprocess stdout/stderr |
| `DELETE` | `/logs/<service>` | 로그 버퍼 비우기 |

---

## 설치 & 실행

### 0. 런처 (필수, 가장 먼저)

UI에서 Start/Stop 버튼을 쓰려면 런처가 떠있어야 함. 아무 venv 하나 활성화 후:

```bat
pip install flask flask-cors
python launcher.py
:: → http://127.0.0.1:5000
```

> 런처는 subprocess 관리만 하는 가벼운 서버라 어느 Python 환경이든 상관 없음. 미리 한 번 띄워두면 부팅 후 건드릴 일 없음.
>
> **Remote 모드만 쓸 거면 런처는 생략해도 됨** — UI에서 각 서비스를 'remote'로 토글하고 원격 URL만 입력.

### 1. STT 서버 (faster-whisper)

```bash
# (선택) 가상환경
python -m venv venv-stt
venv-stt\Scripts\activate            # Windows
# source venv-stt/bin/activate       # Linux/Mac

pip install -r requirements-stt.txt

python stt_server.py
# → http://127.0.0.1:5001
```

첫 실행 시 모델(`large-v3`)을 다운로드하고 GPU에 올림. 모델 변경은 UI의 STT 페이지에서 가능 (변경 시 재로드).

### 2. TTS 서버 (기존)

기존 `tts_server.py`를 그대로 실행 (포트 5002).

### 3. LLM 서버 (Ollama)

[Ollama](https://ollama.com) 설치 후:

```bash
ollama serve              # 백그라운드 서비스
ollama pull llama3.1
ollama pull gemma2:2b     # gemma 4 e4b 등 원하는 모델
```

기본 엔드포인트는 `http://127.0.0.1:11434`.

### 4. 프론트엔드

```bash
cd frontend
npm install
npm run dev
# → http://localhost:5173
```

---

## 주요 기능

**메인 페이지 (`/`)**
- 좌/중/우 STT · LLM · TTS 카드: 연결 상태, 엔드포인트, 모델 메타, VRAM
- 통합 파이프라인: 마이크 녹음 또는 파일 업로드 → STT → LLM → TTS → 자동재생/다운로드
- 단계별 소요시간 및 중간 결과 표시
- 자동 새로고침 시계 + 시스템 상태 헤더

**STT 페이지 (`/stt`)**
- 마이크 녹음 / 파일 업로드 두 가지 입력
- 모델 크기, 언어, beam size, VAD, compute type 설정
- 결과: 전체 텍스트 + 세그먼트 + RTF
- 서버 측 로그 폴링

**LLM 페이지 (`/llm`)**
- Ollama에 설치된 모델 목록 표시 + 선택
- 시스템 프롬프트 + 유저 프롬프트
- **스트리밍 응답** (실시간 토큰 표시)
- temperature 조정, tokens/sec 통계

**TTS 페이지 (`/tts`)**
- 텍스트 입력 → WAV 출력 (자동재생 + 다운로드)
- 보이스 자동 탐색 + 선택
- exaggeration / cfg_weight / line_threshold / normalize 조정

---

## 디자인 노트

- **컨셉**: lab instrument panel — 거의 검정 베이스(`#08080a`), 모노스페이스로 수치/라벨 표기
- **폰트**: Geist Sans (UI) + JetBrains Mono (데이터/로그)
- **액센트 컬러**: STT cyan `#22d3ee` · LLM violet `#a78bfa` · TTS pink `#f472b6`
- **상태 색상**: live emerald (글로우), dead red, wait amber
- **모션**: 처리 중 단계는 `scanline` 애니메이션, 결과 등장 시 fade-in

---

## 분산 PC 환경 사용법

각 서비스가 다른 PC에서 돌고 있다면 사이드바의 각 카드에서 URL만 변경:

- STT: `http://192.168.1.10:5001`
- LLM: `http://192.168.1.20:11434`
- TTS: `http://192.168.1.30:5002`

설정은 브라우저 localStorage에 저장됨. CORS는 STT/TTS 서버 모두 `0.0.0.0` 바인딩 + `flask-cors` 적용으로 외부 접근 허용.

> **Ollama 외부 접근**: 기본은 `127.0.0.1`만 listen. 다른 PC에서 접근하려면 환경변수 `OLLAMA_HOST=0.0.0.0:11434` 설정 후 `ollama serve` 재시작.

---

## 트러블슈팅

### `RuntimeError: Library cublas64_12.dll is not found or cannot be loaded`

CTranslate2가 CUDA 12 런타임 DLL을 못 찾는 경우. STT venv에서:
```bat
pip install nvidia-cublas-cu12 nvidia-cudnn-cu12
```
`stt_server.py`가 시작 시점에 자동으로 venv의 nvidia DLL 폴더를 PATH에 추가함.

### RTX 50 시리즈 (Blackwell, sm_120)에서 `cuBLAS_STATUS_NOT_SUPPORTED` 또는 `no kernel image`

CTranslate2 4.5.0+ 필요:
```bat
pip install --upgrade "ctranslate2>=4.5.0" faster-whisper
```
PyTorch도 쓴다면 cu128 인덱스로:
```bat
pip install --upgrade torch --index-url https://download.pytorch.org/whl/cu128
```

### Windows 콘솔 한글 깨짐 (`�ε�` 같은 mojibake)

런처가 자식 프로세스에 `PYTHONIOENCODING=utf-8`, `PYTHONUTF8=1`을 자동 주입함. 직접 터미널에서 띄울 때 깨지면:
```bat
set PYTHONIOENCODING=utf-8
set PYTHONUTF8=1
python stt_server.py
```

### Ollama가 다른 PC에서 안 보임

```bat
set OLLAMA_HOST=0.0.0.0:11434
set OLLAMA_ORIGINS=*
ollama serve
```

---

## 다음 단계 (TODO)

- [ ] **OpenAI API 지원** (LLM 페이지에 provider 토글 추가) — Local / OpenAI 전환
- [ ] **VRAM 통합 모니터링** (선택): 서버에 `nvidia-smi` 엔드포인트 추가하면 GPU 전체 사용량 확인 가능
- [ ] **음성 대화 모드**: 마이크 입력 자동 감지 → 파이프라인 자동 트리거 (turn-based)
- [ ] **요청 히스토리 export**: 로그 → CSV/JSON 다운로드
- [ ] **다크/라이트 토글** (현재 다크 전용)
