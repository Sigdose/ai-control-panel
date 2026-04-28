interface PageHeaderProps {
  shortcut: string
  title: string
  subtitle?: string
  accent?: string // 'text-stt' | 'text-llm' | 'text-tts'
  right?: React.ReactNode
}

export default function PageHeader({
  shortcut,
  title,
  subtitle,
  accent = 'text-ink-100',
  right,
}: PageHeaderProps) {
  return (
    <div className="flex items-end justify-between border-b border-ink-800 px-8 py-6">
      <div>
        <div className={`text-2xs font-mono uppercase tracking-[0.2em] ${accent}`}>
          {shortcut}
        </div>
        <h1 className="mt-2 text-3xl font-medium tracking-tight text-ink-100">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 text-sm text-ink-400">{subtitle}</p>
        )}
      </div>
      {right && <div>{right}</div>}
    </div>
  )
}
