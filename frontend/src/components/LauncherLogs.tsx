import { useEffect, useMemo, useRef, useState } from 'react'
import { useServerStore } from '../store/serverStore'
import { useLauncherRuntime } from '../store/launcherStore'
import { launcherGetLogs, launcherClearLogs, launcherInstallLogs } from '../api/launcher'
import type { RoleKey, LauncherLogLine } from '../types'

interface Props {
  role: RoleKey
  source?: 'process' | 'install'
  tail?: number
  pollMs?: number
  height?: string
}

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'launcher' | 'plain'

interface ParsedLine {
  t: number
  stream: 'out' | 'err'
  level: LogLevel
  timestamp: string | null
  message: string
}

const PY_LOG_RE = /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)\s*\[?(DEBUG|INFO|WARNING|WARN|ERROR|CRITICAL|FATAL)\]?\s*(.*)$/
const LAUNCHER_RE = /^\[launcher\]\s*(.*)$/
const SIMPLE_LEVEL_RE = /^(WARNING|ERROR|DEBUG|INFO|CRITICAL|FATAL):\s*(.*)$/
const PY_WARN_RE = /^.*?(UserWarning|DeprecationWarning|FutureWarning|RuntimeWarning):\s*(.*)$/

function parseLogLine(line: LauncherLogLine, stream: 'out' | 'err'): ParsedLine {
  const text = line.line ?? ''
  const m1 = text.match(LAUNCHER_RE)
  if (m1) return { t: line.t, stream, level: 'launcher', timestamp: null, message: m1[1] }
  const m2 = text.match(PY_LOG_RE)
  if (m2) {
    const lvl = m2[2].toUpperCase()
    let level: LogLevel = 'info'
    if (lvl === 'WARNING' || lvl === 'WARN') level = 'warn'
    else if (lvl === 'ERROR' || lvl === 'CRITICAL' || lvl === 'FATAL') level = 'error'
    else if (lvl === 'DEBUG') level = 'debug'
    return { t: line.t, stream, level, timestamp: m2[1], message: m2[3] }
  }
  const m3 = text.match(SIMPLE_LEVEL_RE)
  if (m3) {
    const lvl = m3[1].toUpperCase()
    let level: LogLevel = 'info'
    if (lvl === 'WARNING') level = 'warn'
    else if (lvl === 'ERROR' || lvl === 'CRITICAL' || lvl === 'FATAL') level = 'error'
    else if (lvl === 'DEBUG') level = 'debug'
    return { t: line.t, stream, level, timestamp: null, message: m3[2] }
  }
  if (PY_WARN_RE.test(text))
    return { t: line.t, stream, level: 'warn', timestamp: null, message: text }
  return { t: line.t, stream, level: 'plain', timestamp: null, message: text }
}

const LEVEL_STYLES: Record<LogLevel, { tag: string; tagText: string; text: string }> = {
  debug:    { tag: 'DBG', tagText: 'text-logdebug', text: 'text-ink-400' },
  info:     { tag: 'INF', tagText: 'text-loginfo',  text: 'text-ink-200' },
  warn:     { tag: 'WRN', tagText: 'text-logwarn',  text: 'text-ink-100' },
  error:    { tag: 'ERR', tagText: 'text-logerror', text: 'text-logerror' },
  launcher: { tag: 'LCR', tagText: 'text-ink-400',  text: 'text-ink-300' },
  plain:    { tag: '   ', tagText: 'text-ink-600',  text: 'text-ink-300' },
}

export default function LauncherLogs({
  role, source = 'process', tail = 200, pollMs = 2000, height = 'h-72',
}: Props) {
  const launcherUrl = useServerStore((s) => s.urls.launcher)
  const launcherOnline = useLauncherRuntime((s) => s.online)
  const [stdout, setStdout] = useState<LauncherLogLine[]>([])
  const [stderr, setStderr] = useState<LauncherLogLine[]>([])
  const [filter, setFilter] = useState<'all' | 'warn+' | 'error'>('all')
  const [autoScroll, setAutoScroll] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!launcherOnline) return
    let stopped = false
    const tick = async () => {
      try {
        if (source === 'process') {
          const logs = await launcherGetLogs(launcherUrl, role, tail)
          if (!stopped) {
            setStdout(logs.stdout)
            setStderr(logs.stderr)
          }
        } else {
          const logs = await launcherInstallLogs(launcherUrl, role, tail)
          if (!stopped) {
            setStdout(logs.logs)
            setStderr([])
          }
        }
      } catch {}
    }
    tick()
    const id = setInterval(tick, pollMs)
    return () => { stopped = true; clearInterval(id) }
  }, [launcherUrl, role, source, tail, pollMs, launcherOnline])

  const parsed: ParsedLine[] = useMemo(() => {
    const all = [
      ...stdout.map((l) => parseLogLine(l, 'out')),
      ...stderr.map((l) => parseLogLine(l, 'err')),
    ]
    return all.sort((a, b) => a.t - b.t)
  }, [stdout, stderr])

  const filtered = useMemo(() => {
    if (filter === 'all') return parsed
    if (filter === 'error') return parsed.filter((l) => l.level === 'error')
    return parsed.filter((l) => l.level === 'warn' || l.level === 'error')
  }, [parsed, filter])

  const counts = useMemo(() => {
    const c = { info: 0, warn: 0, error: 0 }
    for (const l of parsed) {
      if (l.level === 'warn') c.warn++
      else if (l.level === 'error') c.error++
      else c.info++
    }
    return c
  }, [parsed])

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [filtered, autoScroll])

  const handleClear = async () => {
    if (source !== 'process') return
    try {
      await launcherClearLogs(launcherUrl, role)
      setStdout([]); setStderr([])
    } catch {}
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <span className="text-2xs font-mono text-ink-400 uppercase tracking-wider">
            {source === 'process' ? 'Server Output' : 'Install Log'}
          </span>
          <div className="flex items-center gap-2 text-2xs font-mono">
            <span className="flex items-center gap-1 text-loginfo">
              <span className="h-1.5 w-1.5 rounded-full bg-loginfo" />{counts.info}
            </span>
            <span className="flex items-center gap-1 text-logwarn">
              <span className="h-1.5 w-1.5 rounded-full bg-logwarn" />{counts.warn}
            </span>
            <span className="flex items-center gap-1 text-logerror">
              <span className="h-1.5 w-1.5 rounded-full bg-logerror" />{counts.error}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-0.5 p-0.5 bg-ink-900 border border-ink-800 rounded">
            {(['all', 'warn+', 'error'] as const).map((c) => (
              <button key={c} onClick={() => setFilter(c)}
                      className={`px-2 py-0.5 text-[0.625rem] font-mono uppercase tracking-wider rounded transition-all
                        ${filter === c ? 'bg-ink-700 text-ink-100' : 'text-ink-500 hover:text-ink-300'}`}>
                {c}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-2xs font-mono text-ink-500 cursor-pointer">
            <input type="checkbox" checked={autoScroll}
                   onChange={(e) => setAutoScroll(e.target.checked)}
                   className="accent-ink-300" />
            scroll
          </label>
          {source === 'process' && (
            <button onClick={handleClear}
                    className="text-2xs font-mono text-ink-500 hover:text-ink-200 uppercase tracking-wider">
              clear
            </button>
          )}
        </div>
      </div>

      <div ref={scrollRef}
           className={`${height} overflow-auto bg-ink-950 border border-ink-800 rounded p-2
                      text-[0.7rem] font-mono leading-relaxed`}>
        {filtered.length === 0 ? (
          <div className="text-ink-600 text-center py-12 text-2xs uppercase tracking-wider">
            {launcherOnline
              ? (parsed.length > 0 ? 'no entries match filter' : 'no output yet')
              : 'launcher offline'}
          </div>
        ) : (
          filtered.map((l, i) => {
            const style = LEVEL_STYLES[l.level]
            return (
              <div key={i} className="flex items-start gap-2 px-1 py-0.5 hover:bg-ink-900/60 rounded">
                <span className={`shrink-0 ${style.tagText} tabular-nums`}>
                  {style.tag}
                </span>
                <span className="text-ink-700 shrink-0 tabular-nums">
                  {l.timestamp ? l.timestamp.split(' ')[1].slice(0, 8) : formatTime(l.t)}
                </span>
                <span className={`break-all whitespace-pre-wrap ${style.text}`}>
                  {l.message || ' '}
                </span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function formatTime(t: number): string {
  const d = new Date(t * 1000)
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, '0')).join(':')
}
