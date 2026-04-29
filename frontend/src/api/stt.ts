import type { SttSettings, SttResult, SttLog } from '../types'

export async function sttHealth(baseUrl: string, signal?: AbortSignal) {
  const r = await fetch(`${baseUrl}/health`, { signal })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

export async function sttGetSettings(baseUrl: string): Promise<{
  settings: SttSettings; available_models: string[]; available_langs: string[]; compute_types: string[]
}> {
  const r = await fetch(`${baseUrl}/settings`)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

export async function sttSaveSettings(baseUrl: string, s: Partial<SttSettings>) {
  const r = await fetch(`${baseUrl}/settings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(s),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

export async function sttTranscribe(
  baseUrl: string, file: File | Blob,
  options?: { language?: string; beam_size?: number; vad_filter?: boolean; filename?: string },
): Promise<SttResult> {
  const fd = new FormData()
  const filename = options?.filename ?? (file instanceof File ? file.name : 'recording.webm')
  fd.append('file', file, filename)
  if (options?.language) fd.append('language', options.language)
  if (options?.beam_size != null) fd.append('beam_size', String(options.beam_size))
  if (options?.vad_filter != null) fd.append('vad_filter', String(options.vad_filter))

  const r = await fetch(`${baseUrl}/transcribe`, { method: 'POST', body: fd })
  const data = await r.json()
  if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`)
  return data
}

export async function sttGetLogs(baseUrl: string): Promise<SttLog[]> {
  const r = await fetch(`${baseUrl}/logs`)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return (await r.json()).logs ?? []
}
