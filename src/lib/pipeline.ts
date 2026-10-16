// Shared protocol between the indexing Web Worker and the page, plus the
// main-thread runner that starts the worker and forwards honest progress.

import type { JobStage, RepoRec } from './types'

export interface IndexRequest {
  type: 'start'
  repoId: string
  jobId: string
  repoUrl: string
  fullName: string
  commit: string
  defaultBranch: string
  description: string | null
  language: string | null
  sizeKb: number
  token?: string
}

export type IndexEvent =
  | { type: 'stage'; stage: JobStage; status: 'active' | 'done'; detail?: string }
  | { type: 'progress'; stage: JobStage; done: number; total: number }
  | { type: 'failed'; stage: JobStage; message: string; code?: string }
  | {
      type: 'done'
      stats: RepoRec['stats']
      timings: Record<string, number>
      excludedSecrets: { path: string; pattern: string }[]
      skipped: Record<string, number>
      unparsedLanguages: Record<string, number>
    }

export function startIndexing(
  request: Omit<IndexRequest, 'type'>,
  onEvent: (event: IndexEvent) => void,
): { cancel: () => void; finished: Promise<void> } {
  const worker = new Worker(new URL('../workers/index.worker.ts', import.meta.url), {
    type: 'module',
  })
  let cancel: () => void = () => worker.terminate()
  const finished = new Promise<void>((resolve) => {
    worker.onmessage = (message: MessageEvent<IndexEvent>) => {
      onEvent(message.data)
      if (message.data.type === 'done' || message.data.type === 'failed') {
        worker.terminate()
        resolve()
      }
    }
    worker.onerror = () => {
      onEvent({ type: 'failed', stage: 'failed', message: 'The indexing worker stopped unexpectedly. Try again.' })
      worker.terminate()
      resolve()
    }
    worker.postMessage({ type: 'start', ...request } satisfies IndexRequest)
  })
  return { cancel, finished }
}
