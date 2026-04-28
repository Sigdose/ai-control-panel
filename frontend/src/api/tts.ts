import type { TtsSettings, TtsVoice, TtsLog } from '../types'

export async function ttsHealth(baseUrl: string, signal?: AbortSignal) {
  // / 또는 /health가 가벼운 JSON 응답 반환 (tts_server.py v2)
  const res = await fetch(`${baseUrl}/health`, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function ttsGetSettings(baseUrl: string): Promise<TtsSettings> {
  const res = await fetch(`${baseUrl}/settings`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function ttsSaveSettings(baseUrl: string, settings: Partial<TtsSettings>) {
  const res = await fetch(`${baseUrl}/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function ttsListVoices(baseUrl: string): Promise<TtsVoice[]> {
  try {
    const res = await fetch(`${baseUrl}/voices`)
    if (!res.ok) return []
    const data = await res.json()
    return data.voices ?? data ?? []
  } catch {
    return []
  }
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
  baseUrl: string,
  req: TtsRequest,
): Promise<{ blob: Blob; elapsed: number }> {
  const start = performance.now()
  const res = await fetch(`${baseUrl}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`HTTP ${res.status}: ${txt}`)
  }
  const blob = await res.blob()
  const elapsed = (performance.now() - start) / 1000
  return { blob, elapsed: Math.round(elapsed * 100) / 100 }
}

export async function ttsGetLogs(baseUrl: string): Promise<TtsLog[]> {
  try {
    const res = await fetch(`${baseUrl}/logs`)
    if (!res.ok) return []
    const data = await res.json()
    return data.logs ?? data ?? []
  } catch {
    return []
  }
}
