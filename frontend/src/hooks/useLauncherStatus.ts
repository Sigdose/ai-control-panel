import { useEffect, useRef } from 'react'
import { useServerStore } from '../store/serverStore'
import { useLauncherRuntime } from '../store/launcherStore'
import { launcherRoles, launcherSystem } from '../api/launcher'

export function useLauncherStatus(intervalMs = 2500) {
  const launcherUrl = useServerStore((s) => s.urls.launcher)
  const setOnline = useLauncherRuntime((s) => s.setOnline)
  const setSystem = useLauncherRuntime((s) => s.setSystem)
  const setRoles = useLauncherRuntime((s) => s.setRoles)

  const urlRef = useRef(launcherUrl)
  urlRef.current = launcherUrl

  useEffect(() => {
    let stopped = false
    let systemFetched = false

    const tick = async () => {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 2000)
      try {
        const roles = await launcherRoles(urlRef.current, ctrl.signal)
        if (!stopped) {
          setOnline(true)
          setRoles(roles)
        }
        // 시스템 정보는 한 번만
        if (!systemFetched) {
          try {
            const sys = await launcherSystem(urlRef.current)
            if (!stopped) setSystem(sys)
            systemFetched = true
          } catch {}
        }
      } catch {
        if (!stopped) {
          setOnline(false)
          setSystem(null)
        }
      } finally { clearTimeout(t) }
    }
    tick()
    const id = setInterval(tick, intervalMs)
    return () => { stopped = true; clearInterval(id) }
  }, [intervalMs, setOnline, setSystem, setRoles])
}
