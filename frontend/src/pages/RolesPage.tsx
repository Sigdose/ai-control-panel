import { useState } from 'react'
import PageHeader from '../components/PageHeader'
import RoleControl from '../components/RoleControl'
import LauncherLogs from '../components/LauncherLogs'
import StatusDot from '../components/StatusDot'
import { useLauncherRuntime } from '../store/launcherStore'
import { REPO_URL, NODE_INSTALL_CMD } from '../config'
import type { RoleKey } from '../types'

const ROLES: Array<{ key: RoleKey; title: string; description: string; size: string; accent: string }> = [
  {
    key: 'stt',
    title: 'STT Role',
    description: 'faster-whisper · 음성 인식 모델 서버 (port 5001)',
    size: 'venv ~3GB · 모델 ~3GB',
    accent: 'stt',
  },
  {
    key: 'tts',
    title: 'TTS Role',
    description: 'Chatterbox · 음성 합성 모델 서버 (port 5002)',
    size: 'venv ~5GB · 모델 ~3GB',
    accent: 'tts',
  },
]

export default function RolesPage() {
  const launcherOnline = useLauncherRuntime((s) => s.online)
  const system = useLauncherRuntime((s) => s.system)
  const roles = useLauncherRuntime((s) => s.roles)
  const [logRole, setLogRole] = useState<RoleKey | null>(null)
  const [logSource, setLogSource] = useState<'process' | 'install'>('install')
  const [copied, setCopied] = useState(false)

  const copyInstallCmd = async () => {
    try {
      await navigator.clipboard.writeText(NODE_INSTALL_CMD)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  return (
    <div className="min-h-full">
      <PageHeader
        shortcut="04 · ROLES"
        title="역할 관리"
        subtitle="이 PC가 담당할 역할을 선택. 호스트는 항상 자동, STT/TTS는 필요시 활성화."
        right={
          <div className="flex items-center gap-2">
            <StatusDot state={launcherOnline ? 'live' : 'dead'} />
            <span className="text-2xs font-mono uppercase tracking-wider text-ink-300">
              launcher {launcherOnline ? 'online' : 'offline'}
            </span>
          </div>
        }
      />

      <div className="px-8 py-6 space-y-6 max-w-5xl">
        {/* 시스템 정보 */}
        {system && (
          <section className="bg-ink-900/40 border border-ink-800 rounded-lg p-5">
            <div className="text-2xs font-mono uppercase tracking-[0.2em] text-ink-400 mb-3">
              System Info
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <Spec label="Platform" value={system.platform} />
              <Spec label="Python" value={system.python} />
              <Spec label="Node" value={system.node.version ?? 'N/A'}
                    bad={!system.node.ok} />
              <Spec label="Git" value={system.git.version ?? 'N/A'}
                    bad={!system.git.ok} />
              {system.gpu ? (
                <div className="col-span-2 md:col-span-4 px-3 py-2 bg-ink-900 border border-ink-800 rounded">
                  <div className="text-2xs font-mono uppercase tracking-wider text-ink-500">GPU</div>
                  <div className="flex items-baseline justify-between mt-0.5">
                    <span className="text-ink-100 truncate">{system.gpu.name}</span>
                    <span className="text-ink-300 tabular-nums text-2xs">
                      {(system.gpu.used_mb / 1024).toFixed(1)} / {(system.gpu.total_mb / 1024).toFixed(1)} GB
                    </span>
                  </div>
                </div>
              ) : (
                <div className="col-span-2 md:col-span-4 px-3 py-2 bg-ink-900 border border-ink-800 rounded text-2xs font-mono text-ink-500">
                  GPU: nvidia-smi 실행 불가 (CUDA 미설치 또는 드라이버 문제)
                </div>
              )}
            </div>
            <div className="mt-2 text-2xs font-mono text-ink-500 truncate">
              Root: {system.root_dir}
            </div>
          </section>
        )}

        {/* 역할 카드들 */}
        <section className="space-y-3">
          <div className="text-2xs font-mono uppercase tracking-[0.2em] text-ink-400">
            Roles on this PC
          </div>

          {ROLES.map((r) => {
            const status = roles[r.key]
            const installed = status?.installed ?? false
            const installing = status?.installing ?? false
            const running = status?.process?.running ?? false

            return (
              <div key={r.key}
                   className={`bg-ink-900/40 border rounded-lg p-5 transition-all
                              ${running ? `border-${r.accent}/30` : 'border-ink-800'}`}>
                <div className="flex items-start justify-between mb-4 gap-4">
                  <div className="flex-1">
                    <h3 className={`text-base font-medium text-${r.accent}`}>{r.title}</h3>
                    <p className="text-xs text-ink-400 mt-0.5">{r.description}</p>
                    <p className="text-2xs text-ink-500 mt-1">{r.size}</p>
                  </div>
                  <div className="text-right text-2xs font-mono">
                    {installing ? (
                      <span className="text-wait uppercase tracking-wider scanline px-2 py-1">installing</span>
                    ) : !installed ? (
                      <span className="text-ink-500 uppercase tracking-wider">not installed</span>
                    ) : running ? (
                      <span className="text-live uppercase tracking-wider flex items-center gap-1.5 justify-end">
                        <StatusDot state="live" /> running
                      </span>
                    ) : (
                      <span className="text-ink-400 uppercase tracking-wider">stopped</span>
                    )}
                  </div>
                </div>

                <RoleControl role={r.key} />

                {/* 로그 보기 버튼 */}
                <div className="mt-4 pt-3 border-t border-ink-800 flex gap-2 text-2xs font-mono">
                  <button
                    onClick={() => {
                      setLogRole(r.key)
                      setLogSource('install')
                    }}
                    disabled={!status}
                    className={`px-2.5 py-1 rounded uppercase tracking-wider border transition-colors
                      ${logRole === r.key && logSource === 'install'
                        ? `border-${r.accent}/40 text-${r.accent}`
                        : 'border-ink-700 text-ink-400 hover:text-ink-200'}`}
                  >
                    Install Logs
                  </button>
                  <button
                    onClick={() => {
                      setLogRole(r.key)
                      setLogSource('process')
                    }}
                    disabled={!installed}
                    className={`px-2.5 py-1 rounded uppercase tracking-wider border transition-colors
                      ${logRole === r.key && logSource === 'process'
                        ? `border-${r.accent}/40 text-${r.accent}`
                        : 'border-ink-700 text-ink-400 hover:text-ink-200'}
                      disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    Server Logs
                  </button>
                </div>
              </div>
            )
          })}
        </section>

        {/* LLM 안내 (별도) */}
        <section className="bg-ink-900/40 border border-ink-800 rounded-lg p-5">
          <h3 className="text-base font-medium text-llm">LLM Role</h3>
          <p className="text-xs text-ink-400 mt-0.5">
            Ollama 자체 인스톨러를 사용. 별도 venv 불필요.
          </p>
          <div className="mt-3 text-xs text-ink-300 space-y-1.5">
            <div>1. <a href="https://ollama.com/download" target="_blank" rel="noreferrer"
                       className="text-llm hover:underline">ollama.com/download</a>에서 설치</div>
            <div>2. 외부 접속 환경변수 설정 (필요 시):
              <code className="block ml-4 mt-1 px-2 py-1 bg-ink-900 border border-ink-800 rounded text-2xs">
                $env:OLLAMA_HOST = '0.0.0.0:11434'<br/>
                $env:OLLAMA_ORIGINS = '*'
              </code>
            </div>
            <div>3. 모델 받기: <code className="text-ink-100">ollama pull llama3.1</code></div>
          </div>
        </section>

        {/* 로그 뷰어 */}
        {logRole && (
          <section className="bg-ink-900/40 border border-ink-800 rounded-lg p-5 animate-fade-in">
            <div className="flex items-center justify-between mb-3">
              <div className="text-2xs font-mono uppercase tracking-[0.2em] text-ink-400">
                {logRole.toUpperCase()} · {logSource === 'install' ? 'Install Log' : 'Server Output'}
              </div>
              <button onClick={() => setLogRole(null)}
                      className="text-2xs font-mono text-ink-500 hover:text-ink-200 uppercase tracking-wider">
                close ✕
              </button>
            </div>
            <LauncherLogs role={logRole} source={logSource} height="h-96" />
          </section>
        )}

        {/* 다른 PC 합류 안내 */}
        <section className="bg-ink-900/40 border border-ink-800 rounded-lg p-5">
          <h3 className="text-base font-medium text-ink-100">다른 PC를 노드로 합류</h3>
          <p className="text-xs text-ink-400 mt-0.5">
            노드 PC에서 PowerShell을 열고 아래 한 줄을 실행하면 패널이 설치됨.
            그 PC에서도 컨트롤 패널을 띄운 후 이 Roles 페이지에서 STT/TTS 역할을 활성화.
          </p>

          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-2xs font-mono uppercase tracking-wider text-ink-500">
                Install Command
              </span>
              <button onClick={copyInstallCmd}
                      className={`px-2.5 py-1 text-2xs font-mono uppercase tracking-wider rounded border transition-all
                        ${copied
                          ? 'border-live/40 text-live bg-live/10'
                          : 'border-ink-100 text-ink-100 hover:bg-ink-100 hover:text-ink-950'}`}>
                {copied ? '✓ Copied' : '📋 Copy'}
              </button>
            </div>
            <pre className="bg-ink-950 border border-ink-800 rounded p-3 text-2xs font-mono
                           text-ink-300 overflow-auto whitespace-pre-wrap break-all">
              {NODE_INSTALL_CMD}
            </pre>
            <p className="text-2xs font-mono text-ink-500">
              Repo: <code className="text-ink-300">{REPO_URL}</code>
            </p>
          </div>

          <div className="mt-4 pt-3 border-t border-ink-800 text-xs text-ink-300 space-y-1.5">
            <div className="text-2xs font-mono uppercase tracking-wider text-ink-500 mb-1">Steps</div>
            <ol className="list-decimal list-inside space-y-1 text-ink-300">
              <li>위 명령어를 노드 PC PowerShell에 붙여넣고 Enter</li>
              <li>Python/Node/Git 자동 설치 (관리자 동의 다이얼로그가 뜸)</li>
              <li>설치 완료 후 <code className="text-ink-100">.\start.ps1</code> 실행</li>
              <li>그 PC의 브라우저에서 Roles 페이지 → STT 또는 TTS 역할 install</li>
              <li>호스트 패널에서 이 PC IP로 STT/TTS Endpoint 변경</li>
            </ol>
          </div>
        </section>
      </div>
    </div>
  )
}

function Spec({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="px-3 py-2 bg-ink-900 border border-ink-800 rounded">
      <div className="text-2xs font-mono uppercase tracking-wider text-ink-500">{label}</div>
      <div className={`mt-0.5 truncate ${bad ? 'text-dead' : 'text-ink-200'}`}>{value}</div>
    </div>
  )
}
