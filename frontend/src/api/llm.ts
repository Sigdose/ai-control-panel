import type { OllamaModel, LlmResult } from '../types'

export async function llmHealth(baseUrl: string, signal?: AbortSignal) {
  const r = await fetch(`${baseUrl}/api/tags`, { signal })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

export async function llmListModels(baseUrl: string): Promise<OllamaModel[]> {
  const r = await fetch(`${baseUrl}/api/tags`)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return (await r.json()).models ?? []
}

export async function llmGenerate(
  baseUrl: string, opts: { model: string; prompt: string; system?: string; temperature?: number },
): Promise<LlmResult> {
  const start = performance.now()
  const r = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: opts.model, prompt: opts.prompt, system: opts.system, stream: false,
      options: opts.temperature != null ? { temperature: opts.temperature } : undefined,
    }),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`)
  const data = await r.json()
  const elapsed = (performance.now() - start) / 1000
  const evalCount = data.eval_count ?? 0
  const evalDuration = (data.eval_duration ?? 0) / 1e9
  const tps = evalDuration > 0 ? evalCount / evalDuration : 0
  return {
    ok: true, text: data.response ?? '', model: opts.model,
    elapsed: Math.round(elapsed * 100) / 100,
    tokens: evalCount, tokens_per_sec: Math.round(tps * 10) / 10,
  }
}

export async function llmStream(
  baseUrl: string, opts: { model: string; prompt: string; system?: string; temperature?: number },
  onChunk: (chunk: string) => void,
): Promise<LlmResult> {
  const start = performance.now()
  const r = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: opts.model, prompt: opts.prompt, system: opts.system, stream: true,
      options: opts.temperature != null ? { temperature: opts.temperature } : undefined,
    }),
  })
  if (!r.body) throw new Error('No response body')

  const reader = r.body.getReader()
  const decoder = new TextDecoder()
  let buffer = '', fullText = '', evalCount = 0, evalDuration = 0

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const p = JSON.parse(line)
        if (p.response) { fullText += p.response; onChunk(p.response) }
        if (p.done) { evalCount = p.eval_count ?? 0; evalDuration = (p.eval_duration ?? 0) / 1e9 }
      } catch {}
    }
  }
  const elapsed = (performance.now() - start) / 1000
  const tps = evalDuration > 0 ? evalCount / evalDuration : 0
  return {
    ok: true, text: fullText, model: opts.model,
    elapsed: Math.round(elapsed * 100) / 100,
    tokens: evalCount, tokens_per_sec: Math.round(tps * 10) / 10,
  }
}
