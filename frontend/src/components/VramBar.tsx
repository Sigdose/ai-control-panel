import type { VramInfo } from '../types'

interface VramBarProps {
  vram: VramInfo | null
  accent?: string // tailwind color class e.g. 'bg-stt'
  compact?: boolean
}

export default function VramBar({ vram, accent = 'bg-ink-300', compact = false }: VramBarProps) {
  if (!vram || vram.total === 0) {
    return (
      <div className="text-2xs font-mono text-ink-500 uppercase tracking-wider">
        VRAM ─ N/A
      </div>
    )
  }

  const pct = Math.min(100, (vram.reserved / vram.total) * 100)
  const usedPct = Math.min(100, (vram.used / vram.total) * 100)

  return (
    <div className={compact ? 'space-y-1' : 'space-y-1.5'}>
      <div className="flex justify-between items-baseline text-2xs font-mono uppercase tracking-wider">
        <span className="text-ink-400">VRAM</span>
        <span className="text-ink-200 tabular-nums">
          {vram.used.toFixed(1)}<span className="text-ink-500">/{vram.total.toFixed(1)} GB</span>
        </span>
      </div>
      <div className="relative h-1 bg-ink-800 rounded-full overflow-hidden">
        {/* reserved (faint) */}
        <div
          className="absolute inset-y-0 left-0 bg-ink-700"
          style={{ width: `${pct}%` }}
        />
        {/* used (bright) */}
        <div
          className={`absolute inset-y-0 left-0 ${accent} transition-all duration-500`}
          style={{ width: `${usedPct}%` }}
        />
      </div>
      {!compact && vram.device && (
        <div className="text-2xs font-mono text-ink-500 truncate">{vram.device}</div>
      )}
    </div>
  )
}
