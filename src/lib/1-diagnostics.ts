// Graph diagnostics (phase 5): data-quality checks over the indexed graph,
// following spec-2 section 21. Pure and deterministic - same index, same
// report - so results are reproducible and unit-testable. The panel runs this
// in the search worker; nothing here deletes or mutates anything.

import type { EdgeRec, FileRec, SymbolRec } from './types'

export type IssueType =
  | 'duplicate-node-id'
  | 'missing-endpoint'
  | 'orphan-node'
  | 'duplicate-edge'
  | 'same-endpoint-edge'
  | 'dense-node'
  | 'invalid-location'
  | 'cycle'

export interface DiagnosticIssue {
  id: string
  severity: 'error' | 'warning'
  type: IssueType
  message: string
  // File paths involved, for display and click-through.
  paths: string[]
  suggestion: string
}

export interface DiagnosticsReport {
  counts: {
    nodes: number
    edges: number
    files: number
    symbols: number
    errors: number
    warnings: number
    orphans: number
    duplicateEdges: number
    missingRefs: number
  }
  issues: DiagnosticIssue[]
}

const SUGGESTIONS: Record<IssueType, string> = {
  'duplicate-node-id': 'Re-index the repository. Node ids derive from paths and names, so a duplicate usually means a stale record.',
  'missing-endpoint': 'Re-index the repository. The edge references a record the index no longer holds.',
  'orphan-node': 'Usually fine - entry points, readmes and config files have no graph edges. Act only if the file should be connected.',
  'duplicate-edge': 'Safe to ignore for queries; a re-index writes edges fresh.',
  'same-endpoint-edge': 'Often recursion or a file importing itself. Check the parser if this looks wrong.',
  'dense-node': 'Check whether this is a barrel or generated file. Unexpected fan-out can indicate a parse error.',
  'invalid-location': 'Re-index the repository. Paths and line numbers should resolve inside the indexed files.',
  cycle: 'Circular imports run in some setups but complicate bundling and reasoning. Consider extracting the shared part.',
}

const MAX_CYCLES = 10
const MAX_ISSUES_PER_TYPE = 200

export function runDiagnostics(files: FileRec[], symbols: SymbolRec[], edges: EdgeRec[]): DiagnosticsReport {
  const issues: DiagnosticIssue[] = []
  const push = (severity: DiagnosticIssue['severity'], type: IssueType, message: string, paths: string[], key: string) => {
    if (issues.filter((i) => i.type === type).length >= MAX_ISSUES_PER_TYPE) return
    issues.push({ id: `${type}:${key}`, severity, type, message, paths, suggestion: SUGGESTIONS[type] })
  }

  const fileById = new Map(files.map((f) => [f.id, f]))
  const symbolById = new Map(symbols.map((s) => [s.id, s]))
  const nodeIds = new Set([...fileById.keys(), ...symbolById.keys()])

  // Duplicate node ids: impossible to represent in the maps above, so count
  // occurrences on the raw arrays.
  const seen = new Map<string, number>()
  for (const id of [...files.map((f) => f.id), ...symbols.map((s) => s.id)]) seen.set(id, (seen.get(id) ?? 0) + 1)
  for (const [id, n] of [...seen.entries()].sort()) {
    if (n > 1) push('error', 'duplicate-node-id', `Node id ${id} appears ${n} times.`, [displayPath(id, fileById, symbolById)], id)
  }

  // Edges referencing missing nodes.
  let missingRefs = 0
  for (const e of edges) {
    const fromMissing = !nodeIds.has(e.fromId)
    const toMissing = !nodeIds.has(e.toId)
    if (fromMissing || toMissing) {
      missingRefs++
      const side = fromMissing && toMissing ? 'both endpoints' : fromMissing ? 'source' : 'target'
      push('error', 'missing-endpoint', `${e.type} edge ${e.id} has a missing ${side}.`, [displayPath(e.fromId, fileById, symbolById), displayPath(e.toId, fileById, symbolById)], e.id)
    }
  }

  // Orphan nodes: files with no edge touching them.
  const touched = new Set<string>()
  for (const e of edges) {
    touched.add(e.fromId)
    touched.add(e.toId)
  }
  let orphans = 0
  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    if (!touched.has(f.id)) {
      orphans++
      push('warning', 'orphan-node', `${f.path} has no imports, calls or contains edges.`, [f.path], f.id)
    }
  }

  // Duplicate edges: identical source, target and relationship.
  const edgeKeys = new Map<string, EdgeRec[]>()
  for (const e of edges) {
    const key = `${e.fromId}${e.toId}${e.type}`
    edgeKeys.set(key, [...(edgeKeys.get(key) ?? []), e])
  }
  let duplicateEdges = 0
  for (const [key, list] of [...edgeKeys.entries()].sort()) {
    if (list.length > 1) {
      duplicateEdges += list.length - 1
      const e = list[0]
      push('warning', 'duplicate-edge', `${list.length} identical ${e.type} edges from ${displayPath(e.fromId, fileById, symbolById)} to ${displayPath(e.toId, fileById, symbolById)}.`, [displayPath(e.fromId, fileById, symbolById), displayPath(e.toId, fileById, symbolById)], key)
    }
  }

  // Same-endpoint edges (self loops), which collapse in visualizations.
  for (const e of [...edges].sort((a, b) => a.id.localeCompare(b.id))) {
    if (e.fromId === e.toId) {
      push('warning', 'same-endpoint-edge', `${e.type} edge loops on ${displayPath(e.fromId, fileById, symbolById)}.`, [displayPath(e.fromId, fileById, symbolById)], e.id)
    }
  }

  // Suspiciously dense nodes: total degree far above the graph average.
  const degree = new Map<string, number>()
  for (const e of edges) {
    degree.set(e.fromId, (degree.get(e.fromId) ?? 0) + 1)
    degree.set(e.toId, (degree.get(e.toId) ?? 0) + 1)
  }
  const nodeCount = Math.max(nodeIds.size, 1)
  const avgDegree = (2 * edges.length) / nodeCount
  const denseThreshold = Math.max(25, Math.ceil(avgDegree * 4))
  for (const [id, d] of [...degree.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    if (d > denseThreshold) {
      push('warning', 'dense-node', `${displayPath(id, fileById, symbolById)} touches ${d} edges (threshold ${denseThreshold}).`, [displayPath(id, fileById, symbolById)], id)
    }
  }

  // Invalid locations: empty paths, symbols attached to unknown files, line
  // numbers outside their file.
  const lineCount = new Map(files.map((f) => [f.id, f.text.split('\n').length]))
  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    if (!f.path.trim()) push('error', 'invalid-location', `File record ${f.id} has an empty path.`, [f.id], `path:${f.id}`)
  }
  for (const s of [...symbols].sort((a, b) => a.id.localeCompare(b.id))) {
    const file = fileById.get(s.fileId)
    if (!file) {
      push('error', 'invalid-location', `Symbol ${s.name} (${s.id}) points at a file that is not indexed.`, [s.id], `file:${s.id}`)
      continue
    }
    const lines = lineCount.get(s.fileId) ?? 0
    if (s.startLine < 1 || s.startLine > lines || s.endLine < s.startLine) {
      push('error', 'invalid-location', `${s.name} in ${file.path} has invalid lines ${s.startLine}-${s.endLine} (file has ${lines}).`, [file.path], `lines:${s.id}`)
    }
  }

  // Cycles in the file-level import graph, reported with their paths.
  const importAdj = new Map<string, string[]>()
  for (const e of edges) {
    if (e.type !== 'imports' || !fileById.has(e.fromId) || !fileById.has(e.toId)) continue
    importAdj.set(e.fromId, [...(importAdj.get(e.fromId) ?? []), e.toId])
  }
  for (const list of importAdj.values()) list.sort()
  const cycles = findCycles(importAdj, MAX_CYCLES)
  for (const cycle of cycles) {
    const paths = cycle.map((id) => fileById.get(id)?.path ?? id)
    push('warning', 'cycle', `Import cycle: ${[...paths, paths[0]].join(' → ')}.`, paths, cycle.join('→'))
  }

  const errors = issues.filter((i) => i.severity === 'error').length
  return {
    counts: {
      nodes: nodeIds.size,
      edges: edges.length,
      files: files.length,
      symbols: symbols.length,
      errors,
      warnings: issues.length - errors,
      orphans,
      duplicateEdges,
      missingRefs,
    },
    issues,
  }
}

function displayPath(id: string, fileById: Map<string, FileRec>, symbolById: Map<string, SymbolRec>): string {
  const file = fileById.get(id)
  if (file) return file.path
  const symbol = symbolById.get(id)
  if (symbol) return `${symbol.name} (${symbol.id})`
  return id
}

// Depth-first cycle hunt with three-color marking. Each found cycle is
// normalized to start at its smallest member id so duplicates collapse.
function findCycles(adj: Map<string, string[]>, max: number): string[][] {
  const color = new Map<string, 0 | 1 | 2>() // 1 = on stack, 2 = done
  const found = new Map<string, string[]>()
  const stack: string[] = []

  const visit = (node: string) => {
    if (found.size >= max) return
    color.set(node, 1)
    stack.push(node)
    for (const next of adj.get(node) ?? []) {
      if (found.size >= max) return
      const c = color.get(next)
      if (c === 1) {
        const start = stack.indexOf(next)
        const cycle = stack.slice(start)
        const minIdx = cycle.indexOf([...cycle].sort()[0])
        const norm = [...cycle.slice(minIdx), ...cycle.slice(0, minIdx)]
        const key = norm.join('→')
        if (!found.has(key)) found.set(key, norm)
      } else if (c !== 2) {
        visit(next)
      }
    }
    stack.pop()
    color.set(node, 2)
  }

  for (const node of [...adj.keys()].sort()) {
    if (found.size >= max) break
    if (!color.has(node)) visit(node)
  }
  return [...found.values()]
}

export function diagnosticsToJson(report: DiagnosticsReport): string {
  return JSON.stringify(report, null, 2)
}

export function diagnosticsToMarkdown(report: DiagnosticsReport): string {
  const c = report.counts
  const lines: string[] = [
    '# CodeAtlas graph diagnostics',
    '',
    '| Metric | Count |',
    '| --- | ---: |',
    `| Nodes | ${c.nodes} |`,
    `| Edges | ${c.edges} |`,
    `| Files | ${c.files} |`,
    `| Symbols | ${c.symbols} |`,
    `| Errors | ${c.errors} |`,
    `| Warnings | ${c.warnings} |`,
    `| Orphan nodes | ${c.orphans} |`,
    `| Duplicate edges | ${c.duplicateEdges} |`,
    `| Missing references | ${c.missingRefs} |`,
    '',
  ]
  if (report.issues.length === 0) {
    lines.push('No issues found.')
    return lines.join('\n')
  }
  lines.push('| Severity | Type | Issue | Suggestion |', '| --- | --- | --- | --- |')
  for (const i of report.issues) {
    lines.push(`| ${i.severity} | ${i.type} | ${i.message.replace(/\|/g, '\\|')} | ${i.suggestion.replace(/\|/g, '\\|')} |`)
  }
  return lines.join('\n')
}
