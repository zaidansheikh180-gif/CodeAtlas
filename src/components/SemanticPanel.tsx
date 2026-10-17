// Semantic extraction panel (phase 7 part 3, spec-2 section 14, pack-1 #10):
// optional model-powered relationship discovery. The visitor picks a scope,
// sees exactly which files and how many estimated tokens will be sent before
// anything leaves the device, then runs batched extraction with progress,
// retries and cancel. Findings are always labelled INFERRED, stored in the
// dedicated semantic stores, and deletable per run. The deterministic graph
// works the same with or without this panel.

import { useEffect, useMemo, useRef, useState } from 'react'
import { deleteSemanticRun, listSemanticEdges, listSemanticRuns, putSemanticEdges, putSemanticRun } from '../lib/db'
import { hasKey, markExternalSend } from '../lib/keys'
import { estimateTokens } from '../lib/providers'
import {
  runSemanticExtraction,
  semanticEdgeId,
  type SemanticEdgeRec,
  type SemanticFile,
  type SemanticRunRec,
} from '../lib/semantic'
import { loadSettings, saveSettings, type Settings } from '../lib/settings'
import type { FileRec } from '../lib/types'

interface Props {
  repoId: string
  repoName: string
  files: FileRec[]
  onClose: () => void
}

type RunState =
  | { kind: 'idle' }
  | { kind: 'running'; doneBatches: number; totalBatches: number; findings: number }
  | { kind: 'done'; run: SemanticRunRec }
  | { kind: 'error'; message: string }

const KIND_LABEL: Record<string, string> = {
  dependency: 'Conceptual dependency',
  'feature-group': 'Feature group',
  theme: 'Architecture theme',
}

export default function SemanticPanel({ repoId, repoName, files, onClose }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [runs, setRuns] = useState<SemanticRunRec[]>([])
  const [edges, setEdges] = useState<SemanticEdgeRec[]>([])
  const [scope, setScope] = useState<Set<string>>(new Set(['*']))
  const [concurrency, setConcurrency] = useState(2)
  const [noticeAccepted, setNoticeAccepted] = useState(false)
  const [state, setState] = useState<RunState>({ kind: 'idle' })
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      const [s, r, e] = await Promise.all([loadSettings(), listSemanticRuns(repoId), listSemanticEdges(repoId)])
      if (!alive) return
      setSettings(s)
      setNoticeAccepted(s.privacyNoticeSeen)
      setRuns(r.sort((a, b) => b.startedAt - a.startedAt))
      setEdges(e)
    })()
    return () => {
      alive = false
    }
  }, [repoId])

  // Scope choices: every top-level folder, plus "everything".
  const folders = useMemo(() => {
    const set = new Set<string>()
    for (const file of files) {
      const idx = file.path.indexOf('/')
      set.add(idx > 0 ? file.path.slice(0, idx) : '(root)')
    }
    return [...set].sort()
  }, [files])

  const scopedFiles: SemanticFile[] = useMemo(() => {
    if (scope.has('*')) return files.map((f) => ({ path: f.path, text: f.text }))
    return files
      .filter((f) => {
        const idx = f.path.indexOf('/')
        return scope.has(idx > 0 ? f.path.slice(0, idx) : '(root)')
      })
      .map((f) => ({ path: f.path, text: f.text }))
  }, [files, scope])

  const estimatedTokens = useMemo(
    () => scopedFiles.reduce((sum, f) => sum + estimateTokens(f.text.slice(0, 6000)) + estimateTokens(f.path) + 20, 0),
    [scopedFiles],
  )

  if (!settings) return null

  const providerReady =
    settings.provider === 'ollama' || (settings.provider === 'gemini' && hasKey('gemini'))

  async function startRun() {
    if (!settings) return
    if (!settings.privacyNoticeSeen) {
      const next = { ...settings, privacyNoticeSeen: true }
      await saveSettings(next)
      setSettings(next)
    }
    const runId = `${repoId}:semrun:${Date.now()}`
    const run: SemanticRunRec = {
      id: runId,
      repoId,
      provider: settings.provider,
      model: settings.model,
      scopePaths: scope.has('*') ? ['*'] : [...scope],
      status: 'running',
      batches: 0,
      tokensEstimated: estimatedTokens,
      findingsCount: 0,
      failedBatches: 0,
      errors: [],
      startedAt: Date.now(),
      finishedAt: null,
    }
    await putSemanticRun(run)
    const controller = new AbortController()
    abortRef.current = controller
    setState({ kind: 'running', doneBatches: 0, totalBatches: 0, findings: 0 })
    try {
      const result = await runSemanticExtraction({
        settings,
        files: scopedFiles,
        concurrency,
        signal: controller.signal,
        onFirstSend: () => markExternalSend(settings.provider, 'semantic extraction'),
        onProgress: (p) => setState({ kind: 'running', doneBatches: p.doneBatches, totalBatches: p.totalBatches, findings: p.findings }),
      })
      const newEdges: SemanticEdgeRec[] = result.findings.map((finding) => ({
        id: semanticEdgeId(runId, finding),
        repoId,
        runId,
        fromPath: finding.fromPath,
        toPath: finding.toPath,
        kind: finding.kind,
        label: finding.label,
        evidence: finding.evidence,
        confidence: 'inferred',
      }))
      await putSemanticEdges(newEdges)
      const finished: SemanticRunRec = {
        ...run,
        status: result.canceled ? 'canceled' : result.failedBatches > 0 && result.findings.length === 0 ? 'failed' : 'done',
        batches: result.batches,
        findingsCount: result.findings.length,
        failedBatches: result.failedBatches,
        errors: result.errors,
        finishedAt: Date.now(),
      }
      await putSemanticRun(finished)
      setEdges((prev) => [...prev, ...newEdges])
      setRuns((prev) => [finished, ...prev])
      setState({ kind: 'done', run: finished })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Extraction failed.'
      await putSemanticRun({ ...run, status: 'failed', errors: [message], finishedAt: Date.now() })
      setState({ kind: 'error', message })
    } finally {
      abortRef.current = null
    }
  }

  async function removeRun(run: SemanticRunRec) {
    await deleteSemanticRun(run.id, repoId)
    setRuns((prev) => prev.filter((r) => r.id !== run.id))
    setEdges((prev) => prev.filter((e) => e.runId !== run.id))
  }

  const running = state.kind === 'running'
  const needsNotice = !noticeAccepted && providerReady

  return (
    <div className="absolute right-0 top-0 z-30 flex h-full w-full max-w-md flex-col border-l border-line bg-night" role="dialog" aria-label="Semantic extraction">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">Semantic extraction</h2>
          <p className="text-xs text-ink-3">Model-inferred relationships for {repoName} - always labelled INFERRED.</p>
        </div>
        <button onClick={onClose} className="rounded-lg border border-line px-2.5 py-1 text-xs text-ink-2 hover:border-dragon hover:text-ink">
          Close
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {!providerReady && (
          <div className="rounded-lg border border-warning/40 bg-surface-1 p-3 text-xs text-ink-2">
            {settings.provider === 'none'
              ? 'No model provider configured. Open Settings and choose Gemini (your API key) or Ollama (your endpoint). The key-free graph works without any of this.'
              : 'No Gemini key saved. Add your own key in Settings - it stays in this browser.'}
          </div>
        )}

        {providerReady && (
          <>
            <section className="rounded-lg border border-line bg-surface-1 p-3">
              <h3 className="text-xs font-semibold text-ink">Scope</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                <label className="flex items-center gap-1.5 text-xs text-ink-2">
                  <input
                    type="checkbox"
                    checked={scope.has('*')}
                    onChange={(e) => setScope(e.target.checked ? new Set(['*']) : new Set())}
                  />
                  Entire repository ({files.length} files)
                </label>
                {!scope.has('*') &&
                  folders.map((folder) => (
                    <label key={folder} className="flex items-center gap-1.5 text-xs text-ink-2">
                      <input
                        type="checkbox"
                        checked={scope.has(folder)}
                        onChange={(e) => {
                          const next = new Set(scope)
                          if (e.target.checked) next.add(folder)
                          else next.delete(folder)
                          setScope(next)
                        }}
                      />
                      {folder}/
                    </label>
                  ))}
              </div>
              {folders.length > 1 && (
                <button
                  onClick={() => setScope(scope.has('*') ? new Set() : new Set(['*']))}
                  className="mt-2 text-xs text-dragon hover:underline"
                >
                  {scope.has('*') ? 'Select folders instead' : 'Select the entire repository'}
                </button>
              )}
              <div className="mt-3 flex items-center gap-3">
                <label className="text-xs text-ink-2">
                  Concurrency
                  <select
                    aria-label="Concurrency"
                    className="ml-2 rounded border border-line bg-surface-2 px-1.5 py-0.5 text-xs text-ink"
                    value={concurrency}
                    onChange={(e) => setConcurrency(Number(e.target.value))}
                    disabled={running}
                  >
                    {[1, 2, 3, 4].map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </label>
                <span className="text-xs text-ink-3">
                  {scopedFiles.length} files, about {estimatedTokens.toLocaleString()} tokens
                </span>
              </div>
            </section>

            {needsNotice && (
              <section className="rounded-lg border border-warning/40 bg-surface-1 p-3 text-xs text-ink-2" aria-label="Privacy notice">
                <p className="font-medium text-ink">Before the first model request</p>
                <p className="mt-1">
                  Extraction sends the {scopedFiles.length} selected files (about {estimatedTokens.toLocaleString()} tokens) directly from this
                  browser to {settings.provider === 'gemini' ? 'Google Gemini' : 'your Ollama endpoint'} using your own {settings.provider === 'gemini' ? 'key' : 'endpoint'}.
                  Nothing goes to any CodeAtlas server - there is none. Findings are stored only in this browser and are always marked INFERRED.
                </p>
                <p className="mt-1 text-ink-3">Files in scope: {scopedFiles.slice(0, 8).map((f) => f.path).join(', ')}{scopedFiles.length > 8 ? ` and ${scopedFiles.length - 8} more` : ''}</p>
                <button
                  onClick={() => {
                    setNoticeAccepted(true)
                    void startRun()
                  }}
                  className="mt-2 rounded-lg bg-dragon px-3 py-1.5 text-xs font-semibold text-night hover:bg-dragon-deep"
                >
                  I understand - run extraction
                </button>
              </section>
            )}

            {!needsNotice && (
              <div className="flex items-center gap-2">
                {!running ? (
                  <button
                    onClick={() => void startRun()}
                    disabled={scopedFiles.length === 0}
                    className="rounded-lg bg-dragon px-3 py-1.5 text-xs font-semibold text-night hover:bg-dragon-deep disabled:opacity-50"
                  >
                    Run extraction
                  </button>
                ) : (
                  <button
                    onClick={() => abortRef.current?.abort()}
                    className="rounded-lg border border-error/50 px-3 py-1.5 text-xs text-error hover:bg-error hover:text-night"
                  >
                    Cancel
                  </button>
                )}
                {state.kind === 'error' && (
                  <button onClick={() => void startRun()} className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-2 hover:border-dragon hover:text-ink">
                    Retry
                  </button>
                )}
              </div>
            )}

            {running && (
              <div role="status" aria-live="polite" className="rounded-lg border border-line bg-surface-1 p-3 text-xs text-ink-2">
                Running batch {state.doneBatches + 1} of {state.totalBatches || '…'} - {state.findings} findings so far.
              </div>
            )}
            {state.kind === 'done' && (
              <div role="status" className="rounded-lg border border-success/40 bg-surface-1 p-3 text-xs text-ink-2">
                {state.run.status === 'canceled' ? 'Canceled.' : 'Done.'} {state.run.findingsCount} inferred findings
                {state.run.failedBatches > 0 ? ` - ${state.run.failedBatches} batch(es) failed (${state.run.errors[0] ?? 'error'})` : ''}.
              </div>
            )}
            {state.kind === 'error' && (
              <div role="alert" className="rounded-lg border border-error/40 bg-surface-1 p-3 text-xs text-error">{state.message}</div>
            )}
          </>
        )}

        {edges.length > 0 && (
          <section>
            <h3 className="text-xs font-semibold text-ink">Inferred relationships ({edges.length})</h3>
            <ul className="mt-2 space-y-2">
              {edges.map((edge) => (
                <li key={edge.id} className="rounded-lg border border-line bg-surface-1 p-2.5 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="rounded border border-warning/50 px-1.5 py-0.5 text-[10px] font-medium text-warning">INFERRED</span>
                    <span className="text-ink-3">{KIND_LABEL[edge.kind] ?? edge.kind}</span>
                  </div>
                  <p className="mt-1 font-mono text-ink">
                    {edge.fromPath}
                    {edge.toPath ? ` -> ${edge.toPath}` : ''}
                  </p>
                  <p className="mt-0.5 text-ink-2">{edge.label}{edge.evidence ? ` - ${edge.evidence}` : ''}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {runs.length > 0 && (
          <section>
            <h3 className="text-xs font-semibold text-ink">Past runs</h3>
            <ul className="mt-2 space-y-1.5">
              {runs.map((run) => (
                <li key={run.id} className="flex items-center justify-between rounded-lg border border-line bg-surface-1 px-2.5 py-1.5 text-xs text-ink-2">
                  <span>
                    {new Date(run.startedAt).toLocaleString()} - {run.provider}/{run.model} - {run.findingsCount} findings,{' '}
                    {run.tokensEstimated.toLocaleString()} est. tokens ({run.status})
                  </span>
                  <button onClick={() => void removeRun(run)} className="text-error hover:underline">
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
