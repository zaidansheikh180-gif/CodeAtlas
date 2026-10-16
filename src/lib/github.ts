// GitHub API access for public repos. Archive-first: one request for the whole
// repo, extra metadata requests only when needed. The anonymous rate limit is
// about 60 requests/hour per visitor IP, so every request counts.

export interface RepoRef {
  owner: string
  repo: string
  ref?: string // branch, tag or commit sha from the URL
}

export interface RepoMeta {
  owner: string
  repo: string
  fullName: string
  defaultBranch: string
  sizeKb: number
  description: string | null
  language: string | null
}

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly code: 'not_found' | 'rate_limited' | 'network' | 'invalid_url' | 'too_large',
    readonly resetAt?: Date,
  ) {
    super(message)
  }
}

export function parseGitHubUrl(raw: string): RepoRef | null {
  const input = raw.trim()
  if (!input) return null
  // Accept "owner/repo" shorthand and full GitHub URLs, including
  // /tree/<ref>, /commit/<sha> and /releases/tag/<tag> links.
  const short = input.match(/^([\w.-]+)\/([\w.-]+)$/)
  if (short) return { owner: short[1], repo: stripGit(short[2]) }
  let url: URL
  try {
    url = new URL(input.includes('://') ? input : `https://${input}`)
  } catch {
    return null
  }
  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') return null
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length < 2) return null
  const ref: RepoRef = { owner: parts[0], repo: stripGit(parts[1]) }
  if (parts[2] === 'tree' && parts[3]) ref.ref = decodeURIComponent(parts.slice(3).join('/'))
  else if (parts[2] === 'commit' && parts[3]) ref.ref = parts[3]
  else if (parts[2] === 'releases' && parts[3] === 'tag' && parts[4]) ref.ref = parts[4]
  return ref
}

function stripGit(name: string): string {
  return name.endsWith('.git') ? name.slice(0, -4) : name
}

export interface ApiResult<T> {
  data: T
  rateLimit: { remaining: number | null; resetAt: Date | null }
}

async function apiGet<T>(path: string, token?: string): Promise<ApiResult<T>> {
  let res: Response
  try {
    res = await fetch(`https://api.github.com${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
  } catch {
    throw new GitHubError('Could not reach GitHub. Check your connection and try again.', 'network')
  }
  const remaining = res.headers.get('x-ratelimit-remaining')
  const reset = res.headers.get('x-ratelimit-reset')
  const rateLimit = {
    remaining: remaining === null ? null : Number(remaining),
    resetAt: reset === null ? null : new Date(Number(reset) * 1000),
  }
  if (res.status === 404) {
    throw new GitHubError(
      'Repository not found. Check the URL - CodeAtlas can only read public repositories.',
      'not_found',
    )
  }
  if (res.status === 403 && rateLimit.remaining === 0) {
    throw new GitHubError(
      'GitHub rate limit reached for anonymous requests.',
      'rate_limited',
      rateLimit.resetAt ?? undefined,
    )
  }
  if (!res.ok) {
    throw new GitHubError(`GitHub returned an error (HTTP ${res.status}). Try again in a moment.`, 'network')
  }
  return { data: (await res.json()) as T, rateLimit }
}

export async function getRepoMeta(ref: RepoRef, token?: string): Promise<ApiResult<RepoMeta>> {
  const { data, rateLimit } = await apiGet<{
    full_name: string
    default_branch: string
    size: number
    description: string | null
    language: string | null
  }>(`/repos/${ref.owner}/${ref.repo}`, token)
  return {
    data: {
      owner: ref.owner,
      repo: ref.repo,
      fullName: data.full_name,
      defaultBranch: data.default_branch,
      sizeKb: data.size,
      description: data.description,
      language: data.language,
    },
    rateLimit,
  }
}

export async function resolveCommit(
  ref: RepoRef,
  effectiveRef: string,
  token?: string,
): Promise<ApiResult<string>> {
  const { data, rateLimit } = await apiGet<{ sha: string }>(
    `/repos/${ref.owner}/${ref.repo}/commits/${encodeURIComponent(effectiveRef)}`,
    token,
  )
  return { data: data.sha, rateLimit }
}

export interface RepoRefs {
  branches: string[]
  tags: string[]
}

// Branch and tag names for the landing-page picker. Best effort: callers
// tolerate a failure and fall back to the default branch plus free-text refs.
export async function listRefs(ref: RepoRef, token?: string): Promise<RepoRefs> {
  const names = (items: { name: string }[]) => items.map((item) => item.name)
  const [branches, tags] = await Promise.all([
    apiGet<{ name: string }[]>(`/repos/${ref.owner}/${ref.repo}/branches?per_page=100`, token).then((r) => names(r.data)),
    apiGet<{ name: string }[]>(`/repos/${ref.owner}/${ref.repo}/tags?per_page=100`, token).then((r) => names(r.data)),
  ])
  return { branches, tags }
}

export function treeUrl(fullName: string, commit: string): string {
  return `https://api.github.com/repos/${fullName}/git/trees/${commit}?recursive=1`
}

// Raw file downloads are served from raw.githubusercontent.com, which allows
// cross-origin reads and does not count against the API rate limit. The
// zipball endpoint is unusable from a browser: it redirects to
// codeload.github.com, whose CORS header only allows render.githubusercontent.com.
export function rawUrl(fullName: string, commit: string, path: string): string {
  return `https://raw.githubusercontent.com/${fullName}/${commit}/${path.split('/').map(encodeURIComponent).join('/')}`
}

export { apiGet }
