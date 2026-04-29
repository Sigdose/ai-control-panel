import sys
import torch
import soundfile as sf
import numpy as np
import io
import json
import logging
import time
import os
import re
import glob
from flask import Flask, request, Response, jsonify, send_file
from flask_cors import CORS
from chatterbox.mtl_tts import ChatterboxMultilingualTTS

try:
    from num2words import num2words
    NUM2WORDS_AVAILABLE = True
except ImportError:
    NUM2WORDS_AVAILABLE = False
    logging.warning("[TextNorm] num2words 미설치 → 숫자 변환 비활성. pip install num2words 권장")

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

# Flask access log + polling 노이즈 제거
logging.getLogger("werkzeug").setLevel(logging.ERROR)

app = Flask(__name__)
CORS(app)
request_logs = []

QUIET_PATHS = {"/health", "/settings", "/voices", "/logs"}

# ──────────────────────────────────────────────
# 경로 설정
# ──────────────────────────────────────────────
SCRIPT_DIR    = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR     = os.path.join(SCRIPT_DIR, "cache")
SETTINGS_FILE = os.path.join(SCRIPT_DIR, "settings.json")
os.makedirs(CACHE_DIR, exist_ok=True)

# ──────────────────────────────────────────────
# 기본 설정값
# ──────────────────────────────────────────────
DEFAULT_SETTINGS = {
    "language":        "ko",       # 기본 언어
    "audio_prompt":    "",         # 기본 보이스 파일 경로 (비어있으면 기본 목소리)
    "normalize":       True,       # 숫자 자동 변환
    "line_threshold":  2,          # 줄 수 초과 시 첫 문장 추출 기준
    "exaggeration":    0.5,        # 감정 강도 (0.0 ~ 1.0, 낮을수록 빠름)
    "cfg_weight":      0.5,        # CFG 가중치 (0.0 ~ 1.0, 낮을수록 빠름)
}

def load_settings() -> dict:
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                saved = json.load(f)
            # 기본값에 없는 키 제거, 누락된 키는 기본값으로 채움
            merged = DEFAULT_SETTINGS.copy()
            merged.update({k: v for k, v in saved.items() if k in DEFAULT_SETTINGS})
            log.info(f"[Settings] 로드 완료: {merged}")
            return merged
        except Exception as e:
            log.warning(f"[Settings] 로드 실패, 기본값 사용: {e}")
    return DEFAULT_SETTINGS.copy()

def save_settings(s: dict):
    try:
        with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
            json.dump(s, f, ensure_ascii=False, indent=2)
        log.info(f"[Settings] 저장 완료: {s}")
    except Exception as e:
        log.error(f"[Settings] 저장 실패: {e}")

# 서버 시작 시 설정 로드
settings = load_settings()

# ──────────────────────────────────────────────
# 언어 코드 매핑
# ──────────────────────────────────────────────
LANG_MAP = {
    "ko": "ko", "en": "en", "ja": "ja", "zh": "zh",
    "fr": "fr", "de": "de", "es": "es", "ar": "ar",
    "hi": "hi", "pt": "pt", "ru": "ru", "it": "it",
    "nl": "nl", "pl": "pl", "tr": "tr", "sv": "sv",
}
NUM2WORDS_UNSUPPORTED = {"ja", "zh", "ar", "hi"}
NUM_PAT = r"\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?"

def _num_to_words(numstr: str, lang_code: str) -> str:
    clean = numstr.replace(",", "")
    try:
        n2w_lang = LANG_MAP.get(lang_code, "en")
        if n2w_lang in NUM2WORDS_UNSUPPORTED:
            return " ".join(list(clean))
        if "." in clean:
            return num2words(float(clean), lang=n2w_lang)
        else:
            return num2words(int(clean), lang=n2w_lang)
    except Exception:
        return numstr

_SENT_END = re.compile(r"[.。!！?？]+")

def extract_first_sentence(text: str, line_threshold: int = None) -> tuple:
    threshold = line_threshold if line_threshold is not None else settings["line_threshold"]
    lines = [l for l in text.splitlines() if l.strip()]
    if len(lines) < threshold:
        return text, False
    first_line = lines[0].strip()
    m = _SENT_END.search(first_line)
    if m:
        sentence = first_line[: m.end()].strip()
    else:
        m2 = _SENT_END.search(text)
        sentence = text[: m2.end()].strip() if m2 else first_line
    return sentence, True

def normalize_text(text: str, language: str) -> str:
    if not NUM2WORDS_AVAILABLE:
        return text
    currency_map = {
        r"\$": ("달러"   if language == "ko" else "dollar"),
        r"₩":  "원",
        r"¥":  ("엔"    if language in ("ko", "ja") else "yen"),
        r"€":  ("유로"  if language == "ko" else "euro"),
        r"£":  ("파운드" if language == "ko" else "pound"),
    }
    for sym, word in currency_map.items():
        text = re.sub(
            rf"{sym}({NUM_PAT})",
            lambda m, w=word, lg=language: _num_to_words(m.group(1), lg) + " " + w,
            text
        )
    pct_word = "퍼센트" if language == "ko" else "percent"
    text = re.sub(
        rf"({NUM_PAT})\s*%",
        lambda m, lg=language: _num_to_words(m.group(1), lg) + " " + pct_word,
        text
    )
    text = re.sub(NUM_PAT, lambda m, lg=language: _num_to_words(m.group(0), lg), text)
    return re.sub(r" {2,}", " ", text).strip()

# ──────────────────────────────────────────────
# 보이스 파일 자동 탐색
# ──────────────────────────────────────────────
def discover_audio_files():
    search_dirs = [SCRIPT_DIR, os.path.dirname(SCRIPT_DIR)]
    for sub in ("voices", "audio", "samples", "wav", "mp3", "audios"):
        search_dirs.append(os.path.join(SCRIPT_DIR, sub))
        search_dirs.append(os.path.join(os.path.dirname(SCRIPT_DIR), sub))
    found = {}
    for d in search_dirs:
        if d == CACHE_DIR or not os.path.isdir(d):
            continue
        for ext in ("*.wav", "*.WAV", "*.mp3", "*.MP3"):
            for path in glob.glob(os.path.join(d, ext)):
                path = os.path.normpath(path)
                name = os.path.relpath(path, SCRIPT_DIR)
                found[path] = name
    return sorted([{"name": v, "path": k} for k, v in found.items()],
                  key=lambda x: x["name"].lower())

# ──────────────────────────────────────────────
# VRAM 정보
# ──────────────────────────────────────────────
def get_vram_info():
    if not torch.cuda.is_available():
        return {"total": 0, "used": 0, "reserved": 0, "free": 0}
    total     = torch.cuda.get_device_properties(0).total_memory / 1024**3
    reserved  = torch.cuda.memory_reserved(0)  / 1024**3
    allocated = torch.cuda.memory_allocated(0) / 1024**3
    return {"total": round(total,2), "used": round(allocated,2),
            "reserved": round(reserved,2), "free": round(total-reserved,2)}

# ──────────────────────────────────────────────
# 모델 로드
# ──────────────────────────────────────────────
print("모델 로딩중... (최초 1회만)")
vram_before        = get_vram_info()
load_start         = time.time()
model              = ChatterboxMultilingualTTS.from_pretrained(device="cuda")
load_elapsed       = round(time.time() - load_start, 2)
vram_used_by_model = round(get_vram_info()["used"] - vram_before["used"], 2)
print(f"모델 로드 완료! {load_elapsed}초, VRAM: {vram_used_by_model}GB")
print(f"적용 설정: {settings}")

discovered_voices = discover_audio_files()


@app.before_request
def log_req():
    if request.path in QUIET_PATHS:
        return
    log.info(f"요청: {request.method} {request.path}")
    if request.is_json:
        log.info(f"Body: {request.get_json()}")


# ──────────────────────────────────────────────
# API: 설정 조회 / 저장
# ──────────────────────────────────────────────
@app.route("/settings", methods=["GET"])
def get_settings():
    return jsonify(settings)

@app.route("/settings", methods=["POST"])
def post_settings():
    global settings
    data = request.get_json()
    for k, v in data.items():
        if k in DEFAULT_SETTINGS:
            # 타입 검증
            expected_type = type(DEFAULT_SETTINGS[k])
            try:
                settings[k] = expected_type(v)
            except Exception:
                return jsonify({"error": f"잘못된 값: {k}={v}"}), 400
    save_settings(settings)
    log.info(f"[Settings] 업데이트: {settings}")
    return jsonify({"ok": True, "settings": settings})


@app.route("/voices", methods=["GET"])
def list_voices():
    global discovered_voices
    discovered_voices = discover_audio_files()
    return jsonify({"voices": discovered_voices, "count": len(discovered_voices)})

@app.route("/cache/<filename>", methods=["GET"])
def serve_cache(filename):
    path = os.path.join(CACHE_DIR, filename)
    if not os.path.exists(path): return Response("파일 없음", status=404)
    return send_file(path, mimetype="audio/wav")

@app.route("/logs", methods=["GET"])
def get_logs():
    return jsonify(request_logs)


# ──────────────────────────────────────────────
# / — 가벼운 JSON health (React 패널용)
# ──────────────────────────────────────────────
@app.route("/health", methods=["GET"])
@app.route("/", methods=["GET"])
def health():
    vram = get_vram_info()
    return jsonify({
        "ok":           True,
        "service":      "tts",
        "settings":     settings,
        "vram":         vram,
        "voice_count":  len(discovered_voices),
        "normalize_available": NUM2WORDS_AVAILABLE,
    })


# ──────────────────────────────────────────────
# 메인 대시보드 (자체 HTML — /panel 경로)
# ──────────────────────────────────────────────
@app.route("/panel")
def index():
    vram = get_vram_info()
    norm_status = "✅ 활성" if NUM2WORDS_AVAILABLE else "⚠️ 비활성"
    html = f"""<!DOCTYPE html>
<html>
<head>
    <title>TTS Server Dashboard</title>
    <meta charset="utf-8">
    <style>
        *, *::before, *::after {{ box-sizing: border-box; }}
        body  {{ font-family: monospace; background: #1e1e2e; color: #cdd6f4; padding: 20px; margin:0; }}
        h2    {{ color: #89b4fa; margin-bottom: 16px; }}
        h3    {{ color: #cba6f7; margin-top: 0; }}
        .cards {{ display:flex; flex-wrap:wrap; gap:10px; margin-bottom:20px; }}
        .card  {{ background:#313244; padding:14px 18px; border-radius:8px; min-width:140px; }}
        .card .label {{ color:#a6adc8; font-size:11px; }}
        .card .value {{ color:#a6e3a1; font-size:22px; font-weight:bold; }}
        .card .value.warn {{ color:#fab387; }}
        .panel {{ background:#313244; padding:20px; border-radius:8px; margin-bottom:20px; }}
        .nav {{ display:flex; gap:8px; margin-bottom:20px; }}
        .nav-btn {{ padding:8px 20px; border:none; border-radius:6px; cursor:pointer;
                    font-family:monospace; font-size:14px; background:#45475a; color:#cdd6f4; }}
        .nav-btn.active {{ background:#89b4fa; color:#1e1e2e; font-weight:bold; }}
        .page {{ display:none; }}
        .page.active {{ display:block; }}
        textarea, select, input[type=text], input[type=number] {{
            background:#1e1e2e; color:#cdd6f4; border:1px solid #45475a;
            border-radius:6px; padding:8px 12px; font-family:monospace; font-size:14px;
        }}
        textarea {{ width:100%; height:80px; resize:vertical; padding:10px; }}
        .btn {{ padding:9px 22px; border:none; border-radius:6px;
                font-family:monospace; font-size:14px; cursor:pointer; }}
        .btn-primary   {{ background:#89b4fa; color:#1e1e2e; font-weight:bold; }}
        .btn-secondary {{ background:#45475a; color:#cdd6f4; }}
        .btn-danger    {{ background:#f38ba8; color:#1e1e2e; font-weight:bold; }}
        .btn:disabled  {{ opacity:.45; cursor:not-allowed; }}
        .btn-play {{ background:#a6e3a1; color:#1e1e2e; font-weight:bold;
                     padding:4px 12px; font-size:12px; border-radius:4px; border:none; cursor:pointer; }}
        .tab-bar {{ display:flex; gap:8px; margin:8px 0 12px; }}
        .tab {{ padding:6px 16px; border-radius:6px; cursor:pointer; font-size:13px;
                background:#1e1e2e; color:#a6adc8; border:1px solid #45475a; }}
        .tab.active {{ background:#89b4fa; color:#1e1e2e; font-weight:bold; border-color:#89b4fa; }}
        #voiceDropdownPanel, #voiceCustomPanel {{ display:none; }}
        #status {{ margin-top:12px; color:#a6e3a1; font-size:14px; min-height:20px; }}
        #status.error {{ color:#f38ba8; }}
        #globalPlayer {{ width:100%; margin-top:10px; display:none; }}
        .badge {{ display:inline-block; background:#45475a; border-radius:4px;
                  padding:2px 8px; font-size:11px; color:#cba6f7; margin-left:6px; }}
        .lbl  {{ color:#a6adc8; font-size:12px; display:block; margin-top:12px; margin-bottom:4px; }}
        .norm-preview {{ background:#1e1e2e; border:1px solid #45475a; border-radius:6px;
                         padding:8px 12px; font-size:13px; color:#cba6f7; margin-top:8px;
                         min-height:28px; display:none; }}
        table {{ width:100%; border-collapse:collapse; margin-top:12px; }}
        th {{ background:#45475a; padding:10px; text-align:left; color:#89b4fa; }}
        td {{ padding:8px 10px; border-bottom:1px solid #45475a; font-size:13px; vertical-align:middle; }}
        tr.playing td {{ background:#2a2a3e !important; }}
        tr:hover td   {{ background:#3a3a4e; }}
        .toggle-wrap  {{ display:flex; align-items:center; gap:10px; margin-top:10px; }}
        .toggle {{ position:relative; display:inline-block; width:42px; height:22px; }}
        .toggle input {{ opacity:0; width:0; height:0; }}
        .slider {{ position:absolute; cursor:pointer; inset:0; background:#45475a;
                   border-radius:22px; transition:.3s; }}
        .slider:before {{ position:absolute; content:""; height:16px; width:16px; left:3px; bottom:3px;
                          background:#cdd6f4; border-radius:50%; transition:.3s; }}
        input:checked + .slider {{ background:#89b4fa; }}
        input:checked + .slider:before {{ transform:translateX(20px); }}
        .range-wrap {{ display:flex; align-items:center; gap:12px; margin-top:4px; }}
        .range-wrap input[type=range] {{ flex:1; accent-color:#89b4fa; }}
        .range-val {{ min-width:36px; text-align:center; color:#a6e3a1; font-size:14px; font-weight:bold; }}
        .setting-row {{ display:flex; align-items:center; gap:16px; margin-top:14px; flex-wrap:wrap; }}
        .setting-row .lbl {{ margin-top:0; min-width:120px; }}
        .save-status {{ color:#a6e3a1; font-size:13px; margin-left:12px; }}
        .save-status.error {{ color:#f38ba8; }}
        .divider {{ border:none; border-top:1px solid #45475a; margin:16px 0; }}
    </style>
</head>
<body>
    <h2>🎙️ Chatterbox TTS Server Dashboard</h2>

    <!-- VRAM 카드 -->
    <div class="cards">
        <div class="card"><div class="label">모델 로드 시간</div><div class="value">{load_elapsed}s</div></div>
        <div class="card"><div class="label">모델 VRAM</div><div class="value">{vram_used_by_model}GB</div></div>
        <div class="card"><div class="label">현재 VRAM 사용</div><div class="value">{vram['used']}GB</div></div>
        <div class="card"><div class="label">VRAM 여유</div><div class="value">{vram['free']}GB</div></div>
        <div class="card"><div class="label">VRAM 전체</div><div class="value">{vram['total']}GB</div></div>
        <div class="card"><div class="label">총 요청 수</div><div class="value" id="cardCount">0</div></div>
        <div class="card"><div class="label">숫자 변환</div>
            <div class="value {'warn' if not NUM2WORDS_AVAILABLE else ''}" style="font-size:15px">{norm_status}</div></div>
    </div>

    <!-- 상단 네비게이션 -->
    <div class="nav">
        <button class="nav-btn active" onclick="showPage('tts')">🎤 TTS 테스트</button>
        <button class="nav-btn"        onclick="showPage('settings')">⚙️ 기본 설정</button>
        <button class="nav-btn"        onclick="showPage('logs')">📋 요청 로그</button>
    </div>

    <!-- ══════════════════════════════════════════
         페이지 1: TTS 테스트
    ══════════════════════════════════════════ -->
    <div id="page-tts" class="page active">
        <div class="panel">
            <h3>🎤 TTS 테스트</h3>
            <span class="lbl">텍스트</span>
            <textarea id="ttsText" placeholder="말할 내용을 입력하세요... (Ctrl+Enter로 바로 생성)"></textarea>

            <div class="toggle-wrap">
                <label class="toggle">
                    <input type="checkbox" id="normToggle" onchange="previewNorm()">
                    <span class="slider"></span>
                </label>
                <span style="font-size:13px;color:#a6adc8">📐 숫자 자동 변환</span>
                <span id="normBadge" class="badge">켜짐</span>
            </div>
            <div class="norm-preview" id="normPreview"></div>

            <span class="lbl">언어</span>
            <select id="ttsLang" onchange="previewNorm()">
                <option value="ko">🇰🇷 한국어 (ko)</option>
                <option value="en">🇺🇸 영어 (en)</option>
                <option value="ja">🇯🇵 일본어 (ja)</option>
                <option value="zh">🇨🇳 중국어 (zh)</option>
                <option value="fr">🇫🇷 프랑스어 (fr)</option>
                <option value="de">🇩🇪 독일어 (de)</option>
                <option value="es">🇪🇸 스페인어 (es)</option>
                <option value="ar">🇸🇦 아랍어 (ar)</option>
                <option value="hi">🇮🇳 힌디어 (hi)</option>
                <option value="pt">🇧🇷 포르투갈어 (pt)</option>
                <option value="ru">🇷🇺 러시아어 (ru)</option>
                <option value="it">🇮🇹 이탈리아어 (it)</option>
            </select>

            <span class="lbl">🎵 보이스 선택</span>
            <div class="tab-bar">
                <div class="tab active" id="tabDiscover" onclick="switchTab('discover')">🔍 자동 탐색</div>
                <div class="tab"        id="tabCustom"   onclick="switchTab('custom')">✏️ 직접 입력</div>
                <div class="tab"        id="tabDefault"  onclick="switchTab('default')">🔇 기본 목소리</div>
            </div>
            <div id="voiceDropdownPanel">
                <select id="voiceSelect"><option value="">-- 로딩 중... --</option></select>
                <button class="btn btn-secondary" style="margin-left:8px" onclick="refreshVoices()">🔄 재탐색</button>
                <span id="voiceCount" class="badge">0개</span>
            </div>
            <div id="voiceCustomPanel">
                <input type="text" id="customVoicePath" style="width:400px"
                       placeholder="예: D:/voices/my_voice.wav">
            </div>

            <hr class="divider">

            <!-- 생성 파라미터 (기본값은 설정에서 로드) -->
            <h3 style="margin-bottom:4px">🎛️ 생성 파라미터 <span style="font-size:12px;color:#a6adc8">(이 요청에만 적용, 기본값은 ⚙️설정에서 변경)</span></h3>

            <span class="lbl">Exaggeration <span style="color:#585b70">(낮을수록 빠름, 높을수록 감정 풍부)</span></span>
            <div class="range-wrap">
                <input type="range" id="exaggeration" min="0" max="1" step="0.05"
                       oninput="document.getElementById('exaggerationVal').textContent=parseFloat(this.value).toFixed(2)">
                <span class="range-val" id="exaggerationVal">0.50</span>
            </div>

            <span class="lbl">CFG Weight <span style="color:#585b70">(낮을수록 빠름, 높을수록 목소리 일관성)</span></span>
            <div class="range-wrap">
                <input type="range" id="cfgWeight" min="0" max="1" step="0.05"
                       oninput="document.getElementById('cfgWeightVal').textContent=parseFloat(this.value).toFixed(2)">
                <span class="range-val" id="cfgWeightVal">0.50</span>
            </div>

            <div style="margin-top:16px">
                <button class="btn btn-primary" id="generateBtn" onclick="generateTTS()">▶ 생성 및 재생</button>
                <button class="btn btn-secondary" style="margin-left:8px" onclick="stopGlobal()">■ 정지</button>
            </div>
            <div id="status"></div>
            <audio id="globalPlayer" controls></audio>
        </div>
    </div>

    <!-- ══════════════════════════════════════════
         페이지 2: 기본 설정
    ══════════════════════════════════════════ -->
    <div id="page-settings" class="page">
        <div class="panel">
            <h3>⚙️ 기본 설정 <span style="font-size:12px;color:#a6adc8">(저장하면 서버 재시작 후에도 유지)</span></h3>

            <!-- 언어 -->
            <span class="lbl">기본 언어</span>
            <select id="s_language">
                <option value="ko">🇰🇷 한국어 (ko)</option>
                <option value="en">🇺🇸 영어 (en)</option>
                <option value="ja">🇯🇵 일본어 (ja)</option>
                <option value="zh">🇨🇳 중국어 (zh)</option>
                <option value="fr">🇫🇷 프랑스어 (fr)</option>
                <option value="de">🇩🇪 독일어 (de)</option>
                <option value="es">🇪🇸 스페인어 (es)</option>
                <option value="ar">🇸🇦 아랍어 (ar)</option>
                <option value="hi">🇮🇳 힌디어 (hi)</option>
                <option value="pt">🇧🇷 포르투갈어 (pt)</option>
                <option value="ru">🇷🇺 러시아어 (ru)</option>
                <option value="it">🇮🇹 이탈리아어 (it)</option>
            </select>

            <!-- 보이스 -->
            <span class="lbl">기본 보이스 파일 경로 <span style="color:#585b70">(비어있으면 기본 목소리)</span></span>
            <input type="text" id="s_audio_prompt" style="width:460px"
                   placeholder="예: D:/voices/my_voice.wav  또는 비워두기">

            <!-- 숫자 변환 -->
            <div class="toggle-wrap" style="margin-top:14px">
                <label class="toggle">
                    <input type="checkbox" id="s_normalize">
                    <span class="slider"></span>
                </label>
                <span style="font-size:13px;color:#a6adc8">📐 기본 숫자 자동 변환</span>
            </div>

            <!-- 줄 수 임계값 -->
            <span class="lbl">첫 문장 추출 기준 줄 수 <span style="color:#585b70">(이 줄 수 이상이면 첫 문장만 TTS 처리)</span></span>
            <div class="range-wrap">
                <input type="range" id="s_line_threshold" min="1" max="10" step="1"
                       oninput="document.getElementById('s_line_thresholdVal').textContent=this.value">
                <span class="range-val" id="s_line_thresholdVal">2</span>
            </div>

            <hr class="divider">

            <!-- Exaggeration -->
            <span class="lbl">기본 Exaggeration <span style="color:#585b70">(0.0~1.0, 낮을수록 빠름)</span></span>
            <div class="range-wrap">
                <input type="range" id="s_exaggeration" min="0" max="1" step="0.05"
                       oninput="document.getElementById('s_exaggerationVal').textContent=parseFloat(this.value).toFixed(2)">
                <span class="range-val" id="s_exaggerationVal">0.50</span>
            </div>

            <!-- CFG Weight -->
            <span class="lbl">기본 CFG Weight <span style="color:#585b70">(0.0~1.0, 낮을수록 빠름)</span></span>
            <div class="range-wrap">
                <input type="range" id="s_cfg_weight" min="0" max="1" step="0.05"
                       oninput="document.getElementById('s_cfg_weightVal').textContent=parseFloat(this.value).toFixed(2)">
                <span class="range-val" id="s_cfg_weightVal">0.50</span>
            </div>

            <hr class="divider">

            <div style="margin-top:4px">
                <button class="btn btn-primary" onclick="saveSettings()">💾 설정 저장</button>
                <button class="btn btn-secondary" style="margin-left:8px" onclick="resetSettings()">↩️ 기본값으로 초기화</button>
                <span id="saveStatus" class="save-status"></span>
            </div>

            <!-- 현재 적용 중인 설정 표시 -->
            <hr class="divider">
            <h3>📌 현재 서버 적용 중인 설정</h3>
            <pre id="currentSettingsDisplay" style="background:#1e1e2e;padding:12px;border-radius:6px;color:#a6e3a1;font-size:13px"></pre>
        </div>
    </div>

    <!-- ══════════════════════════════════════════
         페이지 3: 요청 로그
    ══════════════════════════════════════════ -->
    <div id="page-logs" class="page">
        <div class="panel">
            <h3>📋 요청 로그</h3>
            <button class="btn btn-secondary" onclick="loadLogs()">🔄 새로고침</button>
            <table>
                <thead>
                    <tr>
                        <th>#</th><th>시간</th><th>원본 텍스트</th><th>→ 변환 후</th>
                        <th>언어</th><th>목소리</th><th>Exag</th><th>CFG</th>
                        <th>생성시간</th><th>VRAM</th><th>상태</th><th>다시듣기</th>
                    </tr>
                </thead>
                <tbody id="logBody">
                    <tr><td colspan="12" style="text-align:center;color:#a6adc8">로딩 중...</td></tr>
                </tbody>
            </table>
        </div>
    </div>

    <script>
    const player   = document.getElementById('globalPlayer');
    const statusEl = document.getElementById('status');
    let   activeRow = null;

    // ── 페이지 전환 ───────────────────────────────
    function showPage(name) {{
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('page-' + name).classList.add('active');
        event.target.classList.add('active');
        if (name === 'logs')     loadLogs();
        if (name === 'settings') loadSettingsUI();
    }}

    // ── 오디오 재생 ───────────────────────────────
    player.addEventListener('ended', () => {{ statusEl.textContent='✅ 재생 완료'; clearActive(); }});
    function clearActive() {{
        if (activeRow) {{ activeRow.classList.remove('playing'); activeRow=null; }}
    }}
    function playAudio(url, rowEl) {{
        clearActive();
        player.src=url; player.style.display='block'; player.play();
        if (rowEl) {{ rowEl.classList.add('playing'); activeRow=rowEl; }}
    }}
    function stopGlobal() {{
        player.pause(); player.currentTime=0; player.style.display='none';
        statusEl.textContent='■ 정지됨'; clearActive();
    }}

    // ── 탭 ──────────────────────────────────────
    let currentTab='discover';
    function switchTab(tab) {{
        currentTab=tab;
        ['discover','custom','default'].forEach(t => {{
            document.getElementById('tab'+t.charAt(0).toUpperCase()+t.slice(1))
                .className='tab'+(t===tab?' active':'');
        }});
        document.getElementById('voiceDropdownPanel').style.display=tab==='discover'?'block':'none';
        document.getElementById('voiceCustomPanel').style.display  =tab==='custom'  ?'block':'none';
    }}

    // ── 숫자 정규화 미리보기 ──────────────────────
    let normTimer=null;
    async function previewNorm() {{
        const on    = document.getElementById('normToggle').checked;
        const badge = document.getElementById('normBadge');
        badge.textContent = on ? '켜짐' : '꺼짐';
        badge.style.color = on ? '#a6e3a1' : '#f38ba8';
        const preview = document.getElementById('normPreview');
        const text    = document.getElementById('ttsText').value.trim();
        if (!on || !text) {{ preview.style.display='none'; return; }}
        clearTimeout(normTimer);
        normTimer = setTimeout(async () => {{
            try {{
                const lang = document.getElementById('ttsLang').value;
                const res  = await fetch('/normalize', {{
                    method:'POST', headers:{{'Content-Type':'application/json'}},
                    body: JSON.stringify({{text, language:lang}})
                }});
                const d = await res.json();
                const parts = [];
                if (d.was_truncated) parts.push('✂️ 첫문장: ' + d.truncated);
                if (d.normalized !== (d.truncated || text)) parts.push('📐 숫자변환: ' + d.normalized);
                if (parts.length) {{ preview.innerHTML=parts.join('<br>'); preview.style.display='block'; }}
                else preview.style.display='none';
            }} catch(e) {{ preview.style.display='none'; }}
        }}, 400);
    }}
    document.getElementById('ttsText').addEventListener('input', previewNorm);

    // ── 보이스 탐색 ──────────────────────────────
    async function refreshVoices() {{
        const sel=document.getElementById('voiceSelect');
        const badge=document.getElementById('voiceCount');
        sel.innerHTML='<option value="">-- 탐색 중... --</option>';
        try {{
            const data=await (await fetch('/voices')).json();
            sel.innerHTML='<option value="">-- 기본 목소리 사용 --</option>';
            data.voices.forEach(v=>{{
                const o=document.createElement('option');
                o.value=v.path; o.textContent=v.name; sel.appendChild(o);
            }});
            badge.textContent=data.count+'개';
            badge.style.color=data.count>0?'#a6e3a1':'#f38ba8';
        }} catch(e) {{ sel.innerHTML='<option value="">❌ 탐색 실패</option>'; }}
    }}
    function getVoicePath() {{
        if(currentTab==='default') return '';
        if(currentTab==='custom')  return document.getElementById('customVoicePath').value.trim();
        return document.getElementById('voiceSelect').value;
    }}

    // ── TTS 생성 ─────────────────────────────────
    async function generateTTS() {{
        const text  = document.getElementById('ttsText').value.trim();
        const lang  = document.getElementById('ttsLang').value;
        const voice = getVoicePath();
        const norm  = document.getElementById('normToggle').checked;
        const exag  = parseFloat(document.getElementById('exaggeration').value);
        const cfg   = parseFloat(document.getElementById('cfgWeight').value);
        const btn   = document.getElementById('generateBtn');
        if (!text) {{ statusEl.className='error'; statusEl.textContent='❌ 텍스트를 입력하세요.'; return; }}
        btn.disabled=true;
        statusEl.className='';
        statusEl.textContent='⏳ 생성 중...';
        player.pause();
        try {{
            const body={{text, language:lang, normalize:norm, exaggeration:exag, cfg_weight:cfg}};
            if(voice) body.audio_prompt=voice;
            const res=await fetch('/tts',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify(body)}});
            if(!res.ok) throw new Error(await res.text());
            playAudio(URL.createObjectURL(await res.blob()), null);
            statusEl.textContent=`✅ 재생 중! (Exag:${{exag.toFixed(2)}} CFG:${{cfg.toFixed(2)}})`;
            await loadLogs();
        }} catch(e) {{
            statusEl.className='error'; statusEl.textContent='❌ 오류: '+e.message;
        }} finally {{ btn.disabled=false; }}
    }}

    // ── 로그 갱신 ─────────────────────────────────
    async function loadLogs() {{
        try {{
            const logs=await (await fetch('/logs')).json();
            document.getElementById('cardCount').textContent=logs.length;
            const tbody=document.getElementById('logBody');
            if(!logs.length){{
                tbody.innerHTML='<tr><td colspan="12" style="text-align:center;color:#a6adc8">요청 없음</td></tr>';
                return;
            }}
            tbody.innerHTML='';
            [...logs].reverse().forEach((e,i)=>{{
                const tr=document.createElement('tr');
                const short=t=>(t||'').length>25?(t.slice(0,25)+'…'):(t||'');
                const replay=e.cache_file
                    ?`<button class="btn-play" onclick="replayCache('${{e.cache_file}}',this)">▶</button>`
                    :`<span style="color:#585b70;font-size:12px">없음</span>`;
                const normCell = e.normalized_text && e.normalized_text !== e.text
                    ? `<td title="${{e.normalized_text}}" style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#cba6f7">${{short(e.normalized_text)}}</td>`
                    : `<td style="color:#585b70;font-size:12px">없음</td>`;
                tr.innerHTML=`
                    <td>${{logs.length-i}}</td>
                    <td>${{e.time||''}}</td>
                    <td title="${{e.text||''}}" style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${{short(e.text)}}</td>
                    ${{normCell}}
                    <td>${{e.language||''}}</td>
                    <td>${{e.voice||'기본'}}</td>
                    <td>${{(e.exaggeration||0).toFixed(2)}}</td>
                    <td>${{(e.cfg_weight||0).toFixed(2)}}</td>
                    <td>${{e.elapsed||0}}s</td>
                    <td>${{e.vram_total||0}}GB</td>
                    <td>${{e.status||''}}</td>
                    <td>${{replay}}</td>`;
                tbody.appendChild(tr);
            }});
        }} catch(err){{ console.error(err); }}
    }}

    function replayCache(filename, btnEl) {{
        const rowEl=btnEl?btnEl.closest('tr'):null;
        playAudio('/cache/'+encodeURIComponent(filename), rowEl);
        statusEl.className=''; statusEl.textContent='🔁 캐시 재생: '+filename;
    }}

    // ── 설정 UI ──────────────────────────────────
    async function loadSettingsUI() {{
        try {{
            const s = await (await fetch('/settings')).json();
            document.getElementById('s_language').value      = s.language || 'ko';
            document.getElementById('s_audio_prompt').value  = s.audio_prompt || '';
            document.getElementById('s_normalize').checked   = s.normalize !== false;
            document.getElementById('s_line_threshold').value = s.line_threshold || 2;
            document.getElementById('s_line_thresholdVal').textContent = s.line_threshold || 2;
            document.getElementById('s_exaggeration').value  = s.exaggeration || 0.5;
            document.getElementById('s_exaggerationVal').textContent = (s.exaggeration||0.5).toFixed(2);
            document.getElementById('s_cfg_weight').value    = s.cfg_weight || 0.5;
            document.getElementById('s_cfg_weightVal').textContent = (s.cfg_weight||0.5).toFixed(2);
            document.getElementById('currentSettingsDisplay').textContent = JSON.stringify(s, null, 2);
        }} catch(e) {{ console.error(e); }}
    }}

    async function saveSettings() {{
        const s = {{
            language:       document.getElementById('s_language').value,
            audio_prompt:   document.getElementById('s_audio_prompt').value.trim(),
            normalize:      document.getElementById('s_normalize').checked,
            line_threshold: parseInt(document.getElementById('s_line_threshold').value),
            exaggeration:   parseFloat(document.getElementById('s_exaggeration').value),
            cfg_weight:     parseFloat(document.getElementById('s_cfg_weight').value),
        }};
        const st = document.getElementById('saveStatus');
        try {{
            const res = await fetch('/settings', {{
                method:'POST', headers:{{'Content-Type':'application/json'}},
                body: JSON.stringify(s)
            }});
            const d = await res.json();
            if (d.ok) {{
                st.className='save-status'; st.textContent='✅ 저장 완료!';
                document.getElementById('currentSettingsDisplay').textContent = JSON.stringify(d.settings, null, 2);
                // TTS 테스트 패널에도 기본값 반영
                applySettingsToTestPanel(d.settings);
            }} else {{
                st.className='save-status error'; st.textContent='❌ '+d.error;
            }}
        }} catch(e) {{
            st.className='save-status error'; st.textContent='❌ '+e.message;
        }}
        setTimeout(()=>{{ st.textContent=''; }}, 3000);
    }}

    async function resetSettings() {{
        if (!confirm('기본값으로 초기화하시겠습니까?')) return;
        await fetch('/settings', {{
            method:'POST', headers:{{'Content-Type':'application/json'}},
            body: JSON.stringify({{
                language:'ko', audio_prompt:'', normalize:true,
                line_threshold:2, exaggeration:0.5, cfg_weight:0.5
            }})
        }});
        loadSettingsUI();
    }}

    function applySettingsToTestPanel(s) {{
        // TTS 테스트 패널 기본값 동기화
        document.getElementById('ttsLang').value = s.language || 'ko';
        document.getElementById('normToggle').checked = s.normalize !== false;
        document.getElementById('exaggeration').value = s.exaggeration || 0.5;
        document.getElementById('exaggerationVal').textContent = (s.exaggeration||0.5).toFixed(2);
        document.getElementById('cfgWeight').value = s.cfg_weight || 0.5;
        document.getElementById('cfgWeightVal').textContent = (s.cfg_weight||0.5).toFixed(2);
    }}

    // ── 초기 로드 ─────────────────────────────────
    window.addEventListener('load', async () => {{
        refreshVoices();
        switchTab('discover');
        loadLogs();
        // 설정값을 TTS 테스트 패널 기본값에 반영
        try {{
            const s = await (await fetch('/settings')).json();
            applySettingsToTestPanel(s);
        }} catch(e) {{}}
    }});
    document.addEventListener('keydown', e=>{{ if(e.ctrlKey&&e.key==='Enter') generateTTS(); }});
    </script>
</body>
</html>"""
    return html


# ──────────────────────────────────────────────
# API: 텍스트 정규화 미리보기
# ──────────────────────────────────────────────
@app.route("/normalize", methods=["POST"])
def preview_normalize():
    data     = request.get_json()
    text     = data.get("text", "")
    language = data.get("language", settings["language"])
    truncated, was_truncated = extract_first_sentence(text)
    normalized = normalize_text(truncated, language)
    return jsonify({
        "original":      text,
        "truncated":     truncated,
        "was_truncated": was_truncated,
        "normalized":    normalized,
    })


# ──────────────────────────────────────────────
# TTS 생성
# ──────────────────────────────────────────────
@app.route("/tts", methods=["POST"])
def tts():
    data         = request.get_json()
    text         = data.get("text", "")

    # 요청값 우선, 없으면 서버 기본 설정값 사용
    language     = data.get("language",     settings["language"])
    audio_prompt = data.get("audio_prompt", settings["audio_prompt"] or None)
    do_normalize = data.get("normalize",    settings["normalize"])
    exaggeration = float(data.get("exaggeration", settings["exaggeration"]))
    cfg_weight   = float(data.get("cfg_weight",   settings["cfg_weight"]))

    if not text:
        return Response("text is empty", status=400)

    if audio_prompt and not os.path.exists(audio_prompt):
        log.warning(f"[TTS] 음성파일 없음: {audio_prompt}, 기본 목소리 사용")
        audio_prompt = None

    # ① 첫 문장 추출
    final_text, was_truncated = extract_first_sentence(text)
    if was_truncated:
        log.info(f"[Truncate] {len(text.splitlines())}줄 → 첫 문장: '{final_text}'")

    # ② 숫자 정규화
    normalized_text = normalize_text(final_text, language) if do_normalize else final_text
    if normalized_text != final_text:
        log.info(f"[TextNorm] '{final_text}' → '{normalized_text}'")

    start = time.time()
    try:
        generate_kwargs = {
            "language_id":  language,
            "exaggeration": exaggeration,
            "cfg_weight":   cfg_weight,
        }
        if audio_prompt:
            generate_kwargs["audio_prompt_path"] = audio_prompt

        log.info(f"[TTS] 생성 시작 | exag:{exaggeration} cfg:{cfg_weight} lang:{language}")

        wav        = model.generate(normalized_text, **generate_kwargs)
        audio      = wav.squeeze().cpu().numpy()
        elapsed    = round(time.time() - start, 2)
        vram_after = get_vram_info()
        voice_name = os.path.basename(audio_prompt) if audio_prompt else "기본"

        ts         = time.strftime("%Y%m%d_%H%M%S")
        safe_text  = "".join(c for c in text[:20]
                             if c.isalnum() or c in " _-").strip().replace(" ","_")
        cache_name = f"{ts}_{safe_text or 'tts'}.wav"
        cache_path = os.path.join(CACHE_DIR, cache_name)
        sf.write(cache_path, audio, model.sr, format="WAV")

        status_str = "✅ 성공" + (" ✂️ 첫문장" if was_truncated else "")
        request_logs.append({
            "time":            time.strftime("%H:%M:%S"),
            "text":            text,
            "final_text":      final_text,
            "normalized_text": normalized_text,
            "was_truncated":   was_truncated,
            "language":        language,
            "voice":           voice_name,
            "exaggeration":    exaggeration,
            "cfg_weight":      cfg_weight,
            "elapsed":         elapsed,
            "vram_total":      vram_after["used"],
            "status":          status_str,
            "cache_file":      cache_name,
        })

        log.info(f"[TTS] 완료: {elapsed}s | 언어:{language} | 목소리:{voice_name} | exag:{exaggeration} cfg:{cfg_weight}")

        buf = io.BytesIO()
        sf.write(buf, audio, model.sr, format="WAV")
        buf.seek(0)
        return Response(buf.read(), mimetype="audio/wav")

    except Exception as e:
        elapsed = round(time.time() - start, 2)
        request_logs.append({
            "time": time.strftime("%H:%M:%S"), "text": text,
            "final_text": final_text, "normalized_text": normalized_text,
            "was_truncated": was_truncated, "language": language,
            "voice": "오류", "exaggeration": exaggeration, "cfg_weight": cfg_weight,
            "elapsed": elapsed, "vram_total": 0,
            "status": f"❌ {str(e)[:40]}", "cache_file": None,
        })
        log.error(f"[TTS] 오류: {e}")
        return Response(str(e), status=500)


if __name__ == "__main__":
    print("=" * 60)
    print("  TTS Server — Chatterbox Multilingual")
    print("  Endpoint : http://0.0.0.0:5002")
    print("  Dashboard: http://127.0.0.1:5002/panel")
    print("=" * 60)
    app.run(host="0.0.0.0", port=5002, debug=False, threaded=True)