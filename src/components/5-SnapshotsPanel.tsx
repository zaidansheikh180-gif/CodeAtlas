// Snapshots panel (phase 6): save the current index as a frozen snapshot,
// list saved snapshots for this repository, open one as a read-only map, and
// delete snapshots. Snapshots are single IndexedDB records holding the full
// graph (src/lib/snapshots.ts), so they survive re-indexing. Opening
// materializes the snapshot under its own repo id via the import machinery,
// then navigates to it. Version comparison lives in the compare view.

import { useEffect, useState } from 'react'
import { deleteRepo, deleteSnapshot, listSnapshots, putAll, putRepo, putSnapshot } from '../lib/db'
import { remapImport } from '../lib/graphexport'
import { makeSnapshot, type SnapshotRec } from '../lib/snapshots'
import type { EdgeRec, FileRec, RepoRec, SymbolRec } from '../lib/types'

interface Props {
  repo: RepoRec
  files: FileRec[]
  symbols: SymbolRec[]
  edges: EdgeRec[]
  onOpenRepo: (repoId: string) => void
  onClose: () => void
}

export function snapshotViewId(snapshotId: string): string {
  return `snapview:${snapshotId}`
}

export default function SnapshotsPanel({ repo, files, symbols, edges, onOpenRepo, onClose }: Props) {
  const [snapshots, setSnapshots] = useState<SnapshotRec[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    setSnapshots(await listSnapshots(repo.url))
  }
  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo.url])

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const snapshot = makeSnapshot(repo, files, symbols, edges, Date.now())
      await putSnapshot(snapshot)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the snapshot.')
    } finally {
      setBusy(false)
    }
  }

  const open = async (snapshot: SnapshotRec) => {
    setBusy(true)
    setError(null)
    try {
      const viewId = snapshotViewId(snapshot.id)
      await deleteRepo(viewId).catch(() => undefined) // replace any older view of this snapshot
      const { files: vFiles, symbols: vSymbols, edges: vEdges } = remapImport(snapshot.data, viewId)
      const viewRepo: RepoRec = {
        id: viewId,
        url: snapshot.repoUrl,
        fullName: snapshot.fullName,
        commit: snapshot.commit,
        defaultBranch: snapshot.ref,
        ref: snapshot.ref,
        status: 'ready',
        description: `Snapshot of ${snapshot.ref} saved ${new Date(snapshot.createdAt).toLocaleString()}.`,
        language: null,
        sizeKb: 0,
        stats: {
          files: vFiles.length,
          parsedFiles: vFiles.length,
          symbols: vSymbols.length,
          edges: vEdges.length,
          secretsExcluded: 0,
        },
        indexedAt: snapshot.indexedAt,
        imported: true,
        snapshot: true,
      }
      await putRepo(viewRepo)
      await putAll<FileRec>('files', vFiles)
      await putAll<SymbolRec>('symbols', vSymbols)
      await putAll<EdgeRec>('edges', vEdges)
      onOpenRepo(viewId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open the snapshot.')
      setBusy(false)
    }
  }

  const remove = async (snapshot: SnapshotRec) => {
    if (!window.confirm(`Delete the snapshot of ${snapshot.ref} (${snapshot.commit.slice(0, 7)})? The live index is not affected.`)) return
    await deleteSnapshot(snapshot.id)
    await deleteRepo(snapshotViewId(snapshot.id)).catch(() => undefined)
    await refresh()
  }

  return (
    <div className="absolute right-4 top-4 z-10 flex max-h-[75%] w-96 max-w-[calc(100%-2rem)] flex-col rounded-lg border border-line bg-surface-1 shadow-lg">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <p className="text-xs font-semibold text-ink">Snapshots</p>
        <button onClick={onClose} aria-label="Close snapshots" className="text-ink-3 hover:text-ink">
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <p className="text-[10px] leading-relaxed text-ink-3">
          A snapshot freezes this index - files, symbols and edges - so you can reopen or compare it after the code moves on.
        </p>
        <button onClick={() => void save()} disabled={busy} className="mt-2 w-full rounded-lg bg-dragon px-3 py-1.5 text-xs font-semibold text-night disabled:opacity-50">
          {busy ? 'Working…' : 'Save a snapshot of this version'}
        </button>
        {error && <p className="mt-2 text-[11px] text-error">{error}</p>}
        <div className="mt-3">
          {snapshots.length === 0 && <p className="py-2 text-xs text-ink-3">No snapshots saved for this repository yet.</p>}
          {snapshots.map((s) => (
            <div key={s.id} className="mb-1.5 rounded-md border border-line bg-surface-2 px-2.5 py-2">
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 truncate font-mono text-[11px] text-ink">
                  {s.ref} <span className="text-ink-3">@ {s.commit.slice(0, 7)}</span>
                </p>
                <div className="flex shrink-0 items-center gap-1">
                  <button onClick={() => void open(s)} disabled={busy} className="rounded border border-line px-1.5 py-0.5 text-[10px] font-semibold text-ink-2 hover:border-dragon hover:text-ink disabled:opacity-50">
                    Open
                  </button>
                  <button onClick={() => void remove(s)} aria-label="Delete snapshot" className="rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-3 hover:border-error hover:text-error">
                    ✕
                  </button>
                </div>
              </div>
              <p className="mt-0.5 text-[10px] text-ink-3">
                {s.counts.files} files · {s.counts.symbols} symbols · {s.counts.edges} edges · saved {new Date(s.createdAt).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
