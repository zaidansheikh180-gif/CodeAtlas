// Semantic extraction (phase 7 part 3, spec-2 section 14, pack-1 #10): an
// optional layer that asks the visitor's own model for higher-level
// relationships static parsing cannot see - conceptual dependencies, feature
// groups, architecture themes. Everything it produces is marked INFERRED and
// stored in dedicated IndexedDB stores, separate from the deterministic
// graph. The key-free graph never depends on it.

import { chatOnce, estimateTokens, ProviderError } from './providers'
import type { Settings } from './settings'

export interface SemanticFile {
  path: string
  text: string
}

export type SemanticKind = 'dependency' | 'feature-group' | 'theme'

export interface SemanticFinding {
  fromPath: string
  // Null for themes that describe one file or module alone.
  toPath: string | null
  kind: SemanticKind
  label: string
  evidence: string
}

export interface SemanticBatch {
  files: SemanticFile[]
  tokens: number
}

// Per-file content cap keeps one huge file from eating a whole batch.
const PER_FILE_CHARS = 6000

export function buildBatches(files: SemanticFile[], maxTokensPerBatch: number): SemanticBatch[] {
  const batches: SemanticBatch[] = []
  let current: SemanticFile[] = []
  let tokens = 0
  for (const file of files) {
    const text = file.text.length > PER_FILE_CHARS ? file.text.slice(0, PER_FILE_CHARS) : file.text
    const cost = estimateTokens(text) + estimateTokens(file.path) + 20
    if (current.length > 0 && tokens + cost > maxTokensPerBatch) {
      batches.push({ files: current, tokens })
      current = []
      tokens = 0
    }
    current.push({ path: file.path, text })
    tokens += cost
  }
  if (current.length > 0) batches.push({ files: current, tokens })
  return batches
}

export const SEMANTIC_SYSTEM = `You analyze source files for relationships that static parsing cannot detect.
Answer with JSON lines only - one JSON object per line, no prose, no code fences. Each line:
{"from": "<path from the input>", "to": "<path from the input or null>", "kind": "dependency"|"feature-group"|"theme", "label": "<short name>", "evidence": "<one sentence grounded in the code>"}
Rules: "from" and "to" must be paths exactly as given. Use "dependency" for conceptual dependencies (not import statements), "feature-group" for files implementing one feature together, "theme" for an architectural theme of a single file or module ("to": null). At most 8 lines. If nothing meaningful exists, answer with no lines.`

export function buildExtractionPrompt(batch: SemanticBatch): string {
  const parts = batch.files.map(
    (f) => `--- ${f.path}${f.text.length >= PER_FILE_CHARS ? ' (truncated)' : ''} ---\n${f.text}`,
  )
  return `Find higher-level relationships in these files.\n\n${parts.join('\n\n')}`
}

// Tolerant parser: the model is asked for JSON lines, but real responses add
// fences or prose. Extract every {...} line, validate kinds, and drop
// findings whose paths are not in the analyzed set (hallucinated paths).
export function parseSemanticResponse(text: string, validPaths: Set<string>): SemanticFinding[] {
  const findings: SemanticFinding[] = []
  const kinds: SemanticKind[] = ['dependency', 'feature-group', 'theme']
  for (const line of text.split('\n')) {
    const trimmed = line.trim().replace(/^```.*$/, '')
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) continue
    try {
      const raw = JSON.parse(trimmed) as Record<string, unknown>
      const from = typeof raw.from === 'string' ? raw.from : null
      const to = typeof raw.to === 'string' ? raw.to : null
      const kind = kinds.find((k) => k === raw.kind)
      if (!from || !validPaths.has(from)) continue
      if (to !== null && !validPaths.has(to)) continue
      if (!kind) continue
      findings.push({
        fromPath: from,
        toPath: to,
        kind,
        label: typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim().slice(0, 120) : kind,
        evidence: typeof raw.evidence === 'string' ? raw.evidence.trim().slice(0, 300) : '',
      })
    } catch {
      // Unparseable line: skip it, keep the rest.
    }
  }
  return findings
}

export interface ExtractionProgress {
  doneBatches: number
  totalBatches: number
  tokensEstimated: number
  findings: number
}

export interface ExtractionOptions {
  settings: Settings
  files: SemanticFile[]
  concurrency: number
  signal?: AbortSignal
  onProgress?: (progress: ExtractionProgress) => void
  // Called once before the first request leaves the device (privacy report).
  onFirstSend?: () => void
}

export interface ExtractionResult {
  findings: SemanticFinding[]
  batches: number
  tokensEstimated: number
  failedBatches: number
  errors: string[]
  canceled: boolean
}

const MAX_TOKENS_PER_BATCH = 6000
const RETRIES = 2

export async function runSemanticExtraction(opts: ExtractionOptions): Promise<ExtractionResult> {
  const batches = buildBatches(opts.files, MAX_TOKENS_PER_BATCH)
  const tokensEstimated = batches.reduce((sum, b) => sum + b.tokens, 0)
  const findings: SemanticFinding[] = []
  const errors: string[] = []
  const validPaths = new Set(opts.files.map((f) => f.path))
  let doneBatches = 0
  let failedBatches = 0
  let sent = false

  const runBatch = async (batch: SemanticBatch) => {
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      if (opts.signal?.aborted) throw new ProviderError('Canceled.', 'canceled', false)
      try {
        if (!sent) {
          sent = true
          opts.onFirstSend?.()
        }
        const res = await chatOnce({
          settings: opts.settings,
          system: SEMANTIC_SYSTEM,
          prompt: buildExtractionPrompt(batch),
          maxOutputTokens: Math.min(opts.settings.maxOutputTokens, 1024),
          signal: opts.signal,
        })
        findings.push(...parseSemanticResponse(res.text, validPaths))
        return
      } catch (error) {
        const providerError =
          error instanceof ProviderError ? error : new ProviderError('Unexpected error during extraction.', 'provider', true)
        if (providerError.code === 'canceled') throw providerError
        if (attempt >= RETRIES || !providerError.retryable) {
          failedBatches++
          errors.push(providerError.message)
          return
        }
        await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)))
      }
    }
  }

  // Small worker pool keeps concurrency honest and cancelable.
  const queue = [...batches]
  const workers = Array.from({ length: Math.max(1, Math.min(4, opts.concurrency)) }, async () => {
    while (queue.length > 0) {
      if (opts.signal?.aborted) return
      const batch = queue.shift()
      if (!batch) return
      await runBatch(batch)
      doneBatches++
      opts.onProgress?.({ doneBatches, totalBatches: batches.length, tokensEstimated, findings: findings.length })
    }
  })
  try {
    await Promise.all(workers)
  } catch (error) {
    if (error instanceof ProviderError && error.code === 'canceled') {
      return { findings, batches: batches.length, tokensEstimated, failedBatches, errors, canceled: true }
    }
    throw error
  }
  return { findings, batches: batches.length, tokensEstimated, failedBatches, errors, canceled: false }
}

// --- Storage records (IndexedDB stores live in db.ts, schema v4) ---

export interface SemanticRunRec {
  id: string
  repoId: string
  provider: string
  model: string
  scopePaths: string[]
  status: 'running' | 'done' | 'canceled' | 'failed'
  batches: number
  tokensEstimated: number
  findingsCount: number
  failedBatches: number
  errors: string[]
  startedAt: number
  finishedAt: number | null
}

export interface SemanticEdgeRec {
  id: string
  repoId: string
  runId: string
  fromPath: string
  toPath: string | null
  kind: SemanticKind
  label: string
  evidence: string
  // Always 'inferred': semantic findings never masquerade as extracted edges.
  confidence: 'inferred'
}

export function semanticEdgeId(runId: string, finding: SemanticFinding): string {
  return `${runId}:${finding.fromPath}->${finding.toPath ?? ''}:${finding.kind}:${finding.label}`
}
