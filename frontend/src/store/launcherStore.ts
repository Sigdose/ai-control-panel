import { create } from 'zustand'
import type { RoleKey, RoleStatus, LauncherSystemInfo } from '../types'

interface LauncherRuntimeState {
  online: boolean
  system: LauncherSystemInfo | null
  roles: Record<RoleKey, RoleStatus | null>
  setOnline: (v: boolean) => void
  setSystem: (s: LauncherSystemInfo | null) => void
  setRoles: (r: Record<RoleKey, RoleStatus>) => void
}

export const useLauncherRuntime = create<LauncherRuntimeState>((set) => ({
  online: false,
  system: null,
  roles: { stt: null, tts: null },
  setOnline: (v) => set({ online: v }),
  setSystem: (s) => set({ system: s }),
  setRoles: (r) => set({ roles: r }),
}))
