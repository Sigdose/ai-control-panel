import { useEffect, useMemo, useRef, useState } from 'react'
import { useLauncherStore, useLauncherRuntime } from '../store/launcherStore'
import { launcherGetLogs, launcherClearLogs } from '../api/launcher'
import type { ServiceKey, LauncherLogLine } from '../types'

interface Props {
  service: ServiceKey
  tail?: number
  pollMs?: number
}

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'launcher' | 'plain'

interface ParsedLine {
  t: number
  stream: 'out' | 'err'
  level: LogLevel
  timestamp: string | null   // 파싱된 타임스탬프 (있으면)
  message: string
  raw: string
}

// Python logging 표준: "2026-04-22 16:49:31,246 [INFO] message..."
const PY_LOG_RE = /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)\s*\[?(DEBUG|INFO|WARNING|WARN|ERROR|CRITICAL|FATAL)\]?\s*(.*)$/

// "[launcher] ..." 같은 런처 자체 메시지
const LAUNCHER_RE = /^\[launcher\]\s*(.*)$/

// Werkzeug "WARNING:..." 류
const SIMPLE_LEVEL_RE = /^(WARNING|ERROR|DEBUG|INFO|CRITICAL|FATAL):\s*(.*)$/

// "UserWarning:" 같은 단순 경고
const PY_WARN_RE = /^.*?(UserWarning|DeprecationWarning|FutureWarning|RuntimeWarning):\s*(.*)$/

function parseLogLine(line: LauncherLogLine, stream: 'out' | 'err'): ParsedLine {
  const text = line.line ?? ''

  // 1. 런처 자체 메시지
  const m1 = text.match(LAUNCHER_RE)
  if (m1) {
    return {
      t: line.t, stream, level: 'launcher',
      timestamp: null, message: m1[1], raw: text,
    }
  }

  // 2. Python 표준 로깅
  const m2 = text.match(PY_LOG_RE)
  if (m2) {
    const lvl = m2[2].toUpperCase()
    let level: LogLevel = 'info'
    if (lvl === 'WARNING' || lvl === 'WARN') level = 'warn'
    else if (lvl === 'ERROR' || lvl === 'CRITICAL' || lvl === 'FATAL') level = 'error'
    else if (lvl === 'DEBUG') level = 'debug'
    return {
      t: line.t, stream, level,
      timestamp: m2[1], message: m2[3], raw: text,
    }
  }

  // 3. "WARNING: ..." 같은 단순 prefix
  const m3 = text.match(SIMPLE_LEVEL_RE)
  if (m3) {
    const lvl = m3[1].toUpperCase()
    let level: LogLevel = 'info'
    if (lvl === 'WARNING') level = 'warn'
    else if (lvl === 'ERROR' || lvl === 'CRITICAL' || lvl === 'FATAL') level = 'error'
    else if (lvl === 'DEBUG') level = 'debug'
    return {
      t: line.t, stream, level,
      timestamp: null, message: m3[2], raw: text,
    }
  }

  // 4. UserWarning 류 (실제 에러 아님 → warn으로 분류)
  if (PY_WARN_RE.test(text)) {
    return { t: line.t, stream, level: 'warn', timestamp: null, message: text, raw: text }
  }

  // 5. stderr인데 위 패턴 다 안 맞으면 → 사실 INFO일 가능성 큼 (stderr에 그냥 출력된 경우)
  // 그래도 보수적으로 "plain"으로 분류해서 색상은 중립
  return { t: line.t, stream, level: 'plain', timestamp: null, message: text, raw: text }
}

const LEVEL_STYLES: Record<LogLevel, { dot: string; text: string; tag: string; tagText: string }> = {
  debug:    { dot: 'bg-logdebug',  text: 'text-ink-400',  tag: 'DBG', tagText: 'text-logdebug' },
  info:     { dot: 'bg-loginfo',   text: 'text-ink-200',  tag: 'INF', tagText: 'text-loginfo' },
  warn:     { dot: 'bg-logwarn',   text: 'text-ink-100',  tag: 'WRN', tagText: 'text-logwarn' },
  error:    { dot: 'bg-logerror',  text: 'text-logerror', tag: 'ERR', tagText: 'text-logerror' },
  launcher: { dot: 'bg-ink-400',   text: 'text-ink-300',  tag: 'LCR', tagText: 'text-ink-400' },
  plain:    { dot: 'bg-ink-700',   text: 'text-ink-300',  tag: '   ', tagText: 'text-ink-600' },
}

export default function LauncherLogs({ service, tail = 200, pollMs = 2000 }: Props) {
  const launcherUrl = useLauncherStore((s) => s.launcherUrl)
  const launcherOnline = useLauncherRuntime((s) => s.launcherOnline)
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
        const logs = await launcherGetLogs(launcherUrl, service, tail)
        if (!stopped) {
          setStdout(logs.stdout)
          setStderr(logs.stderr)
        }
      } catch {}
    }
    tick()
    const id = setInterval(tick, pollMs)
    return () => { stopped = true; clearInterval(id) }
  }, [launcherUrl, service, tail, pollMs, launcherOnline])

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
    // warn+
    return parsed.filter((l) => l.level === 'warn' || l.level === 'error')
  }, [parsed, filter])

  // 카운트
  const counts = useMemo(() => {
    const c = { info: 0, warn: 0, error: 0 }
    for (const l of parsed) {
      if (l.level === 'info' || l.level === 'launcher' || l.level === 'plain' || l.level === 'debug') c.info++
      else if (l.level === 'warn') c.warn++
      else if (l.level === 'error') c.error++
    }
    return c
  }, [parsed])

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [filtered, autoScroll])

  const handleClear = async () => {
    try {
      await launcherClearLogs(launcherUrl, service)
      setStdout([]); setStderr([])
    } catch {}
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <span className="text-2xs font-mono text-ink-400 uppercase tracking-wider">
            Launcher Output
          </span>
          {/* 카운트 뱃지 */}
          <div className="flex items-center gap-2 text-2xs font-mono">
            <span className="flex items-center gap-1 text-loginfo">
              <span className="h-1.5 w-1.5 rounded-full bg-loginfo" />
              {counts.info}
            </span>
            <span className="flex items-center gap-1 text-logwarn">
              <span className="h-1.5 w-1.5 rounded-full bg-logwarn" />
              {counts.warn}
            </span>
            <span className="flex items-center gap-1 text-logerror">
              <span className="h-1.5 w-1.5 rounded-full bg-logerror" />
              {counts.error}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* 필터 */}
          <div className="flex gap-0.5 p-0.5 bg-ink-900 border border-ink-800 rounded">
            {(['all', 'warn+', 'error'] as const).map((c) => (
              <button
                key={c}
                onClick={() => setFilter(c)}
                className={`px-2 py-0.5 text-[0.625rem] font-mono uppercase tracking-wider rounded transition-all
                  ${filter === c ? 'bg-ink-700 text-ink-100' : 'text-ink-500 hover:text-ink-300'}`}
              >
                {c}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-2xs font-mono text-ink-500 cursor-pointer">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="accent-ink-300"
            />
            scroll
          </label>
          <button
            onClick={handleClear}
            className="text-2xs font-mono text-ink-500 hover:text-ink-200 uppercase tracking-wider"
          >
            clear
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="h-72 overflow-auto bg-ink-950 border border-ink-800 rounded p-2
                   text-[0.7rem] font-mono leading-relaxed"
      >
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
              <div
                key={i}
                className="flex items-start gap-2 px-1 py-0.5 hover:bg-ink-900/60 rounded transition-colors"
              >
                <span className={`shrink-0 ${style.tagText} tabular-nums`} title={`stream: ${l.stream}`}>
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
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}
