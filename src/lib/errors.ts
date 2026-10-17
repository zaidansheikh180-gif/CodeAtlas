// Central error handling and observability (phase 9 part 1, spec-2 section
// 28, pack-1 #27). One categorized error model for the whole app: user-
// friendly messages for the UI, technical details kept in a local diagnostic
// log, and hard redaction so API keys, tokens and file contents never reach
// the log or an export. The log is a capped ring buffer mirrored to
// localStorage so it survives a reload; it never leaves the device except
// through the explicitly redacted diagnostics export.

export type ErrorCategory =
  | 'network'
  | 'github-api'
  | 'auth'
  | 'parsing'
  | 'indexing'
  | 'storage'
  | 'graph-query'
  | 'visualization'
  | 'model-api'

export interface AppError {
  id: string
  category: ErrorCategory
  severity: 'error' | 'warning'
  message: string // user-friendly, redacted
  detail?: string // technical, redacted
  ts: number
}

const MAX_LOG = 200
const STORAGE_KEY = 'codeatlas.errorlog.v1'

// --- Redaction ---------------------------------------------------------------

// Token and key shapes that must never appear in logs or exports. Anything
// matched is replaced with [redacted]; file contents are never logged at
// all - callers pass paths, not text.
const SENSITIVE_PATTERNS: RegExp[] = [
  /github_pat_[A-Za-z0-9_]{10,}/g,
  /gh[opsur]_[A-Za-z0-9]{10,}/g,
  /sk-[A-Za-z0-9_-]{10,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /AKIA[A-Z0-9]{16}/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]{10,}/gi,
  /[?&](token|access_token|api_key|apikey|key)=[^&\s]{8,}/gi,
]

export function redactSensitive(text: string): string {
  let out = text
  for (const pattern of SENSITIVE_PATTERNS) out = out.replace(pattern, '[redacted]')
  return out
}

// --- Categorization and user messages -----------------------------------------

// Bucket an unknown thrown value into a category from its message and any
// pipeline/github error code. Unknowns land in the given fallback.
export function categorize(message: string, code?: string, fallback: ErrorCategory = 'indexing'): ErrorCategory {
  const m = message.toLowerCase()
  if (code === 'rate_limited' || m.includes('rate limit')) return 'github-api'
  if (code === 'not_found' || code === 'invalid_url' || m.includes('github')) return 'github-api'
  if (m.includes('401') || m.includes('unauthorized') || m.includes('bad credentials')) return 'auth'
  if (code === 'network' || m.includes('failed to fetch') || m.includes('networkerror') || m.includes('network')) return 'network'
  if (m.includes('quota') || m.includes('indexeddb') || m.includes('storage') || m.includes('database')) return 'storage'
  if (m.includes('parse') || m.includes('syntax')) return 'parsing'
  if (m.includes('token') || m.includes('auth')) return 'auth'
  return fallback
}

const USER_MESSAGES: Record<ErrorCategory, string> = {
  network: 'A network request failed. Check your connection and try again.',
  'github-api': 'GitHub could not serve the request. It may be rate-limited or the repository may be unavailable - try again shortly.',
  auth: 'Authentication failed. Check the credential and try again.',
  parsing: 'Some source files could not be parsed. The rest of the index is unaffected.',
  indexing: 'Indexing failed before it finished. You can retry safely - nothing partial is kept.',
  storage: 'Browser storage failed. Free up site data or try a smaller repository.',
  'graph-query': 'The graph query could not be answered. Try rephrasing it.',
  visualization: 'The map could not be drawn. Reloading the view usually fixes it.',
  'model-api': 'The model provider could not serve the request. Check the key, model and endpoint, then try again.',
}

export function userMessage(category: ErrorCategory): string {
  return USER_MESSAGES[category]
}

// --- Diagnostic log ------------------------------------------------------------

let log: AppError[] | null = null

function load(): AppError[] {
  if (log) return log
  log = []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) log = parsed.filter((e) => e && typeof e.message === 'string').slice(-MAX_LOG)
    }
  } catch {
    // corrupt or unavailable storage: start empty
  }
  return log
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(load()))
  } catch {
    // quota full: the in-memory log still works for this session
  }
}

export function recordError(
  category: ErrorCategory,
  message: string,
  detail?: string,
  severity: 'error' | 'warning' = 'error',
): AppError {
  const entry: AppError = {
    id: `err-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    category,
    severity,
    message: redactSensitive(message).slice(0, 500),
    detail: detail ? redactSensitive(detail).slice(0, 1000) : undefined,
    ts: Date.now(),
  }
  const items = load()
  items.push(entry)
  if (items.length > MAX_LOG) items.splice(0, items.length - MAX_LOG)
  persist()
  return entry
}

export function recordWarning(category: ErrorCategory, message: string, detail?: string): AppError {
  return recordError(category, message, detail, 'warning')
}

export function getErrorLog(): AppError[] {
  return [...load()].reverse() // newest first
}

export function clearErrorLog(): void {
  log = []
  persist()
}

// --- Retry with exponential backoff ---------------------------------------------

export interface RetryOptions {
  attempts?: number // total tries including the first (default 3)
  baseMs?: number // first backoff delay (default 500ms, doubles each retry)
  signal?: AbortSignal // cancellation wins over retrying
  shouldRetry?: (error: unknown) => boolean // default: retry everything
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 3
  const baseMs = opts.baseMs ?? 500
  const shouldRetry = opts.shouldRetry ?? (() => true)
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt === attempts - 1 || !shouldRetry(error)) break
      const delay = baseMs * 2 ** attempt
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, delay)
        opts.signal?.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(new DOMException('Aborted', 'AbortError'))
        }, { once: true })
      })
    }
  }
  throw lastError
}

// --- Global crash guards ---------------------------------------------------------

// A rejection or error that escapes every handler must not crash the app:
// record it and swallow the browser's default (which would surface as a
// console-only failure the user can never see or export).
let installed = false
export function installGlobalErrorHandlers(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason instanceof Error ? event.reason.message : String(event.reason)
    recordError(categorize(reason, undefined, 'indexing'), 'Something failed in the background.', reason)
    event.preventDefault()
  })
  window.addEventListener('error', (event) => {
    recordError('visualization', 'An unexpected error occurred.', event.message)
  })
}

// --- Redacted diagnostics report ---------------------------------------------------

export interface DiagnosticsStats {
  repos: number
  files: number
  symbols: number
  edges: number
  storageUsedBytes: number | null
  storageQuotaBytes: number | null
  indexingStatus: string
}

// Build the export payload. Every string passes through redaction a second
// time on the way out, so a future caller that forgets to redact on the way
// in still cannot leak a key into a downloaded report.
export function buildDiagnosticsReport(stats: DiagnosticsStats): {
  generatedAt: string
  stats: DiagnosticsStats
  errors: AppError[]
} {
  const items = getErrorLog().map((e) => ({
    ...e,
    message: redactSensitive(e.message),
    detail: e.detail ? redactSensitive(e.detail) : undefined,
  }))
  return {
    generatedAt: new Date().toISOString(),
    stats,
    errors: items,
  }
}

export function diagnosticsReportMarkdown(stats: DiagnosticsStats): string {
  const report = buildDiagnosticsReport(stats)
  const lines = [
    '# CodeAtlas diagnostics report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Status',
    '',
    `- Repositories: ${stats.repos}`,
    `- Files: ${stats.files}`,
    `- Symbols: ${stats.symbols}`,
    `- Edges: ${stats.edges}`,
    `- Storage: ${stats.storageUsedBytes === null ? 'unknown' : `${(stats.storageUsedBytes / 1024 / 1024).toFixed(1)} MB used of ${stats.storageQuotaBytes === null ? 'unknown' : `${(stats.storageQuotaBytes / 1024 / 1024).toFixed(0)} MB`}`}`,
    `- Indexing: ${stats.indexingStatus}`,
    '',
    '## Recent errors and warnings',
    '',
    ...(report.errors.length === 0
      ? ['None recorded.']
      : report.errors.map(
          (e) =>
            `- [${e.severity}] [${e.category}] ${new Date(e.ts).toISOString()} - ${e.message}${e.detail ? ` (${e.detail})` : ''}`,
        )),
    '',
  ]
  return lines.join('\n')
}
