import type { RoleKey, RoleStatus, LauncherSystemInfo, LauncherLogLine } from '../types'

export async function launcherHealth(baseUrl: string, signal?: AbortSignal) {
  const r = await fetch(`${baseUrl}/health`, { signal })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

export async function launcherSystem(baseUrl: string, signal?: AbortSignal): Promise<LauncherSystemInfo> {
  const r = await fetch(`${baseUrl}/system`, { signal })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

export async function launcherRoles(baseUrl: string, signal?: AbortSignal): Promise<Record<RoleKey, RoleStatus>> {
  const r = await fetch(`${baseUrl}/roles`, { signal })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

export async function launcherInstallRole(baseUrl: string, role: RoleKey) {
  const r = await fetch(`${baseUrl}/roles/install`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  })
  const data = await r.json()
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
  return data
}

export async function launcherUninstallRole(baseUrl: string, role: RoleKey) {
  const r = await fetch(`${baseUrl}/roles/uninstall`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  })
  const data = await r.json()
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
  return data
}

export async function launcherInstallLogs(
  baseUrl: string, role: RoleKey, tail = 200,
): Promise<{ logs: LauncherLogLine[]; in_progress: boolean }> {
  const r = await fetch(`${baseUrl}/install-logs/${role}?tail=${tail}`)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

export async function launcherStart(baseUrl: string, role: RoleKey) {
  const r = await fetch(`${baseUrl}/start`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ service: role }),
  })
  const data = await r.json()
  if (!r.ok) return { ok: false, error: data.error || `HTTP ${r.status}` }
  return data
}

export async function launcherStop(baseUrl: string, role: RoleKey) {
  const r = await fetch(`${baseUrl}/stop`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ service: role }),
  })
  const data = await r.json()
  if (!r.ok) return { ok: false, error: data.error || `HTTP ${r.status}` }
  return data
}

export async function launcherGetLogs(
  baseUrl: string, role: RoleKey, tail = 100,
): Promise<{ stdout: LauncherLogLine[]; stderr: LauncherLogLine[]; running: boolean }> {
  const r = await fetch(`${baseUrl}/logs/${role}?tail=${tail}`)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

export async function launcherClearLogs(baseUrl: string, role: RoleKey) {
  const r = await fetch(`${baseUrl}/logs/${role}`, { method: 'DELETE' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}
