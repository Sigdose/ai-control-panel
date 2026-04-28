import { useEffect, useState } from 'react'
import PageHeader from '../components/PageHeader'
import EndpointCard from '../components/EndpointCard'
import ServiceControl from '../components/ServiceControl'
import LauncherLogs from '../components/LauncherLogs'
import VramBar from '../components/VramBar'
import LogsTable from '../components/LogsTable'
import { useAudioRecorder } from '../hooks/useAudioRecorder'
import { useServerStore, useHealthStore } from '../store/serverStore'
import {
  sttGetSettings,
  sttSaveSettings,
  sttTranscribe,
  sttGetLogs,
} from '../api/stt'
import type { SttSettings, SttResult, SttLog } from '../types'

export default function SttPage() {
  const url = useServerStore((s) => s.urls.stt)
  const status = useHealthStore((s) => s.status.stt)
  const recorder = useAudioRecorder()

  const [settings, setSettings] = useState<SttSettings | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [langs, setLangs] = useState<string[]>([])
  const [computeTypes, setComputeTypes] = useState<string[]>([])

  const [inputMode, setInputMode] = useState<'mic' | 'file'>('mic')
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<SttResult | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savingMsg, setSavingMsg] = useState<string | null>(null)
  const [logs, setLogs] = useState<SttLog[]>([])

  // 설정 로드
  useEffect(() => {
    if (!status.online) return
    sttGetSettings(url)
      .then((d) => {
        setSettings(d.settings)
        setModels(d.available_models)
        setLangs(d.available_langs)
        setComputeTypes(d.compute_types)
      })
      .catch(() => {})
  }, [url, status.online])

  // 로그 폴링
  useEffect(() => {
    if (!status.online) return
    const tick = () => sttGetLogs(url).then(setLogs).catch(() => {})
    tick()
    const id = setInterval(tick, 4000)
    return () => clearInterval(id)
  }, [url, status.online])

  const updateSetting = <K extends keyof SttSettings>(key: K, value: SttSettings[K]) => {
    if (!settings) return
    setSettings({ ...settings, [key]: value })
  }

  const saveSettings = async () => {
    if (!settings) return
    setSavingMsg('저장 중...')
    try {
      const res = await sttSaveSettings(url, settings)
      setSavingMsg(res.reloaded ? '✓ 저장 + 모델 재로드' : '✓ 저장됨')
      setTimeout(() => setSavingMsg(null), 2500)
    } catch (e: any) {
      setSavingMsg(`✗ ${e.message}`)
    }
  }

  const runTranscribe = async () => {
    setError(null)
    setResult(null)
    let blob: Blob | null = null
    let filename = 'input.wav'
    if (inputMode === 'mic') {
      if (!recorder.blob) { setError('먼저 녹음하세요'); return }
      blob = recorder.blob; filename = 'recording.webm'
    } else {
      if (!file) { setError('파일을 선택하세요'); return }
      blob = file; filename = file.name
    }
    setRunning(true)
    try {
      const r = await sttTranscribe(url, blob, { filename })
      setResult(r)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setRunning(false)
    }
  }

  const vramFromHealth = status.raw?.vram ?? null

  return (
    <div className="min-h-full">
      <PageHeader
        shortcut="01 · STT"
        title="Speech-to-Text"
        subtitle="faster-whisper · 음성을 텍스트로 변환"
        accent="text-stt"
      />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 px-8 py-6">
        {/* LEFT: input + result */}
        <div className="lg:col-span-3 space-y-5">
          {/* Input */}
          <Section title="Input">
            <div className="flex gap-1 p-0.5 bg-ink-900 border border-ink-800 rounded">
              {(['mic', 'file'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setInputMode(m)}
                  className={`flex-1 px-3 py-1.5 text-2xs font-mono uppercase tracking-wider rounded transition-all
                    ${inputMode === m ? 'bg-ink-700 text-ink-100' : 'text-ink-500 hover:text-ink-300'}`}
                >
                  {m === 'mic' ? 'Microphone' : 'File Upload'}
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
                  <div className="space-y-1.5">
                    <audio controls src={URL.createObjectURL(recorder.blob)} className="w-full h-9" />
                    <div className="text-2xs font-mono text-ink-400">
                      {(recorder.blob.size / 1024).toFixed(1)} KB · {recorder.durationSec}s
                    </div>
                  </div>
                )}
                {recorder.error && <div className="text-2xs font-mono text-dead">{recorder.error}</div>}
              </div>
            ) : (
              <div className="space-y-2">
                <input
                  type="file"
                  accept="audio/*"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-2xs font-mono text-ink-400
                             file:mr-3 file:py-1.5 file:px-3 file:rounded
                             file:border file:border-ink-700 file:text-ink-200
                             file:bg-ink-800 file:text-2xs file:font-mono file:uppercase
                             file:cursor-pointer hover:file:bg-ink-750"
                />
                {file && (
                  <div className="text-2xs font-mono text-ink-400">
                    {file.name} · {(file.size / 1024).toFixed(1)} KB
                  </div>
                )}
              </div>
            )}

            <button
              onClick={runTranscribe}
              disabled={running || !status.online}
              className="w-full py-2.5 rounded text-xs font-mono uppercase tracking-wider
                         bg-stt/20 text-stt border border-stt/40 hover:bg-stt/30
                         disabled:bg-ink-800 disabled:text-ink-500 disabled:border-ink-700
                         disabled:cursor-not-allowed transition-colors"
            >
              {running ? '▶ Transcribing...' : '▶ Transcribe'}
            </button>

            {error && (
              <div className="text-2xs font-mono text-dead px-3 py-2 border border-dead/30 rounded bg-dead/5">
                {error}
              </div>
            )}
          </Section>

          {/* Result */}
          <Section title="Result">
            {result ? (
              <div className="space-y-3 animate-fade-in">
                <div className="grid grid-cols-4 gap-2 text-2xs font-mono">
                  <Metric label="Elapsed" value={`${result.elapsed}s`} />
                  <Metric label="Audio" value={`${result.audio_duration}s`} />
                  <Metric label="RTF" value={result.rtf.toFixed(3)} accent />
                  <Metric label="Lang" value={`${result.language}·${result.lang_prob}`} />
                </div>
                <div className="p-4 bg-ink-900 border border-ink-800 rounded">
                  <div className="text-2xs font-mono text-ink-500 uppercase tracking-wider mb-2">
                    Transcript
                  </div>
                  <div className="text-sm text-ink-100 whitespace-pre-wrap leading-relaxed">
                    {result.text || '(empty)'}
                  </div>
                </div>
                {result.segments.length > 1 && (
                  <details className="text-xs font-mono">
                    <summary className="cursor-pointer text-ink-400 uppercase tracking-wider text-2xs hover:text-ink-200">
                      Segments ({result.segments.length})
                    </summary>
                    <div className="mt-2 space-y-1 max-h-48 overflow-auto">
                      {result.segments.map((s, i) => (
                        <div key={i} className="flex gap-3 px-2 py-1 hover:bg-ink-850/50 rounded">
                          <span className="text-ink-500 tabular-nums shrink-0">
                            {s.start.toFixed(1)}–{s.end.toFixed(1)}
                          </span>
                          <span className="text-ink-200">{s.text.trim()}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            ) : (
              <div className="text-2xs font-mono text-ink-500 text-center py-12 uppercase tracking-wider">
                no transcription yet
              </div>
            )}
          </Section>
        </div>

        {/* RIGHT: endpoint + settings */}
        <div className="lg:col-span-2 space-y-5">
          <Section title="Endpoint">
            <EndpointCard service="stt" />
            {vramFromHealth && (
              <div className="pt-3 border-t border-ink-800">
                <VramBar vram={vramFromHealth} accent="bg-stt" />
              </div>
            )}
          </Section>

          <Section title="Control">
            <ServiceControl service="stt" accent="stt" />
          </Section>

          <Section title="Settings" right={
            savingMsg && <span className="text-2xs font-mono text-ink-400">{savingMsg}</span>
          }>
            {settings ? (
              <div className="space-y-3">
                <Field label="Model">
                  <select
                    value={settings.model_size}
                    onChange={(e) => updateSetting('model_size', e.target.value)}
                    className="select-style"
                  >
                    {models.map((m) => <option key={m}>{m}</option>)}
                  </select>
                </Field>
                <Field label="Language">
                  <select
                    value={settings.language}
                    onChange={(e) => updateSetting('language', e.target.value)}
                    className="select-style"
                  >
                    {langs.map((l) => <option key={l}>{l}</option>)}
                  </select>
                </Field>
                <Field label="Compute Type">
                  <select
                    value={settings.compute_type}
                    onChange={(e) => updateSetting('compute_type', e.target.value)}
                    className="select-style"
                  >
                    {computeTypes.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label={`Beam Size · ${settings.beam_size}`}>
                  <input
                    type="range" min="1" max="10" step="1"
                    value={settings.beam_size}
                    onChange={(e) => updateSetting('beam_size', parseInt(e.target.value))}
                    className="w-full"
                  />
                </Field>
                <label className="flex items-center gap-2 text-xs font-mono text-ink-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.vad_filter}
                    onChange={(e) => updateSetting('vad_filter', e.target.checked)}
                    className="accent-stt"
                  />
                  VAD filter (음성 활동 감지)
                </label>
                <button
                  onClick={saveSettings}
                  className="w-full py-2 mt-2 rounded text-2xs font-mono uppercase tracking-wider
                             bg-ink-100 text-ink-950 hover:bg-white"
                >
                  Save Settings
                </button>
                <div className="text-2xs font-mono text-ink-500">
                  ⚠ model / compute / device 변경 시 모델 재로드 (수십 초 소요)
                </div>
              </div>
            ) : (
              <div className="text-2xs font-mono text-ink-500 uppercase tracking-wider">
                서버 연결 대기 중
              </div>
            )}
          </Section>
        </div>
      </div>

      {/* LOGS */}
      <div className="px-8 pb-8">
        <LogsTable
          logs={logs}
          columns={[
            { key: 'time',     label: 'Time',     width: '90px' },
            { key: 'filename', label: 'File',     width: '180px',
              render: (r) => <span className="truncate block max-w-[180px]">{r.filename ?? '─'}</span> },
            { key: 'audio_duration', label: 'Audio',  width: '70px',
              render: (r) => r.audio_duration != null ? `${r.audio_duration}s` : '─' },
            { key: 'elapsed',  label: 'Elapsed',  width: '70px',
              render: (r) => `${r.elapsed}s` },
            { key: 'rtf',      label: 'RTF',      width: '60px',
              render: (r) => r.rtf?.toFixed(3) ?? '─', className: 'text-stt' },
            { key: 'language', label: 'Lang',     width: '60px' },
            { key: 'text',     label: 'Transcript',
              render: (r) => <span className="line-clamp-1 text-ink-300">{r.text ?? '─'}</span> },
            { key: 'status',   label: 'Status',   width: '90px' },
          ]}
        />
      </div>

      <div className="px-8 pb-8">
        <div className="bg-ink-900/40 border border-ink-800 rounded-lg p-5">
          <LauncherLogs service="stt" />
        </div>
      </div>
    </div>
  )
}

// ─── Local helpers ───
function Section({
  title, children, right,
}: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="space-y-3 bg-ink-900/40 border border-ink-800 rounded-lg p-5">
      <div className="flex items-center justify-between">
        <div className="text-2xs font-mono uppercase tracking-[0.2em] text-ink-400">{title}</div>
        {right}
      </div>
      {children}
    </section>
  )
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-2xs font-mono text-ink-500 uppercase tracking-wider">{label}</label>
      {children}
    </div>
  )
}
function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="px-2 py-1.5 bg-ink-900 border border-ink-800 rounded">
      <div className="text-ink-500 uppercase tracking-wider text-[0.625rem]">{label}</div>
      <div className={`tabular-nums ${accent ? 'text-stt' : 'text-ink-100'}`}>{value}</div>
    </div>
  )
}
