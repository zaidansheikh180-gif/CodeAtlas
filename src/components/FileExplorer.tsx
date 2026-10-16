// File and dependency explorer (phase 4): the repository tree with sizes and
// dependency-count badges, expand/collapse, tree search, name/size/deps
// sorting, and virtualized rows so large repositories stay smooth. Selection
// stays in sync with the architecture map (selected module) and the source
// viewer (open file).

import { useEffect, useMemo, useRef, useState } from 'react'
import { buildFileTree, computeDepCounts, flattenTree, formatSize, type TreeSort } from '../lib/explore'
import type { EdgeRec, FileRec } from '../lib/types'

interface Props {
  files: FileRec[]
  edges: EdgeRec[]
  openFilePath: string | null
  selectedModule: string | null
  onSelectFile: (path: string) => void
  onClose: () => void
}

const ROW_H = 24
const OVERSCAN = 12

export default function FileExplorer({ files, edges, openFilePath, selectedModule, onSelectFile, onClose }: Props) {
  const [sort, setSort] = useState<TreeSort>('name')
  const [treeQuery, setTreeQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(600)
  const bodyRef = useRef<HTMLDivElement>(null)

  const depCounts = useMemo(() => computeDepCounts(edges), [edges])
  const tree = useMemo(() => buildFileTree(files, depCounts, sort), [files, depCounts, sort])

  // Default: first-level folders expanded, once data arrives.
  useEffect(() => {
    setExpanded((prev) => {
      if (prev.size > 0 || tree.children.length === 0) return prev
      return new Set(tree.children.filter((n) => n.kind === 'folder').map((n) => n.path))
    })
  }, [tree])

  // Track the viewport height for the virtual window.
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setViewportH(el.clientHeight))
    observer.observe(el)
    setViewportH(el.clientHeight)
    return () => observer.disconnect()
  }, [])

  // Tree search: flat filtered list beats walking a collapsed tree.
  const query = treeQuery.trim().toLowerCase()
  const filteredFiles = useMemo(
    () => (query ? files.filter((f) => f.path.toLowerCase().includes(query)).slice(0, 200) : null),
    [files, query],
  )

  const rows = useMemo(() => flattenTree(tree, expanded), [tree, expanded])

  // Sync with the map and viewer: reveal the open file / selected module.
  useEffect(() => {
    const target = openFilePath ?? (selectedModule ? `${selectedModule}/` : null)
    if (!target || query) return
    const folder = target.split('/').slice(0, -1).join('/')
    if (!folder) return
    setExpanded((prev) => {
      if (prev.has(folder)) return prev
      const next = new Set(prev)
      // Expand every ancestor so the row is visible.
      const parts = folder.split('/')
      for (let i = 1; i <= parts.length; i++) next.add(parts.slice(0, i).join('/'))
      return next
    })
  }, [openFilePath, selectedModule, query])

  // Scroll the open file's row into view once it exists in the flat rows.
  useEffect(() => {
    if (!openFilePath || query) return
    const idx = rows.findIndex((r) => r.node.kind === 'file' && r.node.path === openFilePath)
    const el = bodyRef.current
    if (idx >= 0 && el) {
      const top = idx * ROW_H
      if (top < el.scrollTop || top > el.scrollTop + el.clientHeight - ROW_H) {
        el.scrollTop = Math.max(0, top - el.clientHeight / 2)
      }
    }
  }, [openFilePath, rows, query])

  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN)
  const endIdx = Math.min(
    filteredFiles ? filteredFiles.length : rows.length,
    Math.ceil((scrollTop + viewportH) / ROW_H) + OVERSCAN,
  )

  const toggleFolder = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  return (
    <div className="flex h-full flex-col bg-surface-1">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">Explorer</p>
        <button onClick={onClose} aria-label="Close explorer" className="text-ink-3 hover:text-ink">✕</button>
      </div>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <input
          value={treeQuery}
          onChange={(e) => setTreeQuery(e.target.value)}
          placeholder="Filter files"
          aria-label="Filter files in the tree"
          className="min-w-0 flex-1 rounded border border-line bg-surface-2 px-2 py-1 font-mono text-xs text-ink placeholder:text-ink-3 focus:border-dragon focus:outline-none"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as TreeSort)}
          aria-label="Sort files"
          className="rounded border border-line bg-surface-2 px-1.5 py-1 text-xs text-ink-2 focus:border-dragon focus:outline-none"
        >
          <option value="name">Name</option>
          <option value="size">Size</option>
          <option value="deps">Deps</option>
        </select>
      </div>
      <div ref={bodyRef} className="min-h-0 flex-1 overflow-auto" onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
        {filteredFiles ? (
          <div style={{ height: filteredFiles.length * ROW_H, position: 'relative' }}>
            {filteredFiles.slice(startIdx, endIdx).map((f, i) => (
              <button
                key={f.id}
                onClick={() => onSelectFile(f.path)}
                style={{ top: (startIdx + i) * ROW_H, height: ROW_H }}
                className={`absolute inset-x-0 truncate px-3 text-left font-mono text-xs ${
                  f.path === openFilePath ? 'bg-dragon/15 text-ink' : 'text-ink-2 hover:bg-surface-2'
                }`}
              >
                {f.path}
              </button>
            ))}
            {filteredFiles.length === 0 && <p className="px-3 py-2 text-xs text-ink-3">No files match.</p>}
          </div>
        ) : (
          <div style={{ height: rows.length * ROW_H, position: 'relative' }}>
            {rows.slice(startIdx, endIdx).map((row, i) => {
              const top = (startIdx + i) * ROW_H
              const pad = 8 + row.depth * 14
              if (row.node.kind === 'folder') {
                const isOpen = expanded.has(row.node.path)
                return (
                  <button
                    key={`d-${row.node.path}`}
                    onClick={() => toggleFolder(row.node.path)}
                    style={{ top, height: ROW_H, paddingLeft: pad }}
                    className="absolute inset-x-0 flex items-center gap-1.5 text-left font-mono text-xs text-ink hover:bg-surface-2"
                  >
                    <span className="text-ink-3">{isOpen ? '▾' : '▸'}</span>
                    <span className="truncate">{row.node.name}/</span>
                    <span className="shrink-0 text-ink-3">{row.node.fileCount}</span>
                  </button>
                )
              }
              const deps = row.node.importsOut + row.node.importsIn
              return (
                <button
                  key={row.node.path}
                  onClick={() => onSelectFile(row.node.path)}
                  style={{ top, height: ROW_H, paddingLeft: pad + 14 }}
                  className={`absolute inset-x-0 flex items-center gap-1.5 text-left font-mono text-xs ${
                    row.node.path === openFilePath ? 'bg-dragon/15 text-ink' : 'text-ink-2 hover:bg-surface-2'
                  }`}
                  title={row.node.path}
                >
                  <span className="truncate">{row.node.name}</span>
                  <span className="ml-auto shrink-0 pr-2 text-ink-3">
                    {formatSize(row.node.file.size)}
                    {deps > 0 && <span className="ml-1.5 rounded bg-surface-2 px-1 text-dragon">⇅{deps}</span>}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
