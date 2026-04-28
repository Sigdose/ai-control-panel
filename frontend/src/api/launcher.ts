import type { LauncherStatus, LauncherLogs, ServiceKey } from '../types'

export async function launcherHealth(baseUrl: string, signal?: AbortSignal) {
  const res = await fetch(`${baseUrl}/health`, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function launcherListServices(
  baseUrl: string,
  signal?: AbortSignal,
): Promise<Record<ServiceKey, LauncherStatus>> {
  const res = await fetch(`${baseUrl}/services`, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function launcherStart(
  baseUrl: string,
  opts: {
    service: ServiceKey
    command: string
    cwd?: string
    env?: Record<string, string>
  },
): Promise<{ ok: boolean; status?: LauncherStatus; error?: string }> {
  const res = await fetch(`${baseUrl}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  })
  const data = await res.json()
  if (!res.ok) {
    // 409 (already running)은 의미 있게 전달
    return { ok: false, error: data.error ?? `HTTP ${res.status}` }
  }
  return data
}

export async function launcherStop(
  baseUrl: string,
  service: ServiceKey,
  timeout = 8,
): Promise<{ ok: boolean; status?: LauncherStatus; error?: string }> {
  const res = await fetch(`${baseUrl}/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ service, timeout }),
  })
  const data = await res.json()
  if (!res.ok) return { ok: false, error: data.error ?? `HTTP ${res.status}` }
  return data
}

export async function launcherGetLogs(
  baseUrl: string,
  service: ServiceKey,
  tail = 100,
): Promise<LauncherLogs> {
  const res = await fetch(`${baseUrl}/logs/${service}?tail=${tail}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function launcherClearLogs(baseUrl: string, service: ServiceKey) {
  const res = await fetch(`${baseUrl}/logs/${service}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}
