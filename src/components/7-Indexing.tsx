// Per-stage indexing progress. Status is honest: stages report real counts,
// and the parsing stage shows real x-of-y progress. No fake percentages.

import { useRef } from 'react'
import type { IndexEvent } from '../lib/pipeline'
import { filesPerSecond } from '../lib/perf'
import type { JobStage } from '../lib/types'

export interface StageInfo {
  stage: JobStage
  status: 'pending' | 'active' | 'done' | 'failed'
  detail?: string
}

interface Props {
  fullName: string
  // Local folder indexing (phase 8): the first stage reads the device, not
  // the network, and the heading says so.
  local?: boolean
  stages: StageInfo[]
  progress: { stage: JobStage; done: number; total: number } | null
  failure: { message: string } | null
  lastEvent: IndexEvent | null
  onCancel: () => void
  onDone: () => void
}

const STAGE_ORDER: { stage: JobStage; label: string }[] = [
  { stage: 'fetching', label: 'Download archive' },
  { stage: 'filtering', label: 'Filter files' },
  { stage: 'secrets', label: 'Scan for secrets' },
  { stage: 'parsing', label: 'Parse code' },
  { stage: 'graph', label: 'Build graph' },
  { stage: 'storing', label: 'Save index' },
]

export default function Indexing({ fullName, local = false, stages, progress, failure, lastEvent, onCancel, onDone }: Props) {
  // Throughput metric (phase 9 part 2): files/s while the parse stage runs.
  const progressStart = useRef<{ stage: string; at: number } | null>(null)
  if (progress && progressStart.current?.stage !== progress.stage) {
    progressStart.current = { stage: progress.stage, at: Date.now() }
  }
  const rate =
    progress && progressStart.current ? filesPerSecond(progress.done, progressStart.current.at, Date.now()) : null
  const finished = lastEvent?.type === 'done'
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-lg">
        <p className="text-sm text-ink-3">Indexing</p>
        <h1 className="mt-1 font-mono text-xl font-semibold text-ink">{fullName}</h1>
        {local && (
          <p className="mt-1 text-xs text-dragon">Local folder - files stay on this device, nothing is downloaded or uploaded.</p>
        )}

        <ol className="mt-8 space-y-3">
          {STAGE_ORDER.map(({ stage, label: stageLabel }) => {
            const label = local && stage === 'fetching' ? 'Read local files' : stageLabel
            const info = stages.find((s) => s.stage === stage)
            const status = failure && info?.status === 'active' ? 'failed' : (info?.status ?? 'pending')
            return (
              <li key={stage} className="flex items-start gap-3">
                <span
                  aria-hidden
                  className={`mt-1 h-3 w-3 shrink-0 rounded-full ${
                    status === 'done'
                      ? 'bg-success'
                      : status === 'active'
                        ? 'animate-pulse bg-dragon'
                        : status === 'failed'
                          ? 'bg-error'
                          : 'bg-surface-3'
                  }`}
                />
                <div className="min-w-0">
                  <p className={`text-sm font-medium ${status === 'pending' ? 'text-ink-3' : 'text-ink'}`}>{label}</p>
                  {info?.detail && <p className="mt-0.5 text-xs text-ink-2">{info.detail}</p>}
                  {status === 'active' && progress?.stage === stage && (
                    <p className="tabular mt-0.5 text-xs text-ink-3">
                      {progress.done} of {progress.total}
                      {rate !== null && progress.stage === stage ? ` - ${rate.toFixed(1)} files/s` : ''}
                    </p>
                  )}
                </div>
              </li>
            )
          })}
        </ol>

        {failure && (
          <div role="alert" className="mt-6 rounded-lg border border-error/40 bg-surface-1 p-3 text-sm text-error">
            {failure.message}
          </div>
        )}
        {finished && lastEvent.type === 'done' && (lastEvent.excludedSecrets.length > 0 || lastEvent.skipped.overCaps > 0) && (
          <div className="mt-6 rounded-lg border border-line bg-surface-1 p-3 text-sm text-ink-2">
            {lastEvent.excludedSecrets.length > 0 && (
              <p>
                Excluded {lastEvent.excludedSecrets.length} file(s) that look like credentials:{' '}
                {lastEvent.excludedSecrets.map((e) => e.path).join(', ')}. Scanning reduces exposure; it is not a guarantee.
              </p>
            )}
            {lastEvent.skipped.overCaps > 0 && (
              <p className="mt-1">Some files were skipped because the repository exceeds the browser size caps.</p>
            )}
          </div>
        )}

        <div className="mt-8 flex gap-2">
          {finished ? (
            <button
              onClick={onDone}
              className="rounded-lg bg-dragon px-4 py-2 text-sm font-semibold text-night hover:bg-dragon-deep"
            >
              Open the map
            </button>
          ) : (
            <button
              onClick={onCancel}
              className="rounded-lg border border-line px-4 py-2 text-sm text-ink-2 hover:border-ink-3"
            >
              {failure ? 'Back' : 'Cancel'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
