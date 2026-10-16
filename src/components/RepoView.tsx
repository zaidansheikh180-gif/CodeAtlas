// Repo view (phase 1): the top-level module map, repo stats, and a side panel
// that lists a module's files and previews source. Layered drill-down, the
// full source viewer and chat arrive in later phases.

import { useEffect, useMemo, useRef, useState } from 'react'
import { deleteRepo, getAllByRepo, getRepo } from '../lib/db'
import { highlightToLines, type HighlightedLine } from '../lib/highlight'
import { buildModules } from '../lib/modules'
import type { EdgeRec, FileRec, RepoRec, SymbolRec } from '../lib/types'
import MapCanvas from './MapCanvas'

interface Props {
  repoId: string
  onBack: () => void
}

export default function RepoView({ repoId, onBack }: Props) {
  const [repo, setRepo] = useState<RepoRec | null>(null)
  const [files, setFiles] = useState<FileRec[]>([])
  const [symbols, setSymbols] = useState<SymbolRec[]>([])
  const [edges, setEdges] = useState<EdgeRec[]>([])
  const [selectedModule, setSelectedModule] = useState<string | null>(null)
  const [openFile, setOpenFile] = useState<FileRec | null>(null)
  const [missing, setMissing] = useState(false)
  // Resizable side panel: width persists in this browser (localStorage).
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    const saved = Number(window.localStorage.getItem('codeatlas.panelWidth'))
    return Number.isFinite(saved) && saved >= 280 ? Math.min(saved, 860) : 320
  })
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const [highlighted, setHighlighted] = useState<HighlightedLine[] | null>(null)

  // Lazy syntax coloring for the open file; falls back to plain text.
  useEffect(() => {
    setHighlighted(null)
    if (!openFile) return
    let stale = false
    void highlightToLines(openFile.text, openFile.path).then((lines) => {
      if (!stale) setHighlighted(lines)
    })
    return () => {
      stale = true
    }
  }, [openFile])
  const clampWidth = (w: number) => Math.min(Math.max(w, 280), Math.min(860, window.innerWidth - 320))
  const applyWidth = (w: number) => {
    const clamped = clampWidth(w)
    setPanelWidth(clamped)
    window.localStorage.setItem('codeatlas.panelWidth', String(Math.round(clamped)))
  }

  useEffect(() => {
    void (async () => {
      const rec = await getRepo(repoId)
      if (!rec) {
        setMissing(true)
        return
      }
      setRepo(rec)
      setFiles(await getAllByRepo<FileRec>('files', repoId))
      setSymbols(await getAllByRepo<SymbolRec>('symbols', repoId))
      setEdges(await getAllByRepo<EdgeRec>('edges', repoId))
    })()
  }, [repoId])

  const { modules, moduleEdges } = useMemo(() => buildModules(files, symbols, edges), [files, symbols, edges])
  const extractedEdges = useMemo(() => edges.filter((e) => e.confidence === 'extracted').length, [edges])
  const selected = modules.find((m) => m.name === selectedModule) ?? null

  if (missing) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center px-6">
        <p className="text-ink-2">This index is not in this browser's storage. It may have been cleared.</p>
        <button onClick={onBack} className="mt-4 rounded-lg bg-dragon px-4 py-2 text-sm font-semibold text-night">
          Back to start
        </button>
      </div>
    )
  }

  if (!repo) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <p className="text-ink-3">Loading index…</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface-1 px-4 py-3">
        <button onClick={onBack} className="text-sm text-ink-3 hover:text-ink" aria-label="Back to start">
          ←
        </button>
        <div className="min-w-0">
          <h1 className="truncate font-mono text-sm font-semibold text-ink">{repo.fullName}</h1>
          <p className="font-mono text-xs text-ink-3">commit {repo.commit.slice(0, 7)}</p>
        </div>
        <button
          onClick={() => {
            if (window.confirm(`Clear the ${repo.fullName} index from this browser? The repository on GitHub is not affected.`)) {
              void deleteRepo(repo.id).then(onBack)
            }
          }}
          className="ml-auto rounded-lg border border-line px-3 py-1 text-xs text-ink-3 hover:border-error hover:text-error"
        >
          Clear index
        </button>
        <div className="tabular flex items-center gap-4 text-xs text-ink-2">
          <span>{repo.stats.files} files</span>
          <span>{repo.stats.symbols} symbols</span>
          <span>
            {repo.stats.edges} edges ({extractedEdges} extracted, {repo.stats.edges - extractedEdges} inferred)
          </span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1">
          <MapCanvas modules={modules} moduleEdges={moduleEdges} selected={selectedModule} onSelect={(name) => {
            setSelectedModule(name)
            setOpenFile(null)
          }} />
          <p className="pointer-events-none absolute bottom-4 left-4 max-w-md rounded-lg border border-line bg-surface-1/90 px-3 py-2 text-xs text-ink-3">
            Top-level modules. Node size and number show file count; arrows are imports read from the code.
            Click a module to list its files.
          </p>
        </main>

        {selected && (
          <aside
            className="relative flex shrink-0 flex-col border-l border-line bg-surface-1 max-sm:absolute max-sm:inset-x-0 max-sm:bottom-0 max-sm:max-h-[55%] max-sm:w-full max-sm:rounded-t-xl max-sm:border-t"
            style={{ width: panelWidth }}
          >
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize panel"
              aria-valuenow={Math.round(panelWidth)}
              aria-valuemin={280}
              aria-valuemax={860}
              tabIndex={0}
              className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize hover:bg-dragon/40 focus-visible:bg-dragon/60 max-sm:hidden"
              onPointerDown={(e) => {
                resizeRef.current = { startX: e.clientX, startWidth: panelWidth }
                e.currentTarget.setPointerCapture(e.pointerId)
              }}
              onPointerMove={(e) => {
                const drag = resizeRef.current
                if (!drag) return
                applyWidth(drag.startWidth + (drag.startX - e.clientX))
              }}
              onPointerUp={() => {
                resizeRef.current = null
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft') applyWidth(panelWidth + 24)
                if (e.key === 'ArrowRight') applyWidth(panelWidth - 24)
              }}
            />
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-ink">{selected.name}</h2>
                <p className="text-xs text-ink-3">
                  {selected.fileCount} files · {selected.symbolCount} symbols
                </p>
              </div>
              <button
                onClick={() => {
                  setSelectedModule(null)
                  setOpenFile(null)
                }}
                className="text-ink-3 hover:text-ink"
                aria-label="Close panel"
              >
                ✕
              </button>
            </div>
            {openFile ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <button
                  onClick={() => setOpenFile(null)}
                  className="border-b border-line px-4 py-2 text-left text-xs text-ink-3 hover:text-ink"
                >
                  ← {selected.name} files
                </button>
                <p className="border-b border-line px-4 py-2 font-mono text-xs text-ink-2">{openFile.path}</p>
                <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
                  <pre className="w-max min-w-full font-mono text-xs leading-5 text-ink-2">
                    {(highlighted ?? openFile.text.split('\n').map((line) => [{ text: line, color: '#B8A8D9' }])).map((segments, i) => (
                      <div key={i} className="flex">
                        <span className="tabular sticky left-0 w-10 shrink-0 select-none bg-surface-1 pr-3 text-right text-ink-3">{i + 1}</span>
                        <span className="whitespace-pre pl-2">
                          {segments.length > 0
                            ? segments.map((seg, j) => (
                                <span key={j} style={{ color: seg.color }}>
                                  {seg.text}
                                </span>
                              ))
                            : ' '}
                        </span>
                      </div>
                    ))}
                  </pre>
                </div>
              </div>
            ) : (
              <ul className="min-h-0 flex-1 overflow-auto px-2 py-2">
                {selected.files.map((file) => (
                  <li key={file.id}>
                    <button
                      onClick={() => setOpenFile(file)}
                      className="w-full truncate rounded-md px-2 py-1.5 text-left font-mono text-xs text-ink-2 hover:bg-surface-2 hover:text-ink"
                    >
                      {file.path.split('/').slice(1).join('/')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        )}
      </div>
    </div>
  )
}
