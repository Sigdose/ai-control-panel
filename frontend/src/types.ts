export type ServiceKey = 'stt' | 'llm' | 'tts'

// ──────────────────────────────────────────────
// Health (모델 서버)
// ──────────────────────────────────────────────
export interface VramInfo {
  total: number
  used: number
  reserved?: number
  free?: number
  device?: string
}

export interface HealthStatus {
  online: boolean
  latencyMs: number | null
  lastCheck: number | null
  error?: string
  raw?: any
}

// ──────────────────────────────────────────────
// Launcher
// ──────────────────────────────────────────────
export type RoleKey = 'stt' | 'tts'  // launcher가 직접 관리하는 role (LLM은 외부 ollama)

export interface RoleStatus {
  installed: boolean
  venv_path: string
  port: number
  installing: boolean
  process: ServiceProcessStatus | null
}

export interface ServiceProcessStatus {
  role: RoleKey
  running: boolean
  pid: number | null
  exit_code: number | null
  uptime: number | null
  started_at: number | null
}

export interface LauncherSystemInfo {
  platform: string
  python: string
  python_check: { ok: boolean; version: string | null }
  node:  { ok: boolean; version: string | null }
  git:   { ok: boolean; version: string | null }
  gpu:   { name: string; total_mb: number; used_mb: number } | null
  root_dir: string
}

export interface LauncherLogLine {
  t: number
  line: string
}

// ──────────────────────────────────────────────
// STT
// ──────────────────────────────────────────────
export interface SttSettings {
  model_size: string
  language: string
  beam_size: number
  vad_filter: boolean
  compute_type: string
  device: string
}
export interface SttSegment { start: number; end: number; text: string }
export interface SttResult {
  ok: boolean
  text: string
  segments: SttSegment[]
  language: string
  lang_prob: number
  audio_duration: number
  elapsed: number
  rtf: number
  vram: VramInfo
}
export interface SttLog {
  time: string
  filename?: string
  file_size_kb?: number
  audio_duration?: number
  elapsed: number
  rtf?: number
  language?: string
  text?: string
  status: string
}

// ──────────────────────────────────────────────
// LLM (Ollama)
// ──────────────────────────────────────────────
export interface OllamaModel {
  name: string
  size: number
  modified_at: string
  details?: { parameter_size?: string; quantization_level?: string }
}
export interface LlmResult {
  ok: boolean
  text: string
  model: string
  elapsed: number
  tokens?: number
  tokens_per_sec?: number
}

// ──────────────────────────────────────────────
// TTS
// ──────────────────────────────────────────────
export interface TtsSettings {
  language: string
  audio_prompt: string
  normalize: boolean
  line_threshold: number
  exaggeration: number
  cfg_weight: number
}
export interface TtsVoice { name: string; path: string }
export interface TtsLog {
  time: string
  text: string
  language: string
  voice: string
  elapsed: number
  vram_total?: number
  status: string
  cache_file?: string | null
}
