// ──────────────────────────────────────────────
// AI Control Panel — App-wide constants
// 사용자가 가끔 변경하는 값들을 한 곳에 모아둠.
// ──────────────────────────────────────────────

/**
 * GitHub repository URL.
 * 노드 PC가 install 시 이 repo를 clone함.
 * 변경 후 frontend 재시작/리로드 필요 (vite hot-reload로 충분).
 */
export const REPO_URL = 'https://github.com/Sigdose/ai-control-panel.git'

/**
 * Repo branch (보통 main 또는 master).
 */
export const REPO_BRANCH = 'main'

/**
 * Python 공식 인스톨러 (3.11.x) — winget이 없거나 실패할 때 fallback.
 * 새 버전 나오면 여기만 갈아끼우면 됨.
 */
export const PYTHON_INSTALLER_URL =
  'https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe'
export const PYTHON_INSTALLER_VERSION = '3.11.9'

/**
 * 노드별 기본 설치 경로 (Windows).
 * 사용자가 install 페이지에서 변경 가능.
 */
export const DEFAULT_NODE_INSTALL_PATHS = {
  stt: 'D:\\AI-Nodes\\stt-node',
  llm: 'D:\\AI-Nodes\\llm-node',
  tts: 'D:\\AI-Nodes\\tts-node',
  panel: 'D:\\AI-Nodes\\control-panel',
} as const
