import { describe, expect, test } from 'bun:test'
import { diagnosticsToMarkdown, runDiagnostics } from './diagnostics'
import type { EdgeRec, FileRec, SymbolRec } from './types'

let n = 0
function file(path: string, text = 'x'): FileRec {
  return { id: `f:${path}`, repoId: 'r', path, language: 'javascript', size: text.length, contentHash: `h${n++}`, text }
}
function symbol(name: string, fileId: string, startLine: number, endLine = startLine): SymbolRec {
  return { id: `s:${fileId}:${name}`, repoId: 'r', fileId, kind: 'function', name, startLine, endLine }
}
function edge(fromId: string, toId: string, type: EdgeRec['type'] = 'imports'): EdgeRec {
  return { id: `e:${fromId}->${toId}:${type}:${n++}`, repoId: 'r', fromId, toId, type, confidence: 'extracted' }
}

describe('runDiagnostics', () => {
  test('clean graph reports no errors and no warnings', () => {
    const a = file('a.js', '1\n2')
    const b = file('b.js', '1\n2')
    const fn = symbol('fn', a.id, 1, 2)
    const report = runDiagnostics([a, b], [fn], [edge(a.id, b.id), edge(a.id, fn.id, 'contains')])
    expect(report.counts.errors).toBe(0)
    expect(report.counts.warnings).toBe(0)
    expect(report.issues).toEqual([])
    expect(report.counts.nodes).toBe(3)
    expect(report.counts.edges).toBe(2)
  })

  test('detects edges with missing endpoints', () => {
    const a = file('a.js')
    const report = runDiagnostics([a], [], [edge(a.id, 'ghost')])
    expect(report.counts.missingRefs).toBe(1)
    const issue = report.issues.find((i) => i.type === 'missing-endpoint')
    expect(issue?.severity).toBe('error')
  })

  test('detects orphan files but not connected ones', () => {
    const a = file('a.js')
    const b = file('b.js')
    const lonely = file('README.md')
    const report = runDiagnostics([a, b, lonely], [], [edge(a.id, b.id)])
    expect(report.counts.orphans).toBe(1)
    expect(report.issues.find((i) => i.type === 'orphan-node')?.paths).toEqual(['README.md'])
  })

  test('detects duplicate edges and self loops', () => {
    const a = file('a.js')
    const b = file('b.js')
    const report = runDiagnostics([a, b], [], [edge(a.id, b.id), edge(a.id, b.id), edge(a.id, a.id)])
    expect(report.counts.duplicateEdges).toBe(1)
    expect(report.issues.some((i) => i.type === 'same-endpoint-edge')).toBe(true)
  })

  test('detects dense nodes above the threshold', () => {
    const hub = file('hub.js')
    const spokes = Array.from({ length: 30 }, (_, i) => file(`s${i}.js`))
    const edges = spokes.map((s) => edge(hub.id, s.id))
    const report = runDiagnostics([hub, ...spokes], [], edges)
    expect(report.issues.some((i) => i.type === 'dense-node' && i.paths.includes('hub.js'))).toBe(true)
  })

  test('detects invalid symbol lines and unknown symbol files', () => {
    const a = file('a.js', '1\n2\n3')
    const bad = symbol('bad', a.id, 10)
    const stray = symbol('stray', 'ghost-file', 1)
    const report = runDiagnostics([a], [bad, stray], [])
    const locations = report.issues.filter((i) => i.type === 'invalid-location')
    expect(locations.length).toBe(2)
    expect(locations.every((i) => i.severity === 'error')).toBe(true)
  })

  test('detects import cycles with their paths and reports each once', () => {
    const a = file('a.js')
    const b = file('b.js')
    const c = file('c.js')
    const report = runDiagnostics([a, b, c], [], [edge(a.id, b.id), edge(b.id, c.id), edge(c.id, a.id), edge(c.id, b.id)])
    const cycles = report.issues.filter((i) => i.type === 'cycle')
    // a→b→c→a and b→c→b
    expect(cycles.length).toBe(2)
    expect(cycles.some((i) => i.message.includes('a.js → b.js → c.js → a.js'))).toBe(true)
    expect(cycles.some((i) => i.message.includes('b.js → c.js → b.js'))).toBe(true)
  })

  test('is deterministic across runs', () => {
    const a = file('a.js')
    const b = file('b.js')
    const build = () => runDiagnostics([a, b], [symbol('fn', a.id, 1)], [edge(a.id, b.id), edge(a.id, b.id)])
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()))
  })
})

describe('diagnosticsToMarkdown', () => {
  test('renders counts and an issue table', () => {
    const a = file('a.js')
    const lonely = file('lonely.js')
    const report = runDiagnostics([a, lonely], [], [])
    const md = diagnosticsToMarkdown(report)
    expect(md).toContain('| Nodes | 2 |')
    expect(md).toContain('| Orphan nodes | 2 |')
    expect(md).toContain('| warning | orphan-node |')
  })
})
