import { NavLink } from 'react-router-dom'
import StatusDot from './StatusDot'
import { useHealthStore } from '../store/serverStore'
import { useLauncherRuntime } from '../store/launcherStore'
import type { ServiceKey } from '../types'

const NAV_ITEMS: Array<{
  to: string
  label: string
  service?: ServiceKey
  accent?: string
  shortcut: string
}> = [
  { to: '/',        label: 'Overview', shortcut: '00' },
  { to: '/stt',     label: 'STT',     service: 'stt', accent: 'text-stt', shortcut: '01' },
  { to: '/llm',     label: 'LLM',     service: 'llm', accent: 'text-llm', shortcut: '02' },
  { to: '/tts',     label: 'TTS',     service: 'tts', accent: 'text-tts', shortcut: '03' },
  { to: '/install', label: 'Install', shortcut: '04' },
]

export default function Sidebar() {
  const status = useHealthStore((s) => s.status)
  const launcherOnline = useLauncherRuntime((s) => s.launcherOnline)

  return (
    <aside className="w-56 shrink-0 border-r border-ink-800 bg-ink-900/40 flex flex-col">
      {/* Brand */}
      <div className="px-5 py-5 border-b border-ink-800">
        <div className="flex items-center gap-2.5">
          <div className="flex gap-0.5">
            <span className="h-1.5 w-1.5 rounded-full bg-stt"></span>
            <span className="h-1.5 w-1.5 rounded-full bg-llm"></span>
            <span className="h-1.5 w-1.5 rounded-full bg-tts"></span>
          </div>
          <span className="text-sm font-medium tracking-tight text-ink-100">
            AI Control Panel
          </span>
        </div>
        <div className="mt-1 text-2xs font-mono text-ink-500 uppercase tracking-widest">
          v0.1 · local
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-4 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const svcStatus = item.service ? status[item.service] : null
          const dotState = !item.service
            ? null
            : svcStatus?.online
            ? 'live'
            : svcStatus?.lastCheck
            ? 'dead'
            : 'wait'

          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `group flex items-center justify-between px-3 py-2 rounded text-sm transition-all
                 ${
                   isActive
                     ? 'bg-ink-800 text-ink-100'
                     : 'text-ink-400 hover:text-ink-200 hover:bg-ink-850'
                 }`
              }
            >
              <div className="flex items-center gap-3">
                <span className={`text-2xs font-mono ${item.accent ?? 'text-ink-500'}`}>
                  {item.shortcut}
                </span>
                <span>{item.label}</span>
              </div>
              {dotState && <StatusDot state={dotState} />}
            </NavLink>
          )
        })}
      </nav>

      {/* Footer status */}
      <div className="px-4 py-3 border-t border-ink-800 space-y-1.5">
        {(['stt', 'llm', 'tts'] as ServiceKey[]).map((svc) => {
          const s = status[svc]
          return (
            <div key={svc} className="flex items-center justify-between text-2xs font-mono">
              <span className="text-ink-500 uppercase tracking-wider">{svc}</span>
              <span className={`uppercase tracking-wider ${s.online ? 'text-live' : 'text-ink-600'}`}>
                {s.online ? 'on' : '──'}
              </span>
            </div>
          )
        })}
        <div className="flex items-center justify-between text-2xs font-mono pt-1.5 border-t border-ink-850">
          <span className="text-ink-500 uppercase tracking-wider flex items-center gap-1.5">
            <StatusDot state={launcherOnline ? 'live' : 'dead'} />
            launcher
          </span>
          <span className="text-ink-500 tabular-nums">:5000</span>
        </div>
      </div>
    </aside>
  )
}
