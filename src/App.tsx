// Top-level state machine: landing -> indexing -> repo view. URL-based routing
// and share links arrive in a later phase; phase 1 keeps view state in memory.

import { useCallback, useState } from 'react'
import Landing, { type IndexTarget } from './components/Landing'
import Indexing, { type StageInfo } from './components/Indexing'
import RepoView from './components/RepoView'
import { startIndexing, type IndexEvent } from './lib/pipeline'
import type { JobStage } from './lib/types'

type View =
  | { kind: 'landing' }
  | { kind: 'indexing'; target: IndexTarget }
  | { kind: 'repo'; repoId: string }

const INITIAL_STAGES: StageInfo[] = (['fetching', 'filtering', 'secrets', 'parsing', 'graph', 'storing'] as JobStage[]).map(
  (stage) => ({ stage, status: 'pending' }),
)

export default function App() {
  const [view, setView] = useState<View>({ kind: 'landing' })
  const [stages, setStages] = useState<StageInfo[]>(INITIAL_STAGES)
  const [progress, setProgress] = useState<{ stage: JobStage; done: number; total: number } | null>(null)
  const [failure, setFailure] = useState<{ message: string } | null>(null)
  const [lastEvent, setLastEvent] = useState<IndexEvent | null>(null)

  const handleEvent = useCallback((event: IndexEvent) => {
    if (import.meta.env.DEV) console.info('[codeatlas]', JSON.stringify(event))
    // Heartbeats feed the pipeline watchdog only; they carry no UI state.
    if (event.type === 'heartbeat') return
    setLastEvent(event)
    if (event.type === 'stage') {
      setStages((prev) =>
        prev.map((s) => (s.stage === event.stage ? { ...s, status: event.status, detail: event.detail ?? s.detail } : s)),
      )
    } else if (event.type === 'progress') {
      setProgress({ stage: event.stage, done: event.done, total: event.total })
    } else if (event.type === 'failed') {
      setFailure({ message: event.message })
    }
  }, [])

  const start = useCallback(
    (target: IndexTarget) => {
      setStages(INITIAL_STAGES)
      setProgress(null)
      setFailure(null)
      setLastEvent(null)
      setView({ kind: 'indexing', target })
      const jobId = `${target.repoId}:job:${Date.now()}`
      // Dev-only fault injection for the phase-3 watchdog: ?hang=<stage>
      // wedges the worker at that stage so the stall path can be tested.
      const hang = import.meta.env.DEV
        ? (new URLSearchParams(window.location.search).get('hang') as JobStage | null)
        : null
      const { cancel } = startIndexing(
        {
          repoId: target.repoId,
          jobId,
          repoUrl: target.repoUrl,
          fullName: target.fullName,
          commit: target.commit,
          defaultBranch: target.defaultBranch,
          ref: target.ref,
          incrementalFrom: target.incrementalFrom,
          description: target.description,
          language: target.language,
          sizeKb: target.sizeKb,
          ...(hang ? { debugHangAt: hang } : {}),
        },
        handleEvent,
      )
      setCancelFn(() => cancel)
    },
    [handleEvent],
  )

  const [cancelFn, setCancelFn] = useState<(() => void) | null>(null)

  return (
    <div className="h-full">
      {view.kind === 'landing' && (
        <Landing onStart={start} onOpen={(repoId) => setView({ kind: 'repo', repoId })} />
      )}
      {view.kind === 'indexing' && (
        <Indexing
          fullName={view.target.fullName}
          stages={stages}
          progress={progress}
          failure={failure}
          lastEvent={lastEvent}
          onCancel={() => {
            cancelFn?.()
            setView({ kind: 'landing' })
          }}
          onDone={() => setView({ kind: 'repo', repoId: view.target.repoId })}
        />
      )}
      {view.kind === 'repo' && (
        <RepoView repoId={view.repoId} onBack={() => setView({ kind: 'landing' })} onReindex={start} onOpenRepo={(id) => setView({ kind: 'repo', repoId: id })} />
      )}
    </div>
  )
}
