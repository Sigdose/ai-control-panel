"""
STT Server (faster-whisper)

기능:
  - Windows에서 nvidia-* DLL을 자동으로 명시적 LoadLibrary
    (RTX 50 시리즈 sm_120 cuBLAS 로드 문제 해결)
  - werkzeug access log 비활성 + polling 노이즈 제거
  - VRAM 측정은 pynvml (nvidia-smi 동등)

엔드포인트:
  GET  /health           서버 상태 + VRAM
  POST /transcribe       audio → text (multipart/form-data)
  GET  /settings, POST   설정 조회/저장 (변경 시 모델 재로드)
  GET  /logs             요청 로그
  GET  /models           모델 목록
"""

import os
import sys
import json
import time
import logging
import tempfile

# ──────────────────────────────────────────────
# Windows: nvidia-* pip 패키지의 DLL을 명시적으로 LoadLibrary
# os.add_dll_directory만으로는 부족한 경우가 있어서 ctypes.WinDLL로 한 번 로드해둠
# ──────────────────────────────────────────────
def _setup_nvidia_dll_paths():
    if sys.platform != 'win32':
        return
    try:
        import nvidia
    except ImportError:
        print('[stt] nvidia 패키지 없음 — pip install nvidia-cublas-cu12 nvidia-cudnn-cu12 권장')
        return

    import ctypes

    bin_dirs = []
    for nvidia_root in list(nvidia.__path__):
        if not os.path.isdir(nvidia_root):
            continue
        for sub in sorted(os.listdir(nvidia_root)):
            bin_path = os.path.join(nvidia_root, sub, 'bin')
            if not os.path.isdir(bin_path):
                continue
            dlls = [f for f in os.listdir(bin_path) if f.lower().endswith('.dll')]
            if not dlls:
                continue
            try:
                os.add_dll_directory(bin_path)
                os.environ['PATH'] = bin_path + os.pathsep + os.environ.get('PATH', '')
                bin_dirs.append((sub, bin_path, dlls))
            except Exception as e:
                print(f'[stt] add_dll_directory 실패 ({bin_path}): {e}')

    if not bin_dirs:
        print('[stt] ⚠ nvidia bin 폴더에서 DLL을 찾지 못함')
        return

    # 두 번 시도해서 의존성 순서 문제 해결
    pending = [(sub, os.path.join(p, f)) for sub, p, dlls in bin_dirs for f in dlls]
    for _ in range(2):
        still_pending = []
        for sub, dll_path in pending:
            try:
                ctypes.WinDLL(dll_path)
            except OSError:
                still_pending.append((sub, dll_path))
        pending = still_pending
        if not pending:
            break

    print('[stt] NVIDIA DLL 미리 로드:')
    for sub, path, dlls in bin_dirs:
        print(f'      ✓ {sub}: {len(dlls)}개')
    if pending:
        print(f'      ⚠ {len(pending)}개 실패')


_setup_nvidia_dll_paths()

from flask import Flask, request, jsonify
from flask_cors import CORS

try:
    from faster_whisper import WhisperModel
    FW_AVAILABLE = True
except ImportError:
    FW_AVAILABLE = False
    print('[FATAL] faster-whisper 미설치')

try:
    import pynvml
    pynvml.nvmlInit()
    NVML_AVAILABLE = True
except Exception:
    NVML_AVAILABLE = False

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
log = logging.getLogger(__name__)
logging.getLogger('werkzeug').setLevel(logging.ERROR)

app = Flask(__name__)
CORS(app)

request_logs = []

SCRIPT_DIR    = os.path.dirname(os.path.abspath(__file__))
SETTINGS_FILE = os.path.join(SCRIPT_DIR, 'stt_settings.json')

AVAILABLE_MODELS = ['tiny', 'base', 'small', 'medium', 'large-v2', 'large-v3']
AVAILABLE_LANGS  = ['auto', 'ko', 'en', 'ja', 'zh', 'fr', 'de', 'es', 'ru', 'it']
COMPUTE_TYPES    = ['float16', 'int8_float16', 'int8']

DEFAULT_SETTINGS = {
    'model_size':   'large-v3',
    'language':     'ko',
    'beam_size':    5,
    'vad_filter':   True,
    'compute_type': 'float16',
    'device':       'cuda',
}

QUIET_PATHS = {'/health', '/logs', '/settings'}


def load_settings() -> dict:
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, 'r', encoding='utf-8') as f:
                saved = json.load(f)
            merged = DEFAULT_SETTINGS.copy()
            merged.update({k: v for k, v in saved.items() if k in DEFAULT_SETTINGS})
            log.info(f'[Settings] 로드: {merged}')
            return merged
        except Exception as e:
            log.warning(f'[Settings] 로드 실패, 기본값: {e}')
    return DEFAULT_SETTINGS.copy()


def save_settings(s: dict):
    try:
        with open(SETTINGS_FILE, 'w', encoding='utf-8') as f:
            json.dump(s, f, ensure_ascii=False, indent=2)
        log.info(f'[Settings] 저장: {s}')
    except Exception as e:
        log.error(f'[Settings] 저장 실패: {e}')


settings = load_settings()


def get_vram_info():
    if not NVML_AVAILABLE:
        return {'total': 0, 'used': 0, 'free': 0, 'device': 'unknown'}
    try:
        h = pynvml.nvmlDeviceGetHandleByIndex(0)
        mem = pynvml.nvmlDeviceGetMemoryInfo(h)
        name = pynvml.nvmlDeviceGetName(h)
        if isinstance(name, bytes):
            name = name.decode('utf-8', errors='replace')
        return {
            'total':  round(mem.total / 1024**3, 2),
            'used':   round(mem.used  / 1024**3, 2),
            'free':   round(mem.free  / 1024**3, 2),
            'device': name,
        }
    except Exception as e:
        return {'total': 0, 'used': 0, 'free': 0, 'device': f'nvml error: {e}'}


model = None
model_meta = {'size': None, 'compute_type': None, 'device': None, 'load_time': 0}


def load_model():
    global model, model_meta
    if not FW_AVAILABLE:
        raise RuntimeError('faster-whisper 미설치')

    log.info(f'[Model] 로딩 시작: {settings["model_size"]} ({settings["compute_type"]}, {settings["device"]})')
    vram_before = get_vram_info()
    t0 = time.time()
    model = WhisperModel(
        settings['model_size'],
        device=settings['device'],
        compute_type=settings['compute_type'],
    )
    elapsed = round(time.time() - t0, 2)
    vram_after = get_vram_info()
    delta = round(vram_after['used'] - vram_before['used'], 2)
    model_meta = {
        'size':         settings['model_size'],
        'compute_type': settings['compute_type'],
        'device':       settings['device'],
        'load_time':    elapsed,
        'vram_used':    delta,
    }
    log.info(f'[Model] 로드 완료: {elapsed}s, VRAM Δ +{delta}GB (전체 {vram_after["used"]}GB / {vram_after["total"]}GB)')


print('=' * 60)
print('  STT Server — faster-whisper')
print(f'  Settings: {settings}')
print('  Endpoint: http://0.0.0.0:5001')
print('=' * 60)
load_model()


@app.before_request
def _log_req():
    if request.path not in QUIET_PATHS:
        log.info(f'요청: {request.method} {request.path}')


@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        'ok':       True,
        'service':  'stt',
        'model':    model_meta,
        'vram':     get_vram_info(),
        'settings': settings,
    })


@app.route('/settings', methods=['GET'])
def get_settings():
    return jsonify({
        'settings':         settings,
        'available_models': AVAILABLE_MODELS,
        'available_langs':  AVAILABLE_LANGS,
        'compute_types':    COMPUTE_TYPES,
    })


@app.route('/settings', methods=['POST'])
def set_settings():
    global settings
    data = request.get_json() or {}
    new_settings = settings.copy()
    needs_reload = False

    for key in DEFAULT_SETTINGS.keys():
        if key in data:
            old_val = new_settings.get(key)
            new_val = data[key]
            new_settings[key] = new_val
            if key in ('model_size', 'compute_type', 'device') and old_val != new_val:
                needs_reload = True

    settings = new_settings
    save_settings(settings)

    if needs_reload:
        try:
            load_model()
        except Exception as e:
            return jsonify({'ok': False, 'error': str(e)}), 500

    return jsonify({'ok': True, 'settings': settings, 'reloaded': needs_reload})


@app.route('/models', methods=['GET'])
def list_models():
    return jsonify({
        'available': AVAILABLE_MODELS,
        'current':   settings['model_size'],
        'loaded':    model_meta,
    })


@app.route('/transcribe', methods=['POST'])
def transcribe():
    if 'file' not in request.files:
        return jsonify({'ok': False, 'error': 'file 필드 없음'}), 400

    f = request.files['file']
    if not f or f.filename == '':
        return jsonify({'ok': False, 'error': '빈 파일'}), 400

    language   = request.form.get('language',   settings['language'])
    beam_size  = int(request.form.get('beam_size', settings['beam_size']))
    vad_filter = request.form.get('vad_filter', str(settings['vad_filter'])).lower() in ('1', 'true', 'yes')

    suffix = os.path.splitext(f.filename)[1] or '.wav'
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp_path = tmp.name
        f.save(tmp_path)

    file_size_kb = round(os.path.getsize(tmp_path) / 1024, 1)
    start = time.time()

    try:
        kwargs = {'beam_size': beam_size, 'vad_filter': vad_filter}
        if language and language != 'auto':
            kwargs['language'] = language

        segments, info = model.transcribe(tmp_path, **kwargs)
        seg_list = []
        full_text_parts = []
        for seg in segments:
            seg_list.append({'start': round(seg.start, 2), 'end': round(seg.end, 2), 'text': seg.text})
            full_text_parts.append(seg.text)

        full_text = ''.join(full_text_parts).strip()
        elapsed = round(time.time() - start, 2)
        audio_duration = round(info.duration, 2)
        rtf = round(elapsed / audio_duration, 3) if audio_duration > 0 else 0

        request_logs.append({
            'time':           time.strftime('%H:%M:%S'),
            'filename':       f.filename,
            'file_size_kb':   file_size_kb,
            'audio_duration': audio_duration,
            'elapsed':        elapsed,
            'rtf':            rtf,
            'language':       info.language,
            'lang_prob':      round(info.language_probability, 2),
            'text':           full_text,
            'status':         '✅ 성공',
        })
        if len(request_logs) > 50:
            request_logs.pop(0)

        log.info(f'[Transcribe] {elapsed}s | {audio_duration}s audio | RTF={rtf} | lang={info.language}')

        return jsonify({
            'ok':             True,
            'text':           full_text,
            'segments':       seg_list,
            'language':       info.language,
            'lang_prob':      round(info.language_probability, 2),
            'audio_duration': audio_duration,
            'elapsed':        elapsed,
            'rtf':            rtf,
            'vram':           get_vram_info(),
        })

    except Exception as e:
        elapsed = round(time.time() - start, 2)
        request_logs.append({
            'time':         time.strftime('%H:%M:%S'),
            'filename':     f.filename,
            'file_size_kb': file_size_kb,
            'elapsed':      elapsed,
            'status':       f'❌ {str(e)[:60]}',
        })
        log.error(f'[Transcribe] 오류: {e}')
        return jsonify({'ok': False, 'error': str(e)}), 500
    finally:
        try: os.unlink(tmp_path)
        except: pass


@app.route('/logs', methods=['GET'])
def get_logs():
    return jsonify({'logs': list(reversed(request_logs))})


@app.route('/logs', methods=['DELETE'])
def clear_logs():
    request_logs.clear()
    return jsonify({'ok': True})


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001, debug=False, threaded=True)
