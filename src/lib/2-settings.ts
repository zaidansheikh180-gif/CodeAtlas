// User settings (phase 7 part 1, spec-2 section 27, pack-1 #26). Persisted in
// the IndexedDB settings store: the visitor's browser only, nothing leaves
// the device. Sections: indexing (applies to new indexes - the UI shows a
// re-index hint), graph and search, appearance, model and privacy, and the
// context budgets model chat consumes (phase 7 part 4).

import { DB_NAME, getSetting, putSetting } from './db'

export type ModelProvider = 'none' | 'gemini' | 'ollama'
export type ThemePreference = 'dark' | 'light'
export type PerformancePreference = 'auto' | 'on' | 'off'

export interface Settings {
  // Indexing. Changes apply to new indexes; existing indexes keep the
  // exclusions and sizes they were built with.
  defaultBranch: string
  maxFileKb: number
  excludeGlobs: string[]
  excludeFolders: string[]
  sensitiveGlobs: string[]
  // Graph and search.
  maxTraversalDepth: number
  maxSearchResults: number
  performanceMode: PerformancePreference
  // Appearance.
  theme: ThemePreference
  // Model and privacy. The key itself is never in here - see keys.ts.
  provider: ModelProvider
  model: string
  ollamaEndpoint: string
  rememberKey: boolean
  privacyNoticeSeen: boolean
  // Context budgets for model chat (spec-2 section 16).
  maxContextTokens: number
  maxOutputTokens: number
  maxRetrievedFiles: number
  maxRetrievedSymbols: number
  maxGraphDepth: number
  maxSnippetsPerFile: number
  includeTests: boolean
  includeDocs: boolean
  includeReadme: boolean
}

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash'
export const DEFAULT_OLLAMA_MODEL = 'qwen2.5-coder:7b'
export const DEFAULT_OLLAMA_ENDPOINT = 'http://localhost:11434'

export const DEFAULT_SETTINGS: Settings = {
  defaultBranch: '',
  maxFileKb: 1024,
  excludeGlobs: [],
  excludeFolders: [],
  sensitiveGlobs: [],
  maxTraversalDepth: 6,
  maxSearchResults: 50,
  performanceMode: 'auto',
  theme: 'dark',
  provider: 'none',
  model: DEFAULT_GEMINI_MODEL,
  ollamaEndpoint: DEFAULT_OLLAMA_ENDPOINT,
  rememberKey: false,
  privacyNoticeSeen: false,
  maxContextTokens: 30_000,
  maxOutputTokens: 2_048,
  maxRetrievedFiles: 12,
  maxRetrievedSymbols: 40,
  maxGraphDepth: 2,
  maxSnippetsPerFile: 3,
  includeTests: true,
  includeDocs: true,
  includeReadme: true,
}

// Sensitive files are excluded from the graph at index time (spec-2 section
// 26). These defaults combine with the content-based secret scan in
// secrets.ts; visitors can add their own patterns in settings.
export const DEFAULT_SENSITIVE_GLOBS = [
  '**/.env', '**/.env.*', '**/*.pem', '**/*.key', '**/*.p12', '**/*.pfx',
  '**/id_rsa', '**/id_ed25519', '**/*secret*', '**/*secrets*',
  '**/*credential*', '**/*credentials*', '**/*token*',
]

export function mergeSensitiveGlobs(custom: string[]): string[] {
  const cleaned = custom.map((g) => g.trim()).filter(Boolean)
  return [...new Set([...DEFAULT_SENSITIVE_GLOBS, ...cleaned])]
}

// Minimal glob matcher: ** crosses directories, * stays inside one segment.
export function globToRegExp(glob: string): RegExp {
  const PLACE = '\u0000'
  const body = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, PLACE)
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*')
    .replace(new RegExp(PLACE, 'g'), '(?:.*/)?')
  return new RegExp(`(^|/)${body}$`)
}

export function matchesAnyGlob(path: string, globs: string[]): string | null {
  for (const glob of globs) {
    try {
      if (globToRegExp(glob).test(path)) return glob
    } catch {
      // A malformed custom glob skips itself, never the file.
    }
  }
  return null
}

const SETTINGS_KEY = 'app'

// Write-through cache: saveSettings updates it synchronously so index runs
// started right after a settings change (panel saved, user immediately
// indexes) see the new values without a reload or an async gap.
let cache: Settings = { ...DEFAULT_SETTINGS }

export function getCachedSettings(): Settings {
  return cache
}

export async function loadSettings(): Promise<Settings> {
  const raw = await getSetting(SETTINGS_KEY)
  if (!raw) {
    cache = { ...DEFAULT_SETTINGS }
    return { ...cache }
  }
  try {
    cache = { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) }
  } catch {
    cache = { ...DEFAULT_SETTINGS }
  }
  return { ...cache }
}

export async function saveSettings(settings: Settings): Promise<void> {
  cache = settings
  await putSetting(SETTINGS_KEY, JSON.stringify(settings))
}

export async function resetSettings(): Promise<Settings> {
  const fresh = { ...DEFAULT_SETTINGS }
  await saveSettings(fresh)
  return fresh
}

// One-click wipe (spec-2 section 26): every CodeAtlas trace in this browser -
// the IndexedDB database, every codeatlas.* localStorage key (onboarding,
// community labels, panel prefs, an opted-in remembered key, the
// external-send marker) and in-memory keys. The caller reloads the page.
export async function wipeAllData(storage: Pick<Storage, 'key' | 'removeItem' | 'length'> = localStorage): Promise<void> {
  const doomed: string[] = []
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (key && key.startsWith('codeatlas')) doomed.push(key)
  }
  for (const key of doomed) storage.removeItem(key)
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = req.onerror = req.onblocked = () => resolve()
  })
}
