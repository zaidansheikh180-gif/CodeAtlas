// Communities panel (phase 5): lists the detected communities with their
// statistics - files, main language, internal/external edges, hub files and
// evidence paths. Clicking a row inspects that community on the map (other
// modules dim). Labels default to deterministic placeholders and can be
// renamed; renames persist locally per repo and community id. Clustering
// itself runs in the search worker (src/workers/search.worker.ts) over
// src/lib/cluster.ts - no LLM anywhere in this path.

import { useState } from 'react'
import type { CommunityStat } from '../lib/cluster'

interface Props {
  communities: CommunityStat[]
  labels: Record<string, string>
  colors: Map<string, string> // community id -> color
  selected: string | null
  loading: boolean
  onSelect: (id: string | null) => void
  onRename: (id: string, label: string) => void
  onRegenerate: () => void
  onClose: () => void
}

export default function CommunitiesPanel({ communities, labels, colors, selected, loading, onSelect, onRename, onRegenerate, onClose }: Props) {
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const commitRename = (id: string) => {
    const trimmed = draft.trim()
    if (trimmed) onRename(id, trimmed)
    setEditing(null)
  }

  return (
    <div className="absolute left-3 top-14 z-10 flex max-h-[70%] w-80 flex-col rounded-lg border border-line bg-surface-1 shadow-lg">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <p className="text-xs font-semibold text-ink">
          Communities
          <span className="ml-1.5 font-normal text-ink-3">{communities.length}</span>
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={onRegenerate}
            aria-label="Regenerate communities"
            title="Recompute communities from the current index"
            className="text-ink-3 hover:text-ink"
          >
            ↻
          </button>
          <button onClick={onClose} aria-label="Close communities" className="text-ink-3 hover:text-ink">
            ✕
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-1.5">
        {loading && <p className="px-2 py-3 text-xs text-ink-3">Clustering in the worker…</p>}
        {!loading && communities.length === 0 && <p className="px-2 py-3 text-xs text-ink-3">No communities yet.</p>}
        {!loading &&
          communities.map((c) => {
            const label = labels[c.id] ?? `Community ${c.index}`
            const isSelected = selected === c.id
            return (
              <div
                key={c.id}
                className={`mb-1 cursor-pointer rounded-md border px-2.5 py-2 ${isSelected ? 'border-dragon bg-surface-2' : 'border-transparent hover:bg-surface-2'}`}
                onClick={() => onSelect(isSelected ? null : c.id)}
              >
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colors.get(c.id) ?? '#8a76b3' }} aria-hidden />
                  {editing === c.id ? (
                    <input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => commitRename(c.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(c.id)
                        if (e.key === 'Escape') setEditing(null)
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="min-w-0 flex-1 rounded border border-line bg-surface-1 px-1 py-0.5 text-xs text-ink outline-none focus:border-dragon"
                    />
                  ) : (
                    <p className="min-w-0 flex-1 truncate text-xs font-semibold text-ink">{label}</p>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setDraft(labels[c.id] ?? `Community ${c.index}`)
                      setEditing(c.id)
                    }}
                    aria-label={`Rename ${label}`}
                    className="shrink-0 text-ink-3 hover:text-ink"
                  >
                    ✎
                  </button>
                </div>
                <p className="mt-1 text-[10px] leading-relaxed text-ink-3">
                  {c.fileCount} {c.fileCount === 1 ? 'file' : 'files'}
                  {c.mainLanguage ? ` · ${c.mainLanguage}` : ''} · {c.internalEdges} internal / {c.externalEdges} external edges
                </p>
                {c.hubs.length > 0 && (
                  <p className="mt-0.5 truncate font-mono text-[10px] text-ink-3" title={c.hubs.map((h) => h.path).join(', ')}>
                    hubs: {c.hubs.map((h) => h.path.split('/').pop()).join(', ')}
                  </p>
                )}
                <p className="mt-0.5 text-[10px] text-ink-3">paths: {c.topPaths.join(', ')}</p>
              </div>
            )
          })}
      </div>
    </div>
  )
}
