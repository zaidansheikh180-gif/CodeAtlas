// Feedback panel (phase 7): the repo's feedback memory - every useful,
// dead-end and corrected rating - with delete, edit (corrections), JSON
// export/import, and the lessons document generated from it (spec-2
// sections 17-18). All local IndexedDB; nothing leaves the browser unless
// the user exports.

import { useEffect, useRef, useState } from 'react'
import { deleteFeedback, listFeedback, putFeedback } from '../lib/db'
import { buildLessons, exportFeedback, parseFeedbackImport, type FeedbackRec, type FeedbackType } from '../lib/feedback'
import type { RepoRec } from '../lib/types'

interface Props {
  repo: RepoRec
  onClose: () => void
}

const TYPE_LABEL: Record<FeedbackType, string> = { useful: 'Useful', deadend: 'Dead end', corrected: 'Corrected' }
const TYPE_CLASS: Record<FeedbackType, string> = {
  useful: 'border-emerald-500/40 text-emerald-400',
  deadend: 'border-error/40 text-error',
  corrected: 'border-amber-500/40 text-amber-400',
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export default function FeedbackPanel({ repo, onClose }: Props) {
  const [records, setRecords] = useState<FeedbackRec[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const refresh = async () => {
    setRecords(await listFeedback(repo.id))
  }
  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo.id])

  const remove = async (rec: FeedbackRec) => {
    if (!window.confirm(`Delete this ${TYPE_LABEL[rec.type].toLowerCase()} rating on "${rec.question}"?`)) return
    await deleteFeedback(rec.id)
    await refresh()
  }

  const saveEdit = async (rec: FeedbackRec) => {
    const text = editText.trim()
    await putFeedback({ ...rec, correction: text || undefined })
    setEditingId(null)
    await refresh()
  }

  const doExport = () => {
    download(`codeatlas-feedback-${repo.fullName.replace('/', '-')}.json`, exportFeedback(records), 'application/json')
  }

  const doLessons = () => {
    const lessons = buildLessons(records, Date.now())
    download(`codeatlas-lessons-${repo.fullName.replace('/', '-')}.md`, lessons.markdown, 'text/markdown')
  }

  const doImport = async (file: File) => {
    setError(null)
    setNotice(null)
    const parsed = parseFeedbackImport(await file.text())
    if (parsed.error) {
      setError(parsed.error)
      return
    }
    // Imported records belong to this repo's memory: point them at it unless
    // they already carry this repo id (a round-tripped export).
    const adopted = parsed.records.map((r) => (r.repoId === repo.id ? r : { ...r, repoId: repo.id }))
    for (const rec of adopted) await putFeedback(rec)
    setNotice(`Imported ${adopted.length} ${adopted.length === 1 ? 'entry' : 'entries'}${parsed.skipped ? `, skipped ${parsed.skipped} invalid` : ''}.`)
    await refresh()
  }

  return (
    <div className="absolute right-4 top-4 z-10 flex max-h-[75%] w-96 max-w-[calc(100%-2rem)] flex-col rounded-lg border border-line bg-surface-1 shadow-lg">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <p className="text-xs font-semibold text-ink">Feedback memory</p>
        <div className="flex items-center gap-2">
          <button
            onClick={doLessons}
            disabled={records.length === 0}
            title="Generate the lessons document from this feedback"
            className="rounded border border-line px-1.5 py-0.5 text-[10px] font-semibold text-ink-2 hover:border-dragon hover:text-ink disabled:opacity-40"
          >
            Lessons
          </button>
          <button
            onClick={doExport}
            disabled={records.length === 0}
            className="rounded border border-line px-1.5 py-0.5 text-[10px] font-semibold text-ink-2 hover:border-dragon hover:text-ink disabled:opacity-40"
          >
            Export
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="rounded border border-line px-1.5 py-0.5 text-[10px] font-semibold text-ink-2 hover:border-dragon hover:text-ink"
          >
            Import
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void doImport(f)
              e.target.value = ''
            }}
          />
          <button onClick={onClose} aria-label="Close feedback" className="text-ink-3 hover:text-ink">
            ✕
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <p className="text-[10px] leading-relaxed text-ink-3">
          Ratings on graph answers steer future answers: useful nodes rank earlier, dead ends sink, and a repeated
          question surfaces its correction. Everything stays in this browser unless you export it.
        </p>
        {error && <p className="mt-2 text-[11px] text-error">{error}</p>}
        {notice && <p className="mt-2 text-[11px] text-emerald-400">{notice}</p>}
        <div className="mt-3">
          {records.length === 0 && (
            <p className="py-2 text-xs text-ink-3">No feedback yet. Rate an answer below it - useful, dead end, or add a correction.</p>
          )}
          {records.map((r) => (
            <div key={r.id} className="mb-1.5 rounded-md border border-line bg-surface-2 px-2.5 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase ${TYPE_CLASS[r.type]}`}>
                  {TYPE_LABEL[r.type]}
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  {r.type === 'corrected' && (
                    <button
                      onClick={() => {
                        setEditingId(editingId === r.id ? null : r.id)
                        setEditText(r.correction ?? '')
                      }}
                      className="rounded border border-line px-1.5 py-0.5 text-[10px] font-semibold text-ink-2 hover:border-dragon hover:text-ink"
                    >
                      Edit
                    </button>
                  )}
                  <button onClick={() => void remove(r)} aria-label="Delete feedback" className="rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-3 hover:border-error hover:text-error">
                    ✕
                  </button>
                </div>
              </div>
              <p className="mt-1 text-[11px] text-ink">"{r.question}"</p>
              <p className="mt-0.5 line-clamp-2 text-[10px] text-ink-3">{r.answerSummary}</p>
              {r.type === 'corrected' && editingId === r.id ? (
                <div className="mt-1.5">
                  <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    rows={2}
                    className="w-full rounded border border-line bg-surface-1 px-2 py-1 text-[11px] text-ink outline-none focus:border-dragon"
                    placeholder="What the answer should have said"
                  />
                  <div className="mt-1 flex justify-end gap-1">
                    <button onClick={() => setEditingId(null)} className="rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-3 hover:text-ink">
                      Cancel
                    </button>
                    <button onClick={() => void saveEdit(r)} className="rounded bg-dragon px-1.5 py-0.5 text-[10px] font-semibold text-night">
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                r.correction && <p className="mt-1 text-[10px] text-amber-400">Correction: {r.correction}</p>
              )}
              <p className="mt-0.5 text-[10px] text-ink-3">
                {r.returnedNodes.length} nodes · {new Date(r.createdAt).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
