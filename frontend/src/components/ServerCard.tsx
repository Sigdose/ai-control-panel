import { Link } from 'react-router-dom'
import { useHealthStore } from '../store/serverStore'
import EndpointCard from './EndpointCard'
import VramBar from './VramBar'
import type { ServiceKey, VramInfo } from '../types'

interface Props {
  service: ServiceKey
  title: string
  subtitle: string
  shortcut: string
  to: string
}

const ACCENTS: Record<ServiceKey, { text: string; bg: string; border: string }> = {
  stt: { text: 'text-stt', bg: 'bg-stt', border: 'border-stt/20' },
  llm: { text: 'text-llm', bg: 'bg-llm', border: 'border-llm/20' },
  tts: { text: 'text-tts', bg: 'bg-tts', border: 'border-tts/20' },
}

function extractMeta(service: ServiceKey, raw: any): { label: string; value: string }[] {
  if (!raw) return []
  if (service === 'stt') {
    const m = raw.model ?? {}
    return [
      { label: 'Model', value: m.size ?? '─' },
      { label: 'Compute', value: m.compute_type ?? '─' },
      { label: 'Device', value: m.device ?? '─' },
    ]
  }
  if (service === 'llm') {
    const count = raw.models?.length ?? 0
    const first = raw.models?.[0]?.name ?? '─'
    return [
      { label: 'Models', value: String(count) },
      { label: 'Default', value: first.length > 22 ? first.slice(0, 22) + '…' : first },
    ]
  }
  if (service === 'tts') {
    const s = raw.settings ?? raw
    return [
      { label: 'Lang', value: s.language ?? '─' },
      { label: 'Voice', value: s.audio_prompt ? '커스텀' : '기본' },
      { label: 'Voices', value: String(raw.voice_count ?? '─') },
    ]
  }
  return []
}

function extractVram(service: ServiceKey, raw: any): VramInfo | null {
  if (!raw) return null
  if (service === 'stt' && raw.vram) return raw.vram
  if (service === 'tts' && raw.vram) return raw.vram
  return null
}

export default function ServerCard({ service, title, subtitle, shortcut, to }: Props) {
  const status = useHealthStore((s) => s.status[service])
  const accent = ACCENTS[service]
  const meta = extractMeta(service, status.raw)
  const vram = extractVram(service, status.raw)

  return (
    <div className={`relative flex flex-col bg-ink-900/60 border ${accent.border} rounded-lg
                    p-5 backdrop-blur-sm card-glow transition-all`}>
      <div className={`absolute top-0 left-5 right-5 h-px ${accent.bg} opacity-60`} />

      <div className="flex items-start justify-between mb-5">
        <div>
          <div className={`text-2xs font-mono uppercase tracking-[0.2em] ${accent.text}`}>{shortcut}</div>
          <h2 className="mt-1.5 text-2xl font-medium tracking-tight text-ink-100">{title}</h2>
          <p className="mt-0.5 text-2xs font-mono text-ink-500 uppercase tracking-wider">{subtitle}</p>
        </div>
      </div>

      <EndpointCard service={service} />

      {meta.length > 0 && (
        <div className="mt-5 pt-4 border-t border-ink-800 space-y-1.5">
          {meta.map((m) => (
            <div key={m.label} className="flex justify-between items-baseline text-xs font-mono">
              <span className="text-ink-500 uppercase tracking-wider text-2xs">{m.label}</span>
              <span className="text-ink-200 truncate ml-3">{m.value}</span>
            </div>
          ))}
        </div>
      )}

      {vram && (
        <div className="mt-4 pt-4 border-t border-ink-800">
          <VramBar vram={vram} accent={accent.bg} compact />
        </div>
      )}

      <div className="flex-1" />
      <Link to={to}
            className={`mt-5 block text-center px-3 py-2 rounded text-xs font-mono uppercase tracking-wider
                        border ${accent.border} ${accent.text} hover:bg-ink-850 transition-colors`}>
        Open {title} →
      </Link>
    </div>
  )
}
