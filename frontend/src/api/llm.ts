import type { OllamaModel, LlmResult } from '../types'

// Ollama health check via /api/tags
export async function llmHealth(baseUrl: string, signal?: AbortSignal) {
  const res = await fetch(`${baseUrl}/api/tags`, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function llmListModels(baseUrl: string): Promise<OllamaModel[]> {
  const res = await fetch(`${baseUrl}/api/tags`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return data.models ?? []
}

// Non-streaming generation
export async function llmGenerate(
  baseUrl: string,
  opts: {
    model: string
    prompt: string
    system?: string
    temperature?: number
  },
): Promise<LlmResult> {
  const start = performance.now()
  const res = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: opts.model,
      prompt: opts.prompt,
      system: opts.system,
      stream: false,
      options: opts.temperature != null ? { temperature: opts.temperature } : undefined,
    }),
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`HTTP ${res.status}: ${txt}`)
  }
  const data = await res.json()
  const elapsed = (performance.now() - start) / 1000
  // Ollama returns timing fields in nanoseconds
  const evalCount = data.eval_count ?? 0
  const evalDuration = (data.eval_duration ?? 0) / 1e9
  const tps = evalDuration > 0 ? evalCount / evalDuration : 0
  return {
    ok: true,
    text: data.response ?? '',
    model: opts.model,
    elapsed: Math.round(elapsed * 100) / 100,
    tokens: evalCount,
    tokens_per_sec: Math.round(tps * 10) / 10,
  }
}

// Streaming generation
export async function llmStream(
  baseUrl: string,
  opts: { model: string; prompt: string; system?: string; temperature?: number },
  onChunk: (chunk: string) => void,
): Promise<LlmResult> {
  const start = performance.now()
  const res = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: opts.model,
      prompt: opts.prompt,
      system: opts.system,
      stream: true,
      options: opts.temperature != null ? { temperature: opts.temperature } : undefined,
    }),
  })
  if (!res.body) throw new Error('No response body')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''
  let evalCount = 0
  let evalDuration = 0

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const parsed = JSON.parse(line)
        if (parsed.response) {
          fullText += parsed.response
          onChunk(parsed.response)
        }
        if (parsed.done) {
          evalCount = parsed.eval_count ?? 0
          evalDuration = (parsed.eval_duration ?? 0) / 1e9
        }
      } catch {
        // ignore parse errors mid-stream
      }
    }
  }
  const elapsed = (performance.now() - start) / 1000
  const tps = evalDuration > 0 ? evalCount / evalDuration : 0
  return {
    ok: true,
    text: fullText,
    model: opts.model,
    elapsed: Math.round(elapsed * 100) / 100,
    tokens: evalCount,
    tokens_per_sec: Math.round(tps * 10) / 10,
  }
}

// Try to fetch VRAM via /api/ps (Ollama 0.1.30+)
export async function llmRunningModels(baseUrl: string): Promise<any> {
  try {
    const res = await fetch(`${baseUrl}/api/ps`)
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}
