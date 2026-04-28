"""
Launcher Server — STT/LLM/TTS subprocess 관리

브라우저의 "▶ Start" 클릭을 받아 subprocess.Popen으로 각 서비스를 띄우고,
"■ Stop"에서 graceful 종료. stdout/stderr는 링 버퍼로 보관 → UI에서 tail 조회 가능.

데이터 경로(실제 추론 호출)는 이 런처를 거치지 않음 — 브라우저 ↔ 각 서버 직결.
이 런처는 순수 제어 경로용.

실행:
    pip install flask flask-cors
    python launcher.py          (http://127.0.0.1:5000)

관리 대상: stt, llm, tts (고정)
"""

import os
import sys
import time
import signal
import shlex
import atexit
import threading
import subprocess
import collections
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

SERVICES = ("stt", "llm", "tts")
LOG_BUFFER_SIZE = 500   # ring buffer 라인 수
IS_WIN = sys.platform == "win32"


class ManagedProcess:
    """단일 서비스 프로세스 래퍼."""

    def __init__(self, service: str, command: str, cwd: str | None, env: dict):
        self.service = service
        self.command = command
        self.cwd = cwd if cwd else None
        self.env = env or {}
        self.proc: subprocess.Popen | None = None
        self.started_at: float | None = None
        self.stdout_buf = collections.deque(maxlen=LOG_BUFFER_SIZE)
        self.stderr_buf = collections.deque(maxlen=LOG_BUFFER_SIZE)
        self._threads: list[threading.Thread] = []

    def start(self):
        """subprocess.Popen으로 띄우고 stdout/stderr 캡처 스레드 시작."""
        # 사용자의 env를 현재 env에 merge (사용자 것이 우선)
        merged_env = os.environ.copy()

        # ★ Windows CP949 한글 깨짐 방지 — Python 자식 프로세스에 UTF-8 강제
        # 사용자 env에 이미 같은 키가 있으면 그것을 우선
        merged_env.setdefault("PYTHONIOENCODING", "utf-8")
        merged_env.setdefault("PYTHONUTF8", "1")
        merged_env.setdefault("PYTHONUNBUFFERED", "1")  # print() 즉시 flush

        if self.env:
            merged_env.update({str(k): str(v) for k, v in self.env.items()})

        # Windows는 posix=False로 path에 있는 역슬래시 보존
        cmd_list = shlex.split(self.command, posix=not IS_WIN)

        popen_kwargs = {
            "cwd": self.cwd,
            "env": merged_env,
            "stdout": subprocess.PIPE,
            "stderr": subprocess.PIPE,
            "stdin": subprocess.DEVNULL,
            "bufsize": 1,
            "universal_newlines": True,
            "encoding": "utf-8",
            "errors": "replace",
        }

        if IS_WIN:
            # CTRL_BREAK_EVENT로 graceful 종료 가능하게
            popen_kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            # 부모 SIGINT로부터 격리 + process group 생성
            popen_kwargs["start_new_session"] = True

        self.proc = subprocess.Popen(cmd_list, **popen_kwargs)
        self.started_at = time.time()
        self.stdout_buf.append({"t": self.started_at, "line": f"[launcher] ▶ started pid={self.proc.pid}"})

        t1 = threading.Thread(target=self._pump, args=(self.proc.stdout, self.stdout_buf), daemon=True)
        t2 = threading.Thread(target=self._pump, args=(self.proc.stderr, self.stderr_buf), daemon=True)
        t1.start(); t2.start()
        self._threads = [t1, t2]

    def _pump(self, stream, buf):
        try:
            for line in iter(stream.readline, ""):
                if not line:
                    break
                buf.append({"t": time.time(), "line": line.rstrip("\n")})
        except Exception as e:
            buf.append({"t": time.time(), "line": f"[launcher] stream error: {e}"})

    def stop(self, timeout: float = 8.0):
        """graceful → escalate to kill."""
        if not self.proc or self.proc.poll() is not None:
            return
        try:
            if IS_WIN:
                # Ctrl-Break은 콘솔 어플리케이션에 인터럽트 → Flask는 KeyboardInterrupt로 정상 종료
                self.proc.send_signal(signal.CTRL_BREAK_EVENT)
            else:
                self.proc.terminate()
            self.proc.wait(timeout=timeout)
            self.stdout_buf.append({"t": time.time(), "line": "[launcher] ■ stopped gracefully"})
        except subprocess.TimeoutExpired:
            try:
                self.proc.kill()
                self.proc.wait(timeout=3)
                self.stdout_buf.append({"t": time.time(), "line": "[launcher] ■ killed (timeout)"})
            except Exception as e:
                self.stdout_buf.append({"t": time.time(), "line": f"[launcher] kill failed: {e}"})
        except Exception as e:
            self.stdout_buf.append({"t": time.time(), "line": f"[launcher] stop error: {e}"})

    def is_running(self) -> bool:
        return self.proc is not None and self.proc.poll() is None

    def status(self) -> dict:
        running = self.is_running()
        return {
            "service":   self.service,
            "running":   running,
            "pid":       self.proc.pid if self.proc else None,
            "exit_code": None if (not self.proc or running) else self.proc.returncode,
            "command":   self.command,
            "cwd":       self.cwd,
            "uptime":    round(time.time() - self.started_at, 1) if running and self.started_at else None,
            "started_at": self.started_at,
            "stdout_lines": len(self.stdout_buf),
            "stderr_lines": len(self.stderr_buf),
        }


# ──────────────────────────────────────────────
# 서비스 레지스트리 (프로세스 핸들)
# ──────────────────────────────────────────────
_registry: dict[str, ManagedProcess] = {}
_lock = threading.Lock()


def _validate_service(svc: str):
    if svc not in SERVICES:
        return f"unknown service: {svc} (expected one of {SERVICES})"
    return None


# ──────────────────────────────────────────────
# Routes
# ──────────────────────────────────────────────
@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "ok": True,
        "service": "launcher",
        "platform": sys.platform,
        "python": sys.version.split()[0],
        "managed": list(SERVICES),
    })


@app.route("/services", methods=["GET"])
def services():
    """모든 서비스의 현재 상태 (UI 폴링용)."""
    result = {}
    with _lock:
        for svc in SERVICES:
            proc = _registry.get(svc)
            if proc:
                result[svc] = proc.status()
            else:
                result[svc] = {
                    "service": svc, "running": False, "pid": None,
                    "exit_code": None, "command": None, "cwd": None,
                    "uptime": None, "started_at": None,
                }
    return jsonify(result)


@app.route("/start", methods=["POST"])
def start():
    data = request.get_json(silent=True) or {}
    svc = data.get("service")
    command = (data.get("command") or "").strip()
    cwd = data.get("cwd") or None
    env = data.get("env") or {}

    err = _validate_service(svc)
    if err:
        return jsonify({"ok": False, "error": err}), 400
    if not command:
        return jsonify({"ok": False, "error": "command is required"}), 400
    if cwd and not os.path.isdir(cwd):
        return jsonify({"ok": False, "error": f"cwd not found: {cwd}"}), 400

    with _lock:
        existing = _registry.get(svc)
        if existing and existing.is_running():
            return jsonify({
                "ok": False, "error": f"{svc} is already running (pid={existing.proc.pid})"
            }), 409

        try:
            mp = ManagedProcess(svc, command, cwd, env)
            mp.start()
            _registry[svc] = mp
            return jsonify({"ok": True, "status": mp.status()})
        except FileNotFoundError as e:
            return jsonify({"ok": False, "error": f"executable not found: {e}"}), 400
        except Exception as e:
            return jsonify({"ok": False, "error": f"spawn failed: {e}"}), 500


@app.route("/stop", methods=["POST"])
def stop():
    data = request.get_json(silent=True) or {}
    svc = data.get("service")
    timeout = float(data.get("timeout", 8.0))

    err = _validate_service(svc)
    if err:
        return jsonify({"ok": False, "error": err}), 400

    with _lock:
        mp = _registry.get(svc)
        if not mp:
            return jsonify({"ok": False, "error": f"{svc} was never started"}), 404
        if not mp.is_running():
            return jsonify({"ok": True, "status": mp.status(), "note": "already stopped"})

        mp.stop(timeout=timeout)
        return jsonify({"ok": True, "status": mp.status()})


@app.route("/logs/<service>", methods=["GET"])
def logs(service):
    err = _validate_service(service)
    if err:
        return jsonify({"ok": False, "error": err}), 400

    tail = int(request.args.get("tail", 100))
    tail = max(1, min(tail, LOG_BUFFER_SIZE))

    with _lock:
        mp = _registry.get(service)
        if not mp:
            return jsonify({"stdout": [], "stderr": [], "running": False})
        return jsonify({
            "stdout":  list(mp.stdout_buf)[-tail:],
            "stderr":  list(mp.stderr_buf)[-tail:],
            "running": mp.is_running(),
        })


@app.route("/logs/<service>", methods=["DELETE"])
def clear_logs(service):
    err = _validate_service(service)
    if err:
        return jsonify({"ok": False, "error": err}), 400
    with _lock:
        mp = _registry.get(service)
        if mp:
            mp.stdout_buf.clear()
            mp.stderr_buf.clear()
    return jsonify({"ok": True})


# ──────────────────────────────────────────────
# Shutdown hook — 런처 종료 시 자식 프로세스 전부 정리
# ──────────────────────────────────────────────
def _cleanup_all():
    print("\n[launcher] shutting down, stopping all managed processes...")
    for svc, mp in list(_registry.items()):
        if mp.is_running():
            print(f"  stopping {svc} (pid={mp.proc.pid})...")
            mp.stop(timeout=5)
    print("[launcher] done.")


atexit.register(_cleanup_all)


if __name__ == "__main__":
    print("=" * 60)
    print("  Launcher Server")
    print(f"  Platform : {sys.platform}")
    print(f"  Python   : {sys.version.split()[0]}")
    print(f"  Managed  : {', '.join(SERVICES)}")
    print(f"  Endpoint : http://127.0.0.1:5000")
    print("=" * 60)
    try:
        app.run(host="127.0.0.1", port=5000, debug=False, threaded=True)
    except KeyboardInterrupt:
        pass
