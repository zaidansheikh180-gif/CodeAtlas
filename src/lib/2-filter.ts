// Decides which archive entries become indexable files. Skips binaries,
// vendored code, generated output and lockfiles. Everything skipped is counted
// so the UI can show an honest exclusion list.

export type FileLanguage = 'javascript' | 'typescript' | 'python' | 'docs' | 'other'

export interface FilteredFile {
  path: string
  language: FileLanguage
  size: number
  text: string
}

export interface SkipCounts {
  vendored: number
  binary: number
  generated: number
  oversized: number
  overCaps: number
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.github', 'dist', 'build', 'out', 'coverage',
  'vendor', 'third_party', '__pycache__', '.next', '.nuxt', '.turbo',
  'target', '.idea', '.vscode', '.pytest_cache', '.mypy_cache', 'egg-info',
  '.venv', 'venv', 'env', '.tox', 'tmp', 'temp',
])

const SKIP_FILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock',
  'poetry.lock', 'cargo.lock', 'composer.lock', 'gemfile.lock', '.ds_store',
])

const BINARY_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'svg', 'bmp',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'mp3', 'mp4', 'mov', 'avi', 'wav', 'flac', 'webm',
  'so', 'dll', 'dylib', 'a', 'o', 'obj', 'exe', 'bin', 'wasm',
  'jar', 'class', 'pyc', 'pyo', 'db', 'sqlite', 'sqlite3',
])

const GENERATED_RE = [
  /\.min\.(js|css)$/,
  /\.(map)$/,
  /\.(generated|gen|g)\.(ts|js|py)$/,
  /\.pb\.(ts|js|py)$/,
  /_pb2(_grpc)?\.py$/,
  /\.designer\.(cs|ts)$/,
]

const EXT_LANGUAGE: Record<string, FileLanguage> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  py: 'python', pyi: 'python',
  md: 'docs', mdx: 'docs', txt: 'docs', rst: 'docs',
}

// Walk-time directory pruning for local folders (phase 8): local walks skip
// these directories before enumerating them, matching what shouldSkip would
// filter afterward - a local node_modules can hold hundreds of thousands of
// files, so filtering after the walk would waste minutes.
export function isSkippedDirName(name: string, extraDirs?: string[]): boolean {
  if (SKIP_DIRS.has(name.toLowerCase())) return true
  if (extraDirs) {
    const lower = name.toLowerCase()
    return extraDirs.some((d) => d.toLowerCase() === lower)
  }
  return false
}

export interface SkipOptions {
  /** Extra folder names (settings: excluded folders), matched per segment. */
  extraDirs?: string[]
}

// Settings-driven folder exclusions (phase 7 part 2): the worker applies
// these on top of the built-in vendored/generated/binary skips.
export function shouldSkipWith(path: string, opts: SkipOptions): 'vendored' | 'binary' | 'generated' | 'excluded' | null {
  const base = shouldSkip(path)
  if (base) return base
  if (opts.extraDirs?.length) {
    const segments = path.split('/').slice(0, -1)
    if (segments.some((s) => opts.extraDirs!.some((d) => d.toLowerCase() === s.toLowerCase()))) return 'excluded'
  }
  return null
}

export function extOf(path: string): string {
  const base = path.split('/').pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot < 0 ? '' : base.slice(dot + 1).toLowerCase()
}

export function languageOf(path: string): FileLanguage {
  return EXT_LANGUAGE[extOf(path)] ?? 'other'
}

export function shouldSkip(path: string): 'vendored' | 'binary' | 'generated' | null {
  const segments = path.split('/')
  const fileName = (segments[segments.length - 1] ?? '').toLowerCase()
  if (segments.slice(0, -1).some((s) => SKIP_DIRS.has(s.toLowerCase()))) return 'vendored'
  if (SKIP_FILES.has(fileName)) return 'generated'
  const ext = extOf(path)
  if (BINARY_EXT.has(ext)) return 'binary'
  if (GENERATED_RE.some((re) => re.test(fileName))) return 'generated'
  return null
}
