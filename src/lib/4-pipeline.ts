// Shared protocol between the indexing Web Worker and the page, plus the
// main-thread runner that starts the worker, forwards honest progress and
// watches the worker's liveness. Phase 3: a silently wedged worker (measured
// in phase 2, the django run stalled with no error and no event) must surface
// a named failure instead of leaving the UI waiting forever.

import { updateJob } from './db'
import type { LocalFileEntry } from './localfolder'
import type { JobStage, RepoRec } from './types'

export interface IndexRequest {
  type: 'start'
  repoId: string
  jobId: string
  repoUrl: string
  fullName: string
  commit: string
  defaultBranch: string
  ref?: string
  // Set on a re-index: the previous index's repoId. The worker reuses files
  // whose git blob sha is unchanged instead of downloading them again.
  incrementalFrom?: string
  // Local folder indexing (phase 8): when set, the worker skips all GitHub
  // fetching and indexes these entries instead. Entries carry their text
  // (fresh index or changed files on a re-scan) or just their previous
  // content hash (unchanged files on a re-scan, reused via incrementalFrom).
  local?: boolean
  localFiles?: LocalFileEntry[]
  description: string | null
  language: string | null
  sizeKb: number
  token?: string
  // Dev-only fault injection (?hang=<stage>): wedges the worker's event loop
  // at the given stage so the watchdog can be exercised end to end.
  debugHangAt?: JobStage
}

export type IndexEvent =
  | { type: 'stage'; stage: JobStage; status: 'active' | 'done'; detail?: string }
  | { type: 'progress'; stage: JobStage; done: number; total: number }
  | { type: 'heartbeat'; stage: JobStage | 'starting'; at: number }
  | { type: 'failed'; stage: JobStage | 'failed'; message: string; code?: string }
  | {
      type: 'done'
      stats: RepoRec['stats']
      timings: Record<string, number>
      excludedSecrets: { path: string; pattern: string }[]
      skipped: Record<string, number>
      unparsedLanguages: Record<string, number>
    }

const STAGE_LABEL: Record<JobStage, string> = {
  fetching: 'Download archive',
  filtering: 'Filter files',
  secrets: 'Scan for secrets',
  parsing: 'Parse code',
  graph: 'Build graph',
  storing: 'Save index',
  failed: 'Indexing',
  done: 'Indexing',
  canceled: 'Indexing',
}

// Any worker message (stage, progress, heartbeat) proves liveness. The worker
// posts a heartbeat every 2 seconds, so 15 silent seconds means the event loop
// is wedged or the worker is gone.
const SILENCE_LIMIT_MS = 15_000
// Wall-clock backstop per stage, generous enough that a healthy run inside the
// size caps never trips them; they catch a stage that stays alive but stuck.
const STAGE_LIMITS_MS: Record<JobStage, number> = {
  fetching: 5 * 60_000,
  filtering: 60_000,
  secrets: 2 * 60_000,
  parsing: 10 * 60_000,
  graph: 5 * 60_000,
  storing: 5 * 60_000,
  failed: Infinity,
  done: Infinity,
  canceled: Infinity,
}
const WATCHDOG_TICK_MS = 2_000

export function startIndexing(
  request: Omit<IndexRequest, 'type'>,
  onEvent: (event: IndexEvent) => void,
): { cancel: () => void; finished: Promise<void> } {
  const worker = new Worker(new URL('../workers/index.worker.ts', import.meta.url), {
    type: 'module',
  })
  let settled = false
  let resolveFinished!: () => void
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve
  })
  let lastActivity = Date.now()
  let activeStage: JobStage | null = null
  let stageStartedAt = Date.now()

  const settle = () => {
    if (settled) return
    settled = true
    clearInterval(watchdog)
    worker.terminate()
    resolveFinished()
  }

  const failRun = (stage: JobStage | 'failed', message: string, code: string) => {
    if (settled) return
    onEvent({ type: 'failed', stage, message, code })
    // A wedged or crashed worker cannot record its own failure, so the page
    // marks the job record failed here.
    void updateJob({
      id: request.jobId,
      repoId: request.repoId,
      stage: 'failed',
      detail: '',
      error: message,
      updatedAt: Date.now(),
    }).catch(() => {})
    settle()
  }

  const watchdog = setInterval(() => {
    const now = Date.now()
    if (now - lastActivity > SILENCE_LIMIT_MS) {
      const label = activeStage ? STAGE_LABEL[activeStage].toLowerCase() : 'starting up'
      failRun(
        activeStage ?? 'failed',
        `Indexing stalled during "${label}" - the worker stopped responding, so this run was cancelled. Try indexing again.`,
        'stalled',
      )
      return
    }
    if (activeStage && now - stageStartedAt > STAGE_LIMITS_MS[activeStage]) {
      failRun(
        activeStage,
        `The "${STAGE_LABEL[activeStage].toLowerCase()}" step did not finish in time, so this run was cancelled. The repository may be too heavy for the browser version.`,
        'timeout',
      )
    }
  }, WATCHDOG_TICK_MS)

  worker.onmessage = (message: MessageEvent<IndexEvent>) => {
    lastActivity = Date.now()
    const event = message.data
    if (event.type === 'stage') {
      if (event.status === 'active') {
        activeStage = event.stage
        stageStartedAt = Date.now()
      } else if (activeStage === event.stage) {
        activeStage = null
      }
    }
    if (event.type !== 'heartbeat') onEvent(event)
    if (event.type === 'done' || event.type === 'failed') settle()
  }
  worker.onerror = () => {
    failRun('failed', 'The indexing worker crashed unexpectedly. This run was cancelled - try indexing again.', 'worker_error')
  }
  worker.onmessageerror = () => {
    failRun('failed', 'The indexing worker sent a message this page could not read. This run was cancelled - try indexing again.', 'worker_error')
  }
  worker.postMessage({ type: 'start', ...request } satisfies IndexRequest)
  return { cancel: settle, finished }
}
