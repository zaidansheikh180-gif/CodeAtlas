// Command-palette search (phase 4): Ctrl/Cmd+K or the header button opens it.
// Groups follow the feature-pack spec (Files, Symbols, Code matches, Graph
// nodes); Enter opens the active result, arrows move, Esc closes. Queries are
// debounced and run in the search worker.

import { useEffect, useMemo, useRef, useState } from 'react'
import { GROUP_ORDER, type SearchOutcome, type SearchResult } from '../lib/search'

interface Props {
  open: boolean
  onClose: () => void
  search: (text: string) => Promise<SearchOutcome>
  onOpenFile: (path: string, line?: number) => void
  onOpenModule: (name: string) => void
}

export default function SearchPalette({ open, onClose, search, onOpenFile, onOpenModule }: Props) {
  const [query, setQuery] = useState('')
  const [outcome, setOutcome] = useState<SearchOutcome>({ results: [], truncated: false })
  const [active, setActive] = useState(0)
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const seqRef = useRef(0)

  useEffect(() => {
    if (open) {
      setQuery('')
      setOutcome({ results: [], truncated: false })
      setActive(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  // Debounced worker search; stale responses are dropped by sequence number.
  useEffect(() => {
    if (!open) return
    const text = query.trim()
    if (!text) {
      setOutcome({ results: [], truncated: false })
      setSearching(false)
      return
    }
    setSearching(true)
    const seq = ++seqRef.current
    const timer = window.setTimeout(() => {
      void search(text).then((out) => {
        if (seq !== seqRef.current) return
        setOutcome(out)
        setActive(0)
        setSearching(false)
      })
    }, 150)
    return () => window.clearTimeout(timer)
  }, [query, open, search])

  const choose = (r: SearchResult) => {
    if (r.group === 'Graph nodes' && r.moduleName) onOpenModule(r.moduleName)
    else onOpenFile(r.path, r.line)
    onClose()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, outcome.results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const r = outcome.results[active]
      if (r) choose(r)
    }
  }

  const grouped = useMemo(() => {
    const map = new Map<string, SearchResult[]>()
    for (const g of GROUP_ORDER) map.set(g, [])
    for (const r of outcome.results) map.get(r.group)!.push(r)
    return map
  }, [outcome])

  if (!open) return null
  let flatIndex = -1

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-night/70 px-4 pt-[12vh]" onClick={onClose}>
      <div
        className="flex max-h-[70vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-line bg-surface-1 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Search the repository"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search files, symbols, code, modules - wrap in /slashes/ for regex"
          aria-label="Search query"
          className="border-b border-line bg-surface-1 px-4 py-3 font-mono text-sm text-ink placeholder:text-ink-3 focus:outline-none"
        />
        <div className="min-h-0 flex-1 overflow-auto py-1">
          {outcome.error ? (
            <p className="px-4 py-3 text-sm text-error">{outcome.error}</p>
          ) : query.trim() && !searching && outcome.results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-3">No matches for "{query.trim()}".</p>
          ) : !query.trim() ? (
            <p className="px-4 py-3 text-sm text-ink-3">
              Type to search. Exact, case-insensitive, prefix, fuzzy and /regex/ matching; results open at the exact line.
            </p>
          ) : (
            GROUP_ORDER.map((group) => {
              const rows = grouped.get(group) ?? []
              if (rows.length === 0) return null
              return (
                <div key={group}>
                  <p className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-ink-3">{group}</p>
                  <ul>
                    {rows.map((r, i) => {
                      flatIndex++
                      const idx = flatIndex
                      return (
                        <li key={`${group}-${i}`}>
                          <button
                            onClick={() => choose(r)}
                            onMouseEnter={() => setActive(idx)}
                            className={`flex w-full items-baseline gap-2 px-4 py-1.5 text-left font-mono text-xs ${
                              idx === active ? 'bg-dragon/15 text-ink' : 'text-ink-2'
                            }`}
                          >
                            {r.group === 'Symbols' && <span className="shrink-0 text-dragon">{r.name}</span>}
                            {r.group === 'Graph nodes' && <span className="shrink-0 text-dragon">{r.moduleName}</span>}
                            <span className="truncate">
                              {r.path}
                              {r.line != null ? `:${r.line}` : ''}
                            </span>
                            {r.group === 'Symbols' && <span className="shrink-0 text-ink-3">{r.symbolKind}</span>}
                            {r.group === 'Graph nodes' && <span className="shrink-0 text-ink-3">module</span>}
                            {r.preview && <span className="truncate text-ink-3">{r.preview}</span>}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            })
          )}
        </div>
        <p className="border-t border-line px-4 py-2 text-xs text-ink-3">
          {outcome.truncated ? 'Showing the best matches per group. ' : ''}↑↓ move · Enter open · Esc close
        </p>
      </div>
    </div>
  )
}
