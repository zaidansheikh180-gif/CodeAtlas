// Repo view (phase 1): the top-level module map, repo stats, and a side panel
// that lists a module's files and previews source. Layered drill-down, the
// full source viewer and chat arrive in later phases.

import { useEffect, useMemo, useState } from 'react'
import { getAllByRepo, getRepo } from '../lib/db'
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
        <div className="tabular ml-auto flex items-center gap-4 text-xs text-ink-2">
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
          <p className="pointer-events-none absolute bottom-3 left-4 max-w-md text-xs text-ink-3">
            Top-level modules. Node size and number show file count; arrows are imports read from the code.
            Click a module to list its files.
          </p>
        </main>

        {selected && (
          <aside className="flex w-80 shrink-0 flex-col border-l border-line bg-surface-1 max-sm:absolute max-sm:inset-x-0 max-sm:bottom-0 max-sm:max-h-[55%] max-sm:w-full max-sm:rounded-t-xl max-sm:border-t">
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
                  <pre className="font-mono text-xs leading-5 text-ink-2">
                    {openFile.text.split('\n').map((line, i) => (
                      <div key={i} className="flex">
                        <span className="tabular w-10 shrink-0 select-none pr-3 text-right text-ink-3">{i + 1}</span>
                        <span className="whitespace-pre-wrap break-all">{line || ' '}</span>
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
