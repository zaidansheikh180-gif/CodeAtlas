// Top-level state machine: landing -> indexing -> repo view. URL-based routing
// and share links arrive in a later phase; phase 1 keeps view state in memory.

import { useCallback, useEffect, useState } from 'react'
import Landing, { type IndexTarget } from './components/Landing'
import Indexing, { type StageInfo } from './components/Indexing'
import GlobalView from './components/GlobalView'
import RepoView from './components/RepoView'
import { startIndexing, type IndexEvent } from './lib/pipeline'
import { persistLocalHandle, registerLocalHandle } from './lib/handles'
import { categorize, installGlobalErrorHandlers, recordError, userMessage } from './lib/errors'
import ErrorBoundary from './components/ErrorBoundary'
import StatusPanel from './components/StatusPanel'
import SettingsPanel from './components/SettingsPanel'
import { getCachedSettings, loadSettings } from './lib/settings'
import type { JobStage } from './lib/types'

type View =
  | { kind: 'landing' }
  | { kind: 'indexing'; target: IndexTarget }
  | { kind: 'repo'; repoId: string }
  | { kind: 'global' }

const INITIAL_STAGES: StageInfo[] = (['fetching', 'filtering', 'secrets', 'parsing', 'graph', 'storing'] as JobStage[]).map(
  (stage) => ({ stage, status: 'pending' }),
)

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [view, setView] = useState<View>({ kind: 'landing' })
  const [stages, setStages] = useState<StageInfo[]>(INITIAL_STAGES)
  const [progress, setProgress] = useState<{ stage: JobStage; done: number; total: number } | null>(null)
  const [failure, setFailure] = useState<{ message: string } | null>(null)
  const [lastEvent, setLastEvent] = useState<IndexEvent | null>(null)

  useEffect(() => {
    // Apply the saved theme (phase 7 part 1). Default is Night Violet dark.
    void loadSettings().then((s) => {
      document.documentElement.dataset.theme = s.theme
    })
  }, [])

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
      const category = categorize(event.message, event.code)
      recordError(category, userMessage(category), event.message)
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
          local: target.local,
          localFiles: target.localFiles,
          token: target.token,
          // getCachedSettings is write-through: panel changes apply to the
          // next index without a reload.
          excludeGlobs: getCachedSettings().excludeGlobs,
          excludeFolders: getCachedSettings().excludeFolders,
          sensitiveGlobs: getCachedSettings().sensitiveGlobs,
          maxFileBytes: getCachedSettings().maxFileKb * 1024,
          ...(hang ? { debugHangAt: hang } : {}),
        },
        (event) => {
          handleEvent(event)
          // The folder handle never enters the worker: it is a live
          // capability, kept on the main thread (session registry plus
          // best-effort IndexedDB persistence for reloads).
          if (event.type === 'done' && target.localHandle) void persistLocalHandle(target.repoId, target.localHandle)
        },
      )
      if (target.localHandle) registerLocalHandle(target.repoId, target.localHandle)
      setCancelFn(() => cancel)
    },
    [handleEvent],
  )

  const [cancelFn, setCancelFn] = useState<(() => void) | null>(null)
  const [statusOpen, setStatusOpen] = useState(false)

  // Phase 9 part 1: no rejection or error escapes without a diagnostic record.
  useEffect(() => {
    installGlobalErrorHandlers()
  }, [])

  const activeStage = stages.find((s) => s.status === 'active')
  const indexingStatus =
    view.kind === 'indexing'
      ? `Indexing ${view.target.fullName}${activeStage ? ` - ${activeStage.stage}` : ''}${failure ? ` - failed: ${failure.message}` : ''}`
      : 'Idle'

  return (
    <div className="h-full">
      {view.kind === 'landing' && (
        <Landing
          onStart={start}
          onOpen={(repoId) => setView({ kind: 'repo', repoId })}
          onOpenGlobal={() => setView({ kind: 'global' })}
          onOpenStatus={() => setStatusOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}
      {statusOpen && <StatusPanel indexingStatus={indexingStatus} onClose={() => setStatusOpen(false)} />}
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      {view.kind === 'indexing' && (
        <Indexing
          fullName={view.target.fullName}
          local={view.target.local ?? false}
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
      {view.kind === 'global' && <GlobalView onBack={() => setView({ kind: 'landing' })} onOpenRepo={(id) => setView({ kind: 'repo', repoId: id })} />}
      {view.kind === 'repo' && (
        <ErrorBoundary onReset={() => setView({ kind: 'landing' })}>
          <RepoView repoId={view.repoId} onBack={() => setView({ kind: 'landing' })} onReindex={start} onOpenRepo={(id) => setView({ kind: 'repo', repoId: id })} />
        </ErrorBoundary>
      )}
    </div>
  )
}
