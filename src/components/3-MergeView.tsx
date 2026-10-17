// Merge view (phase 6, spec-2 section 20): merge two or more indexed
// repository graphs into one. The user picks the repositories and a
// duplicate strategy, sees a full preview - per-repo counts, duplicate
// paths, result and skipped counts - and only then materializes the merged
// graph as its own repo view on the landing list. The preview exports as
// Markdown or JSON. All math lives in src/lib/merge.ts.

import { useMemo, useState } from 'react'
import { deleteRepo, putAll, putRepo } from '../lib/db'
import { mergeReportToMarkdown, planMerge, type MergePlan, type MergeStrategy } from '../lib/merge'
import type { RepoGraphInput } from '../lib/globalgraph'
import type { EdgeRec, FileRec, RepoRec, SymbolRec } from '../lib/types'

interface Props {
  inputs: RepoGraphInput[]
  repoColors: Map<string, string>
  onOpenRepo: (repoId: string) => void
  onClose: () => void
}

const STRATEGIES: { id: MergeStrategy; name: string; blurb: string }[] = [
  { id: 'merged', name: 'Merge duplicates', blurb: 'Same path in two repos becomes one node; the first repo wins.' },
  { id: 'separate', name: 'Keep separate', blurb: 'Every repo keeps its own tree, paths prefixed by repo tag.' },
  { id: 'linked', name: 'Link duplicates', blurb: 'Separate trees, plus dashed links between duplicate files.' },
]

function download(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function MergeView({ inputs, repoColors, onOpenRepo, onClose }: Props) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(inputs.slice(0, 2).map((i) => i.repo.id)))
  const [strategy, setStrategy] = useState<MergeStrategy>('merged')
  const [plan, setPlan] = useState<MergePlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const chosen = useMemo(() => inputs.filter((i) => selected.has(i.repo.id)), [inputs, selected])

  const toggle = (id: string) => {
    setPlan(null)
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const preview = () => {
    setError(null)
    if (chosen.length < 2) {
      setError('Pick at least two repositories to merge.')
      return
    }
    setPlan(planMerge(chosen, strategy))
  }

  const create = async () => {
    if (!plan) return
    setBusy(true)
    setError(null)
    try {
      await deleteRepo(plan.viewId).catch(() => undefined) // replace an older merge of the same repos
      const rec: RepoRec = {
        id: plan.viewId,
        url: `merge://${plan.fullName}`,
        fullName: plan.fullName,
        commit: '-',
        defaultBranch: '-',
        status: 'ready',
        description: `Merge of ${plan.report.repos.map((r) => r.fullName).join(' + ')} (${plan.report.strategy}).`,
        language: null,
        sizeKb: 0,
        stats: {
          files: plan.files.length,
          parsedFiles: plan.files.length,
          symbols: plan.symbols.length,
          edges: plan.edges.length,
          secretsExcluded: 0,
        },
        indexedAt: Date.now(),
        imported: true,
      }
      await putRepo(rec)
      await putAll<FileRec>('files', plan.files)
      await putAll<SymbolRec>('symbols', plan.symbols)
      await putAll<EdgeRec>('edges', plan.edges)
      onOpenRepo(plan.viewId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the merged view.')
      setBusy(false)
    }
  }

  const r = plan?.report

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-night">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <p className="text-xs font-semibold text-ink">Merge repositories</p>
        <div className="ml-auto">
          <button onClick={onClose} aria-label="Close merge view" className="text-ink-3 hover:text-ink">
            ✕
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <p className="text-[11px] text-ink-3">Pick two or more repositories and how duplicate paths should be handled. Nothing is written until you create the merged view.</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {inputs.map((input) => {
            const on = selected.has(input.repo.id)
            return (
              <button
                key={input.repo.id}
                onClick={() => toggle(input.repo.id)}
                aria-pressed={on}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${on ? 'border-dragon bg-surface-1 text-ink' : 'border-line text-ink-3'}`}
              >
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: repoColors.get(input.repo.id) ?? '#8A76B3' }} aria-hidden />
                {input.repo.fullName}
              </button>
            )
          })}
        </div>
        <div className="mt-3 grid gap-1.5 sm:grid-cols-3">
          {STRATEGIES.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                setStrategy(s.id)
                setPlan(null)
              }}
              aria-pressed={strategy === s.id}
              className={`rounded-lg border px-2.5 py-2 text-left ${strategy === s.id ? 'border-dragon bg-surface-1' : 'border-line bg-surface-1/50'}`}
            >
              <p className="text-[11px] font-semibold text-ink">{s.name}</p>
              <p className="mt-0.5 text-[10px] leading-snug text-ink-3">{s.blurb}</p>
            </button>
          ))}
        </div>
        <button onClick={preview} disabled={chosen.length < 2} className="mt-3 rounded-lg bg-dragon px-3 py-1.5 text-xs font-semibold text-night disabled:opacity-50">
          Preview the merge
        </button>
        {error && <p className="mt-2 text-[11px] text-error">{error}</p>}
        {r && (
          <div className="mt-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { name: 'Repositories', text: String(r.repos.length) },
                { name: 'Duplicate paths', text: String(r.duplicateFiles.length) },
                { name: 'Merged graph', text: `${r.result.files} files · ${r.result.symbols} symbols · ${r.result.edges} edges` },
                { name: 'Skipped invalid', text: `${r.skipped.files + r.skipped.symbols + r.skipped.edges}` },
              ].map((c) => (
                <div key={c.name} className="rounded-lg border border-line bg-surface-1 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-ink-3">{c.name}</p>
                  <p className="mt-0.5 font-mono text-xs text-ink">{c.text}</p>
                </div>
              ))}
            </div>
            <div className="mt-2 rounded-lg border border-line bg-surface-1">
              <p className="border-b border-line px-3 py-1.5 text-[11px] font-semibold text-ink-2">
                Duplicate file paths ({r.duplicateFiles.length}){r.strategy === 'merged' ? ' - collapse to one node' : r.strategy === 'linked' ? ' - kept, with links' : ' - kept separate'}
              </p>
              {r.duplicateFiles.length === 0 ? (
                <p className="px-3 py-2 text-[11px] text-ink-3">No duplicate paths across the selected repositories.</p>
              ) : (
                <ul className="max-h-40 overflow-auto px-3 py-1.5">
                  {r.duplicateFiles.slice(0, 50).map((p) => (
                    <li key={p} className="truncate py-0.5 font-mono text-[11px] text-ink-2">
                      {p}
                    </li>
                  ))}
                  {r.duplicateFiles.length > 50 && <li className="py-0.5 text-[11px] text-ink-3">…and {r.duplicateFiles.length - 50} more</li>}
                </ul>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button onClick={() => void create()} disabled={busy} className="rounded-lg bg-dragon px-3 py-1.5 text-xs font-semibold text-night disabled:opacity-50">
                {busy ? 'Creating…' : 'Create the merged view'}
              </button>
              <button onClick={() => plan && download(`codeatlas-merge-${plan.fullName.replace(/[^a-z0-9]+/gi, '-')}.md`, mergeReportToMarkdown(plan), 'text/markdown')} className="rounded border border-line px-2 py-1 text-[11px] text-ink-2 hover:text-ink">
                Markdown
              </button>
              <button onClick={() => plan && download(`codeatlas-merge-${plan.fullName.replace(/[^a-z0-9]+/gi, '-')}.json`, JSON.stringify(plan.report, null, 2), 'application/json')} className="rounded border border-line px-2 py-1 text-[11px] text-ink-2 hover:text-ink">
                JSON
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
