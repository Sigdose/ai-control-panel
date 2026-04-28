import { useEffect, useRef, useState } from 'react'
import PageHeader from '../components/PageHeader'
import EndpointCard from '../components/EndpointCard'
import ServiceControl from '../components/ServiceControl'
import LauncherLogs from '../components/LauncherLogs'
import LogsTable from '../components/LogsTable'
import { useServerStore, useHealthStore } from '../store/serverStore'
import { llmListModels, llmStream } from '../api/llm'
import type { OllamaModel } from '../types'

interface LocalLog {
  time: string
  model: string
  prompt: string
  response: string
  elapsed: number
  tokens: number
  tps: number
  status: string
}

export default function LlmPage() {
  const url = useServerStore((s) => s.urls.llm)
  const status = useHealthStore((s) => s.status.llm)

  const [models, setModels] = useState<OllamaModel[]>([])
  const [selectedModel, setSelectedModel] = useState<string>('')
  const [systemPrompt, setSystemPrompt] = useState<string>(
    '당신은 친근하고 간결하게 답하는 한국어 어시스턴트입니다.',
  )
  const [prompt, setPrompt] = useState<string>('안녕! 너 자신을 한 문장으로 소개해줘.')
  const [temperature, setTemperature] = useState<number>(0.7)
  const [response, setResponse] = useState<string>('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<{ elapsed: number; tokens: number; tps: number } | null>(null)
  const [logs, setLogs] = useState<LocalLog[]>([])
  const responseRef = useRef<HTMLDivElement>(null)

  // 모델 목록 로드
  useEffect(() => {
    if (!status.online) return
    llmListModels(url)
      .then((m) => {
        setModels(m)
        if (!selectedModel && m.length > 0) setSelectedModel(m[0].name)
      })
      .catch(() => {})
  }, [url, status.online, selectedModel])

  const run = async () => {
    if (!selectedModel) { setError('모델을 선택하세요'); return }
    setError(null)
    setResponse('')
    setStats(null)
    setRunning(true)

    try {
      const result = await llmStream(
        url,
        { model: selectedModel, prompt, system: systemPrompt, temperature },
        (chunk) => {
          setResponse((prev) => prev + chunk)
          // auto-scroll
          if (responseRef.current) {
            responseRef.current.scrollTop = responseRef.current.scrollHeight
          }
        },
      )
      setStats({
        elapsed: result.elapsed,
        tokens: result.tokens ?? 0,
        tps: result.tokens_per_sec ?? 0,
      })
      setLogs((prev) => [
        {
          time: new Date().toLocaleTimeString('ko-KR', { hour12: false }),
          model: selectedModel,
          prompt: prompt.slice(0, 60),
          response: result.text.slice(0, 80),
          elapsed: result.elapsed,
          tokens: result.tokens ?? 0,
          tps: result.tokens_per_sec ?? 0,
          status: '✅ 성공',
        },
        ...prev,
      ].slice(0, 50))
    } catch (e: any) {
      setError(e.message)
      setLogs((prev) => [
        {
          time: new Date().toLocaleTimeString('ko-KR', { hour12: false }),
          model: selectedModel,
          prompt: prompt.slice(0, 60),
          response: '',
          elapsed: 0,
          tokens: 0,
          tps: 0,
          status: `❌ ${e.message.slice(0, 30)}`,
        },
        ...prev,
      ].slice(0, 50))
    } finally {
      setRunning(false)
    }
  }

  const formatBytes = (b: number) => `${(b / 1024 ** 3).toFixed(2)} GB`

  return (
    <div className="min-h-full">
      <PageHeader
        shortcut="02 · LLM"
        title="Language Model"
        subtitle="Ollama · 텍스트 입력으로 응답 생성"
        accent="text-llm"
      />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 px-8 py-6">
        {/* LEFT */}
        <div className="lg:col-span-3 space-y-5">
          <Section title="System Prompt">
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={2}
              className="textarea-style"
              placeholder="(선택) 시스템 지시문"
            />
          </Section>

          <Section title="User Prompt">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              className="textarea-style"
              placeholder="질문이나 지시를 입력..."
            />
            <div className="flex items-center justify-between">
              <div className="text-2xs font-mono text-ink-500">
                {prompt.length} chars · ⌘ Enter to send
              </div>
              <button
                onClick={run}
                disabled={running || !status.online || !selectedModel}
                className="px-4 py-2 rounded text-xs font-mono uppercase tracking-wider
                           bg-llm/20 text-llm border border-llm/40 hover:bg-llm/30
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

          <Section title="Response" right={
            stats && (
              <div className="text-2xs font-mono text-ink-400 tabular-nums">
                {stats.elapsed}s · {stats.tokens} tok · {stats.tps} t/s
              </div>
            )
          }>
            <div
              ref={responseRef}
              className={`p-4 bg-ink-900 border border-ink-800 rounded min-h-[160px] max-h-[400px] overflow-auto
                          text-sm text-ink-100 whitespace-pre-wrap leading-relaxed
                          ${running ? 'scanline' : ''}`}
            >
              {response || (
                <span className="text-ink-500 text-2xs font-mono uppercase tracking-wider">
                  no response yet
                </span>
              )}
              {running && <span className="inline-block w-2 h-4 bg-llm animate-pulse ml-0.5" />}
            </div>
          </Section>
        </div>

        {/* RIGHT */}
        <div className="lg:col-span-2 space-y-5">
          <Section title="Endpoint">
            <EndpointCard service="llm" />
          </Section>

          <Section title="Control">
            <ServiceControl service="llm" accent="llm" />
          </Section>

          <Section title="Model" right={
            <span className="text-2xs font-mono text-ink-500 tabular-nums">{models.length} loaded</span>
          }>
            {models.length > 0 ? (
              <div className="space-y-1.5">
                {models.map((m) => (
                  <button
                    key={m.name}
                    onClick={() => setSelectedModel(m.name)}
                    className={`w-full text-left px-3 py-2 rounded text-xs font-mono transition-all border
                      ${selectedModel === m.name
                        ? 'bg-llm/10 border-llm/40 text-ink-100'
                        : 'bg-ink-900 border-ink-800 text-ink-300 hover:border-ink-700'}`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate">{m.name}</span>
                      <span className="text-2xs text-ink-500 tabular-nums shrink-0">
                        {formatBytes(m.size)}
                      </span>
                    </div>
                    {m.details?.parameter_size && (
                      <div className="text-2xs text-ink-500 mt-0.5">
                        {m.details.parameter_size} · {m.details.quantization_level ?? ''}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-2xs font-mono text-ink-500 uppercase tracking-wider">
                {status.online ? 'no models installed' : '서버 연결 대기 중'}
              </div>
            )}
          </Section>

          <Section title="Settings">
            <div className="space-y-1.5">
              <label className="block text-2xs font-mono text-ink-500 uppercase tracking-wider">
                Temperature · {temperature.toFixed(2)}
              </label>
              <input
                type="range" min="0" max="1.5" step="0.05"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                className="w-full"
              />
              <div className="flex justify-between text-2xs font-mono text-ink-600">
                <span>deterministic</span>
                <span>creative</span>
              </div>
            </div>
          </Section>
        </div>
      </div>

      {/* LOGS */}
      <div className="px-8 pb-8">
        <LogsTable
          logs={logs}
          onClear={() => setLogs([])}
          columns={[
            { key: 'time',    label: 'Time',   width: '90px' },
            { key: 'model',   label: 'Model',  width: '160px',
              render: (r) => <span className="truncate block max-w-[160px]">{r.model}</span> },
            { key: 'prompt',  label: 'Prompt',
              render: (r) => <span className="line-clamp-1 text-ink-400">{r.prompt}</span> },
            { key: 'tokens',  label: 'Tokens', width: '70px' },
            { key: 'tps',     label: 'tok/s',  width: '70px',
              render: (r) => r.tps.toFixed(1), className: 'text-llm' },
            { key: 'elapsed', label: 'Elapsed', width: '70px',
              render: (r) => `${r.elapsed}s` },
            { key: 'status',  label: 'Status', width: '100px' },
          ]}
        />
      </div>

      <div className="px-8 pb-8">
        <div className="bg-ink-900/40 border border-ink-800 rounded-lg p-5">
          <LauncherLogs service="llm" />
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
