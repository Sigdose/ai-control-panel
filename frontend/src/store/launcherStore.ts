import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ServiceKey, ServiceProfile, LauncherStatus } from '../types'

// ──────────────────────────────────────────────
// 서비스 프로필 (localStorage 영구 저장)
// ──────────────────────────────────────────────
interface LauncherStoreState {
  launcherUrl: string
  profiles: Record<ServiceKey, ServiceProfile>
  setLauncherUrl: (url: string) => void
  setProfile: (svc: ServiceKey, patch: Partial<ServiceProfile>) => void
  resetProfile: (svc: ServiceKey) => void
}

// 도승2의 환경 기반 기본값 (Windows 경로, ChatterBox venv 등)
const DEFAULT_PROFILES: Record<ServiceKey, ServiceProfile> = {
  stt: {
    mode: 'local',
    command: 'D:\\Git\\whisper\\venv\\Scripts\\python.exe D:\\Git\\whisper\\src\\stt_server.py',
    cwd: 'D:\\Git\\whisper\\src',
    env: {},
  },
  llm: {
    mode: 'local',
    // Ollama는 시스템 서비스로 이미 떠있는 경우가 많음. 명시적으로 띄우려면:
    command: 'ollama serve',
    cwd: '',
    env: { OLLAMA_ORIGINS: '*' },
  },
  tts: {
    mode: 'local',
    command: 'D:\\Git\\ChatterBox\\venv\\Scripts\\python.exe D:\\Git\\ChatterBox\\tts_server.py',
    cwd: 'D:\\Git\\ChatterBox',
    env: {},
  },
}

export const useLauncherStore = create<LauncherStoreState>()(
  persist(
    (set) => ({
      launcherUrl: 'http://127.0.0.1:5000',
      profiles: DEFAULT_PROFILES,
      setLauncherUrl: (url) => set({ launcherUrl: url.replace(/\/+$/, '') }),
      setProfile: (svc, patch) =>
        set((state) => ({
          profiles: {
            ...state.profiles,
            [svc]: { ...state.profiles[svc], ...patch },
          },
        })),
      resetProfile: (svc) =>
        set((state) => ({
          profiles: { ...state.profiles, [svc]: DEFAULT_PROFILES[svc] },
        })),
    }),
    { name: 'ai-control-panel-launcher' },
  ),
)

// ──────────────────────────────────────────────
// 런처 상태 (메모리, polling 결과)
// ──────────────────────────────────────────────
interface LauncherRuntimeState {
  launcherOnline: boolean
  serviceStatus: Record<ServiceKey, LauncherStatus | null>
  setLauncherOnline: (v: boolean) => void
  setServiceStatus: (s: Record<ServiceKey, LauncherStatus>) => void
}

const EMPTY: LauncherStatus | null = null

export const useLauncherRuntime = create<LauncherRuntimeState>((set) => ({
  launcherOnline: false,
  serviceStatus: { stt: EMPTY, llm: EMPTY, tts: EMPTY },
  setLauncherOnline: (v) => set({ launcherOnline: v }),
  setServiceStatus: (s) => set({ serviceStatus: s }),
}))
