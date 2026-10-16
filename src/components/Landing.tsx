// Landing: one URL input and the repos already indexed in this browser.
// No account, no key, no marketing filler.

import { useEffect, useState } from 'react'
import { estimateCost } from '../lib/caps'
import { getRepoMeta, parseGitHubUrl, resolveCommit, GitHubError, type RepoMeta } from '../lib/github'
import { deleteRepo, listRepos } from '../lib/db'
import type { RepoRec } from '../lib/types'

export interface IndexTarget {
  repoId: string
  repoUrl: string
  fullName: string
  commit: string
  defaultBranch: string
  description: string | null
  language: string | null
  sizeKb: number
}

interface Props {
  onStart: (target: IndexTarget) => void
  onOpen: (repoId: string) => void
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'confirm'; target: IndexTarget; meta: RepoMeta; rateRemaining: number | null }
  | { kind: 'error'; message: string }

export default function Landing({ onStart, onOpen }: Props) {
  const [url, setUrl] = useState('')
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [recent, setRecent] = useState<RepoRec[]>([])

  useEffect(() => {
    void listRepos().then(setRecent)
  }, [])

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
      const effectiveRef = ref.ref ?? metaResult.data.defaultBranch
      const commitResult = await resolveCommit(ref, effectiveRef)
      const commit = commitResult.data
      const repoId = `${metaResult.data.fullName}@${commit}`
      setPhase({
        kind: 'confirm',
        meta: metaResult.data,
        rateRemaining: commitResult.rateLimit.remaining ?? metaResult.rateLimit.remaining,
        target: {
          repoId,
          repoUrl: `https://github.com/${metaResult.data.fullName}`,
          fullName: metaResult.data.fullName,
          commit,
          defaultBranch: metaResult.data.defaultBranch,
          description: metaResult.data.description,
          language: metaResult.data.language,
          sizeKb: metaResult.data.sizeKb,
        },
      })
    } catch (error) {
      if (error instanceof GitHubError && error.code === 'rate_limited') {
        const wait = error.resetAt ? ` Limit resets at ${error.resetAt.toLocaleTimeString()}.` : ''
        setPhase({ kind: 'error', message: `GitHub rate limit reached for anonymous requests.${wait}` })
      } else {
        setPhase({ kind: 'error', message: error instanceof Error ? error.message : 'Something went wrong. Try again.' })
      }
    }
  }

  const estimate = phase.kind === 'confirm' ? estimateCost(phase.meta.sizeKb) : null

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
            Branch, tag and commit links work too. Public repositories only for now.
          </p>
        </form>

        {phase.kind === 'error' && (
          <div role="alert" className="mt-4 rounded-lg border border-error/40 bg-surface-1 p-3 text-sm text-error">
            {phase.message}
          </div>
        )}

        {phase.kind === 'confirm' && estimate && (
          <div className="mt-6 rounded-xl border border-line bg-surface-1 p-4">
            <div className="flex items-baseline justify-between gap-3">
              <div>
                <p className="font-mono text-sm font-semibold text-ink">{phase.meta.fullName}</p>
                {phase.meta.description && <p className="mt-1 text-sm text-ink-2">{phase.meta.description}</p>}
              </div>
              {phase.meta.language && (
                <span className="rounded-md bg-surface-3 px-2 py-0.5 text-xs text-ink-2">{phase.meta.language}</span>
              )}
            </div>
            <p className="mt-3 text-sm text-ink-2">{estimate.note}</p>
            <p className="mt-1 text-xs text-ink-3">
              {phase.rateRemaining !== null
                ? `GitHub anonymous requests left this hour: about ${phase.rateRemaining}.`
                : 'Parsing and storage stay in this browser tab.'}
            </p>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => onStart(phase.target)}
                className="rounded-lg bg-dragon px-4 py-2 text-sm font-semibold text-night hover:bg-dragon-deep"
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
            <h2 className="text-sm font-semibold text-ink-2">Indexed in this browser</h2>
            <ul className="mt-3 space-y-2">
              {recent.map((repo) => (
                <li key={repo.id} className="flex gap-2">
                  <button
                    onClick={() => repo.status === 'ready' && onOpen(repo.id)}
                    disabled={repo.status !== 'ready'}
                    className="flex w-full items-center justify-between rounded-lg border border-line bg-surface-1 px-3 py-2 text-left hover:border-dragon disabled:opacity-60"
                  >
                    <span className="font-mono text-sm text-ink">{repo.fullName}</span>
                    <span className="text-xs text-ink-3">
                      {repo.status === 'ready'
                        ? `${repo.stats.files} files · ${repo.stats.symbols} symbols`
                        : repo.status}
                    </span>
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm(`Clear the ${repo.fullName} index from this browser? The repository on GitHub is not affected.`)) {
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
