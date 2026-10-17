// Landing: one URL input, a branch/tag/commit picker, and the repos already
// indexed in this browser. No account, no key, no marketing filler.

import { useEffect, useRef, useState } from 'react'
import { estimateCost } from '../lib/caps'
import {
  getRepoMeta,
  listRefs,
  parseGitHubUrl,
  resolveCommit,
  GitHubError,
  type RepoMeta,
  type RepoRef,
  type RepoRefs,
} from '../lib/github'
import { deleteRepo, listRepos, putAll, putRepo } from '../lib/db'
import { isLocalRepoUrl, localRepoUrl, pickLocalFolder, readLocalEntries, supportsLocalFolders, walkLocalFolder, type LocalFileEntry } from '../lib/localfolder'
import { remapImport, validateGraphImport } from '../lib/graphexport'
import type { EdgeRec, FileRec, RepoRec, SymbolRec } from '../lib/types'

export interface IndexTarget {
  repoId: string
  repoUrl: string
  fullName: string
  commit: string
  defaultBranch: string
  ref?: string
  incrementalFrom?: string
  description: string | null
  language: string | null
  sizeKb: number
  // Local folder indexing (phase 8): set when the target is a folder on this
  // device instead of a GitHub repository.
  local?: boolean
  localFiles?: LocalFileEntry[]
  localHandle?: FileSystemDirectoryHandle
}

// What the user picked to index: a listed branch or tag, or a free-text
// commit SHA / ref name typed by hand.
type PickedRef = { kind: 'branch' | 'tag' | 'custom'; value: string }

interface ConfirmState {
  repo: RepoRef
  meta: RepoMeta
  urlRef?: string
  refs: RepoRefs | null
  refsUnavailable: boolean
  picked: PickedRef
  target: IndexTarget
  resolving: boolean
  rateRemaining: number | null
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'confirm'; state: ConfirmState }
  | { kind: 'error'; message: string }

interface Props {
  onStart: (target: IndexTarget) => void
  onOpen: (repoId: string) => void
  onOpenGlobal: () => void
}

function makeTarget(meta: RepoMeta, commit: string, ref: string): IndexTarget {
  return {
    repoId: `${meta.fullName}@${commit}`,
    repoUrl: `https://github.com/${meta.fullName}`,
    fullName: meta.fullName,
    commit,
    defaultBranch: meta.defaultBranch,
    ref,
    description: meta.description,
    language: meta.language,
    sizeKb: meta.sizeKb,
  }
}

export default function Landing({ onStart, onOpen, onOpenGlobal }: Props) {
  const importInputRef = useRef<HTMLInputElement>(null)
  const [importState, setImportState] = useState<{ kind: 'idle' } | { kind: 'busy' } | { kind: 'error'; message: string }>({ kind: 'idle' })

  // Graph import (phase 5): validate the export file, remap every record
  // onto a fresh repo id, and store it as a ready, marked-imported index.
  const importGraph = async (file: File) => {
    setImportState({ kind: 'busy' })
    try {
      const text = await file.text()
      const result = validateGraphImport(text, file.size)
      if (!result.ok) {
        setImportState({ kind: 'error', message: result.error })
        return
      }
      if (result.warning && !window.confirm(`${result.warning} Continue?`)) {
        setImportState({ kind: 'idle' })
        return
      }
      const newRepoId = `import-${Date.now().toString(36)}`
      const { files, symbols, edges, droppedEdges } = remapImport(result.data, newRepoId)
      const repoRec: RepoRec = {
        id: newRepoId,
        url: result.data.repo.url,
        fullName: result.data.repo.fullName,
        commit: result.data.repo.commit,
        defaultBranch: result.data.repo.ref,
        ref: result.data.repo.ref,
        status: 'ready',
        description: 'Imported from a CodeAtlas graph export.',
        language: null,
        sizeKb: Math.round(file.size / 1024),
        stats: {
          files: files.length,
          parsedFiles: files.length,
          symbols: symbols.length,
          edges: edges.length,
          secretsExcluded: 0,
        },
        indexedAt: result.data.repo.indexedAt,
        imported: true,
      }
      await putRepo(repoRec)
      await putAll<FileRec>('files', files)
      await putAll<SymbolRec>('symbols', symbols)
      await putAll<EdgeRec>('edges', edges)
      if (droppedEdges > 0) {
        setImportState({ kind: 'error', message: `Imported with ${droppedEdges} edge(s) dropped because their endpoints were missing.` })
      } else {
        setImportState({ kind: 'idle' })
      }
      setRecent(await listRepos())
    } catch (error) {
      setImportState({ kind: 'error', message: error instanceof Error ? error.message : 'Import failed.' })
    } finally {
      if (importInputRef.current) importInputRef.current.value = ''
    }
  }

  const [url, setUrl] = useState('')
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  // Local folder indexing (phase 8): walking reads the folder tree, reading
  // reads file texts; both report live counts.
  const [localState, setLocalState] = useState<
    { kind: 'idle' } | { kind: 'walking'; count: number } | { kind: 'reading'; done: number; total: number } | { kind: 'error'; message: string }
  >({ kind: 'idle' })

  // Pick a local folder, walk it, read the files, and hand the entries to
  // the same indexing pipeline a GitHub repository uses. Nothing is uploaded.
  const pickFolder = async () => {
    setLocalState({ kind: 'idle' })
    const dir = await pickLocalFolder()
    if (!dir) return // unsupported browser or cancelled picker
    try {
      setLocalState({ kind: 'walking', count: 0 })
      const walked = await walkLocalFolder(dir, (count) => setLocalState({ kind: 'walking', count }))
      if (walked.length === 0) {
        setLocalState({ kind: 'error', message: `The folder "${dir.name}" has no files to index.` })
        return
      }
      setLocalState({ kind: 'reading', done: 0, total: walked.length })
      const entries = await readLocalEntries(walked, (done, total) => setLocalState({ kind: 'reading', done, total }))
      setLocalState({ kind: 'idle' })
      onStart({
        repoId: localRepoUrl(dir.name),
        repoUrl: localRepoUrl(dir.name),
        fullName: dir.name,
        commit: 'local',
        defaultBranch: 'local',
        ref: 'local folder',
        description: 'Local folder indexed on this device with the File System Access API. Files never leave this browser.',
        language: null,
        sizeKb: Math.round(entries.reduce((sum, e) => sum + e.size, 0) / 1024),
        local: true,
        localFiles: entries,
        localHandle: dir,
      })
    } catch (error) {
      setLocalState({
        kind: 'error',
        message:
          error instanceof DOMException && error.name === 'NotAllowedError'
            ? 'Permission to read that folder was not granted. Allow access in the browser prompt and try again.'
            : error instanceof Error
              ? error.message
              : 'Could not read that folder.',
      })
    }
  }
  const [recent, setRecent] = useState<RepoRec[]>([])
  // Guards against a slow resolveCommit answering after the pick changed.
  const resolveSeq = useRef(0)

  useEffect(() => {
    void listRepos().then(setRecent)
  }, [])

  const errorMessage = (error: unknown): string => {
    if (error instanceof GitHubError && error.code === 'rate_limited') {
      const wait = error.resetAt ? ` Limit resets at ${error.resetAt.toLocaleTimeString()}.` : ''
      return `GitHub rate limit reached for anonymous requests.${wait}`
    }
    return error instanceof Error ? error.message : 'Something went wrong. Try again.'
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const ref = parseGitHubUrl(url)
    if (!ref) {
      setPhase({ kind: 'error', message: 'That does not look like a GitHub repository URL. Try something like https://github.com/owner/repo.' })
      return
    }
    setPhase({ kind: 'checking' })
    try {
      const metaResult = await getRepoMeta(ref)
      const meta = metaResult.data
      const effectiveRef = ref.ref ?? meta.defaultBranch
      const commitResult = await resolveCommit(ref, effectiveRef)
      const target = makeTarget(meta, commitResult.data, effectiveRef)
      const state: ConfirmState = {
        repo: ref,
        meta,
        urlRef: ref.ref,
        refs: null,
        refsUnavailable: false,
        picked: { kind: ref.ref ? 'custom' : 'branch', value: effectiveRef },
        target,
        resolving: false,
        rateRemaining: commitResult.rateLimit.remaining ?? metaResult.rateLimit.remaining,
      }
      setPhase({ kind: 'confirm', state })
      // Branch and tag lists are a convenience for the picker; indexing must
      // still work when this call fails (rate limit, huge repos).
      listRefs(ref)
        .then((refs) => {
          setPhase((prev) => {
            if (prev.kind !== 'confirm' || prev.state.meta.fullName !== meta.fullName) return prev
            const named = new Set([...refs.branches, ...refs.tags])
            const picked = named.has(prev.state.picked.value)
              ? { kind: (refs.branches.includes(prev.state.picked.value) ? 'branch' : 'tag') as PickedRef['kind'], value: prev.state.picked.value }
              : prev.state.picked
            return { kind: 'confirm', state: { ...prev.state, refs, picked } }
          })
        })
        .catch(() => {
          setPhase((prev) =>
            prev.kind === 'confirm' && prev.state.meta.fullName === meta.fullName
              ? { kind: 'confirm', state: { ...prev.state, refsUnavailable: true } }
              : prev,
          )
        })
    } catch (error) {
      setPhase({ kind: 'error', message: errorMessage(error) })
    }
  }

  const pickRef = async (picked: PickedRef) => {
    if (phase.kind !== 'confirm') return
    const seq = ++resolveSeq.current
    const state = phase.state
    setPhase({ kind: 'confirm', state: { ...state, picked, resolving: true } })
    try {
      const commit = (await resolveCommit(state.repo, picked.value)).data
      setPhase((prev) => {
        if (prev.kind !== 'confirm' || resolveSeq.current !== seq) return prev
        return {
          kind: 'confirm',
          state: { ...prev.state, resolving: false, target: makeTarget(prev.state.meta, commit, picked.value) },
        }
      })
    } catch (error) {
      setPhase((prev) => {
        if (prev.kind !== 'confirm' || resolveSeq.current !== seq) return prev
        return { kind: 'confirm', state: { ...prev.state, resolving: false } }
      })
      setPhase({ kind: 'error', message: errorMessage(error) })
    }
  }

  const confirm = phase.kind === 'confirm' ? phase.state : null
  const estimate = confirm ? estimateCost(confirm.meta.sizeKb) : null

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-xl">
        <h1 className="text-4xl font-semibold tracking-tight text-ink">
          Code<span className="text-dragon">Atlas</span>
        </h1>
        <p className="mt-3 text-base leading-relaxed text-ink-2">
          Paste a public GitHub repository. CodeAtlas maps its architecture in your browser.
          No account, no key, nothing uploaded.
        </p>

        <form onSubmit={submit} className="mt-8">
          <label htmlFor="repo-url" className="mb-2 block text-sm font-medium text-ink-2">
            Repository URL
          </label>
          <div className="flex gap-2">
            <input
              id="repo-url"
              type="text"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
                if (phase.kind === 'error') setPhase({ kind: 'idle' })
              }}
              placeholder="https://github.com/owner/repo"
              spellCheck={false}
              autoComplete="off"
              className="h-11 flex-1 rounded-lg border border-line bg-surface-1 px-3 font-mono text-sm text-ink placeholder:text-ink-3 focus:border-dragon focus:outline-none"
            />
            <button
              type="submit"
              disabled={phase.kind === 'checking' || !url.trim()}
              className="h-11 rounded-lg bg-dragon px-4 text-sm font-semibold text-night transition-colors hover:bg-dragon-deep disabled:cursor-not-allowed disabled:opacity-50"
            >
              {phase.kind === 'checking' ? 'Checking…' : 'Map it'}
            </button>
          </div>
          <p className="mt-2 text-xs text-ink-3">
            You can pick a branch, tag or commit on the next step. Public repositories only for now.
          </p>
        </form>

        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={() => void pickFolder()}
            disabled={!supportsLocalFolders() || localState.kind === 'walking' || localState.kind === 'reading'}
            title={supportsLocalFolders() ? 'Index a folder on this device' : 'Local folders need the File System Access API - use Chrome or Edge'}
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-2 hover:border-dragon hover:text-ink disabled:opacity-50"
          >
            {localState.kind === 'walking'
              ? `Reading folder… ${localState.count} files`
              : localState.kind === 'reading'
                ? `Reading files… ${localState.done} of ${localState.total}`
                : 'Map a local folder'}
          </button>
          <p className="text-xs text-ink-3">
            {supportsLocalFolders()
              ? 'Indexes a folder on this device. Files never leave this browser.'
              : 'Local folder indexing needs Chrome or Edge.'}
          </p>
        </div>
        {localState.kind === 'error' && (
          <div role="alert" className="mt-3 rounded-lg border border-error/40 bg-surface-1 p-3 text-sm text-error">
            {localState.message}
          </div>
        )}

        <div className="mt-3 flex items-center gap-3">
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            aria-label="Graph export file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void importGraph(file)
            }}
          />
          <button
            onClick={() => importInputRef.current?.click()}
            disabled={importState.kind === 'busy'}
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-2 hover:border-dragon hover:text-ink disabled:opacity-50"
          >
            {importState.kind === 'busy' ? 'Importing…' : 'Import a graph export'}
          </button>
          <p className="text-xs text-ink-3">Opens a CodeAtlas JSON export as a read-only map.</p>
        </div>
        {importState.kind === 'error' && (
          <div role="alert" className="mt-3 rounded-lg border border-error/40 bg-surface-1 p-3 text-sm text-error">
            {importState.message}
          </div>
        )}

        {phase.kind === 'error' && (
          <div role="alert" className="mt-4 rounded-lg border border-error/40 bg-surface-1 p-3 text-sm text-error">
            {phase.message}
          </div>
        )}

        {confirm && estimate && (
          <div className="mt-6 rounded-xl border border-line bg-surface-1 p-4">
            <div className="flex items-baseline justify-between gap-3">
              <div>
                <p className="font-mono text-sm font-semibold text-ink">{confirm.meta.fullName}</p>
                {confirm.meta.description && <p className="mt-1 text-sm text-ink-2">{confirm.meta.description}</p>}
              </div>
              {confirm.meta.language && (
                <span className="rounded-md bg-surface-3 px-2 py-0.5 text-xs text-ink-2">{confirm.meta.language}</span>
              )}
            </div>

            <div className="mt-4">
              <label htmlFor="ref-picker" className="mb-1 block text-xs font-medium text-ink-2">
                Branch, tag or commit
              </label>
              <div className="flex gap-2">
                <select
                  id="ref-picker"
                  value={confirm.picked.kind === 'custom' ? '__custom__' : `${confirm.picked.kind}:${confirm.picked.value}`}
                  onChange={(e) => {
                    const v = e.target.value
                    if (v === '__custom__') {
                      const initial = confirm.picked.kind === 'custom' ? confirm.picked.value : confirm.urlRef ?? ''
                      void pickRef({ kind: 'custom', value: initial })
                    } else {
                      const [kind, ...rest] = v.split(':')
                      void pickRef({ kind: kind as 'branch' | 'tag', value: rest.join(':') })
                    }
                  }}
                  className="h-10 flex-1 rounded-lg border border-line bg-surface-1 px-2 font-mono text-sm text-ink focus:border-dragon focus:outline-none"
                >
                  <optgroup label="Branches">
                    {(confirm.refs?.branches ?? [confirm.meta.defaultBranch]).map((b) => (
                      <option key={`b:${b}`} value={`branch:${b}`}>
                        {b}
                        {b === confirm.meta.defaultBranch ? ' (default)' : ''}
                      </option>
                    ))}
                  </optgroup>
                  {confirm.refs && confirm.refs.tags.length > 0 && (
                    <optgroup label="Tags">
                      {confirm.refs.tags.map((t) => (
                        <option key={`t:${t}`} value={`tag:${t}`}>
                          {t}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label="Other">
                    <option value="__custom__">A commit or other ref…</option>
                  </optgroup>
                </select>
                {confirm.picked.kind === 'custom' && (
                  <input
                    type="text"
                    defaultValue={confirm.picked.value}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void pickRef({ kind: 'custom', value: e.currentTarget.value.trim() })
                      }
                    }}
                    onBlur={(e) => {
                      const v = e.target.value.trim()
                      if (v && v !== confirm.picked.value) void pickRef({ kind: 'custom', value: v })
                    }}
                    placeholder="commit sha or ref"
                    spellCheck={false}
                    autoComplete="off"
                    aria-label="Commit SHA or ref name"
                    className="h-10 w-44 rounded-lg border border-line bg-surface-1 px-3 font-mono text-sm text-ink placeholder:text-ink-3 focus:border-dragon focus:outline-none"
                  />
                )}
              </div>
              <p className="mt-1 font-mono text-xs text-ink-3">
                {confirm.resolving
                  ? 'Resolving…'
                  : `@ ${confirm.target.commit.slice(0, 7)}`}
                {confirm.refsUnavailable && ' · branch list unavailable (rate limit) - type a ref if you need another one'}
              </p>
            </div>

            <p className="mt-3 text-sm text-ink-2">{estimate.note}</p>
            <p className="mt-1 text-xs text-ink-3">
              {confirm.rateRemaining !== null
                ? `GitHub anonymous requests left this hour: about ${confirm.rateRemaining}.`
                : 'Parsing and storage stay in this browser tab.'}
            </p>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => onStart(confirm.target)}
                disabled={confirm.resolving}
                className="rounded-lg bg-dragon px-4 py-2 text-sm font-semibold text-night hover:bg-dragon-deep disabled:cursor-not-allowed disabled:opacity-50"
              >
                Start indexing
              </button>
              <button
                onClick={() => setPhase({ kind: 'idle' })}
                className="rounded-lg border border-line px-4 py-2 text-sm text-ink-2 hover:border-ink-3"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {recent.length > 0 && (
          <div className="mt-12">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-ink-2">Indexed in this browser</h2>
              <button
                onClick={onOpenGlobal}
                disabled={recent.filter((r) => !r.snapshot && r.status === 'ready').length < 2}
                title={recent.filter((r) => !r.snapshot && r.status === 'ready').length < 2 ? 'Index at least two repositories for the global map' : 'See every indexed repository on one map'}
                className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-ink-2 hover:border-dragon hover:text-ink disabled:opacity-40"
              >
                Global map
              </button>
            </div>
            <ul className="mt-3 space-y-2">
              {recent.filter((repo) => !repo.snapshot).map((repo) => (
                <li key={repo.id} className="flex gap-2">
                  <button
                    onClick={() => repo.status === 'ready' && onOpen(repo.id)}
                    disabled={repo.status !== 'ready'}
                    className="flex w-full items-center justify-between rounded-lg border border-line bg-surface-1 px-3 py-2 text-left hover:border-dragon disabled:opacity-60"
                  >
                    <span className="font-mono text-sm text-ink">
                      {repo.fullName}
                      {repo.imported && <span className="ml-2 rounded border border-line px-1 py-0.5 font-sans text-[10px] text-ink-3">imported</span>}
                      {repo.local && <span className="ml-2 rounded border border-dragon/40 px-1 py-0.5 font-sans text-[10px] text-dragon">local folder</span>}
                    </span>
                    <span className="text-xs text-ink-3">
                      {repo.status === 'ready'
                        ? `${repo.ref ? `${repo.ref} · ` : ''}${repo.stats.files} files · ${repo.stats.symbols} symbols`
                        : repo.status}
                    </span>
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm(`Clear the ${repo.fullName} index from this browser?${isLocalRepoUrl(repo.url) ? '' : ' The repository on GitHub is not affected.'}`)) {
                        void deleteRepo(repo.id).then(() => listRepos().then(setRecent))
                      }
                    }}
                    aria-label={`Clear the ${repo.fullName} index from this browser`}
                    title="Clear this index"
                    className="shrink-0 rounded-lg border border-line px-3 text-sm text-ink-3 hover:border-error hover:text-error"
                  >
                    Clear
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-ink-3">
              Indexes live only in this browser's storage and may be cleared by the browser under storage pressure.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
