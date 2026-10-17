// Graph merging (phase 6, spec-2 section 20): merge two or more repository
// graphs into one, preserving repository ownership. Duplicates are detected
// by repository tag + record type + path (files) and path#name (symbols).
// The user picks how duplicates are handled before anything is written:
// - separate: every repository keeps its own tree, paths prefixed by tag
// - linked:   like separate, plus dashed call links between duplicate files
// - merged:   duplicate paths collapse into one node; first repository wins,
//             symbols and edges of the losers remap onto the winner
// Records that fail shape validation are skipped and counted, never guessed.
// planMerge computes the full merge and a report; the UI shows the report as
// the merge preview before materializing the result.

import { edgeId, fileId, symbolId } from './db'
import { repoShortName, type RepoGraphInput } from './globalgraph'
import type { EdgeRec, EdgeType, FileRec, SymbolRec } from './types'

export type MergeStrategy = 'separate' | 'linked' | 'merged'

export interface MergeReport {
  strategy: MergeStrategy
  repos: { fullName: string; tag: string; files: number; symbols: number; edges: number }[]
  // Duplicate file paths found across repositories (all strategies report
  // them; only "merged" collapses them).
  duplicateFiles: string[]
  duplicateSymbols: number
  duplicateEdges: number
  result: { files: number; symbols: number; edges: number }
  skipped: { files: number; symbols: number; edges: number }
}

export interface MergePlan {
  viewId: string
  fullName: string
  files: FileRec[]
  symbols: SymbolRec[]
  edges: EdgeRec[]
  report: MergeReport
}

const EDGE_TYPES: ReadonlySet<string> = new Set(['imports', 'calls', 'contains'])

function validFile(f: FileRec): boolean {
  return typeof f?.id === 'string' && typeof f.repoId === 'string' && typeof f.path === 'string' && f.path.length > 0 && typeof f.text === 'string'
}
function validSymbol(s: SymbolRec): boolean {
  return typeof s?.id === 'string' && typeof s.fileId === 'string' && typeof s.name === 'string' && s.name.length > 0 && Number.isFinite(s.startLine)
}
function validEdge(e: EdgeRec): boolean {
  return typeof e?.id === 'string' && typeof e.fromId === 'string' && typeof e.toId === 'string' && EDGE_TYPES.has(e.type)
}

export function mergeViewId(tags: string[], strategy: MergeStrategy): string {
  return `merged:${strategy}:${tags.join('+')}`
}

export function planMerge(inputs: RepoGraphInput[], strategy: MergeStrategy): MergePlan {
  const shorts = inputs.map((i) => repoShortName(i.repo.fullName))
  const tags = inputs.map((_, i) => (shorts.indexOf(shorts[i]) === i ? shorts[i] : inputs[i].repo.fullName))
  const viewId = mergeViewId(tags, strategy)

  const files: FileRec[] = []
  const symbols: SymbolRec[] = []
  const edges: EdgeRec[] = []
  const skipped = { files: 0, symbols: 0, edges: 0 }
  const duplicatePaths = new Set<string>()
  let duplicateSymbols = 0
  let duplicateEdges = 0

  // old id -> new id, for files and symbols across every repo.
  const fileIdMap = new Map<string, string>()
  const symbolIdMap = new Map<string, string>()
  const pathByOldFileId = new Map<string, string>()
  const seenPathsGlobal = new Set<string>()
  const usedFileIds = new Set<string>()
  const seenSymbolIds = new Set<string>()
  const seenEdgeIds = new Set<string>()
  // original path -> every new file id with that path (linked strategy).
  const copiesByPath = new Map<string, string[]>()

  inputs.forEach((input, index) => {
    const tag = tags[index]
    const pathSeenHere = new Set<string>()
    for (const f of input.files) {
      if (!validFile(f)) {
        skipped.files++
        continue
      }
      if (pathSeenHere.has(f.path)) continue // duplicate inside one repo: keep first
      pathSeenHere.add(f.path)
      pathByOldFileId.set(f.id, f.path)
      const isDuplicate = seenPathsGlobal.has(f.path) // seen in an earlier repo
      seenPathsGlobal.add(f.path)
      const newPath = strategy === 'merged' ? f.path : `${tag}/${f.path}`
      const newId = fileId(viewId, newPath)
      if (isDuplicate) duplicatePaths.add(f.path)
      if (strategy === 'merged' && usedFileIds.has(newId)) {
        // Duplicate path: first repository wins, this copy collapses.
        fileIdMap.set(f.id, newId) // symbols and edges remap onto the winner
        continue
      }
      usedFileIds.add(newId)
      fileIdMap.set(f.id, newId)
      files.push({ ...f, id: newId, repoId: viewId, path: newPath })
      if (strategy === 'linked') {
        const copies = copiesByPath.get(f.path) ?? []
        copies.push(newId)
        copiesByPath.set(f.path, copies)
      }
    }
    for (const s of input.symbols) {
      if (!validSymbol(s) || !pathByOldFileId.has(s.fileId)) {
        skipped.symbols++
        continue
      }
      const originalPath = pathByOldFileId.get(s.fileId)!
      const newPath = strategy === 'merged' ? originalPath : `${tag}/${originalPath}`
      const newId = symbolId(viewId, newPath, s.name, s.startLine)
      if (seenSymbolIds.has(newId)) {
        duplicateSymbols++
        symbolIdMap.set(s.id, newId)
        continue
      }
      seenSymbolIds.add(newId)
      symbolIdMap.set(s.id, newId)
      symbols.push({ ...s, id: newId, repoId: viewId, fileId: fileIdMap.get(s.fileId)! })
    }
    for (const e of input.edges) {
      if (!validEdge(e)) {
        skipped.edges++
        continue
      }
      const from = fileIdMap.get(e.fromId) ?? symbolIdMap.get(e.fromId)
      const to = fileIdMap.get(e.toId) ?? symbolIdMap.get(e.toId)
      if (!from || !to) {
        skipped.edges++
        continue
      }
      const newId = edgeId(viewId, from, to, e.type)
      if (seenEdgeIds.has(newId)) {
        duplicateEdges++
        continue
      }
      seenEdgeIds.add(newId)
      edges.push({ ...e, id: newId, repoId: viewId, fromId: from, toId: to })
    }
  })

  if (strategy === 'linked') {
    for (const copies of copiesByPath.values()) {
      for (let i = 0; i + 1 < copies.length; i++) {
        const id = edgeId(viewId, copies[i], copies[i + 1], 'calls')
        if (seenEdgeIds.has(id)) continue
        seenEdgeIds.add(id)
        edges.push({ id, repoId: viewId, fromId: copies[i], toId: copies[i + 1], type: 'calls' as EdgeType, confidence: 'inferred' })
      }
    }
  }

  const report: MergeReport = {
    strategy,
    repos: inputs.map((input, i) => ({
      fullName: input.repo.fullName,
      tag: tags[i],
      files: input.files.length,
      symbols: input.symbols.length,
      edges: input.edges.length,
    })),
    duplicateFiles: [...duplicatePaths].sort(),
    duplicateSymbols,
    duplicateEdges,
    result: { files: files.length, symbols: symbols.length, edges: edges.length },
    skipped,
  }
  return { viewId, fullName: tags.join(' + '), files, symbols, edges, report }
}

export function mergeReportToMarkdown(plan: MergePlan): string {
  const r = plan.report
  const lines: string[] = [
    `# CodeAtlas graph merge`,
    '',
    `- Repositories: ${r.repos.map((x) => x.fullName).join(', ')}`,
    `- Duplicate strategy: ${r.strategy}`,
    '',
    `| Repository | Tag | Files | Symbols | Edges |`,
    `| --- | --- | ---: | ---: | ---: |`,
    ...r.repos.map((x) => `| ${x.fullName} | ${x.tag} | ${x.files} | ${x.symbols} | ${x.edges} |`),
    '',
    `## Result`,
    '',
    `- Files: ${r.result.files} (${r.duplicateFiles.length} duplicate paths${r.strategy === 'merged' ? ', collapsed' : ', kept'})`,
    `- Symbols: ${r.result.files >= 0 ? r.result.symbols : 0} (${r.duplicateSymbols} duplicates dropped)`,
    `- Edges: ${r.result.edges} (${r.duplicateEdges} duplicates dropped)`,
    `- Skipped invalid records: ${r.skipped.files} files, ${r.skipped.symbols} symbols, ${r.skipped.edges} edges`,
    '',
    `## Duplicate file paths (${r.duplicateFiles.length})`,
    '',
    ...r.duplicateFiles.map((p) => `- ${p}`),
    '',
  ]
  return lines.join('\n')
}
