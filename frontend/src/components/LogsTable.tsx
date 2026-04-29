export interface LogColumn<T> {
  key: keyof T | string
  label: string
  width?: string
  render?: (row: T) => React.ReactNode
  className?: string
}

interface LogsTableProps<T> {
  logs: T[]
  columns: LogColumn<T>[]
  emptyText?: string
  maxHeight?: string
  onClear?: () => void
}

export default function LogsTable<T extends Record<string, any>>({
  logs, columns, emptyText = '로그 없음', maxHeight = '320px', onClear,
}: LogsTableProps<T>) {
  return (
    <div className="border border-ink-800 rounded-md bg-ink-900/40">
      <div className="flex items-center justify-between px-3 py-2 border-b border-ink-800">
        <div className="flex items-baseline gap-3">
          <span className="text-2xs font-mono text-ink-400 uppercase tracking-wider">Request Log</span>
          <span className="text-2xs font-mono text-ink-500 tabular-nums">{logs.length} entries</span>
        </div>
        {onClear && logs.length > 0 && (
          <button onClick={onClear}
                  className="text-2xs font-mono text-ink-500 hover:text-ink-200 uppercase tracking-wider">
            Clear
          </button>
        )}
      </div>
      <div className="overflow-auto" style={{ maxHeight }}>
        {logs.length === 0 ? (
          <div className="px-3 py-8 text-center text-2xs font-mono text-ink-500 uppercase tracking-wider">
            {emptyText}
          </div>
        ) : (
          <table className="w-full text-xs font-mono">
            <thead className="sticky top-0 bg-ink-900 border-b border-ink-800">
              <tr>
                {columns.map((c) => (
                  <th key={String(c.key)}
                      className="text-left px-3 py-2 text-ink-500 font-medium text-2xs uppercase tracking-wider"
                      style={{ width: c.width }}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map((row, i) => (
                <tr key={i} className="border-b border-ink-850 hover:bg-ink-850/50 transition-colors">
                  {columns.map((c) => (
                    <td key={String(c.key)}
                        className={`px-3 py-2 text-ink-200 tabular-nums ${c.className ?? ''}`}>
                      {c.render ? c.render(row) : String(row[c.key as string] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
