// Export panel (phase 5): downloads for the repository graph and the
// architecture map. Everything renders client-side from the already-loaded
// index - no network. Graph JSON carries full file text so an import keeps
// every citation; filtered subsets narrow by top-level module and edge type.
// Map exports cover JSON, Mermaid, GraphML and a PNG snapshot of the canvas.
// Call-flow Mermaid export already lives in the call-flow panel (phase 4).

import { useMemo, useState } from 'react'
import { exportGraph, exportMapJson, mapToGraphml, mapToMermaid } from '../lib/graphexport'
import type { ModuleEdge, ModuleNode } from '../lib/modules'
import type { EdgeRec, EdgeType, FileRec, RepoRec, SymbolRec } from '../lib/types'

interface Props {
  repo: RepoRec
  files: FileRec[]
  symbols: SymbolRec[]
  edges: EdgeRec[]
  modules: ModuleNode[]
  moduleEdges: ModuleEdge[]
  onClose: () => void
}

function download(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function slug(name: string): string {
  return name.replace(/[^a-z0-9-]+/gi, '-')
}

export default function ExportPanel({ repo, files, symbols, edges, modules, moduleEdges, onClose }: Props) {
  const [pickedModules, setPickedModules] = useState<string[]>([])
  const [pickedTypes, setPickedTypes] = useState<EdgeType[]>(['imports', 'calls', 'contains'])

  const topLevel = useMemo(() => [...new Set(files.map((f) => f.path.split('/')[0]))].sort(), [files])
  const filtered = useMemo(() => {
    const out = exportGraph(repo, files, symbols, edges, { modules: pickedModules, edgeTypes: pickedTypes })
    return out.counts
  }, [repo, files, symbols, edges, pickedModules, pickedTypes])

  const base = slug(`${repo.fullName}-${repo.commit.slice(0, 7)}`)

  const toggle = (list: string[], value: string, set: (v: never[]) => void) => {
    set(list.includes(value) ? (list.filter((v) => v !== value) as never[]) : ([...list, value] as never[]))
  }

  const downloadPng = () => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[aria-label^="Architecture map"]')
    if (!canvas) return
    canvas.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `codeatlas-map-${base}.png`
      a.click()
      URL.revokeObjectURL(url)
    }, 'image/png')
  }

  return (
    <div className="absolute right-4 top-4 z-10 flex max-h-[75%] w-96 max-w-[calc(100%-2rem)] flex-col rounded-lg border border-line bg-surface-1 shadow-lg">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <p className="text-xs font-semibold text-ink">Export</p>
        <button onClick={onClose} aria-label="Close export" className="text-ink-3 hover:text-ink">
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <p className="text-[11px] font-semibold text-ink-2">Repository graph</p>
        <p className="mt-0.5 text-[10px] leading-relaxed text-ink-3">
          Full-fidelity JSON: repository metadata, schema version, every file (with text), symbol and edge. Import it later from the
          landing page.
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {topLevel.map((m) => (
            <button
              key={m}
              onClick={() => toggle(pickedModules, m, setPickedModules as never)}
              aria-pressed={pickedModules.includes(m)}
              className={`rounded-md border px-1.5 py-0.5 font-mono text-[10px] ${pickedModules.includes(m) ? 'border-dragon bg-surface-2 text-dragon' : 'border-line text-ink-3 hover:text-ink'}`}
            >
              {m}
            </button>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-3 text-[10px] text-ink-2">
          {(['imports', 'calls', 'contains'] as EdgeType[]).map((t) => (
            <label key={t} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={pickedTypes.includes(t)}
                onChange={() => toggle(pickedTypes, t, setPickedTypes as never)}
                className="accent-dragon"
              />
              {t}
            </label>
          ))}
          <span className="ml-auto text-ink-3">
            {filtered.files} files · {filtered.edges} edges
          </span>
        </div>
        <button
          onClick={() => download(`codeatlas-graph-${base}.json`, JSON.stringify(exportGraph(repo, files, symbols, edges, { modules: pickedModules, edgeTypes: pickedTypes }), null, 2), 'application/json')}
          className="mt-2 w-full rounded-lg bg-dragon px-3 py-1.5 text-xs font-semibold text-night"
        >
          {pickedModules.length === 0 && pickedTypes.length === 3 ? 'Export full graph JSON' : 'Export filtered graph JSON'}
        </button>

        <div className="my-3 border-t border-line" />
        <p className="text-[11px] font-semibold text-ink-2">Architecture map</p>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <button
            onClick={() => download(`codeatlas-map-${base}.json`, exportMapJson(repo, modules, moduleEdges), 'application/json')}
            className="rounded-md border border-line px-2 py-1.5 text-[11px] font-semibold text-ink-2 hover:text-ink"
          >
            Map JSON
          </button>
          <button
            onClick={() => download(`codeatlas-map-${base}.mmd`, mapToMermaid(modules, moduleEdges), 'text/plain')}
            className="rounded-md border border-line px-2 py-1.5 text-[11px] font-semibold text-ink-2 hover:text-ink"
          >
            Mermaid
          </button>
          <button
            onClick={() => download(`codeatlas-map-${base}.graphml`, mapToGraphml(modules, moduleEdges), 'application/xml')}
            className="rounded-md border border-line px-2 py-1.5 text-[11px] font-semibold text-ink-2 hover:text-ink"
          >
            GraphML
          </button>
          <button onClick={downloadPng} className="rounded-md border border-line px-2 py-1.5 text-[11px] font-semibold text-ink-2 hover:text-ink">
            PNG snapshot
          </button>
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-ink-3">
          The PNG captures the map exactly as it is on screen. Call flows export as Mermaid from the call-flow panel.
        </p>
      </div>
    </div>
  )
}
