import { useCallback, useEffect, useRef, useState } from 'react'

export interface RecorderState {
  isRecording: boolean
  error: string | null
  blob: Blob | null
  durationSec: number
}

export function useAudioRecorder() {
  const [state, setState] = useState<RecorderState>({
    isRecording: false,
    error: null,
    blob: null,
    durationSec: 0,
  })
  const mediaRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startedAtRef = useRef<number>(0)
  const tickRef = useRef<number | null>(null)

  const start = useCallback(async () => {
    setState((s) => ({ ...s, error: null, blob: null, durationSec: 0 }))
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'
      const rec = new MediaRecorder(stream, { mimeType: mime })
      chunksRef.current = []
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mime })
        setState((s) => ({ ...s, isRecording: false, blob }))
        stream.getTracks().forEach((t) => t.stop())
      }
      rec.start()
      mediaRef.current = rec
      startedAtRef.current = performance.now()
      setState((s) => ({ ...s, isRecording: true }))

      tickRef.current = window.setInterval(() => {
        setState((s) => ({
          ...s,
          durationSec: Math.round((performance.now() - startedAtRef.current) / 100) / 10,
        }))
      }, 100)
    } catch (err: any) {
      setState((s) => ({ ...s, error: err?.message ?? 'mic access failed' }))
    }
  }, [])

  const stop = useCallback(() => {
    if (mediaRef.current && mediaRef.current.state !== 'inactive') {
      mediaRef.current.stop()
    }
    if (tickRef.current) {
      clearInterval(tickRef.current)
      tickRef.current = null
    }
  }, [])

  const reset = useCallback(() => {
    setState({ isRecording: false, error: null, blob: null, durationSec: 0 })
  }, [])

  useEffect(() => () => {
    if (tickRef.current) clearInterval(tickRef.current)
    if (mediaRef.current && mediaRef.current.state !== 'inactive') mediaRef.current.stop()
  }, [])

  return { ...state, start, stop, reset }
}
