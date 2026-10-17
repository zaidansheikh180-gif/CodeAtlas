import { describe, expect, it, test } from 'bun:test'
import type { SemanticEdgeRec } from './semantic'
import { buildModules, buildSemanticModuleEdges } from './modules'
import { fileId, symbolId, edgeId } from './db'
import type { FileRec, SymbolRec, EdgeRec } from './types'

const R = 'o/r@abc'
const file = (path: string): FileRec => ({ id: fileId(R, path), repoId: R, path, language: 'javascript', size: 1, contentHash: path, text: '' })
const sym = (path: string, name: string): SymbolRec => ({ id: symbolId(R, path, name, 1), repoId: R, fileId: fileId(R, path), kind: 'function', name, startLine: 1, endLine: 2 })
const imp = (a: FileRec, b: FileRec): EdgeRec => ({ id: edgeId(R, a.id, b.id, 'imports'), repoId: R, fromId: a.id, toId: b.id, type: 'imports', confidence: 'extracted' })
const call = (a: SymbolRec, b: SymbolRec): EdgeRec => ({ id: edgeId(R, a.id, b.id, 'calls'), repoId: R, fromId: a.id, toId: b.id, type: 'calls', confidence: 'extracted' })

// lib has 3 files, test has 3 files: neither folds into Other.
const files = [file('lib/a.js'), file('lib/b.js'), file('lib/c.js'), file('test/x.js'), file('test/y.js'), file('test/z.js')]
const sA = sym('lib/a.js', 'fa')
const sX = sym('test/x.js', 'fx')

describe('buildModules edge kinds', () => {
  test('imports and calls aggregate separately with their kind', () => {
    const edges = [imp(files[0], files[3]), imp(files[1], files[3]), call(sA, sX)]
    const { moduleEdges } = buildModules(files, [sA, sX], edges)
    const imports = moduleEdges.find((e) => e.kind === 'imports')
    const calls = moduleEdges.find((e) => e.kind === 'calls')
    expect(imports).toMatchObject({ from: 'lib', to: 'test', count: 2 })
    expect(calls).toMatchObject({ from: 'lib', to: 'test', count: 1 })
  })
  test('symbol-level calls resolve through their file to the module', () => {
    const { moduleEdges } = buildModules(files, [sA, sX], [call(sX, sA)])
    expect(moduleEdges).toHaveLength(1)
    expect(moduleEdges[0]).toMatchObject({ from: 'test', to: 'lib', kind: 'calls' })
  })
  test('intra-module edges are dropped for both kinds', () => {
    const sB = sym('lib/b.js', 'fb')
    const { moduleEdges } = buildModules(files, [sA, sB], [imp(files[0], files[1]), call(sA, sB)])
    expect(moduleEdges).toHaveLength(0)
  })
  test('other edge types do not appear on the map', () => {
    const def: EdgeRec = { id: edgeId(R, files[0].id, sA.id, 'defines'), repoId: R, fromId: files[0].id, toId: sA.id, type: 'defines', confidence: 'extracted' }
    const { moduleEdges } = buildModules(files, [sA], [def])
    expect(moduleEdges).toHaveLength(0)
  })
})

describe('buildSemanticModuleEdges', () => {
  const f = (path: string): FileRec => ({ id: `file:${path}`, repoId: 'r1', path, language: 'typescript', size: 10, text: 'x' })
  const edge = (id: string, fromPath: string, toPath: string | null): SemanticEdgeRec => ({
    id,
    repoId: 'r1',
    runId: 'run1',
    fromPath,
    toPath,
    kind: 'dependency',
    label: 'l',
    evidence: '',
    confidence: 'inferred',
  })

  it('aggregates cross-module findings and skips null targets and intra-module pairs', () => {
    const files = [f('src/a.ts'), f('src/b.ts'), f('lib/c.ts'), f('lib/d.ts'), f('lib/e.ts')]
    const { modules } = buildModules(files, [], [])
    const edges = buildSemanticModuleEdges(modules, [
      edge('1', 'src/a.ts', 'lib/c.ts'),
      edge('2', 'src/b.ts', 'lib/d.ts'),
      edge('3', 'src/a.ts', 'src/b.ts'), // same module: collapsed away
      edge('4', 'src/a.ts', null), // theme finding: nothing to draw
      edge('5', 'src/ghost.ts', 'lib/c.ts'), // unknown path: dropped
    ])
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ from: 'src', to: 'lib', count: 2, kind: 'inferred' })
  })

  it('returns nothing without semantic findings', () => {
    const { modules } = buildModules([f('src/a.ts')], [], [])
    expect(buildSemanticModuleEdges(modules, [])).toHaveLength(0)
  })
})
