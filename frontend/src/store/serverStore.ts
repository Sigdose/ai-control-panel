import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { HealthStatus, ServiceKey } from '../types'

interface ServerUrls {
  stt: string
  llm: string
  tts: string
  launcher: string
}

interface ServerState {
  urls: ServerUrls
  setUrl: (service: ServiceKey | 'launcher', url: string) => void
  resetUrls: () => void
}

const DEFAULT_URLS: ServerUrls = {
  stt: 'http://127.0.0.1:5001',
  llm: 'http://127.0.0.1:11434',
  tts: 'http://127.0.0.1:5002',
  launcher: 'http://127.0.0.1:5000',
}

export const useServerStore = create<ServerState>()(
  persist(
    (set) => ({
      urls: DEFAULT_URLS,
      setUrl: (service, url) =>
        set((state) => ({
          urls: { ...state.urls, [service]: url.replace(/\/+$/, '') },
        })),
      resetUrls: () => set({ urls: DEFAULT_URLS }),
    }),
    { name: 'ai-control-panel-urls-v2' },
  ),
)

const INITIAL_HEALTH: HealthStatus = {
  online: false,
  latencyMs: null,
  lastCheck: null,
}

interface HealthState {
  status: Record<ServiceKey, HealthStatus>
  setStatus: (service: ServiceKey, status: HealthStatus) => void
}

export const useHealthStore = create<HealthState>((set) => ({
  status: {
    stt: { ...INITIAL_HEALTH },
    llm: { ...INITIAL_HEALTH },
    tts: { ...INITIAL_HEALTH },
  },
  setStatus: (service, status) =>
    set((state) => ({ status: { ...state.status, [service]: status } })),
}))
