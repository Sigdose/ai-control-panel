import { useEffect, useRef, useState } from 'react'
import ServerCard from '../components/ServerCard'
import StatusDot from '../components/StatusDot'
import { useServerStore, useHealthStore } from '../store/serverStore'
import { useLauncherStore, useLauncherRuntime } from '../store/launcherStore'
import { useAudioRecorder } from '../hooks/useAudioRecorder'
import { sttTranscribe, sttHealth } from '../api/stt'
import { llmGenerate, llmListModels, llmHealth } from '../api/llm'
import { ttsGenerate, ttsHealth } from '../api/tts'
import { launcherStart, launcherStop } from '../api/launcher'
import type { ServiceKey } from '../types'

type Stage = 'stt' | 'llm' | 'tts'
type StageState = 'idle' | 'running' | 'done' | 'error' | 'skipped'

interface StageInfo {
  state: StageState
  elapsed?: number
  result?: string
  error?: string
}

const INITIAL_STAGES: Record<Stage, StageInfo> = {
  stt: { state: 'idle' },
  llm: { state: 'idle' },
  tts: { state: 'idle' },
}

export default function MainPage() {
  const urls = useServerStore((s) => s.urls)
  const status = useHealthStore((s) => s.status)
  const profiles = useLauncherStore((s) => s.profiles)
  const launcherUrl = useLauncherStore((s) => s.launcherUrl)
  const launcherOnline = useLauncherRuntime((s) => s.launcherOnline)
  const serviceRuntime = useLauncherRuntime((s) => s.serviceStatus)
  const recorder = useAudioRecorder()

  const [inputMode, setInputMode] = useState<'mic' | 'file'>('mic')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [llmModel, setLlmModel] = useState<string>('')
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [systemPrompt, setSystemPrompt] = useState<string>(
    '당신은 친근하고 간결하게 답하는 한국어 어시스턴트입니다. 대답은 1~2문장으로 짧게 해주세요.',
  )
  const [autoplay, setAutoplay] = useState(true)
  const [stages, setStages] = useState<Record<Stage, StageInfo>>(INITIAL_STAGES)
  const [outputUrl, setOutputUrl] = useState<string | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [now, setNow] = useState(new Date())

  // Bootstrap (Start All / Stop All)
  const [bootstrapBusy, setBootstrapBusy] = useState(false)
  const [bootstrapStep, setBootstrapStep] = useState<string | null>(null)

  const audioRef = useRef<HTMLAudioElement>(null)

  // Clock
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  // LLM 모델 목록 폴링 (LLM이 온라인일 때)
  useEffect(() => {
    if (!status.llm.online) return
    llmListModels(urls.llm)
      .then((models) => {
        const names = models.map((m) => m.name)
        setAvailableModels(names)
        if (!llmModel && names.length > 0) setLlmModel(names[0])
      })
      .catch(() => {})
  }, [status.llm.online, urls.llm, llmModel])

  const allOnline = status.stt.online && status.llm.online && status.tts.online

  // ─── Start All (순차): STT → LLM → TTS ───
  const waitForHealth = async (svc: ServiceKey, timeoutMs = 60000): Promise<boolean> => {
    const start = Date.now()
    const checkers = { stt: sttHealth, llm: llmHealth, tts: ttsHealth }
    while (Date.now() - start < timeoutMs) {
      try {
        const ctrl = new AbortController()
        const tid = setTimeout(() => ctrl.abort(), 2000)
        await checkers[svc](urls[svc], ctrl.signal)
        clearTimeout(tid)
        return true
      } catch {
        await new Promise((r) => setTimeout(r, 1500))
      }
    }
    return false
  }

  const startAll = async () => {
    if (bootstrapBusy) return
    if (!launcherOnline) {
      setBootstrapStep('✗ 런처가 꺼져있음')
      setTimeout(() => setBootstrapStep(null), 4000)
      return
    }
    setBootstrapBusy(true)
    const order: ServiceKey[] = ['stt', 'llm', 'tts']
    for (const svc of order) {
      const p = profiles[svc]
      const label = svc.toUpperCase()

      if (p.mode === 'remote') {
        setBootstrapStep(`${label} · remote → skipping spawn`)
        continue
      }
      if (serviceRuntime[svc]?.running) {
        setBootstrapStep(`${label} · already running`)
        await new Promise((r) => setTimeout(r, 400))
        continue
      }
      if (!p.command.trim()) {
        setBootstrapStep(`✗ ${label} · command is empty`)
        setBootstrapBusy(false)
        return
      }

      setBootstrapStep(`${label} · spawning…`)
      const res = await launcherStart(launcherUrl, {
        service: svc, command: p.command, cwd: p.cwd || undefined,
        env: p.env && Object.keys(p.env).length ? p.env : undefined,
      })
      if (!res.ok) {
        setBootstrapStep(`✗ ${label} · ${res.error}`)
        setBootstrapBusy(false)
        return
      }

      setBootstrapStep(`${label} · waiting for health (up to 60s)…`)
      const healthy = await waitForHealth(svc)
      if (!healthy) {
        setBootstrapStep(`✗ ${label} · health timeout`)
        setBootstrapBusy(false)
        return
      }
      setBootstrapStep(`✓ ${label} online`)
    }
    setBootstrapStep('✓ All services online')
    setTimeout(() => setBootstrapStep(null), 3000)
    setBootstrapBusy(false)
  }

  const stopAll = async () => {
    if (bootstrapBusy) return
    setBootstrapBusy(true)
    // 역순
    for (const svc of ['tts', 'llm', 'stt'] as ServiceKey[]) {
      if (profiles[svc].mode !== 'local') continue
      if (!serviceRuntime[svc]?.running) continue
      setBootstrapStep(`${svc.toUpperCase()} · stopping…`)
      await launcherStop(launcherUrl, svc)
    }
    setBootstrapStep('■ All stopped')
    setTimeout(() => setBootstrapStep(null), 2500)
    setBootstrapBusy(false)
  }

  const anyLocalRunning = (['stt', 'llm', 'tts'] as ServiceKey[])
    .some((s) => profiles[s].mode === 'local' && serviceRuntime[s]?.running)

  const runPipeline = async () => {
    if (isRunning) return
    setStages(INITIAL_STAGES)
    setOutputUrl(null)
    setIsRunning(true)

    // ─── 1. STT ───
    let inputBlob: Blob | null = null
    let inputName = 'input.wav'
    if (inputMode === 'mic') {
      if (!recorder.blob) {
        setStages((s) => ({ ...s, stt: { state: 'error', error: '먼저 녹음하세요' } }))
        setIsRunning(false)
        return
      }
      inputBlob = recorder.blob
      inputName = 'recording.webm'
    } else {
      if (!selectedFile) {
        setStages((s) => ({ ...s, stt: { state: 'error', error: '파일을 선택하세요' } }))
        setIsRunning(false)
        return
      }
      inputBlob = selectedFile
      inputName = selectedFile.name
    }

    setStages((s) => ({ ...s, stt: { state: 'running' } }))
    let sttText = ''
    try {
      const sttRes = await sttTranscribe(urls.stt, inputBlob, { filename: inputName })
      sttText = sttRes.text.trim()
      setStages((s) => ({
        ...s,
        stt: { state: 'done', elapsed: sttRes.elapsed, result: sttText },
      }))
    } catch (err: any) {
      setStages((s) => ({ ...s, stt: { state: 'error', error: err.message } }))
      setIsRunning(false)
      return
    }

    if (!sttText) {
      setStages((s) => ({
        ...s,
        llm: { state: 'skipped' },
        tts: { state: 'skipped' },
      }))
      setIsRunning(false)
      return
    }

    // ─── 2. LLM ───
    setStages((s) => ({ ...s, llm: { state: 'running' } }))
    let llmText = ''
    try {
      const llmRes = await llmGenerate(urls.llm, {
        model: llmModel,
        prompt: sttText,
        system: systemPrompt,
      })
      llmText = llmRes.text.trim()
      setStages((s) => ({
        ...s,
        llm: {
          state: 'done',
          elapsed: llmRes.elapsed,
          result: `${llmText}\n\n[${llmRes.tokens} tokens · ${llmRes.tokens_per_sec} tok/s]`,
        },
      }))
    } catch (err: any) {
      setStages((s) => ({ ...s, llm: { state: 'error', error: err.message } }))
      setIsRunning(false)
      return
    }

    // ─── 3. TTS ───
    setStages((s) => ({ ...s, tts: { state: 'running' } }))
    try {
      const { blob, elapsed } = await ttsGenerate(urls.tts, { text: llmText })
      const url = URL.createObjectURL(blob)
      setOutputUrl(url)
      setStages((s) => ({
        ...s,
        tts: { state: 'done', elapsed, result: '음성 생성 완료' },
      }))
      if (autoplay && audioRef.current) {
        audioRef.current.src = url
        audioRef.current.play().catch(() => {})
      }
    } catch (err: any) {
      setStages((s) => ({ ...s, tts: { state: 'error', error: err.message } }))
    } finally {
      setIsRunning(false)
    }
  }

  const totalElapsed = (['stt', 'llm', 'tts'] as Stage[])
    .map((k) => stages[k].elapsed ?? 0)
    .reduce((a, b) => a + b, 0)

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="flex items-end justify-between border-b border-ink-800 px-8 py-6 gap-6">
        <div>
          <div className="text-2xs font-mono uppercase tracking-[0.2em] text-ink-400">
            00 · Overview
          </div>
          <h1 className="mt-2 text-3xl font-medium tracking-tight text-ink-100">
            System Status
          </h1>
          <p className="mt-1 text-sm text-ink-400">
            STT · LLM · TTS 통합 컨트롤 패널
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            {/* Start / Stop All */}
            <button
              onClick={startAll}
              disabled={bootstrapBusy || !launcherOnline}
              className="px-3 py-1.5 rounded text-2xs font-mono uppercase tracking-wider
                         border border-live/40 text-live hover:bg-live/10
                         disabled:border-ink-800 disabled:text-ink-600 disabled:cursor-not-allowed
                         transition-colors"
            >
              ▶ Start All
            </button>
            <button
              onClick={stopAll}
              disabled={bootstrapBusy || !launcherOnline || !anyLocalRunning}
              className="px-3 py-1.5 rounded text-2xs font-mono uppercase tracking-wider
                         border border-dead/40 text-dead hover:bg-dead/10
                         disabled:border-ink-800 disabled:text-ink-600 disabled:cursor-not-allowed
                         transition-colors"
            >
              ■ Stop All
            </button>
          </div>

          <div className="flex items-center gap-2">
            <StatusDot state={allOnline ? 'live' : 'wait'} />
            <span className="text-2xs font-mono uppercase tracking-wider text-ink-300">
              {allOnline ? 'All Systems Online' : 'Partial Connection'}
            </span>
          </div>

          <div className="text-xs font-mono text-ink-500 tabular-nums">
            {now.toLocaleString('ko-KR', { hour12: false })}
          </div>

          {bootstrapStep && (
            <div className={`text-2xs font-mono animate-fade-in
              ${bootstrapStep.startsWith('✗') ? 'text-dead'
                : bootstrapStep.startsWith('✓') ? 'text-live'
                : 'text-ink-300'}`}>
              {bootstrapStep}
            </div>
          )}
        </div>
      </div>

      {/* Three cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 px-8 py-6">
        <ServerCard
          service="stt"
          title="Speech-to-Text"
          subtitle="faster-whisper"
          shortcut="01"
          to="/stt"
        />
        <ServerCard
          service="llm"
          title="Language Model"
          subtitle="ollama · local"
          shortcut="02"
          to="/llm"
        />
        <ServerCard
          service="tts"
          title="Text-to-Speech"
          subtitle="chatterbox-mtl"
          shortcut="03"
          to="/tts"
        />
      </div>

      {/* Pipeline */}
      <div className="px-8 pb-8">
        <div className="bg-ink-900/40 border border-ink-800 rounded-lg overflow-hidden">
          {/* Pipeline header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-ink-800">
            <div className="flex items-center gap-3">
              <div className="text-2xs font-mono uppercase tracking-[0.2em] text-ink-400">
                Pipeline
              </div>
              <div className="text-xs font-mono text-ink-500">
                STT → LLM → TTS
              </div>
            </div>
            {totalElapsed > 0 && (
              <div className="text-2xs font-mono text-ink-400 tabular-nums uppercase tracking-wider">
                Total {totalElapsed.toFixed(2)}s
              </div>
            )}
          </div>

          {/* Pipeline body */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-0">
            {/* INPUT (좌) */}
            <div className="lg:col-span-3 p-5 border-b lg:border-b-0 lg:border-r border-ink-800 space-y-4">
              <div className="text-2xs font-mono uppercase tracking-wider text-ink-500">
                Input
              </div>

              {/* Mode toggle */}
              <div className="flex gap-1 p-0.5 bg-ink-900 border border-ink-800 rounded">
                {(['mic', 'file'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setInputMode(m)}
                    className={`flex-1 px-3 py-1.5 text-2xs font-mono uppercase tracking-wider rounded transition-all
                      ${inputMode === m
                        ? 'bg-ink-700 text-ink-100'
                        : 'text-ink-500 hover:text-ink-300'}`}
                  >
                    {m === 'mic' ? 'Microphone' : 'File'}
                  </button>
                ))}
              </div>

              {inputMode === 'mic' ? (
                <div className="space-y-2">
                  <button
                    onClick={recorder.isRecording ? recorder.stop : recorder.start}
                    className={`w-full py-3 rounded text-xs font-mono uppercase tracking-wider transition-all
                      ${recorder.isRecording
                        ? 'bg-dead/20 text-dead border border-dead/40 scanline'
                        : 'bg-ink-800 text-ink-200 border border-ink-700 hover:bg-ink-750'}`}
                  >
                    {recorder.isRecording ? `● Recording ${recorder.durationSec}s` : '○ Start Recording'}
                  </button>
                  {recorder.blob && !recorder.isRecording && (
                    <div className="text-2xs font-mono text-ink-400 text-center">
                      {(recorder.blob.size / 1024).toFixed(1)} KB · {recorder.durationSec}s
                    </div>
                  )}
                  {recorder.error && (
                    <div className="text-2xs font-mono text-dead">{recorder.error}</div>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="block">
                    <input
                      type="file"
                      accept="audio/*"
                      onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                      className="block w-full text-2xs font-mono text-ink-400
                                 file:mr-3 file:py-1.5 file:px-3 file:rounded
                                 file:border file:border-ink-700 file:text-ink-200
                                 file:bg-ink-800 file:text-2xs file:font-mono file:uppercase
                                 file:cursor-pointer hover:file:bg-ink-750"
                    />
                  </label>
                  {selectedFile && (
                    <div className="text-2xs font-mono text-ink-400 truncate">
                      {selectedFile.name} · {(selectedFile.size / 1024).toFixed(1)} KB
                    </div>
                  )}
                </div>
              )}

              {/* LLM model select */}
              <div className="space-y-1.5">
                <label className="block text-2xs font-mono uppercase tracking-wider text-ink-500">
                  LLM Model
                </label>
                <select
                  value={llmModel}
                  onChange={(e) => setLlmModel(e.target.value)}
                  disabled={availableModels.length === 0}
                  className="w-full px-2 py-1.5 text-xs font-mono bg-ink-900 border border-ink-800
                             text-ink-200 rounded focus:outline-none focus:border-llm/50"
                >
                  {availableModels.length === 0 ? (
                    <option>─ no models ─</option>
                  ) : (
                    availableModels.map((m) => <option key={m}>{m}</option>)
                  )}
                </select>
              </div>

              {/* Autoplay toggle */}
              <label className="flex items-center gap-2 text-2xs font-mono text-ink-400 uppercase tracking-wider cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoplay}
                  onChange={(e) => setAutoplay(e.target.checked)}
                  className="accent-tts"
                />
                Auto-play output
              </label>

              {/* Run */}
              <button
                onClick={runPipeline}
                disabled={isRunning || !allOnline}
                className="w-full py-2.5 rounded text-xs font-mono uppercase tracking-wider
                           bg-ink-100 text-ink-950 hover:bg-white disabled:bg-ink-700
                           disabled:text-ink-500 disabled:cursor-not-allowed transition-colors"
              >
                {isRunning ? '▶ Running...' : '▶ Run Pipeline'}
              </button>
              {!allOnline && (
                <div className="text-2xs font-mono text-wait text-center">
                  ⚠ 모든 서비스가 연결되어야 실행됩니다
                </div>
              )}
            </div>

            {/* STAGES (중) */}
            <div className="lg:col-span-9 p-5 space-y-3">
              <StageRow
                label="STT"
                accent="text-stt"
                accentBg="bg-stt"
                info={stages.stt}
                placeholder="음성 → 텍스트"
              />
              <StageArrow />
              <StageRow
                label="LLM"
                accent="text-llm"
                accentBg="bg-llm"
                info={stages.llm}
                placeholder="텍스트 → 응답"
              />
              <StageArrow />
              <StageRow
                label="TTS"
                accent="text-tts"
                accentBg="bg-tts"
                info={stages.tts}
                placeholder="응답 → 음성"
              />

              {outputUrl && (
                <div className="mt-4 pt-4 border-t border-ink-800 space-y-2 animate-fade-in">
                  <div className="flex items-center justify-between">
                    <div className="text-2xs font-mono uppercase tracking-wider text-tts">
                      ▼ Output
                    </div>
                    <a
                      href={outputUrl}
                      download={`pipeline_${Date.now()}.wav`}
                      className="text-2xs font-mono uppercase tracking-wider text-ink-400 hover:text-ink-100"
                    >
                      ↓ Download WAV
                    </a>
                  </div>
                  <audio
                    ref={audioRef}
                    controls
                    src={outputUrl}
                    className="w-full h-9"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────
// Stage row
// ──────────────────────────────────────────────
function StageRow({
  label,
  accent,
  accentBg,
  info,
  placeholder,
}: {
  label: string
  accent: string
  accentBg: string
  info: StageInfo
  placeholder: string
}) {
  const stateColor = {
    idle: 'border-ink-800 text-ink-500',
    running: `border-ink-700 text-ink-200 scanline`,
    done: 'border-ink-700 text-ink-200',
    error: 'border-dead/40 text-dead',
    skipped: 'border-ink-800 text-ink-600',
  }[info.state]

  return (
    <div className={`grid grid-cols-12 gap-3 items-start border ${stateColor} rounded p-3 transition-all`}>
      <div className="col-span-2 lg:col-span-1 flex flex-col items-center">
        <div className={`text-2xs font-mono uppercase tracking-wider ${accent}`}>
          {label}
        </div>
        <div className={`mt-1 h-1 w-8 rounded-full ${
          info.state === 'done' || info.state === 'running' ? accentBg : 'bg-ink-800'
        }`} />
      </div>

      <div className="col-span-8 lg:col-span-9 min-h-[2rem] text-xs font-mono whitespace-pre-wrap break-words">
        {info.state === 'idle' && (
          <span className="text-ink-600">{placeholder}</span>
        )}
        {info.state === 'running' && (
          <span className="text-ink-300">처리 중...</span>
        )}
        {info.state === 'skipped' && (
          <span className="text-ink-600">건너뜀</span>
        )}
        {info.state === 'error' && (
          <span className="text-dead">{info.error}</span>
        )}
        {info.state === 'done' && info.result && (
          <span className="text-ink-200">{info.result}</span>
        )}
      </div>

      <div className="col-span-2 text-right text-2xs font-mono text-ink-400 tabular-nums">
        {info.elapsed != null ? `${info.elapsed.toFixed(2)}s` : '──'}
      </div>
    </div>
  )
}

function StageArrow() {
  return (
    <div className="flex justify-center">
      <div className="text-ink-700 text-xs">↓</div>
    </div>
  )
}
