// Diagnostics dashboard (phase 5): data-quality report over the indexed
// graph - counts up top, issues filterable by severity and type, each with a
// suggested fix. Read-only by design: nothing here deletes or repairs data
// (spec: suggest safe fixes, never delete user data without confirmation).
// The analysis runs in the search worker over src/lib/diagnostics.ts.

import { useMemo, useState } from 'react'
import type { DiagnosticIssue, DiagnosticsReport, IssueType } from '../lib/diagnostics'
import { diagnosticsToJson, diagnosticsToMarkdown } from '../lib/diagnostics'

interface Props {
  repoName: string
  report: DiagnosticsReport | null
  loading: boolean
  onClose: () => void
  onOpenFile: (path: string) => void
  onRefresh: () => void
}

function download(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// Only real file paths are click-through; symbol display strings and raw
// record ids stay plain text.
function isFilePath(p: string): boolean {
  return !p.includes('(') && (p.includes('/') || /\.[a-z0-9]+$/i.test(p))
}

const TYPE_LABELS: Record<IssueType, string> = {
  'duplicate-node-id': 'Duplicate node ids',
  'missing-endpoint': 'Missing references',
  'orphan-node': 'Orphan nodes',
  'duplicate-edge': 'Duplicate edges',
  'same-endpoint-edge': 'Self loops',
  'dense-node': 'Dense nodes',
  'invalid-location': 'Invalid locations',
  cycle: 'Import cycles',
}

export default function DiagnosticsPanel({ repoName, report, loading, onClose, onOpenFile, onRefresh }: Props) {
  const [severity, setSeverity] = useState<'all' | 'error' | 'warning'>('all')
  const [typeFilter, setTypeFilter] = useState<'all' | IssueType>('all')

  const visible = useMemo(() => {
    if (!report) return []
    return report.issues.filter(
      (i) => (severity === 'all' || i.severity === severity) && (typeFilter === 'all' || i.type === typeFilter),
    )
  }, [report, severity, typeFilter])

  const presentTypes = useMemo(() => {
    if (!report) return []
    return [...new Set(report.issues.map((i) => i.type))]
  }, [report])

  const c = report?.counts
  const counts: [string, number | undefined][] = [
    ['Nodes', c?.nodes],
    ['Edges', c?.edges],
    ['Errors', c?.errors],
    ['Warnings', c?.warnings],
    ['Orphans', c?.orphans],
    ['Duplicate edges', c?.duplicateEdges],
    ['Missing refs', c?.missingRefs],
  ]

  const exportName = `diagnostics-${repoName.replace(/[^a-z0-9-]+/gi, '-')}`

  return (
    <div className="absolute right-4 top-4 z-10 flex max-h-[75%] w-[30rem] max-w-[calc(100%-2rem)] flex-col rounded-lg border border-line bg-surface-1 shadow-lg">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <p className="text-xs font-semibold text-ink">Diagnostics</p>
        <div className="flex items-center gap-2">
          <button onClick={onRefresh} aria-label="Re-run diagnostics" title="Re-run diagnostics on the current index" className="text-ink-3 hover:text-ink">
            ↻
          </button>
          <button onClick={onClose} aria-label="Close diagnostics" className="text-ink-3 hover:text-ink">
            ✕
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {loading && <p className="py-2 text-xs text-ink-3">Analyzing the graph in the worker…</p>}
        {!loading && report && (
          <>
            <div className="mb-3 grid grid-cols-4 gap-1.5">
              {counts.map(([label, value]) => (
                <div key={label} className="rounded-md border border-line bg-surface-2 px-2 py-1.5">
                  <p className={`text-sm font-semibold ${label === 'Errors' && value ? 'text-dragon' : 'text-ink'}`}>{value}</p>
                  <p className="text-[10px] text-ink-3">{label}</p>
                </div>
              ))}
            </div>
            <div className="mb-2 flex items-center gap-2">
              <div className="flex overflow-hidden rounded-md border border-line text-[10px]">
                {(['all', 'error', 'warning'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setSeverity(s)}
                    className={`px-2 py-1 ${severity === s ? 'bg-dragon font-semibold text-night' : 'text-ink-2 hover:text-ink'}`}
                  >
                    {s === 'all' ? 'All' : s === 'error' ? 'Errors' : 'Warnings'}
                  </button>
                ))}
              </div>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as 'all' | IssueType)}
                aria-label="Filter by issue type"
                className="min-w-0 flex-1 rounded-md border border-line bg-surface-2 px-2 py-1 text-[10px] text-ink-2 outline-none focus:border-dragon"
              >
                <option value="all">All types</option>
                {presentTypes.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            {visible.length === 0 && <p className="py-2 text-xs text-ink-3">No issues match this filter.</p>}
            {visible.map((issue: DiagnosticIssue) => (
              <div key={issue.id} className="mb-1.5 rounded-md border border-line bg-surface-2 px-2.5 py-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block h-2 w-2 shrink-0 rounded-full ${issue.severity === 'error' ? 'bg-dragon' : 'bg-[#F5B942]'}`}
                    aria-hidden
                  />
                  <p className="min-w-0 flex-1 text-[11px] leading-snug text-ink">{issue.message}</p>
                </div>
                {issue.paths.some(isFilePath) && (
                  <p className="mt-1 truncate font-mono text-[10px] text-ink-3">
                    {issue.paths.filter(isFilePath).map((p, i) => (
                      <button key={i} onClick={() => onOpenFile(p)} className="mr-2 underline decoration-dotted hover:text-ink">
                        {p}
                      </button>
                    ))}
                  </p>
                )}
                <p className="mt-1 text-[10px] italic leading-snug text-ink-3">{issue.suggestion}</p>
              </div>
            ))}
          </>
        )}
      </div>
      {report && !loading && (
        <div className="flex items-center gap-2 border-t border-line px-3 py-2">
          <button
            onClick={() => download(`${exportName}.json`, diagnosticsToJson(report), 'application/json')}
            className="rounded-md border border-line px-2 py-1 text-[10px] font-semibold text-ink-2 hover:text-ink"
          >
            Export JSON
          </button>
          <button
            onClick={() => download(`${exportName}.md`, diagnosticsToMarkdown(report), 'text/markdown')}
            className="rounded-md border border-line px-2 py-1 text-[10px] font-semibold text-ink-2 hover:text-ink"
          >
            Export Markdown
          </button>
          <p className="ml-auto text-[10px] text-ink-3">Read-only - nothing is deleted or changed.</p>
        </div>
      )}
    </div>
  )
}
