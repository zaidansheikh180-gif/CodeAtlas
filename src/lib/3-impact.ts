// Impact analysis on top of the graph query index: reverse traversal with
// per-node depth and a surviving dependency path, affected-test detection,
// and Markdown/JSON report export. Pure functions - unit tested directly.

import type { QueryIndex, GNode, Relation } from './graphquery'
import type { FileRec } from './types'

export interface ImpactOptions {
  depth?: number // max traversal depth, default 3
  relations?: Relation[] // edge filter; empty = all
  nodeTypes?: GNode['type'][] // keep only these node types in the rows
}

export interface ImpactRow {
  node: GNode
  depth: number
  // Human-readable dependency chain from the affected node back to the
  // selected node, e.g. "app.js -imports-> router.js -imports-> utils.js".
  path: { node: GNode; relation: Relation | null }[]
}

export interface ImpactReport {
  root: GNode
  direct: ImpactRow[]
  transitive: ImpactRow[]
  truncated: boolean // node cap hit
}

const NODE_CAP = 200

// Reverse BFS from the selected node. Cycles terminate via the visited set;
// each reached node keeps the first (shortest) path found.
export function impactReport(index: QueryIndex, startId: string, options: ImpactOptions = {}): ImpactReport | null {
  const root = index.nodes.get(startId)
  if (!root) return null
  const depthLimit = Math.max(1, Math.min(options.depth ?? 3, 10))
  const typeFilter = options.nodeTypes && options.nodeTypes.length > 0 ? new Set(options.nodeTypes) : null
  const wanted = options.relations && options.relations.length > 0 ? new Set(options.relations) : null
  const visited = new Set<string>([startId])
  const paths = new Map<string, { node: GNode; relation: Relation | null }[]>()
  const rows: ImpactRow[] = []
  let frontier = [startId]
  let truncated = false
  for (let depth = 1; depth <= depthLimit && frontier.length > 0; depth++) {
    const next: string[] = []
    for (const id of frontier) {
      for (const entry of index.inn.get(id) ?? []) {
        if (wanted && !wanted.has(entry.relation)) continue
        if (visited.has(entry.id)) continue
        visited.add(entry.id)
        const node = index.nodes.get(entry.id)
        if (!node) continue
        const parentPath = paths.get(id) ?? [{ node: root, relation: null }]
        paths.set(entry.id, [...parentPath, { node, relation: entry.relation }])
        if (rows.length >= NODE_CAP) {
          truncated = true
          continue
        }
        next.push(entry.id)
        if (!typeFilter || typeFilter.has(node.type)) {
          rows.push({ node, depth, path: paths.get(entry.id)! })
        }
      }
    }
    frontier = next
  }
  return {
    root,
    direct: rows.filter((row) => row.depth === 1),
    transitive: rows.filter((row) => row.depth > 1),
    truncated,
  }
}

export function formatPath(path: ImpactRow['path']): string {
  return path.map((step) => (step.relation ? ` -${step.relation}-> ${step.node.name}` : step.node.name)).join('')
}

export function reportToMarkdown(report: ImpactReport): string {
  const lines: string[] = [
    `# Impact report: ${report.root.name}`,
    '',
    `Selected: ${report.root.type} \`${report.root.name}\` (${report.root.path}${report.root.startLine ? `:${report.root.startLine}` : ''})`,
    '',
    `Direct dependents: ${report.direct.length} · Transitive dependents: ${report.transitive.length}${report.truncated ? ' · truncated at 200 nodes' : ''}`,
    '',
    '| Affected node | Type | File | Path | Depth |',
    '| --- | --- | --- | --- | --- |',
  ]
  for (const row of [...report.direct, ...report.transitive]) {
    const cite = `${row.node.path}${row.node.startLine ? `:${row.node.startLine}` : ''}`
    lines.push(`| ${row.node.name} | ${row.node.type} | ${cite} | ${formatPath(row.path)} | ${row.depth} |`)
  }
  return lines.join('\n') + '\n'
}

export function reportToJson(report: ImpactReport): string {
  return JSON.stringify(
    {
      root: report.root,
      truncated: report.truncated,
      direct: report.direct,
      transitive: report.transitive,
    },
    null,
    2,
  )
}

// --- Affected test detection ---------------------------------------------

const TEST_PATH = /(^|\/)(__tests__|tests?|spec|test)\/|\.(test|spec)\.[jt]sx?$|^(test|spec)_|_test\.[jt]sx?$/i

export function isTestPath(path: string): boolean {
  return TEST_PATH.test(path)
}

export interface AffectedTest {
  testPath: string
  reason: string
  confirmed: boolean // graph edge exists; false = naming/directory heuristic
  viaPath?: string // import chain for transitive matches
}

// Given changed source paths, find likely affected test files. Confirmed =
// an import edge from the test file to the changed file (transitively, up to
// depth 3). Heuristic = same basename (foo.ts <-> foo.test.ts) or a test file
// mirroring the changed file's directory name.
export function affectedTests(index: QueryIndex, files: FileRec[], changedPaths: string[]): AffectedTest[] {
  const changed = new Set(changedPaths)
  const changedIds = new Set(
    changedPaths.map((path) => index.filesByPath.get(path)).filter((id): id is string => !!id),
  )
  const tests = files.filter((file) => isTestPath(file.path))
  const results = new Map<string, AffectedTest>()

  for (const test of tests) {
    // Graph-confirmed: reverse traversal from the changed files (tests that
    // import them, directly or through other files).
    for (const startId of changedIds) {
      const visited = new Set<string>([startId])
      let frontier = [startId]
      for (let depth = 1; depth <= 3 && frontier.length > 0; depth++) {
        const next: string[] = []
        for (const id of frontier) {
          for (const entry of index.inn.get(id) ?? []) {
            if (entry.relation !== 'imports') continue
            if (visited.has(entry.id)) continue
            visited.add(entry.id)
            next.push(entry.id)
            const node = index.nodes.get(entry.id)
            if (node && node.path === test.path && !results.has(test.path)) {
              const via = depth > 1 ? `imports the changed file through ${depth - 1} other file(s)` : undefined
              results.set(test.path, {
                testPath: test.path,
                reason: via ?? 'imports the changed file directly',
                confirmed: true,
                viaPath: via,
              })
            }
          }
        }
        frontier = next
      }
    }
    if (results.has(test.path)) continue
    // Heuristic: basename match (utils.ts -> utils.test.ts) or the test sits
    // in a test directory whose sibling directory name matches.
    const base = (path: string) => (path.split('/').pop() ?? path).replace(/\.(test|spec)\.[jt]sx?$|\.[jt]sx?$/i, '')
    const testBase = base(test.path).toLowerCase()
    for (const path of changed) {
      if (isTestPath(path)) continue
      if (base(path).toLowerCase() === testBase) {
        results.set(test.path, { testPath: test.path, reason: 'same file name as the changed file', confirmed: false })
        break
      }
      const dir = path.split('/').slice(0, -1).join('/')
      if (dir && test.path.includes(dir.split('/').pop() ?? '')) {
        results.set(test.path, { testPath: test.path, reason: 'test directory mirrors the changed file’s directory', confirmed: false })
        break
      }
    }
  }
  return [...results.values()].sort((a, b) => Number(b.confirmed) - Number(a.confirmed) || a.testPath.localeCompare(b.testPath))
}

// Detect the test runner from test file contents so the suggested command
// uses the project's own runner. Returns null when nothing is detectable.
export function detectTestRunner(files: FileRec[]): { runner: string; command: (testPath: string) => string } | null {
  const testFiles = files.filter((file) => isTestPath(file.path))
  const text = testFiles.map((file) => file.text.slice(0, 4000)).join('\n')
  if (/from ['"]vitest['"]|require\(['"]vitest['"]\)/.test(text)) {
    return { runner: 'vitest', command: (p) => `npx vitest run ${p}` }
  }
  if (/from ['"]node:test['"]|require\(['"]node:test['"]\)/.test(text)) {
    return { runner: 'node:test', command: (p) => `node --test ${p}` }
  }
  if (/from ['"]@jest\/globals['"]|require\(['"]@jest\/globals['"]\)|jest\.(mock|spyOn|fn)\(/.test(text)) {
    return { runner: 'jest', command: (p) => `npx jest ${p}` }
  }
  if (/from ['"]mocha['"]|require\(['"]mocha['"]\)|describe\(['"]/.test(text)) {
    return { runner: 'mocha', command: (p) => `npx mocha ${p}` }
  }
  if (testFiles.length > 0) {
    return { runner: 'jest', command: (p) => `npx jest ${p}` } // jest is the common default
  }
  return null
}
