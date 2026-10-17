// Local watch mode (phase 8 part 2, spec-2 section 24): keep a local-folder
// index fresh as the folder changes on disk. The File System Access API has
// no native change events, so watching means re-walking the folder on a
// poll interval and diffing each walk against the stored manifest - the
// interval is also the debounce: changes that keep arriving across scans
// accumulate, and the update fires on the first quiet scan.
//
// Change detection: size or mtime differences are candidates, the content
// hash confirms; an added file whose hash and size match a removed file is
// reported as a rename. Updates re-run the standard indexing pipeline with
// incrementalFrom = the same repo id, so unchanged files are reused from
// the previous index and only changed or added files are re-read and
// re-parsed. Local files never leave the device.

import {
  classifyChanges,
  diffManifest,
  hashText,
  walkLocalFolder,
  type LocalFileEntry,
  type LocalManifestEntry,
  type WalkedFile,
} from './localfolder'

export type WatchState =
  | { kind: 'watching'; lastScan: number }
  | { kind: 'paused' }
  | { kind: 'updating'; detail: string }
  | { kind: 'needs-permission' }
  | { kind: 'denied' }
  | { kind: 'stopped' }

export interface WatchChangeSummary {
  added: string[]
  modified: string[]
  removed: string[]
  renamed: { from: string; to: string }[]
}

export interface WatchUpdateResult {
  ok: boolean
  error?: string
}

export interface WatchSessionOptions {
  handle: FileSystemDirectoryHandle
  manifest: LocalManifestEntry[]
  intervalMs?: number
  onState: (state: WatchState) => void
  onChanges: (summary: WatchChangeSummary) => void
  // Runs the incremental re-index. Receives every walked entry: unchanged
  // ones hash-only, changed and added ones with fresh text. Resolves when
  // the pipeline finished; on success the session adopts newManifest.
  runUpdate: (entries: LocalFileEntry[], summary: WatchChangeSummary) => Promise<WatchUpdateResult>
}

export interface WatchSession {
  tick: () => Promise<void> // one scan; awaiting it joins any scan already running
  allow: () => Promise<void> // user-gesture permission request
  pause: () => void
  resume: () => void
  stop: () => void
  readonly state: WatchState
  readonly pending: WatchChangeSummary | null // changes waiting for a quiet scan
}

const DEFAULT_INTERVAL_MS = 5_000

// Two walks are the same when every path keeps its size and mtime - the
// quiet-scan signal that ends a debounce window.
function sameWalk(a: WalkedFile[], b: WalkedFile[]): boolean {
  if (a.length !== b.length) return false
  const sig = new Map(a.map((w) => [w.path, `${w.size}:${w.lastModified}`]))
  return b.every((w) => sig.get(w.path) === `${w.size}:${w.lastModified}`)
}

export function startLocalWatch(opts: WatchSessionOptions): WatchSession {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS
  let manifest = opts.manifest
  let state: WatchState = { kind: 'watching', lastScan: Date.now() }
  let timer: ReturnType<typeof setInterval> | null = null
  let current: Promise<void> | null = null
  let stopped = false
  // Pending changes accumulated across scans (the debounce): an update
  // fires on the first scan that finds nothing new.
  let pending: WatchChangeSummary = { added: [], modified: [], removed: [], renamed: [] }
  let pendingEntries = new Map<string, LocalFileEntry>()
  let lastWalk: WalkedFile[] | null = null

  const setState = (next: WatchState) => {
    state = next
    opts.onState(next)
  }

  const pendingEmpty = (p: WatchChangeSummary) =>
    p.added.length === 0 && p.modified.length === 0 && p.removed.length === 0 && p.renamed.length === 0

  const mergePending = (summary: WatchChangeSummary, entries: Map<string, LocalFileEntry>) => {
    pending = {
      added: [...new Set([...pending.added, ...summary.added])],
      modified: [...new Set([...pending.modified, ...summary.modified])],
      removed: [...new Set([...pending.removed, ...summary.removed])],
      renamed: [...pending.renamed, ...summary.renamed],
    }
    for (const [path, entry] of entries) pendingEntries.set(path, entry)
  }

  const permission = async (): Promise<'granted' | 'prompt' | 'denied'> => {
    if (!opts.handle.queryPermission) return 'granted'
    try {
      return await opts.handle.queryPermission({ mode: 'read' })
    } catch {
      return 'granted'
    }
  }

  const fireUpdate = async () => {
    const summary = pending
    pending = { added: [], modified: [], removed: [], renamed: [] }
    setState({ kind: 'updating', detail: 'Applying changes' })
    opts.onChanges(summary)
    // Every walked path travels to the worker: unchanged entries carry only
    // their stored hash (the worker reuses their text), changed and added
    // entries carry fresh text.
    const entries = [...pendingEntries.values()]
    pendingEntries = new Map()
    const result = await opts.runUpdate(entries, summary)
    if (stopped) return
    if (result.ok) {
      manifest = entries.map((e) => ({ path: e.path, size: e.size, lastModified: e.lastModified, sha: e.sha }))
    } else {
      // A failed update keeps watching: forcing the next scan to re-diff
      // against the old manifest re-detects the same changes and retries.
      lastWalk = null
    }
    if (!stopped) setState({ kind: 'watching', lastScan: Date.now() })
  }

  const tick = (): Promise<void> => {
    if (stopped || state.kind === 'paused' || state.kind === 'updating') return Promise.resolve()
    if (current) return current
    current = scan().finally(() => {
      current = null
    })
    return current
  }

  const scan = async () => {
    if (stopped || state.kind === 'paused' || state.kind === 'updating') return
    const perm = await permission()
    if (perm === 'denied') {
      setState({ kind: 'denied' })
      session.stop()
      return
    }
    if (perm === 'prompt') {
      // Requesting permission needs a user gesture; park until allow().
      setState({ kind: 'needs-permission' })
      if (timer) clearInterval(timer)
      timer = null
      return
    }
    try {
      const walked = await walkLocalFolder(opts.handle)
      // A walk identical to the previous one is a quiet scan: changes that
      // were pending through the debounce fire now.
      if (lastWalk && sameWalk(lastWalk, walked)) {
        if (!pendingEmpty(pending)) await fireUpdate()
        else setState({ kind: 'watching', lastScan: Date.now() })
        return
      }
      lastWalk = walked
      const diff = diffManifest(manifest, walked)
      const hasNew = diff.added.length + diff.candidates.length + diff.removed.length > 0
      if (!hasNew) {
        pending = { added: [], modified: [], removed: [], renamed: [] }
        pendingEntries = new Map()
        setState({ kind: 'watching', lastScan: Date.now() })
        return
      }
      // Read every added and candidate file: the hash decides modified vs
      // touched, and added files need their text for the update anyway.
      const reads = new Map<string, { sha: string; text: string }>()
      for (const w of [...diff.added, ...diff.candidates]) {
        const entry = walked.find((x) => x.path === w.path) as (WalkedFile & { handle: FileSystemFileHandle }) | undefined
        if (!entry) continue
        const file = await entry.handle.getFile()
        const text = await file.text()
        reads.set(w.path, { sha: await hashText(text), text })
      }
      const classified = classifyChanges(diff, manifest, reads)
      const summary: WatchChangeSummary = {
        added: classified.stillAdded.map((w) => w.path),
        modified: classified.modified.map((w) => w.path),
        removed: classified.stillRemoved.map((e) => e.path),
        renamed: classified.renamed.map((r) => ({ from: r.from, to: r.to.path })),
      }
      const manifestByPath = new Map(manifest.map((e) => [e.path, e]))
      const entries = new Map<string, LocalFileEntry>()
      for (const w of walked) {
        const read = reads.get(w.path)
        if (read) {
          entries.set(w.path, { path: w.path, size: w.size, lastModified: w.lastModified, sha: read.sha, text: read.text })
        } else {
          const old = manifestByPath.get(w.path)
          if (old) entries.set(w.path, { path: w.path, size: w.size, lastModified: w.lastModified, sha: old.sha })
        }
      }
      // Touched-only scans (mtimes moved, content identical) silently adopt
      // the fresh manifest without an update.
      if (pendingEmpty(summary)) {
        manifest = [...entries.values()].map((e) => ({ path: e.path, size: e.size, lastModified: e.lastModified, sha: e.sha }))
        pending = { added: [], modified: [], removed: [], renamed: [] }
        pendingEntries = new Map()
      } else {
        mergePending(summary, entries)
      }
      setState({ kind: 'watching', lastScan: Date.now() })
    } finally {
      // scan errors surface as a rejected tick promise
    }
  }

  const arm = () => {
    if (timer || stopped) return
    timer = setInterval(() => void tick(), intervalMs)
  }

  const session: WatchSession = {
    tick,
    allow: async () => {
      if (!opts.handle.requestPermission) {
        arm()
        setState({ kind: 'watching', lastScan: Date.now() })
        return
      }
      try {
        const result = await opts.handle.requestPermission({ mode: 'read' })
        if (result === 'granted') {
          setState({ kind: 'watching', lastScan: Date.now() })
          arm()
          void tick()
        } else {
          setState({ kind: 'denied' })
          session.stop()
        }
      } catch {
        setState({ kind: 'denied' })
        session.stop()
      }
    },
    pause: () => {
      if (stopped || state.kind !== 'watching') return
      setState({ kind: 'paused' })
    },
    resume: () => {
      if (stopped || state.kind !== 'paused') return
      setState({ kind: 'watching', lastScan: Date.now() })
      void tick()
    },
    stop: () => {
      stopped = true
      if (timer) clearInterval(timer)
      timer = null
      if (state.kind !== 'denied') setState({ kind: 'stopped' })
    },
    get state() {
      return state
    },
    get pending() {
      return pendingEmpty(pending) ? null : pending
    },
  }
  arm()
  void tick()
  return session
}
