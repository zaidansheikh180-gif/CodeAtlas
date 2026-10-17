// System status and diagnostics panel (phase 9 part 1, spec-2 section 28,
// pack-1 #27): recent errors and warnings, indexing status, graph
// statistics, storage usage, and the (currently empty) model-request
// history - plus a redacted export as JSON or Markdown. Everything shown
// here comes from the local diagnostic log and IndexedDB; the export is
// redacted on the way out.

import { useEffect, useState } from 'react'
import { countByRepo, listRepos } from '../lib/db'
import {
  buildDiagnosticsReport,
  clearErrorLog,
  diagnosticsReportMarkdown,
  getErrorLog,
  type AppError,
  type DiagnosticsStats,
} from '../lib/errors'

function download(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

interface Props {
  indexingStatus: string
  onClose: () => void
}

async function gatherStats(indexingStatus: string): Promise<DiagnosticsStats> {
  const repos = await listRepos()
  let files = 0
  let symbols = 0
  let edges = 0
  for (const repo of repos) {
    files += await countByRepo('files', repo.id)
    symbols += await countByRepo('symbols', repo.id)
    edges += await countByRepo('edges', repo.id)
  }
  let used: number | null = null
  let quota: number | null = null
  try {
    const estimate = await navigator.storage?.estimate?.()
    used = estimate?.usage ?? null
    quota = estimate?.quota ?? null
  } catch {
    // estimate unavailable
  }
  return { repos: repos.length, files, symbols, edges, storageUsedBytes: used, storageQuotaBytes: quota, indexingStatus }
}

export default function StatusPanel({ indexingStatus, onClose }: Props) {
  const [errors, setErrors] = useState<AppError[]>([])
  const [stats, setStats] = useState<DiagnosticsStats | null>(null)

  useEffect(() => {
    setErrors(getErrorLog())
    void gatherStats(indexingStatus).then(setStats)
  }, [indexingStatus])

  const exportJson = () => {
    if (!stats) return
    download(
      `codeatlas-diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(buildDiagnosticsReport(stats), null, 2),
      'application/json',
    )
  }

  const exportMarkdown = () => {
    if (!stats) return
    download(
      `codeatlas-diagnostics-${new Date().toISOString().slice(0, 10)}.md`,
      diagnosticsReportMarkdown(stats),
      'text/markdown',
    )
  }

  const storageText =
    stats && stats.storageUsedBytes !== null
      ? `${(stats.storageUsedBytes / 1024 / 1024).toFixed(1)} MB used${stats.storageQuotaBytes !== null ? ` of ${(stats.storageQuotaBytes / 1024 / 1024).toFixed(0)} MB` : ''}`
      : 'unavailable'

  return (
    <div className="absolute right-4 top-16 z-10 flex max-h-[80%] w-96 max-w-[calc(100%-2rem)] flex-col rounded-lg border border-line bg-surface-1 shadow-lg">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <p className="text-xs font-semibold text-ink">Status and diagnostics</p>
        <button onClick={onClose} aria-label="Close status panel" className="text-ink-3 hover:text-ink">
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <p className="text-[10px] font-semibold uppercase text-ink-3">Indexing</p>
        <p className="mt-1 text-[11px] text-ink-2">{indexingStatus}</p>

        <p className="mt-3 text-[10px] font-semibold uppercase text-ink-3">Graph statistics</p>
        {stats ? (
          <p className="mt-1 text-[11px] text-ink-2">
            {stats.repos} {stats.repos === 1 ? 'repository' : 'repositories'} - {stats.files} files, {stats.symbols} symbols,{' '}
            {stats.edges} edges
          </p>
        ) : (
          <p className="mt-1 text-[11px] text-ink-3">Counting…</p>
        )}

        <p className="mt-3 text-[10px] font-semibold uppercase text-ink-3">Storage</p>
        <p className="mt-1 text-[11px] text-ink-2">{storageText}</p>

        <p className="mt-3 text-[10px] font-semibold uppercase text-ink-3">Model requests</p>
        <p className="mt-1 text-[11px] text-ink-3">
          No model requests yet. When model features are configured, a redacted request history appears here - never
          keys, never file contents.
        </p>

        <div className="mt-3 flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase text-ink-3">Recent errors and warnings</p>
          {errors.length > 0 && (
            <button
              onClick={() => {
                clearErrorLog()
                setErrors([])
              }}
              className="text-[10px] text-ink-3 hover:text-error"
            >
              Clear
            </button>
          )}
        </div>
        {errors.length === 0 ? (
          <p className="mt-1 text-[11px] text-ink-3">None recorded. Errors and warnings from indexing, queries and rendering appear here.</p>
        ) : (
          <ul className="mt-1 space-y-1.5">
            {errors.slice(0, 30).map((e) => (
              <li key={e.id} className="rounded-md border border-line bg-surface-2 px-2 py-1.5">
                <p className={`text-[11px] ${e.severity === 'warning' ? 'text-amber-400' : 'text-error'}`}>{e.message}</p>
                <p className="mt-0.5 text-[9px] text-ink-3">
                  {e.category} - {new Date(e.ts).toLocaleString()}
                  {e.detail ? ` - ${e.detail.slice(0, 120)}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex gap-2 border-t border-line px-3 py-2">
        <button
          onClick={exportJson}
          disabled={!stats}
          className="flex-1 rounded-lg border border-line px-2 py-1 text-[11px] text-ink-2 hover:border-dragon hover:text-ink disabled:opacity-50"
        >
          Export JSON
        </button>
        <button
          onClick={exportMarkdown}
          disabled={!stats}
          className="flex-1 rounded-lg border border-line px-2 py-1 text-[11px] text-ink-2 hover:border-dragon hover:text-ink disabled:opacity-50"
        >
          Export Markdown
        </button>
      </div>
    </div>
  )
}
