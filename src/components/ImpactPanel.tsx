// Impact analysis panel (phase 4): reverse traversal from a selected file or
// symbol, direct vs transitive dependents with dependency paths and
// citations, affected-test detection, Markdown/JSON export, and map
// highlighting. Graph math lives in src/lib/impact.ts.

import { useMemo, useState } from 'react'
import type { QueryIndex, Relation } from '../lib/graphquery'
import {
  affectedTests,
  detectTestRunner,
  formatPath,
  impactReport,
  reportToJson,
  reportToMarkdown,
  type ImpactRow,
} from '../lib/impact'
import type { FileRec } from '../lib/types'

const RELATION_CHOICES: { id: Relation; label: string }[] = [
  { id: 'defines', label: 'defines' },
  { id: 'imports', label: 'imports' },
  { id: 'calls', label: 'calls' },
]

interface Props {
  index: QueryIndex
  files: FileRec[]
  targetId: string
  onClose: () => void
  onOpenFile: (path: string, line?: number) => void
  onHighlight: (paths: string[] | null) => void
}

function download(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function ImpactPanel({ index, files, targetId, onClose, onOpenFile, onHighlight }: Props) {
  const [depth, setDepth] = useState(3)
  const [relations, setRelations] = useState<Relation[]>([])
  const [highlightOn, setHighlightOn] = useState(false)
  const [copied, setCopied] = useState(false)

  const report = useMemo(
    () => impactReport(index, targetId, { depth, relations }),
    [index, targetId, depth, relations],
  )
  const tests = useMemo(() => {
    if (!report || report.root.type !== 'file') return []
    return affectedTests(index, files, [report.root.path])
  }, [report, index, files])
  const runner = useMemo(() => detectTestRunner(files), [files])

  if (!report) return null
  const rows = [...report.direct, ...report.transitive]

  const toggleHighlight = (on: boolean) => {
    setHighlightOn(on)
    onHighlight(on ? rows.map((row) => row.node.path) : null)
  }

  const toggleRelation = (relation: Relation) => {
    setRelations((prev) => (prev.includes(relation) ? prev.filter((r) => r !== relation) : [...prev, relation]))
  }

  const cite = (row: ImpactRow) => `${row.node.path}${row.node.startLine ? `:${row.node.startLine}` : ''}`

  const RowList = ({ title, list }: { title: string; list: ImpactRow[] }) => (
    <div className="mt-3">
      <p className="text-xs font-semibold text-ink-2">
        {title} <span className="font-normal text-ink-3">({list.length})</span>
      </p>
      {list.length === 0 ? (
        <p className="mt-1 text-xs text-ink-3">None.</p>
      ) : (
        <ul className="mt-1 space-y-1.5">
          {list.map((row) => (
            <li key={`${row.node.id}:${row.depth}`} className="rounded border border-line bg-surface-2 px-2 py-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <button
                  onClick={() => onOpenFile(row.node.path, row.node.startLine)}
                  className="truncate font-mono text-xs text-dragon hover:underline"
                  title={cite(row)}
                >
                  {row.node.name}
                </button>
                <span className="shrink-0 text-[10px] text-ink-3">
                  {row.node.type} · depth {row.depth}
                </span>
              </div>
              <button
                onClick={() => onOpenFile(row.node.path, row.node.startLine)}
                className="mt-0.5 block w-full truncate text-left font-mono text-[10px] text-ink-3 hover:text-ink-2"
              >
                {cite(row)}
              </button>
              <p className="mt-0.5 truncate font-mono text-[10px] text-ink-3" title={formatPath(row.path)}>
                {formatPath(row.path)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )

  return (
    <div className="absolute right-4 top-4 z-10 flex max-h-[80%] w-[26rem] max-w-[calc(100%-2rem)] flex-col rounded-lg border border-line bg-surface-1 shadow-lg">
      <div className="flex items-start justify-between gap-2 border-b border-line px-3 py-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-ink">Impact of changing</p>
          <p className="truncate font-mono text-xs text-dragon" title={report.root.path}>
            {report.root.name}
            <span className="text-ink-3"> ({report.root.type})</span>
          </p>
        </div>
        <button
          onClick={() => {
            onHighlight(null)
            onClose()
          }}
          aria-label="Close impact panel"
          className="text-ink-3 hover:text-ink"
        >
          ✕
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-3 py-2">
        <label className="flex items-center gap-1 text-xs text-ink-2">
          Depth
          <select
            value={depth}
            onChange={(e) => setDepth(Number(e.target.value))}
            className="rounded border border-line bg-surface-2 px-1 py-0.5 font-mono text-xs text-ink"
          >
            {[1, 2, 3, 4, 5].map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        {RELATION_CHOICES.map((choice) => (
          <label key={choice.id} className="flex items-center gap-1 text-xs text-ink-2">
            <input
              type="checkbox"
              checked={relations.includes(choice.id)}
              onChange={() => toggleRelation(choice.id)}
              className="accent-dragon"
            />
            {choice.label}
          </label>
        ))}
        <label className="flex items-center gap-1 text-xs text-ink-2">
          <input
            type="checkbox"
            checked={highlightOn}
            onChange={(e) => toggleHighlight(e.target.checked)}
            className="accent-dragon"
          />
          Highlight on map
        </label>
        <span className="flex gap-1">
          <button
            onClick={() => download(`impact-${report.root.name}.md`, reportToMarkdown(report), 'text/markdown')}
            className="rounded border border-line px-2 py-0.5 text-xs text-ink-2 hover:border-dragon hover:text-ink"
          >
            Export MD
          </button>
          <button
            onClick={() => download(`impact-${report.root.name}.json`, reportToJson(report), 'application/json')}
            className="rounded border border-line px-2 py-0.5 text-xs text-ink-2 hover:border-dragon hover:text-ink"
          >
            Export JSON
          </button>
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
        <p className="mt-2 text-xs text-ink-3">
          {report.direct.length} direct · {report.transitive.length} transitive dependent
          {report.transitive.length === 1 ? '' : 's'}
          {report.truncated ? ' · list truncated at 200 nodes' : ''}
        </p>

        {report.root.type === 'file' && (
          <div className="mt-3">
            <p className="text-xs font-semibold text-ink-2">
              Affected tests <span className="font-normal text-ink-3">({tests.length})</span>
            </p>
            {tests.length === 0 ? (
              <p className="mt-1 text-xs text-ink-3">No test files reference or mirror this file.</p>
            ) : (
              <>
                <ul className="mt-1 space-y-1">
                  {tests.map((hit) => (
                    <li key={hit.testPath} className="flex items-baseline justify-between gap-2">
                      <button
                        onClick={() => onOpenFile(hit.testPath)}
                        className="truncate font-mono text-xs text-dragon hover:underline"
                        title={hit.reason}
                      >
                        {hit.testPath}
                      </button>
                      <span
                        className={`shrink-0 rounded px-1 py-0.5 text-[10px] ${hit.confirmed ? 'bg-surface-3 text-ink-2' : 'border border-line text-ink-3'}`}
                        title={hit.reason}
                      >
                        {hit.confirmed ? 'confirmed' : 'heuristic'}
                      </span>
                    </li>
                  ))}
                </ul>
                {runner && (
                  <button
                    onClick={() => {
                      const cmd = tests.length === 1 ? runner.command(tests[0].testPath) : tests.map((t) => runner.command(t.testPath)).join(' && ')
                      void navigator.clipboard.writeText(cmd).then(() => {
                        setCopied(true)
                        setTimeout(() => setCopied(false), 1500)
                      })
                    }}
                    className="mt-1.5 rounded border border-line px-2 py-0.5 text-xs text-ink-2 hover:border-dragon hover:text-ink"
                    title="Copy a suggested test command for the affected tests"
                  >
                    {copied ? 'Copied' : `Copy test command (${runner.runner})`}
                  </button>
                )}
              </>
            )}
          </div>
        )}

        <RowList title="Direct dependents" list={report.direct} />
        <RowList title="Transitive dependents" list={report.transitive} />
      </div>
    </div>
  )
}
