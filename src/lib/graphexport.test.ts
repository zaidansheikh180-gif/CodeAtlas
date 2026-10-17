import { describe, expect, test } from 'bun:test'
import { exportGraph, filterGraph, mapToGraphml, mapToMermaid, remapImport, validateGraphImport, GRAPH_EXPORT_KIND } from './graphexport'
import type { EdgeRec, FileRec, RepoRec, SymbolRec } from './types'
import type { ModuleEdge, ModuleNode } from './modules'

let n = 0
function file(path: string): FileRec {
  return { id: `r:file:${path}`, repoId: 'r', path, language: 'javascript', size: 3, contentHash: `h${n++}`, text: 'a\nb' }
}
function symbol(name: string, f: FileRec): SymbolRec {
  return { id: `r:sym:${f.path}#${name}@1`, repoId: 'r', fileId: f.id, kind: 'function', name, startLine: 1, endLine: 2 }
}
function edge(fromId: string, toId: string, type: EdgeRec['type'] = 'imports'): EdgeRec {
  return { id: `r:edge:${type}:${fromId}->${toId}`, repoId: 'r', fromId, toId, type, confidence: 'extracted' }
}
const repo: RepoRec = {
  id: 'r', url: 'https://github.com/a/b', fullName: 'a/b', commit: 'abc1234', defaultBranch: 'main',
  status: 'ready', description: null, language: 'JavaScript', sizeKb: 5,
  stats: { files: 2, parsedFiles: 2, symbols: 1, edges: 1, secretsExcluded: 0 }, indexedAt: 1729000000000,
}
const lib = file('lib/a.js')
const testFile = file('test/a.test.js')
const fn = symbol('fn', lib)
const edges = [edge(lib.id, testFile.id), edge(lib.id, fn.id, 'contains'), edge(testFile.id, lib.id, 'calls')]

describe('exportGraph', () => {
  test('carries metadata, schema version and full records', () => {
    const out = exportGraph(repo, [lib, testFile], [fn], edges)
    expect(out.kind).toBe(GRAPH_EXPORT_KIND)
    expect(out.schemaVersion).toBe(1)
    expect(out.repo.url).toBe('https://github.com/a/b')
    expect(out.repo.ref).toBe('main')
    expect(out.repo.commit).toBe('abc1234')
    expect(out.counts).toEqual({ files: 2, symbols: 1, edges: 3 })
    expect(out.files[0].text).toBe('a\nb')
  })

  test('filtered subsets keep only reachable records and chosen edge types', () => {
    const sub = filterGraph([lib, testFile], [fn], edges, { modules: ['lib'] })
    expect(sub.files.map((f) => f.path)).toEqual(['lib/a.js'])
    expect(sub.symbols.length).toBe(1)
    expect(sub.edges.map((e) => e.type)).toEqual(['contains'])
    const callsOnly = filterGraph([lib, testFile], [fn], edges, { edgeTypes: ['calls'] })
    expect(callsOnly.edges.length).toBe(1)
    expect(callsOnly.edges[0].type).toBe('calls')
  })
})

describe('map exports', () => {
  const modules: ModuleNode[] = [
    { id: 'lib', name: 'lib', fileCount: 2, symbolCount: 5, files: [lib] },
    { id: 'test', name: 'test', fileCount: 1, symbolCount: 0, files: [testFile] },
  ]
  const modEdges: ModuleEdge[] = [
    { from: 'lib', to: 'test', count: 3, kind: 'imports' },
    { from: 'test', to: 'lib', count: 1, kind: 'calls' },
  ]

  test('mermaid renders nodes and typed edges', () => {
    const md = mapToMermaid(modules, modEdges)
    expect(md).toContain('flowchart LR')
    expect(md).toContain('lib["lib (2 files)"]')
    expect(md).toContain('lib -->|imports x3| test')
    expect(md).toContain('test -.->|calls x1| lib')
  })

  test('graphml escapes names and lists edges', () => {
    const xml = mapToGraphml([{ ...modules[0], name: 'a&b' }], modEdges)
    expect(xml).toContain('<node id="a&amp;b">')
    expect(xml).toContain('<edge id="e0" source="lib" target="test">')
    expect(xml).toContain('<data key="count">3</data>')
  })
})

describe('validateGraphImport', () => {
  const good = exportGraph(repo, [lib, testFile], [fn], edges)
  const goodText = JSON.stringify(good)

  test('accepts a valid export and round-trips through remap', () => {
    const result = validateGraphImport(goodText, goodText.length)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const remapped = remapImport(result.data, 'import-1')
    expect(remapped.files[0].id).toBe('import-1:file:lib/a.js')
    expect(remapped.symbols[0].id).toBe('import-1:sym:lib/a.js#fn@1')
    expect(remapped.edges.length).toBe(3)
    expect(remapped.droppedEdges).toBe(0)
    expect(remapped.edges.every((e) => e.repoId === 'import-1')).toBe(true)
  })

  test('rejects non-JSON, wrong kind, wrong version and malformed records', () => {
    expect(validateGraphImport('not json', 8).ok).toBe(false)
    expect(validateGraphImport(JSON.stringify({ kind: 'other' }), 20).ok).toBe(false)
    expect(validateGraphImport(JSON.stringify({ ...good, schemaVersion: 99 }), 40).ok).toBe(false)
    const badFile = JSON.parse(goodText)
    badFile.files[0] = { id: 1 }
    const r = validateGraphImport(JSON.stringify(badFile), 100)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('malformed')
  })

  test('rejects oversized files before parsing and warns on large ones', () => {
    const tooBig = validateGraphImport('', 60 * 1024 * 1024)
    expect(tooBig.ok).toBe(false)
    const large = validateGraphImport(goodText, 11 * 1024 * 1024)
    expect(large.ok).toBe(true)
    if (large.ok) expect(large.warning).toContain('MB')
  })

  test('drops edges whose endpoints are missing and counts them', () => {
    const broken = JSON.parse(goodText)
    broken.edges.push({ id: 'x', fromId: 'ghost', toId: good.files[0].id, type: 'imports', confidence: 'extracted' })
    const result = validateGraphImport(JSON.stringify(broken), goodText.length)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const remapped = remapImport(result.data, 'import-2')
    expect(remapped.droppedEdges).toBe(1)
    expect(remapped.edges.length).toBe(3)
  })
})
