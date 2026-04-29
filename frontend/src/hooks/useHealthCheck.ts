import { useEffect, useRef } from 'react'
import { useServerStore, useHealthStore } from '../store/serverStore'
import { sttHealth } from '../api/stt'
import { llmHealth } from '../api/llm'
import { ttsHealth } from '../api/tts'
import type { ServiceKey } from '../types'

const checkers: Record<ServiceKey, (url: string, signal: AbortSignal) => Promise<any>> = {
  stt: sttHealth, llm: llmHealth, tts: ttsHealth,
}

export function useHealthCheck(intervalMs = 5000) {
  const urls = useServerStore((s) => s.urls)
  const setStatus = useHealthStore((s) => s.setStatus)
  const urlsRef = useRef(urls)
  urlsRef.current = urls

  useEffect(() => {
    let stopped = false
    const check = async (service: ServiceKey) => {
      const url = urlsRef.current[service]
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 3000)
      const start = performance.now()
      try {
        const raw = await checkers[service](url, ctrl.signal)
        if (!stopped) setStatus(service, {
          online: true, latencyMs: Math.round(performance.now() - start),
          lastCheck: Date.now(), raw,
        })
      } catch (err: any) {
        if (!stopped) setStatus(service, {
          online: false, latencyMs: null,
          lastCheck: Date.now(), error: err?.message ?? 'unreachable',
        })
      } finally { clearTimeout(t) }
    }
    const tick = () => { check('stt'); check('llm'); check('tts') }
    tick()
    const id = setInterval(tick, intervalMs)
    return () => { stopped = true; clearInterval(id) }
  }, [intervalMs, setStatus])
}
