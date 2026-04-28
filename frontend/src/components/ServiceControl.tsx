import { useState } from 'react'
import { useLauncherStore, useLauncherRuntime } from '../store/launcherStore'
import { launcherStart, launcherStop } from '../api/launcher'
import type { ServiceKey, ServiceMode } from '../types'

interface ServiceControlProps {
  service: ServiceKey
  accent: string  // 'stt' | 'llm' | 'tts' — tailwind color class 접미사
}

const ACCENTS = {
  stt: { text: 'text-stt', bg: 'bg-stt', border: 'border-stt/30' },
  llm: { text: 'text-llm', bg: 'bg-llm', border: 'border-llm/30' },
  tts: { text: 'text-tts', bg: 'bg-tts', border: 'border-tts/30' },
} as const

export default function ServiceControl({ service }: ServiceControlProps) {
  const profile = useLauncherStore((s) => s.profiles[service])
  const setProfile = useLauncherStore((s) => s.setProfile)
  const launcherUrl = useLauncherStore((s) => s.launcherUrl)
  const launcherOnline = useLauncherRuntime((s) => s.launcherOnline)
  const runtimeStatus = useLauncherRuntime((s) => s.serviceStatus[service])

  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const accent = ACCENTS[service]
  const running = runtimeStatus?.running ?? false
  const pid = runtimeStatus?.pid
  const uptime = runtimeStatus?.uptime
  const exitCode = runtimeStatus?.exit_code

  const setMode = (mode: ServiceMode) => setProfile(service, { mode })

  const flash = (msg: string, ttl = 3000) => {
    setMessage(msg)
    setTimeout(() => setMessage(null), ttl)
  }

  const handleStart = async () => {
    if (profile.mode !== 'local') return
    if (!profile.command.trim()) {
      flash('명령어를 먼저 입력하세요')
      return
    }
    setBusy(true)
    try {
      const res = await launcherStart(launcherUrl, {
        service,
        command: profile.command,
        cwd: profile.cwd || undefined,
        env: profile.env && Object.keys(profile.env).length ? profile.env : undefined,
      })
      if (res.ok) flash(`▶ spawned (pid ${res.status?.pid})`)
      else flash(`✗ ${res.error}`, 5000)
    } catch (e: any) {
      flash(`✗ ${e.message}`, 5000)
    } finally {
      setBusy(false)
    }
  }

  const handleStop = async () => {
    setBusy(true)
    try {
      const res = await launcherStop(launcherUrl, service)
      if (res.ok) flash('■ stopped')
      else flash(`✗ ${res.error}`, 5000)
    } catch (e: any) {
      flash(`✗ ${e.message}`, 5000)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2.5">
      {/* Mode toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-2xs font-mono text-ink-500 uppercase tracking-wider">Mode</span>
          <div className="flex gap-0.5 p-0.5 bg-ink-900 border border-ink-800 rounded">
            {(['local', 'remote'] as ServiceMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-2.5 py-0.5 text-[0.625rem] font-mono uppercase tracking-wider rounded transition-all
                  ${profile.mode === m
                    ? `${accent.bg}/20 ${accent.text}`
                    : 'text-ink-500 hover:text-ink-300'}`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {/* Process badge */}
        {profile.mode === 'local' && (
          <div className="flex items-center gap-1.5 text-2xs font-mono">
            {running ? (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-live dot-live animate-pulse-slow" />
                <span className="text-ink-200 tabular-nums">
                  pid {pid} · {uptime?.toFixed(0)}s
                </span>
              </>
            ) : exitCode != null ? (
              <span className="text-dead">exit {exitCode}</span>
            ) : (
              <span className="text-ink-500">stopped</span>
            )}
          </div>
        )}
      </div>

      {/* Local mode: command editor (expandable) + Start/Stop */}
      {profile.mode === 'local' && (
        <>
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full flex items-center justify-between px-2.5 py-1.5 text-2xs font-mono
                       bg-ink-900/60 border border-ink-800 rounded hover:border-ink-700 transition-colors"
          >
            <span className="text-ink-300 truncate mr-2">
              {profile.command || '(명령어 미설정)'}
            </span>
            <span className="text-ink-500 shrink-0">{expanded ? '▲' : '▼'}</span>
          </button>

          {expanded && (
            <div className="space-y-2 p-3 bg-ink-900 border border-ink-800 rounded animate-fade-in">
              <Field label="Command">
                <input
                  type="text"
                  value={profile.command}
                  onChange={(e) => setProfile(service, { command: e.target.value })}
                  placeholder="D:\Git\whisper\venv\Scripts\python.exe D:\Git\whisper\src\stt_server.py"
                  className="input-style"
                />
              </Field>
              <Field label="Working Directory (선택)">
                <input
                  type="text"
                  value={profile.cwd}
                  onChange={(e) => setProfile(service, { cwd: e.target.value })}
                  placeholder="D:\Git\whisper\src"
                  className="input-style"
                />
              </Field>
              <Field label="환경변수 (선택, KEY=VALUE 한 줄씩)">
                <textarea
                  value={Object.entries(profile.env ?? {})
                    .map(([k, v]) => `${k}=${v}`).join('\n')}
                  onChange={(e) => {
                    const env: Record<string, string> = {}
                    for (const line of e.target.value.split('\n')) {
                      const idx = line.indexOf('=')
                      if (idx > 0) {
                        const k = line.slice(0, idx).trim()
                        const v = line.slice(idx + 1).trim()
                        if (k) env[k] = v
                      }
                    }
                    setProfile(service, { env })
                  }}
                  placeholder="OLLAMA_ORIGINS=*"
                  rows={2}
                  className="textarea-style text-xs"
                />
              </Field>
            </div>
          )}

          {/* Start/Stop buttons */}
          <div className="flex gap-2">
            {!running ? (
              <button
                onClick={handleStart}
                disabled={busy || !launcherOnline}
                className={`flex-1 py-1.5 rounded text-2xs font-mono uppercase tracking-wider
                            border transition-all
                            ${accent.border} ${accent.text} hover:bg-ink-850
                            disabled:border-ink-800 disabled:text-ink-600 disabled:cursor-not-allowed`}
              >
                {busy ? '...' : '▶ Start'}
              </button>
            ) : (
              <button
                onClick={handleStop}
                disabled={busy}
                className="flex-1 py-1.5 rounded text-2xs font-mono uppercase tracking-wider
                           border border-dead/40 text-dead hover:bg-dead/10
                           disabled:border-ink-800 disabled:text-ink-600 disabled:cursor-not-allowed"
              >
                {busy ? '...' : '■ Stop'}
              </button>
            )}
          </div>

          {!launcherOnline && (
            <div className="text-2xs font-mono text-wait">
              ⚠ 런처가 꺼져있음 — <code className="text-ink-300">python launcher.py</code>
            </div>
          )}
        </>
      )}

      {message && (
        <div className="text-2xs font-mono text-ink-400 animate-fade-in">{message}</div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-2xs font-mono text-ink-500 uppercase tracking-wider">
        {label}
      </label>
      {children}
    </div>
  )
}
