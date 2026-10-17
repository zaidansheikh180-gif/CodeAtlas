// Repository snapshots and version comparison (phase 6, spec-2 section 23).
// A snapshot freezes the full graph (file text included) as one IndexedDB
// record, so it survives re-indexing and can be reopened or compared later.
// Comparison is pure set math over paths and dependency keys - deterministic,
// no worker needed. Community changes match clusters across versions by
// Jaccard overlap of member file paths.

import { clusterFiles, type CommunityStat } from './cluster'
import type { GraphExportFile } from './graphexport'
import { GRAPH_EXPORT_KIND, GRAPH_EXPORT_SCHEMA_VERSION } from './graphexport'
import type { EdgeRec, FileRec, RepoRec, SymbolRec } from './types'

export interface SnapshotRec {
  id: string
  repoUrl: string
  fullName: string
  ref: string
  commit: string
  indexedAt: number // when the underlying index was built
  createdAt: number // when the snapshot was saved
  counts: { files: number; symbols: number; edges: number }
  // The frozen graph, in the same shape as a graph export.
  data: GraphExportFile
}

export function makeSnapshot(repo: RepoRec, files: FileRec[], symbols: SymbolRec[], edges: EdgeRec[], createdAt: number): SnapshotRec {
  return {
    id: `snap-${repo.fullName.replace(/[^a-z0-9-]+/gi, '-')}-${repo.commit.slice(0, 12)}`,
    repoUrl: repo.url,
    fullName: repo.fullName,
    ref: repo.ref ?? repo.defaultBranch,
    commit: repo.commit,
    indexedAt: repo.indexedAt,
    createdAt,
    counts: { files: files.length, symbols: symbols.length, edges: edges.length },
    data: {
      kind: GRAPH_EXPORT_KIND,
      schemaVersion: GRAPH_EXPORT_SCHEMA_VERSION,
      exportedAt: new Date(createdAt).toISOString(),
      repo: { url: repo.url, fullName: repo.fullName, ref: repo.ref ?? repo.defaultBranch, commit: repo.commit, indexedAt: repo.indexedAt },
      counts: { files: files.length, symbols: symbols.length, edges: edges.length },
      files,
      symbols,
      edges,
    },
  }
}

export interface ComparisonReport {
  files: { added: string[]; removed: string[]; modified: string[] }
  symbols: { added: string[]; removed: string[] } // path#name keys
  dependencies: { added: string[]; removed: string[] } // "from -> to (type)" keys
  communities: { added: CommunityBrief[]; removed: CommunityBrief[] }
}

export interface CommunityBrief {
  fileCount: number
  mainLanguage: string | null
  topPaths: string[]
  hubs: string[]
}

function symbolKey(path: string, name: string): string {
  return `${path}#${name}`
}

function dependencyKeys(files: FileRec[], symbols: SymbolRec[], edges: EdgeRec[]): Set<string> {
  const pathByFileId = new Map(files.map((f) => [f.id, f.path]))
  const pathBySymbolId = new Map(symbols.map((s) => [s.id, pathByFileId.get(s.fileId) ?? s.fileId]))
  const resolve = (id: string) => pathByFileId.get(id) ?? pathBySymbolId.get(id)
  const keys = new Set<string>()
  for (const e of edges) {
    if (e.type === 'contains') continue // structure, not a dependency
    const from = resolve(e.fromId)
    const to = resolve(e.toId)
    if (from && to) keys.add(`${from} -> ${to} (${e.type})`)
  }
  return keys
}

function brief(stat: CommunityStat): CommunityBrief {
  return { fileCount: stat.fileCount, mainLanguage: stat.mainLanguage, topPaths: stat.topPaths, hubs: stat.hubs.map((h) => h.path) }
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let intersection = 0
  for (const v of a) if (b.has(v)) intersection++
  return intersection / Math.max(a.size + b.size - intersection, 1)
}

export function compareSnapshots(a: SnapshotRec, b: SnapshotRec): ComparisonReport {
  // Files: added / removed by path, modified by content hash.
  const aFiles = new Map(a.data.files.map((f) => [f.path, f.contentHash]))
  const bFiles = new Map(b.data.files.map((f) => [f.path, f.contentHash]))
  const files = { added: [] as string[], removed: [] as string[], modified: [] as string[] }
  for (const path of [...bFiles.keys()].sort()) {
    if (!aFiles.has(path)) files.added.push(path)
    else if (aFiles.get(path) !== bFiles.get(path)) files.modified.push(path)
  }
  for (const path of [...aFiles.keys()].sort()) {
    if (!bFiles.has(path)) files.removed.push(path)
  }

  // Symbols: added / removed by path#name (line drift is a modification of
  // the file, not a new symbol).
  const aPathByFileId = new Map(a.data.files.map((f) => [f.id, f.path]))
  const bPathByFileId = new Map(b.data.files.map((f) => [f.id, f.path]))
  const aSymbols = new Set(a.data.symbols.map((s) => symbolKey(aPathByFileId.get(s.fileId) ?? s.fileId, s.name)))
  const bSymbols = new Set(b.data.symbols.map((s) => symbolKey(bPathByFileId.get(s.fileId) ?? s.fileId, s.name)))
  const symbols = {
    added: [...bSymbols].filter((k) => !aSymbols.has(k)).sort(),
    removed: [...aSymbols].filter((k) => !bSymbols.has(k)).sort(),
  }

  // Dependencies: edge keys resolved to file paths so id schemes never leak.
  const aDeps = dependencyKeys(a.data.files, a.data.symbols, a.data.edges)
  const bDeps = dependencyKeys(b.data.files, b.data.symbols, b.data.edges)
  const dependencies = {
    added: [...bDeps].filter((k) => !aDeps.has(k)).sort(),
    removed: [...aDeps].filter((k) => !bDeps.has(k)).sort(),
  }

  // Communities: cluster both versions, match by Jaccard overlap of member
  // file paths; unmatched communities are new (in B) or removed (in A).
  const aCluster = clusterFiles(a.data.files, a.data.symbols, a.data.edges)
  const bCluster = clusterFiles(b.data.files, b.data.symbols, b.data.edges)
  const memberPaths = (files: FileRec[], assign: Map<string, string>) => {
    const pathById = new Map(files.map((f) => [f.id, f.path]))
    const out = new Map<string, Set<string>>()
    for (const [fileId, communityId] of assign) {
      const path = pathById.get(fileId)
      if (!path) continue
      if (!out.has(communityId)) out.set(communityId, new Set())
      out.get(communityId)!.add(path)
    }
    return out
  }
  const aMembers = memberPaths(a.data.files, aCluster.assign)
  const bMembers = memberPaths(b.data.files, bCluster.assign)
  const matchedA = new Set<string>()
  const matchedB = new Set<string>()
  // Greedy best-match: highest Jaccard first.
  const pairs: { aId: string; bId: string; score: number }[] = []
  for (const [aId, aSet] of aMembers) {
    for (const [bId, bSet] of bMembers) {
      const score = jaccard(aSet, bSet)
      if (score >= 0.5) pairs.push({ aId, bId, score })
    }
  }
  pairs.sort((x, y) => y.score - x.score || x.aId.localeCompare(y.aId) || x.bId.localeCompare(y.bId))
  for (const { aId, bId } of pairs) {
    if (matchedA.has(aId) || matchedB.has(bId)) continue
    matchedA.add(aId)
    matchedB.add(bId)
  }
  const communities = {
    added: bCluster.communities.filter((c) => !matchedB.has(c.id)).map(brief),
    removed: aCluster.communities.filter((c) => !matchedA.has(c.id)).map(brief),
  }

  return { files, symbols, dependencies, communities }
}

export function comparisonToMarkdown(a: SnapshotRec, b: SnapshotRec, report: ComparisonReport): string {
  const lines: string[] = [
    `# CodeAtlas snapshot comparison`,
    '',
    `- A: ${a.fullName} @ ${a.ref} (${a.commit.slice(0, 7)}), indexed ${new Date(a.indexedAt).toISOString()}`,
    `- B: ${b.fullName} @ ${b.ref} (${b.commit.slice(0, 7)}), indexed ${new Date(b.indexedAt).toISOString()}`,
    '',
    `| Category | Added | Removed | Modified |`,
    `| --- | ---: | ---: | ---: |`,
    `| Files | ${report.files.added.length} | ${report.files.removed.length} | ${report.files.modified.length} |`,
    `| Symbols | ${report.symbols.added.length} | ${report.symbols.removed.length} | - |`,
    `| Dependencies | ${report.dependencies.added.length} | ${report.dependencies.removed.length} | - |`,
    `| Communities | ${report.communities.added.length} | ${report.communities.removed.length} | - |`,
    '',
  ]
  const section = (title: string, items: string[]) => {
    lines.push(`## ${title} (${items.length})`, '')
    for (const item of items) lines.push(`- ${item}`)
    lines.push('')
  }
  section('Added files', report.files.added)
  section('Removed files', report.files.removed)
  section('Modified files', report.files.modified)
  section('Added symbols', report.symbols.added)
  section('Removed symbols', report.symbols.removed)
  section('Added dependencies', report.dependencies.added)
  section('Removed dependencies', report.dependencies.removed)
  const communityLines = (list: CommunityBrief[]) =>
    list.map((c) => `${c.fileCount} files${c.mainLanguage ? `, ${c.mainLanguage}` : ''} - paths: ${c.topPaths.join(', ')}`)
  section('New communities', communityLines(report.communities.added))
  section('Removed communities', communityLines(report.communities.removed))
  return lines.join('\n')
}
