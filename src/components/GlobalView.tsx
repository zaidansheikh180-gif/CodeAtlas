// Global map (phase 6, spec-2 section 19): every indexed repository on one
// canvas. Modules are namespaced by repository tag and colored per
// repository, filter chips add or remove a repository from the graph, and a
// toggle draws dashed links between modules that share a name across repos
// (the cross-repository connections). The header shows global statistics.

import { useEffect, useMemo, useState } from 'react'
import { getAllByRepo, listRepos } from '../lib/db'
import { buildGlobalGraph, type RepoGraphInput } from '../lib/globalgraph'
import { MODULE_COLORS } from '../lib/modules'
import type { EdgeRec, FileRec, RepoRec, SymbolRec } from '../lib/types'
import MapCanvas from './MapCanvas'
import MergeView from './MergeView'

interface Props {
  onBack: () => void
  onOpenRepo: (repoId: string) => void
}

export default function GlobalView({ onBack, onOpenRepo }: Props) {
  const [inputs, setInputs] = useState<RepoGraphInput[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set())
  const [linkShared, setLinkShared] = useState(true)
  const [mergeOpen, setMergeOpen] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const repos = (await listRepos()).filter((r) => !r.snapshot && r.status === 'ready')
        const loaded: RepoGraphInput[] = []
        for (const repo of repos) {
          const [files, symbols, edges] = await Promise.all([
            getAllByRepo<FileRec>('files', repo.id),
            getAllByRepo<SymbolRec>('symbols', repo.id),
            getAllByRepo<EdgeRec>('edges', repo.id),
          ])
          loaded.push({ repo, files, symbols, edges })
        }
        setInputs(loaded)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load the indexed repositories.')
      }
    })()
  }, [])

  // Stable per-repository colors by position in the full indexed list, so
  // filtering a repository out never recolors the ones that remain.
  const repoColors = useMemo(() => {
    const map = new Map<string, string>()
    ;(inputs ?? []).forEach((input, index) => map.set(input.repo.id, MODULE_COLORS[index % MODULE_COLORS.length]))
    return map
  }, [inputs])
  const included = useMemo(() => (inputs ?? []).filter((i) => !excluded.has(i.repo.id)), [inputs, excluded])
  const graph = useMemo(() => (included.length > 0 ? buildGlobalGraph(included, linkShared, repoColors) : null), [included, linkShared, repoColors])

  const toggle = (repo: RepoRec) => {
    setExcluded((prev) => {
      const next = new Set(prev)
      if (next.has(repo.id)) next.delete(repo.id)
      else if (inputs && next.size < inputs.length - 1) next.add(repo.id) // keep at least one
      return next
    })
  }

  return (
    <div className="flex h-full flex-col bg-night">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-3 py-2">
        <button onClick={onBack} aria-label="Back to landing" className="text-ink-3 hover:text-ink">
          ←
        </button>
        <p className="text-sm font-semibold text-ink">Global map</p>
        {graph && (
          <p className="text-xs text-ink-3">
            {graph.stats.repos} {graph.stats.repos === 1 ? 'repository' : 'repositories'} · {graph.stats.files} files · {graph.stats.symbols} symbols · {graph.stats.edges} edges · {graph.stats.modules} modules
          </p>
        )}
        <button
          onClick={() => setMergeOpen(true)}
          disabled={!inputs || inputs.length < 2}
          title={!inputs || inputs.length < 2 ? 'Index at least two repositories to merge' : 'Merge repositories into one graph'}
          className="ml-auto rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-ink-2 hover:border-dragon hover:text-ink disabled:opacity-40"
        >
          Merge…
        </button>
        <label className="flex items-center gap-1.5 text-xs text-ink-2">
          <input type="checkbox" checked={linkShared} onChange={(e) => setLinkShared(e.target.checked)} className="accent-dragon" />
          Link shared module names
        </label>
      </header>
      {inputs && inputs.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-2">
          {inputs.map((input) => {
            const off = excluded.has(input.repo.id)
            const color = graph?.repoColors.get(input.repo.id) ?? '#8A76B3'
            return (
              <button
                key={input.repo.id}
                onClick={() => toggle(input.repo)}
                aria-pressed={!off}
                title={off ? 'Add back to the global graph' : 'Remove from the global graph'}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${off ? 'border-line text-ink-3 line-through' : 'border-line bg-surface-1 text-ink'}`}
              >
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: off ? '#8A76B3' : color }} aria-hidden />
                {input.repo.fullName}
              </button>
            )
          })}
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        {mergeOpen && inputs && (
          <MergeView inputs={inputs} repoColors={repoColors} onOpenRepo={onOpenRepo} onClose={() => setMergeOpen(false)} />
        )}
        {error && <p className="p-4 text-xs text-error">{error}</p>}
        {!error && !inputs && <p className="p-4 text-xs text-ink-3">Loading the indexed repositories…</p>}
        {!error && inputs && inputs.length === 0 && (
          <div className="flex h-full items-center justify-center p-6 text-center text-xs text-ink-3">Index at least one repository to see it on the global map.</div>
        )}
        {!error && graph && (
          <>
            <MapCanvas
              modules={graph.modules}
              moduleEdges={graph.moduleEdges}
              edgeVisibility={{ imports: true, calls: true, inferred: true }}
              selected={null}
              communityColors={graph.moduleColors}
              onSelect={() => undefined}
            />
            <div className="absolute left-3 top-3 z-10 rounded-lg border border-line bg-surface-1/90 px-3 py-1.5 text-[10px] text-ink-2">
              <span className="font-semibold text-ink">One color per repository.</span> Solid arcs are imports; dashed arcs are calls and shared-name links between repositories.
            </div>
          </>
        )}
      </div>
    </div>
  )
}
