import { useState } from 'react'
import { useServerStore } from '../store/serverStore'
import { useLauncherRuntime } from '../store/launcherStore'
import {
  launcherStart, launcherStop, launcherInstallRole, launcherUninstallRole,
} from '../api/launcher'
import type { RoleKey } from '../types'

interface Props {
  role: RoleKey
}

const ACCENTS: Record<RoleKey, { text: string; bg: string; border: string }> = {
  stt: { text: 'text-stt', bg: 'bg-stt', border: 'border-stt/40' },
  tts: { text: 'text-tts', bg: 'bg-tts', border: 'border-tts/40' },
}

export default function RoleControl({ role }: Props) {
  const launcherUrl = useServerStore((s) => s.urls.launcher)
  const launcherOnline = useLauncherRuntime((s) => s.online)
  const roleStatus = useLauncherRuntime((s) => s.roles[role])

  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const accent = ACCENTS[role]

  const installed = roleStatus?.installed ?? false
  const installing = roleStatus?.installing ?? false
  const running = roleStatus?.process?.running ?? false
  const pid = roleStatus?.process?.pid
  const uptime = roleStatus?.process?.uptime

  const flash = (msg: string, ttl = 3000) => {
    setMessage(msg)
    setTimeout(() => setMessage(null), ttl)
  }

  const handleInstall = async () => {
    setBusy(true)
    try {
      await launcherInstallRole(launcherUrl, role)
      flash('▶ 설치 시작 — Roles 페이지에서 진행 확인')
    } catch (e: any) {
      flash(`✗ ${e.message}`, 5000)
    } finally { setBusy(false) }
  }

  const handleUninstall = async () => {
    if (!confirm(`${role.toUpperCase()} 역할을 제거하시겠습니까? venv 폴더가 삭제됩니다.`)) return
    setBusy(true)
    try {
      await launcherUninstallRole(launcherUrl, role)
      flash('■ 제거됨')
    } catch (e: any) {
      flash(`✗ ${e.message}`, 5000)
    } finally { setBusy(false) }
  }

  const handleStart = async () => {
    setBusy(true)
    try {
      const r = await launcherStart(launcherUrl, role)
      flash(r.ok ? `▶ pid ${r.status?.pid}` : `✗ ${r.error}`, r.ok ? 3000 : 5000)
    } finally { setBusy(false) }
  }

  const handleStop = async () => {
    setBusy(true)
    try {
      const r = await launcherStop(launcherUrl, role)
      flash(r.ok ? '■ stopped' : `✗ ${r.error}`, r.ok ? 3000 : 5000)
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-2xs font-mono text-ink-500 uppercase tracking-wider">Role</span>
        <div className="flex items-center gap-1.5 text-2xs font-mono">
          {installing ? (
            <span className="text-wait">installing...</span>
          ) : !installed ? (
            <span className="text-ink-500">not installed</span>
          ) : running ? (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-live dot-live animate-pulse-slow" />
              <span className="text-ink-200 tabular-nums">pid {pid} · {uptime?.toFixed(0)}s</span>
            </>
          ) : (
            <span className="text-ink-400">installed · stopped</span>
          )}
        </div>
      </div>

      {!launcherOnline ? (
        <div className="text-2xs font-mono text-wait py-2">
          ⚠ 런처 오프라인 — install.ps1 실행 후 start.ps1 실행
        </div>
      ) : !installed ? (
        <button
          onClick={handleInstall}
          disabled={busy || installing}
          className={`w-full py-1.5 rounded text-2xs font-mono uppercase tracking-wider
                      border ${accent.border} ${accent.text} hover:bg-ink-850
                      disabled:border-ink-800 disabled:text-ink-600 disabled:cursor-not-allowed`}
        >
          {installing ? 'installing...' : `▶ Install ${role.toUpperCase()} role`}
        </button>
      ) : (
        <div className="flex gap-2">
          {running ? (
            <button onClick={handleStop} disabled={busy}
                    className="flex-1 py-1.5 rounded text-2xs font-mono uppercase tracking-wider
                               border border-dead/40 text-dead hover:bg-dead/10
                               disabled:border-ink-800 disabled:text-ink-600">
              ■ Stop
            </button>
          ) : (
            <button onClick={handleStart} disabled={busy}
                    className={`flex-1 py-1.5 rounded text-2xs font-mono uppercase tracking-wider
                                border ${accent.border} ${accent.text} hover:bg-ink-850
                                disabled:border-ink-800 disabled:text-ink-600`}>
              ▶ Start
            </button>
          )}
          <button onClick={handleUninstall} disabled={busy || running}
                  title="venv 삭제"
                  className="px-2.5 py-1.5 rounded text-2xs font-mono uppercase tracking-wider
                             border border-ink-700 text-ink-500 hover:text-ink-300
                             disabled:opacity-50 disabled:cursor-not-allowed">
            ⊘
          </button>
        </div>
      )}

      {message && <div className="text-2xs font-mono text-ink-400 animate-fade-in">{message}</div>}
    </div>
  )
}
