import { describe, expect, test } from 'bun:test'
import { buildIndex } from './graphquery'
import { impactReport, formatPath, reportToMarkdown, affectedTests, detectTestRunner, isTestPath } from './impact'
import { fileId, symbolId, edgeId } from './db'
import type { FileRec, SymbolRec, EdgeRec } from './types'

const R = 'o/r@abc'
function file(path: string, text = ''): FileRec {
  return { id: fileId(R, path), repoId: R, path, language: 'typescript', size: text.length, contentHash: path, text }
}
function sym(path: string, name: string, line: number): SymbolRec {
  return { id: symbolId(R, path, name, line), repoId: R, fileId: fileId(R, path), kind: 'function', name, startLine: line, endLine: line + 5 }
}
function edge(from: string, to: string, type: EdgeRec['type']): EdgeRec {
  return { id: edgeId(R, from, to, type), repoId: R, fromId: from, toId: to, type, confidence: 'extracted' }
}

// app.ts -imports-> router.ts -imports-> utils.ts ; cycle: a.ts <-> b.ts
const files = [file('src/app.ts'), file('src/router.ts'), file('src/utils.ts'), file('src/a.ts'), file('src/b.ts')]
const symbols = [sym('src/utils.ts', 'helper', 10)]
const edges = [
  edge(fileId(R, 'src/app.ts'), fileId(R, 'src/router.ts'), 'imports'),
  edge(fileId(R, 'src/router.ts'), fileId(R, 'src/utils.ts'), 'imports'),
  edge(fileId(R, 'src/a.ts'), fileId(R, 'src/b.ts'), 'imports'),
  edge(fileId(R, 'src/b.ts'), fileId(R, 'src/a.ts'), 'imports'),
  edge(fileId(R, 'src/utils.ts'), symbolId(R, 'src/utils.ts', 'helper', 10), 'contains'),
]
const index = buildIndex(files, symbols, edges)

describe('impactReport', () => {
  test('separates direct and transitive dependents with paths', () => {
    const report = impactReport(index, fileId(R, 'src/utils.ts'))!
    expect(report.direct.map((r) => r.node.path)).toEqual(['src/router.ts'])
    expect(report.transitive.map((r) => r.node.path)).toEqual(['src/app.ts'])
    expect(formatPath(report.transitive[0].path)).toBe('utils.ts -imports-> router.ts -imports-> app.ts')
    expect(report.transitive[0].depth).toBe(2)
  })
  test('respects the depth limit', () => {
    const report = impactReport(index, fileId(R, 'src/utils.ts'), { depth: 1 })!
    expect(report.direct).toHaveLength(1)
    expect(report.transitive).toHaveLength(0)
  })
  test('cycles terminate without duplicating nodes', () => {
    const report = impactReport(index, fileId(R, 'src/a.ts'), { depth: 10 })!
    const all = [...report.direct, ...report.transitive]
    expect(all).toHaveLength(1)
    expect(all[0].node.path).toBe('src/b.ts')
  })
  test('node type filter keeps only matching rows', () => {
    const report = impactReport(index, symbolId(R, 'src/utils.ts', 'helper', 10), { nodeTypes: ['file'] })!
    const all = [...report.direct, ...report.transitive]
    expect(all.every((r) => r.node.type === 'file')).toBe(true)
    expect(all.length).toBeGreaterThan(0)
  })
  test('unknown start id returns null', () => {
    expect(impactReport(index, 'nope')).toBeNull()
  })
})

describe('reportToMarkdown', () => {
  test('renders a table with citations and depths', () => {
    const md = reportToMarkdown(impactReport(index, fileId(R, 'src/utils.ts'))!)
    expect(md).toContain('# Impact report: utils.ts')
    expect(md).toContain('| router.ts | file | src/router.ts |')
    expect(md).toContain('| app.ts | file | src/app.ts |')
    expect(md).toContain('| 2 |')
  })
})

describe('affectedTests', () => {
  const testFiles = [
    ...files,
    file('test/utils.test.ts', `import { helper } from '../src/utils'`),
    file('test/router.test.ts', `import x from '../src/router'`),
    file('test/unrelated.test.ts', `import y from 'elsewhere'`),
  ]
  const testEdges = [
    ...edges,
    edge(fileId(R, 'test/utils.test.ts'), fileId(R, 'src/utils.ts'), 'imports'),
    edge(fileId(R, 'test/router.test.ts'), fileId(R, 'src/router.ts'), 'imports'),
  ]
  const testIndex = buildIndex(testFiles, symbols, testEdges)

  test('confirmed via import edges, heuristic via basename, no double count', () => {
    const hits = affectedTests(testIndex, testFiles, ['src/utils.ts'])
    const confirmed = hits.filter((h) => h.confirmed)
    const heuristic = hits.filter((h) => !h.confirmed)
    expect(confirmed.map((h) => h.testPath)).toContain('test/utils.test.ts')
    // router.test.ts imports router.ts which imports utils.ts (transitive, confirmed)
    expect(confirmed.map((h) => h.testPath)).toContain('test/router.test.ts')
    expect(heuristic).toHaveLength(0)
    // unrelated test never appears
    expect(hits.map((h) => h.testPath)).not.toContain('test/unrelated.test.ts')
  })
  test('basename heuristic fires when no edge exists', () => {
    const orphan = [file('src/new.ts'), file('test/new.test.ts', 'x')]
    const idx = buildIndex(orphan, [], [])
    const hits = affectedTests(idx, orphan, ['src/new.ts'])
    expect(hits).toHaveLength(1)
    expect(hits[0].confirmed).toBe(false)
  })
  test('isTestPath patterns', () => {
    expect(isTestPath('test/app.test.ts')).toBe(true)
    expect(isTestPath('src/__tests__/x.ts')).toBe(true)
    expect(isTestPath('src/app.ts')).toBe(false)
  })
})

describe('detectTestRunner', () => {
  test('vitest from imports', () => {
    const r = detectTestRunner([file('test/x.test.ts', `import { it } from 'vitest'`)])
    expect(r?.runner).toBe('vitest')
    expect(r?.command('test/x.test.ts')).toBe('npx vitest run test/x.test.ts')
  })
  test('null when no tests at all', () => {
    expect(detectTestRunner([file('src/a.ts', 'const x = 1')])).toBeNull()
  })
})
