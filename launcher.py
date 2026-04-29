"""
AI Control Panel — Unified Launcher

이 launcher는 모든 PC에서 항상 실행됨.
역할(host / stt-node / tts-node)은 UI에서 유동적으로 선택.

기능:
  - subprocess 매니저: STT/TTS 서버 spawn/kill
  - role별 venv 자동 셋업 (UI에서 "역할 활성화" 누르면 생성)
  - 시스템 정보 노출 (Python/Node/Git 버전, GPU 정보)

엔드포인트:
  GET  /health                  런처 상태
  GET  /system                  시스템 정보 (Python, Node, GPU 등)
  GET  /roles                   역할별 설치/실행 상태
  POST /roles/install           {role: 'stt'|'tts'} - 그 역할의 venv 셋업
  GET  /services                STT/TTS 프로세스 상태
  POST /start                   {service: 'stt'|'tts'} - 서버 spawn
  POST /stop                    {service: 'stt'|'tts'}
  GET  /logs/<service>?tail=N
  DELETE /logs/<service>
  GET  /install-logs/<role>     install 진행 로그 (tail)

실행:
  pip install flask flask-cors
  python launcher.py            (http://127.0.0.1:5000)
"""

import os
import sys
import time
import shlex
import atexit
import signal
import threading
import subprocess
import collections
import json
from pathlib import Path
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# ──────────────────────────────────────────────
# 경로 설정
# ──────────────────────────────────────────────
ROOT_DIR = Path(__file__).resolve().parent
VENV_DIR = ROOT_DIR / 'venvs'      # role별 venv를 모아두는 폴더
VENV_DIR.mkdir(exist_ok=True)

IS_WIN = sys.platform == 'win32'
PY_EXE = 'python.exe' if IS_WIN else 'python'
SCRIPTS_DIR = 'Scripts' if IS_WIN else 'bin'

# ──────────────────────────────────────────────
# Role 정의
# ──────────────────────────────────────────────
ROLES = {
    'stt': {
        'venv_name':    'venv-stt',
        'requirements': ROOT_DIR / 'requirements-stt.txt',
        'server_file':  ROOT_DIR / 'stt_server.py',
        'port':         5001,
        'extra_install_steps': [],   # 필요 시 추가 명령
    },
    'tts': {
        'venv_name':    'venv-tts',
        'requirements': ROOT_DIR / 'requirements-tts.txt',
        'server_file':  ROOT_DIR / 'tts_server.py',
        'port':         5002,
        # TTS는 PyTorch를 별도 인덱스로 추가 설치
        'extra_install_steps': [
            ['pip', 'install', '--upgrade', 'torch', 'torchaudio',
             '--index-url', 'https://download.pytorch.org/whl/cu128'],
        ],
    },
}


def venv_python_for(role: str) -> Path:
    return VENV_DIR / ROLES[role]['venv_name'] / SCRIPTS_DIR / PY_EXE


def venv_pip_for(role: str) -> Path:
    return VENV_DIR / ROLES[role]['venv_name'] / SCRIPTS_DIR / ('pip.exe' if IS_WIN else 'pip')


def role_installed(role: str) -> bool:
    return venv_python_for(role).exists()


# ──────────────────────────────────────────────
# Subprocess 매니저
# ──────────────────────────────────────────────
LOG_BUFFER_SIZE = 500


class ManagedProcess:
    def __init__(self, role: str):
        self.role = role
        self.proc: subprocess.Popen | None = None
        self.started_at: float | None = None
        self.stdout_buf = collections.deque(maxlen=LOG_BUFFER_SIZE)
        self.stderr_buf = collections.deque(maxlen=LOG_BUFFER_SIZE)

    def start(self) -> tuple[bool, str]:
        if self.is_running():
            return False, f'{self.role} already running (pid={self.proc.pid})'
        if not role_installed(self.role):
            return False, f'{self.role} not installed (역할을 먼저 설치하세요)'

        cfg = ROLES[self.role]
        venv_py = venv_python_for(self.role)
        if not cfg['server_file'].exists():
            return False, f"server file not found: {cfg['server_file']}"

        env = os.environ.copy()
        env.setdefault('PYTHONIOENCODING', 'utf-8')
        env.setdefault('PYTHONUTF8', '1')
        env.setdefault('PYTHONUNBUFFERED', '1')

        kwargs = {
            'cwd':               str(ROOT_DIR),
            'env':               env,
            'stdout':            subprocess.PIPE,
            'stderr':            subprocess.PIPE,
            'stdin':             subprocess.DEVNULL,
            'bufsize':           1,
            'universal_newlines': True,
            'encoding':          'utf-8',
            'errors':            'replace',
        }
        if IS_WIN:
            kwargs['creationflags'] = subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            kwargs['start_new_session'] = True

        try:
            self.proc = subprocess.Popen([str(venv_py), str(cfg['server_file'])], **kwargs)
        except Exception as e:
            return False, f'spawn failed: {e}'

        self.started_at = time.time()
        self.stdout_buf.append({'t': self.started_at, 'line': f'[launcher] ▶ started pid={self.proc.pid}'})
        threading.Thread(target=self._pump, args=(self.proc.stdout, self.stdout_buf), daemon=True).start()
        threading.Thread(target=self._pump, args=(self.proc.stderr, self.stderr_buf), daemon=True).start()
        return True, 'ok'

    def _pump(self, stream, buf):
        try:
            for line in iter(stream.readline, ''):
                if not line:
                    break
                buf.append({'t': time.time(), 'line': line.rstrip('\n')})
        except Exception as e:
            buf.append({'t': time.time(), 'line': f'[launcher] stream error: {e}'})

    def stop(self, timeout: float = 8.0) -> bool:
        if not self.proc or self.proc.poll() is not None:
            return True
        try:
            if IS_WIN:
                self.proc.send_signal(signal.CTRL_BREAK_EVENT)
            else:
                self.proc.terminate()
            self.proc.wait(timeout=timeout)
            self.stdout_buf.append({'t': time.time(), 'line': '[launcher] ■ stopped'})
            return True
        except subprocess.TimeoutExpired:
            try:
                self.proc.kill()
                self.proc.wait(timeout=3)
                self.stdout_buf.append({'t': time.time(), 'line': '[launcher] ■ killed (timeout)'})
                return True
            except Exception as e:
                self.stdout_buf.append({'t': time.time(), 'line': f'[launcher] kill failed: {e}'})
                return False

    def is_running(self) -> bool:
        return self.proc is not None and self.proc.poll() is None

    def status(self) -> dict:
        running = self.is_running()
        return {
            'role':       self.role,
            'running':    running,
            'pid':        self.proc.pid if self.proc else None,
            'exit_code':  None if (not self.proc or running) else self.proc.returncode,
            'uptime':     round(time.time() - self.started_at, 1) if running and self.started_at else None,
            'started_at': self.started_at,
        }


_processes: dict[str, ManagedProcess] = {}
_install_logs: dict[str, collections.deque] = {}
_install_lock = threading.Lock()
_install_in_progress: dict[str, bool] = {}


def get_process(role: str) -> ManagedProcess:
    if role not in _processes:
        _processes[role] = ManagedProcess(role)
    return _processes[role]


# ──────────────────────────────────────────────
# Install 로직 (role별 venv 셋업, 백그라운드 스레드)
# ──────────────────────────────────────────────
def _install_log(role: str, line: str):
    if role not in _install_logs:
        _install_logs[role] = collections.deque(maxlen=LOG_BUFFER_SIZE)
    _install_logs[role].append({'t': time.time(), 'line': line})


def _run_in_install(role: str, cmd: list, cwd: Path | None = None):
    _install_log(role, f'$ {" ".join(str(c) for c in cmd)}')
    proc = subprocess.Popen(
        cmd,
        cwd=str(cwd) if cwd else str(ROOT_DIR),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        bufsize=1,
        universal_newlines=True,
        encoding='utf-8',
        errors='replace',
    )
    for line in iter(proc.stdout.readline, ''):
        if line:
            _install_log(role, line.rstrip('\n'))
    proc.wait()
    return proc.returncode


def _install_role_thread(role: str):
    cfg = ROLES[role]
    venv_path = VENV_DIR / cfg['venv_name']
    try:
        _install_log(role, f'=== {role.upper()} 역할 설치 시작 ===')

        # 1) venv 생성
        if not venv_path.exists():
            _install_log(role, f'venv 생성: {venv_path}')
            rc = _run_in_install(role, [sys.executable, '-m', 'venv', str(venv_path)])
            if rc != 0:
                _install_log(role, f'✗ venv 생성 실패 (rc={rc})')
                return
        else:
            _install_log(role, f'기존 venv 사용: {venv_path}')

        py = venv_python_for(role)

        # 2) pip 업그레이드
        rc = _run_in_install(role, [str(py), '-m', 'pip', 'install', '--upgrade', 'pip',
                                    '--disable-pip-version-check'])
        if rc != 0:
            _install_log(role, f'✗ pip 업그레이드 실패 (rc={rc})')
            return

        # 3) requirements 설치
        req = cfg['requirements']
        if req.exists():
            _install_log(role, f'의존성 설치: {req.name}')
            rc = _run_in_install(role, [str(py), '-m', 'pip', 'install', '-r', str(req),
                                        '--disable-pip-version-check'])
            if rc != 0:
                _install_log(role, f'✗ {req.name} 설치 실패 (rc={rc})')
                return
        else:
            _install_log(role, f'⚠ {req} 파일 없음, 건너뜀')

        # 4) 추가 단계
        for step in cfg['extra_install_steps']:
            full_cmd = [str(py), '-m'] + step
            rc = _run_in_install(role, full_cmd)
            if rc != 0:
                _install_log(role, f'✗ 추가 단계 실패 (rc={rc}): {step}')
                return

        _install_log(role, f'=== ✅ {role.upper()} 설치 완료 ===')
    except Exception as e:
        _install_log(role, f'✗ 설치 중 예외: {e}')
    finally:
        with _install_lock:
            _install_in_progress[role] = False


# ──────────────────────────────────────────────
# 시스템 정보
# ──────────────────────────────────────────────
def _check_command(cmd_args, version_match=None):
    try:
        r = subprocess.run(cmd_args, capture_output=True, text=True, timeout=3)
        out = (r.stdout or r.stderr).strip()
        return {'ok': True, 'version': out.split('\n')[0] if out else 'unknown'}
    except Exception:
        return {'ok': False, 'version': None}


def _gpu_info():
    try:
        r = subprocess.run(['nvidia-smi', '--query-gpu=name,memory.total,memory.used',
                            '--format=csv,noheader,nounits'],
                           capture_output=True, text=True, timeout=3)
        if r.returncode == 0:
            line = r.stdout.strip().split('\n')[0]
            parts = [p.strip() for p in line.split(',')]
            return {
                'name':       parts[0],
                'total_mb':   int(parts[1]),
                'used_mb':    int(parts[2]),
            }
    except Exception:
        pass
    return None


# ──────────────────────────────────────────────
# Routes
# ──────────────────────────────────────────────
@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        'ok':      True,
        'service': 'launcher',
        'version': '0.2.0',
    })


@app.route('/system', methods=['GET'])
def system_info():
    return jsonify({
        'platform':  sys.platform,
        'python':    sys.version.split()[0],
        'python_check': _check_command([sys.executable, '--version']),
        'node':      _check_command(['node', '--version']),
        'git':       _check_command(['git', '--version']),
        'gpu':       _gpu_info(),
        'root_dir':  str(ROOT_DIR),
    })


@app.route('/roles', methods=['GET'])
def roles_status():
    """각 role의 설치/실행 상태 종합"""
    result = {}
    for role in ROLES:
        proc = _processes.get(role)
        result[role] = {
            'installed':   role_installed(role),
            'venv_path':   str(VENV_DIR / ROLES[role]['venv_name']),
            'port':        ROLES[role]['port'],
            'installing':  _install_in_progress.get(role, False),
            'process':     proc.status() if proc else None,
        }
    return jsonify(result)


@app.route('/roles/install', methods=['POST'])
def install_role():
    data = request.get_json(silent=True) or {}
    role = data.get('role')
    if role not in ROLES:
        return jsonify({'ok': False, 'error': f'unknown role: {role}'}), 400

    with _install_lock:
        if _install_in_progress.get(role):
            return jsonify({'ok': False, 'error': f'{role} 설치가 이미 진행 중'}), 409
        _install_in_progress[role] = True
        _install_logs[role] = collections.deque(maxlen=LOG_BUFFER_SIZE)

    threading.Thread(target=_install_role_thread, args=(role,), daemon=True).start()
    return jsonify({'ok': True, 'role': role, 'message': '설치 시작됨, /install-logs로 진행 확인'})


@app.route('/roles/uninstall', methods=['POST'])
def uninstall_role():
    """venv 폴더 삭제. 실행 중이면 stop 먼저."""
    import shutil
    data = request.get_json(silent=True) or {}
    role = data.get('role')
    if role not in ROLES:
        return jsonify({'ok': False, 'error': f'unknown role: {role}'}), 400

    proc = _processes.get(role)
    if proc and proc.is_running():
        proc.stop()

    venv_path = VENV_DIR / ROLES[role]['venv_name']
    if venv_path.exists():
        try:
            shutil.rmtree(venv_path)
            return jsonify({'ok': True, 'message': f'{venv_path} 삭제됨'})
        except Exception as e:
            return jsonify({'ok': False, 'error': str(e)}), 500
    return jsonify({'ok': True, 'message': '이미 삭제됨'})


@app.route('/install-logs/<role>', methods=['GET'])
def install_logs(role):
    if role not in ROLES:
        return jsonify({'ok': False, 'error': 'unknown role'}), 400
    tail = int(request.args.get('tail', 200))
    logs = list(_install_logs.get(role, []))[-tail:]
    return jsonify({
        'role':        role,
        'logs':        logs,
        'in_progress': _install_in_progress.get(role, False),
    })


@app.route('/services', methods=['GET'])
def services():
    result = {}
    for role in ROLES:
        proc = _processes.get(role)
        if proc:
            result[role] = proc.status()
        else:
            result[role] = {
                'role': role, 'running': False, 'pid': None,
                'exit_code': None, 'uptime': None, 'started_at': None,
            }
    return jsonify(result)


@app.route('/start', methods=['POST'])
def start_service():
    data = request.get_json(silent=True) or {}
    role = data.get('service') or data.get('role')
    if role not in ROLES:
        return jsonify({'ok': False, 'error': f'unknown role: {role}'}), 400

    proc = get_process(role)
    ok, msg = proc.start()
    if ok:
        return jsonify({'ok': True, 'status': proc.status()})
    code = 409 if 'already' in msg else 400
    return jsonify({'ok': False, 'error': msg}), code


@app.route('/stop', methods=['POST'])
def stop_service():
    data = request.get_json(silent=True) or {}
    role = data.get('service') or data.get('role')
    if role not in ROLES:
        return jsonify({'ok': False, 'error': f'unknown role: {role}'}), 400

    proc = _processes.get(role)
    if not proc:
        return jsonify({'ok': True, 'note': 'never started'})
    proc.stop()
    return jsonify({'ok': True, 'status': proc.status()})


@app.route('/logs/<service>', methods=['GET'])
def get_logs(service):
    if service not in ROLES:
        return jsonify({'ok': False, 'error': 'unknown role'}), 400
    tail = int(request.args.get('tail', 100))
    proc = _processes.get(service)
    if not proc:
        return jsonify({'stdout': [], 'stderr': [], 'running': False})
    return jsonify({
        'stdout':  list(proc.stdout_buf)[-tail:],
        'stderr':  list(proc.stderr_buf)[-tail:],
        'running': proc.is_running(),
    })


@app.route('/logs/<service>', methods=['DELETE'])
def clear_logs(service):
    if service not in ROLES:
        return jsonify({'ok': False, 'error': 'unknown role'}), 400
    proc = _processes.get(service)
    if proc:
        proc.stdout_buf.clear()
        proc.stderr_buf.clear()
    return jsonify({'ok': True})


# ──────────────────────────────────────────────
# Shutdown hook
# ──────────────────────────────────────────────
def _cleanup_all():
    print('\n[launcher] shutting down, stopping all managed processes...')
    for role, proc in list(_processes.items()):
        if proc.is_running():
            print(f'  stopping {role} (pid={proc.proc.pid})...')
            proc.stop(timeout=5)


atexit.register(_cleanup_all)


if __name__ == '__main__':
    print('=' * 60)
    print('  AI Control Panel — Launcher v0.2')
    print(f'  Platform : {sys.platform}')
    print(f'  Python   : {sys.version.split()[0]}')
    print(f'  Root     : {ROOT_DIR}')
    print(f'  Venvs    : {VENV_DIR}')
    print(f'  Roles    : {", ".join(ROLES.keys())}')
    print(f'  Endpoint : http://127.0.0.1:5000')
    print('=' * 60)
    try:
        app.run(host='127.0.0.1', port=5000, debug=False, threaded=True)
    except KeyboardInterrupt:
        pass
