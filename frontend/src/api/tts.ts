import type { TtsSettings, TtsVoice, TtsLog } from '../types'

export async function ttsHealth(baseUrl: string, signal?: AbortSignal) {
  const r = await fetch(`${baseUrl}/health`, { signal })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

export async function ttsGetSettings(baseUrl: string): Promise<TtsSettings> {
  const r = await fetch(`${baseUrl}/settings`)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

export async function ttsSaveSettings(baseUrl: string, s: Partial<TtsSettings>) {
  const r = await fetch(`${baseUrl}/settings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(s),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

export async function ttsListVoices(baseUrl: string): Promise<TtsVoice[]> {
  try {
    const r = await fetch(`${baseUrl}/voices`)
    if (!r.ok) return []
    const data = await r.json()
    return data.voices ?? data ?? []
  } catch { return [] }
}

export interface TtsRequest {
  text: string
  language?: string
  audio_prompt?: string
  normalize?: boolean
  exaggeration?: number
  cfg_weight?: number
}

export async function ttsGenerate(
  baseUrl: string, req: TtsRequest,
): Promise<{ blob: Blob; elapsed: number }> {
  const start = performance.now()
  const r = await fetch(`${baseUrl}/tts`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
  const blob = await r.blob()
  const elapsed = (performance.now() - start) / 1000
  return { blob, elapsed: Math.round(elapsed * 100) / 100 }
}

export async function ttsGetLogs(baseUrl: string): Promise<TtsLog[]> {
  try {
    const r = await fetch(`${baseUrl}/logs`)
    if (!r.ok) return []
    const data = await r.json()
    return data.logs ?? data ?? []
  } catch { return [] }
}
