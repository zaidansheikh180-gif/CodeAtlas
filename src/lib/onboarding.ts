// Onboarding and feature tour state (phase 9 part 4, spec-2 section 31,
// pack-1 #25). First run shows a concise welcome explaining the three usage
// modes and the privacy model; a short non-blocking tour covers the main
// features. Completion persists locally; the tour can be skipped and
// reopened any time. Nothing here leaves the device.

const STORAGE_KEY = 'codeatlas.onboarded.v1'

export interface TourStep {
  id: string
  title: string
  body: string
}

// The tour stays concise on purpose: one card per capability, no backdrop,
// no forced navigation. Ordered the way a first session unfolds.
export const TOUR_STEPS: TourStep[] = [
  {
    id: 'repo-input',
    title: 'Point at a repository',
    body: 'Paste a public GitHub URL to explore its architecture, or map a folder on this device. You can pick a branch, tag or commit before indexing.',
  },
  {
    id: 'indexing',
    title: 'Indexing runs in your browser',
    body: 'A worker parses files, scans for secrets and builds the code graph. Progress is real: every stage reports what it actually did.',
  },
  {
    id: 'map',
    title: 'Read the architecture map',
    body: 'Modules are sized by file count. Solid arrows are imports, dashed arrows are calls. Click a module to list its files, double-click to expand it, use the minimap to jump.',
  },
  {
    id: 'source',
    title: 'Open the source viewer',
    body: 'Click any citation or file to read the source with highlighting. The explorer tree, search palette (Ctrl+K) and map all open the same viewer.',
  },
  {
    id: 'queries',
    title: 'Ask key-free graph questions',
    body: 'Ask "what does X import?", "who calls Y?" or "what breaks if Z changes?" - answers come from the local index with file:line citations. No account, no key.',
  },
  {
    id: 'impact',
    title: 'Trace impact and call flow',
    body: 'Impact analysis shows what a change touches, including affected tests. Call flow traces execution paths through the graph.',
  },
  {
    id: 'model-chat',
    title: 'Optionally connect a model',
    body: 'Semantic chat uses your own model key, stored only in this browser. Selected context is sent to the provider only when you ask - never automatically.',
  },
  {
    id: 'privacy',
    title: 'Your code stays yours',
    body: 'Everything lives in this browser: the index, snapshots, feedback and settings. Clear any repository from its page, and export diagnostics redacted.',
  },
]

export function isOnboarded(storage: Pick<Storage, 'getItem'> = localStorage): boolean {
  try {
    return storage.getItem(STORAGE_KEY) === 'done'
  } catch {
    return false
  }
}

export function markOnboarded(storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(STORAGE_KEY, 'done')
  } catch {
    // storage unavailable: the welcome simply appears again next load
  }
}

export function resetOnboarding(storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(STORAGE_KEY, '')
  } catch {
    // ignore
  }
}
