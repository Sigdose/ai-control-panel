// ──────────────────────────────────────────────
// 공통
// ──────────────────────────────────────────────
export type ServiceKey = 'stt' | 'llm' | 'tts'
export type ServiceMode = 'local' | 'remote'

// ──────────────────────────────────────────────
// Launcher (제어 경로)
// ──────────────────────────────────────────────
export interface ServiceProfile {
  mode: ServiceMode
  command: string    // Local 모드일 때 실행할 명령어 (venv python 경로 포함)
  cwd: string        // 작업 디렉토리
  env: Record<string, string>  // 추가 환경변수
}

export interface LauncherStatus {
  service: ServiceKey
  running: boolean
  pid: number | null
  exit_code: number | null
  command: string | null
  cwd: string | null
  uptime: number | null
  started_at: number | null
}

export interface LauncherLogLine {
  t: number
  line: string
}

export interface LauncherLogs {
  stdout: LauncherLogLine[]
  stderr: LauncherLogLine[]
  running: boolean
}


export interface VramInfo {
  total: number
  used: number
  reserved: number
  free: number
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

export interface SttSegment {
  start: number
  end: number
  text: string
}

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
  details?: {
    parameter_size?: string
    quantization_level?: string
  }
}

export interface LlmRequest {
  model: string
  prompt: string
  system?: string
  temperature?: number
  stream?: boolean
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

export interface TtsVoice {
  name: string
  path: string
}

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
