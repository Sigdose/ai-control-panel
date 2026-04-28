import { useEffect, useState } from 'react'
import PageHeader from '../components/PageHeader'
import EndpointCard from '../components/EndpointCard'
import ServiceControl from '../components/ServiceControl'
import LauncherLogs from '../components/LauncherLogs'
import LogsTable from '../components/LogsTable'
import { useServerStore, useHealthStore } from '../store/serverStore'
import {
  ttsGetSettings,
  ttsSaveSettings,
  ttsListVoices,
  ttsGenerate,
  ttsGetLogs,
} from '../api/tts'
import type { TtsSettings, TtsVoice, TtsLog } from '../types'

export default function TtsPage() {
  const url = useServerStore((s) => s.urls.tts)
  const status = useHealthStore((s) => s.status.tts)

  const [settings, setSettings] = useState<TtsSettings | null>(null)
  const [voices, setVoices] = useState<TtsVoice[]>([])
  const [text, setText] = useState<string>('안녕하세요. 테스트 음성입니다.')
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastElapsed, setLastElapsed] = useState<number | null>(null)
  const [savingMsg, setSavingMsg] = useState<string | null>(null)
  const [logs, setLogs] = useState<TtsLog[]>([])

  // 설정 로드
  useEffect(() => {
    if (!status.online) return
    ttsGetSettings(url).then(setSettings).catch(() => {})
    ttsListVoices(url).then(setVoices).catch(() => {})
  }, [url, status.online])

  // 로그 폴링
  useEffect(() => {
    if (!status.online) return
    const tick = () => ttsGetLogs(url).then(setLogs).catch(() => {})
    tick()
    const id = setInterval(tick, 4000)
    return () => clearInterval(id)
  }, [url, status.online])

  const updateSetting = <K extends keyof TtsSettings>(key: K, value: TtsSettings[K]) => {
    if (!settings) return
    setSettings({ ...settings, [key]: value })
  }

  const saveSettings = async () => {
    if (!settings) return
    setSavingMsg('저장 중...')
    try {
      await ttsSaveSettings(url, settings)
      setSavingMsg('✓ 저장됨')
      setTimeout(() => setSavingMsg(null), 2500)
    } catch (e: any) {
      setSavingMsg(`✗ ${e.message}`)
    }
  }

  const runGenerate = async () => {
    if (!text.trim()) { setError('텍스트를 입력하세요'); return }
    setError(null)
    setAudioUrl(null)
    setRunning(true)
    try {
      const { blob, elapsed } = await ttsGenerate(url, {
        text,
        language: settings?.language,
        audio_prompt: settings?.audio_prompt,
        normalize: settings?.normalize,
        exaggeration: settings?.exaggeration,
        cfg_weight: settings?.cfg_weight,
      })
      setAudioUrl(URL.createObjectURL(blob))
      setLastElapsed(elapsed)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="min-h-full">
      <PageHeader
        shortcut="03 · TTS"
        title="Text-to-Speech"
        subtitle="chatterbox-mtl · 텍스트를 음성으로 변환"
        accent="text-tts"
      />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 px-8 py-6">
        {/* LEFT */}
        <div className="lg:col-span-3 space-y-5">
          <Section title="Text Input">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              className="textarea-style"
              placeholder="음성으로 변환할 텍스트..."
            />
            <div className="flex items-center justify-between">
              <div className="text-2xs font-mono text-ink-500">
                {text.length} chars · {text.split('\n').length} lines
              </div>
              <button
                onClick={runGenerate}
                disabled={running || !status.online}
                className="px-4 py-2 rounded text-xs font-mono uppercase tracking-wider
                           bg-tts/20 text-tts border border-tts/40 hover:bg-tts/30
                           disabled:bg-ink-800 disabled:text-ink-500 disabled:border-ink-700
                           disabled:cursor-not-allowed transition-colors"
              >
                {running ? '▶ Generating...' : '▶ Generate'}
              </button>
            </div>
            {error && (
              <div className="text-2xs font-mono text-dead px-3 py-2 border border-dead/30 rounded bg-dead/5">
                {error}
              </div>
            )}
          </Section>

          <Section title="Output" right={
            lastElapsed != null && (
              <div className="text-2xs font-mono text-ink-400 tabular-nums">
                {lastElapsed}s elapsed
              </div>
            )
          }>
            {audioUrl ? (
              <div className="space-y-2 animate-fade-in">
                <audio controls src={audioUrl} className="w-full h-10" autoPlay />
                <div className="flex justify-end">
                  <a
                    href={audioUrl}
                    download={`tts_${Date.now()}.wav`}
                    className="text-2xs font-mono uppercase tracking-wider text-ink-400 hover:text-ink-100"
                  >
                    ↓ Download WAV
                  </a>
                </div>
              </div>
            ) : (
              <div className={`p-8 text-center text-2xs font-mono uppercase tracking-wider rounded
                              border border-ink-800 ${running ? 'scanline text-ink-300' : 'text-ink-500'}`}>
                {running ? '음성 합성 중...' : 'no audio yet'}
              </div>
            )}
          </Section>
        </div>

        {/* RIGHT */}
        <div className="lg:col-span-2 space-y-5">
          <Section title="Endpoint">
            <EndpointCard service="tts" />
          </Section>

          <Section title="Control">
            <ServiceControl service="tts" accent="tts" />
          </Section>

          <Section title="Settings" right={
            savingMsg && <span className="text-2xs font-mono text-ink-400">{savingMsg}</span>
          }>
            {settings ? (
              <div className="space-y-3">
                <Field label="Language">
                  <select
                    value={settings.language}
                    onChange={(e) => updateSetting('language', e.target.value)}
                    className="select-style"
                  >
                    {['ko','en','ja','zh','fr','de','es','it','ru','pt','ar','hi'].map((l) => (
                      <option key={l}>{l}</option>
                    ))}
                  </select>
                </Field>

                <Field label="Voice">
                  <select
                    value={settings.audio_prompt}
                    onChange={(e) => updateSetting('audio_prompt', e.target.value)}
                    className="select-style"
                  >
                    <option value="">(기본 목소리)</option>
                    {voices.map((v) => (
                      <option key={v.path} value={v.path}>{v.name}</option>
                    ))}
                  </select>
                </Field>

                <Field label={`Exaggeration · ${settings.exaggeration.toFixed(2)}`}>
                  <input
                    type="range" min="0" max="1" step="0.05"
                    value={settings.exaggeration}
                    onChange={(e) => updateSetting('exaggeration', parseFloat(e.target.value))}
                    className="w-full"
                  />
                </Field>

                <Field label={`CFG Weight · ${settings.cfg_weight.toFixed(2)}`}>
                  <input
                    type="range" min="0" max="1" step="0.05"
                    value={settings.cfg_weight}
                    onChange={(e) => updateSetting('cfg_weight', parseFloat(e.target.value))}
                    className="w-full"
                  />
                </Field>

                <Field label={`Line Threshold · ${settings.line_threshold}`}>
                  <input
                    type="range" min="1" max="10" step="1"
                    value={settings.line_threshold}
                    onChange={(e) => updateSetting('line_threshold', parseInt(e.target.value))}
                    className="w-full"
                  />
                </Field>

                <label className="flex items-center gap-2 text-xs font-mono text-ink-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.normalize}
                    onChange={(e) => updateSetting('normalize', e.target.checked)}
                    className="accent-tts"
                  />
                  Normalize (숫자 자동 변환)
                </label>

                <button
                  onClick={saveSettings}
                  className="w-full py-2 mt-2 rounded text-2xs font-mono uppercase tracking-wider
                             bg-ink-100 text-ink-950 hover:bg-white"
                >
                  Save Settings
                </button>
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
            { key: 'language', label: 'Lang',     width: '60px' },
            { key: 'voice',    label: 'Voice',    width: '120px',
              render: (r) => <span className="truncate block max-w-[120px]">{r.voice}</span> },
            { key: 'text',     label: 'Text',
              render: (r) => <span className="line-clamp-1 text-ink-300">{r.text}</span> },
            { key: 'elapsed',  label: 'Elapsed',  width: '70px',
              render: (r) => `${r.elapsed}s`, className: 'text-tts' },
            { key: 'vram_total', label: 'VRAM',   width: '70px',
              render: (r) => r.vram_total != null ? `${r.vram_total}G` : '─' },
            { key: 'status',   label: 'Status',   width: '110px' },
          ]}
        />
      </div>

      <div className="px-8 pb-8">
        <div className="bg-ink-900/40 border border-ink-800 rounded-lg p-5">
          <LauncherLogs service="tts" />
        </div>
      </div>
    </div>
  )
}

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
