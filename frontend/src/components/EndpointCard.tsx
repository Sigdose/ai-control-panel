import { useState } from 'react'
import StatusDot from './StatusDot'
import { useServerStore, useHealthStore } from '../store/serverStore'
import type { ServiceKey } from '../types'

interface EndpointCardProps {
  service: ServiceKey
  accent: string // e.g. 'text-stt', 'border-stt/30'
  hint?: string
}

const ACCENTS: Record<ServiceKey, { text: string; border: string; ring: string }> = {
  stt: { text: 'text-stt', border: 'border-stt/30', ring: 'focus:ring-stt/40' },
  llm: { text: 'text-llm', border: 'border-llm/30', ring: 'focus:ring-llm/40' },
  tts: { text: 'text-tts', border: 'border-tts/30', ring: 'focus:ring-tts/40' },
}

const HINTS: Record<ServiceKey, string> = {
  stt: 'faster-whisper · :5001',
  llm: 'Ollama · :11434',
  tts: 'chatterbox · :5002',
}

export default function EndpointCard({ service, hint }: EndpointCardProps) {
  const url = useServerStore((s) => s.urls[service])
  const setUrl = useServerStore((s) => s.setUrl)
  const status = useHealthStore((s) => s.status[service])
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(url)

  const accent = ACCENTS[service]
  const dotState = status.online ? 'live' : status.lastCheck ? 'dead' : 'wait'

  const commit = () => {
    setUrl(service, draft.trim() || url)
    setEditing(false)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StatusDot state={dotState} />
          <span className="text-2xs font-mono text-ink-400 uppercase tracking-wider">
            Endpoint
          </span>
        </div>
        <span className="text-2xs font-mono text-ink-500 tabular-nums uppercase tracking-wider">
          {status.online ? 'online' : status.error ? 'offline' : '...'}
        </span>
      </div>

      {editing ? (
        <div className="flex gap-1">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') {
                setDraft(url)
                setEditing(false)
              }
            }}
            autoFocus
            className={`flex-1 px-2.5 py-1.5 text-xs font-mono bg-ink-900 border ${accent.border}
                       text-ink-100 rounded focus:outline-none focus:ring-1 ${accent.ring}`}
          />
          <button
            onClick={commit}
            className="px-2 text-2xs font-mono text-ink-300 hover:text-ink-100 uppercase"
          >
            OK
          </button>
        </div>
      ) : (
        <button
          onClick={() => {
            setDraft(url)
            setEditing(true)
          }}
          className="w-full text-left px-2.5 py-1.5 text-xs font-mono bg-ink-900/60 border border-ink-800
                     text-ink-200 rounded hover:border-ink-700 transition-colors truncate"
        >
          {url}
        </button>
      )}

      <div className="text-2xs font-mono text-ink-500">
        {hint ?? HINTS[service]}
      </div>
    </div>
  )
}
