// Repository-wide search engine (phase 4): exact, case-insensitive, prefix,
// fuzzy and /regex/ modes over file names, paths, symbols and indexed code
// content. Pure functions - the same code runs in the search worker and in
// unit tests. Ranking tiers follow the feature-pack spec:
//   1 exact file or symbol name, 2 path match, 3 symbol definition,
//   4 code-content match, 5 fuzzy match.
// Results are grouped Files, Symbols, Code matches, Graph nodes.

import type { FileRec, SymbolRec } from './types'

export type SearchGroup = 'Files' | 'Symbols' | 'Code matches' | 'Graph nodes'
export const GROUP_ORDER: SearchGroup[] = ['Files', 'Symbols', 'Code matches', 'Graph nodes']

export interface SearchResult {
  group: SearchGroup
  tier: 1 | 2 | 3 | 4 | 5
  path: string
  line?: number
  name?: string
  symbolKind?: string
  moduleName?: string
  preview?: string
}

export interface SearchOutcome {
  results: SearchResult[]
  error?: string
  truncated: boolean
}

const PER_GROUP_CAP = 20

function subsequence(needle: string, haystack: string): boolean {
  let i = 0
  for (const ch of haystack) {
    if (ch === needle[i]) i++
    if (i === needle.length) return true
  }
  return needle.length > 0 && i === needle.length
}

// A query wrapped in /slashes/ (optional trailing flags) is a regex search.
function parseRegex(query: string): { regex?: RegExp; error?: string } {
  const m = query.match(/^\/(.+)\/([a-z]*)$/)
  if (!m) return {}
  try {
    return { regex: new RegExp(m[1], m[2].includes('i') ? m[2] : m[2] + 'i') }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { error: msg.startsWith('Invalid regular expression') ? msg : `Invalid regular expression: ${msg}` }
  }
}

export function searchAll(
  rawQuery: string,
  files: FileRec[],
  symbols: SymbolRec[],
  moduleNames: string[],
): SearchOutcome {
  const query = rawQuery.trim()
  if (!query) return { results: [], truncated: false }

  const { regex, error } = parseRegex(query)
  if (error) return { results: [], error, truncated: false }

  const lower = query.toLowerCase()
  const results: SearchResult[] = []
  const fileById = new Map(files.map((f) => [f.id, f]))

  if (regex) {
    for (const file of files) {
      const name = file.path.split('/').pop() ?? file.path
      if (regex.test(name) || regex.test(file.path)) {
        results.push({ group: 'Files', tier: 2, path: file.path })
        continue
      }
      const lines = file.text.split('\n')
      let added = 0
      for (let i = 0; i < lines.length && added < 3; i++) {
        if (regex.test(lines[i])) {
          results.push({ group: 'Code matches', tier: 4, path: file.path, line: i + 1, preview: lines[i].trim().slice(0, 120) })
          added++
        }
      }
    }
    for (const sym of symbols) {
      if (regex.test(sym.name)) {
        const file = fileById.get(sym.fileId)
        if (file) results.push({ group: 'Symbols', tier: 3, path: file.path, line: sym.startLine, name: sym.name, symbolKind: sym.kind })
      }
    }
  } else {
    for (const file of files) {
      const name = file.path.split('/').pop() ?? file.path
      if (name === query || name.toLowerCase() === lower) {
        results.push({ group: 'Files', tier: 1, path: file.path })
      } else if (file.path.toLowerCase().includes(lower)) {
        results.push({ group: 'Files', tier: 2, path: file.path })
      } else if (subsequence(lower, name.toLowerCase())) {
        results.push({ group: 'Files', tier: 5, path: file.path })
      }
    }
    for (const sym of symbols) {
      const file = fileById.get(sym.fileId)
      if (!file) continue
      if (sym.name === query || sym.name.toLowerCase() === lower) {
        results.push({ group: 'Symbols', tier: 1, path: file.path, line: sym.startLine, name: sym.name, symbolKind: sym.kind })
      } else if (sym.name.toLowerCase().startsWith(lower) || sym.name.toLowerCase().includes(lower)) {
        results.push({ group: 'Symbols', tier: 3, path: file.path, line: sym.startLine, name: sym.name, symbolKind: sym.kind })
      } else if (subsequence(lower, sym.name.toLowerCase())) {
        results.push({ group: 'Symbols', tier: 5, path: file.path, line: sym.startLine, name: sym.name, symbolKind: sym.kind })
      }
    }
    // Code content: line-level substring matches, capped per file so one
    // repetitive file cannot flood the group.
    if (query.length >= 3) {
      for (const file of files) {
        const lines = file.text.split('\n')
        let added = 0
        for (let i = 0; i < lines.length && added < 3; i++) {
          if (lines[i].toLowerCase().includes(lower)) {
            results.push({ group: 'Code matches', tier: 4, path: file.path, line: i + 1, preview: lines[i].trim().slice(0, 120) })
            added++
          }
        }
      }
    }
  }

  // Graph nodes: the modules on the architecture map.
  for (const name of moduleNames) {
    if (regex ? regex.test(name) : name.toLowerCase().includes(lower) || subsequence(lower, name.toLowerCase())) {
      results.push({ group: 'Graph nodes', tier: regex ? 2 : name.toLowerCase() === lower ? 1 : 2, path: '', moduleName: name, name })
    }
  }

  results.sort((a, b) => {
    const g = GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group)
    if (g !== 0) return g
    if (a.tier !== b.tier) return a.tier - b.tier
    return (a.path || a.moduleName || '').localeCompare(b.path || b.moduleName || '') || (a.line ?? 0) - (b.line ?? 0)
  })

  // Cap per group, keeping the best tiers.
  const counts = new Map<SearchGroup, number>()
  const kept: SearchResult[] = []
  let truncated = false
  for (const r of results) {
    const n = counts.get(r.group) ?? 0
    if (n < PER_GROUP_CAP) {
      kept.push(r)
      counts.set(r.group, n + 1)
    } else {
      truncated = true
    }
  }
  return { results: kept, truncated }
}
