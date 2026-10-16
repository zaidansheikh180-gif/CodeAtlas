// Repo view: the top-level module map, repo stats, key-free graph queries
// (phase 3) with cited answers, and a side panel that lists a module's files
// and previews source. Layered drill-down and model chat arrive in later
// phases.

import { useEffect, useMemo, useRef, useState } from 'react'
import { deleteRepo, getAllByRepo, getRepo } from '../lib/db'
import { answerQuestion, buildIndex, type QueryAnswer } from '../lib/graphquery'
import type { SearchOutcome } from '../lib/search'
import type { SearchRequest, SearchResponse } from '../workers/search.worker'
import SearchPalette from './SearchPalette'
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
  // Graph Query Mode: the question, its cited answer, and the source line a
  // citation click should scroll to.
  const [query, setQuery] = useState('')
  const [answer, setAnswer] = useState<QueryAnswer | null>(null)
  const [pendingLine, setPendingLine] = useState<number | null>(null)
  // Repo-wide search palette: worker-backed, opened with Ctrl/Cmd+K.
  const [searchOpen, setSearchOpen] = useState(false)
  // Source viewer upgrades (phase 4): symbol outline with resolved imports,
  // and in-file search with match jumping.
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [fileQuery, setFileQuery] = useState('')
  const fileSearchRef = useRef<HTMLInputElement>(null)
  const searchWorkerRef = useRef<Worker | null>(null)
  const searchPendingRef = useRef(new Map<number, (outcome: SearchOutcome) => void>())
  const searchIdRef = useRef(0)

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

  // The query index rebuilds only when the underlying index records change.
  const queryIndex = useMemo(() => buildIndex(files, symbols, edges), [files, symbols, edges])
  // Modules touched by the current answer, ringed on the map.
  const highlightedModules = useMemo(() => {
    if (!answer) return []
    const names = new Set<string>()
    for (const path of answer.highlightPaths) {
      const mod = modules.find((m) => m.files.some((f) => f.path === path))
      if (mod) names.add(mod.name)
    }
    return [...names]
  }, [answer, modules])

  // Search worker: one per repo view, re-initialised when the module list
  // changes. Terminated on unmount; pending promises settle with empty
  // results so the palette never hangs.
  useEffect(() => {
    if (!repo) return
    const worker = new Worker(new URL('../workers/search.worker.ts', import.meta.url), { type: 'module' })
    searchWorkerRef.current = worker
    worker.onmessage = (event: MessageEvent<SearchResponse>) => {
      const msg = event.data
      if (msg.type === 'result') {
        const resolve = searchPendingRef.current.get(msg.id)
        if (resolve) {
          searchPendingRef.current.delete(msg.id)
          resolve(msg.outcome)
        }
      }
    }
    const init: SearchRequest = { type: 'init', repoId, moduleNames: modules.map((m) => m.name) }
    worker.postMessage(init)
    return () => {
      worker.terminate()
      searchWorkerRef.current = null
      for (const resolve of searchPendingRef.current.values()) resolve({ results: [], truncated: false })
      searchPendingRef.current.clear()
    }
  }, [repo, repoId, modules])

  const runSearch = (text: string): Promise<SearchOutcome> => {
    const worker = searchWorkerRef.current
    if (!worker) return Promise.resolve({ results: [], truncated: false })
    const id = ++searchIdRef.current
    return new Promise((resolve) => {
      searchPendingRef.current.set(id, resolve)
      worker.postMessage({ type: 'query', id, text } satisfies SearchRequest)
    })
  }

  // Ctrl/Cmd+K opens the palette from anywhere in the repo view.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const openSearchFile = (path: string, line?: number) => {
    openCitation(path, line)
  }
  const openSearchModule = (name: string) => {
    setSelectedModule(name)
    setOpenFile(null)
  }

  const ask = (e: React.FormEvent) => {
    e.preventDefault()
    const text = query.trim()
    if (!text) return
    setAnswer(answerQuestion(text, queryIndex))
  }

  // A citation opens its file in the side panel and scrolls to the line.
  const openCitation = (path: string, startLine?: number) => {
    const file = files.find((f) => f.path === path)
    if (!file) return
    const mod = modules.find((m) => m.files.some((f) => f.path === path))
    if (mod) setSelectedModule(mod.name)
    setOpenFile(file)
    setPendingLine(startLine ?? null)
  }

  // Scroll to the cited line once the preview has rendered.
  useEffect(() => {
    if (!openFile || pendingLine == null) return
    document.getElementById(`L${pendingLine}`)?.scrollIntoView({ block: 'center' })
  }, [openFile, highlighted, pendingLine])

  // Outline: the open file's symbols and its resolved import targets.
  const openFileSymbols = useMemo(
    () => (openFile ? symbols.filter((s2) => s2.fileId === openFile.id).sort((a, b) => a.startLine - b.startLine) : []),
    [openFile, symbols],
  )
  const openFileImports = useMemo(() => {
    if (!openFile) return []
    return edges
      .filter((e) => e.type === 'imports' && e.fromId === openFile.id)
      .map((e) => files.find((f) => f.id === e.toId))
      .filter((f): f is FileRec => Boolean(f))
      .sort((a, b) => a.path.localeCompare(b.path))
  }, [openFile, edges, files])

  // In-file search: matching line numbers for the current query.
  const fileMatches = useMemo(() => {
    if (!openFile || fileQuery.trim().length < 2) return []
    const q = fileQuery.trim().toLowerCase()
    const out: number[] = []
    const lines = openFile.text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(q)) out.push(i + 1)
      if (out.length >= 200) break
    }
    return out
  }, [openFile, fileQuery])

  // Ctrl/Cmd+F jumps to in-file search while a file is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && openFile) {
        e.preventDefault()
        setOutlineOpen(false)
        fileSearchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openFile])

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
          onClick={() => setSearchOpen(true)}
          className="ml-auto rounded-lg border border-line px-3 py-1 text-xs text-ink-2 hover:border-dragon hover:text-ink"
        >
          Search <span className="text-ink-3">Ctrl K</span>
        </button>
        <button
          onClick={() => {
            if (window.confirm(`Clear the ${repo.fullName} index from this browser? The repository on GitHub is not affected.`)) {
              void deleteRepo(repo.id).then(onBack)
            }
          }}
          className="rounded-lg border border-line px-3 py-1 text-xs text-ink-3 hover:border-error hover:text-error"
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

      <form onSubmit={ask} className="flex items-center gap-2 border-b border-line bg-surface-1 px-4 py-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask about the graph: what does X import? who calls Y? what breaks if Z changes?"
          aria-label="Ask a graph question"
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface-2 px-3 py-1.5 font-mono text-xs text-ink placeholder:text-ink-3 focus:border-dragon focus:outline-none"
        />
        <button type="submit" className="rounded-lg bg-dragon px-3 py-1.5 text-xs font-semibold text-night">
          Ask
        </button>
        <p className="hidden text-xs text-ink-3 lg:block">Answers cite the index - no model key needed.</p>
      </form>

      <div className="flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1">
          <MapCanvas modules={modules} moduleEdges={moduleEdges} selected={selectedModule} highlighted={highlightedModules} onSelect={(name) => {
            setSelectedModule(name)
            setOpenFile(null)
          }} />
          {answer && (
            <div className="absolute right-4 top-4 flex max-h-[70%] w-96 max-w-[calc(100%-2rem)] flex-col rounded-lg border border-line bg-surface-1 shadow-lg">
              <div className="flex items-start justify-between gap-2 border-b border-line px-3 py-2">
                <p className="text-xs font-semibold text-ink">Graph answer</p>
                <button onClick={() => setAnswer(null)} aria-label="Close answer" className="text-ink-3 hover:text-ink">
                  ✕
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
                <p className="text-xs leading-5 text-ink-2">{answer.summary}</p>
                {answer.result.citations.length > 0 && (
                  <ul className="mt-2 space-y-0.5">
                    {answer.result.citations.slice(0, 50).map((c) => (
                      <li key={c.nodeId}>
                        <button
                          onClick={() => openCitation(c.path, c.startLine)}
                          className="w-full truncate rounded px-1.5 py-1 text-left font-mono text-xs text-dragon hover:bg-surface-2"
                        >
                          {c.path}
                          {c.startLine != null ? `:${c.startLine}${c.endLine != null && c.endLine !== c.startLine ? `-${c.endLine}` : ''}` : ''}
                        </button>
                      </li>
                    ))}
                    {answer.result.citations.length > 50 && (
                      <li className="px-1.5 py-1 text-xs text-ink-3">and {answer.result.citations.length - 50} more</li>
                    )}
                  </ul>
                )}
                {answer.needsModel && (
                  <p className="mt-2 rounded border border-line bg-surface-2 px-2 py-1.5 text-xs text-ink-3">
                    Free-form semantic questions need a model key; that chat layer arrives in a later phase.
                  </p>
                )}
              </div>
            </div>
          )}
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
                <p className="border-b border-line px-4 py-2 font-mono text-xs text-ink-3">
                  {openFile.path.split('/').map((seg, i, arr) => (
                    <span key={i}>
                      {i > 0 && <span className="text-ink-3"> / </span>}
                      <span className={i === arr.length - 1 ? 'text-ink' : undefined}>{seg}</span>
                    </span>
                  ))}
                  <span className="ml-2 text-ink-3">@ {repo.commit.slice(0, 7)}</span>
                </p>
                <div className="flex items-center gap-2 border-b border-line px-4 py-1.5">
                  <button
                    onClick={() => setOutlineOpen((v) => !v)}
                    className={`rounded border px-2 py-0.5 text-xs ${outlineOpen ? 'border-dragon text-dragon' : 'border-line text-ink-3 hover:text-ink'}`}
                  >
                    Outline
                  </button>
                  <input
                    ref={fileSearchRef}
                    value={fileQuery}
                    onChange={(e) => setFileQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && fileMatches.length > 0) setPendingLine(fileMatches[0])
                    }}
                    placeholder="Find in file"
                    aria-label="Find in file"
                    className="min-w-0 flex-1 rounded border border-line bg-surface-2 px-2 py-0.5 font-mono text-xs text-ink placeholder:text-ink-3 focus:border-dragon focus:outline-none"
                  />
                  {fileQuery.trim().length >= 2 && (
                    <span className="shrink-0 text-xs text-ink-3">{fileMatches.length} {fileMatches.length === 1 ? 'match' : 'matches'}</span>
                  )}
                </div>
                {outlineOpen && (
                  <div className="max-h-56 overflow-auto border-b border-line px-4 py-2">
                    {openFileSymbols.length > 0 && (
                      <>
                        <p className="pb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Symbols</p>
                        <ul>
                          {openFileSymbols.map((sym) => (
                            <li key={sym.id}>
                              <button
                                onClick={() => setPendingLine(sym.startLine)}
                                className="w-full truncate rounded px-1.5 py-0.5 text-left font-mono text-xs text-ink-2 hover:bg-surface-2 hover:text-ink"
                              >
                                <span className="text-dragon">{sym.kind}</span> {sym.name}
                                <span className="text-ink-3"> :{sym.startLine}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    {openFileImports.length > 0 && (
                      <>
                        <p className="pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Imports</p>
                        <ul>
                          {openFileImports.map((target) => (
                            <li key={target.id}>
                              <button
                                onClick={() => openCitation(target.path, 1)}
                                className="w-full truncate rounded px-1.5 py-0.5 text-left font-mono text-xs text-dragon hover:bg-surface-2"
                              >
                                {target.path}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    {openFileSymbols.length === 0 && openFileImports.length === 0 && (
                      <p className="text-xs text-ink-3">No symbols or local imports in this file.</p>
                    )}
                  </div>
                )}
                <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
                  <pre className="w-max min-w-full font-mono text-xs leading-5 text-ink-2">
                    {(highlighted ?? openFile.text.split('\n').map((line) => [{ text: line, color: '#B8A8D9' }])).map((segments, i) => (
                      <div key={i} id={`L${i + 1}`} className={pendingLine === i + 1 ? 'flex bg-dragon/15' : 'flex'}>
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
                      onClick={() => {
                        setOpenFile(file)
                        setPendingLine(null)
                      }}
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
      <SearchPalette
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        search={runSearch}
        onOpenFile={openSearchFile}
        onOpenModule={openSearchModule}
      />
    </div>
  )
}
