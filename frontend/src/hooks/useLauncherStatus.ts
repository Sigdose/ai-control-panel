import { useEffect, useRef } from 'react'
import { useLauncherStore, useLauncherRuntime } from '../store/launcherStore'
import { launcherListServices } from '../api/launcher'

export function useLauncherStatus(intervalMs = 2500) {
  const launcherUrl = useLauncherStore((s) => s.launcherUrl)
  const setLauncherOnline = useLauncherRuntime((s) => s.setLauncherOnline)
  const setServiceStatus = useLauncherRuntime((s) => s.setServiceStatus)

  const urlRef = useRef(launcherUrl)
  urlRef.current = launcherUrl

  useEffect(() => {
    let stopped = false

    const tick = async () => {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 2000)
      try {
        const services = await launcherListServices(urlRef.current, controller.signal)
        if (!stopped) {
          setLauncherOnline(true)
          setServiceStatus(services)
        }
      } catch {
        if (!stopped) {
          setLauncherOnline(false)
          // 서비스 상태는 유지 (마지막 알려진 상태)
        }
      } finally {
        clearTimeout(timeout)
      }
    }

    tick()
    const id = setInterval(tick, intervalMs)
    return () => {
      stopped = true
      clearInterval(id)
    }
  }, [intervalMs, setLauncherOnline, setServiceStatus])
}
