// Watch panel (phase 8 part 2): the live face of local watch mode. The
// session itself lives in RepoView so watching continues when this panel
// closes; the panel is presentational - status, pending changes, and the
// pause/resume/stop controls. The File System Access API has no native
// change events, so watching re-scans the folder on a poll interval; the
// intro says so honestly.

import type { WatchChangeSummary, WatchState } from '../lib/localwatch'

interface Props {
  state: WatchState | { kind: 'idle' }
  changes: WatchChangeSummary | null
  hasHandle: boolean
  onStart: () => void
  onLinkFolder: () => void
  onAllow: () => void
  onPause: () => void
  onResume: () => void
  onStop: () => void
  onClose: () => void
}

export default function WatchPanel({ state, changes, hasHandle, onStart, onLinkFolder, onAllow, onPause, onResume, onStop, onClose }: Props) {
  const kind = state.kind
  return (
    <div className="absolute right-4 top-4 z-10 flex max-h-[75%] w-96 max-w-[calc(100%-2rem)] flex-col rounded-lg border border-line bg-surface-1 shadow-lg">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <p className="text-xs font-semibold text-ink">Watch mode</p>
        <div className="flex items-center gap-2">
          {kind === 'watching' && (
            <button onClick={onPause} className="rounded border border-line px-1.5 py-0.5 text-[10px] font-semibold text-ink-2 hover:border-dragon hover:text-ink">
              Pause
            </button>
          )}
          {kind === 'paused' && (
            <button onClick={onResume} className="rounded border border-line px-1.5 py-0.5 text-[10px] font-semibold text-ink-2 hover:border-dragon hover:text-ink">
              Resume
            </button>
          )}
          {(kind === 'watching' || kind === 'paused' || kind === 'updating') && (
            <button onClick={onStop} className="rounded border border-line px-1.5 py-0.5 text-[10px] font-semibold text-ink-2 hover:border-error hover:text-error">
              Stop
            </button>
          )}
          <button onClick={onClose} aria-label="Close watch panel" className="text-ink-3 hover:text-ink">
            ✕
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {kind === 'idle' && (
          <>
            <p className="text-[10px] leading-relaxed text-ink-3">
              Watch mode keeps this index fresh as you edit the folder: CodeAtlas re-scans it every few seconds (the
              File System Access API has no native change events), detects added, modified, deleted and renamed files,
              and updates the graph incrementally. Files never leave this device.
            </p>
            {hasHandle ? (
              <button onClick={onStart} className="mt-2 w-full rounded-lg bg-dragon px-3 py-1.5 text-xs font-semibold text-night">
                Start watching
              </button>
            ) : (
              <>
                <p className="mt-2 text-[10px] leading-relaxed text-ink-3">
                  This index was created before watch mode existed, so CodeAtlas needs you to point at the folder once
                  more.
                </p>
                <button onClick={onLinkFolder} className="mt-2 w-full rounded-lg bg-dragon px-3 py-1.5 text-xs font-semibold text-night">
                  Link the folder
                </button>
              </>
            )}
          </>
        )}
        {kind === 'watching' && (
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 animate-pulse rounded-full bg-success" />
            <p className="text-xs text-ink-2">
              Watching - last scan {new Date((state as { lastScan: number }).lastScan).toLocaleTimeString()}
            </p>
          </div>
        )}
        {kind === 'paused' && <p className="text-xs text-ink-2">Paused - the folder is not being scanned.</p>}
        {kind === 'updating' && (
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 animate-pulse rounded-full bg-dragon" />
            <p className="text-xs text-ink-2">Applying changes - {(state as { detail: string }).detail}</p>
          </div>
        )}
        {kind === 'needs-permission' && (
          <>
            <p className="text-xs text-ink-2">CodeAtlas needs your permission to keep reading this folder.</p>
            <button onClick={onAllow} className="mt-2 w-full rounded-lg bg-dragon px-3 py-1.5 text-xs font-semibold text-night">
              Allow access
            </button>
          </>
        )}
        {kind === 'denied' && (
          <p className="text-xs text-error">Permission to read the folder was revoked, so watching stopped.</p>
        )}
        {kind === 'stopped' && (
          <>
            <p className="text-xs text-ink-2">Watching stopped.</p>
            <button onClick={onStart} className="mt-2 w-full rounded-lg bg-dragon px-3 py-1.5 text-xs font-semibold text-night">
              Start watching again
            </button>
          </>
        )}
        {changes && (changes.added.length + changes.modified.length + changes.removed.length + changes.renamed.length > 0) && (
          <div className="mt-3 rounded-md border border-line bg-surface-2 px-2.5 py-2">
            <p className="text-[10px] font-semibold uppercase text-ink-3">Last update</p>
            {changes.added.length > 0 && <p className="mt-1 text-[11px] text-emerald-400">+ {changes.added.join(', ')}</p>}
            {changes.modified.length > 0 && <p className="mt-1 text-[11px] text-amber-400">~ {changes.modified.join(', ')}</p>}
            {changes.removed.length > 0 && <p className="mt-1 text-[11px] text-error">- {changes.removed.join(', ')}</p>}
            {changes.renamed.map((r) => (
              <p key={`${r.from}->${r.to}`} className="mt-1 text-[11px] text-dragon">
                → {r.from} renamed to {r.to}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
