// Compare view (phase 6, spec-2 section 23): pick two snapshots of this
// repository and see what changed - added/removed/modified files, added and
// removed symbols and dependencies, new and removed communities - plus a
// visual diff map where nodes and edges are colored by change status.
// Lists paginate at 50 rows so large diffs stay usable, and the whole
// comparison exports as Markdown or JSON. Clicking a file row opens the
// snapshot version that contains the change.

import { useEffect, useMemo, useState } from 'react'
import { listSnapshots } from '../lib/db'
import { buildDiffMap, STATUS_COLORS, type ChangeStatus } from '../lib/diffmap'
import { compareSnapshots, comparisonToMarkdown, type ComparisonReport, type SnapshotRec } from '../lib/snapshots'
import MapCanvas from './MapCanvas'
import { materializeSnapshotView } from './SnapshotsPanel'

interface Props {
  repoUrl: string
  repoName: string
  onOpenRepo: (repoId: string) => void
  onClose: () => void
}

const PAGE_SIZE = 50

function download(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function label(s: SnapshotRec): string {
  return `${s.ref} @ ${s.commit.slice(0, 7)} - saved ${new Date(s.createdAt).toLocaleString()}`
}

interface Section {
  title: string
  items: string[]
  tone: ChangeStatus | 'neutral'
  // Which snapshot a row opens when clicked; undefined = not clickable.
  opens?: 'a' | 'b'
}

function PagedList({ section, onOpenFile }: { section: Section; onOpenFile?: (path: string, opens: 'a' | 'b') => void }) {
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(section.items.length / PAGE_SIZE))
  const shown = section.items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const toneClass =
    section.tone === 'added' ? 'text-success' : section.tone === 'removed' ? 'text-dragon' : section.tone === 'modified' ? 'text-warning' : 'text-ink-2'
  return (
    <div className="rounded-lg border border-line bg-surface-1">
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
        <p className={`text-[11px] font-semibold ${toneClass}`}>
          {section.title} ({section.items.length})
        </p>
        {pages > 1 && (
          <div className="flex items-center gap-1.5 text-[10px] text-ink-3">
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="rounded border border-line px-1.5 py-0.5 disabled:opacity-40">
              Prev
            </button>
            <span>
              {page + 1} / {pages}
            </span>
            <button onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1} className="rounded border border-line px-1.5 py-0.5 disabled:opacity-40">
              Next
            </button>
          </div>
        )}
      </div>
      {section.items.length === 0 ? (
        <p className="px-3 py-2 text-[11px] text-ink-3">None.</p>
      ) : (
        <ul className="max-h-56 overflow-auto px-3 py-1.5">
          {shown.map((item) => (
            <li key={item} className="truncate py-0.5 font-mono text-[11px] text-ink-2">
              {section.opens && onOpenFile ? (
                <button onClick={() => onOpenFile(item, section.opens!)} title={`Open the ${section.opens === 'a' ? 'older' : 'newer'} snapshot`} className="hover:text-dragon hover:underline">
                  {item}
                </button>
              ) : (
                item
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function CompareView({ repoUrl, repoName, onOpenRepo, onClose }: Props) {
  const [snapshots, setSnapshots] = useState<SnapshotRec[]>([])
  const [aId, setAId] = useState<string>('')
  const [bId, setBId] = useState<string>('')
  const [report, setReport] = useState<ComparisonReport | null>(null)
  const [mode, setMode] = useState<'report' | 'map'>('report')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void listSnapshots(repoUrl).then((list) => {
      setSnapshots(list)
      // Newest first: default B = newest, A = the one before it.
      if (list.length >= 2) {
        setAId(list[1].id)
        setBId(list[0].id)
      }
    })
  }, [repoUrl])

  const a = snapshots.find((s) => s.id === aId) ?? null
  const b = snapshots.find((s) => s.id === bId) ?? null

  const compare = () => {
    setError(null)
    if (!a || !b || a.id === b.id) {
      setError('Pick two different snapshots to compare.')
      return
    }
    setReport(compareSnapshots(a, b))
  }

  const swap = () => {
    setAId(bId)
    setBId(aId)
    setReport(null)
  }

  const openFile = async (_path: string, opens: 'a' | 'b') => {
    const snap = opens === 'a' ? a : b
    if (!snap) return
    try {
      const viewId = await materializeSnapshotView(snap)
      onOpenRepo(viewId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open the snapshot.')
    }
  }

  const sections = useMemo<Section[]>(() => {
    if (!report) return []
    const communityLines = (list: ComparisonReport['communities']['added']) =>
      list.map((c) => `${c.fileCount} files${c.mainLanguage ? `, ${c.mainLanguage}` : ''} - ${c.topPaths.join(', ')}`)
    return [
      { title: 'Added files', items: report.files.added, tone: 'added', opens: 'b' },
      { title: 'Modified files', items: report.files.modified, tone: 'modified', opens: 'b' },
      { title: 'Removed files', items: report.files.removed, tone: 'removed', opens: 'a' },
      { title: 'Added symbols', items: report.symbols.added, tone: 'added', opens: 'b' },
      { title: 'Removed symbols', items: report.symbols.removed, tone: 'removed', opens: 'a' },
      { title: 'Added dependencies', items: report.dependencies.added, tone: 'added' },
      { title: 'Removed dependencies', items: report.dependencies.removed, tone: 'removed' },
      { title: 'New communities', items: communityLines(report.communities.added), tone: 'added' },
      { title: 'Removed communities', items: communityLines(report.communities.removed), tone: 'removed' },
    ]
  }, [report])

  const diff = useMemo(() => (report && a && b ? buildDiffMap(a, b, report) : null), [report, a, b])
  const diffColors = useMemo(() => {
    if (!diff) return undefined
    const map = new Map<string, string>()
    for (const [name, status] of diff.moduleStatus) map.set(name, STATUS_COLORS[status])
    return map
  }, [diff])

  const base = repoName.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-night">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <p className="text-xs font-semibold text-ink">Compare snapshots</p>
        <select value={aId} onChange={(e) => { setAId(e.target.value); setReport(null) }} aria-label="Older snapshot (A)" className="rounded border border-line bg-surface-1 px-2 py-1 text-[11px] text-ink-2">
          {snapshots.map((s) => (
            <option key={s.id} value={s.id}>
              A: {label(s)}
            </option>
          ))}
        </select>
        <button onClick={swap} title="Swap A and B" className="rounded border border-line px-1.5 py-1 text-[11px] text-ink-3 hover:text-ink">
          ⇄
        </button>
        <select value={bId} onChange={(e) => { setBId(e.target.value); setReport(null) }} aria-label="Newer snapshot (B)" className="rounded border border-line bg-surface-1 px-2 py-1 text-[11px] text-ink-2">
          {snapshots.map((s) => (
            <option key={s.id} value={s.id}>
              B: {label(s)}
            </option>
          ))}
        </select>
        <button onClick={compare} className="rounded-lg bg-dragon px-3 py-1 text-[11px] font-semibold text-night">
          Compare
        </button>
        {report && (
          <>
            <button onClick={() => setMode(mode === 'report' ? 'map' : 'report')} className="rounded border border-line px-2 py-1 text-[11px] font-semibold text-ink-2 hover:border-dragon hover:text-ink">
              {mode === 'report' ? 'Diff map' : 'Report'}
            </button>
            <button onClick={() => a && b && download(`codeatlas-compare-${base}.md`, comparisonToMarkdown(a, b, report), 'text/markdown')} className="rounded border border-line px-2 py-1 text-[11px] text-ink-2 hover:text-ink">
              Markdown
            </button>
            <button
              onClick={() =>
                a &&
                b &&
                download(
                  `codeatlas-compare-${base}.json`,
                  JSON.stringify(
                    {
                      a: { ref: a.ref, commit: a.commit, indexedAt: a.indexedAt },
                      b: { ref: b.ref, commit: b.commit, indexedAt: b.indexedAt },
                      report,
                    },
                    null,
                    2,
                  ),
                  'application/json',
                )
              }
              className="rounded border border-line px-2 py-1 text-[11px] text-ink-2 hover:text-ink"
            >
              JSON
            </button>
          </>
        )}
        <div className="ml-auto">
          <button onClick={onClose} aria-label="Close compare view" className="text-ink-3 hover:text-ink">
            ✕
          </button>
        </div>
      </div>
      {error && <p className="border-b border-line px-3 py-1.5 text-[11px] text-error">{error}</p>}
      {!report && (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-ink-3">
          {snapshots.length < 2 ? 'Save at least two snapshots to compare versions.' : 'Pick an older snapshot (A) and a newer snapshot (B), then Compare.'}
        </div>
      )}
      {report && mode === 'report' && (
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { name: 'Files', text: `+${report.files.added.length} -${report.files.removed.length} ~${report.files.modified.length}` },
              { name: 'Symbols', text: `+${report.symbols.added.length} -${report.symbols.removed.length}` },
              { name: 'Dependencies', text: `+${report.dependencies.added.length} -${report.dependencies.removed.length}` },
              { name: 'Communities', text: `+${report.communities.added.length} -${report.communities.removed.length}` },
            ].map((c) => (
              <div key={c.name} className="rounded-lg border border-line bg-surface-1 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-ink-3">{c.name}</p>
                <p className="mt-0.5 font-mono text-xs text-ink">{c.text}</p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            {sections.map((s) => (
              <PagedList key={s.title} section={s} onOpenFile={(path, opens) => void openFile(path, opens)} />
            ))}
          </div>
        </div>
      )}
      {report && mode === 'map' && diff && (
        <div className="relative min-h-0 flex-1">
          <MapCanvas
            modules={diff.modules}
            moduleEdges={diff.moduleEdges}
            edgeVisibility={{ imports: true, calls: true, inferred: true }}
            selected={null}
            communityColors={diffColors}
            edgeStatus={diff.edgeStatus}
            onSelect={() => undefined}
          />
          <div className="absolute left-3 top-3 z-10 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface-1/90 px-3 py-1.5 text-[10px] text-ink-2">
            <span className="font-semibold text-ink">Diff map (B vs A)</span>
            {(['added', 'modified', 'removed', 'unchanged'] as const).map((s) => (
              <span key={s} className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: STATUS_COLORS[s] }} aria-hidden />
                {s}
              </span>
            ))}
            <span className="flex items-center gap-1">
              <span className="inline-block h-0 w-5 border-t-2 border-[#3ECF8E]" aria-hidden /> new edge
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-0 w-5 border-t-2 border-dashed border-[#FF4696]" aria-hidden /> removed edge
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
