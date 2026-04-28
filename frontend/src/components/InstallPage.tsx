import { useMemo, useState } from 'react'
import PageHeader from '../components/PageHeader'
import {
  bootstrapScript,
  generateNodeScript,
  NODE_INFO,
  type NodeType,
} from '../install/scripts'
import { DEFAULT_NODE_INSTALL_PATHS, REPO_URL, REPO_BRANCH } from '../config'

type Tab = 'bootstrap' | NodeType

export default function InstallPage() {
  const [tab, setTab] = useState<Tab>('bootstrap')
  const [bootstrapPath, setBootstrapPath] = useState(DEFAULT_NODE_INSTALL_PATHS.panel)
  const [nodePaths, setNodePaths] = useState<Record<NodeType, string>>({
    stt: DEFAULT_NODE_INSTALL_PATHS.stt,
    llm: DEFAULT_NODE_INSTALL_PATHS.llm,
    tts: DEFAULT_NODE_INSTALL_PATHS.tts,
  })
  const [prefetchModel, setPrefetchModel] = useState(true)
  const [autoStart, setAutoStart] = useState(false)
  const [copied, setCopied] = useState(false)

  const script = useMemo(() => {
    if (tab === 'bootstrap') return bootstrapScript(bootstrapPath)
    return generateNodeScript(tab, {
      installPath: nodePaths[tab],
      prefetchModel,
      startAfterInstall: autoStart,
    })
  }, [tab, bootstrapPath, nodePaths, prefetchModel, autoStart])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(script)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  const handleDownload = () => {
    const blob = new Blob([script], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const filename = tab === 'bootstrap' ? 'install-panel.ps1' : `install-${tab}-node.ps1`
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="min-h-full">
      <PageHeader
        shortcut="04 · INSTALL"
        title="Node Installation"
        subtitle="컨트롤 패널 또는 모델 노드를 새 PC에 설치"
      />

      <div className="px-8 py-6 space-y-6 max-w-5xl">
        {/* Hero / 설명 */}
        <section className="bg-ink-900/40 border border-ink-800 rounded-lg p-6">
          <div className="text-2xs font-mono uppercase tracking-[0.2em] text-ink-400 mb-2">
            How it works
          </div>
          <div className="text-sm text-ink-200 leading-relaxed space-y-2">
            <p>
              새 PC를 노드로 합류시키려면 <span className="text-ink-100 font-medium">두 단계</span>가 필요해.
            </p>
            <ol className="list-decimal list-inside space-y-1 ml-1 text-ink-300">
              <li>
                <span className="text-ink-100">Bootstrap</span> — 새 PC에 컨트롤 패널 자체(frontend + 런처)를 설치.
                이 페이지를 그 PC에서도 열 수 있게 됨.
              </li>
              <li>
                <span className="text-ink-100">Node</span> — STT/LLM/TTS 중 그 PC가 담당할 노드 타입을 선택해서 설치.
                완료되면 호스트 패널에 그 PC의 IP를 등록.
              </li>
            </ol>
            <p className="text-2xs font-mono text-ink-500 pt-2">
              Repo: <code className="text-ink-300">{REPO_URL}</code> ({REPO_BRANCH})
            </p>
          </div>
        </section>

        {/* 탭 */}
        <div className="flex gap-1 p-1 bg-ink-900 border border-ink-800 rounded">
          <TabButton
            active={tab === 'bootstrap'}
            onClick={() => setTab('bootstrap')}
            label="Bootstrap"
            sub="control panel"
          />
          {(['stt', 'llm', 'tts'] as NodeType[]).map((t) => (
            <TabButton
              key={t}
              active={tab === t}
              onClick={() => setTab(t)}
              label={NODE_INFO[t].label}
              sub={`port ${NODE_INFO[t].port}`}
              accent={NODE_INFO[t].accent}
            />
          ))}
        </div>

        {/* 본문 */}
        <section className="bg-ink-900/40 border border-ink-800 rounded-lg p-6 space-y-5">
          {tab === 'bootstrap' ? (
            <BootstrapPanel path={bootstrapPath} onPathChange={setBootstrapPath} />
          ) : (
            <NodePanel
              type={tab}
              path={nodePaths[tab]}
              onPathChange={(p) => setNodePaths({ ...nodePaths, [tab]: p })}
              prefetchModel={prefetchModel}
              onPrefetchChange={setPrefetchModel}
              autoStart={autoStart}
              onAutoStartChange={setAutoStart}
            />
          )}

          {/* 스크립트 영역 */}
          <div className="space-y-2 pt-3 border-t border-ink-800">
            <div className="flex items-center justify-between">
              <div className="text-2xs font-mono uppercase tracking-wider text-ink-400">
                Generated PowerShell Script
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDownload}
                  className="px-3 py-1.5 text-2xs font-mono uppercase tracking-wider rounded
                             border border-ink-700 text-ink-300 hover:bg-ink-850"
                >
                  ↓ Download .ps1
                </button>
                <button
                  onClick={handleCopy}
                  className={`px-3 py-1.5 text-2xs font-mono uppercase tracking-wider rounded
                             border transition-all
                             ${copied
                               ? 'border-live/40 text-live bg-live/10'
                               : 'border-ink-100 text-ink-100 hover:bg-ink-100 hover:text-ink-950'}`}
                >
                  {copied ? '✓ Copied' : '📋 Copy'}
                </button>
              </div>
            </div>
            <pre
              className="bg-ink-950 border border-ink-800 rounded p-4 text-[0.7rem]
                         font-mono leading-relaxed text-ink-300 overflow-auto max-h-[420px]
                         whitespace-pre-wrap break-all"
            >
              {script}
            </pre>
          </div>

          {/* 사용법 */}
          <div className="pt-3 border-t border-ink-800 space-y-2">
            <div className="text-2xs font-mono uppercase tracking-wider text-ink-400">
              How to use
            </div>
            <ol className="list-decimal list-inside text-xs text-ink-300 space-y-1 ml-1">
              <li>위의 <span className="text-ink-100">📋 Copy</span> 또는 <span className="text-ink-100">↓ Download</span></li>
              <li>대상 PC에서 PowerShell 열기 (관리자 권한 권장)</li>
              <li>
                복사한 스크립트를 붙여넣고 Enter, 또는 다운로드한 파일을:
                <pre className="mt-1 ml-4 text-2xs bg-ink-900 border border-ink-800 rounded px-2 py-1 inline-block">
                  powershell -ExecutionPolicy Bypass -File install-{tab === 'bootstrap' ? 'panel' : `${tab}-node`}.ps1
                </pre>
              </li>
              <li>
                {tab === 'bootstrap'
                  ? '설치 완료 후 그 PC에서 컨트롤 패널을 열면 다시 이 페이지를 볼 수 있음. 거기서 노드 타입 선택해서 설치.'
                  : '설치 완료 후 표시되는 IP를 복사해서, 호스트 패널의 메인 페이지에서 해당 노드 카드의 Endpoint를 그 IP로 변경.'}
              </li>
            </ol>
          </div>
        </section>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────
function TabButton({
  active, onClick, label, sub, accent,
}: {
  active: boolean
  onClick: () => void
  label: string
  sub?: string
  accent?: string
}) {
  const accentClass = accent ? `text-${accent}` : 'text-ink-200'
  return (
    <button
      onClick={onClick}
      className={`flex-1 px-4 py-2.5 rounded text-xs font-mono uppercase tracking-wider transition-all
        ${active
          ? `bg-ink-800 ${active && accent ? accentClass : 'text-ink-100'}`
          : 'text-ink-500 hover:text-ink-300'}`}
    >
      <div>{label}</div>
      {sub && <div className="text-[0.625rem] text-ink-600 mt-0.5">{sub}</div>}
    </button>
  )
}

// ──────────────────────────────────────────────
function BootstrapPanel({
  path, onPathChange,
}: { path: string; onPathChange: (v: string) => void }) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium text-ink-100">Bootstrap (Control Panel 설치)</h3>
        <p className="text-xs text-ink-400 mt-1">
          새 PC에 컨트롤 패널 자체를 설치. 한 번만 실행하면 그 PC도 노드 install 페이지를 띄울 수 있음.
        </p>
      </div>

      <div className="space-y-2">
        <label className="block text-2xs font-mono uppercase tracking-wider text-ink-500">
          설치 경로
        </label>
        <input
          type="text"
          value={path}
          onChange={(e) => onPathChange(e.target.value)}
          className="input-style"
          placeholder="D:\AI-Nodes\control-panel"
        />
      </div>

      <div className="grid grid-cols-3 gap-3 text-xs">
        <Spec label="Python" value="3.11 (자동)" />
        <Spec label="Node.js" value="LTS 필요 (수동)" />
        <Spec label="디스크" value="~500MB" />
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────
function NodePanel({
  type, path, onPathChange,
  prefetchModel, onPrefetchChange,
  autoStart, onAutoStartChange,
}: {
  type: NodeType
  path: string
  onPathChange: (v: string) => void
  prefetchModel: boolean
  onPrefetchChange: (v: boolean) => void
  autoStart: boolean
  onAutoStartChange: (v: boolean) => void
}) {
  const info = NODE_INFO[type]
  return (
    <div className="space-y-4">
      <div>
        <h3 className={`text-lg font-medium text-${info.accent}`}>{info.label}</h3>
        <p className="text-xs text-ink-400 mt-1">{info.description}</p>
      </div>

      <div className="space-y-2">
        <label className="block text-2xs font-mono uppercase tracking-wider text-ink-500">
          설치 경로
        </label>
        <input
          type="text"
          value={path}
          onChange={(e) => onPathChange(e.target.value)}
          className="input-style"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <label className="flex items-start gap-2 text-xs text-ink-300 cursor-pointer">
          <input
            type="checkbox"
            checked={prefetchModel}
            onChange={(e) => onPrefetchChange(e.target.checked)}
            className={`mt-0.5 accent-${info.accent}`}
          />
          <div>
            <div>모델 미리 다운로드</div>
            <div className="text-2xs text-ink-500 mt-0.5">
              install 시 모델 캐시까지 받음 (권장).
              끄면 첫 서버 실행 시 다운로드.
            </div>
          </div>
        </label>

        <label className="flex items-start gap-2 text-xs text-ink-300 cursor-pointer">
          <input
            type="checkbox"
            checked={autoStart}
            onChange={(e) => onAutoStartChange(e.target.checked)}
            className={`mt-0.5 accent-${info.accent}`}
          />
          <div>
            <div>설치 후 자동 실행</div>
            <div className="text-2xs text-ink-500 mt-0.5">
              install이 끝나면 바로 서버 시작 (PowerShell 창 유지 필요).
            </div>
          </div>
        </label>
      </div>

      <div className="grid grid-cols-3 gap-3 text-xs">
        <Spec label="포트" value={String(info.port)} />
        <Spec label="디스크" value={info.size} />
        <Spec label="GPU" value="CUDA 12.x" />
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────
function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 py-2 bg-ink-900 border border-ink-800 rounded">
      <div className="text-2xs font-mono uppercase tracking-wider text-ink-500">{label}</div>
      <div className="text-ink-200 mt-0.5 truncate">{value}</div>
    </div>
  )
}
