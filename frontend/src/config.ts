// ──────────────────────────────────────────────
// AI Control Panel — App-wide constants
// ──────────────────────────────────────────────

// GitHub repo (install 안내에 표시)
export const REPO_URL = 'https://github.com/Sigdose/ai-control-panel.git'
export const REPO_BRANCH = 'main'

// 노드 PC를 위한 단일 install 명령어 (브라우저로 표시)
export const NODE_INSTALL_CMD = `git clone ${REPO_URL} && cd ai-control-panel && powershell -ExecutionPolicy Bypass -File install.ps1`
